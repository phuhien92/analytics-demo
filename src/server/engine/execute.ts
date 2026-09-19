import type {
  Provenance,
  QuerySpec,
  ResultRow,
  ResultSet,
  SemanticLayer,
  TrustReport,
} from "@/server/contracts";

import { GUARD_REGISTRY } from "@/server/semantic/guards/registry";
import type { AggregatedMember, Aggregation, Warehouse } from "@/server/warehouse/types";

import { buildComparison } from "./compare";
import { compareCodeUnits, compareExact, roundHalfTowardZero } from "./numbers";

/**
 * The deterministic engine.
 *
 * This is where the product's central claim stops being a claim: **every number the
 * product ever shows is computed here, by pure functions, with no model anywhere near
 * it** (invariant 1). The AI turns a question into a `QuerySpec` and narrates a computed
 * result; nothing it returns is ever a figure.
 *
 * The engine owns everything downstream of aggregation — guards, ordering, the limit, the
 * trust report, provenance and the naive/honest comparison — so those are written once
 * and every adapter inherits them (`warehouse/types.ts`). The adapter owns grouping and
 * aggregation, which is the only part a `GROUP BY` would do differently, and therefore
 * the only part the conformance suite has to police.
 *
 * Nothing here names a dataset. It never branches on a measure, a dimension or a
 * `GuardId`: measures live in the adapter, guard behaviour in the registry, thresholds in
 * the layer.
 */

/**
 * Bumped when a change to this file would change a computed answer.
 *
 * It lands in provenance, so a re-run that disagrees with a stored answer can say whether
 * the engine moved or the data did — which is the difference between a bug and a fact.
 */
export const ENGINE_VERSION = "1.0.0";

export type ExecuteOptions = {
  warehouse: Warehouse;
  layer: SemanticLayer;
  requestId: string;
  /** ISO-8601 UTC. Injected rather than read from the clock, so a result is reproducible. */
  computedAt: string;
  locale?: string;
};

/** A member that survived every guard, paired with what the guards did on the way. */
type GuardOutcome = TrustReport["guardsApplied"][number];

/**
 * Apply the spec's guards to the aggregated members.
 *
 * **Guards are taken from the spec and resolved through the registry.** The engine never
 * branches on a `GuardId` — it looks the id up and calls what the registry declares, so a
 * dataset-specific assumption cannot reach engine code (invariant 6). An id absent from
 * the registry cannot arrive here: the loader refuses a layer naming one and `resolveSpec`
 * refuses a spec naming one.
 *
 * Guards run **in spec order**, and a member is attributed to the first guard that
 * excludes it. That is a stated rule rather than an obvious one: two guards can both
 * exclude the same member, and without an order the `excluded` counts in the trust report
 * would depend on iteration order and stop being reproducible.
 */
function applyGuards(
  members: readonly AggregatedMember[],
  spec: QuerySpec,
  layer: SemanticLayer,
  locale: string,
): { kept: AggregatedMember[]; outcomes: GuardOutcome[] } {
  const declared = new Map(layer.guards.map((guard) => [guard.id, guard]));
  const excludedCounts = new Map<string, number>();
  const kept: AggregatedMember[] = [];

  for (const member of members) {
    let excludedBy: string | null = null;
    for (const ref of spec.guards) {
      const implementation = GUARD_REGISTRY[ref.id];
      if (implementation === undefined) continue;
      if (implementation.excludes(member, ref.params)) {
        excludedBy = ref.id;
        break;
      }
    }
    if (excludedBy === null) kept.push(member);
    else excludedCounts.set(excludedBy, (excludedCounts.get(excludedBy) ?? 0) + 1);
  }

  const outcomes = spec.guards.map((ref) => ({
    id: ref.id,
    params: ref.params,
    // Copy says what was checked, in the user's words — never "verified" (invariant 5).
    explanation: declared.get(ref.id)?.explanation[locale] ?? "",
    excluded: excludedCounts.get(ref.id) ?? 0,
  }));

  return { kept, outcomes };
}

/**
 * The ordering rule: **`<measure> <dir>, <tieBreak> ASC, <member id> ASC`**.
 *
 * Total, stated, and identical on every adapter — which is what invariant 10 rests on.
 * Each of the three parts earns its place:
 *
 * 1. **The measure**, compared on the exact rational rather than the rounded value
 *    (`numbers.ts`). `sort.by: "breakdown"` orders by the member key instead.
 * 2. **The tie-break**, required on every spec because 296 titles tie at exactly 5.00 and
 *    four reasonable implementations produced three different answers without one
 *    (`docs/architecture.md` §2). It is the member's own key when the tie-break dimension
 *    *is* the breakdown dimension; otherwise the dimension is not a property of the member
 *    and every member shares the same value, so the rule falls through to (3).
 * 3. **The member's stable natural id**, which is what makes the order *total* rather than
 *    merely usually-total. A declared tie-break need not be unique: five MovieLens title
 *    strings are each shared by two different movieIds, and without this the order between
 *    that pair is whatever the adapter's iteration happened to produce.
 */
function orderMembers(members: AggregatedMember[], spec: QuerySpec): AggregatedMember[] {
  const direction = spec.sort.dir === "asc" ? 1 : -1;
  const tieBreakIsMemberKey = spec.breakdown !== undefined && spec.breakdown === spec.sort.tieBreak;

  return [...members].sort((a, b) => {
    const primary =
      spec.sort.by === "breakdown"
        ? compareCodeUnits(a.key ?? "", b.key ?? "")
        : compareExact(a, b);
    if (primary !== 0) return primary * direction;

    if (tieBreakIsMemberKey) {
      const tie = compareCodeUnits(a.key ?? "", b.key ?? "");
      if (tie !== 0) return tie;
    }

    return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
  });
}

function toRow(member: AggregatedMember, scale: number): ResultRow {
  const rawValue = roundHalfTowardZero(member.numerator, member.denominator);
  return {
    key: member.key,
    value: rawValue / scale,
    rawValue,
    n: member.observations,
  };
}

/**
 * The C4 disclosure, and the multi-membership overlap.
 *
 * C4 settled that the thirteen undated titles are **disclosed in the trust report rather
 * than given a fifth guard**: they carry 18 of 100,836 ratings (0.018%) and none clears
 * `min_evidence ≥ 20`, so a fifth guard would dilute the four that carry the hero moment
 * for an immaterial figure — but a silent drop is the failure mode this product exists to
 * catch, so it still has to be declared (build-spec §6, C4).
 *
 * The note is written generically: "entities the breakdown could not place", reported by
 * the adapter. Nothing here knows what a release year is — and deliberately nothing here
 * knows they are *titles* either. A hardcoded "titles" would be dataset-specific content
 * inside the engine, which is invariant 6's leak arriving through a copy string rather
 * than through a type. The neutral nouns are a placeholder for layer-supplied, locale-keyed
 * copy when GA-10/GA-11 style the trust strip; the *numbers* are the disclosure.
 */
function buildNotes(
  aggregation: Aggregation,
  spec: QuerySpec,
  layer: SemanticLayer,
  locale: string,
  totalObservations: number,
): string[] {
  const notes: string[] = [];
  const format = new Intl.NumberFormat(locale);
  const dimensionLabel = (id: string): string =>
    layer.dimensions.find((dimension) => dimension.id === id)?.labels[locale] ?? id;

  if (aggregation.unplaced.members > 0 && spec.breakdown !== undefined) {
    notes.push(
      `${format.format(aggregation.unplaced.members)} items carrying ` +
        `${format.format(aggregation.unplaced.observations)} of ` +
        `${format.format(totalObservations)} records have no ` +
        `${dimensionLabel(spec.breakdown)} and are left out of this breakdown.`,
    );
  }

  const overlap = aggregation.multiMembership;
  const disclosing = spec.guards.some((guard) => guard.id === "disclose_multi_membership");
  if (disclosing && overlap !== null && overlap.entities > 0 && spec.breakdown !== undefined) {
    notes.push(
      `${format.format(overlap.entities)} items belong to more than one ` +
        `${dimensionLabel(spec.breakdown)}, so this breakdown counts each of them once per ` +
        `${dimensionLabel(spec.breakdown)}.`,
    );
  }

  return notes;
}

/** One pass: aggregate, guard, order, limit. No comparison — that is the caller's double-run. */
async function executeOnce(
  spec: QuerySpec,
  resolvedAsOf: string,
  options: ExecuteOptions,
): Promise<{ rows: ResultRow[]; aggregation: Aggregation; trust: Omit<TrustReport, "comparison"> }> {
  const { warehouse, layer, locale = "en" } = options;
  const aggregation = await warehouse.aggregate({ spec, resolvedAsOf });
  const { kept, outcomes } = applyGuards(aggregation.members, spec, layer, locale);

  const rows = orderMembers(kept, spec)
    .slice(0, spec.limit)
    .map((member) => toRow(member, aggregation.scale));

  // Coverage counts observations **as the breakdown counts them**: a multi-valued
  // breakdown counts one fact once per member it belongs to, on both sides of the ratio,
  // and `disclose_multi_membership` is what names that overlap.
  const totalObservations =
    aggregation.members.reduce((sum, member) => sum + member.observations, 0) +
    aggregation.unplaced.observations;
  const includedObservations = kept.reduce((sum, member) => sum + member.observations, 0);

  return {
    rows,
    aggregation,
    trust: {
      guardsApplied: outcomes,
      coverage: {
        includedObservations,
        totalObservations,
        includedMembers: kept.length,
        totalMembers: aggregation.totalMembers,
      },
      notes: buildNotes(aggregation, spec, layer, locale, totalObservations),
    },
  };
}

/**
 * Execute a spec and return the complete `ResultSet`.
 *
 * ## The double-run
 *
 * The spec runs twice — once as asked, once with `guards: []` — through the *same* code
 * path, and the two row sets are diffed. There is no branch here that knows about ties,
 * about ratings, or about MovieLens: the hero moment appears because emptying the guards
 * genuinely changes the answer, and it would appear on any dataset where that is true.
 *
 * A spec that carries no guards is its own naive run, so the comparison is skipped rather
 * than computed against itself.
 *
 * ## The as-of
 *
 * `spec.asOf` may be `null`, meaning "latest", which only the engine can resolve.
 * `Provenance.resolvedAsOf` records what latest turned out to be and is **never null** —
 * an answer that cannot say which moment it describes cannot be reproduced, and the
 * conformance suite's whole job is reproducing them.
 */
export async function execute(spec: QuerySpec, options: ExecuteOptions): Promise<ResultSet> {
  const { warehouse, layer, requestId, computedAt } = options;

  const resolvedAsOf = spec.asOf ?? (await warehouse.latestAsOf());
  const honest = await executeOnce(spec, resolvedAsOf, options);

  let comparison: TrustReport["comparison"] = null;
  if (spec.guards.length > 0) {
    const naive = await executeOnce({ ...spec, guards: [] }, resolvedAsOf, options);
    comparison = buildComparison(naive.rows, honest.rows, layer);
  }

  const provenance: Provenance = {
    requestId,
    adapterId: warehouse.adapterId,
    sourceId: warehouse.sourceId,
    layerVersion: layer.version,
    layerSchemaVersion: layer.schemaVersion,
    resolvedAsOf,
    engineVersion: ENGINE_VERSION,
    computedAt,
  };

  return {
    spec,
    rows: honest.rows,
    trust: { ...honest.trust, comparison },
    provenance,
  };
}
