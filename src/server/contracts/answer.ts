import { z } from "zod";

import { RejectionSchema } from "./rejection";
import { ProvenanceSchema, ResultSetSchema, type Provenance } from "./result-set";

/**
 * What the ask route returns. The union is the point: every caller has to handle
 * rejection, because there is no shape that omits it.
 */

/**
 * The four facts **every** answer states, refusal included.
 *
 * A number that cannot say which moment and which engine produced it cannot be
 * reproduced, and reproducibility is this product's central claim rather than a nicety.
 * That applies to a refusal too: which layer version refused, and at which as-of, is
 * exactly what a user comparing two sessions needs — and before GA-07 the rejection
 * branch could not say either.
 *
 * Deliberately **smaller than `Provenance`**. The full record carries `engineVersion`
 * and `computedAt`, which describe a computation; a refusal ran no computation, and
 * filling those with the engine's version would be a small lie in the one place this
 * product cannot afford one. On the success branch this is a projection of
 * `resultSet.provenance` — taken by `answerProvenance()` so there is one derivation, not
 * two, and asserted equal in `tests/ask-route.test.ts`.
 */
export const AnswerProvenanceSchema = ProvenanceSchema.pick({
  requestId: true,
  adapterId: true,
  layerVersion: true,
  resolvedAsOf: true,
});

/**
 * The narration **slot** — never the narration's text.
 *
 * The takeaway arrives as `narration` frames on the same response (`AnswerFrameSchema`).
 * Putting the prose in a JSON string field here is the single most expensive shortcut in
 * the plan (build-spec §5.1): the narration's *producer* changes in GA-09, its *contract*
 * must not, and a field-to-stream change is a change of response kind — content type,
 * the client's fetch handling, component state, and every test that reads it.
 *
 * `producer` is not a restatement of `degraded`. `degraded` says no key was present, so
 * the deterministic parser interpreted the question. `producer` says who wrote the
 * takeaway — and GA-09's contract is that a narrate failure falls back to the template
 * **without failing the request**, which produces a live answer with a templated
 * takeaway. Two different facts, and the surface owes the user a different note for each.
 */
export const NarrationSchema = z.strictObject({
  producer: z.enum(["template", "model"]),
  /** The locale the streamed text is written in. Locale-keyed like every other copy. */
  locale: z.string(),
});

export const AnswerSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    provenance: AnswerProvenanceSchema,
    /** True when no model was available and the deterministic path answered. */
    degraded: z.boolean(),
    narration: NarrationSchema,
    /**
     * The engine's output, carried **whole and unmodified**. The route assembles; the
     * engine aggregates — so the spec, the rows, the trust report and the full
     * provenance reach the client as the one artifact the conformance suite pins and a
     * saved recipe re-runs, rather than as fields the route took apart and put back.
     */
    resultSet: ResultSetSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    provenance: AnswerProvenanceSchema,
    degraded: z.boolean(),
    /**
     * A first-class response, not an error. It is served at HTTP 200 with its clarifying
     * question and its concrete options intact, because showcasing refusal as a feature
     * later is only possible if it arrives as content (`docs/architecture.md` §8).
     *
     * There is no `narration` here: the clarifying question *is* the copy, and a
     * takeaway narrating a refusal would be prose about an answer that does not exist.
     */
    rejection: RejectionSchema,
  }),
]);

/**
 * One frame on the wire. The response is newline-delimited JSON: one frame per line.
 *
 * Frame order is fixed and load-bearing — `answer`, then zero or more `narration`
 * deltas, then `end`. The complete answer object arrives **before any prose**, which is
 * invariant 1 expressed as a wire format: the numbers are on screen before a narrator
 * says anything about them, so no figure can originate in the narration.
 *
 * `end` is a frame rather than the stream simply closing, because a reader otherwise
 * cannot tell a finished narration from a connection that died mid-sentence — and GA-09
 * streams that narration from a model, where that distinction becomes real.
 */
export const AnswerFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("answer"), answer: AnswerSchema }),
  z.strictObject({ type: z.literal("narration"), delta: z.string() }),
  z.strictObject({ type: z.literal("end") }),
]);

/** The media type those frames are served as. One JSON value per line. */
export const ANSWER_STREAM_CONTENT_TYPE = "application/x-ndjson";

/**
 * The success branch's provenance, projected from the engine's record.
 *
 * One function so the four fields are derived in one place. A second hand-copy is the
 * kind of duplication that disagrees silently, which is the failure mode this product
 * exists to remove.
 */
export function answerProvenance(provenance: Provenance): AnswerProvenance {
  return {
    requestId: provenance.requestId,
    adapterId: provenance.adapterId,
    layerVersion: provenance.layerVersion,
    resolvedAsOf: provenance.resolvedAsOf,
  };
}

export type AnswerProvenance = z.infer<typeof AnswerProvenanceSchema>;
export type Narration = z.infer<typeof NarrationSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type AnswerFrame = z.infer<typeof AnswerFrameSchema>;
