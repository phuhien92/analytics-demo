import type { ResultSet, SemanticLayer } from "@/server/contracts";
import type { LayerLabels } from "@/lib/view-model";

/**
 * A hand-built answer, so the surface tests do not need a compiled store.
 *
 * The figures are the hero moment's, copied from `AGENTS.md` — *A Streetcar Named
 * Desire* at 4.47 from 20 ratings against *The Shawshank Redemption* at 4.43 from 317.
 * They are here as **fixture data, not as pinned figures**: `tests/pinned-figures.test.ts`
 * is what asserts they are what the ETL produces, and this file only needs a shape the
 * components can render. Using the real ones anyway means a rendering defect shows up
 * against numbers a reader already recognises.
 */

export const layer: SemanticLayer = {
  version: "1.1.0",
  schemaVersion: 1,
  defaultTieBreak: "title",
  materiality: { minValueDelta: 0.01 },
  measures: [
    { id: "avg_rating", labels: { en: "average rating" }, synonyms: { en: ["best rated"] } },
    { id: "rating_count", labels: { en: "number of ratings" }, synonyms: { en: ["ratings"] } },
    { id: "title_count", labels: { en: "number of titles" }, synonyms: {} },
    { id: "viewer_count", labels: { en: "number of viewers" }, synonyms: {} },
    { id: "share_rated_4_plus", labels: { en: "share rated 4 or higher" }, synonyms: {} },
  ],
  dimensions: [
    { id: "title", labels: { en: "title" }, synonyms: { en: ["movies"] } },
    { id: "genre", labels: { en: "genre" }, synonyms: { en: ["genres"] } },
    { id: "release_year", labels: { en: "release year" }, synonyms: {} },
    { id: "release_decade", labels: { en: "release decade" }, synonyms: {} },
    { id: "rating_year", labels: { en: "rating year" }, synonyms: {} },
  ],
  guards: [
    {
      id: "min_evidence",
      labels: { en: "minimum ratings per title" },
      explanation: {
        en: "Checked how many ratings each title has, and left out the ones below the threshold.",
      },
      defaultParams: { minObservations: 20 },
    },
  ],
};

export const labels: LayerLabels = {
  measures: Object.fromEntries(layer.measures.map((m) => [m.id, m.labels.en ?? m.id])),
  dimensions: Object.fromEntries(layer.dimensions.map((d) => [d.id, d.labels.en ?? d.id])),
};

export const topRatedTitles: ResultSet = {
  spec: {
    measure: "avg_rating",
    breakdown: "title",
    filters: [],
    sort: { by: "measure", dir: "desc", tieBreak: "title" },
    limit: 3,
    guards: [{ id: "min_evidence", params: { minObservations: 20 } }],
    asOf: "2018-09-26T00:00:00.000Z",
  },
  rows: [
    { key: "Streetcar Named Desire, A (1951)", value: 4.47, rawValue: 447, n: 20 },
    { key: "Shawshank Redemption, The (1994)", value: 4.43, rawValue: 443, n: 317 },
    // Two decimals on the others and one here: the column formatter is what stops this
    // rendering as `4.3` under two values written to hundredths.
    { key: "Lawrence of Arabia (1962)", value: 4.3, rawValue: 430, n: 45 },
  ],
  trust: {
    guardsApplied: [
      {
        id: "min_evidence",
        params: { minObservations: 20 },
        explanation:
          "Checked how many ratings each title has, and left out the ones below the threshold.",
        excluded: 8440,
      },
    ],
    coverage: {
      includedObservations: 67901,
      totalObservations: 100836,
      includedMembers: 1297,
      totalMembers: 9737,
    },
    notes: [],
    comparison: null,
  },
  provenance: {
    requestId: "req-fixture",
    adapterId: "local-store",
    sourceId: "movielens",
    layerVersion: "1.1.0",
    layerSchemaVersion: 1,
    resolvedAsOf: "2018-09-26T00:00:00.000Z",
    engineVersion: "1.0.0",
    computedAt: "2026-09-18T00:00:00.000Z",
  },
};

/**
 * The same answer, carrying the catch.
 *
 * The comparison is the engine's own output for `"What are our top rated titles?"` at
 * the delivery's as-of, read off a run against the compiled store and pasted here: the
 * naive side's leaders are the alphabetically-first of **296 members tied at exactly
 * 5.00**, every one rated by a single viewer, and the honest side is the pinned hero
 * ranking. `tests/engine.test.ts` is what asserts the engine produces them; this file
 * only needs a shape the block can render, and using the measured rows means a
 * rendering defect shows up against numbers a reader already recognises.
 *
 * `coverage` is the honest run's, so the honest side's "1,297 of 9,742" is the same
 * figure the trust strip below it states.
 */
export const topRatedTitlesCaught: ResultSet = {
  ...topRatedTitles,
  trust: {
    ...topRatedTitles.trust,
    guardsApplied: [
      {
        id: "min_evidence",
        params: { minObservations: 20 },
        explanation:
          "Checked how many ratings each title has, and left out the ones below the threshold.",
        excluded: 8445,
      },
    ],
    coverage: {
      includedObservations: 67898,
      totalObservations: 100836,
      includedMembers: 1297,
      totalMembers: 9742,
    },
    comparison: {
      material: true,
      naive: [
        { key: "'Salem's Lot (2004)", value: 5, rawValue: 500, n: 1 },
        { key: "12 Angry Men (1997)", value: 5, rawValue: 500, n: 1 },
        { key: "12 Chairs (1976)", value: 5, rawValue: 500, n: 1 },
      ],
      honest: [
        { key: "Streetcar Named Desire, A (1951)", value: 4.47, rawValue: 447, n: 20 },
        { key: "Shawshank Redemption, The (1994)", value: 4.43, rawValue: 443, n: 317 },
        { key: "Sunset Blvd. (a.k.a. Sunset Boulevard) (1950)", value: 4.33, rawValue: 433, n: 27 },
      ],
      tiedAtTop: { naive: 296, honest: 1 },
    },
  },
};

/**
 * What the escape produces: the same question with every check turned off.
 *
 * Its own trust report is empty of guards and carries no comparison — emptying the
 * guards is exactly what the engine's naive run does, so there is no second run to
 * diff against. That emptiness is why the surface has to carry what was turned off
 * across the re-run, and why build-spec §3 GA-12 forbids the escape being silent.
 */
export const topRatedTitlesUnchecked: ResultSet = {
  ...topRatedTitles,
  spec: { ...topRatedTitles.spec, guards: [] },
  rows: topRatedTitlesCaught.trust.comparison!.naive,
  trust: {
    guardsApplied: [],
    coverage: {
      includedObservations: 100836,
      totalObservations: 100836,
      includedMembers: 9742,
      totalMembers: 9742,
    },
    notes: [],
    comparison: null,
  },
};

/** A count measure, where `n` restates `value` on every row. */
export const ratingsByYear: ResultSet = {
  ...topRatedTitles,
  spec: {
    ...topRatedTitles.spec,
    measure: "rating_count",
    breakdown: "rating_year",
    sort: { by: "breakdown", dir: "asc", tieBreak: "title" },
  },
  rows: [
    { key: "1996", value: 6040, rawValue: 6040, n: 6040 },
    { key: "1997", value: 1916, rawValue: 1916, n: 1916 },
    { key: "1998", value: 507, rawValue: 507, n: 507 },
  ],
};
