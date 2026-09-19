import type { Rejection, SemanticLayer } from "@/server/contracts";

import { resolveSpec, type ResolveInput, type ResolveResult } from "@/server/engine/resolve";

/**
 * The deterministic parser: the path the product takes when there is no model.
 *
 * `AGENTS.md` invariant 13 says the app runs on a clean clone with no API key — it
 * degrades, it does not break. This is what degrading means: the starter questions still
 * answer, every number is still computed by the engine, and **everything else becomes a
 * clarifying question**. That refusal is the product working rather than the parser
 * failing (build-spec §3 GA-05, "Must not"), which is why nothing here guesses.
 *
 * ## What it will not do
 *
 * No model, no grammar, no intent classification, no stemming, no fuzzy or nearest-match
 * scoring, no number or date extraction, and no composing a spec that is not already in
 * the catalogue below. Its entire output space is the starter questions' specs plus a
 * `Rejection` — so a question it cannot place cannot come back as a subtly different one.
 *
 * ## How it matches, in two stages
 *
 * 1. **The catalogue.** A normalised exact match against a starter question's own text.
 * 2. **Declared vocabulary.** Failing that, it looks for a declared label or synonym of a
 *    starter question's measure *and* of its breakdown dimension. Both must occur, exactly
 *    one starter question may match, and the result is **that starter question's spec** —
 *    never a new one.
 *
 * Stage 2 is a dictionary lookup over strings the semantic layer declares, not language
 * understanding: on the layer as GA-03 shipped it — no synonyms at all — it matches only
 * literal label text. It exists because GA-03's own must-not defers synonym volume to
 * "a failing eval in GA-05", and a parser that could not read a synonym would leave that
 * loop with nothing to close on until GA-08. See `docs/architecture.md` §8.
 */

/** One starter question: the zero state's copy, and the spec it stands for. */
export type StarterQuestion = {
  readonly id: string;
  /** locale → the question as the zero state shows it. Locale-keyed (invariant 8). */
  readonly questions: Readonly<Record<string, string>>;
  /** A declared MeasureId. */
  readonly measure: string;
  /** A declared DimensionId. */
  readonly breakdown: string;
  readonly sort: { readonly by: "measure" | "breakdown"; readonly dir: "asc" | "desc" };
  /**
   * Bounded by the breakdown's measured cardinality — genre 19, release decade 12,
   * rating year 23 (the same measurement that grounds `MAX_LIMIT`, `contracts/query-spec.ts`).
   * A breakdown that asks about *each* member shows all of them; a ranking over 9,742
   * titles shows ten.
   */
  readonly limit: number;
};

/**
 * The starter questions. Product copy, and the source the zero state renders in GA-10.
 *
 * It lives in code rather than in `semantic/movielens.json` because the layer's schema
 * declares measures, dimensions and guards, and adding a sixth top-level field to it is a
 * GA-03 change rather than a GA-05 one. Moving them into the layer is the natural next
 * step — it is what would let a second dataset ship its own zero state as data — and is
 * recorded as such rather than done here.
 */
export const STARTER_QUESTIONS: readonly StarterQuestion[] = [
  {
    // The hero moment (design §4): 296 titles tied at 5.00 naively against
    // A Streetcar Named Desire at 4.47 (n=20) honestly.
    id: "top-rated-titles",
    questions: { en: "What are our top rated titles?" },
    measure: "avg_rating",
    breakdown: "title",
    sort: { by: "measure", dir: "desc" },
    limit: 10,
  },
  {
    id: "most-rated-titles",
    questions: { en: "Which titles have the most ratings?" },
    measure: "rating_count",
    breakdown: "title",
    sort: { by: "measure", dir: "desc" },
    limit: 10,
  },
  {
    id: "rating-by-genre",
    questions: { en: "How does average rating compare across genres?" },
    measure: "avg_rating",
    breakdown: "genre",
    sort: { by: "measure", dir: "desc" },
    limit: 19,
  },
  {
    id: "ratings-by-genre",
    questions: { en: "How many ratings does each genre have?" },
    measure: "rating_count",
    breakdown: "genre",
    sort: { by: "measure", dir: "desc" },
    limit: 19,
  },
  {
    id: "titles-by-genre",
    questions: { en: "How many titles are in each genre?" },
    measure: "title_count",
    breakdown: "genre",
    sort: { by: "measure", dir: "desc" },
    limit: 19,
  },
  {
    id: "viewers-by-genre",
    questions: { en: "How many viewers rated each genre?" },
    measure: "viewer_count",
    breakdown: "genre",
    sort: { by: "measure", dir: "desc" },
    limit: 19,
  },
  {
    id: "share-4-plus-by-genre",
    questions: { en: "Which genres have the highest share rated 4 or higher?" },
    measure: "share_rated_4_plus",
    breakdown: "genre",
    sort: { by: "measure", dir: "desc" },
    limit: 19,
  },
  {
    // Ordered by the breakdown, not by the measure: "each year" is a question about a
    // sequence, and a chronological axis is the honest rendering of one.
    id: "ratings-by-year",
    questions: { en: "How many ratings did we get each year?" },
    measure: "rating_count",
    breakdown: "rating_year",
    sort: { by: "breakdown", dir: "asc" },
    limit: 23,
  },
  {
    id: "rating-by-decade",
    questions: { en: "How does average rating compare across release decades?" },
    measure: "avg_rating",
    breakdown: "release_decade",
    sort: { by: "breakdown", dir: "asc" },
    limit: 12,
  },
];

/**
 * Words that would change the answer stage 2 is about to give.
 *
 * Every starter question ranks or sequences in one declared direction. A question asking
 * for the *other* end carries the same declared vocabulary, so stage 2 would match it and
 * hand back the opposite answer with no sign that anything was lost — which is the silent
 * coercion invariant 4 exists to remove. The parser refuses instead.
 *
 * This is a refusal rule, not an understanding rule: it only ever makes the parser answer
 * less. Locale-keyed like every other piece of vocabulary in the build; `en` ships in v1.
 */
export const CONTRARY_TERMS: Readonly<Record<string, readonly string[]>> = {
  en: ["fewest", "lowest", "worst", "least", "bottom", "smallest", "poorest"],
};

/**
 * Lowercase, punctuation to spaces, whitespace collapsed.
 *
 * Deliberately not stemming and not stripping stop words. Both are guesses, and a parser
 * whose whole contract is "recognise what the layer declares, refuse the rest" cannot
 * afford either: "ratings" and "rating" name two different measures here.
 */
export function normaliseQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenise(text: string): string[] {
  const normalised = normaliseQuestion(text);
  return normalised === "" ? [] : normalised.split(" ");
}

/** Whether `phrase`'s tokens appear contiguously in `tokens`. Whole tokens only. */
function containsPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (tokens[start + offset] !== phrase[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** Every phrase the layer declares for one id, at one locale: its label and its synonyms. */
function vocabularyFor(
  declaration: { labels: Record<string, string>; synonyms: Record<string, string[]> },
  locale: string,
): string[] {
  const label = declaration.labels[locale];
  return [...(label === undefined ? [] : [label]), ...(declaration.synonyms[locale] ?? [])];
}

/** Which declared phrase, if any, of this id occurs in the question. */
function matchDeclared(
  tokens: readonly string[],
  declaration: { labels: Record<string, string>; synonyms: Record<string, string[]> },
  locale: string,
): string | null {
  for (const phrase of vocabularyFor(declaration, locale)) {
    if (containsPhrase(tokens, tokenise(phrase))) return phrase;
  }
  return null;
}

/** The spec input a starter question stands for. Guards are left to the layer's defaults. */
export function starterInput(starter: StarterQuestion): ResolveInput {
  return {
    measure: starter.measure,
    breakdown: starter.breakdown,
    filters: [],
    sort: { by: starter.sort.by, dir: starter.sort.dir },
    limit: starter.limit,
    asOf: null,
  };
}

/**
 * Why a question did not match — the material the eval harness turns into a finding.
 *
 * A failing eval has to name the structure that is missing rather than report a mismatch
 * (build-spec §3 GA-05, "Must not"), and this is where the parser says what it looked for.
 */
export type NoMatch = {
  readonly reason: "no-measure" | "no-pair" | "ambiguous" | "contrary-term";
  /** The declared measure ids whose vocabulary occurred in the question. */
  readonly measuresMatched: readonly string[];
  /** The declared dimension ids whose vocabulary occurred in the question. */
  readonly dimensionsMatched: readonly string[];
  /** Starter question ids that matched, when more than one did. */
  readonly candidates: readonly string[];
  /** The refusing term, when `reason` is `contrary-term`. */
  readonly term: string | null;
};

export type MatchOutcome =
  | { readonly matched: true; readonly starter: StarterQuestion; readonly stage: 1 | 2 }
  | { readonly matched: false; readonly miss: NoMatch };

/**
 * Place a question in the catalogue, or explain why it has no place there.
 *
 * Separate from `parseQuestion` so the eval harness can report *how* a question failed
 * without re-running the parse, and so the two stages stay readable.
 */
export function matchStarter(
  question: string,
  layer: SemanticLayer,
  locale = "en",
): MatchOutcome {
  const normalised = normaliseQuestion(question);

  // Stage 1 — the catalogue's own words.
  for (const starter of STARTER_QUESTIONS) {
    const text = starter.questions[locale];
    if (text !== undefined && normaliseQuestion(text) === normalised) {
      return { matched: true, starter, stage: 1 };
    }
  }

  // Stage 2 — declared vocabulary only.
  const tokens = tokenise(question);
  const measuresMatched = layer.measures
    .filter((measure) => matchDeclared(tokens, measure, locale) !== null)
    .map((measure) => measure.id);
  const dimensionsMatched = layer.dimensions
    .filter((dimension) => matchDeclared(tokens, dimension, locale) !== null)
    .map((dimension) => dimension.id);

  const candidates = STARTER_QUESTIONS.filter(
    (starter) =>
      measuresMatched.includes(starter.measure) && dimensionsMatched.includes(starter.breakdown),
  );

  if (candidates.length === 0) {
    return {
      matched: false,
      miss: {
        reason: measuresMatched.length === 0 ? "no-measure" : "no-pair",
        measuresMatched,
        dimensionsMatched,
        candidates: [],
        term: null,
      },
    };
  }

  if (candidates.length > 1) {
    return {
      matched: false,
      miss: {
        reason: "ambiguous",
        measuresMatched,
        dimensionsMatched,
        candidates: candidates.map((starter) => starter.id),
        term: null,
      },
    };
  }

  const contrary = (CONTRARY_TERMS[locale] ?? []).find((term) =>
    containsPhrase(tokens, tokenise(term)),
  );
  if (contrary !== undefined) {
    return {
      matched: false,
      miss: {
        reason: "contrary-term",
        measuresMatched,
        dimensionsMatched,
        candidates: candidates.map((starter) => starter.id),
        term: contrary,
      },
    };
  }

  const starter = candidates[0];
  if (starter === undefined) throw new Error("unreachable: one candidate, none present");
  return { matched: true, starter, stage: 2 };
}

/**
 * The clarifying question, built from the catalogue.
 *
 * `nearest` offers **real starter questions**, not synthesised phrasings, because the
 * user is going to tap one. `resolveSpec` has a rejection builder of its own for a spec
 * naming an undeclared id (`engine/resolve.ts`); this one answers a different failure —
 * a question with no place in the catalogue — and the two are kept apart rather than
 * merged, since only this one has starter copy to offer.
 */
function clarify(
  question: string,
  layer: SemanticLayer,
  miss: NoMatch,
  locale: string,
): Rejection {
  const related = STARTER_QUESTIONS.filter(
    (starter) =>
      miss.measuresMatched.includes(starter.measure) ||
      miss.dimensionsMatched.includes(starter.breakdown),
  );
  const offered = (related.length > 0 ? related : STARTER_QUESTIONS).slice(0, 3);

  const nearest = offered.flatMap((starter) => {
    const text = starter.questions[locale];
    const resolved = resolveSpec(starterInput(starter), layer, text ?? starter.id);
    if (!resolved.ok || text === undefined) return [];
    return [{ question: text, spec: resolved.spec }];
  });

  const missing: Rejection["missing"] =
    miss.reason === "contrary-term"
      ? [
          {
            // The closed `kind` list has no entry for a sort direction, and adding one is a
            // GA-01 contract change for a word rather than for a concept the spec carries.
            // The direction belongs to the measure's ordering, so it is filed there and
            // named in full.
            what: `"${miss.term}" — a direction this parser does not interpret`,
            kind: "measure",
          },
        ]
      : miss.reason === "ambiguous"
        ? [{ what: `more than one starter question matches: ${miss.candidates.join(", ")}`, kind: "measure" }]
        : miss.reason === "no-pair"
          ? [{ what: question, kind: "dimension" }]
          : [{ what: question, kind: "measure" }];

  return {
    kind: "clarify",
    asked: question,
    missing,
    declared: {
      measures: layer.measures.map((measure) => measure.id),
      dimensions: layer.dimensions.map((dimension) => dimension.id),
    },
    nearest,
  };
}

/**
 * A question in, an executable spec or a clarifying question out. **Never a throw**
 * (invariant 4) — a throw is rendered as an error, and this refusal is rendered as the
 * product working.
 */
export function parseQuestion(
  question: string,
  layer: SemanticLayer,
  locale = "en",
): ResolveResult {
  const outcome = matchStarter(question, layer, locale);
  if (!outcome.matched) {
    return { ok: false, rejection: clarify(question, layer, outcome.miss, locale) };
  }
  return resolveSpec(starterInput(outcome.starter), layer, question);
}
