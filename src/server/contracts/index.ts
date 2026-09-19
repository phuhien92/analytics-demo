/**
 * The core contracts — every type the rest of the build reads.
 *
 * This module is a leaf. It imports nothing but `zod`: not `node:*`, not `next/*`, and
 * nothing under `warehouse/`, `engine/` or `ai/`. The client imports it too, and the
 * warehouse *consumes* the QuerySpec rather than owning it, so defining these types
 * beside the `Warehouse` interface would invert the dependency (build-spec §4.2a).
 */

export * from "./answer";
export * from "./ask";
export * from "./ids";
export * from "./payload";
export * from "./query-spec";
export * from "./rejection";
export * from "./result-set";
export * from "./semantic-layer";
export * from "./spec-patch";
