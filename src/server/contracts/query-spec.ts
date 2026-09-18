import { z } from "zod";

/**
 * Bound on the rows the client and the chart receive.
 *
 * Grounded in measured dimension cardinality, not rounded to a pleasant number:
 * genre 19, release decade 12, rating year 23, release year 106, title 9,742. The
 * largest declared non-title dimension is release year at 106 members, so 120 leaves
 * a year breakdown expressible with headroom. Changing it means that measurement
 * changed. See docs/architecture.md §2.
 */
export const MAX_LIMIT = 120;

/**
 * What the narrate call may ever receive. A different invariant from MAX_LIMIT —
 * narration never sees raw data (AGENTS.md invariant 2) — and deliberately a
 * different number, so tuning one cannot silently move the other.
 */
export const NARRATE_ROW_CAP = 20;

export const FilterSchema = z.strictObject({
  dimension: z.string(),
  op: z.enum(["eq", "in", "gte", "lte", "between"]),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
});

export const GuardRefSchema = z.strictObject({
  /** A GuardId, resolved against the registry the semantic layer declares, at load. */
  id: z.string(),
  params: z.record(z.string(), z.number()),
});

export const SortSchema = z.strictObject({
  by: z.enum(["measure", "breakdown"]),
  dir: z.enum(["asc", "desc"]),
  /**
   * A DimensionId. Required, never optional: an optional tie-break is no tie-break,
   * and a tie resolves differently on every adapter that omits it. The model never
   * chooses it — ModelQuerySpecSchema omits it and resolveSpec() fills it from the
   * layer's declared default before validation.
   */
  tieBreak: z.string(),
});

/** The executable spec. Every adapter reads exactly this. */
export const QuerySpecSchema = z.strictObject({
  measure: z.string(),
  breakdown: z.string().optional(),
  filters: z.array(FilterSchema).default([]),
  sort: SortSchema,
  limit: z.number().int().min(1).max(MAX_LIMIT),
  guards: z.array(GuardRefSchema),
  /** ISO-8601 UTC. `null` means "latest", which only the engine can resolve. */
  asOf: z.string().datetime().nullable(),
});

/**
 * What the model is allowed to emit. Derived from the same schema rather than written
 * twice — one artifact, two surfaces. Strictness is inherited from QuerySpecSchema's
 * catchall, which is asserted rather than assumed (tests/contracts.test.ts, case 1b).
 */
export const ModelQuerySpecSchema = QuerySpecSchema.omit({
  sort: true,
  asOf: true,
}).extend({ sort: SortSchema.omit({ tieBreak: true }) });

export type Filter = z.infer<typeof FilterSchema>;
export type GuardRef = z.infer<typeof GuardRefSchema>;
export type Sort = z.infer<typeof SortSchema>;
export type QuerySpec = z.infer<typeof QuerySpecSchema>;
export type ModelQuerySpec = z.infer<typeof ModelQuerySpecSchema>;
