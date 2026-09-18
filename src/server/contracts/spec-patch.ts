import { z } from "zod";

import { FilterSchema, GuardRefSchema, MAX_LIMIT, SortSchema } from "./query-spec";

/**
 * A follow-up amends the previous spec rather than replacing it. A closed set of
 * operations, deliberately not a deep partial: each one renders as a line in the diff
 * the user reads before it applies.
 */
export const SpecPatchSchema = z.strictObject({
  /** The parent's requestId. */
  basedOn: z.string(),
  measure: z.string().optional(),
  /** `null` clears the breakdown; absent leaves it alone. */
  breakdown: z.union([z.string(), z.null()]).optional(),
  addFilters: z.array(FilterSchema).default([]),
  /** By dimension id. */
  removeFilters: z.array(z.string()).default([]),
  sort: SortSchema.partial().optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  setGuards: z.array(GuardRefSchema).optional(),
  /**
   * Absent is not the same as null, and the distinction is load-bearing. Absent means
   * inherit the parent's `resolvedAsOf` — "now just EU" interrogates the same
   * snapshot. `null` means re-resolve to latest, which is time travel the user asked
   * for. Hence `.optional()` rather than a default: `"reAsOf" in patch` has to stay a
   * real discriminator.
   */
  reAsOf: z.string().datetime().nullable().optional(),
});

export type SpecPatch = z.infer<typeof SpecPatchSchema>;
