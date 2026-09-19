import type { GuardRef, QuerySpec, ResultRow } from "@/server/contracts";

/**
 * The conformance corpus: a spec with an explicit as-of, and the numbers it must produce.
 *
 * This is the artifact behind the product's central claim. Invariant 10 says determinism
 * is proved rather than asserted, and **this file is the proof's content**: every
 * `Warehouse` adapter runs this same list and must return these same numbers, so
 * "swappable warehouse" stops being an interface and becomes a measured property.
 *
 * ## Every case carries an explicit, non-null as-of
 *
 * `asOf: null` means "latest", and a case pinned at latest expires the moment the next
 * payload lands — silently, by passing against different data. `corpus.test.ts` asserts
 * that no case here carries one. The three as-of points are declared below, and each is
 * chosen for a reason rather than for coverage.
 *
 * ## A case carries its definition, not just a number
 *
 * Each case names its guards in full rather than borrowing "all of them" from the layer,
 * because a threshold that moved in `semantic/movielens.json` would otherwise change what
 * these numbers mean without changing this file. `corpus.test.ts` asserts the guards
 * written here still match the layer's declared defaults, so the two can only drift
 * loudly. It is the rule `AGENTS.md` states for the pinned figures: a figure without its
 * definition is not a pinned figure.
 *
 * ## Where each expectation came from
 *
 * `source: "build-spec"` means the numbers were specified in `docs/build-spec.md` before
 * any code computed them — those three cases are an independent oracle. `source:
 * "measured"` means they were read off the shipped store once and pinned; those are
 * regression pins, and their independent check is a second adapter reproducing them from
 * an entirely different engine.
 */

/** The hero moment's as-of (`docs/build-spec.md` §3, GA-04). */
export const HERO_AS_OF = "2018-09-25T00:00:00.000Z";

/** The replay: the same question asked of a moment eleven years earlier. */
export const REPLAY_AS_OF = "2007-08-02T00:00:00.000Z";

/** The delivery's own `receivedAt` — the store's latest, written out rather than inferred. */
export const DELIVERY_AS_OF = "2018-09-26T00:00:00.000Z";

export const AS_OF_POINTS: readonly string[] = [HERO_AS_OF, REPLAY_AS_OF, DELIVERY_AS_OF];

/**
 * Every guard the shipped layer declares, with its declared thresholds, written out.
 * Asserted against `semantic/movielens.json` in `corpus.test.ts`.
 */
export const ALL_GUARDS: readonly GuardRef[] = [
  { id: "min_evidence", params: { minObservations: 20 } },
  { id: "exclude_unrated", params: {} },
  { id: "exclude_uncategorised", params: {} },
  { id: "disclose_multi_membership", params: {} },
];

/** The naive run: guards emptied, which is what the double-run compares against. */
export const NO_GUARDS: readonly GuardRef[] = [];

/**
 * What the naive/honest double-run produced.
 *
 * `"none"` covers both ways `TrustReport.comparison` is null — a spec with no guards is
 * its own naive run, and a spec whose guards changed nothing material has nothing to
 * show. The contract does not distinguish them, so neither does this.
 */
export type ComparisonOutcome = "material" | "none";

export type CaseExpectation = {
  /** The rows, in order, exactly as the engine returns them. */
  rows: readonly ResultRow[];
  coverage: {
    includedObservations: number;
    totalObservations: number;
    includedMembers: number;
    totalMembers: number;
  };
  /** The trust report's notes, in full. An empty list is an assertion too. */
  notes: readonly string[];
  comparison: ComparisonOutcome;
};

export type ConformanceCase = {
  id: string;
  /** The plain-English question this spec answers, so a failure names a user-visible thing. */
  question: string;
  /** What this case is here to catch. A case with no failure mode is decoration. */
  why: string;
  source: "build-spec" | "measured";
  spec: QuerySpec;
  expect: CaseExpectation;
};

function spec(overrides: Partial<QuerySpec> & Pick<QuerySpec, "measure" | "asOf">): QuerySpec {
  return {
    filters: [],
    sort: { by: "measure", dir: "desc", tieBreak: "title" },
    limit: 10,
    guards: [...ALL_GUARDS],
    ...overrides,
  };
}

/** `value` is always `rawValue / scale`; writing both keeps the measure's scale pinned. */
function row(key: string | null, rawValue: number, n: number, scale: number): ResultRow {
  return { key, value: rawValue / scale, rawValue, n };
}

/** The three scales the shipped measures declare. */
const HUNDREDTHS = 100;
const ONE = 1;
const TEN_THOUSANDTHS = 10_000;

export const CASES: readonly ConformanceCase[] = [
  {
    id: "hero-honest-2018",
    question: "What are our top rated titles?",
    why: "The hero moment. If two adapters disagree anywhere, the product's headline number is where it matters most.",
    source: "build-spec",
    spec: spec({ measure: "avg_rating", breakdown: "title", limit: 4, asOf: HERO_AS_OF }),
    expect: {
      rows: [
        row("Streetcar Named Desire, A (1951)", 447, 20, HUNDREDTHS),
        row("Shawshank Redemption, The (1994)", 443, 317, HUNDREDTHS),
        row("Sunset Blvd. (a.k.a. Sunset Boulevard) (1950)", 433, 27, HUNDREDTHS),
        row("Philadelphia Story, The (1940)", 431, 29, HUNDREDTHS),
      ],
      coverage: {
        includedObservations: 67_898,
        totalObservations: 100_836,
        includedMembers: 1_297,
        // 9,742 declared titles, not 9,737. The five title strings shared by two movieIds
        // each are five separate members; GA-06 found the local adapter merging them.
        totalMembers: 9_742,
      },
      notes: [],
      comparison: "material",
    },
  },
  {
    id: "hero-naive-2018",
    question: "What are our top rated titles? — with every guard turned off",
    why: "296 titles tie at exactly 5.00, so the ordering rule alone decides which four appear. Two adapters that tie-break differently disagree here and nowhere else.",
    source: "build-spec",
    spec: spec({
      measure: "avg_rating",
      breakdown: "title",
      limit: 4,
      guards: [...NO_GUARDS],
      asOf: HERO_AS_OF,
    }),
    expect: {
      rows: [
        row("'Salem's Lot (2004)", 500, 1, HUNDREDTHS),
        row("12 Angry Men (1997)", 500, 1, HUNDREDTHS),
        row("12 Chairs (1976)", 500, 1, HUNDREDTHS),
        row("20 Million Miles to Earth (1957)", 500, 1, HUNDREDTHS),
      ],
      coverage: {
        includedObservations: 100_836,
        totalObservations: 100_836,
        includedMembers: 9_742,
        totalMembers: 9_742,
      },
      notes: [],
      comparison: "none",
    },
  },
  {
    id: "replay-2007",
    question: "What are our top rated titles? — asked on 2 August 2007",
    why: "The as-of replay against the full 2018 store. Three titles display 4.44 here and only the exact rational ranks them, so an adapter that rounded before ordering fails.",
    source: "build-spec",
    spec: spec({ measure: "avg_rating", breakdown: "title", limit: 4, asOf: REPLAY_AS_OF }),
    expect: {
      rows: [
        row("Shawshank Redemption, The (1994)", 446, 149, HUNDREDTHS),
        row(
          "Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964)",
          444,
          43,
          HUNDREDTHS,
        ),
        row("Lawrence of Arabia (1962)", 444, 32, HUNDREDTHS),
        // Chinatown also displays 4.44 and is fourth only because 13,750/31 is compared
        // exactly. Rounding first sorts it second, alphabetically (architecture §5a).
        row("Chinatown (1974)", 444, 31, HUNDREDTHS),
      ],
      coverage: {
        includedObservations: 28_581,
        totalObservations: 50_266,
        includedMembers: 667,
        totalMembers: 9_742,
      },
      notes: [],
      comparison: "material",
    },
  },
  {
    id: "hero-at-delivery",
    question: "What are our top rated titles? — at the delivery's own as-of",
    why: "The third as-of point, so the watermark is exercised at the boundary the manifest declares and not only at two arbitrary moments.",
    source: "measured",
    spec: spec({ measure: "avg_rating", breakdown: "title", limit: 4, asOf: DELIVERY_AS_OF }),
    expect: {
      rows: [
        row("Streetcar Named Desire, A (1951)", 447, 20, HUNDREDTHS),
        row("Shawshank Redemption, The (1994)", 443, 317, HUNDREDTHS),
        row("Sunset Blvd. (a.k.a. Sunset Boulevard) (1950)", 433, 27, HUNDREDTHS),
        row("Philadelphia Story, The (1940)", 431, 29, HUNDREDTHS),
      ],
      coverage: {
        includedObservations: 67_898,
        totalObservations: 100_836,
        includedMembers: 1_297,
        totalMembers: 9_742,
      },
      notes: [],
      comparison: "material",
    },
  },
  {
    id: "ratings-by-rating-year",
    question: "How many ratings did we get each year?",
    why: "The timezone case. A rating's year is a UTC year, and a Postgres session inherits its zone from its host, so an unpinned EXTRACT files new-year ratings under the wrong year with no error at all.",
    source: "measured",
    spec: spec({ measure: "rating_count", breakdown: "rating_year", limit: 5, asOf: HERO_AS_OF }),
    expect: {
      rows: [
        row("2000", 10_061, 10_061, ONE),
        row("2017", 8_198, 8_198, ONE),
        row("2007", 7_114, 7_114, ONE),
        row("2016", 6_703, 6_703, ONE),
        row("2015", 6_616, 6_616, ONE),
      ],
      coverage: {
        includedObservations: 100_836,
        totalObservations: 100_836,
        includedMembers: 23,
        totalMembers: 23,
      },
      notes: [],
      comparison: "none",
    },
  },
  {
    id: "ratings-by-genre",
    question: "How many ratings did each genre get?",
    why: "A multi-valued breakdown: one title lands in several members, which is where a JOIN and a loop most easily disagree about what was counted and how often.",
    source: "measured",
    spec: spec({ measure: "rating_count", breakdown: "genre", limit: 5, asOf: HERO_AS_OF }),
    expect: {
      rows: [
        row("Drama", 41_928, 41_928, ONE),
        row("Comedy", 39_053, 39_053, ONE),
        row("Action", 30_635, 30_635, ONE),
        row("Thriller", 26_452, 26_452, ONE),
        row("Adventure", 24_161, 24_161, ONE),
      ],
      // 274,480 is 100,836 ratings counted once per genre the title belongs to; the 47
      // excluded are the uncategorised member `exclude_uncategorised` drops. 19 genres
      // against 20 members is the sentinel being one of them.
      coverage: {
        includedObservations: 274_433,
        totalObservations: 274_480,
        includedMembers: 19,
        totalMembers: 20,
      },
      notes: [
        "6,879 items belong to more than one genre, so this breakdown counts each of them once per genre.",
      ],
      comparison: "none",
    },
  },
  {
    id: "titles-per-genre",
    question: "How many titles are in each genre?",
    why: "A title-grain measure, where the facts are titles rather than ratings and `observations` counts something else entirely.",
    source: "measured",
    spec: spec({ measure: "title_count", breakdown: "genre", limit: 5, asOf: HERO_AS_OF }),
    expect: {
      rows: [
        row("Drama", 4_361, 4_361, ONE),
        row("Comedy", 3_756, 3_756, ONE),
        row("Thriller", 1_894, 1_894, ONE),
        row("Action", 1_828, 1_828, ONE),
        row("Romance", 1_596, 1_596, ONE),
      ],
      // 22,050 genre assignments over the categorised titles — the pinned figure behind
      // 2.27 genres per movie (`AGENTS.md`) — against 22,084 with the 34 uncategorised.
      coverage: {
        includedObservations: 22_050,
        totalObservations: 22_084,
        includedMembers: 19,
        totalMembers: 20,
      },
      notes: [
        "6,891 items belong to more than one genre, so this breakdown counts each of them once per genre.",
      ],
      comparison: "none",
    },
  },
  {
    id: "avg-by-decade",
    question: "How do average ratings compare by release decade?",
    why: "A derived numeric dimension. SQL integer division truncates toward zero and the engine floors; they agree only because years are positive, and this is where that would show.",
    source: "measured",
    spec: spec({
      measure: "avg_rating",
      breakdown: "release_decade",
      limit: 5,
      asOf: HERO_AS_OF,
    }),
    expect: {
      rows: [
        row("1940", 387, 1_101, HUNDREDTHS),
        row("1950", 385, 1_784, HUNDREDTHS),
        row("1960", 381, 2_858, HUNDREDTHS),
        row("1970", 378, 4_995, HUNDREDTHS),
        row("1920", 374, 125, HUNDREDTHS),
      ],
      coverage: {
        includedObservations: 100_802,
        totalObservations: 100_836,
        includedMembers: 10,
        totalMembers: 12,
      },
      notes: [
        "13 items carrying 18 of 100,836 records have no release decade and are left out of this breakdown.",
      ],
      comparison: "none",
    },
  },
  {
    id: "avg-by-release-year",
    question: "How do average ratings compare by release year?",
    why: "C4's disclosure: the thirteen undated titles are declared in the trust report rather than silently dropped, and a second adapter has to report the same drop.",
    source: "measured",
    spec: spec({ measure: "avg_rating", breakdown: "release_year", limit: 3, asOf: HERO_AS_OF }),
    expect: {
      rows: [
        row("1934", 409, 34, HUNDREDTHS),
        row("1944", 404, 92, HUNDREDTHS),
        row("1957", 404, 215, HUNDREDTHS),
      ],
      coverage: {
        includedObservations: 100_689,
        totalObservations: 100_836,
        includedMembers: 89,
        totalMembers: 106,
      },
      notes: [
        "13 items carrying 18 of 100,836 records have no release year and are left out of this breakdown.",
      ],
      comparison: "material",
    },
  },
  {
    id: "viewers-total",
    question: "How many viewers have rated anything?",
    why: "No breakdown and a distinct count. The single null-keyed member is a different path in both adapters, and COUNT(DISTINCT) is where a JOIN that fanned out would show up.",
    source: "measured",
    spec: spec({ measure: "viewer_count", limit: 1, asOf: HERO_AS_OF }),
    expect: {
      rows: [row(null, 610, 100_836, ONE)],
      coverage: {
        includedObservations: 100_836,
        totalObservations: 100_836,
        includedMembers: 1,
        totalMembers: 1,
      },
      notes: [],
      comparison: "none",
    },
  },
  {
    id: "share-4plus-by-decade",
    question: "What share of ratings were four stars or better, by release decade?",
    why: "A scaled ratio at 10,000ths rather than 100ths. It is the case that would catch an adapter returning a computed average instead of the exact integer pair.",
    source: "measured",
    spec: spec({
      measure: "share_rated_4_plus",
      breakdown: "release_decade",
      limit: 3,
      asOf: HERO_AS_OF,
    }),
    expect: {
      rows: [
        row("1950", 6_373, 1_784, TEN_THOUSANDTHS),
        row("1940", 6_294, 1_101, TEN_THOUSANDTHS),
        row("1960", 6_162, 2_858, TEN_THOUSANDTHS),
      ],
      coverage: {
        includedObservations: 100_802,
        totalObservations: 100_836,
        includedMembers: 10,
        totalMembers: 12,
      },
      notes: [
        "13 items carrying 18 of 100,836 records have no release decade and are left out of this breakdown.",
      ],
      comparison: "none",
    },
  },
  {
    id: "unrated-titles-ascending",
    question: "Which titles have the lowest average rating? — with every guard turned off",
    why: "The zero-observation members. SUM() over no rows is NULL in SQL and 0 in a loop; without COALESCE the second adapter returns a null numerator for the eighteen titles nobody rated.",
    source: "measured",
    spec: spec({
      measure: "avg_rating",
      breakdown: "title",
      limit: 3,
      sort: { by: "measure", dir: "asc", tieBreak: "title" },
      guards: [...NO_GUARDS],
      asOf: HERO_AS_OF,
    }),
    expect: {
      rows: [
        row("Browning Version, The (1951)", 0, 0, HUNDREDTHS),
        row("Call Northside 777 (1948)", 0, 0, HUNDREDTHS),
        row("Chalet Girl (2011)", 0, 0, HUNDREDTHS),
      ],
      coverage: {
        includedObservations: 100_836,
        totalObservations: 100_836,
        includedMembers: 9_742,
        totalMembers: 9_742,
      },
      notes: [],
      comparison: "none",
    },
  },
  {
    id: "filtered-film-noir",
    question: "What are our top rated film noir titles?",
    why: "A filter on a multi-valued dimension, which is an EXISTS in SQL and an any-match in a loop.",
    source: "measured",
    spec: spec({
      measure: "avg_rating",
      breakdown: "title",
      filters: [{ dimension: "genre", op: "eq", value: "Film-Noir" }],
      limit: 3,
      asOf: HERO_AS_OF,
    }),
    expect: {
      rows: [
        row("Sunset Blvd. (a.k.a. Sunset Boulevard) (1950)", 433, 27, HUNDREDTHS),
        row("Notorious (1946)", 425, 20, HUNDREDTHS),
        row("Third Man, The (1949)", 423, 24, HUNDREDTHS),
      ],
      coverage: {
        includedObservations: 558,
        totalObservations: 870,
        includedMembers: 13,
        totalMembers: 87,
      },
      notes: [],
      comparison: "material",
    },
  },
  {
    id: "filtered-nineties",
    question: "How many ratings did titles released in the 1990s get, by release year?",
    why: "A numeric range filter. `between` is the one operator where the local adapter refuses a non-numeric comparison that SQL would happily make.",
    source: "measured",
    spec: spec({
      measure: "rating_count",
      breakdown: "release_year",
      filters: [{ dimension: "release_year", op: "between", value: [1990, 1999] }],
      limit: 3,
      asOf: HERO_AS_OF,
    }),
    expect: {
      rows: [
        row("1995", 6_144, 6_144, ONE),
        row("1994", 5_296, 5_296, ONE),
        row("1999", 4_536, 4_536, ONE),
      ],
      coverage: {
        includedObservations: 37_087,
        totalObservations: 37_087,
        includedMembers: 10,
        totalMembers: 10,
      },
      notes: [],
      comparison: "none",
    },
  },
];

/**
 * The paraphrase set: several ways of asking one question, which must produce **one**
 * answer.
 *
 * Target 15 in `docs/build-spec.md` §1 asks that N phrasings of one question produce one
 * byte-identical `ResultSet`. The phrasings are paired here with the loosely-shaped input
 * a parser would emit for each, and `resolveSpec()` — which already fills the tie-break,
 * defaults the guards and bounds the limit — turns each into a `QuerySpec`. The suite
 * asserts all of them resolve to the *same* spec and then execute to byte-identical rows,
 * on every adapter.
 *
 * **What this does not yet prove.** GA-06 depends only on GA-04, so nothing here maps the
 * English to the input: that is GA-05's fallback parser and GA-08's interpret call. The
 * phrasings are carried beside their inputs so that when either lands, this same corpus
 * becomes the end-to-end paraphrase test without being rewritten — the seam is the
 * `ResolveInput`, and it is the only part that changes.
 *
 * The variation between the inputs is deliberate, and is where paraphrases actually
 * differ: one names the sort, one does not; one names the guards, one lets them default;
 * one spells the tie-break, one leaves it to the layer.
 */
export type Paraphrase = {
  /** How a user might ask it. */
  text: string;
  /** What a parser would emit — deliberately shaped differently from its siblings. */
  input: Record<string, unknown>;
};

export const PARAPHRASE_QUESTION = "What are our top rated titles?";

export const PARAPHRASES: readonly Paraphrase[] = [
  {
    text: "What are our top rated titles?",
    input: { measure: "avg_rating", breakdown: "title", limit: 4, asOf: HERO_AS_OF },
  },
  {
    text: "Which titles have the highest average rating?",
    input: {
      measure: "avg_rating",
      breakdown: "title",
      sort: { by: "measure", dir: "desc" },
      limit: 4,
      asOf: HERO_AS_OF,
    },
  },
  {
    text: "Show me our best rated films.",
    input: {
      measure: "avg_rating",
      breakdown: "title",
      filters: [],
      sort: { by: "measure", dir: "desc", tieBreak: "title" },
      limit: 4,
      asOf: HERO_AS_OF,
    },
  },
  {
    text: "Top titles by average rating, please.",
    input: {
      measure: "avg_rating",
      breakdown: "title",
      limit: 4,
      guards: [
        { id: "min_evidence", params: { minObservations: 20 } },
        { id: "exclude_unrated", params: {} },
        { id: "exclude_uncategorised", params: {} },
        { id: "disclose_multi_membership", params: {} },
      ],
      asOf: HERO_AS_OF,
    },
  },
  {
    text: "What's rated best?",
    input: {
      measure: "avg_rating",
      breakdown: "title",
      sort: { dir: "desc" },
      limit: 4,
      asOf: HERO_AS_OF,
    },
  },
];
