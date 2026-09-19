import { AnswerFrameSchema, type Answer } from "@/server/contracts";

/**
 * The client half of the wire format `docs/architecture.md` §6a defines.
 *
 * `POST /api/ask` answers with `application/x-ndjson`: one JSON value per line, in a
 * fixed order — an `answer` frame, then zero or more `narration` deltas, then `end`.
 * `EventSource` cannot read it, because the question travels in a body and `EventSource`
 * is GET-only; a `fetch` and a stream reader is the shape either way.
 *
 * ## Why the frames are validated here
 *
 * `AnswerFrameSchema` is the same schema the route validated on the way out, and
 * re-running it on the way in costs a parse per line. It is worth it: every figure the
 * surface renders comes off this object, and the product's central claim is that no
 * figure originates anywhere but the engine. A silently mis-shaped frame rendered as a
 * number would be exactly the failure this product exists to catch, in its own client.
 *
 * ## `end` is a frame, and its absence means something
 *
 * A reader cannot otherwise tell a finished narration from a connection that died
 * mid-sentence. `onEnd` fires only on the frame; a stream that stops without one leaves
 * `complete` false, and the surface says the takeaway was cut short rather than
 * presenting a half sentence as the whole one.
 */

export type AnswerStreamEvents = {
  /** The complete answer object, before any prose. */
  readonly onAnswer: (answer: Answer) => void;
  /** One narration chunk. The template sends exactly one; a model would send many. */
  readonly onDelta: (delta: string) => void;
};

export type AnswerStreamResult = {
  /** True only if the `end` frame arrived — the narration is the whole of it. */
  readonly complete: boolean;
  /** True once the stream has finished reading, with or without its `end` frame. */
  readonly closed: boolean;
};

export class AskFault extends Error {
  readonly status: number;
  readonly requestId: string | null;

  constructor(status: number, requestId: string | null, detail: string) {
    super(detail);
    this.name = "AskFault";
    this.status = status;
    this.requestId = requestId;
  }
}

function faultFrom(status: number, body: string): AskFault {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "object" &&
      parsed.error !== null
    ) {
      const error = parsed.error as { requestId?: unknown; detail?: unknown };
      return new AskFault(
        status,
        typeof error.requestId === "string" ? error.requestId : null,
        typeof error.detail === "string" ? error.detail : "the request failed",
      );
    }
  } catch {
    // A non-JSON body from a route that only ever writes JSON means the failure happened
    // before the route did — a proxy, or a build that is not serving. Say that, rather
    // than echoing markup into the surface.
  }
  return new AskFault(status, null, "the request failed");
}

/**
 * Ask, and deliver each frame as it lands.
 *
 * The narration is delivered chunk by chunk rather than accumulated and handed over at
 * the end, because the ordering is the point: the numbers are on screen before the
 * sentence about them starts arriving.
 */
export async function askStream(
  question: string,
  locale: string,
  events: AnswerStreamEvents,
  signal?: AbortSignal,
): Promise<AnswerStreamResult> {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, locale, asOf: null }),
    signal,
  });

  if (!response.ok) {
    throw faultFrom(response.status, await response.text());
  }
  if (response.body === null) {
    throw new AskFault(response.status, null, "the response carried no body");
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let complete = false;

  const handle = (line: string): void => {
    if (line === "") return;
    const frame = AnswerFrameSchema.parse(JSON.parse(line));
    if (frame.type === "answer") events.onAnswer(frame.answer);
    else if (frame.type === "narration") events.onDelta(frame.delta);
    else complete = true;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += value;
      // A chunk boundary is not a line boundary: the last piece stays buffered until its
      // newline arrives, so a frame split across two reads is never parsed as two.
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        handle(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
    }
    // Every frame the route writes ends in a newline, so anything left here is a
    // truncation. It is dropped rather than parsed: half a JSON value is not a frame.
  } finally {
    reader.releaseLock();
  }

  return { complete, closed: true };
}
