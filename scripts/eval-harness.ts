import { readFileSync } from "node:fs";

import { z } from "zod";

import {
  FilterSchema,
  GuardRefSchema,
  MAX_LIMIT,
  QuerySpecSchema,
  SpecPatchSchema,
  type Provenance,
  type QuerySpec,
  type SemanticLayer,
} from "@/server/contracts";

import { matchStarter, parseQuestion } from "@/server/ai/fallback-parser";
import type { ResolveResult } from "@/server/engine/resolve";
import { amendSpec } from "@/server/engine/amend";
import { ENGINE_VERSION } from "@/server/engine/execute";

/**
 * The eval harness: question → expected `QuerySpec`, scored.
 *
 * ## It compares specs, not prose, and that is the whole design
 *
 * A harness that judged narration would need a model to run, which would put a price on
 * every iteration and make the loop something run before a release rather than during the
 * work. This one compares an interpreted spec against a written-down one, so it runs in
 * CI, runs on a clean clone, and runs today with no key in existence (build-spec §3 GA-05,
 * "Must not"). The same case list scores the model path when GA-08 supplies one — the
 * interpreter is a parameter here, not an import.
 *
 * ## A failure names the missing structure
 *
 * `docs/build-spec.md` ships the semantic layer at its thinnest and defers every synonym
 * to "a failing eval in GA-05" (§3 GA-03, "Must not"). That only works if the failure is
 * the evidence somebody acts on: "expected avg_rating, got null" sends them reading the
 * layer, while "no measure matched … — avg_rating declares no synonyms in en" is the
 * finding that earns one. `explain()` below is that requirement in code.
 *
 * ## Scored against a committed baseline, not pass/fail
 *
 * C5 (build-spec §6). Cases the layer cannot yet answer are the backlog, and a pass/fail
 * runner would force them out of the set to keep the repository green — which would
 * delete exactly the evidence the loop runs on.
 */

/**
 * An expected spec, written the way a person writes one.
 *
 * `tieBreak` may be omitted and `guards` may be `"default"`: both are the layer's to
 * decide, and spelling four guard references into every line would make the set unreadable
 * while pinning nothing the layer does not already pin. Neither is a free pass. `"default"`
 * expands from `layer.guards` here, while the actual spec comes from the interpreter, so a
 * parser that stopped turning guards on still fails; an omitted `tieBreak` expands to
 * `layer.defaultTieBreak`, so a parser that let the caller choose one still fails.
 */
export const ExpectedSpecSchema = z.strictObject({
  measure: z.string(),
  breakdown: z.string().optional(),
  filters: z.array(FilterSchema).default([]),
  sort: z.strictObject({
    by: z.enum(["measure", "breakdown"]),
    dir: z.enum(["asc", "desc"]),
    tieBreak: z.string().optional(),
  }),
  limit: z.number().int().min(1).max(MAX_LIMIT),
  guards: z.union([z.literal("default"), z.literal("none"), z.array(GuardRefSchema)]),
  asOf: z.string().datetime().nullable().default(null),
});

export type ExpectedSpec = z.infer<typeof ExpectedSpecSchema>;

const MissingKindSchema = z.enum(["measure", "dimension", "filter", "guard", "timeframe"]);

const QuestionCaseSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["starter", "paraphrase"]),
  question: z.string().min(1),
  expect: z.strictObject({ spec: ExpectedSpecSchema }),
  note: z.string().optional(),
});

const RejectionCaseSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.literal("rejection"),
  question: z.string().min(1),
  expect: z.strictObject({
    rejection: z.strictObject({
      /** What the author says the layer is missing. Documentation, and the finding's subject. */
      term: z.string().min(1),
      termKind: MissingKindSchema,
    }),
  }),
  note: z.string().optional(),
});

const AmendmentCaseSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.literal("amendment"),
  /** The follow-up as a person types it. Scored on the model path from GA-09. */
  followUp: z.string().min(1),
  parent: ExpectedSpecSchema,
  /** What the parent answer's provenance recorded. An absent `reAsOf` inherits it. */
  parentResolvedAsOf: z.string().datetime(),
  patch: SpecPatchSchema,
  expect: z.strictObject({ spec: ExpectedSpecSchema }),
  note: z.string().optional(),
});

export const EvalCaseSchema = z.discriminatedUnion("kind", [
  QuestionCaseSchema,
  RejectionCaseSchema,
  AmendmentCaseSchema,
]);

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const BaselineSchema = z.strictObject({
  /** Which interpreter the baseline was measured on. GA-08 adds a second entry. */
  path: z.string().min(1),
  passed: z.number().int().min(0),
  cases: z.number().int().min(1),
  /** The layer the score was measured against — a synonym added moves the score. */
  layerVersion: z.string().min(1),
  /** What it was set from, in words. */
  setFrom: z.string().min(1),
});

export type Baseline = z.infer<typeof BaselineSchema>;

/** Fill in what the layer decides, so an expected spec compares as a real `QuerySpec`. */
export function expandExpected(expected: ExpectedSpec, layer: SemanticLayer): QuerySpec {
  const guards =
    expected.guards === "default"
      ? layer.guards.map((guard) => ({ id: guard.id, params: { ...guard.defaultParams } }))
      : expected.guards === "none"
        ? []
        : expected.guards;

  return QuerySpecSchema.parse({
    measure: expected.measure,
    ...(expected.breakdown === undefined ? {} : { breakdown: expected.breakdown }),
    filters: expected.filters,
    sort: {
      by: expected.sort.by,
      dir: expected.sort.dir,
      tieBreak: expected.sort.tieBreak ?? layer.defaultTieBreak,
    },
    limit: expected.limit,
    guards,
    asOf: expected.asOf,
  });
}

/** Key-order-independent equality, so a spec is compared by content and not by shape. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function specsEqual(a: QuerySpec, b: QuerySpec): boolean {
  return canonical(a) === canonical(b);
}

/** `avg_rating ("average rating")`, so a finding names both what the code and a person call it. */
function describeDeclared(
  declarations: readonly { id: string; labels: Record<string, string> }[],
  locale: string,
): string {
  return declarations
    .map((declaration) => {
      const label = declaration.labels[locale];
      return label === undefined ? declaration.id : `${declaration.id} ("${label}")`;
    })
    .join(", ");
}

function describeVocabulary(
  declaration: { id: string; labels: Record<string, string>; synonyms: Record<string, string[]> },
  locale: string,
): string {
  const label = declaration.labels[locale] ?? declaration.id;
  const synonyms = declaration.synonyms[locale] ?? [];
  const quoted = synonyms.map((synonym) => `"${synonym}"`).join(", ");
  return synonyms.length === 0
    ? `${declaration.id} declares "${label}" and no synonyms in ${locale}`
    : `${declaration.id} declares "${label}" and ${synonyms.length === 1 ? "the synonym" : "the synonyms"} ${quoted} in ${locale}`;
}

/** Name every field two specs disagree on. A diff, never a bare "did not match". */
function diffSpecs(expected: QuerySpec, actual: QuerySpec): string {
  const fields: (keyof QuerySpec)[] = [
    "measure",
    "breakdown",
    "filters",
    "sort",
    "limit",
    "guards",
    "asOf",
  ];
  const differences = fields
    .filter((field) => canonical(expected[field]) !== canonical(actual[field]))
    .map((field) => `${field}: expected ${canonical(expected[field])}, got ${canonical(actual[field])}`);
  return differences.length === 0 ? "specs differ in no compared field" : differences.join("; ");
}

/**
 * Why this case failed, and what would fix it.
 *
 * The required shape for an undeclared id is fixed by the build spec:
 * `no measure matched "revenue" — declared measures are …` (§3 GA-05, "Done when").
 */
export function explain(
  evalCase: EvalCase,
  layer: SemanticLayer,
  actual: ReturnType<typeof parseQuestion>,
  expectedSpec: QuerySpec | null,
  locale: string,
): string {
  const measures = describeDeclared(layer.measures, locale);
  const dimensions = describeDeclared(layer.dimensions, locale);

  if (evalCase.kind === "rejection") {
    if (!actual.ok) return "unreachable: a rejection case that rejected did not fail";
    return (
      `expected a clarifying question naming the ${evalCase.expect.rejection.termKind} ` +
      `"${evalCase.expect.rejection.term}", but the question was answered with ` +
      `${actual.spec.measure} by ${actual.spec.breakdown ?? "(no breakdown)"} — ` +
      `a nearest match is exactly what invariant 4 forbids`
    );
  }

  if (expectedSpec !== null && actual.ok) {
    return diffSpecs(expectedSpec, actual.spec);
  }

  if (evalCase.kind === "amendment") {
    return actual.ok
      ? "unreachable"
      : `the amended spec did not resolve: ${actual.rejection.missing.map((m) => `${m.kind} ${m.what}`).join("; ")}`;
  }

  // A question case that came back as a clarifying question. Either the expectation names
  // something the layer does not declare, or the layer declares it under no phrase the
  // question uses — two different findings, and two different fixes.
  const expectedMeasure = evalCase.expect.spec.measure;
  const expectedBreakdown = evalCase.expect.spec.breakdown;

  const measureDeclaration = layer.measures.find((measure) => measure.id === expectedMeasure);
  if (measureDeclaration === undefined) {
    return `no measure matched "${expectedMeasure}" — declared measures are ${measures}`;
  }

  const dimensionDeclaration =
    expectedBreakdown === undefined
      ? undefined
      : layer.dimensions.find((dimension) => dimension.id === expectedBreakdown);
  if (expectedBreakdown !== undefined && dimensionDeclaration === undefined) {
    return `no dimension matched "${expectedBreakdown}" — declared dimensions are ${dimensions}`;
  }

  const outcome = matchStarter(evalCase.question, layer, locale);
  if (outcome.matched) return "unreachable: matched the catalogue but did not resolve";

  const { miss } = outcome;
  if (miss.reason === "contrary-term") {
    return (
      `refused on "${miss.term}" — the question carries declared vocabulary but asks for the ` +
      `opposite end of an ordering the catalogue does not declare, so answering it would be a ` +
      `nearest match; a starter question ordered that way is the structure this eval wants`
    );
  }
  if (miss.reason === "ambiguous") {
    return `more than one starter question matches: ${miss.candidates.join(", ")} — the declared vocabulary does not separate them`;
  }
  if (miss.reason === "no-measure") {
    return (
      `no measure matched "${evalCase.question}" — declared measures are ${measures}; ` +
      `${describeVocabulary(measureDeclaration, locale)}, so nothing in the question can reach it`
    );
  }
  return (
    `no dimension matched "${evalCase.question}" — declared dimensions are ${dimensions}` +
    (dimensionDeclaration === undefined
      ? ""
      : `; ${describeVocabulary(dimensionDeclaration, locale)}, so nothing in the question can reach it`)
  );
}

export type CaseResult = {
  readonly id: string;
  readonly kind: EvalCase["kind"];
  readonly subject: string;
  readonly passed: boolean;
  /** Present on a failure. Names the missing structure, never a bare mismatch. */
  readonly finding: string | null;
};

/** Provenance is what carries `resolvedAsOf`, which an absent `reAsOf` inherits. */
function parentProvenance(resolvedAsOf: string, layer: SemanticLayer): Provenance {
  return {
    requestId: "eval-parent",
    adapterId: "eval",
    sourceId: "eval",
    layerVersion: layer.version,
    layerSchemaVersion: layer.schemaVersion,
    resolvedAsOf,
    engineVersion: ENGINE_VERSION,
    computedAt: "2026-09-18T00:00:00.000Z",
  };
}

export type RunOptions = {
  readonly layer: SemanticLayer;
  readonly locale?: string;
  /**
   * Defaults to the fallback parser. GA-08's model path is passed here — and may return
   * a promise, which is why the async runners below exist. The interpreter is a
   * *parameter* rather than an import precisely so this file never depends on a key.
   */
  readonly interpret?: (
    question: string,
    layer: SemanticLayer,
    locale?: string,
  ) => ResolveResult | Promise<ResolveResult>;
};

/**
 * The amendment branch, which no interpreter touches.
 *
 * A patch is applied by `engine/amend.ts`, not read from a question, so this case kind
 * scores identically on both paths until GA-09 makes the *patch* something a model
 * produces.
 */
function scoreAmendment(
  evalCase: Extract<EvalCase, { kind: "amendment" }>,
  layer: SemanticLayer,
  locale: string,
): CaseResult {
  const parent = expandExpected(evalCase.parent, layer);
  const expected = expandExpected(evalCase.expect.spec, layer);
  const actual = amendSpec(
    parent,
    parentProvenance(evalCase.parentResolvedAsOf, layer),
    evalCase.patch,
    layer,
    evalCase.followUp,
  );
  const passed = actual.ok && specsEqual(expected, actual.spec);
  return {
    id: evalCase.id,
    kind: evalCase.kind,
    subject: evalCase.followUp,
    passed,
    finding: passed ? null : explain(evalCase, layer, actual, expected, locale),
  };
}

/**
 * Scoring, once, for whichever interpreter produced `actual`.
 *
 * Extracted so the sync and async runners share it rather than each carrying a copy: a
 * second scoring rule is a second definition of what passing means, and the whole claim
 * of `npm run eval -- --live` is that it scores the model against **the same** set the
 * same way.
 */
function scoreInterpreted(
  evalCase: Exclude<EvalCase, { kind: "amendment" }>,
  actual: ResolveResult,
  layer: SemanticLayer,
  locale: string,
): CaseResult {
  if (evalCase.kind === "rejection") {
    // Invariant 4, scored: an undeclared question becomes a clarifying question that names
    // the gap and offers questions that work — never a nearest match.
    const passed =
      !actual.ok &&
      actual.rejection.missing.length > 0 &&
      actual.rejection.declared.measures.length > 0 &&
      actual.rejection.nearest.length > 0;
    return {
      id: evalCase.id,
      kind: evalCase.kind,
      subject: evalCase.question,
      passed,
      finding: passed ? null : explain(evalCase, layer, actual, null, locale),
    };
  }

  const expected = expandExpected(evalCase.expect.spec, layer);
  const passed = actual.ok && specsEqual(expected, actual.spec);
  return {
    id: evalCase.id,
    kind: evalCase.kind,
    subject: evalCase.question,
    passed,
    finding: passed ? null : explain(evalCase, layer, actual, expected, locale),
  };
}

/**
 * The keyless runner, and the one `npm run eval` takes.
 *
 * It stays synchronous on purpose. This is the loop the layer acquires structure
 * through, so it has to run in CI, on a clean clone and with no key — and a synchronous
 * signature is the cheapest way to keep it obvious that nothing here awaits a network.
 * An interpreter that returns a promise is a caller error with a named fix, never a
 * silently unresolved `Promise` scored as a failure.
 */
export function runCase(evalCase: EvalCase, options: RunOptions): CaseResult {
  const { layer, locale = "en", interpret = parseQuestion } = options;

  if (evalCase.kind === "amendment") return scoreAmendment(evalCase, layer, locale);

  const actual = interpret(evalCase.question, layer, locale);
  if (actual instanceof Promise) {
    throw new Error(
      `runCase() is synchronous and this interpreter returned a promise — use runCasesAsync() for the model path`,
    );
  }
  return scoreInterpreted(evalCase, actual, layer, locale);
}

export function runCases(cases: readonly EvalCase[], options: RunOptions): CaseResult[] {
  return cases.map((evalCase) => runCase(evalCase, options));
}

/** The same scoring, awaiting an interpreter that calls out. Used by `--live`. */
export async function runCaseAsync(evalCase: EvalCase, options: RunOptions): Promise<CaseResult> {
  const { layer, locale = "en", interpret = parseQuestion } = options;

  if (evalCase.kind === "amendment") return scoreAmendment(evalCase, layer, locale);

  return scoreInterpreted(
    evalCase,
    await interpret(evalCase.question, layer, locale),
    layer,
    locale,
  );
}

/**
 * Sequential, deliberately.
 *
 * The set is twenty cases, and firing them at once buys seconds while risking a rate
 * limit that would score a case as a failure for a reason that has nothing to do with
 * interpretation. A score the run cannot stand behind is worse than a slow one.
 */
export async function runCasesAsync(
  cases: readonly EvalCase[],
  options: RunOptions,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const evalCase of cases) results.push(await runCaseAsync(evalCase, options));
  return results;
}

/** One JSON object per line; `#` comments and blank lines are skipped. */
export function parseCases(text: string, source = "questions.jsonl"): EvalCase[] {
  return text
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line !== "" && !line.startsWith("#"))
    .map(({ line, number }) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (cause) {
        throw new Error(`${source}:${number} is not valid JSON: ${String(cause)}`);
      }
      const parsed = EvalCaseSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `${source}:${number} is not a valid eval case: ${issue?.path.join(".") ?? "(root)"} — ${issue?.message ?? "failed validation"}`,
        );
      }
      return parsed.data;
    });
}

export function loadCases(filePath: string): EvalCase[] {
  return parseCases(readFileSync(filePath, "utf8"), filePath);
}

export function loadBaseline(filePath: string): Baseline {
  return BaselineSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}

/**
 * Is `passed/total` at least the baseline's ratio?
 *
 * Cross-multiplied rather than compared as decimals: a score is a rational, and a run that
 * exactly matches the baseline must never fail on a float's last bit.
 */
export function meetsBaseline(passed: number, total: number, baseline: Baseline): boolean {
  return passed * baseline.cases >= baseline.passed * total;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

export function formatReport(
  results: readonly CaseResult[],
  options: { layer: SemanticLayer; locale: string; path: string; baseline: Baseline | null },
): string {
  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  const idWidth = Math.max(...results.map((result) => result.id.length), 2);
  const kindWidth = Math.max(...results.map((result) => result.kind.length), 4);

  const lines = [
    `GA-05 eval — ${options.path}`,
    `semantic layer ${options.layer.version} (schema ${options.layer.schemaVersion}) · locale ${options.locale} · ${total} cases`,
    "",
  ];

  for (const result of results) {
    lines.push(
      `  ${result.passed ? "PASS" : "FAIL"}  ${pad(result.id, idWidth)}  ${pad(result.kind, kindWidth)}  ${result.subject}`,
    );
    if (result.finding !== null) lines.push(`        → ${result.finding}`);
  }

  const score = total === 0 ? 0 : passed / total;
  lines.push("");
  lines.push(`score ${score.toFixed(3)} (${passed}/${total})`);
  if (options.baseline !== null) {
    const baselineScore = options.baseline.passed / options.baseline.cases;
    lines.push(
      `baseline ${baselineScore.toFixed(3)} (${options.baseline.passed}/${options.baseline.cases}) on layer ${options.baseline.layerVersion} — ${options.baseline.setFrom}`,
    );
  }

  return lines.join("\n");
}
