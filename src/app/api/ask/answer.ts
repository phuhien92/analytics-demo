import {
  ANSWER_STREAM_CONTENT_TYPE,
  AskRequestSchema,
  answerProvenance,
  type Answer,
  type AnswerFrame,
  type AnswerProvenance,
  type AskRequest,
  type SemanticLayer,
} from "@/server/contracts";

import type { NarrationProducer } from "@/server/ai/narrate-template";
import type { SelectedInterpreter } from "@/server/ai/mode";
import { execute } from "@/server/engine/execute";
import type { Warehouse } from "@/server/warehouse/types";

/**
 * The seam between everything built so far and everything still to come.
 *
 * **The route assembles; the engine aggregates.** Nothing here adds, orders, rounds or
 * thresholds anything: a question goes to an interpreter, the spec it returns goes to
 * `execute()`, and what comes back is carried onto the wire whole. The one arithmetic-
 * looking line in the file is `request.asOf ?? latestAsOf()`, which chooses a moment
 * rather than computing a figure.
 *
 * It is split out of `route.ts` so the whole of it — status codes, headers, frame order,
 * the stream — is reachable from a test with an in-memory warehouse, without a compiled
 * `.store/` and without an HTTP server. `route.ts` keeps what only a deployed process
 * can own: reading `.store/` and `semantic/movielens.json` off disk, once per process.
 *
 * ## Everything fallible happens before the first byte
 *
 * The answer object is complete before the stream opens. That is deliberate: once a byte
 * is written the status line is gone, and a failure can only be expressed as a truncated
 * response. So parsing, interpretation and execution all resolve first and can still
 * become a status code; only narration runs inside the stream — and GA-09's contract is
 * that a narrate failure degrades to the template rather than failing the request.
 */

export type AskDependencies = {
  readonly warehouse: Warehouse;
  readonly layer: SemanticLayer;
  readonly interpreter: SelectedInterpreter;
  /** The template today; GA-09 substitutes the model's producer behind the same type. */
  readonly narrate: NarrationProducer;
  /**
   * Injected, like `execute`'s `computedAt`, so a test owns both and a run is repeatable.
   * Drawn **once per HTTP request** and threaded through, so the id on the answer, the id
   * inside `resultSet.provenance` and the id in any server log are the same id.
   */
  readonly newRequestId: () => string;
  /** ISO-8601 UTC. */
  readonly now: () => string;
};

/** The answer object, plus the narration that will stream after it. */
export type AssembledAnswer = {
  readonly answer: Answer;
  /** `null` on a refusal: the clarifying question is its own copy, so there is nothing to narrate. */
  readonly narration: AsyncIterable<string> | null;
};

/**
 * Question in, answer object out. **A refusal is a return value here too** — it travels
 * as `ok: false` all the way to a 200, and nothing on this path throws to express it.
 */
export async function answerQuestion(
  deps: AskDependencies,
  request: AskRequest,
  requestId: string,
): Promise<AssembledAnswer> {
  const { warehouse, layer, interpreter, narrate } = deps;

  // Resolved once, up front, so the refusal branch can state the same as-of the success
  // branch would have used. A refusal that cannot say which moment it refused at is a
  // refusal nobody can reproduce.
  const resolvedAsOf = request.asOf ?? (await warehouse.latestAsOf());

  const provenance: AnswerProvenance = {
    requestId,
    adapterId: warehouse.adapterId,
    layerVersion: layer.version,
    resolvedAsOf,
  };

  const interpreted = await interpreter.interpret(request.question, layer, request.locale);
  if (!interpreted.ok) {
    return {
      answer: {
        ok: false,
        provenance,
        degraded: interpreter.degraded,
        rejection: interpreted.rejection,
      },
      narration: null,
    };
  }

  // The guard escape, applied **after** interpretation and by **subtraction only**
  // (`contracts/ask.ts`). The caller names declared checks to leave off; it cannot add
  // one, retune one, or reach any other field of the spec. `askResponse` has already
  // refused any id this layer does not declare.
  const dropped = new Set(request.withoutGuards);
  const guards = interpreted.spec.guards.filter((guard) => !dropped.has(guard.id));

  const resultSet = await execute(
    // The request carries the as-of; the interpreter never chooses it (build-spec §3
    // GA-08). The spec is otherwise the interpreter's — it is what a saved recipe re-runs.
    { ...interpreted.spec, guards, asOf: resolvedAsOf },
    { warehouse, layer, requestId, computedAt: deps.now(), locale: request.locale },
  );

  return {
    answer: {
      ok: true,
      // Projected from the engine's own record rather than re-derived, so the two can
      // never disagree; `tests/ask-route.test.ts` asserts the projection field by field.
      provenance: answerProvenance(resultSet.provenance),
      degraded: interpreter.degraded,
      narration: { producer: "template", locale: request.locale },
      resultSet,
    },
    narration: narrate(resultSet, layer, request.locale),
  };
}

/** Headers every response carries, answer, refusal and fault alike. */
function baseHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    /**
     * The body echoes the user's own question back inside `rejection.asked`. Without
     * `nosniff` a browser is free to disregard the declared type, sniff markup out of
     * that echo and render it — so the header is what keeps a clarifying question from
     * becoming an injection surface.
     */
    "X-Content-Type-Options": "nosniff",
    /**
     * An answer is pinned to a `requestId` and a `computedAt`. A cached one would be a
     * different answer wearing another answer's provenance, which is the confident wrong
     * answer this product exists to catch.
     */
    "Cache-Control": "no-store",
  };
}

/**
 * A fault, not a refusal.
 *
 * The two are kept visibly apart. A question the layer cannot answer is content at 200;
 * this is for a malformed request or a broken deployment, where there is no clarifying
 * question to offer because nothing was asked in a form that could be clarified. It
 * carries the `requestId` so a server log and a user report can be joined up.
 */
function fault(status: number, requestId: string, detail: string): Response {
  return new Response(JSON.stringify({ error: { status, requestId, detail } }), {
    status,
    headers: baseHeaders("application/json"),
  });
}

function encodeFrame(frame: AnswerFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * The HTTP surface: an `AskRequest` in, a streamed NDJSON response out.
 *
 * ## Why newline-delimited JSON rather than Server-Sent Events
 *
 * The question travels in a body, so this is a POST, and `EventSource` is GET-only — a
 * browser client reads this with `fetch` and a stream reader either way. Against that,
 * SSE's framing is parsing work for nothing, and its reconnect semantics are actively
 * wrong here: a dropped connection must be re-asked as a fresh request with its own
 * `requestId`, never silently resumed into an answer whose provenance says otherwise.
 */
export async function askResponse(deps: AskDependencies, httpRequest: Request): Promise<Response> {
  const requestId = deps.newRequestId();

  let body: unknown;
  try {
    body = await httpRequest.json();
  } catch {
    return fault(400, requestId, "the request body is not JSON");
  }

  const parsed = AskRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fault(
      400,
      requestId,
      issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid request",
    );
  }

  /**
   * A check this layer does not declare is a **fault, not a refusal**.
   *
   * A refusal is what the product owes a *user* who asked something the catalogue
   * cannot answer, and it carries a clarifying question because there is one to ask.
   * Nobody types a `GuardId`: it reaches this field only from a caller that read it off
   * a trust report, so an unknown one means the client and the layer disagree about
   * what exists. Ignoring it would run the question with every check still on and
   * report success — the silent coercion invariant 4 exists to forbid, arriving through
   * a no-op instead of through a nearest match.
   */
  const undeclared = parsed.data.withoutGuards.filter(
    (id) => !deps.layer.guards.some((guard) => guard.id === id),
  );
  if (undeclared.length > 0) {
    return fault(
      400,
      requestId,
      `withoutGuards: this layer declares no check called ${undeclared.join(", ")}`,
    );
  }

  let assembled: AssembledAnswer;
  try {
    assembled = await answerQuestion(deps, parsed.data, requestId);
  } catch (error) {
    // Reaching here means the deployment is broken — a missing store, or an adapter that
    // cannot compute a declared id — never a question the layer could not answer.
    console.error(`[ask] ${requestId}`, error);
    return fault(500, requestId, "the question could not be answered by this deployment");
  }

  const encoder = new TextEncoder();
  const { answer, narration } = assembled;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(encodeFrame({ type: "answer", answer })));
        if (narration !== null) {
          for await (const delta of narration) {
            controller.enqueue(encoder.encode(encodeFrame({ type: "narration", delta })));
          }
        }
        controller.enqueue(encoder.encode(encodeFrame({ type: "end" })));
        controller.close();
      } catch (error) {
        // The status line is long gone, so there is nothing to report but the break. The
        // `end` frame's absence is what tells the reader the narration was cut short.
        console.error(`[ask] ${answer.provenance.requestId} stream`, error);
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: baseHeaders(`${ANSWER_STREAM_CONTENT_TYPE}; charset=utf-8`),
  });
}
