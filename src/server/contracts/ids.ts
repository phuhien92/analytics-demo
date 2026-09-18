/**
 * Branded identifiers for everything the semantic layer declares.
 *
 * Nothing dataset-specific ever lands here (AGENTS.md invariant 6). These are opaque
 * strings whose meaning is resolved against the layer at load; a `GuardId` is only
 * valid because the registry the layer declares holds it, never because this file
 * named it.
 */

export type MeasureId = string & { readonly __brand: "MeasureId" };
export type DimensionId = string & { readonly __brand: "DimensionId" };
export type GuardId = string & { readonly __brand: "GuardId" };
