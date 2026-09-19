import { QuerySpecSchema, type Provenance, type QuerySpec, type SpecPatch } from "@/server/contracts";

import { resolveSpec, type ResolveResult } from "./resolve";

import type { SemanticLayer } from "@/server/contracts";

/**
 * A follow-up amends the previous spec rather than replacing it.
 *
 * The unit of conversational state is the spec, not a transcript (`AGENTS.md`, "The
 * QuerySpec") — cheaper, and an amendment can be rendered as a diff the user reads before
 * it applies. The patch is a closed set of operations rather than a deep partial for
 * exactly that reason: each operation is a line in that diff.
 */

/**
 * Apply a patch to its parent spec.
 *
 * ## The as-of rule, which is the whole reason this function takes provenance
 *
 * `reAsOf` **absent** means *inherit the parent's `resolvedAsOf`*: "now just EU"
 * interrogates the same snapshot the first answer did, so the two answers are comparable.
 * That is why the parent's **provenance** is a parameter and the parent's `spec.asOf` is
 * not enough — the parent may have asked for `null`, meaning "latest", and what "latest"
 * turned out to be is recorded only in provenance (`docs/architecture.md` §2).
 *
 * `reAsOf: null` means *re-resolve to latest* — deliberate time travel the user asked
 * for. The field is `.optional()` rather than defaulted precisely so that
 * `"reAsOf" in patch` stays a real discriminator through parsing, and this function is
 * where that distinction finally earns its keep.
 */
export function applyPatch(parent: QuerySpec, parentProvenance: Provenance, patch: SpecPatch): QuerySpec {
  const removed = new Set(patch.removeFilters);
  const filters = [
    ...parent.filters.filter((filter) => !removed.has(filter.dimension)),
    ...patch.addFilters,
  ];

  const breakdown = "breakdown" in patch ? patch.breakdown : parent.breakdown;

  const amended: QuerySpec = {
    measure: patch.measure ?? parent.measure,
    ...(breakdown === null || breakdown === undefined ? {} : { breakdown }),
    filters,
    sort: {
      by: patch.sort?.by ?? parent.sort.by,
      dir: patch.sort?.dir ?? parent.sort.dir,
      tieBreak: patch.sort?.tieBreak ?? parent.sort.tieBreak,
    },
    limit: patch.limit ?? parent.limit,
    guards: patch.setGuards ?? parent.guards,
    asOf: "reAsOf" in patch ? patch.reAsOf ?? null : parentProvenance.resolvedAsOf,
  };

  return QuerySpecSchema.parse(amended);
}

/**
 * Apply a patch and re-validate the result against the layer.
 *
 * An amendment can name something undeclared just as readily as a fresh question can —
 * "break that down by director" — so it takes the same path and returns the same
 * clarifying question rather than throwing (invariant 4).
 */
export function amendSpec(
  parent: QuerySpec,
  parentProvenance: Provenance,
  patch: SpecPatch,
  layer: SemanticLayer,
  asked = "(amendment)",
): ResolveResult {
  const candidate = {
    measure: patch.measure ?? parent.measure,
    ...("breakdown" in patch
      ? patch.breakdown === null
        ? {}
        : { breakdown: patch.breakdown }
      : parent.breakdown === undefined
        ? {}
        : { breakdown: parent.breakdown }),
    filters: [
      ...parent.filters.filter((filter) => !new Set(patch.removeFilters).has(filter.dimension)),
      ...patch.addFilters,
    ],
    sort: {
      by: patch.sort?.by ?? parent.sort.by,
      dir: patch.sort?.dir ?? parent.sort.dir,
      tieBreak: patch.sort?.tieBreak ?? parent.sort.tieBreak,
    },
    limit: patch.limit ?? parent.limit,
    guards: patch.setGuards ?? parent.guards,
    asOf: "reAsOf" in patch ? patch.reAsOf : parentProvenance.resolvedAsOf,
  };

  return resolveSpec(candidate, layer, asked);
}
