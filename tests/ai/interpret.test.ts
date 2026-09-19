import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ModelQuerySpecSchema, type SemanticLayer } from "@/server/contracts";
import {
  CACHE_FLOOR_TOKENS,
  CHARS_PER_TOKEN_ESTIMATE,
  FEW_SHOT_MINIMUM,
  INTERPRET_EFFORT,
  INTERPRET_MODEL,
  createInterpreter,
  fewShotExamples,
  interpretRequest,
  prefixSize,
  stablePrefix,
  type InterpretClient,
} from "@/server/ai/interpret";
import { loadSemanticLayer } from "@/server/semantic/load";

/**
 * The interpret call, asserted against **the request it constructs** rather than against
 * a live response.
 *
 * That is the whole design of this file and it is not a compromise. The properties that
 * make prompt caching work are properties of the request — a prefix that is byte-identical
 * across questions, a breakpoint at its end, the question after it — and a live reading of
 * `cache_read_input_tokens` can only ever *confirm* them after the fact. Asserting the
 * request means the cost regression that has no error message (`docs/architecture.md` §3)
 * is caught on every clone, in CI, and with no key and no spend. The live confirmation
 * exists too and is opt-in: `tests/ai/live-interpret.test.ts`.
 *
 * The same argument runs through the rest of the build: the QuerySpec is the contract, and
 * the eval harness compares specs rather than prose precisely so it needs nothing.
 */

const layer: SemanticLayer = loadSemanticLayer();
const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "..", "src", "server", "ai", "interpret.ts"),
  "utf8",
);

/** Comments stripped, so the greps below are about the code and not about its prose. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** A client that records what it was handed and returns whatever the case needs. */
function stubClient(parsed: unknown): InterpretClient & {
  readonly calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    messages: {
      parse: async (params) => {
        calls.push(params);
        return { parsed_output: parsed };
      },
    },
  };
}

describe("the request that gets sent", () => {
  it("is addressed to the model the architecture pins, at low effort", () => {
    const request = interpretRequest("anything", layer);

    expect(request.model).toBe(INTERPRET_MODEL);
    expect(INTERPRET_MODEL).toBe("claude-opus-5");
    // Extraction-shaped, not reasoning-heavy (`docs/architecture.md` §6).
    expect(request.output_config?.effort).toBe(INTERPRET_EFFORT);
    expect(INTERPRET_EFFORT).toBe("low");
  });

  it("carries a JSON-schema output format, which is how the model is held to the contract", () => {
    const format = interpretRequest("anything", layer).output_config?.format;

    expect(format?.type).toBe("json_schema");
    expect(format?.schema).toBeTypeOf("object");
  });

  it("uses neither output_format nor an assistant prefill", () => {
    const request = interpretRequest("anything", layer);

    // `output_format` is gone from the SDK's type surface and prefill returns 400 on
    // Opus 5, so both are compile errors rather than runtime ones — but a request
    // rebuilt by hand later would not be, and the grep is what notices.
    expect(Object.keys(request)).not.toContain("output_format");
    expect(CODE).not.toMatch(/output_format/);
    expect(request.messages.every((message) => message.role === "user")).toBe(true);
  });

  it("puts the question in messages and nowhere else", () => {
    const question = "how many ratings did each genre get in 2016";
    const request = interpretRequest(question, layer);

    expect(request.messages).toEqual([{ role: "user", content: question }]);

    // If the question reached `system`, every request would have a different prefix and
    // nothing would ever cache — silently, since there is no error for that.
    const system = request.system as { text: string }[];
    for (const block of system) expect(block.text).not.toContain(question);
  });
});

describe("the cached prefix", () => {
  /**
   * The property caching actually rests on, and the one a live reading can only confirm.
   *
   * Prompt caching is a *prefix match*: any byte that differs anywhere before the
   * breakpoint invalidates everything after it. So the check is byte equality of the
   * whole `system` array across two questions that share no words.
   */
  it("is byte-identical across two completely different questions", () => {
    const one = interpretRequest("What are our top rated titles?", layer);
    const two = interpretRequest("which genres did people watch most in the nineties", layer);

    expect(JSON.stringify(one.system)).toBe(JSON.stringify(two.system));
  });

  it("carries exactly one cache breakpoint, on its final block", () => {
    const prefix = stablePrefix(layer);

    const marked = prefix.filter((block) => block.cache_control !== undefined);
    expect(marked).toHaveLength(1);
    // Last, not first: a breakpoint in the middle would leave everything after it
    // uncached, and the examples are the largest part of the prefix.
    expect(prefix[prefix.length - 1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  /**
   * The silent failure, pinned as a number.
   *
   * Opus 5 does not cache a prefix under 512 tokens and reports nothing when it declines
   * to — no error, no header, just full input price on every question forever. This is
   * the only place that fact becomes checkable, so it is checked with margin rather than
   * at the line: a prefix sitting at 520 tokens is one label edit away from a permanent
   * cost regression nobody would be told about.
   */
  it("clears Opus 5's 512-token floor with room to spare", () => {
    const { characters, estimatedTokens } = prefixSize(layer);

    expect(characters).toBeGreaterThan(0);
    expect(estimatedTokens).toBeGreaterThan(CACHE_FLOOR_TOKENS * 2);
    expect(CACHE_FLOOR_TOKENS).toBe(512);
    expect(CHARS_PER_TOKEN_ESTIMATE).toBe(4);
  });

  it("would lose roughly a quarter of itself if the catalogue were minified", () => {
    // `docs/architecture.md` §3's measurement, restated where the prefix is built: the
    // whitespace is what carries a thin layer over the floor, so minifying the layer is
    // a cost regression disguised as a saving.
    const pretty = JSON.stringify(layer, null, 2);
    const minified = JSON.stringify(layer);
    expect(pretty.length).toBeGreaterThan(minified.length);
  });
});

describe("the few-shot block", () => {
  it("holds at least the five examples the prefix needs to clear the floor", () => {
    const examples = fewShotExamples(layer);

    expect(examples.length).toBeGreaterThanOrEqual(FEW_SHOT_MINIMUM);
    expect(FEW_SHOT_MINIMUM).toBe(5);
  });

  it("shows only specs that would actually validate", () => {
    // Generated through `ModelQuerySpecSchema`, so an example cannot teach the model a
    // shape the runtime would then reject.
    for (const { spec } of fewShotExamples(layer)) {
      expect(ModelQuerySpecSchema.safeParse(spec).success).toBe(true);
    }
  });

  it("names no dataset in the code, only in the data", () => {
    // Invariant 6: nothing dataset-specific in the prompt. Every id the examples carry
    // arrives from the layer and the starter catalogue, so this file's text is the same
    // for a second deployment.
    expect(CODE).not.toMatch(/avg_rating|movielens|genre|Streetcar/i);
  });

  it("carries every guard the layer declares, with the layer's parameters", () => {
    // Guards default to on, and `engine/resolve.ts` only fills them when the field is
    // absent — so an example showing `guards: []` would teach the model to ask for a
    // genuinely unguarded answer with nothing on screen saying so.
    const declared = layer.guards.map((guard) => guard.id).sort();
    for (const { spec } of fewShotExamples(layer)) {
      const parsed = ModelQuerySpecSchema.parse(spec);
      expect(parsed.guards.map((guard) => guard.id).sort()).toEqual(declared);
    }
  });
});

describe("what the model is not allowed to choose", () => {
  /**
   * `tieBreak` and `asOf` are absent from `ModelQuerySpec` by construction, not by
   * instruction (`contracts/query-spec.ts`). The schema the model is handed is derived
   * from that type, so `parsed_output` cannot carry either field even if the model tried.
   */
  it("hands the model a schema with no tieBreak and no asOf", () => {
    const schema = interpretRequest("anything", layer).output_config?.format?.schema;
    const text = JSON.stringify(schema);

    expect(text).not.toContain("tieBreak");
    expect(text).not.toContain("asOf");
  });

  it("rejects a model output that carried them anyway", () => {
    const withTieBreak = ModelQuerySpecSchema.safeParse({
      measure: "x",
      sort: { by: "measure", dir: "desc", tieBreak: "title" },
      limit: 10,
      guards: [],
    });
    expect(withTieBreak.success).toBe(false);
  });

  it("fills the tie-break from the layer, so every resolved spec carries one", async () => {
    const starter = fewShotExamples(layer)[0];
    expect(starter).toBeDefined();

    const interpret = createInterpreter(stubClient(starter?.spec));
    const result = await interpret("a question", layer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.sort.tieBreak).toBe(layer.defaultTieBreak);
    // The request carries the as-of; the interpreter never chooses it.
    expect(result.spec.asOf).toBeNull();
  });
});

describe("a question the layer cannot answer", () => {
  /**
   * Invariant 4, on the model path. The prompt tells the model to echo an undeclared
   * term verbatim rather than substitute the nearest declared id, and `resolveSpec` then
   * recognises it as undeclared — so the refusal is produced by the same mechanism the
   * fallback parser uses, and arrives as a returned value rather than a throw.
   */
  it("becomes a clarifying question naming the undeclared measure", async () => {
    const interpret = createInterpreter(
      stubClient({
        measure: "revenue",
        breakdown: "genre",
        filters: [],
        sort: { by: "measure", dir: "desc" },
        limit: 19,
        guards: layer.guards.map((guard) => ({ id: guard.id, params: { ...guard.defaultParams } })),
      }),
    );

    const result = await interpret("How much revenue did each genre make?", layer);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe("clarify");
    expect(result.rejection.missing).toContainEqual({ what: "revenue", kind: "measure" });
    // It names the gap and offers questions that work, never a nearest match.
    expect(result.rejection.declared.measures.length).toBeGreaterThan(0);
    expect(result.rejection.nearest.length).toBeGreaterThan(0);
  });

  it("instructs the model to echo an undeclared term rather than match the nearest", () => {
    const [instructions] = stablePrefix(layer);
    expect(instructions?.text).toMatch(/exactly as they wrote it/);
    expect(instructions?.text).toMatch(/Never substitute the closest declared id/);
  });

  it("clarifies rather than throws when the response parsed to nothing", async () => {
    // `parsed_output` is null when the response did not validate. That is still not a
    // reason to render an error page at the user: nothing usable came back, so the
    // honest output is the clarifying question that says which measures exist.
    const interpret = createInterpreter(stubClient(null));
    const result = await interpret("something unparseable", layer);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.asked).toBe("something unparseable");
    expect(result.rejection.nearest.length).toBeGreaterThan(0);
  });
});

describe("the live arm stays off the keyless import graph", () => {
  /**
   * Invariant 13's structural half. A static import of `ai/interpret.ts` anywhere on the
   * request path would put `@anthropic-ai/sdk` into the graph of the one path that has to
   * work on a clean clone — so the route reaches it through a dynamic import gated on the
   * same `aiMode()` the interpreter selection branches on.
   */
  const routeSource = readFileSync(
    join(import.meta.dirname, "..", "..", "src", "app", "api", "ask", "route.ts"),
    "utf8",
  );

  it("is not statically imported by the ask route", () => {
    expect(routeSource).not.toMatch(/^import .*@\/server\/ai\/interpret/m);
    expect(routeSource).toMatch(/await import\("@\/server\/ai\/interpret"\)/);
  });

  it("is reached only when the key branch says live", () => {
    expect(routeSource).toMatch(/if \(aiMode\(\) !== "live"\) return null;/);
  });

  it("is not imported by the page, which only asks which mode this is", () => {
    const pageSource = readFileSync(
      join(import.meta.dirname, "..", "..", "src", "app", "page.tsx"),
      "utf8",
    );
    expect(pageSource).not.toMatch(/@\/server\/ai\/interpret/);
    expect(pageSource).toMatch(/aiMode\(\) === "live"/);
  });
});
