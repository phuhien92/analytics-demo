import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GUARD_REGISTRY, REGISTERED_GUARD_IDS } from "@/server/semantic/guards/registry";
import {
  SEMANTIC_LAYER_PATH,
  SemanticLayerError,
  loadSemanticLayer,
  parseSemanticLayer,
} from "@/server/semantic/load";

const shippedLayerText = readFileSync(join(process.cwd(), SEMANTIC_LAYER_PATH), "utf8");

/** The shipped layer is the fixture. Every failure case below perturbs one field of it. */
function shippedLayer(): Record<string, unknown> {
  return JSON.parse(shippedLayerText) as Record<string, unknown>;
}

describe("The shipped layer", () => {
  it("loads, and carries a version", () => {
    const layer = loadSemanticLayer();

    expect(layer.version).toBeTypeOf("string");
    expect(layer.version.length).toBeGreaterThan(0);
    expect(layer.schemaVersion).toBe(1);
  });

  // Thinnest viable, asserted rather than intended: five measures and five dimensions,
  // and every later addition is earned by a failing eval in GA-05 rather than anticipated.
  it("declares five measures and five dimensions, `en` only", () => {
    const layer = loadSemanticLayer();

    expect(layer.measures.map((measure) => measure.id)).toEqual([
      "avg_rating",
      "rating_count",
      "viewer_count",
      "title_count",
      "share_rated_4_plus",
    ]);
    expect(layer.dimensions.map((dimension) => dimension.id)).toEqual([
      "title",
      "genre",
      "release_year",
      "release_decade",
      "rating_year",
    ]);

    for (const entry of [...layer.measures, ...layer.dimensions]) {
      expect(Object.keys(entry.labels), entry.id).toEqual(["en"]);
    }
  });

  /**
   * Volume is earned by a failing eval, never by anticipation — a plausible-looking synonym
   * is the cheapest thing in the build to add on a hunch.
   *
   * GA-03 held that line by asserting the layer shipped **no** synonyms at all, which was
   * the only latch available before a harness existed. GA-05 built the harness and the
   * first five synonyms were earned by named cases, so the latch moved rather than
   * disappeared: `tests/evals/harness.test.ts` now removes each declared synonym in turn
   * and requires the eval score to fall. A synonym nothing fails without is one nobody
   * earned, and that is a stronger statement than a count.
   *
   * What stays here is the *shape*: locale-keyed, `en` only in v1 (invariant 8).
   */
  it("declares synonyms locale-keyed, for the one locale v1 ships", () => {
    const layer = loadSemanticLayer();

    for (const entry of [...layer.measures, ...layer.dimensions]) {
      expect(Object.keys(entry.synonyms).filter((locale) => locale !== "en"), entry.id).toEqual([]);
      for (const synonym of entry.synonyms["en"] ?? []) {
        expect(synonym, entry.id).toBe(synonym.toLowerCase().trim());
        expect(synonym.length, entry.id).toBeGreaterThan(0);
      }
    }
  });

  // The whole point of the layer being data. A "filters" key would parse as an
  // unrecognised key against the strictObject contract, so this is the contract holding.
  it("ships no filter vocabulary", () => {
    expect(() => parseSemanticLayer({ ...shippedLayer(), filters: [] })).toThrow(SemanticLayerError);
  });

  /**
   * Measured on this file, not estimated: **2,363 bytes pretty-printed against 1,719
   * minified — 644 bytes of whitespace**. The build spec guessed ~370 before the file
   * existed; the shipped file's explanations made it larger. GA-03 measured 2,157 against
   * 1,568; GA-05's five earned synonyms are the difference, and the figure is re-measured
   * here rather than left to drift, because a measured number that no longer matches its
   * file is the kind of claim this product exists to argue against.
   *
   * That difference is why this is a test and not a style preference. The layer is the
   * head of the cached prompt prefix, and Opus 5 does not cache a prefix under 512
   * tokens. At roughly four characters per token the pretty file is ~540 tokens and the
   * minified one ~390: pretty-printed it clears the floor, minified it does not. Dropping
   * under the floor **fails silently** — no error, no warning, just every question paying
   * uncached prefix cost forever. Nothing downstream can detect it.
   */
  it("is pretty-printed, which is what keeps it above the prompt-cache floor", () => {
    expect(shippedLayerText).toContain("\n");

    const minified = JSON.stringify(JSON.parse(shippedLayerText));
    expect(Buffer.byteLength(shippedLayerText)).toBeGreaterThan(Buffer.byteLength(minified));
  });
});

describe("The guard registry", () => {
  // C4 settled that the thirteen undated titles are disclosed in the trust report's
  // coverage line rather than given a fifth guard: they carry 18 of 100,836 ratings
  // (0.018%) and none clears `min_evidence`. This assertion is the decision's latch — a
  // fifth guard cannot arrive without someone deleting a test that says why.
  it("holds exactly four guards", () => {
    expect(REGISTERED_GUARD_IDS).toEqual([
      "disclose_multi_membership",
      "exclude_uncategorised",
      "exclude_unrated",
      "min_evidence",
    ]);
    expect(REGISTERED_GUARD_IDS).toHaveLength(4);
  });

  // Thresholds arrive in the spec's `params`, defaulted by the layer. A number here would
  // put a dataset's measurement inside the dataset-agnostic half of the build.
  it("hardcodes no threshold", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "server", "semantic", "guards", "registry.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/\b20\b/);
    expect(GUARD_REGISTRY["min_evidence"]?.params).toEqual(["minObservations"]);
  });

  it("declares every guard the shipped layer names", () => {
    const layer = loadSemanticLayer();

    expect(layer.guards.map((guard) => guard.id).sort()).toEqual([...REGISTERED_GUARD_IDS]);
    expect(layer.guards.find((guard) => guard.id === "min_evidence")?.defaultParams).toEqual({
      minObservations: 20,
    });
  });
});

describe("The loader fails fast, and points at the path", () => {
  it("rejects a GuardId absent from the registry, naming the id", () => {
    const layer = shippedLayer();
    layer["guards"] = [
      {
        id: "min_reviews",
        labels: { en: "minimum reviews" },
        explanation: { en: "Checked something." },
        defaultParams: {},
      },
    ];

    expect(() => parseSemanticLayer(layer, "layer.json")).toThrowError(
      /layer\.json: guards\[0\]\.id — "min_reviews" is not in the guard registry/,
    );
  });

  // Flat is shape, not volume: it costs a schema, prompt and matching rewrite, and every
  // eval passes against a flat layer right up until the first non-English locale — so the
  // eval loop cannot warn about this one in time. This test is the warning.
  it("rejects a flat, non-locale-keyed label, naming the path", () => {
    const layer = shippedLayer();
    const measures = layer["measures"] as Array<Record<string, unknown>>;
    measures[0] = { ...measures[0], labels: "average rating" };

    expect(() => parseSemanticLayer(layer, "layer.json")).toThrowError(
      /layer\.json: measures\[0\]\.labels — /,
    );
  });

  it("rejects a defaultTieBreak that is not a declared dimension", () => {
    const layer = { ...shippedLayer(), defaultTieBreak: "titel" };

    expect(() => parseSemanticLayer(layer, "layer.json")).toThrowError(
      /layer\.json: defaultTieBreak — "titel" is not a declared dimension \(declared: genre, rating_year, release_decade, release_year, title\)/,
    );
  });

  // A threshold under a key no guard reads is worse than a missing one: the guard still
  // runs, unthresholded, and nothing says so. That is the silent coercion invariant 4
  // exists to remove, arriving through the layer rather than through the model.
  it("rejects a defaultParam no guard reads, naming the parameter", () => {
    const layer = shippedLayer();
    const guards = layer["guards"] as Array<Record<string, unknown>>;
    guards[0] = { ...guards[0], defaultParams: { minRatingsPerTitle: 20 } };

    expect(() => parseSemanticLayer(layer, "layer.json")).toThrowError(
      /layer\.json: guards\[0\]\.defaultParams\.minRatingsPerTitle — the "min_evidence" guard reads no such parameter \(reads: minObservations\)/,
    );
  });

  it("rejects a layer that is not JSON at all, naming the file", () => {
    expect(() => loadSemanticLayer(join(process.cwd(), "semantic", "nope.json"))).toThrowError(
      /nope\.json: \(file\) — could not be read/,
    );
  });
});
