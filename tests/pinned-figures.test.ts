import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { parseCsv } from "../src/server/ingest/csv.ts";
import {
  UNCATEGORISED_MARKER,
  buildStore,
  parseReleaseYear,
  toScaledInt,
} from "../src/server/ingest/build-store.ts";
import { MOVIELENS_DELIVERY, readPayload } from "../src/server/ingest/read-payload.ts";
import { ReceivedPayloadSchema, type ReceivedPayload } from "../src/server/ingest/payload.ts";
import {
  RATING_SCALE,
  YEAR_UNKNOWN,
  isoToUnixSeconds,
  ratingsAsOf,
  readStore,
  writeStore,
  type Store,
} from "../src/server/ingest/store.ts";

/**
 * The pinned figures.
 *
 * These are **regression tests on the ETL**, not decoration (`AGENTS.md`, "Data and
 * pinned figures"). A change in one means the ETL changed, and the thing to do is
 * investigate rather than update the expectation. The research found a real CRLF defect
 * exactly this way, and §"the CRLF defect" below is that finding kept executable.
 *
 * Every figure is asserted **with its definition, its guards in effect and its as-of**,
 * because a bare number is a claim and this project's whole argument is against those.
 *
 * - **Definition** — spelled out in each block, and computed from the store rather than
 *   quoted, so a definition that drifts fails here.
 * - **Guards in effect: none, in every case.** Guards belong to the engine and arrive in
 *   the spec (build-spec §3 GA-02 must-not). `it("no guard is in effect")` below asserts
 *   that concretely: at the store's as-of the whole log is in scope and nothing is
 *   excluded. Every figure is computed over that same unfiltered set.
 * - **As-of** — `AS_OF`, the store's own explicit as-of point, asserted non-null and
 *   equal to the delivery's `receivedAt`.
 */

const DATA_DIR = join(import.meta.dirname, "..", "data");

/** The store's as-of: when the partner delivered this payload. */
const AS_OF = MOVIELENS_DELIVERY.receivedAt;
const AS_OF_SECONDS = isoToUnixSeconds(AS_OF);

/** Guards in effect for every figure in this file. The engine owns guards; ingest has none. */
const GUARDS_IN_EFFECT: readonly string[] = [];

const payload = readPayload(DATA_DIR);
const built = buildStore([payload]);
const store = built.store;

const tempDirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ga-store-"));
  tempDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Observations per title at `asOfSeconds`, with no guard applied: the count and the sum
 * of the scaled values. Everything below is derived from this, so the definition of
 * "the ratings behind a title" is written once.
 */
function titleObservations(s: Store, asOfSeconds: number) {
  const count = new Int32Array(s.titles.id.length);
  // Integers all the way through, as the store holds them. The largest per-title sum is
  // 329 ratings x 500, so nothing here needs — or is allowed — a float.
  const sumScaled = new Int32Array(s.titles.id.length);
  for (const position of ratingsAsOf(s, asOfSeconds)) {
    const title = s.ratings.titleIndex[position]!;
    count[title] = count[title]! + 1;
    sumScaled[title] = sumScaled[title]! + s.ratings.valueScaled[position]!;
  }
  return { count, sumScaled };
}

const observations = titleObservations(store, AS_OF_SECONDS);

describe("the delivery", () => {
  it("is one received payload, carrying an explicit as-of point", () => {
    expect(store.manifest.payloads).toHaveLength(1);
    expect(store.manifest.payloads[0]).toMatchObject({
      payloadId: MOVIELENS_DELIVERY.payloadId,
      sourceId: MOVIELENS_DELIVERY.sourceId,
      receivedAt: AS_OF,
    });
    // Non-null by construction: an implicit "now" is what makes a past answer
    // unre-runnable (architecture §2, `resolvedAsOf`).
    expect(store.manifest.asOf).toBe(AS_OF);
    expect(store.manifest.lastEventAt).toBe("2018-09-24T14:27:30.000Z");
    expect(store.manifest.firstEventAt).toBe("1996-03-29T18:36:55.000Z");
  });

  it("prints 9742 titles · 100836 ratings · 610 viewers", () => {
    // The line `npm run ingest` writes, asserted here so the script's output and the
    // store cannot drift apart.
    expect(store.manifest.counts.titles).toBe(9742);
    expect(store.manifest.counts.ratings).toBe(100836);
    expect(store.manifest.counts.viewers).toBe(610);
    expect(store.manifest.counts.tags).toBe(3683);
  });

  it("no guard is in effect — the whole log is in scope at the as-of", () => {
    expect(GUARDS_IN_EFFECT).toEqual([]);
    expect(ratingsAsOf(store, AS_OF_SECONDS)).toHaveLength(100836);
    // Nothing in the store names a guard, a threshold or an exclusion.
    expect(Object.keys(store.manifest)).not.toContain("guards");
  });
});

describe("the pinned figures", () => {
  it("296 titles average a perfect 5.00, and none of them has more than 2 ratings", () => {
    // Definition: titles whose mean of every rating at or before AS_OF is exactly 5.00.
    // Guards: none. As-of: AS_OF.
    let perfect = 0;
    let mostObservations = 0;
    for (let t = 0; t < store.titles.id.length; t += 1) {
      const n = observations.count[t]!;
      if (n === 0) continue;
      if (observations.sumScaled[t]! === n * 5 * RATING_SCALE) {
        perfect += 1;
        mostObservations = Math.max(mostObservations, n);
      }
    }
    expect(perfect).toBe(296);
    expect(mostObservations).toBe(2);
  });

  it("8,427 of 9,724 rated titles carry fewer than 20 ratings", () => {
    // Definition: of the titles with at least one rating at or before AS_OF, those with
    // fewer than 20. Guards: none — 20 is the figure being measured, not a filter being
    // applied. As-of: AS_OF.
    let rated = 0;
    let thin = 0;
    for (let t = 0; t < store.titles.id.length; t += 1) {
      const n = observations.count[t]!;
      if (n === 0) continue;
      rated += 1;
      if (n < 20) thin += 1;
    }
    expect(rated).toBe(9724);
    expect(thin).toBe(8427);
    expect(((thin / rated) * 100).toFixed(1)).toBe("86.7");
  });

  it("18 titles have never been rated", () => {
    // Definition: declared titles with no rating at or before AS_OF. Guards: none.
    const never = [...observations.count].filter((n) => n === 0).length;
    expect(never).toBe(18);
    expect(never + 9724).toBe(store.manifest.counts.titles);
  });

  it("34 titles carry no genres", () => {
    // Definition: titles the partner delivered with the `(no genres listed)` marker,
    // which resolves to zero genres rather than to a twentieth genre. Guards: none.
    let uncategorised = 0;
    for (let t = 0; t < store.titles.id.length; t += 1) {
      if (store.titles.genreOffset[t + 1]! === store.titles.genreOffset[t]!) uncategorised += 1;
    }
    expect(uncategorised).toBe(34);
    expect(store.manifest.counts.uncategorisedTitles).toBe(34);

    // The same 34 counted at the source, so the store's definition cannot quietly
    // diverge from the marker the partner actually sent.
    const movies = parseCsv(readFileSync(join(DATA_DIR, "movies.csv"), "utf8"));
    const marked = movies.rows.filter((row) => row[2] === UNCATEGORISED_MARKER).length;
    expect(marked).toBe(34);
  });

  it("13 titles have no parseable release year", () => {
    // Definition: titles whose delivered name does not end in a four-digit year in
    // parentheses. Guards: none.
    const undated = [...store.titles.year].filter((y) => y === YEAR_UNKNOWN).length;
    expect(undated).toBe(13);
    expect(store.manifest.counts.undatedTitles).toBe(13);

    // The rule is strict on purpose. This title carries a year *range* with an en-dash,
    // and a looser rule would silently file it under 2006 — the coercion invariant 4
    // exists to prevent.
    expect(parseReleaseYear("Death Note: Desu nôto (2006–2007)")).toBeNull();
    expect(parseReleaseYear("Toy Story (1995)")).toBe(1995);
    expect(parseReleaseYear("Babylon 5")).toBeNull();
  });

  it("averages 2.27 genres per title with exclude_uncategorised on, and 2.26 with it off", () => {
    // Both, deliberately. The numerator is the same 22,050 real genre assignments; only
    // the population changes, and the off reading — dividing by every title, including
    // the 34 that carry none — is the one the most natural implementation writes. A team
    // that pinned only 2.27 would read 2.26 as an ETL regression on day one.
    const assignments = store.titles.genreValue.length;
    const titles = store.manifest.counts.titles;
    const categorised = titles - store.manifest.counts.uncategorisedTitles;

    expect(assignments).toBe(22050);
    expect(categorised).toBe(9708);

    const excludeUncategorisedOn = assignments / categorised;
    const excludeUncategorisedOff = assignments / titles;

    expect(excludeUncategorisedOn.toFixed(2)).toBe("2.27");
    expect(excludeUncategorisedOff.toFixed(2)).toBe("2.26");
    // Pinned past the rounding, so a drift that survives `toFixed` still fails.
    expect(excludeUncategorisedOn.toFixed(4)).toBe("2.2713");
    expect(excludeUncategorisedOff.toFixed(4)).toBe("2.2634");
  });
});

describe("the CRLF defect", () => {
  // All four supplied files terminate lines with `\r\n` (measured). This is the one that
  // switches a guard off silently rather than loudly, so it gets two assertions: what
  // the correct reading gives, and what the naive one would have.

  it("the store declares 19 genres, IMAX among them", () => {
    expect(store.manifest.genres).toHaveLength(19);
    expect(store.manifest.genres).toContain("IMAX");
    expect(store.manifest.genres).not.toContain(UNCATEGORISED_MARKER);
    expect(store.manifest.genres.some((g) => g.includes("\r"))).toBe(false);
  });

  it("an unstripped parse yields 38 genres, and loses IMAX entirely", () => {
    // What a reader that treats only `\n` as the terminator sees: every genre that falls
    // last in its row forks into a `\r`-suffixed twin.
    const naive = parseCsv(readFileSync(join(DATA_DIR, "movies.csv"), "utf8"), {
      lineEndings: "lf",
    });
    const tokens = new Set<string>();
    for (const row of naive.rows) {
      for (const token of row[2]!.split("|")) if (token !== "") tokens.add(token);
    }

    // 38 counts every distinct token, the `(no genres listed)\r` marker included — a
    // naive parse is naive about the marker too. Excluding the marker's variants for a
    // like-for-like comparison with the shipped 19 gives 37.
    expect(tokens.size).toBe(38);
    const withoutMarker = [...tokens].filter((t) => t.replace("\r", "") !== UNCATEGORISED_MARKER);
    expect(withoutMarker).toHaveLength(37);

    // The damage is not only duplication. IMAX is always last in its genre list, so
    // under an unstripped parse the genre does not exist under its own name at all.
    expect(tokens.has("IMAX")).toBe(false);
    expect(tokens.has("IMAX\r")).toBe(true);
    expect(tokens.has("Drama")).toBe(true);
    expect(tokens.has("Drama\r")).toBe(true);
  });

  it("is caught at the payload boundary rather than counted later", () => {
    // Every file's last column ends up `\r`-suffixed, so the column lookup fails by name
    // before a single row is read — on `links.csv`, which the reader reaches first.
    // The count of 38 above is what it would have cost had nothing failed.
    let thrown: unknown;
    try {
      readPayload(DATA_DIR, { lineEndings: "lf" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/links\.csv has no column "tmdbId"/);
    // The header is escaped in the message, so the invisible character that caused this
    // is visible in it. Unescaped, the message names a column it appears to list.
    expect(message).toContain(String.raw`"tmdbId\r"`);
  });

  it("keeps a quoted field's contents intact", () => {
    // 2,079 titles contain a comma and one contains an escaped double quote. A
    // `replace(/\r\n/g, "\n")` pass over the text would also edit line endings inside
    // quoted fields, so the stripping lives in the scanner instead.
    const names = new Set(store.titles.name);
    expect(names.has("American President, The (1995)")).toBe(true);
    expect(names.has('11\'09"01 - September 11 (2002)')).toBe(true);
    expect(store.titles.name.some((n) => n.includes("\r"))).toBe(false);
  });
});

describe("the received payload", () => {
  it("rejects a payload missing a required field, naming it in the error path", () => {
    const body = structuredClone(payload) as Record<string, unknown> & {
      ratings: Partial<ReceivedPayload["ratings"][number]>[];
    };
    body.ratings = [{ viewerId: 1, titleId: 1, rating: 4 }]; // no `at`

    const result = ReceivedPayloadSchema.safeParse(body);
    expect(result.success).toBe(false);
    if (result.success) return;
    // Asserted on the error, not merely on a throw: the path is what tells a partner
    // which field of which record they left out.
    expect(result.error.issues.map((i) => i.path)).toContainEqual(["ratings", 0, "at"]);
  });

  it("names a missing envelope field the same way", () => {
    const { receivedAt: _omitted, ...withoutReceivedAt } = payload;
    const result = ReceivedPayloadSchema.safeParse(withoutReceivedAt);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path)).toContainEqual(["receivedAt"]);
  });
});

describe("the store is append-only", () => {
  const laterDelivery: ReceivedPayload = {
    sourceId: MOVIELENS_DELIVERY.sourceId,
    payloadId: "ml-latest-small-2019-01-01",
    schemaVersion: 1,
    receivedAt: "2019-01-01T00:00:00.000Z",
    titles: [
      { titleId: 999_999, title: "A Later Title (2019)", genres: ["Drama"], imdbId: null, tmdbId: null },
    ],
    ratings: [
      { viewerId: 1, titleId: 999_999, rating: 4.5, at: isoToUnixSeconds("2018-12-31T00:00:00.000Z") },
      // Deliberately *earlier* than the first payload's last event: a late arrival is
      // the case the log has to survive without touching anything already written.
      { viewerId: 2, titleId: 1, rating: 3.5, at: isoToUnixSeconds("2001-01-01T00:00:00.000Z") },
    ],
    tags: [],
  };

  it("a second payload extends the log and changes nothing already written", () => {
    const extended = buildStore([payload, laterDelivery]);
    const before = built.columns;
    const after = extended.columns;

    const first = store.ratings.at.length;
    expect(after.ratingAt.length).toBe(first + 2);

    // Every record the first payload wrote is byte-identical at the same position.
    for (const column of ["ratingViewerId", "ratingTitleIndex", "ratingValueScaled", "ratingAt"] as const) {
      expect([...after[column].subarray(0, first)]).toEqual([...before[column].subarray(0, first)]);
    }

    // Ordering is an index over immutable records, so the late arrival lands in the
    // middle of the event-time index while its record sits at the end of the log.
    expect(after.ratingByEventTime.length).toBe(first + 2);
    const lateAt = isoToUnixSeconds("2001-01-01T00:00:00.000Z");
    const lateLogPosition = after.ratingByEventTime.indexOf(first + 1);
    expect(lateLogPosition).toBeGreaterThan(0);
    expect(lateLogPosition).toBeLessThan(first);
    expect(after.ratingAt[first + 1]).toBe(lateAt);

    expect(extended.manifest.payloads).toHaveLength(2);
    expect(extended.manifest.payloads[1]).toMatchObject({
      payloadId: laterDelivery.payloadId,
      firstRatingSeq: first,
      ratingCount: 2,
    });
    // The store's as-of moves with the latest delivery, not with the latest event.
    expect(extended.manifest.asOf).toBe("2019-01-01T00:00:00.000Z");
    expect(extended.manifest.lastEventAt).toBe("2018-12-31T00:00:00.000Z");
  });

  it("recognises a replayed payload instead of applying it twice", () => {
    const replayed = buildStore([payload, payload]);
    expect(replayed.skipped).toEqual([MOVIELENS_DELIVERY.payloadId]);
    expect(replayed.manifest.counts.ratings).toBe(100836);
    expect(replayed.manifest.payloads).toHaveLength(1);
  });

  it("refuses to correct a title in place", () => {
    const corrected: ReceivedPayload = {
      ...laterDelivery,
      payloadId: "correction",
      titles: [{ titleId: 1, title: "Toy Story (1996)", genres: [], imdbId: null, tmdbId: null }],
      ratings: [],
    };
    expect(() => buildStore([payload, corrected])).toThrowError(/redeclares title 1/);
  });
});

describe("every measure is a scaled integer", () => {
  it("stores ratings as hundredths in an integer column", () => {
    expect(store.manifest.scales.rating).toBe(RATING_SCALE);

    const dir = tempDir();
    writeStore(dir, built.manifest, built.strings, built.columns);
    const column = readStore(dir).manifest.columns.find((c) => c.name === "ratingValueScaled");
    // Structural, not incidental: a float column would change this to "f64".
    expect(column?.dtype).toBe("i16");

    const values = new Set(store.ratings.valueScaled);
    expect([...values].sort((a, b) => a - b)).toEqual([50, 100, 150, 200, 250, 300, 350, 400, 450, 500]);
  });

  it("rejects a value that does not land on the declared scale rather than rounding it", () => {
    expect(toScaledInt(4.5, RATING_SCALE, "test")).toBe(450);
    expect(toScaledInt(4.47, RATING_SCALE, "test")).toBe(447);
    expect(() => toScaledInt(4.475, RATING_SCALE, "test")).toThrowError(/does not land on the declared scale/);
  });
});

describe("the as-of replay", () => {
  it("answers as of 2007-08-02 from the same store", () => {
    // The point of the append-only log: a past as-of is a prefix of the event-time
    // index, not a different store.
    const past = isoToUnixSeconds("2007-08-02T00:00:00.000Z");
    const included = ratingsAsOf(store, past);
    expect(included).toHaveLength(50266);

    for (const position of included) expect(store.ratings.at[position]!).toBeLessThanOrEqual(past);
    const next = store.ratings.byEventTime[included.length]!;
    expect(store.ratings.at[next]!).toBeGreaterThan(past);

    // A strict prefix of the full index, so the replay reads the same records in the
    // same order rather than re-deriving them.
    const full = ratingsAsOf(store, AS_OF_SECONDS);
    expect([...included]).toEqual([...full.subarray(0, included.length)]);
  });
});

describe("the store round-trips", () => {
  it("reads back exactly what it wrote", () => {
    const dir = tempDir();
    writeStore(dir, built.manifest, built.strings, built.columns);
    const reloaded = readStore(dir);

    expect(reloaded.manifest.counts).toEqual(store.manifest.counts);
    expect(reloaded.manifest.genres).toEqual(store.manifest.genres);
    expect(reloaded.manifest.asOf).toBe(store.manifest.asOf);
    expect([...reloaded.ratings.valueScaled]).toEqual([...store.ratings.valueScaled]);
    expect([...reloaded.ratings.at]).toEqual([...store.ratings.at]);
    expect([...reloaded.titles.year]).toEqual([...store.titles.year]);
    expect([...reloaded.titles.genreValue]).toEqual([...store.titles.genreValue]);
    expect(reloaded.titles.name).toEqual(store.titles.name);
    expect(reloaded.tags.texts).toEqual(store.tags.texts);
  });
});
