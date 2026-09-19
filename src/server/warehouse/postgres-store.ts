import type { Filter, QuerySpec } from "@/server/contracts";

import {
  UNCATEGORISED_KEY,
  WarehouseCapabilityError,
  type AggregateRequest,
  type AggregatedMember,
  type Aggregation,
  type Warehouse,
} from "./types";

/**
 * The second adapter: `Warehouse` compiled to SQL, for Postgres.
 *
 * It exists to make invariant 10 checkable rather than sincere. One adapter can be
 * perfectly deterministic and still be wrong in a way nothing detects; **two adapters
 * built on entirely different machinery, agreeing exactly on the same portable
 * `QuerySpec`, is a different kind of claim** — and it is the one `tests/conformance/`
 * proves. The seam in `types.ts` was drawn in GA-04 on the argument that a real warehouse
 * pushes the work down; until something actually pushed it down, that was an intention.
 *
 * ## It is a test artifact, and nothing on the serving path imports it
 *
 * `tests/conformance/corpus.test.ts` asserts that nothing under `src/app/` or the rest of
 * `src/server/` imports this module, and that the driver running it is a devDependency.
 * The shipped application still answers every question from the in-process typed-array
 * store (`local-store.ts`), so a clean clone needs no database and invariant 13 stands.
 *
 * ## It holds no driver, so it is portable and inert
 *
 * The SQL is issued through an injected {@link SqlClient} — one method wide, satisfied by
 * PGlite in the conformance suite and by `pg` against a real server without changing a
 * line here. This module imports nothing but its own sibling types: no driver, no
 * `node:*`, nothing that could pull a database into a bundle even if something did
 * import it.
 *
 * ## What it re-implements, and what it deliberately does not
 *
 * It re-implements exactly what `local-store.ts` owns — grouping and aggregation — and
 * nothing else. Guards, ordering, the limit, the trust report and the naive/honest
 * comparison stay in `engine/`, written once (`docs/architecture.md` §5). That split is
 * what makes the two adapters comparable at all: the conformance suite diffs the one
 * layer where a `GROUP BY` and a typed-array loop can genuinely disagree.
 *
 * It is a genuinely independent implementation of that layer, not a transcription. It
 * knows what `avg_rating` means from its own table below, because two implementations
 * sharing a definition would agree by construction and prove nothing.
 *
 * ## Exact integers cross the boundary here too
 *
 * Every quantity returned is a SQL `bigint`: `SUM(value_scaled)`, `COUNT(*)`,
 * `COUNT(DISTINCT …)`. **No `AVG`, no `numeric` and no float ever appears.** Postgres's
 * `AVG(int)` returns `numeric`, whose rounding is its own decision; handing the engine Σ
 * and n instead means the single division happens in one place for every adapter
 * (`engine/numbers.ts`), and the pinned 4.47 stays arithmetic rather than becoming a
 * property of whichever engine answered.
 */

/** Hundredths, matching the delivered rating scale. The fixture asserts the store agrees. */
const RATING_SCALE = 100;

/** `year` for a title whose release year could not be parsed. The fixture asserts it. */
const YEAR_UNKNOWN = -1;

/** Ten-thousandths, so a share renders to two decimals of a percentage. */
const SHARE_SCALE = 10_000;

/** `4.0` and above, in stored hundredths. */
const FOUR_STARS_SCALED = 4 * RATING_SCALE;

/** Which facts a measure is computed over. Determines what `observations` counts. */
type Grain = "rating" | "title";

/** The aggregate columns every member query returns, already coerced to JS integers. */
type AggregateColumns = {
  observations: number;
  sumScaled: number;
  distinctViewers: number;
  distinctTitles: number;
  atLeastFour: number;
};

type MeasureSql = {
  grain: Grain;
  scale: number;
  /** The exact numerator, in the measure's scaled units. */
  numerator: (columns: AggregateColumns) => number;
  /** The exact denominator. `1` unless the measure is genuinely a ratio. */
  denominator: (columns: AggregateColumns) => number;
};

/** A count measure: the value is the numerator itself, over one. */
const countMeasure = (
  grain: Grain,
  numerator: (columns: AggregateColumns) => number,
): MeasureSql => ({ grain, scale: 1, numerator, denominator: () => 1 });

/**
 * The five measures, defined against SQL aggregates rather than against a loop.
 *
 * Deliberately a second, independent statement of what each measure means — the same
 * ids, reached by different machinery. A definition shared with `local-store.ts` would
 * make the two adapters agree by construction, which is the one thing the conformance
 * suite must not assume.
 */
const MEASURES: Readonly<Record<string, MeasureSql>> = {
  avg_rating: {
    grain: "rating",
    scale: RATING_SCALE,
    numerator: (c) => c.sumScaled,
    denominator: (c) => Math.max(c.observations, 1),
  },
  share_rated_4_plus: {
    grain: "rating",
    scale: SHARE_SCALE,
    numerator: (c) => SHARE_SCALE * c.atLeastFour,
    denominator: (c) => Math.max(c.observations, 1),
  },
  rating_count: countMeasure("rating", (c) => c.observations),
  viewer_count: countMeasure("rating", (c) => c.distinctViewers),
  title_count: countMeasure("title", (c) => c.distinctTitles),
};

/** Dimensions one entity can belong to several of at once. */
const MULTI_VALUED_DIMENSIONS: readonly string[] = ["genre"];

const DIMENSIONS: readonly string[] = [
  "title",
  "genre",
  "release_year",
  "release_decade",
  "rating_year",
];

/** How a dimension's values compare. Mirrors what `matches()` in the local adapter accepts. */
const DIMENSION_VALUE_TYPE: Readonly<Record<string, "text" | "number">> = {
  title: "text",
  genre: "text",
  release_year: "number",
  release_decade: "number",
  rating_year: "number",
};

/** The minimum a driver must provide. PGlite and `pg`'s `Client` both satisfy it as-is. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Collects bound values, so no literal from a spec is ever pasted into SQL. */
class Bindings {
  readonly values: unknown[] = [];

  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * The year of a unix-seconds column, **in UTC, stated rather than inherited**.
 *
 * `EXTRACT(YEAR FROM to_timestamp(at))` renders in the session's `TimeZone`, and a
 * Postgres session inherits that from its host: PGlite booted on this machine reports
 * `Etc/GMT+8` with no `TZ` set anywhere. Under it a rating at `2003-01-01T00:00:00Z` is
 * filed under **2002** — a different answer to the same question, with no error anywhere.
 * `AT TIME ZONE 'UTC'` pins it, and `tests/conformance/` runs the entire Postgres corpus
 * under a deliberately hostile session zone so the pinning is proved, not trusted.
 *
 * The store keeps time as unix seconds and the local adapter reads the year through
 * `Date#getUTCFullYear`, so UTC is the definition both adapters are held to.
 */
function utcYear(column: string): string {
  return `EXTRACT(YEAR FROM (to_timestamp(${column}) AT TIME ZONE 'UTC'))::int`;
}

/** The SQL expression a dimension's value is read from, given the aliases in scope. */
function dimensionExpression(dimension: string, ratingAlias: string | null): string | null {
  switch (dimension) {
    case "title":
      return "t.name";
    case "genre":
      return "g.genre";
    case "release_year":
      return "t.year";
    case "release_decade":
      return "((t.year / 10) * 10)";
    case "rating_year":
      // A fact with no rating carries no rating year, so no filter on it can match — which
      // is what `dimensionValues()` returning `[]` means in the local adapter.
      return ratingAlias === null ? null : utcYear(`${ratingAlias}.at`);
    default:
      return null;
  }
}

/**
 * A filter predicate, reproducing `matches()` in the local adapter **including its type
 * strictness**, which is where a careless translation diverges.
 *
 * `matches()` compares with `===` and requires *both* sides to be numbers for `gte`,
 * `lte` and `between`. Postgres will happily compare text with `>=` under its collation,
 * so a predicate emitted without this check would answer a question the local adapter
 * refuses — and the two adapters would disagree on a filter rather than on a number. A
 * comparison the local adapter cannot make is `FALSE` here, deliberately.
 */
function filterPredicate(filter: Filter, ratingAlias: string | null, bindings: Bindings): string {
  const valueType = DIMENSION_VALUE_TYPE[filter.dimension];
  if (valueType === undefined) return "FALSE";

  const expression = dimensionExpression(filter.dimension, ratingAlias);
  if (expression === null) return "FALSE";

  const cast = valueType === "text" ? "::text" : "::int";
  const sameType = (value: unknown): boolean =>
    valueType === "text" ? typeof value === "string" : typeof value === "number";

  let predicate: string;
  switch (filter.op) {
    case "eq":
      predicate = sameType(filter.value)
        ? `${expression} = ${bindings.bind(filter.value)}${cast}`
        : "FALSE";
      break;
    case "in": {
      // Expanded into scalars rather than bound as an array: array serialisation is the
      // one place drivers differ from each other, and this adapter is meant to survive
      // being pointed at a different one.
      const values = Array.isArray(filter.value) ? filter.value.filter(sameType) : [];
      predicate =
        values.length === 0
          ? "FALSE"
          : `${expression} IN (${values.map((value) => `${bindings.bind(value)}${cast}`).join(", ")})`;
      break;
    }
    case "gte":
    case "lte": {
      if (valueType !== "number" || typeof filter.value !== "number") {
        predicate = "FALSE";
        break;
      }
      predicate = `${expression} ${filter.op === "gte" ? ">=" : "<="} ${bindings.bind(filter.value)}::int`;
      break;
    }
    case "between": {
      const bounds = Array.isArray(filter.value) ? filter.value : [];
      const [lo, hi] = bounds;
      if (valueType !== "number" || bounds.length !== 2 || typeof lo !== "number" || typeof hi !== "number") {
        predicate = "FALSE";
        break;
      }
      predicate = `${expression} BETWEEN ${bindings.bind(lo)}::int AND ${bindings.bind(hi)}::int`;
      break;
    }
  }

  // A dimension that cannot place an entity has no value to compare, so the filter cannot
  // match it: `dimensionValues()` returns `[]` and `matches()` returns false.
  switch (filter.dimension) {
    case "genre":
      return `EXISTS (SELECT 1 FROM title_genre g WHERE g.title_idx = t.idx AND ${predicate})`;
    case "release_year":
    case "release_decade":
      return `(t.year <> ${YEAR_UNKNOWN} AND ${predicate})`;
    default:
      return predicate;
  }
}

function filterClause(
  filters: readonly Filter[],
  ratingAlias: string | null,
  bindings: Bindings,
): string {
  if (filters.length === 0) return "TRUE";
  return filters.map((filter) => filterPredicate(filter, ratingAlias, bindings)).join(" AND ");
}

/** The member key, id and sentinel flag for a breakdown, plus the join the key needs. */
type Placement = { key: string; id: string; uncategorised: string; join: string; placeable: string };

const NO_MEMBER: Placement = {
  key: "NULL::text",
  id: "0",
  uncategorised: "FALSE",
  join: "",
  placeable: "TRUE",
};

function placementFor(breakdown: string | undefined, factAlias: string | null): Placement {
  switch (breakdown) {
    case undefined:
      return NO_MEMBER;
    case "title":
      return { ...NO_MEMBER, key: "t.name", id: "t.movie_id" };
    case "genre":
      // The LEFT JOIN is what gives a title filed under no genre a member of its own, so
      // `exclude_uncategorised` has something generic to drop rather than the entity
      // vanishing. An inner join would make that drop silent — the failure this product
      // exists to catch, arriving through a join type.
      //
      // The key stays **NULL in SQL** and becomes `UNCATEGORISED_KEY` in JS. Postgres
      // `text` cannot hold a NUL byte and the sentinel begins with one, so it is
      // unrepresentable in the second engine; it is reconstructed from the
      // `uncategorised` flag, which is the field the guard registry actually reads.
      return {
        key: "g.genre",
        id: "COALESCE(g.genre_id, -1)",
        uncategorised: "(g.genre IS NULL)",
        join: "LEFT JOIN title_genre g ON g.title_idx = t.idx",
        placeable: "TRUE",
      };
    case "release_year":
      return {
        ...NO_MEMBER,
        key: "t.year::text",
        id: "t.year",
        placeable: `t.year <> ${YEAR_UNKNOWN}`,
      };
    case "release_decade":
      return {
        ...NO_MEMBER,
        key: "((t.year / 10) * 10)::text",
        id: "((t.year / 10) * 10)",
        placeable: `t.year <> ${YEAR_UNKNOWN}`,
      };
    case "rating_year": {
      if (factAlias === null) return { ...NO_MEMBER, placeable: "FALSE" };
      const year = utcYear(`${factAlias}.at`);
      return {
        ...NO_MEMBER,
        key: `${year}::text`,
        id: year,
        placeable: `${factAlias}.at IS NOT NULL`,
      };
    }
    default:
      return { ...NO_MEMBER, placeable: "FALSE" };
  }
}

/**
 * The `fact` and `place` common table expressions every query in this adapter starts
 * from.
 *
 * `fact` is one row per fact at the measure's grain, after the as-of watermark and the
 * spec's filters. `place` is one row per (fact, member), and **zero rows when the
 * breakdown cannot place the fact** — which is what makes "unplaced" expressible as a
 * `NOT EXISTS` rather than as a special case bolted on afterwards.
 */
function factAndPlace(
  spec: QuerySpec,
  grain: Grain,
  resolvedAsOfSeconds: number,
  bindings: Bindings,
): string {
  const ratingAlias = grain === "rating" ? "r" : null;

  const fact =
    grain === "rating"
      ? `SELECT r.seq AS fact_id, r.title_idx, r.viewer_id, r.value_scaled, r.at
           FROM rating r
           JOIN title t ON t.idx = r.title_idx
          WHERE r.at <= ${bindings.bind(resolvedAsOfSeconds)}::int
            AND ${filterClause(spec.filters, ratingAlias, bindings)}`
      : `SELECT t.idx AS fact_id, t.idx AS title_idx, 0 AS viewer_id, 0 AS value_scaled,
                NULL::int AS at
           FROM title t
          WHERE ${filterClause(spec.filters, null, bindings)}`;

  const placement = placementFor(spec.breakdown, ratingAlias === null ? null : "f");

  return `fact AS (${fact}),
    place AS (
      SELECT f.fact_id, f.title_idx, f.viewer_id, f.value_scaled,
             ${placement.key} AS member_key,
             ${placement.id} AS member_id,
             ${placement.uncategorised} AS uncategorised
        FROM fact f
        JOIN title t ON t.idx = f.title_idx
        ${placement.join}
       WHERE ${placement.placeable}
    )`;
}

/**
 * The member universe, for the breakdowns where a member can exist without facts.
 *
 * A title nobody rated is still a title, and `exclude_unrated` can only declare that it
 * dropped 18 of them if all 18 were there to be dropped. The local adapter enumerates the
 * same universe from the dimension; here it is a `UNION`, not a discovery from the data.
 */
function universe(spec: QuerySpec, grain: Grain, bindings: Bindings): string {
  const empty = "SELECT NULL::text AS member_key, 0 AS member_id, FALSE AS uncategorised WHERE FALSE";
  if (grain !== "rating") return empty;
  if (spec.breakdown === undefined) {
    return "SELECT NULL::text AS member_key, 0 AS member_id, FALSE AS uncategorised";
  }
  if (spec.breakdown !== "title") return empty;
  // Filters are evaluated with no rating in scope, exactly as `keep(t, null)` does: a
  // filter on a rating-grain dimension therefore admits no title into the universe.
  return `SELECT t.name AS member_key, t.movie_id AS member_id, FALSE AS uncategorised
            FROM title t
           WHERE ${filterClause(spec.filters, null, bindings)}`;
}

/**
 * A SQL integer, converted explicitly.
 *
 * Every aggregate here returns `bigint` (OID 20), and a driver may hand that over as a
 * number, a `BigInt` or a string — PGlite returns a number inside the safe range and a
 * `BigInt` outside it. Converting in one stated place means a count past 2^53 fails
 * loudly here rather than arriving in a `ResultSet` as a quietly wrong integer.
 */
function toInteger(value: unknown, column: string): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`postgres-store: ${column} is not a safe integer: ${value}`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`postgres-store: ${column} exceeds the safe integer range: ${value}`);
    }
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`postgres-store: ${column} is not a safe integer: ${value}`);
    }
    return parsed;
  }
  throw new Error(`postgres-store: ${column} came back as ${typeof value}`);
}

export type PostgresWarehouseOptions = {
  /** Distinguishes this adapter in provenance and in the conformance suite's reporting. */
  adapterId?: string;
};

export class PostgresWarehouse implements Warehouse {
  readonly adapterId: string;

  readonly #sql: SqlClient;

  #meta: { asOf: string; sourceId: string } | null = null;

  constructor(sql: SqlClient, options: PostgresWarehouseOptions = {}) {
    this.#sql = sql;
    this.adapterId = options.adapterId ?? "postgres";
  }

  /**
   * Read once and cached. The manifest facts live in the database beside the data, so the
   * adapter's only input is the connection — nothing is handed to it out of band that the
   * local adapter reads from the store.
   */
  async #metadata(): Promise<{ asOf: string; sourceId: string }> {
    if (this.#meta !== null) return this.#meta;
    const { rows } = await this.#sql.query("SELECT as_of, source_id FROM store_meta LIMIT 1");
    const row = rows[0];
    if (row === undefined) throw new Error("postgres-store: store_meta is empty");
    this.#meta = { asOf: String(row["as_of"]), sourceId: String(row["source_id"]) };
    return this.#meta;
  }

  /**
   * `Warehouse` declares this a plain property, so it is served from the cache the first
   * query fills. The engine reads it only when composing provenance, after a query.
   */
  get sourceId(): string {
    return this.#meta?.sourceId ?? "unknown";
  }

  async latestAsOf(): Promise<string> {
    return (await this.#metadata()).asOf;
  }

  async aggregate({ spec, resolvedAsOf }: AggregateRequest): Promise<Aggregation> {
    const measure = MEASURES[spec.measure];
    if (measure === undefined) {
      throw new WarehouseCapabilityError(this.adapterId, "measure", spec.measure);
    }
    for (const dimension of [spec.breakdown, ...spec.filters.map((filter) => filter.dimension)]) {
      if (dimension !== undefined && !DIMENSIONS.includes(dimension)) {
        throw new WarehouseCapabilityError(this.adapterId, "dimension", dimension);
      }
    }
    await this.#metadata();

    const seconds = isoToUnixSeconds(resolvedAsOf);
    const grain = measure.grain;
    const multiValued =
      spec.breakdown !== undefined && MULTI_VALUED_DIMENSIONS.includes(spec.breakdown);

    const members = await this.#members(spec, grain, seconds, measure);
    const totals = await this.#totals(spec, grain, seconds);
    const multiMembership = multiValued ? await this.#multiMembership(spec, grain, seconds) : null;

    return {
      scale: measure.scale,
      members,
      totalObservations: totals.totalObservations,
      totalMembers: members.length,
      unplaced: { members: totals.unplacedMembers, observations: totals.unplacedObservations },
      multiMembership,
    };
  }

  async #members(
    spec: QuerySpec,
    grain: Grain,
    seconds: number,
    measure: MeasureSql,
  ): Promise<AggregatedMember[]> {
    const bindings = new Bindings();
    const ctes = factAndPlace(spec, grain, seconds, bindings);
    const text = `
      WITH ${ctes},
      universe AS (${universe(spec, grain, bindings)}),
      member AS (
        SELECT member_key, member_id, uncategorised FROM place
        UNION
        SELECT member_key, member_id, uncategorised FROM universe
      )
      SELECT m.member_key,
             m.member_id,
             m.uncategorised,
             COUNT(p.fact_id)                            AS observations,
             -- SUM() over no rows is NULL, not 0. A member enumerated from the dimension
             -- and matched by nothing is exactly that case; without COALESCE it would
             -- arrive as a null numerator instead of 0/1.
             COALESCE(SUM(p.value_scaled), 0)            AS sum_scaled,
             COUNT(DISTINCT p.viewer_id)                 AS distinct_viewers,
             COUNT(DISTINCT p.title_idx)                 AS distinct_titles,
             COUNT(p.fact_id) FILTER (WHERE p.value_scaled >= ${bindings.bind(FOUR_STARS_SCALED)}::int)
                                                         AS at_least_four
        FROM member m
        LEFT JOIN place p
               ON p.member_id = m.member_id
              AND p.member_key IS NOT DISTINCT FROM m.member_key
       GROUP BY m.member_key, m.member_id, m.uncategorised`;

    const { rows } = await this.#sql.query(text, bindings.values);
    return rows.map((row) => {
      const columns: AggregateColumns = {
        observations: toInteger(row["observations"], "observations"),
        sumScaled: toInteger(row["sum_scaled"], "sum_scaled"),
        distinctViewers: toInteger(row["distinct_viewers"], "distinct_viewers"),
        distinctTitles: toInteger(row["distinct_titles"], "distinct_titles"),
        atLeastFour: toInteger(row["at_least_four"], "at_least_four"),
      };
      const uncategorised = row["uncategorised"] === true;
      const key = row["member_key"];
      return {
        key: uncategorised ? UNCATEGORISED_KEY : key === null || key === undefined ? null : String(key),
        memberId: toInteger(row["member_id"], "member_id"),
        uncategorised,
        observations: columns.observations,
        numerator: measure.numerator(columns),
        denominator: measure.denominator(columns),
      };
    });
  }

  async #totals(
    spec: QuerySpec,
    grain: Grain,
    seconds: number,
  ): Promise<{ totalObservations: number; unplacedMembers: number; unplacedObservations: number }> {
    const bindings = new Bindings();
    const ctes = factAndPlace(spec, grain, seconds, bindings);
    const text = `
      WITH ${ctes},
      unplaced AS (
        SELECT f.fact_id, f.title_idx
          FROM fact f
         WHERE NOT EXISTS (SELECT 1 FROM place p WHERE p.fact_id = f.fact_id)
      )
      SELECT (SELECT COUNT(*) FROM fact)                      AS total_observations,
             (SELECT COUNT(DISTINCT title_idx) FROM unplaced) AS unplaced_members,
             (SELECT COUNT(*) FROM unplaced)                  AS unplaced_observations`;

    const { rows } = await this.#sql.query(text, bindings.values);
    const row = rows[0] ?? {};
    return {
      totalObservations: toInteger(row["total_observations"], "total_observations"),
      unplacedMembers: toInteger(row["unplaced_members"], "unplaced_members"),
      unplacedObservations: toInteger(row["unplaced_observations"], "unplaced_observations"),
    };
  }

  async #multiMembership(
    spec: QuerySpec,
    grain: Grain,
    seconds: number,
  ): Promise<{ entities: number; assignments: number }> {
    const bindings = new Bindings();
    const ctes = factAndPlace(spec, grain, seconds, bindings);
    const text = `
      WITH ${ctes},
      per_entity AS (
        SELECT title_idx, COUNT(DISTINCT member_id) AS members FROM place GROUP BY title_idx
      )
      SELECT COUNT(*) AS entities, COALESCE(SUM(members), 0) AS assignments
        FROM per_entity
       WHERE members > 1`;

    const { rows } = await this.#sql.query(text, bindings.values);
    const row = rows[0] ?? {};
    return {
      entities: toInteger(row["entities"], "entities"),
      assignments: toInteger(row["assignments"], "assignments"),
    };
  }
}

/** ISO-8601 UTC in, unix seconds out. The wire carries ISO; the column holds seconds. */
function isoToUnixSeconds(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`postgres-store: "${iso}" is not an ISO-8601 timestamp`);
  return Math.floor(ms / 1000);
}

/**
 * The schema this adapter reads, as one statement per table.
 *
 * It lives beside the adapter rather than in the test fixture because it *is* part of the
 * adapter's contract: the column names and types below are what every query above is
 * written against. A real deployment would create these with a migration; the conformance
 * fixture runs them verbatim.
 */
export const POSTGRES_SCHEMA: readonly string[] = [
  // `fingerprint` is the loader's bookkeeping, not the adapter's: it identifies which
  // store a server already holds, so a second run against the same Postgres reuses it.
  `CREATE TABLE store_meta (as_of text NOT NULL, source_id text NOT NULL, fingerprint text NOT NULL)`,
  `CREATE TABLE title (
     idx      int  PRIMARY KEY,
     movie_id int  NOT NULL,
     name     text NOT NULL,
     year     int  NOT NULL
   )`,
  `CREATE TABLE title_genre (
     title_idx int  NOT NULL,
     genre_id  int  NOT NULL,
     genre     text NOT NULL
   )`,
  `CREATE TABLE rating (
     seq          int PRIMARY KEY,
     title_idx    int NOT NULL,
     viewer_id    int NOT NULL,
     value_scaled int NOT NULL,
     at           int NOT NULL
   )`,
  `CREATE INDEX rating_at ON rating (at)`,
  `CREATE INDEX rating_title ON rating (title_idx)`,
  `CREATE INDEX title_genre_title ON title_genre (title_idx)`,
];

/** The scale and sentinel the loader must assert the store agrees with. */
export const POSTGRES_STORE_ASSUMPTIONS = { ratingScale: RATING_SCALE, yearUnknown: YEAR_UNKNOWN };
