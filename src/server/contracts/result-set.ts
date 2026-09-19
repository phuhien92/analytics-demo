import { z } from "zod";

import { QuerySpecSchema } from "./query-spec";

export const ProvenanceSchema = z.strictObject({
  requestId: z.string(),
  adapterId: z.string(),
  /** Names the received payload's source, never a file on disk. */
  sourceId: z.string(),
  layerVersion: z.string(),
  layerSchemaVersion: z.number().int(),
  /**
   * NEVER nullable. The spec's `asOf` may be null, meaning "latest"; provenance
   * records what "latest" turned out to be, which is what makes a past answer
   * re-runnable rather than merely explainable.
   */
  resolvedAsOf: z.string().datetime(),
  engineVersion: z.string(),
  computedAt: z.string().datetime(),
});

export const ResultRowSchema = z.strictObject({
  /** The breakdown member; null when the spec has no breakdown. */
  key: z.string().nullable(),
  /** Presentation scale — what the user reads, formatted through `Intl`. */
  value: z.number(),
  /** The scaled integer, as stored. Floats never cross an adapter boundary. */
  rawValue: z.number().int(),
  /** Observations behind this row. */
  n: z.number().int(),
});

export const TrustReportSchema = z.strictObject({
  guardsApplied: z.array(
    z.strictObject({
      id: z.string(),
      params: z.record(z.string(), z.number()),
      explanation: z.string(),
      excluded: z.number().int(),
    }),
  ),
  coverage: z.strictObject({
    includedObservations: z.number().int(),
    totalObservations: z.number().int(),
    includedMembers: z.number().int(),
    totalMembers: z.number().int(),
  }),
  /** Disclosures that are not guards — undated members, for instance. */
  notes: z.array(z.string()),
  /**
   * The naive/honest comparison: the same spec run twice, once with `guards: []`.
   * Null when running it changed nothing material.
   */
  comparison: z
    .strictObject({
      material: z.boolean(),
      naive: z.array(ResultRowSchema),
      honest: z.array(ResultRowSchema),
      /**
       * How many members tie with the leading row on each side, **before the limit**.
       *
       * The rows above are capped at `spec.limit`, so they can say what the top of a
       * ranking looks like and not how wide that top is. The hero moment is exactly
       * that distinction: ten rows at 5.00 is a tie, and *296 members* at 5.00 is the
       * finding — the number that says the unchecked ranking is not a ranking at all.
       *
       * It counts members the ordering's **primary key** cannot separate: the ones the
       * tie-break, not the measure, decided between (`engine/execute.ts`,
       * `orderMembers`). Generic by construction — nothing here knows what a title is,
       * and a dataset with no ties reports 1 on both sides.
       */
      tiedAtTop: z.strictObject({
        naive: z.number().int(),
        honest: z.number().int(),
      }),
    })
    .nullable(),
});

export const ResultSetSchema = z.strictObject({
  spec: QuerySpecSchema,
  rows: z.array(ResultRowSchema),
  trust: TrustReportSchema,
  provenance: ProvenanceSchema,
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ResultRow = z.infer<typeof ResultRowSchema>;
export type TrustReport = z.infer<typeof TrustReportSchema>;
export type ResultSet = z.infer<typeof ResultSetSchema>;
