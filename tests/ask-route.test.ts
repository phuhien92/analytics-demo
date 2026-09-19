import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANSWER_STREAM_CONTENT_TYPE,
  AnswerFrameSchema,
  AnswerSchema,
  AskRequestSchema,
  type AnswerFrame,
  type SemanticLayer,
} from "@/server/contracts";

import { parseQuestion } from "@/server/ai/fallback-parser";
import { selectInterpreter } from "@/server/ai/mode";
import { narrateFromTemplate, templateTakeaway } from "@/server/ai/narrate-template";
import { loadSemanticLayer } from "@/server/semantic/load";
import { LocalStoreWarehouse } from "@/server/warehouse/local-store";

import { answerQuestion, askResponse, type AskDependencies } from "../src/app/api/ask/answer.ts";
import { buildStore } from "../src/server/ingest/build-store.ts";
import { readPayload } from "../src/server/ingest/read-payload.ts";

/**
 * The ask route and the answer object.
 *
 * Three things are being proved here, and only one of them is "the endpoint works".
 *
 * 1. **The refusal is a first-class response.** An undeclared question comes back at
 *    HTTP 200 carrying its clarifying question and its concrete options, not as a 4xx
 *    with a message. GA-11 can only showcase refusal as a feature if it arrives as
 *    content.
 * 2. **The answer states its provenance, always** — including on that refusal. A number
 *    that cannot say which moment, which layer and which adapter produced it cannot be
 *    reproduced.
 * 3. **The narration is a stream, not a field.** The takeaway arrives as its own frames
 *    after a complete answer object, which is what makes GA-09 a substitution instead of
 *    a rewrite of the route, the schema and every component that reads it.
 *
 * The dependencies are injected, so this suite needs no compiled `.store/` and no HTTP
 * server: it drives the same `askResponse` the route exports `POST` over, and asserts on
 * a real `Response`.
 */

const DATA_DIR = join(import.meta.dirname, "..", "data");
const warehouse = new LocalStoreWarehouse(buildStore([readPayload(DATA_DIR)]).store);
const layer: SemanticLayer = loadSemanticLayer();

/** The store's own latest moment — what `asOf: null` resolves to. */
const LATEST_AS_OF = "2018-09-26T00:00:00.000Z";

function deps(overrides: Partial<AskDependencies> = {}): AskDependencies {
  let requests = 0;
  return {
    warehouse,
    layer,
    // `null` is the keyless build saying it has no live arm — the shipped configuration.
    interpreter: selectInterpreter(null, {}),
    narrate: narrateFromTemplate,
    newRequestId: () => `req_${(requests += 1)}`,
    now: () => "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Read the whole NDJSON body and validate every frame. Nothing is trusted unparsed. */
async function readFrames(response: Response): Promise<AnswerFrame[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => AnswerFrameSchema.parse(JSON.parse(line)));
}

const HERO = "What are our top rated titles?";
const UNDECLARED = "How much revenue did each genre make?";

describe("An undeclared question is a 200 carrying a Rejection", () => {
  // Done-criterion 4. The assertion is on the *status and the content* together: a test
  // that only checked the body would pass against a route that served this at 422.
  it("answers 200, not 4xx and not 5xx", async () => {
    const response = await askResponse(deps(), post({ question: UNDECLARED }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      `${ANSWER_STREAM_CONTENT_TYPE}; charset=utf-8`,
    );
  });

  it("carries the clarifying question and its concrete options intact", async () => {
    const frames = await readFrames(await askResponse(deps(), post({ question: UNDECLARED })));
    const first = frames[0];

    expect(first?.type).toBe("answer");
    if (first?.type !== "answer") return;
    expect(first.answer.ok).toBe(false);
    if (first.answer.ok) return;

    expect(first.answer.rejection.asked).toBe(UNDECLARED);
    expect(first.answer.rejection.missing.length).toBeGreaterThan(0);
    expect(first.answer.rejection.declared.measures).toContain("avg_rating");
    // The options are re-runnable specs, not prose — that is what GA-11 renders as taps.
    expect(first.answer.rejection.nearest.length).toBeGreaterThanOrEqual(1);
    expect(first.answer.rejection.nearest[0]?.spec.measure).toBeTruthy();
  });

  it("states its provenance, so a refusal is as reproducible as an answer", async () => {
    const frames = await readFrames(await askResponse(deps(), post({ question: UNDECLARED })));
    const first = frames[0];
    if (first?.type !== "answer") throw new Error("expected an answer frame");

    expect(first.answer.provenance).toEqual({
      requestId: "req_1",
      adapterId: "local-store",
      layerVersion: layer.version,
      resolvedAsOf: LATEST_AS_OF,
    });
  });

  it("narrates nothing — the clarifying question is its own copy", async () => {
    const frames = await readFrames(await askResponse(deps(), post({ question: UNDECLARED })));

    expect(frames.map((frame) => frame.type)).toEqual(["answer", "end"]);
  });
});

describe("The answer object", () => {
  // Done-criterion 2.
  it("validates against AnswerSchema", async () => {
    const frames = await readFrames(await askResponse(deps(), post({ question: HERO })));
    const first = frames[0];
    if (first?.type !== "answer") throw new Error("expected an answer frame");

    expect(() => AnswerSchema.parse(first.answer)).not.toThrow();
  });

  it("carries the engine's result set whole, and projects its provenance", async () => {
    const frames = await readFrames(await askResponse(deps(), post({ question: HERO })));
    const first = frames[0];
    if (first?.type !== "answer" || !first.answer.ok) throw new Error("expected an answer");

    const { provenance, resultSet } = first.answer;

    // The top-level provenance is a projection, never a second derivation. Asserted field
    // by field against the engine's own record so the two cannot drift apart silently.
    expect(provenance.requestId).toBe(resultSet.provenance.requestId);
    expect(provenance.adapterId).toBe(resultSet.provenance.adapterId);
    expect(provenance.layerVersion).toBe(resultSet.provenance.layerVersion);
    expect(provenance.resolvedAsOf).toBe(resultSet.provenance.resolvedAsOf);

    // The spec and the trust report reach the client inside the engine's artifact rather
    // than as fields the route took apart — which is what "the route assembles" means.
    expect(resultSet.spec.measure).toBe("avg_rating");
    expect(resultSet.spec.sort.tieBreak).toBe(layer.defaultTieBreak);
    expect(resultSet.trust.guardsApplied.length).toBeGreaterThan(0);
  });

  it("answers the hero question honestly, with the number the engine computed", async () => {
    const frames = await readFrames(await askResponse(deps(), post({ question: HERO })));
    const first = frames[0];
    if (first?.type !== "answer" || !first.answer.ok) throw new Error("expected an answer");

    // design §4: A Streetcar Named Desire at 4.47 from 20 ratings, not 296 titles at 5.00.
    expect(first.answer.resultSet.rows[0]?.key).toBe("Streetcar Named Desire, A (1951)");
    expect(first.answer.resultSet.rows[0]?.value).toBe(4.47);
    expect(first.answer.resultSet.rows[0]?.n).toBe(20);
    expect(first.answer.resultSet.trust.comparison?.material).toBe(true);
  });

  it("reports degraded without varying its shape", async () => {
    const degraded = await readFrames(await askResponse(deps(), post({ question: HERO })));
    // The same dependencies with a key present and a live arm injected. The arm is the
    // deterministic parser itself, which is what makes this a fair comparison: the only
    // thing that changed is *which branch was taken*, so any difference in the response
    // is the shape varying on key presence — the must-not this asserts against.
    const live = await readFrames(
      await askResponse(
        deps({
          interpreter: selectInterpreter(parseQuestion, { ANTHROPIC_API_KEY: "sk-test" }),
        }),
        post({ question: HERO }),
      ),
    );

    expect(degraded.map((frame) => frame.type)).toEqual(live.map((frame) => frame.type));

    const a = degraded[0];
    const b = live[0];
    if (a?.type !== "answer" || b?.type !== "answer") throw new Error("expected answer frames");
    if (!a.answer.ok || !b.answer.ok) throw new Error("expected success answers");

    expect(a.answer.degraded).toBe(true);
    expect(b.answer.degraded).toBe(false);
    expect(Object.keys(a.answer).sort()).toEqual(Object.keys(b.answer).sort());
    expect(a.answer.resultSet.rows).toEqual(b.answer.resultSet.rows);
  });
});

describe("The narration is a stream, not a field", () => {
  // Build-spec §5.1: the single most expensive shortcut available in the whole plan.
  it("puts no prose anywhere in the answer object", async () => {
    const frames = await readFrames(await askResponse(deps(), post({ question: HERO })));
    const first = frames[0];
    if (first?.type !== "answer" || !first.answer.ok) throw new Error("expected an answer");

    // The slot declares who writes the takeaway and in which locale. It cannot hold text:
    // AnswerSchema is strict, so a `takeaway` field added later fails this parse.
    expect(first.answer.narration).toEqual({ producer: "template", locale: "en" });
    expect(JSON.stringify(first.answer)).not.toContain("leads on");
  });

  it("delivers the degraded template as a single chunk, after the answer", async () => {
    const frames = await readFrames(await askResponse(deps(), post({ question: HERO })));

    expect(frames.map((frame) => frame.type)).toEqual(["answer", "narration", "end"]);

    const narration = frames[1];
    if (narration?.type !== "narration") throw new Error("expected a narration frame");
    expect(narration.delta).toContain("Streetcar Named Desire");
    expect(narration.delta).toContain("4.47");
  });

  it("says what was checked, and never claims the answer is verified", async () => {
    const frames = await readFrames(await askResponse(deps(), post({ question: HERO })));
    const narration = frames[1];
    if (narration?.type !== "narration") throw new Error("expected a narration frame");

    // Invariant 5. The verification is real but partial; overclaiming it reproduces the
    // silent failure this product criticises.
    expect(narration.delta.toLowerCase()).not.toContain("verified");
    expect(narration.delta).toContain("checks were applied");
  });

  it("quotes only figures the engine already computed", async () => {
    const { answer } = await answerQuestion(deps(), AskRequestSchema.parse({ question: HERO }), "req_x");
    if (!answer.ok) throw new Error("expected an answer");

    const takeaway = templateTakeaway(answer.resultSet, layer);
    const { rows, trust } = answer.resultSet;

    // Every numeral in the takeaway is a field on the result set — the same membership
    // check GA-09 will run against the model's prose (build-spec §3 GA-09).
    const available = new Set(
      [
        rows[0]?.value,
        rows[0]?.n,
        trust.coverage.includedMembers,
        trust.coverage.totalMembers,
        trust.coverage.includedObservations,
        trust.coverage.totalObservations,
        trust.guardsApplied.length,
      ].map((value) => new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value ?? 0)),
    );

    // Numerals only: title text such as "(1951)" is quoted from the row key, not asserted.
    const quoted = takeaway.slice(takeaway.indexOf(" leads on "));
    // A group separator and a decimal separator are both sentence punctuation too, so a
    // trailing one belongs to the prose rather than to the figure.
    for (const numeral of quoted.match(/\d[\d,.]*/g) ?? []) {
      expect(available).toContain(numeral.replace(/[.,]+$/, ""));
    }
  });

  it("formats every figure through Intl, so a locale cannot change what a number means", () => {
    const rows = [{ key: "A", value: 4.47, rawValue: 447, n: 1234 }];
    const resultSet = {
      spec: {
        measure: "avg_rating",
        breakdown: "title",
        filters: [],
        sort: { by: "measure" as const, dir: "desc" as const, tieBreak: "title" },
        limit: 10,
        guards: [],
        asOf: LATEST_AS_OF,
      },
      rows,
      trust: {
        guardsApplied: [],
        coverage: {
          includedObservations: 1234,
          totalObservations: 1234,
          includedMembers: 1,
          totalMembers: 1,
        },
        notes: [],
        comparison: null,
      },
      provenance: {
        requestId: "req_1",
        adapterId: "local-store",
        sourceId: "test",
        layerVersion: layer.version,
        layerSchemaVersion: layer.schemaVersion,
        resolvedAsOf: LATEST_AS_OF,
        engineVersion: "1.0.0",
        computedAt: LATEST_AS_OF,
      },
    };

    // Invariant 12: a decimal comma changes whether 4,47 reads as a rating or a count.
    expect(templateTakeaway(resultSet, layer, "en")).toContain("4.47");
    expect(templateTakeaway(resultSet, layer, "en")).toContain("1,234");
    expect(templateTakeaway(resultSet, layer, "de")).toContain("4,47");
    expect(templateTakeaway(resultSet, layer, "de")).toContain("1.234");
  });
});

describe("Two identical requests agree", () => {
  // Done-criterion 3. Reproducibility is the product's central claim, so it is asserted
  // on a second real request rather than on a second call to the engine.
  it("return identical rows and an identical resolvedAsOf", async () => {
    const first = await readFrames(await askResponse(deps(), post({ question: HERO })));
    const second = await readFrames(await askResponse(deps(), post({ question: HERO })));

    const a = first[0];
    const b = second[0];
    if (a?.type !== "answer" || b?.type !== "answer") throw new Error("expected answer frames");
    if (!a.answer.ok || !b.answer.ok) throw new Error("expected success answers");

    expect(JSON.stringify(a.answer.resultSet.rows)).toBe(JSON.stringify(b.answer.resultSet.rows));
    expect(a.answer.provenance.resolvedAsOf).toBe(b.answer.provenance.resolvedAsOf);
    expect(a.answer.provenance.resolvedAsOf).toBe(LATEST_AS_OF);
  });

  it("pin to the as-of the request carried, not to the clock", async () => {
    const asOf = "2007-08-02T00:00:00.000Z";
    const frames = await readFrames(await askResponse(deps(), post({ question: HERO, asOf })));
    const first = frames[0];
    if (first?.type !== "answer" || !first.answer.ok) throw new Error("expected an answer");

    expect(first.answer.provenance.resolvedAsOf).toBe(asOf);
    expect(first.answer.resultSet.spec.asOf).toBe(asOf);
    // The 2007 replay is a different answer, which is the point of carrying the as-of.
    expect(first.answer.resultSet.rows[0]?.key).not.toBe("Streetcar Named Desire, A (1951)");
  });
});

describe("Every response carries nosniff", () => {
  // Done-criterion 1's header. Asserted on all three kinds of response, because the
  // rejection body is the one that echoes the user's own text back.
  it("on an answer, on a refusal and on a malformed request", async () => {
    const answer = await askResponse(deps(), post({ question: HERO }));
    const refusal = await askResponse(deps(), post({ question: UNDECLARED }));
    const malformed = await askResponse(deps(), post("not json at all"));

    for (const response of [answer, refusal, malformed]) {
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(malformed.status).toBe(400);
  });

  it("refuses a body with no question as a fault, not as a clarifying question", async () => {
    const response = await askResponse(deps(), post({ locale: "en" }));

    // Nothing was asked in a form that could be clarified, so there is no clarifying
    // question to offer — the distinction the rejection path depends on staying sharp.
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { status: 400 } });
  });
});
