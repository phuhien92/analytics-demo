import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadSemanticLayer } from "@/server/semantic/load";

import {
  BaselineSchema,
  formatReport,
  loadBaseline,
  loadCases,
  meetsBaseline,
  runCases,
  type Baseline,
} from "./eval-harness.ts";

/**
 * `npm run eval` — the scored eval runner.
 *
 * **It needs no API key, and that is the point** (build-spec §3 GA-05, "Must not"). It
 * compares interpreted specs against written-down ones, so it runs in CI, on a clean
 * clone, and before any model call exists. It calls nothing and costs nothing, because a
 * loop that costs money per run is a loop that gets run less often — and under the
 * thinnest-viable semantic layer this loop is how the layer acquires structure.
 *
 * Exit codes: `0` ran, `1` scored below the committed baseline under `--check-baseline`,
 * `2` the invocation was wrong.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const CASES = join(ROOT, "tests", "evals", "questions.jsonl");
const BASELINE = join(ROOT, "tests", "evals", "baseline.json");

const USAGE = `usage: npm run eval [-- <options>]

  --check-baseline   exit 1 if the score is below tests/evals/baseline.json
  --update-baseline  rewrite the baseline from this run; --set-from is then required
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

const KNOWN = new Set(["check-baseline", "update-baseline", "set-from", "locale", "json"]);
for (const name of flags.keys()) {
  // `--live` arrives with GA-08, which owns the model path. Refusing it here rather than
  // accepting it silently keeps "this run used no model" a fact the exit code carries.
  if (!KNOWN.has(name)) fail(`unknown option "--${name}"`);
}

const locale = flags.get("locale") || "en";
const layer = loadSemanticLayer();
const cases = loadCases(CASES);
const results = runCases(cases, { layer, locale });
const passed = results.filter((result) => result.passed).length;

let baseline: Baseline | null = null;
try {
  baseline = loadBaseline(BASELINE);
} catch (cause) {
  if (flags.has("check-baseline")) fail(`could not read ${BASELINE}: ${String(cause)}`);
}

if (flags.has("json")) {
  process.stdout.write(
    `${JSON.stringify({ path: "fallback parser (no ANTHROPIC_API_KEY)", layerVersion: layer.version, locale, passed, cases: results.length, results }, null, 2)}\n`,
  );
} else {
  process.stdout.write(
    `${formatReport(results, { layer, locale, path: "fallback parser (no ANTHROPIC_API_KEY)", baseline })}\n`,
  );
}

if (flags.has("update-baseline")) {
  const setFrom = flags.get("set-from");
  if (setFrom === undefined || setFrom === "") {
    fail("--update-baseline requires --set-from=<what this score was measured from>");
  }
  const written = BaselineSchema.parse({
    path: "fallback",
    passed,
    cases: results.length,
    layerVersion: layer.version,
    setFrom,
  });
  writeFileSync(BASELINE, `${JSON.stringify(written, null, 2)}\n`, "utf8");
  process.stdout.write(`\nwrote ${BASELINE}\n`);
}

if (flags.has("check-baseline")) {
  if (baseline === null) fail(`could not read ${BASELINE}`);
  if (!meetsBaseline(passed, results.length, baseline)) {
    process.stderr.write(
      `\nscore ${passed}/${results.length} is below the committed baseline ${baseline.passed}/${baseline.cases}\n`,
    );
    process.exit(1);
  }
  process.stdout.write("\nat or above the committed baseline\n");
}
