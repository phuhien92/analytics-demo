import type { QuerySpec } from "@/server/contracts";

/**
 * The warehouse boundary: **aggregation, not rows** (AGENTS.md invariant 9).
 *
 * An adapter groups and aggregates — 100,836 ratings collapse to at most one member per
 * breakdown value — and hands back that member set. It never streams facts to the app,
 * because an adapter that did would not survive being pointed at a real warehouse.
 *
 * ## What the adapter owns, and what it does not
 *
 * The adapter owns **grouping and aggregation**, which is the part that differs between a
 * typed-array loop and a `GROUP BY`. Everything downstream of that — guards, ordering,
 * the limit, the trust report, provenance and the naive/honest comparison — belongs to
 * `engine/`, written once and inherited by every adapter.
 *
 * That split is a determinism decision, not a layering preference. Invariant 10 says
 * determinism is *proved*, and the conformance suite is the proof; the less an adapter
 * decides, the less the suite has to police and the fewer places two adapters can quietly
 * disagree. Its cost is that an adapter returns every member rather than the top `limit`
 * ones — bounded here by dimension cardinality (title, 9,742) and explicitly deferred as
 * "caching and pushdown past ~1M rows" in `docs/architecture.md` §1.
 *
 * ## Exact integers cross this boundary; floats never do
 *
 * A member carries `numerator` and `denominator` as integers, not a computed average.
 * Two adapters summing the same ratings in a different order agree **exactly** on an
 * integer sum and need not agree on a floating-point one, so the quantity that crosses
 * the boundary is the one that cannot drift. The engine derives the presentation value
 * from the pair, identically for every adapter (`engine/execute.ts`).
 */

/**
 * The member standing for "this entity declares no value for the breakdown dimension".
 *
 * Emitted by the adapter so `exclude_uncategorised` has something generic to drop. A
 * sentinel rather than a real key, and chosen outside the range of any plausible label so
 * a dataset cannot collide with it. The guard removes the member; nothing about which
 * dataset produced it reaches the engine.
 */
export const UNCATEGORISED_KEY = "\u0000:uncategorised";

/** One aggregated breakdown member. Integers only — see the note above. */
export type AggregatedMember = {
  /** The breakdown member's label; `null` when the spec has no breakdown. */
  key: string | null;
  /**
   * A stable natural key from the source data — the partner's id, never a storage
   * position. It is the final ordering discriminator, so an adapter that used a row
   * index would order the 5 MovieLens titles that share a title string differently from
   * one that did not. `0` when there is no breakdown.
   */
  memberId: number;
  /** Exact numerator of the measure's value **in its scaled units**. */
  numerator: number;
  /** Exact denominator. `1` for a count measure. */
  denominator: number;
  /** Observations behind this member, at the measure's own grain. Guards threshold on it. */
  observations: number;
  /** True for the `UNCATEGORISED_KEY` member; `exclude_uncategorised` drops it. */
  uncategorised: boolean;
};

/** What the adapter reports about what it could *not* place, so the engine can declare it. */
export type Unplaced = {
  /** Entities the breakdown dimension has no value for — undated titles, for instance. */
  members: number;
  /** Observations those entities carry. */
  observations: number;
};

export type Aggregation = {
  /** The measure's presentation scale: 100 means `numerator/denominator` is in hundredths. */
  scale: number;
  members: AggregatedMember[];
  /** Observations in scope at the as-of, before any guard. */
  totalObservations: number;
  /** Members in scope before any guard. */
  totalMembers: number;
  /**
   * Entities the breakdown could not place. Per C4 (build-spec §6) the engine turns a
   * non-zero count on a date breakdown into a trust-report note rather than a fifth guard,
   * so the drop is declared instead of silent.
   */
  unplaced: Unplaced;
  /**
   * Entities belonging to more than one member, when the breakdown is multi-valued.
   * `null` when the breakdown cannot overlap. Feeds `disclose_multi_membership`.
   */
  multiMembership: { entities: number; assignments: number } | null;
};

export type AggregateRequest = {
  spec: QuerySpec;
  /** ISO-8601 UTC, already resolved by the engine. Never null — invariant: see §2. */
  resolvedAsOf: string;
};

/**
 * One adapter. `adapterId` lands in provenance, so an answer names the engine that
 * produced it and the conformance suite can report which adapter a case ran against.
 */
export interface Warehouse {
  readonly adapterId: string;
  /** Names the received payload's source, never a file on disk. Flows into provenance. */
  readonly sourceId: string;
  /** The latest moment this warehouse can answer at. Resolves a spec's `asOf: null`. */
  latestAsOf(): Promise<string>;
  aggregate(request: AggregateRequest): Promise<Aggregation>;
}

/** A declared id this adapter cannot compute — a deployment fault, not a user's question. */
export class WarehouseCapabilityError extends Error {
  override readonly name = "WarehouseCapabilityError";

  constructor(adapterId: string, kind: "measure" | "dimension", id: string) {
    super(
      `${adapterId}: the semantic layer declares the ${kind} "${id}" but this adapter cannot compute it`,
    );
  }
}
