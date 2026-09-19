import { z } from "zod";

import { ReceivedPayloadEnvelopeSchema } from "../contracts/payload.ts";

/**
 * The body of one received payload, composed onto the portable envelope GA-01 declared.
 *
 * **The split is deliberate.** The envelope is an integration contract and lives in
 * `contracts/`, which never names a dataset (AGENTS.md invariant 6). The body is the
 * shape *this* integration's partner sends, so it names titles, ratings and viewers —
 * and lives out here, beside the reader that fills it, where naming them is correct.
 * A live receiver is a new caller of this schema, not a new schema (build-spec §9).
 *
 * `rating` arrives on the presentation scale because that is what a partner has;
 * `build-store.ts` scales it to an integer and rejects any value that does not land on
 * the declared scale. Nothing is rounded into place.
 */

export const TitleRecordSchema = z.strictObject({
  titleId: z.number().int(),
  /** As delivered, year suffix and all. The release year is derived, never edited in. */
  title: z.string().min(1),
  /** Already split. An empty array is a title the partner marked as uncategorised. */
  genres: z.array(z.string().min(1)),
  /** External ids, null where the partner sent none. Zero-padded, so never a number. */
  imdbId: z.string().nullable(),
  tmdbId: z.string().nullable(),
});

export const RatingEventSchema = z.strictObject({
  viewerId: z.number().int(),
  titleId: z.number().int(),
  /** Presentation scale, as the partner holds it. Scaled to an integer at build. */
  rating: z.number(),
  /** Unix seconds. The event's own time, which is what `asOf` filters on. */
  at: z.number().int(),
});

export const TagEventSchema = z.strictObject({
  viewerId: z.number().int(),
  titleId: z.number().int(),
  tag: z.string(),
  at: z.number().int(),
});

export const ReceivedPayloadSchema = ReceivedPayloadEnvelopeSchema.extend({
  titles: z.array(TitleRecordSchema),
  ratings: z.array(RatingEventSchema),
  tags: z.array(TagEventSchema),
});

export type TitleRecord = z.infer<typeof TitleRecordSchema>;
export type RatingEvent = z.infer<typeof RatingEventSchema>;
export type TagEvent = z.infer<typeof TagEventSchema>;
export type ReceivedPayload = z.infer<typeof ReceivedPayloadSchema>;
