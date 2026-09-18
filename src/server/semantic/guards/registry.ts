import type { GuardId } from "@/server/contracts";

/**
 * The guard registry — the closed set of `GuardId`s this build knows how to apply.
 *
 * A `GuardId` in a `QuerySpec` is valid because this registry holds it, never because a
 * core type named it (AGENTS.md invariant 6). The layer declares which guards a dataset
 * ships and what their thresholds default to; this file declares what the engine can
 * actually do with one, and the loader refuses any layer that names an id absent here.
 *
 * **Exactly four entries.** C4 settled that the thirteen undated titles are disclosed in
 * the trust report's coverage line rather than given a fifth guard — they carry 18 of
 * 100,836 ratings (0.018%) and none clears `min_evidence`, so a fifth guard would dilute
 * the four that carry the hero moment for an immaterial figure. `tests/semantic.test.ts`
 * asserts the count, so a fifth cannot arrive without reopening that decision.
 *
 * **No threshold lives here.** `min_evidence` reads `minObservations`; what that number
 * *is* arrives in the spec's `params`, defaulted by the layer. A `20` in this file would
 * put a dataset's measurement inside the code that is supposed to be dataset-agnostic.
 */

export interface GuardImplementation {
  /**
   * The parameter names this guard reads from `GuardRef.params`. Declared rather than
   * inferred so the loader can reject a layer whose `defaultParams` carry a key no guard
   * reads — otherwise a typo defaults to nothing at execution time and the guard quietly
   * runs unthresholded, which is the silent coercion invariant 4 exists to remove.
   */
  readonly params: readonly string[];
}

export const GUARD_REGISTRY: Readonly<Record<string, GuardImplementation>> = {
  /** Drops members whose observation count falls below `minObservations`. */
  min_evidence: { params: ["minObservations"] },
  /** Drops members with no observations at all. */
  exclude_unrated: { params: [] },
  /** Drops the sentinel member standing for "no category declared". */
  exclude_uncategorised: { params: [] },
  /** Excludes nothing; reports the overlap when members belong to several groups. */
  disclose_multi_membership: { params: [] },
};

/** Sorted, so every error message and every assertion reads the same way. */
export const REGISTERED_GUARD_IDS: readonly GuardId[] = Object.keys(GUARD_REGISTRY)
  .sort()
  .map((id) => id as GuardId);

export function isRegisteredGuard(id: string): id is GuardId {
  return Object.hasOwn(GUARD_REGISTRY, id);
}
