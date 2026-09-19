import type { ResultSet } from "@/server/contracts";
import type { LayerLabels } from "@/lib/view-model";
import { Chart } from "@/components/chart";
import { ProvenanceDetails } from "@/components/provenance-details";
import { ResultTable } from "@/components/result-table";
import { TrustStrip } from "@/components/trust-strip";
import { Card } from "@/components/ui/card";
import { formatters } from "@/lib/intl";

/**
 * The answer, in the order `docs/design.md` §6 fixes it.
 *
 * Takeaway → chart → trust strip → "How did you get this?". Two things that belong in
 * that sequence are not here yet, and their absence is the plan rather than a gap:
 *
 * - **The naive/honest comparison** is GA-12's, and build-spec §3 GA-10 says so in
 *   as many words — "the comparison block is expected absent until GA-12 — stated here
 *   so it is not discovered as a bug". `resultSet.trust.comparison` is already on the
 *   object this component receives, untouched.
 * - **The recipe sentence** is GA-11's. Nothing here previews it; a sentence rendered
 *   now without its closed lists would be a caption the user cannot act on, and GA-11
 *   would have to unbuild it.
 *
 * Every number on this screen came off `resultSet`, which came off the engine. The
 * takeaway is the only prose, it arrives on its own frames after the object, and it is
 * written by a producer the provenance block names.
 */

export type AnswerCardProps = {
  readonly question: string;
  readonly resultSet: ResultSet;
  readonly labels: LayerLabels;
  readonly narration: string;
  /** False while the stream is still open, or if it ended without its `end` frame. */
  readonly narrationComplete: boolean;
  readonly producer: "template" | "model";
  readonly degraded: boolean;
  readonly locale: string;
};

export function AnswerCard({
  question,
  resultSet,
  labels,
  narration,
  narrationComplete,
  producer,
  degraded,
  locale,
}: AnswerCardProps) {
  const { spec, rows, trust, provenance } = resultSet;
  const format = formatters(locale);

  const measureLabel = labels.measures[spec.measure] ?? spec.measure;
  const breakdownLabel =
    spec.breakdown === undefined ? null : (labels.dimensions[spec.breakdown] ?? spec.breakdown);

  // The same rule the chart uses to choose its form: the spec's own ordering says
  // whether this is a ranking or a sequence. Nothing here reads the dataset.
  const shape = spec.sort.by === "measure" ? "ranking" : "sequence";
  const caption =
    breakdownLabel === null
      ? measureLabel
      : shape === "ranking"
        ? `${measureLabel} by ${breakdownLabel}, ranked`
        : `${measureLabel} by ${breakdownLabel}`;

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 px-0 py-5 ring-ga-line">
        <div className="px-5">
          <p className="text-small text-ga-ink-muted">
            You asked · <span className="text-ga-ink-secondary">“{question}”</span>
          </p>
          <p
            aria-live="polite"
            aria-atomic="true"
            className="mt-2.5 max-w-measure text-lead text-ga-ink"
          >
            {narration === "" ? (
              <span className="text-ga-ink-muted">Writing the summary…</span>
            ) : (
              narration
            )}
          </p>
          {narration !== "" && !narrationComplete ? (
            <p className="mt-2 text-small text-ga-caution-ink">
              The summary stopped before it finished. The figures above are unaffected — they
              came from the engine, not from this sentence.
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="gap-0 px-0 py-5 ring-ga-line">
        <figure className="px-5">
          <figcaption className="mb-3 text-small text-ga-ink-secondary">
            {caption} · as of {format.date(provenance.resolvedAsOf)}
          </figcaption>
          {rows.length === 0 ? (
            <p className="py-6 text-body text-ga-ink-secondary">
              Nothing is left to show once the checks below are applied.
            </p>
          ) : (
            <Chart
              rows={rows}
              measureLabel={measureLabel}
              breakdownLabel={breakdownLabel}
              shape={shape}
              locale={locale}
            />
          )}
          <ResultTable
            rows={rows}
            measureLabel={measureLabel}
            breakdownLabel={breakdownLabel}
            caption={caption}
            locale={locale}
          />
        </figure>
      </Card>

      <TrustStrip trust={trust} breakdownLabel={breakdownLabel} locale={locale} />

      <ProvenanceDetails
        provenance={provenance}
        producer={producer}
        degraded={degraded}
        locale={locale}
      />
    </div>
  );
}
