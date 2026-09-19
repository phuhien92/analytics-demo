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

/**
 * What a guard is allowed to look at.
 *
 * Structural rather than an import of the warehouse's `AggregatedMember`, so the registry
 * stays independent of how a member was produced — and so a guard cannot reach for a
 * dataset-specific field that happens to be lying next to it.
 */
export type GuardSubject = {
  /** Facts behind this member, at the measure's own grain. */
  readonly observations: number;
  /** True for the sentinel member standing for "no category declared". */
  readonly uncategorised: boolean;
};

export interface GuardImplementation {
  /**
   * The parameter names this guard reads from `GuardRef.params`. Declared rather than
   * inferred so the loader can reject a layer whose `defaultParams` carry a key no guard
   * reads — otherwise a typo defaults to nothing at execution time and the guard quietly
   * runs unthresholded, which is the silent coercion invariant 4 exists to remove.
   */
  readonly params: readonly string[];
  /**
   * Whether this guard excludes the member. **This is the only place a guard's behaviour
   * is written.** The engine iterates the spec's guards and calls this; it never branches
   * on a `GuardId`, so a `minRatingsPerTitle`-shaped assumption cannot get into engine
   * code one layer down from the core type that already forbids it (invariant 6).
   *
   * Thresholds arrive in `params`, defaulted by the layer — never read from here.
   */
  readonly excludes: (subject: GuardSubject, params: Readonly<Record<string, number>>) => boolean;
}

export const GUARD_REGISTRY: Readonly<Record<string, GuardImplementation>> = {
  /** Drops members whose observation count falls below `minObservations`. */
  min_evidence: {
    params: ["minObservations"],
    excludes: (subject, params) => subject.observations < (params["minObservations"] ?? 0),
  },
  /** Drops members with no observations at all. */
  exclude_unrated: { params: [], excludes: (subject) => subject.observations === 0 },
  /** Drops the sentinel member standing for "no category declared". */
  exclude_uncategorised: { params: [], excludes: (subject) => subject.uncategorised },
  /** Excludes nothing; reports the overlap when members belong to several groups. */
  disclose_multi_membership: { params: [], excludes: () => false },
};

/** Sorted, so every error message and every assertion reads the same way. */
export const REGISTERED_GUARD_IDS: readonly GuardId[] = Object.keys(GUARD_REGISTRY)
  .sort()
  .map((id) => id as GuardId);

export function isRegisteredGuard(id: string): id is GuardId {
  return Object.hasOwn(GUARD_REGISTRY, id);
}
