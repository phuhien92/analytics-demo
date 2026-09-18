import { z } from "zod";

/**
 * The envelope around one payload received from a partner application.
 *
 * The framing is inbound integration, not a bundled fixture: provenance names a
 * *source*, never a file on disk, so pointing the product at a live receiver is a new
 * caller rather than a new contract (build-spec §4.2b, §9).
 *
 * GA-02 supplies the body and composes it onto this envelope. Nothing here names a
 * dataset.
 */
export const ReceivedPayloadEnvelopeSchema = z.strictObject({
  /** Identifies the sending system. Flows straight into Provenance.sourceId. */
  sourceId: z.string().min(1),
  /** Unique per delivery, so a replayed payload is recognisable as one. */
  payloadId: z.string().min(1),
  /** The contract version the sender wrote against. */
  schemaVersion: z.number().int(),
  /** ISO-8601 UTC. Becomes the store's as-of point for these records. */
  receivedAt: z.string().datetime(),
});

export type ReceivedPayloadEnvelope = z.infer<typeof ReceivedPayloadEnvelopeSchema>;
