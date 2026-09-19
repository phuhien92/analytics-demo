import { Check, Info } from "lucide-react";

import type { TrustReport } from "@/server/contracts";
import { Badge } from "@/components/ui/badge";
import { formatters } from "@/lib/intl";

/**
 * What was checked, in the layer's own words.
 *
 * Invariant 5: trust is **shown, not claimed**, and the word "verified" appears nowhere
 * — the verification is genuine but partial (`docs/design.md` §3), and overclaiming it
 * reproduces the silent failure this product exists to criticise. So every pill below is
 * a statement of what the engine did, with the number it did it to.
 *
 * None of this copy is written here. Each guard's sentence is its `explanation` from
 * `semantic/movielens.json`, and the counts are fields on the `TrustReport` the engine
 * returned. A surface that authored its own trust copy could describe a check the engine
 * did not run — which is the one lie this product cannot afford.
 *
 * It sits inline, at answer level, rather than in the side column: it qualifies *this*
 * number, so it has to travel with this number (`docs/design.md` §6).
 *
 * No meaning is carried by colour alone (`docs/design.md` §7). Each pill states its
 * fact in words; the glyph distinguishes a check that ran from a disclosure that is not
 * a check, and both are announced by their `sr-only` label rather than by hue.
 */

export type TrustStripProps = {
  readonly trust: TrustReport;
  /** The breakdown's declared label, for naming what a "member" is. `null` when there is none. */
  readonly breakdownLabel: string | null;
  readonly locale: string;
};

function Pill({
  kind,
  children,
}: {
  readonly kind: "check" | "note";
  readonly children: React.ReactNode;
}) {
  const Icon = kind === "check" ? Check : Info;
  return (
    <Badge
      variant="outline"
      className="h-auto items-start gap-2 rounded-3xl border-ga-line bg-ga-surface px-3.5 py-2 text-small font-text whitespace-normal text-ga-ink-secondary"
    >
      <Icon
        className="mt-0.5 size-3.5! shrink-0 text-ga-good-ink"
        aria-hidden="true"
        strokeWidth={2.5}
      />
      <span className="sr-only">{kind === "check" ? "Checked:" : "Note:"}</span>
      <span className="text-left">{children}</span>
    </Badge>
  );
}

export function TrustStrip({ trust, breakdownLabel, locale }: TrustStripProps) {
  const format = formatters(locale);
  const { coverage, guardsApplied, notes } = trust;

  return (
    <ul aria-label="What was checked" className="flex list-none flex-wrap gap-2.5 p-0">
      <li>
        <Pill kind="check">
          Built on <b className="font-semibold text-ga-ink">{format.count(coverage.includedObservations)}</b> of{" "}
          {format.count(coverage.totalObservations)} records
        </Pill>
      </li>

      {breakdownLabel !== null ? (
        <li>
          <Pill kind="check">
            <b className="font-semibold text-ga-ink">{format.count(coverage.includedMembers)}</b> of{" "}
            {format.count(coverage.totalMembers)} {breakdownLabel} values included
          </Pill>
        </li>
      ) : null}

      {guardsApplied.map((guard) => (
        <li key={guard.id}>
          <Pill kind="check">
            {guard.explanation}{" "}
            {guard.excluded > 0 ? (
              <>
                <b className="font-semibold text-ga-ink">{format.count(guard.excluded)}</b> left out.
              </>
            ) : (
              <>None were left out.</>
            )}
          </Pill>
        </li>
      ))}

      {notes.map((note) => (
        <li key={note}>
          <Pill kind="note">{note}</Pill>
        </li>
      ))}
    </ul>
  );
}
