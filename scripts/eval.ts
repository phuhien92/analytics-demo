import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { aiMode } from "@/server/ai/mode";
import { loadSemanticLayer } from "@/server/semantic/load";

import {
  BaselineSchema,
  formatReport,
  loadBaseline,
  loadCases,
  meetsBaseline,
  runCases,
  runCasesAsync,
  type Baseline,
  type CaseResult,
} from "./eval-harness.ts";

/**
 * `npm run eval` — the scored eval runner.
 *
 * **The default needs no API key, and that is the point** (build-spec §3 GA-05, "Must
 * not"). It compares interpreted specs against written-down ones, so it runs in CI, on a
 * clean clone, and with no model in existence. It calls nothing and costs nothing,
 * because a loop that costs money per run is a loop that gets run less often — and under
 * the thinnest-viable semantic layer this loop is how the layer acquires structure.
 *
 * `--live` scores the **same set, the same way** against GA-08's model path. It is opt-in
 * and it is the only thing here that spends anything: without a key it refuses rather
 * than quietly scoring the fallback and labelling it as the model, because a live score
 * that was never live is the confident wrong answer this product exists to catch, aimed
 * at its own evidence.
 *
 * Exit codes: `0` ran, `1` scored below the committed baseline under `--check-baseline`,
 * `2` the invocation was wrong — including `--live` with no key.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const CASES = join(ROOT, "tests", "evals", "questions.jsonl");

/**
 * Two baselines, in two files, **beside** each other (build-spec §3 GA-08, "Done when").
 *
 * The model path and the fallback path score the same twenty cases and will not agree —
 * that disagreement is the measurement. One file holding whichever ran last would erase
 * it, and `--update-baseline` on a live run would silently redefine what the keyless
 * regression is checked against. So the live score is recorded in a sibling file, each
 * one carrying the `path` that produced it.
 */
const BASELINES = {
  fallback: join(ROOT, "tests", "evals", "baseline.json"),
  model: join(ROOT, "tests", "evals", "baseline.live.json"),
} as const;

const USAGE = `usage: npm run eval [-- <options>]

  --live             score the model path instead of the fallback parser; needs a key
                     and spends money. Refuses rather than degrades when there is none
  --check-baseline   exit 1 if the score is below this path's committed baseline
                     (tests/evals/baseline.json, or baseline.live.json under --live)
  --update-baseline  rewrite that baseline from this run; --set-from is then required
  --set-from=<text>  what the new baseline was set from, recorded in the file
  --locale=<code>    the locale to interpret in (default: en)
  --json             emit the results as JSON instead of a table
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exit(2);
}

const flags = new Map<string, string>();
for (const argument of process.argv.slice(2)) {
  if (!argument.startsWith("--")) fail(`unexpected argument "${argument}"`);
  const [name, ...rest] = argument.slice(2).split("=");
  if (name === undefined || name === "") fail(`unexpected argument "${argument}"`);
  flags.set(name, rest.join("="));
}

const KNOWN = new Set(["live", "check-baseline", "update-baseline", "set-from", "locale", "json"]);
for (const name of flags.keys()) {
  if (!KNOWN.has(name)) fail(`unknown option "--${name}"`);
}

const locale = flags.get("locale") || "en";
const layer = loadSemanticLayer();
const cases = loadCases(CASES);
const live = flags.has("live");

const baselinePath = BASELINES[live ? "model" : "fallback"];

/**
 * Which interpreter this run scored, named in the report.
 *
 * The two paths are labelled differently on purpose: a score that does not say which
 * interpreter produced it is a number nobody can reproduce, and the model path and the
 * fallback path will not agree — that difference is the measurement, not noise.
 */
let path = "fallback parser (no ANTHROPIC_API_KEY)";
let results: CaseResult[];

if (live) {
  // A refusal, not a degrade. Falling back here would print a model score that no model
  // produced, which is precisely the unauditable confident answer the product argues
  // against — so the absent key is an invocation error and the exit code says so.
  if (aiMode() !== "live") {
    fail("--live needs ANTHROPIC_API_KEY set to a usable key; this run would have called nothing");
  }
  // Dynamic, like the route's: the default invocation must not carry the SDK into a run
  // that never calls it, and the model id belongs to the module that pins it.
  const { liveInterpreter, INTERPRET_MODEL } = await import("@/server/ai/interpret");
  path = `model (${INTERPRET_MODEL})`;
  results = await runCasesAsync(cases, { layer, locale, interpret: liveInterpreter() });
} else {
  results = runCases(cases, { layer, locale });
}

const passed = results.filter((result) => result.passed).length;

let baseline: Baseline | null = null;
try {
  baseline = loadBaseline(baselinePath);
} catch (cause) {
  if (flags.has("check-baseline")) fail(`could not read ${baselinePath}: ${String(cause)}`);
}

if (flags.has("json")) {
  process.stdout.write(
    `${JSON.stringify({ path, layerVersion: layer.version, locale, passed, cases: results.length, results }, null, 2)}\n`,
  );
} else {
  process.stdout.write(`${formatReport(results, { layer, locale, path, baseline })}\n`);
}

if (flags.has("update-baseline")) {
  const setFrom = flags.get("set-from");
  if (setFrom === undefined || setFrom === "") {
    fail("--update-baseline requires --set-from=<what this score was measured from>");
  }
  const written = BaselineSchema.parse({
    path: live ? "model" : "fallback",
    passed,
    cases: results.length,
    layerVersion: layer.version,
    setFrom,
  });
  writeFileSync(baselinePath, `${JSON.stringify(written, null, 2)}\n`, "utf8");
  process.stdout.write(`\nwrote ${baselinePath}\n`);
}

if (flags.has("check-baseline")) {
  if (baseline === null) fail(`could not read ${baselinePath}`);
  if (!meetsBaseline(passed, results.length, baseline)) {
    process.stderr.write(
      `\nscore ${passed}/${results.length} is below the committed baseline ${baseline.passed}/${baseline.cases}\n`,
    );
    process.exit(1);
  }
  process.stdout.write("\nat or above the committed baseline\n");
}
