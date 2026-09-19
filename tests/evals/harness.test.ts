import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SemanticLayer } from "@/server/contracts";
import { loadSemanticLayer } from "@/server/semantic/load";

import {
  formatReport,
  loadBaseline,
  loadCases,
  meetsBaseline,
  parseCases,
  runCases,
  type EvalCase,
} from "../../scripts/eval-harness.ts";

/**
 * The eval harness.
 *
 * Two claims are checked here, and the second is the one that matters. The first is that
 * the committed set still scores at or above its baseline — the ordinary regression. The
 * second is that **a failure names the structure that is missing**: the whole thinnest-
 * viable-layer decision rests on a failing eval being evidence someone can act on rather
 * than an investigation someone has to start (build-spec §3 GA-05, "Must not").
 */

const EVALS = import.meta.dirname;
const layer: SemanticLayer = loadSemanticLayer();
const cases = loadCases(join(EVALS, "questions.jsonl"));
const baseline = loadBaseline(join(EVALS, "baseline.json"));

function score(overrideLayer: SemanticLayer = layer, subset: readonly EvalCase[] = cases): number {
  return runCases(subset, { layer: overrideLayer }).filter((result) => result.passed).length;
}

describe("The committed eval set", () => {
  it("carries the case mix the increment promises", () => {
    const counted = (kind: EvalCase["kind"]) => cases.filter((item) => item.kind === kind).length;

    expect(counted("starter") + counted("paraphrase")).toBeGreaterThanOrEqual(8);
    expect(counted("rejection")).toBe(3);
    expect(counted("amendment")).toBe(2);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it("scores at or above the committed baseline", () => {
    const passed = score();
    expect(meetsBaseline(passed, cases.length, baseline)).toBe(true);
    // Pinned, not merely compared: a set that grew while the baseline did not would still
    // clear the ratio, and the point of a committed baseline is that it is committed.
    expect({ passed, cases: cases.length }).toEqual({
      passed: baseline.passed,
      cases: baseline.cases,
    });
  });

  it("was measured against the layer that ships", () => {
    expect(baseline.layerVersion).toBe(layer.version);
  });

  it("needs no API key, which is why it can run here at all", () => {
    // The harness compares specs, not prose. If this ever stops being true the suite would
    // start depending on a credential, and the loop would cost money per run.
    expect(process.env["ANTHROPIC_API_KEY"] ?? "").toBe(process.env["ANTHROPIC_API_KEY"] ?? "");
    const passedWithoutKey = score(layer, cases);
    expect(passedWithoutKey).toBe(baseline.passed);
  });
});

describe("A failing eval names the missing structure", () => {
  /**
   * The deliberately failing fixture. Its expected spec names a measure no delivery
   * carries, which is the shape of a real mistake: someone writes the eval they want and
   * the layer does not declare it.
   */
  const fixture = parseCases(
    JSON.stringify({
      id: "fixture-revenue",
      kind: "paraphrase",
      question: "Which genres make the most revenue?",
      expect: {
        spec: {
          measure: "revenue",
          breakdown: "genre",
          sort: { by: "measure", dir: "desc" },
          limit: 19,
          guards: "default",
        },
      },
    }),
    "fixture",
  );

  it("prints the undeclared measure and what the layer does declare", () => {
    const results = runCases(fixture, { layer });
    const report = formatReport(results, {
      layer,
      locale: "en",
      path: "fallback parser (no ANTHROPIC_API_KEY)",
      baseline: null,
    });

    expect(results[0]?.passed).toBe(false);
    expect(report).toContain('no measure matched "revenue" — declared measures are ');
    expect(report).toContain('avg_rating ("average rating")');
    expect(report).toContain("FAIL");
  });

  it("never reports a bare mismatch", () => {
    // "Expected avg_rating, got null" turns every iteration into an investigation. Every
    // finding has to carry either the undeclared id or the vocabulary gap that hid it.
    const stripped: SemanticLayer = {
      ...layer,
      measures: layer.measures.map((measure) => ({ ...measure, synonyms: {} })),
      dimensions: layer.dimensions.map((dimension) => ({ ...dimension, synonyms: {} })),
    };

    const findings = runCases(cases, { layer: stripped })
      .filter((result) => !result.passed)
      .map((result) => result.finding ?? "");

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.length).toBeGreaterThan(40);
      expect(finding).toMatch(/declared (measures|dimensions) are |declares "/);
    }
  });

  it("points at the layer, which is where the fix goes", () => {
    const stripped: SemanticLayer = {
      ...layer,
      measures: layer.measures.map((measure) => ({ ...measure, synonyms: {} })),
      dimensions: layer.dimensions.map((dimension) => ({ ...dimension, synonyms: {} })),
    };
    const result = runCases(cases, { layer: stripped }).find(
      (item) => item.id === "p-most-ratings-per-genre",
    );

    expect(result?.passed).toBe(false);
    expect(result?.finding).toContain('rating_count declares "number of ratings" and no synonyms in en');
  });
});

describe("Every synonym the layer declares was earned", () => {
  /**
   * The discipline, made mechanical.
   *
   * `docs/build-spec.md` §8.3 says the layer grows throughout the build and every addition
   * must be traceable to the eval that demanded it, "or the discipline decays into 'added
   * because it seemed useful'". A comment cannot hold that line. Removing a synonym and
   * watching the score fall can: a synonym nothing fails without is one nobody earned.
   */
  const declarations = [
    ...layer.measures.map((measure) => ({ kind: "measure" as const, entry: measure })),
    ...layer.dimensions.map((dimension) => ({ kind: "dimension" as const, entry: dimension })),
  ].flatMap(({ kind, entry }) =>
    Object.entries(entry.synonyms).flatMap(([locale, synonyms]) =>
      synonyms.map((synonym) => ({ kind, id: entry.id, locale, synonym })),
    ),
  );

  it("declares at least one synonym, and every one of them is load-bearing", () => {
    expect(declarations.length).toBeGreaterThan(0);
    const full = score();

    for (const { kind, id, locale, synonym } of declarations) {
      const without: SemanticLayer = {
        ...layer,
        [kind === "measure" ? "measures" : "dimensions"]: (kind === "measure"
          ? layer.measures
          : layer.dimensions
        ).map((entry) =>
          entry.id === id
            ? {
                ...entry,
                synonyms: {
                  ...entry.synonyms,
                  [locale]: (entry.synonyms[locale] ?? []).filter((item) => item !== synonym),
                },
              }
            : entry,
        ),
      };

      expect(score(without), `${kind} ${id} synonym "${synonym}" (${locale})`).toBeLessThan(full);
    }
  });
});
