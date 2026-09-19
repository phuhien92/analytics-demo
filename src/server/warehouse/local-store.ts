import type { Filter } from "@/server/contracts";

import {
  RATING_SCALE,
  YEAR_UNKNOWN,
  isoToUnixSeconds,
  ratingsAsOf,
  readStore,
  type Store,
} from "@/server/ingest/store";

import {
  UNCATEGORISED_KEY,
  WarehouseCapabilityError,
  type AggregateRequest,
  type AggregatedMember,
  type Aggregation,
  type Warehouse,
} from "./types";

/**
 * The local adapter: `Warehouse` over the typed-array store GA-02 compiled.
 *
 * It is the only module in the build that knows what `avg_rating` *means*. That is
 * deliberate, and it is where invariant 6 puts dataset knowledge: the core types stay
 * portable, the engine stays generic, and the mapping from a declared id to an actual
 * computation lives in the adapter — which is exactly what a Postgres adapter replaces
 * with a `GROUP BY`. Nothing leaks upward: the engine reads `numerator`, `denominator`
 * and `observations` without ever learning which measure produced them.
 *
 * ## Everything it returns is an integer
 *
 * Ratings are stored as hundredths, so a sum is an integer and **integer addition is
 * exactly order-independent**. Two adapters visiting the same ratings in a different
 * order agree bit-for-bit; a float sum would not, and the disagreement would land in the
 * last decimal — precisely the silent difference this product claims to catch
 * (`docs/architecture.md` §2a).
 *
 * ## The member universe is enumerated, not discovered
 *
 * Where a member can exist without facts — a title nobody rated — the universe is
 * enumerated from the dimension rather than discovered from the data. Otherwise
 * `exclude_unrated` would have nothing to drop and the trust report could not say that 18
 * titles were left out. A guard can only declare what it excluded if the excluded thing
 * was there to begin with.
 */

/** Ten-thousandths, so a share renders to two decimals of a percentage. */
const SHARE_SCALE = 10_000;

/** `4.0` and above, in stored hundredths. */
const FOUR_STARS_SCALED = 4 * RATING_SCALE;

/** Which facts a measure is computed over. Determines what `observations` counts. */
type Grain = "rating" | "title";

type MeasureSpec = { grain: Grain; scale: number };

/**
 * The five measures the shipped layer declares. Keyed by the same ids, but this table is
 * not the declaration — `semantic/movielens.json` is. A measure here and absent there is
 * unreachable; the reverse is a `WarehouseCapabilityError`.
 */
const MEASURES: Readonly<Record<string, MeasureSpec>> = {
  avg_rating: { grain: "rating", scale: RATING_SCALE },
  rating_count: { grain: "rating", scale: 1 },
  viewer_count: { grain: "rating", scale: 1 },
  title_count: { grain: "title", scale: 1 },
  share_rated_4_plus: { grain: "rating", scale: SHARE_SCALE },
};

/** Dimensions whose value is a point in time — C4's disclosure note attaches to these. */
export const DATE_DIMENSIONS: readonly string[] = ["release_year", "release_decade", "rating_year"];

/** Dimensions one entity can belong to several of at once. */
const MULTI_VALUED_DIMENSIONS: readonly string[] = ["genre"];

const DIMENSIONS: readonly string[] = [
  "title",
  "genre",
  "release_year",
  "release_decade",
  "rating_year",
];

type Accumulator = {
  key: string | null;
  memberId: number;
  uncategorised: boolean;
  /** Σ of stored hundredths, for `avg_rating`. */
  sumScaled: number;
  /** Facts at the measure's grain. */
  observations: number;
  /** Ratings at or above four stars, for `share_rated_4_plus`. */
  atLeastFour: number;
  distinctViewers: Set<number> | null;
  distinctTitles: Set<number> | null;
};

function emptyAccumulator(key: string | null, memberId: number, uncategorised: boolean): Accumulator {
  return {
    key,
    memberId,
    uncategorised,
    sumScaled: 0,
    observations: 0,
    atLeastFour: 0,
    distinctViewers: null,
    distinctTitles: null,
  };
}

function utcYear(unixSeconds: number): number {
  return new Date(unixSeconds * 1000).getUTCFullYear();
}

/**
 * The value(s) an entity carries for a dimension.
 *
 * An empty array means the dimension cannot place this entity — an undated title under
 * `release_year`, a title filed under no genre under `genre`. The caller decides whether
 * that becomes a sentinel member or an unplaced entity, which keeps "the breakdown could
 * not place this" one generic concept rather than a MovieLens special case.
 */
function dimensionValues(
  store: Store,
  dimension: string,
  titleIndex: number,
  ratingAt: number | null,
): (string | number)[] {
  switch (dimension) {
    case "title":
      return [store.titles.name[titleIndex]!];
    case "genre": {
      const from = store.titles.genreOffset[titleIndex]!;
      const to = store.titles.genreOffset[titleIndex + 1]!;
      const out: string[] = [];
      for (let g = from; g < to; g++) out.push(store.manifest.genres[store.titles.genreValue[g]!]!);
      return out;
    }
    case "release_year": {
      const year = store.titles.year[titleIndex]!;
      return year === YEAR_UNKNOWN ? [] : [year];
    }
    case "release_decade": {
      const year = store.titles.year[titleIndex]!;
      return year === YEAR_UNKNOWN ? [] : [Math.floor(year / 10) * 10];
    }
    case "rating_year":
      return ratingAt === null ? [] : [utcYear(ratingAt)];
    default:
      return [];
  }
}

/** The stable natural key for a member — the partner's id, never a storage position. */
function memberIdFor(
  store: Store,
  dimension: string,
  titleIndex: number,
  value: string | number,
): number {
  switch (dimension) {
    case "title":
      // movieId. Five title *strings* are shared by two movieIds each, so the string is
      // not a total order on its own and this is what completes it.
      return store.titles.id[titleIndex]!;
    case "genre":
      // Index into the sorted genre registry — stable because the registry is sorted by
      // name rather than by order of appearance.
      return store.manifest.genres.indexOf(value as string);
    default:
      return value as number;
  }
}

function matches(filter: Filter, values: (string | number)[]): boolean {
  const { op, value } = filter;
  for (const candidate of values) {
    switch (op) {
      case "eq":
        if (candidate === value) return true;
        break;
      case "in":
        if (Array.isArray(value) && value.includes(candidate as never)) return true;
        break;
      case "gte":
        if (typeof candidate === "number" && typeof value === "number" && candidate >= value) return true;
        break;
      case "lte":
        if (typeof candidate === "number" && typeof value === "number" && candidate <= value) return true;
        break;
      case "between": {
        if (!Array.isArray(value) || value.length !== 2) break;
        const [lo, hi] = value as [number, number];
        if (typeof candidate === "number" && candidate >= lo && candidate <= hi) return true;
        break;
      }
    }
  }
  return false;
}

export class LocalStoreWarehouse implements Warehouse {
  readonly adapterId = "local-store";

  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
  }

  /** Read the compiled store from disk. `.store/` is a build artifact — run `npm run ingest`. */
  static fromDirectory(dir: string): LocalStoreWarehouse {
    return new LocalStoreWarehouse(readStore(dir));
  }

  get sourceId(): string {
    const payloads = this.#store.manifest.payloads;
    return payloads[payloads.length - 1]?.sourceId ?? "unknown";
  }

  get store(): Store {
    return this.#store;
  }

  latestAsOf(): Promise<string> {
    return Promise.resolve(this.#store.manifest.asOf);
  }

  aggregate(request: AggregateRequest): Promise<Aggregation> {
    return Promise.resolve(this.#aggregateSync(request));
  }

  #aggregateSync({ spec, resolvedAsOf }: AggregateRequest): Aggregation {
    const store = this.#store;
    const measure = MEASURES[spec.measure];
    if (measure === undefined) {
      throw new WarehouseCapabilityError(this.adapterId, "measure", spec.measure);
    }
    for (const dimension of [spec.breakdown, ...spec.filters.map((f) => f.dimension)]) {
      if (dimension !== undefined && !DIMENSIONS.includes(dimension)) {
        throw new WarehouseCapabilityError(this.adapterId, "dimension", dimension);
      }
    }

    const inScope = ratingsAsOf(store, isoToUnixSeconds(resolvedAsOf));
    const breakdown = spec.breakdown;
    const multiValued = breakdown !== undefined && MULTI_VALUED_DIMENSIONS.includes(breakdown);
    const needsViewers = spec.measure === "viewer_count";
    const needsTitles = spec.measure === "title_count";

    const members = new Map<string, Accumulator>();
    const ensure = (key: string | null, memberId: number, uncategorised: boolean): Accumulator => {
      const mapKey = key ?? "\u0000:total";
      let existing = members.get(mapKey);
      if (existing === undefined) {
        existing = emptyAccumulator(key, memberId, uncategorised);
        members.set(mapKey, existing);
      }
      return existing;
    };

    const keep = (titleIndex: number, ratingAt: number | null): boolean =>
      spec.filters.every((filter) =>
        matches(filter, dimensionValues(store, filter.dimension, titleIndex, ratingAt)),
      );

    /** The members an entity belongs to. `null` means the breakdown could not place it. */
    const placement = (titleIndex: number, ratingAt: number | null): Accumulator[] | null => {
      if (breakdown === undefined) return [ensure(null, 0, false)];
      const values = dimensionValues(store, breakdown, titleIndex, ratingAt);
      if (values.length === 0) {
        // A multi-valued dimension gets a sentinel member, so `exclude_uncategorised` has
        // something generic to drop. Anything else is unplaceable and gets declared.
        return multiValued ? [ensure(UNCATEGORISED_KEY, -1, true)] : null;
      }
      return values.map((value) =>
        ensure(String(value), memberIdFor(store, breakdown, titleIndex, value), false),
      );
    };

    /** Entities the breakdown could not place, and the observations they carry with them. */
    const unplacedEntities = new Set<number>();
    let unplacedObservations = 0;
    let totalObservations = 0;
    const multiMemberEntities = new Set<number>();
    let multiMembershipAssignments = 0;

    const noteMultiMembership = (titleIndex: number, count: number): void => {
      if (count <= 1 || multiMemberEntities.has(titleIndex)) return;
      multiMemberEntities.add(titleIndex);
      multiMembershipAssignments += count;
    };

    if (measure.grain === "title") {
      // Titles are the facts. `observations` counts titles, so a guard reads the same
      // quantity the measure is built from.
      for (let t = 0; t < store.titles.id.length; t++) {
        if (!keep(t, null)) continue;
        totalObservations += 1;
        const placed = placement(t, null);
        if (placed === null) {
          unplacedEntities.add(t);
          unplacedObservations += 1;
          continue;
        }
        noteMultiMembership(t, placed.length);
        for (const member of placed) {
          member.observations += 1;
          if (needsTitles) {
            member.distinctTitles ??= new Set<number>();
            member.distinctTitles.add(t);
          }
        }
      }
    } else {
      // Ratings are the facts. A title member exists whether or not anything rated it.
      if (breakdown === "title") {
        for (let t = 0; t < store.titles.id.length; t++) {
          if (keep(t, null)) ensure(store.titles.name[t]!, store.titles.id[t]!, false);
        }
      } else if (breakdown === undefined) {
        ensure(null, 0, false);
      }

      for (let i = 0; i < inScope.length; i++) {
        const position = inScope[i]!;
        const titleIndex = store.ratings.titleIndex[position]!;
        const at = store.ratings.at[position]!;
        if (!keep(titleIndex, at)) continue;
        totalObservations += 1;

        const placed = placement(titleIndex, at);
        if (placed === null) {
          unplacedEntities.add(titleIndex);
          unplacedObservations += 1;
          continue;
        }
        noteMultiMembership(titleIndex, placed.length);

        const value = store.ratings.valueScaled[position]!;
        const viewer = store.ratings.viewerId[position]!;
        for (const member of placed) {
          member.observations += 1;
          member.sumScaled += value;
          if (value >= FOUR_STARS_SCALED) member.atLeastFour += 1;
          if (needsViewers) {
            member.distinctViewers ??= new Set<number>();
            member.distinctViewers.add(viewer);
          }
        }
      }
    }

    const out: AggregatedMember[] = [];
    for (const member of members.values()) {
      out.push({
        key: member.key,
        memberId: member.memberId,
        uncategorised: member.uncategorised,
        observations: member.observations,
        ...exactValue(spec.measure, member),
      });
    }

    return {
      scale: measure.scale,
      members: out,
      totalObservations,
      totalMembers: out.length,
      unplaced: { members: unplacedEntities.size, observations: unplacedObservations },
      multiMembership: multiValued
        ? { entities: multiMemberEntities.size, assignments: multiMembershipAssignments }
        : null,
    };
  }
}

/**
 * The exact rational the measure's **scaled** value equals. Integers only.
 *
 * `avg_rating` is Σhundredths / count — the pair, never the quotient, so the engine does
 * the one division and every adapter divides identically. A member with no observations
 * yields `0/1`; it is only reachable with `exclude_unrated` turned off, and the trust
 * report's coverage is what says so.
 */
function exactValue(measure: string, member: Accumulator): { numerator: number; denominator: number } {
  const denominator = Math.max(member.observations, 1);
  switch (measure) {
    case "avg_rating":
      return { numerator: member.sumScaled, denominator };
    case "rating_count":
      return { numerator: member.observations, denominator: 1 };
    case "viewer_count":
      return { numerator: member.distinctViewers?.size ?? 0, denominator: 1 };
    case "title_count":
      return { numerator: member.distinctTitles?.size ?? 0, denominator: 1 };
    case "share_rated_4_plus":
      return { numerator: SHARE_SCALE * member.atLeastFour, denominator };
    default:
      return { numerator: 0, denominator: 1 };
  }
}
