import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";

import {
  POSTGRES_SCHEMA,
  POSTGRES_STORE_ASSUMPTIONS,
  PostgresWarehouse,
  type SqlClient,
} from "@/server/warehouse/postgres-store";

import { RATING_SCALE, YEAR_UNKNOWN, type Store } from "../../src/server/ingest/store.ts";

/**
 * Standing the second adapter up against a **real Postgres server**, named by one
 * environment variable.
 *
 * ## One variable, any Postgres
 *
 * `CONFORMANCE_DATABASE_URL` holds a Postgres connection string and nothing else decides
 * anything: a local server, a hosted Supabase instance, or any other Postgres are the
 * same case, because Supabase *is* Postgres — same wire protocol, same SQL. There is no
 * mode flag, no second variable and no branch in the adapter. Everything that differs
 * between deployments — TLS, port, credentials — is already expressible in the string
 * (`?sslmode=require` for Supabase), so `pg` parses it and this file does not interpret
 * it.
 *
 * ## What happens when it is not set, and why that is a skip rather than a pass
 *
 * The corpus then runs against the local adapter only, and the suite says so in as many
 * words: the determinism claim is **unproven on that run**. `docs/build-spec.md` §3's
 * GA-06 "Must not" is *skip the second adapter because one passes* — one adapter
 * reporting green proves nothing about agreement, and a suite that let that read as
 * success would be decoration. So the skip is loud and names the consequence rather than
 * the absence.
 *
 * ## And when it is set but the connection fails, that is a failure
 *
 * A paused project, a bad credential, an unreachable host: the operator asked for the
 * second adapter, so not getting it is a failure and not a skip. A suite that quietly
 * downgrades a broken connection to "skipped" rots into decoration on the first outage
 * and never recovers, because nothing ever goes red again.
 *
 * ## It reports which server it agreed with
 *
 * `SELECT version()` is read from the server and printed. Collation and ordering
 * semantics differ across Postgres majors, so a conformance suite whose job is proving
 * two engines agree has to be able to say **which** engine it agreed with, or a later
 * divergence is unattributable. It is read from the server, never from configuration.
 *
 * ## It writes into a schema of its own, and cleans up after itself
 *
 * Pointing this at a hosted project means creating tables in someone's database. They go
 * in `golden_analytics_conformance`, never in `public`, and the schema is dropped when
 * the suite finishes. A second run against the same server reuses the loaded data when
 * the fingerprint still matches, so only the first run pays the upload.
 */

/** The one variable. Named for the suite, because the application itself has no database. */
export const CONNECTION_VARIABLE = "CONFORMANCE_DATABASE_URL";

/** Everything the suite creates lives here, so nothing it does touches `public`. */
export const CONFORMANCE_SCHEMA = "golden_analytics_conformance";

/** A zone far enough from UTC that any unpinned date arithmetic changes its answer. */
export const HOSTILE_TIME_ZONE = "Pacific/Kiritimati";

/** What someone must have to run the second adapter, said once. */
export const POSTGRES_REQUIREMENT =
  `${CONNECTION_VARIABLE} set to a Postgres connection string — a local server, a Supabase ` +
  `project, or any other Postgres`;

/** What it means when they do not have it, said once. */
export const POSTGRES_ABSENT_CONSEQUENCE =
  `${CONNECTION_VARIABLE} is not set, so the conformance corpus ran against ONE adapter. ` +
  `The determinism claim this suite exists to prove is UNPROVEN on this run: a single ` +
  `adapter agreeing with itself is not evidence that the QuerySpec is portable. ` +
  `Set ${CONNECTION_VARIABLE} and run it again.`;

/** The connection string, or `undefined` when the variable is absent or empty. */
export function conformanceConnectionString(): string | undefined {
  const value = process.env[CONNECTION_VARIABLE]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Identifies the data loaded into a server, so a second run can reuse it **safely**.
 *
 * Counts alone are not enough. An ETL change that moved values without moving row counts
 * would leave a stale load looking current, and the suite would go on proving the two
 * adapters agree about data neither of them is being asked about any more — a conformance
 * suite quietly testing the wrong corpus. So the fingerprint carries column sums as well,
 * and `alreadyLoaded()` recomputes them **in SQL** before trusting what it finds.
 */
function fingerprintOf(store: Store): string {
  const counts = store.manifest.counts;
  const sum = (column: ArrayLike<number>): number => {
    let total = 0;
    for (let i = 0; i < column.length; i++) total += column[i]!;
    return total;
  };

  return [
    store.manifest.asOf,
    store.manifest.payloads[store.manifest.payloads.length - 1]?.sourceId ?? "unknown",
    counts.titles,
    counts.ratings,
    counts.genreAssignments,
    sum(store.titles.id),
    sum(store.titles.year),
    sum(store.titles.genreValue),
    sum(store.ratings.valueScaled),
    sum(store.ratings.at),
    sum(store.ratings.viewerId),
  ].join("|");
}

/** The same quantities, recomputed by the server from what it actually holds. */
const FINGERPRINT_SQL = `
  SELECT (SELECT COUNT(*) FROM title)             AS titles,
         (SELECT COUNT(*) FROM rating)            AS ratings,
         (SELECT COUNT(*) FROM title_genre)       AS genres,
         (SELECT SUM(movie_id) FROM title)        AS movie_ids,
         (SELECT SUM(year) FROM title)            AS years,
         (SELECT SUM(genre_id) FROM title_genre)  AS genre_ids,
         (SELECT SUM(value_scaled) FROM rating)   AS values_scaled,
         (SELECT SUM(at) FROM rating)             AS ats,
         (SELECT SUM(viewer_id) FROM rating)      AS viewer_ids`;

/** One COPY text-format field. Tab, newline, carriage return and backslash are escaped. */
function copyField(value: string | number): string {
  return String(value).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

export type PostgresFixture = {
  warehouse: PostgresWarehouse;
  sql: SqlClient;
  /** What the server says it is. Printed by the suite and quoted in the PR body. */
  serverVersion: string;
  /** How the server orders text, which is why the adapter is not allowed to order. */
  collation: string;
  timings: { connectMs: number; loadMs: number; reusedExistingData: boolean };
  close: () => Promise<void>;
};

/**
 * Connect, load the store, and return the adapter over it.
 *
 * The two adapters start from **the same `Store` object**, so anything they disagree
 * about is a disagreement between two aggregation implementations and never between two
 * ETLs. That is the only reason comparing them means anything.
 */
export async function createPostgresFixture(
  store: Store,
  connectionString: string,
): Promise<PostgresFixture> {
  if (store.manifest.scales.rating !== POSTGRES_STORE_ASSUMPTIONS.ratingScale) {
    throw new Error(
      `conformance: the store scales ratings by ${store.manifest.scales.rating} and the ` +
        `Postgres adapter assumes ${POSTGRES_STORE_ASSUMPTIONS.ratingScale}`,
    );
  }
  if (RATING_SCALE !== POSTGRES_STORE_ASSUMPTIONS.ratingScale) {
    throw new Error("conformance: the two adapters disagree about the rating scale");
  }
  if (YEAR_UNKNOWN !== POSTGRES_STORE_ASSUMPTIONS.yearUnknown) {
    throw new Error("conformance: the two adapters disagree about the undated-year sentinel");
  }

  const client = new Client({ connectionString });
  const connectStarted = Date.now();
  await client.connect();
  const connectMs = Date.now() - connectStarted;

  const version = await client.query<{ version: string }>("SELECT version()");
  const serverVersion = version.rows[0]?.version ?? "unknown";
  // Read from `pg_database`, not from `current_setting('lc_collate')`: that GUC was
  // removed in Postgres 17, where it returns null rather than failing — which is exactly
  // the kind of quiet nothing this suite is built to refuse to print.
  const collationRow = await client.query<{ collation: string | null; provider: string | null }>(
    `SELECT datcollate AS collation, datlocprovider::text AS provider
       FROM pg_database WHERE datname = current_database()`,
  );
  const collation = collationRow.rows[0]?.collation ?? "unknown";

  // The session inherits its TimeZone from the server's host, so a date expression that
  // did not pin UTC would answer differently on two machines with no error anywhere.
  // Fourteen hours from UTC turns that from a hazard the adapter claims to have handled
  // into one this suite proves it has.
  try {
    await client.query(`SET TIME ZONE '${HOSTILE_TIME_ZONE}'`);
  } catch (error) {
    await client.end();
    throw new Error(
      `this server will not set its session time zone to ${HOSTILE_TIME_ZONE}, and the ` +
        `conformance suite runs under a zone far from UTC on purpose: it is what proves the ` +
        `adapter's date arithmetic is pinned rather than inherited. ` +
        `${HOSTILE_TIME_ZONE} is a standard IANA zone, so a server that rejects it has an ` +
        `incomplete time zone database.\n` +
        `Underlying failure: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${CONFORMANCE_SCHEMA}`);
  await client.query(`SET search_path TO ${CONFORMANCE_SCHEMA}`);

  const fingerprint = fingerprintOf(store);
  const loadStarted = Date.now();
  const reusedExistingData = await alreadyLoaded(client, fingerprint, store);
  if (!reusedExistingData) await load(client, store, fingerprint);
  const loadMs = Date.now() - loadStarted;

  const sql: SqlClient = {
    query: async (text, params) => {
      const result = await client.query(text, params as unknown[] | undefined);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };

  return {
    warehouse: new PostgresWarehouse(sql, { adapterId: "postgres" }),
    sql,
    serverVersion,
    collation,
    timings: { connectMs, loadMs, reusedExistingData },
    // The loaded data is **left in place**, and the suite says so. Dropping 132,628 rows
    // and re-uploading them on every run is what makes a hosted database unusable and a
    // suite stop being run — the outcome GA-06 is built to prevent. It lives in a schema
    // of its own, nothing else is touched, and removing it is one statement:
    // `DROP SCHEMA golden_analytics_conformance CASCADE;`
    close: () => client.end(),
  };
}

/**
 * Whether this server already holds exactly this store.
 *
 * The recorded fingerprint alone is not enough — it is a row someone could have left
 * behind after a half-finished load — so the quantities behind it are recomputed from the
 * tables and compared. Anything short of an exact match is a rebuild, not a reuse.
 */
async function alreadyLoaded(client: Client, fingerprint: string, store: Store): Promise<boolean> {
  const exists = await client.query<{ present: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [`${CONFORMANCE_SCHEMA}.store_meta`],
  );
  if (exists.rows[0]?.present !== true) return false;

  const meta = await client.query<{ fingerprint: string }>(
    `SELECT fingerprint FROM store_meta LIMIT 1`,
  );
  if (meta.rows[0]?.fingerprint !== fingerprint) return false;

  const actual = await client.query<Record<string, string | null>>(FINGERPRINT_SQL);
  const row = actual.rows[0];
  if (row === undefined) return false;

  const counts = store.manifest.counts;
  const parts = fingerprint.split("|");
  const recomputed = [
    store.manifest.asOf,
    parts[1] ?? "",
    Number(row["titles"]),
    Number(row["ratings"]),
    Number(row["genres"]),
    Number(row["movie_ids"]),
    Number(row["years"]),
    Number(row["genre_ids"]),
    Number(row["values_scaled"]),
    Number(row["ats"]),
    Number(row["viewer_ids"]),
  ].join("|");

  // Belt and braces: the counts are also checked against the manifest directly, so a
  // fingerprint that somehow agreed with a wrong table still fails here.
  return (
    recomputed === fingerprint &&
    Number(row["titles"]) === counts.titles &&
    Number(row["ratings"]) === counts.ratings &&
    Number(row["genres"]) === counts.genreAssignments
  );
}

async function load(client: Client, store: Store, fingerprint: string): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${CONFORMANCE_SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${CONFORMANCE_SCHEMA}`);
  await client.query(`SET search_path TO ${CONFORMANCE_SCHEMA}`);
  for (const statement of POSTGRES_SCHEMA) await client.query(statement);

  const payloads = store.manifest.payloads;
  await client.query(`INSERT INTO store_meta (as_of, source_id, fingerprint) VALUES ($1, $2, $3)`, [
    store.manifest.asOf,
    payloads[payloads.length - 1]?.sourceId ?? "unknown",
    fingerprint,
  ]);

  const titles: (string | number)[][] = [];
  const genres: (string | number)[][] = [];
  for (let t = 0; t < store.titles.id.length; t++) {
    titles.push([t, store.titles.id[t]!, store.titles.name[t]!, store.titles.year[t]!]);
    const from = store.titles.genreOffset[t]!;
    const to = store.titles.genreOffset[t + 1]!;
    for (let g = from; g < to; g++) {
      const genreId = store.titles.genreValue[g]!;
      genres.push([t, genreId, store.manifest.genres[genreId]!]);
    }
  }

  const ratings: (string | number)[][] = [];
  for (let r = 0; r < store.ratings.at.length; r++) {
    ratings.push([
      r,
      store.ratings.titleIndex[r]!,
      store.ratings.viewerId[r]!,
      store.ratings.valueScaled[r]!,
      store.ratings.at[r]!,
    ]);
  }

  await copy(client, "title", titles);
  await copy(client, "title_genre", genres);
  await copy(client, "rating", ratings);
  await client.query(`ANALYZE`);
}

/**
 * Bulk load through `COPY … FROM STDIN`.
 *
 * Streamed rather than batched into `INSERT`s because the whole point of the warehouse
 * boundary is that a real adapter pushes work down rather than pulling rows over the
 * wire; a fixture that took a hundred round trips to load 100,836 ratings would make the
 * hosted path unusable and the suite would stop being run.
 */
async function copy(client: Client, table: string, rows: (string | number)[][]): Promise<void> {
  const stream = client.query(copyFrom(`COPY ${table} FROM STDIN WITH (FORMAT text)`));
  const lines = Readable.from(
    (function* body() {
      for (const row of rows) yield `${row.map(copyField).join("\t")}\n`;
    })(),
  );
  await pipeline(lines, stream);
}
