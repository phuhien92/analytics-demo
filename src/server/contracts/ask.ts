import { z } from "zod";

/**
 * What a client POSTs to `/api/ask`.
 *
 * Deliberately three fields. The question is the only thing the user writes; everything
 * else is context the *caller* owns and the model never chooses.
 */
export const AskRequestSchema = z.strictObject({
  /**
   * Free text, and the only free text anywhere in the product. It is not validated
   * against the layer here: a question the layer cannot answer is a `Rejection` carried
   * at HTTP 200, not a rejected request (invariant 4). An empty string is a legitimate
   * value — it comes back as the clarifying question that lists the starter questions.
   */
  question: z.string(),
  /**
   * Labels, synonyms and `Intl` formatting are all locale-keyed (invariant 8), so
   * understanding and rendering are both locale-dependent. v1 ships `en`.
   */
  locale: z.string().default("en"),
  /**
   * ISO-8601 UTC, or `null` for "latest". **The request carries the as-of** — the layer
   * declares the tie-break and the model chooses neither (build-spec §3 GA-08). It is
   * what makes a past answer re-runnable rather than merely explainable, and it is the
   * seam GA-06's replay case and GA-14's saved recipes both come through.
   */
  asOf: z.string().datetime().nullable().default(null),
});

export type AskRequest = z.infer<typeof AskRequestSchema>;
