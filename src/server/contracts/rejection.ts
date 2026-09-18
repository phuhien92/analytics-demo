import { z } from "zod";

import { QuerySpecSchema } from "./query-spec";

/**
 * A returned value, never a throw.
 *
 * Anything outside the semantic layer becomes a clarifying question, never a nearest
 * match (AGENTS.md invariant 4) — and this is that mechanism. A throw gets caught
 * somewhere generic and rendered as an error; a returned object is rendered as the
 * clarifying question that *is* the product working.
 */
export const RejectionSchema = z.strictObject({
  kind: z.literal("clarify"),
  /** What the user asked, echoed back. */
  asked: z.string(),
  missing: z.array(
    z.strictObject({
      what: z.string(),
      kind: z.enum(["measure", "dimension", "filter", "guard", "timeframe"]),
    }),
  ),
  /** What the layer does declare, so the question names the gap rather than implying one. */
  declared: z.strictObject({
    measures: z.array(z.string()),
    dimensions: z.array(z.string()),
  }),
  /** Nearest questions that do work, each carrying the spec that answers it. */
  nearest: z.array(
    z.strictObject({
      question: z.string(),
      spec: QuerySpecSchema,
    }),
  ),
});

export type Rejection = z.infer<typeof RejectionSchema>;
