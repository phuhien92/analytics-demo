import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SemanticLayer } from "@/server/contracts";
import { RejectionSchema } from "@/server/contracts";
import { STARTER_QUESTIONS, matchStarter, parseQuestion } from "@/server/ai/fallback-parser";
import { execute } from "@/server/engine/execute";
import { resolveSpec } from "@/server/engine/resolve";
import { loadSemanticLayer } from "@/server/semantic/load";
import { LocalStoreWarehouse } from "@/server/warehouse/local-store";

import { buildStore } from "../src/server/ingest/build-store.ts";
import { readPayload } from "../src/server/ingest/read-payload.ts";

/**
 * The rejection path.
 *
 * This is where "the AI never computes the number" stops being a promise about what the
 * model is asked to do and becomes a property of the shape: a question the semantic layer
 * cannot answer **returns** a clarifying question (invariant 4). It is a returned value and
 * never a throw, because an exception cannot carry the clarification or its options — it
 * gets caught somewhere generic and rendered as an error, which is the product failing
 * rather than the product working.
 *
 * Every assertion here is on the returned object. A test that only asserted `toThrow()`
 * would pass against exactly the design this increment exists to avoid.
 */

const DATA_DIR = join(import.meta.dirname, "..", "data");
const warehouse = new LocalStoreWarehouse(buildStore([readPayload(DATA_DIR)]).store);
const layer: SemanticLayer = loadSemanticLayer();

/** An as-of the store can answer. Every case pins one; none is left to "latest". */
const AS_OF = "2018-09-25T00:00:00.000Z";

describe("An undeclared question returns a clarifying question", () => {
  it("does not throw — the refusal is a value the caller renders", () => {
    expect(() => parseQuestion("How much revenue did each genre make?", layer)).not.toThrow();
    expect(() => resolveSpec({ measure: "revenue" }, layer, "revenue?")).not.toThrow();
  });

  it("names what is missing, what is declared, and questions that do work", () => {
    const result = parseQuestion("How much revenue did each genre make?", layer);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // The whole object validates, so nothing downstream has to defend against a half-built
    // rejection — the route returns this shape at HTTP 200 from GA-07.
    expect(() => RejectionSchema.parse(result.rejection)).not.toThrow();

    expect(result.rejection.missing.length).toBeGreaterThan(0);
    expect(result.rejection.declared.measures).toContain("avg_rating");
    expect(result.rejection.declared.dimensions).toContain("genre");
    expect(result.rejection.nearest.length).toBeGreaterThanOrEqual(1);
    expect(result.rejection.asked).toBe("How much revenue did each genre make?");
  });

  it("offers nearest questions whose specs execute", async () => {
    const result = parseQuestion("How much revenue did each genre make?", layer);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // The claim the clarifying question makes is that these *work*. Asserting they parse
    // would not check it: a spec can validate and still name something the adapter cannot
    // compute, which is the difference between a suggestion and an offer.
    for (const nearest of result.rejection.nearest) {
      const resultSet = await execute(
        { ...nearest.spec, asOf: AS_OF },
        { warehouse, layer, requestId: `req-${nearest.spec.measure}`, computedAt: AS_OF },
      );
      expect(resultSet.rows.length, nearest.question).toBeGreaterThan(0);
      expect(resultSet.provenance.resolvedAsOf).toBe(AS_OF);
    }
  });

  it("names an undeclared dimension rather than dropping it", () => {
    const result = parseQuestion("Who directed our top rated movies?", layer);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.declared.dimensions).not.toContain("director");
    // What it must never do is answer "top rated movies" and quietly lose "directed".
    expect(result.rejection.nearest.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses a question whose declared vocabulary it can read but whose direction it cannot", () => {
    // Every word is declared: "ratings" reaches rating_count, "genres" reaches genre. The
    // catalogue declares no ascending ranking, so answering with the descending one would
    // be a nearest match — the exact failure invariant 4 exists to remove.
    const outcome = matchStarter("Which genres have the fewest ratings?", layer);
    expect(outcome.matched).toBe(false);
    if (outcome.matched) return;
    expect(outcome.miss.reason).toBe("contrary-term");
    expect(outcome.miss.term).toBe("fewest");
    expect(outcome.miss.candidates).toEqual(["ratings-by-genre"]);

    const result = parseQuestion("Which genres have the fewest ratings?", layer);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.missing[0]?.what).toContain("fewest");
  });

  it("refuses an undeclared guard in a spec without throwing", () => {
    const result = resolveSpec(
      { measure: "avg_rating", breakdown: "title", guards: [{ id: "min_revenue", params: {} }] },
      layer,
      "guarded by something undeclared",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.missing).toContainEqual({ what: "min_revenue", kind: "guard" });
  });
});

describe("The fallback parser refuses rather than guesses", () => {
  it("answers every starter question it declares", () => {
    for (const starter of STARTER_QUESTIONS) {
      const question = starter.questions["en"];
      expect(question, starter.id).toBeDefined();
      const result = parseQuestion(question ?? "", layer);
      expect(result.ok, starter.id).toBe(true);
      if (!result.ok) continue;
      expect(result.spec.measure, starter.id).toBe(starter.measure);
      expect(result.spec.breakdown, starter.id).toBe(starter.breakdown);
      // The layer declares the tie-break; nothing else may choose one (invariant, architecture §2).
      expect(result.spec.sort.tieBreak, starter.id).toBe(layer.defaultTieBreak);
      // Guards default to on. An unguarded answer has to be asked for.
      expect(result.spec.guards.map((guard) => guard.id), starter.id).toEqual(
        layer.guards.map((guard) => guard.id),
      );
    }
  });

  it("is insensitive to case, punctuation and spacing, and to nothing else", () => {
    const answered = parseQuestion("  WHAT ARE OUR TOP-RATED   TITLES  ", layer);
    expect(answered.ok).toBe(true);

    // One word away from a starter question is not a starter question. There is no
    // edit-distance fallback, because "nearly" is where a nearest match comes from.
    const refused = parseQuestion("What are our top rated directors?", layer);
    expect(refused.ok).toBe(false);
  });

  it("never throws, whatever it is handed", () => {
    const inputs = ["", "   ", "?!.,", "a".repeat(5_000), "🎬🎬🎬", "SELECT * FROM ratings"];
    for (const input of inputs) {
      expect(() => parseQuestion(input, layer), JSON.stringify(input.slice(0, 20))).not.toThrow();
      expect(parseQuestion(input, layer).ok, JSON.stringify(input.slice(0, 20))).toBe(false);
    }
  });

  it("refuses a locale the layer does not declare rather than falling back to en", () => {
    // Understanding is locale-dependent, because synonyms are (invariant 8). Silently
    // reading `en` vocabulary for a `de` question would be a coercion no one could see.
    const result = parseQuestion("What are our top rated titles?", layer, "de");
    expect(result.ok).toBe(false);
  });
});
