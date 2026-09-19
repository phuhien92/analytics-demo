import type { ResultSet, TrustReport } from "@/server/contracts";
import type { LayerLabels } from "@/lib/view-model";
import { CatchBlock, ChecksOffBlock } from "@/components/catch-block";
import { Chart } from "@/components/chart";
import { ProvenanceDetails } from "@/components/provenance-details";
import { ResultTable } from "@/components/result-table";
import { TrustStrip } from "@/components/trust-strip";
import { Card } from "@/components/ui/card";
import { formatters } from "@/lib/intl";

/**
 * The answer, in the order `docs/design.md` §6 fixes it.
 *
 * Takeaway → chart → trust strip → "How did you get this?", with one thing sitting
 * **above** that sequence when it exists: the catch. GA-12 renders the naive/honest
 * comparison open, full width and above the chart, and folds the takeaway into its head
 * rather than leaving a card of prose above the thing that prose is about.
 *
 * So the head of the answer is one of three, and exactly one:
 *
 * | When | What leads |
 * | --- | --- |
 * | The escape was taken | `ChecksOffBlock` — the checks that are not running, named |
 * | `trust.comparison` is not null | `CatchBlock` — the comparison |
 * | Otherwise | the takeaway on its own |
 *
 * The narration is built once, in `takeaway` below, and handed to whichever head runs.
 * One place renders the prose and its cut-short caution, so the two cannot drift.
 *
 * **The recipe sentence** is GA-11's and nothing here previews it; a sentence rendered
 * now without its closed lists would be a caption the user cannot act on.
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
  /** True only if the `end` frame arrived. */
  readonly narrationComplete: boolean;
  /** True once the stream has finished reading, with or without its `end` frame. */
  readonly streamClosed: boolean;
  readonly producer: "template" | "model";
  readonly degraded: boolean;
  readonly locale: string;
  /**
   * The checks turned off to produce *this* answer, or `null` on a normal answer.
   *
   * It is the previous answer's `guardsApplied`, carried by the surface across the
   * re-run. It cannot be derived from this answer: an escaped answer's own trust report
   * has no guards in it, which is precisely why the escape would otherwise be silent.
   */
  readonly checksOff: TrustReport["guardsApplied"] | null;
  /** Run this same question with every applied check off. */
  readonly onEscape: () => void;
  /** Run it again with the checks back on. */
  readonly onRestore: () => void;
  readonly busy: boolean;
};

export function AnswerCard({
  question,
  resultSet,
  labels,
  narration,
  narrationComplete,
  streamClosed,
  producer,
  degraded,
  locale,
  checksOff,
  onEscape,
  onRestore,
  busy,
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

  /**
   * The narration, built once and placed by whichever head runs.
   *
   * It is a node rather than a string so the cut-short caution travels with it: a
   * takeaway that stopped mid-sentence says so wherever it is rendered, and the reason
   * it gives — the figures came from the engine, not from this sentence — is the one
   * thing a reader most needs when the prose breaks inside the block that is arguing
   * about trust.
   */
  const takeaway = (
    <>
      <p aria-live="polite" aria-atomic="true" className="text-lead text-ga-ink">
        {narration === "" ? (
          <span className="text-ga-ink-muted">Writing the summary…</span>
        ) : (
          narration
        )}
      </p>
      {streamClosed && !narrationComplete ? (
        <p className="mt-2 text-small text-ga-caution-ink">
          The summary stopped before it finished. The figures above are unaffected — they
          came from the engine, not from this sentence.
        </p>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {checksOff !== null ? (
        <ChecksOffBlock
          question={question}
          turnedOff={checksOff}
          takeaway={takeaway}
          onRestore={onRestore}
          busy={busy}
        />
      ) : trust.comparison !== null ? (
        <CatchBlock
          question={question}
          comparison={trust.comparison}
          coverage={trust.coverage}
          guardsApplied={trust.guardsApplied}
          measureLabel={measureLabel}
          breakdownLabel={breakdownLabel}
          shape={shape}
          takeaway={takeaway}
          locale={locale}
          onEscape={onEscape}
          busy={busy}
        />
      ) : (
        <Card className="gap-3 px-0 py-5 ring-ga-line">
          <div className="px-5">
            <p className="text-small text-ga-ink-muted">
              You asked · <span className="text-ga-ink-secondary">“{question}”</span>
            </p>
            <div className="mt-2.5 max-w-measure">{takeaway}</div>
          </div>
        </Card>
      )}

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
