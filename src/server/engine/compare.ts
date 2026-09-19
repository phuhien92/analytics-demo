import type { ResultRow, SemanticLayer, TrustReport } from "@/server/contracts";

/**
 * The naive/honest comparison.
 *
 * **This is generic engine behaviour, not a feature and not a rule about this dataset.**
 * The engine runs the spec, runs it again with `guards: []`, and diffs the two row sets.
 * The hero moment — 296 titles tied at 5.00 collapsing to *A Streetcar Named Desire* at
 * 4.47 with n=20 — falls out of that mechanism without anything here knowing what a movie
 * is. If it needed a special case to appear, the mechanism would be wrong (build-spec §3
 * GA-04, "Must not").
 *
 * The same double-run is the seam a later "why did it move?" plugs into: two as-of points
 * instead of two guard sets, diffed by the same code (build-spec §9).
 */

/**
 * Whether emptying the guards changed the answer enough to show.
 *
 * Two things make a comparison material, and **only one of them needs a number**:
 *
 * 1. **Membership changed.** A different set of members in the top-`limit` rows is
 *    structural — 296 titles displacing the real top four is not a question of degree,
 *    and no threshold is involved.
 * 2. **A shared member's value moved by at least `minValueDelta`.**
 *
 * The threshold is read from the layer and never hardcoded, so GA-12 can tune the
 * comparison against the rendered block as a data edit rather than by editing the engine
 * (build-spec §5, boundary 3; `docs/architecture.md` §3).
 */
export function materiallyDifferent(
  naive: readonly ResultRow[],
  honest: readonly ResultRow[],
  minValueDelta: number,
): boolean {
  if (naive.length !== honest.length) return true;

  const naiveKeys = naive.map((row) => row.key);
  const honestKeys = honest.map((row) => row.key);
  for (let i = 0; i < naiveKeys.length; i++) {
    if (naiveKeys[i] !== honestKeys[i]) return true;
  }

  for (let i = 0; i < naive.length; i++) {
    const before = naive[i]!;
    const after = honest[i]!;
    if (Math.abs(before.value - after.value) >= minValueDelta) return true;
    // A row whose value held steady while its evidence base moved is still a different
    // answer: the number survived, the reason to believe it did not.
    if (before.n !== after.n) return true;
  }

  return false;
}

/**
 * Build the trust report's comparison block.
 *
 * `null` when running the spec without guards changed nothing material, which is what the
 * contract's `comparison` field means by null (`contracts/result-set.ts`). `material` is
 * still carried explicitly on the object rather than left implied by non-nullness, so a
 * consumer reading one does not have to infer the verdict from the shape.
 */
export function buildComparison(
  naive: readonly ResultRow[],
  honest: readonly ResultRow[],
  layer: SemanticLayer,
): TrustReport["comparison"] {
  if (!materiallyDifferent(naive, honest, layer.materiality.minValueDelta)) return null;
  return { material: true, naive: [...naive], honest: [...honest] };
}
