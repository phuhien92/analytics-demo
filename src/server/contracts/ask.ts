import { z } from "zod";

/**
 * What a client POSTs to `/api/ask`.
 *
 * Deliberately four fields, and the question is the only thing the *user* writes.
 * Everything else is context the **caller** owns and the model never chooses — the
 * as-of, the locale, and which declared checks to leave off this run.
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
  /**
   * `GuardId`s to leave **off** this run — the one-tap guard escape (build-spec §3
   * GA-12).
   *
   * `docs/design.md` §5 gives every guard a safe default already applied and a one-tap
   * escape, "never a warning that hands the user homework". That escape has to be
   * expressible on the wire, and this is the smallest thing that expresses it: the
   * question is unchanged, and what changes is which declared checks ran.
   *
   * It is a **list of ids, not a spec**. The route resolves the question to a spec as
   * it always does and then removes these guards from it, so nothing undeclared can
   * arrive this way and a caller cannot smuggle a measure, a filter or a limit past
   * interpretation. An id this layer does not declare is a malformed request, not a
   * near miss to be ignored (invariant 4) — `answer.ts` answers it with a 400 naming
   * the id.
   *
   * Emptying the guards is what the engine's naive run already does, so an escaped
   * answer is the naive side of the comparison, recomputed with its own provenance and
   * its own trust report rather than re-displayed from a previous answer's payload.
   */
  withoutGuards: z.array(z.string()).default([]),
});

export type AskRequest = z.infer<typeof AskRequestSchema>;
