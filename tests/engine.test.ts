import { deepStrictEqual } from "node:assert";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Provenance, QuerySpec, ResultSet, SemanticLayer } from "@/server/contracts";
import { materiallyDifferent } from "@/server/engine/compare";
import { ENGINE_VERSION, execute } from "@/server/engine/execute";
import { applyPatch } from "@/server/engine/amend";
import { compareExact, roundHalfTowardZero } from "@/server/engine/numbers";
import { resolveSpec } from "@/server/engine/resolve";
import { loadSemanticLayer } from "@/server/semantic/load";
import { LocalStoreWarehouse } from "@/server/warehouse/local-store";

import { buildStore } from "../src/server/ingest/build-store.ts";
import { YEAR_UNKNOWN, isoToUnixSeconds, ratingsAsOf } from "../src/server/ingest/store.ts";
import { readPayload } from "../src/server/ingest/read-payload.ts";
import type { ReceivedPayload } from "../src/server/ingest/payload.ts";

/**
 * The deterministic engine.
 *
 * This file is where the product's central claim is checked rather than asserted: every
 * number below comes from pure functions over the compiled store, with no model anywhere
 * near them (invariant 1), and the naive/honest catch falls out of a generic double-run
 * rather than a rule about this dataset (build-spec §3 GA-04, "Must not").
 *
 * Every case pins an explicit, non-null `asOf`. A result that cannot say which moment it
 * describes cannot be re-run, and re-running them is what the conformance suite does.
 */

const DATA_DIR = join(import.meta.dirname, "..", "data");
const payload = readPayload(DATA_DIR);
const warehouse = new LocalStoreWarehouse(buildStore([payload]).store);
const layer: SemanticLayer = loadSemanticLayer();

/** The hero moment's as-of (build-spec §3 GA-04). */
const HERO_AS_OF = "2018-09-25T00:00:00.000Z";
/** The replay as-of: the same question against a different moment (build-spec §1, target 14). */
const REPLAY_AS_OF = "2007-08-02T00:00:00.000Z";

const ALL_GUARDS = layer.guards.map((guard) => ({ id: guard.id, params: { ...guard.defaultParams } }));

function heroSpec(asOf: string, overrides: Partial<QuerySpec> = {}): QuerySpec {
  return {
    measure: "avg_rating",
    breakdown: "title",
    filters: [],
    sort: { by: "measure", dir: "desc", tieBreak: layer.defaultTieBreak },
    limit: 4,
    guards: ALL_GUARDS,
    asOf,
    ...overrides,
  };
}

function run(spec: QuerySpec, requestId = "req-test"): Promise<ResultSet> {
  return execute(spec, {
    warehouse,
    layer,
    requestId,
    computedAt: "2026-09-18T00:00:00.000Z",
  });
}

/** `title = value (n)`, the shape every done-criterion in the build spec is written in. */
function readable(result: ResultSet): string[] {
  return result.rows.map((row) => `${row.key} = ${row.value.toFixed(2)} (n=${row.n})`);
}

describe("the hero moment", () => {
  it("answers honestly: Streetcar 4.47 with n=20, not a title with one rating", async () => {
    const result = await run(heroSpec(HERO_AS_OF));

    expect(readable(result)).toEqual([
      "Streetcar Named Desire, A (1951) = 4.47 (n=20)",
      "Shawshank Redemption, The (1994) = 4.43 (n=317)",
      "Sunset Blvd. (a.k.a. Sunset Boulevard) (1950) = 4.33 (n=27)",
      "Philadelphia Story, The (1940) = 4.31 (n=29)",
    ]);
    // Provenance records which moment this describes, and it is never null.
    expect(result.provenance.resolvedAsOf).toBe(HERO_AS_OF);
    expect(result.provenance.engineVersion).toBe(ENGINE_VERSION);
  });

  /**
   * Streetcar's mean is **exactly 4.475** — 20 ratings summing to 8,950 hundredths — so it
   * sits precisely on the boundary between two presentation steps and there is no
   * arithmetically correct answer at two decimals, only a stated one. Four reasonable
   * implementations split two–two on it (see `engine/numbers.ts`). This asserts the rule
   * the engine states, so a later "tidy-up" to `Math.round` fails here rather than
   * silently moving the pinned hero figure.
   */
  it("rounds a true midpoint half toward zero, which is why 4.475 reads 4.47", () => {
    expect(roundHalfTowardZero(8950, 20)).toBe(447);
    expect(8950 / 20 / 100).toBeCloseTo(4.475, 10);
    // The two implementations that disagree, kept executable so the finding is not folklore.
    expect(Math.round(8950 / 20)).toBe(448);
    expect(new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(8950 / 20 / 100)).toBe(
      "4.48",
    );
  });

  it("ties 296 titles at 5.00 once the guards are emptied", async () => {
    const naiveSpec = heroSpec(HERO_AS_OF, { guards: [], limit: 120 });
    const result = await run(naiveSpec);

    // Every row the limit allows is a perfect five, and none of them is evidence.
    expect(result.rows.every((row) => row.value === 5)).toBe(true);
    expect(result.rows.every((row) => row.n <= 2)).toBe(true);

    // 296 is the count of *members*, which exceeds MAX_LIMIT — so it is counted from the
    // aggregation rather than from the returned rows.
    const aggregation = await warehouse.aggregate({ spec: naiveSpec, resolvedAsOf: HERO_AS_OF });
    const perfect = aggregation.members.filter(
      (member) => member.observations > 0 && roundHalfTowardZero(member.numerator, member.denominator) === 500,
    );
    expect(perfect).toHaveLength(296);

    /**
     * And the engine reports the same 296 on the comparison, so the surface never has
     * to count members it was not given.
     *
     * Asserted against the aggregation rather than against a literal: the two counts are
     * arrived at by different routes — one filters members on their rounded value, the
     * other walks the ordered list comparing exact rationals — so agreeing is evidence
     * rather than a restatement. A tie decided on the rounded value and a tie decided on
     * the exact one are the same tie here only because every one of these members is
     * exactly 5.
     */
    const guarded = await run(heroSpec(HERO_AS_OF));
    expect(guarded.trust.comparison?.tiedAtTop.naive).toBe(perfect.length);
  });

  /**
   * The tie-break test. 296 titles tie at exactly 5.00, so the ordering rule is the only
   * thing deciding which four appear — and it must decide the same way regardless of the
   * order the data arrived in.
   *
   * The shuffle is of the **payload**, so title indexes and rating log positions both
   * change. That is what makes the test meaningful: an adapter tie-breaking on a storage
   * position rather than on the partner's stable id would pass a reshuffle of one and fail
   * the other.
   */
  it("returns the same naive top four under three shuffles of the input order", async () => {
    const naiveSpec = heroSpec(HERO_AS_OF, { guards: [] });
    const baseline = readable(await run(naiveSpec));
    expect(baseline).toHaveLength(4);

    for (const seed of [1, 2, 3]) {
      const shuffled = new LocalStoreWarehouse(buildStore([shufflePayload(payload, seed)]).store);
      const result = await execute(naiveSpec, {
        warehouse: shuffled,
        layer,
        requestId: `shuffle-${seed}`,
        computedAt: "2026-09-18T00:00:00.000Z",
      });
      expect(readable(result), `shuffle seed ${seed}`).toEqual(baseline);
    }
  });

  it("surfaces the catch as a material comparison", async () => {
    const result = await run(heroSpec(HERO_AS_OF));

    expect(result.trust.comparison).not.toBeNull();
    expect(result.trust.comparison?.material).toBe(true);
    expect(result.trust.comparison?.naive[0]?.value).toBe(5);
    expect(result.trust.comparison?.honest[0]?.key).toBe("Streetcar Named Desire, A (1951)");

    /**
     * How wide the naive lead is — the figure the rows themselves cannot carry.
     *
     * `comparison.naive` is capped at `spec.limit`, so it can say the top of the
     * unchecked ranking is a tie and not that **296 members** are in it. That number is
     * the whole finding: a ranking whose lead is shared by 296 of the 9,742 declared
     * titles is not ranking anything, and it is what the catch block states on screen.
     *
     * It is counted on the ordering's primary key, so the honest side reports 1: nothing
     * ties with *A Streetcar Named Desire*, and the same count means two different
     * things on the two sides only because the data does.
     */
    expect(result.trust.comparison?.tiedAtTop).toEqual({ naive: 296, honest: 1 });

    // The guard that produced the catch says what it checked, and how much it left out.
    const minEvidence = result.trust.guardsApplied.find((guard) => guard.id === "min_evidence");
    expect(minEvidence?.params).toEqual({ minObservations: 20 });
    expect(minEvidence?.explanation).toContain("Checked how many ratings");
    expect(minEvidence?.excluded).toBeGreaterThan(0);
  });
});

describe("the as-of", () => {
  /**
   * The same question against a different moment gives a different, equally correct
   * answer. Chinatown (13,750/31) also displays 4.44 here and is ranked fourth, which is
   * only true because ordering compares the exact rational rather than the rounded value.
   */
  it("replays at 2007-08-02 against the full 2018 store", async () => {
    const result = await run(heroSpec(REPLAY_AS_OF, { limit: 3 }));

    expect(readable(result)).toEqual([
      "Shawshank Redemption, The (1994) = 4.46 (n=149)",
      "Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964) = 4.44 (n=43)",
      "Lawrence of Arabia (1962) = 4.44 (n=32)",
    ]);
    expect(result.provenance.resolvedAsOf).toBe(REPLAY_AS_OF);
  });

  it("resolves a null asOf to the store's own as-of and records it", async () => {
    const result = await run(heroSpec(HERO_AS_OF, { asOf: null }));

    expect(result.spec.asOf).toBeNull();
    expect(result.provenance.resolvedAsOf).toBe(await warehouse.latestAsOf());
    expect(result.provenance.resolvedAsOf).not.toBeNull();
  });
});

describe("determinism", () => {
  it("produces byte-identical rows and provenance but for requestId and computedAt", async () => {
    const spec = heroSpec(HERO_AS_OF);
    const first = await run(spec, "req-one");
    const second = await execute(spec, {
      warehouse,
      layer,
      requestId: "req-two",
      computedAt: "2027-01-01T00:00:00.000Z",
    });

    deepStrictEqual(first.rows, second.rows);
    deepStrictEqual(first.trust, second.trust);

    const stable = ({ requestId: _id, computedAt: _at, ...rest }: Provenance) => rest;
    deepStrictEqual(stable(first.provenance), stable(second.provenance));
    expect(first.provenance.requestId).not.toBe(second.provenance.requestId);
  });

  it("orders on the exact rational, never on the rounded value", () => {
    // Dr. Strangelove and Lawrence of Arabia both display 4.44 at the replay as-of.
    expect(compareExact({ numerator: 19100, denominator: 43 }, { numerator: 14200, denominator: 32 })).toBe(1);
    expect(roundHalfTowardZero(19100, 43)).toBe(roundHalfTowardZero(14200, 32));
  });
});

describe("materiality", () => {
  it("is true on the hero query and false on one no guard changes", async () => {
    const hero = await run(heroSpec(HERO_AS_OF));
    const naiveHero = await run(heroSpec(HERO_AS_OF, { guards: [] }));
    expect(
      materiallyDifferent(naiveHero.rows, hero.rows, layer.materiality.minValueDelta),
    ).toBe(true);

    // Counting ratings by the year they were given: every member clears every guard, so
    // emptying the guards changes nothing and there is nothing to show.
    const unchanged = heroSpec(HERO_AS_OF, {
      measure: "rating_count",
      breakdown: "rating_year",
      limit: 5,
    });
    const guarded = await run(unchanged);
    const unguarded = await run({ ...unchanged, guards: [] });

    expect(guarded.rows.length).toBe(5);
    expect(
      materiallyDifferent(unguarded.rows, guarded.rows, layer.materiality.minValueDelta),
    ).toBe(false);
    expect(guarded.trust.comparison).toBeNull();
  });

  it("reads its threshold from the layer, never from the engine", () => {
    const naive = [{ key: "a", value: 1.0, rawValue: 100, n: 10 }];
    const honest = [{ key: "a", value: 1.005, rawValue: 100, n: 10 }];

    expect(materiallyDifferent(naive, honest, 0.01)).toBe(false);
    expect(materiallyDifferent(naive, honest, 0.001)).toBe(true);
    expect(layer.materiality.minValueDelta).toBe(0.01);
  });
});

describe("the C4 disclosure", () => {
  /**
   * C4 settled that the thirteen undated titles are disclosed in the trust report rather
   * than given a fifth guard. **This is the whole evidence base for that decision**, kept
   * executable here so the next person to look at the undated titles does not re-measure
   * them — or add the fifth guard C4 declined:
   *
   * 13 undated titles, carrying **18 of 100,836 ratings (0.018%)**, and **none of them
   * clears `min_evidence ≥ 20`** — the largest carries 4 ratings. A guard would exclude
   * nothing the guards already in place do not, while diluting the four that carry the
   * hero moment.
   */
  it("puts the undated titles in the trust report's notes on a date breakdown", async () => {
    const spec = heroSpec(HERO_AS_OF, { breakdown: "release_year", limit: 5 });
    const result = await run(spec);

    expect(result.trust.notes).toContain(
      "13 items carrying 18 of 100,836 records have no release year and are left out of this breakdown.",
    );

    // The note's numbers are the adapter's own count of what the breakdown could not place.
    const aggregation = await warehouse.aggregate({ spec, resolvedAsOf: HERO_AS_OF });
    expect(aggregation.unplaced).toEqual({ members: 13, observations: 18 });
    expect(result.trust.coverage.totalObservations).toBe(100_836);

    // And none of the thirteen clears `min_evidence ≥ 20` — C4's arithmetic, measured
    // rather than quoted. The largest undated title carries 4 ratings.
    const store = warehouse.store;
    const undatedCounts = new Map<number, number>();
    for (let t = 0; t < store.titles.id.length; t++) {
      if (store.titles.year[t] === YEAR_UNKNOWN) undatedCounts.set(t, 0);
    }
    const inScope = ratingsAsOf(store, isoToUnixSeconds(HERO_AS_OF));
    for (let i = 0; i < inScope.length; i++) {
      const titleIndex = store.ratings.titleIndex[inScope[i]!]!;
      const seen = undatedCounts.get(titleIndex);
      if (seen !== undefined) undatedCounts.set(titleIndex, seen + 1);
    }

    expect(undatedCounts.size).toBe(13);
    expect([...undatedCounts.values()].reduce((a, b) => a + b, 0)).toBe(18);
    expect(Math.max(...undatedCounts.values())).toBe(4);
    const minObservations = layer.guards.find((guard) => guard.id === "min_evidence")
      ?.defaultParams["minObservations"];
    expect([...undatedCounts.values()].every((count) => count < minObservations!)).toBe(true);
  });

  it("declares the genre overlap rather than removing it", async () => {
    const result = await run(
      heroSpec(HERO_AS_OF, { measure: "rating_count", breakdown: "genre", limit: 5 }),
    );

    expect(result.trust.notes.some((note) => note.includes("belong to more than one genre"))).toBe(true);
  });
});

describe("amendment", () => {
  const parentProvenance: Provenance = {
    requestId: "parent",
    adapterId: "local-store",
    sourceId: "grouplens",
    layerVersion: layer.version,
    layerSchemaVersion: layer.schemaVersion,
    resolvedAsOf: "2018-09-26T00:00:00.000Z",
    engineVersion: ENGINE_VERSION,
    computedAt: "2026-09-18T00:00:00.000Z",
  };

  it("inherits the parent's resolvedAsOf when reAsOf is absent", () => {
    const parent = heroSpec(HERO_AS_OF, { asOf: null });
    const amended = applyPatch(parent, parentProvenance, {
      basedOn: "parent",
      addFilters: [],
      removeFilters: [],
      limit: 6,
    });

    // The parent asked for "latest"; the amendment interrogates the same snapshot, which
    // is knowable only from provenance.
    expect(amended.asOf).toBe("2018-09-26T00:00:00.000Z");
    expect(amended.limit).toBe(6);
  });

  it("re-resolves to latest when reAsOf is explicitly null", () => {
    const parent = heroSpec(HERO_AS_OF);
    const amended = applyPatch(parent, parentProvenance, {
      basedOn: "parent",
      addFilters: [],
      removeFilters: [],
      reAsOf: null,
    });

    expect(amended.asOf).toBeNull();
  });

  it("keeps everything the patch did not name", () => {
    const parent = heroSpec(HERO_AS_OF);
    const amended = applyPatch(parent, parentProvenance, {
      basedOn: "parent",
      addFilters: [],
      removeFilters: [],
      breakdown: "genre",
    });

    expect(amended.breakdown).toBe("genre");
    expect(amended.measure).toBe(parent.measure);
    expect(amended.guards).toEqual(parent.guards);
    expect(amended.sort.tieBreak).toBe(parent.sort.tieBreak);
  });
});

describe("rejection", () => {
  it("returns a clarifying question for an undeclared measure and never throws", () => {
    expect(() => resolveSpec({ measure: "revenue" }, layer)).not.toThrow();

    const result = resolveSpec({ measure: "revenue" }, layer);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");

    expect(result.rejection.kind).toBe("clarify");
    expect(result.rejection.missing).toContainEqual({ what: "revenue", kind: "measure" });
    // It names the gap rather than implying one.
    expect(result.rejection.declared.measures).toContain("avg_rating");
    expect(result.rejection.nearest.length).toBeGreaterThan(0);
    expect(result.rejection.nearest[0]?.spec.sort.tieBreak).toBe(layer.defaultTieBreak);
  });

  it("refuses an undeclared dimension and an unregistered guard the same way", () => {
    const byDirector = resolveSpec({ measure: "avg_rating", breakdown: "director" }, layer);
    expect(byDirector.ok).toBe(false);

    const badGuard = resolveSpec(
      { measure: "avg_rating", guards: [{ id: "min_revenue", params: {} }] },
      layer,
    );
    expect(badGuard.ok).toBe(false);
    if (badGuard.ok) throw new Error("unreachable");
    expect(badGuard.rejection.missing).toContainEqual({ what: "min_revenue", kind: "guard" });
  });

  it("fills the tie-break from the layer, because the model never chooses it", () => {
    const result = resolveSpec({ measure: "avg_rating", breakdown: "title" }, layer);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(result.spec.sort.tieBreak).toBe("title");
    // Guards default to on: a safe default already applied is the design.
    expect(result.spec.guards.map((guard) => guard.id).sort()).toEqual(
      layer.guards.map((guard) => guard.id).sort(),
    );
    expect(result.spec.asOf).toBeNull();
  });
});

/**
 * A seeded shuffle, so a failure is reproducible. `Math.random()` here would make the
 * tie-break test flaky in exactly the way it exists to rule out.
 */
function shufflePayload(source: ReceivedPayload, seed: number): ReceivedPayload {
  const random = mulberry32(seed);
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  return {
    ...source,
    titles: shuffle(source.titles),
    ratings: shuffle(source.ratings),
    tags: source.tags,
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
