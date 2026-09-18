import { z } from "zod";

/**
 * The shape of the semantic layer. Its *contents* land in GA-03 as versioned JSON —
 * editing or reviewing the layer is a normal operation, not a code change (AGENTS.md
 * invariant 7), which is why this file declares shape and names nothing.
 */

/** locale → display text. Locale-keyed, never flat (AGENTS.md invariant 8). */
export const LocalisedTextSchema = z.record(z.string(), z.string());

/** locale → synonyms. Synonyms are how a question matches a measure, so understanding
 * is itself locale-dependent; flattening this costs a schema, prompt and matching
 * rewrite later, and every eval passes against a flat layer until the first non-English
 * locale. */
export const LocalisedListSchema = z.record(z.string(), z.array(z.string()));

export const MeasureDeclarationSchema = z.strictObject({
  id: z.string().min(1),
  labels: LocalisedTextSchema,
  synonyms: LocalisedListSchema.default({}),
});

export const DimensionDeclarationSchema = z.strictObject({
  id: z.string().min(1),
  labels: LocalisedTextSchema,
  synonyms: LocalisedListSchema.default({}),
});

export const GuardDeclarationSchema = z.strictObject({
  id: z.string().min(1),
  labels: LocalisedTextSchema,
  /** What was checked, in the user's words. Copy says what was checked, never "verified". */
  explanation: LocalisedTextSchema,
  /** Thresholds arrive as spec params; the layer supplies the defaults. */
  defaultParams: z.record(z.string(), z.number()),
});

export const SemanticLayerSchema = z.strictObject({
  /** The layer's own version. Saved recipes are keyed by it. */
  version: z.string().min(1),
  /** The version of *this* schema the layer was written against. */
  schemaVersion: z.number().int(),
  /** A DimensionId. Fills QuerySpec.sort.tieBreak, which the model never chooses. */
  defaultTieBreak: z.string().min(1),
  /**
   * Declared here rather than in the engine, so GA-12 can tune the naive/honest
   * comparison against the rendered block as a data edit.
   */
  materiality: z.strictObject({
    /** One presentation step. A measure delta of at least this much is material. */
    minValueDelta: z.number(),
  }),
  measures: z.array(MeasureDeclarationSchema),
  dimensions: z.array(DimensionDeclarationSchema),
  guards: z.array(GuardDeclarationSchema),
});

export type LocalisedText = z.infer<typeof LocalisedTextSchema>;
export type LocalisedList = z.infer<typeof LocalisedListSchema>;
export type MeasureDeclaration = z.infer<typeof MeasureDeclarationSchema>;
export type DimensionDeclaration = z.infer<typeof DimensionDeclarationSchema>;
export type GuardDeclaration = z.infer<typeof GuardDeclarationSchema>;
export type SemanticLayer = z.infer<typeof SemanticLayerSchema>;
