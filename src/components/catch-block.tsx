import { AlertTriangle } from "lucide-react";

import type { ResultRow, TrustReport } from "@/server/contracts";
import { formatters } from "@/lib/intl";

/**
 * The catch: what the question would have answered without the checks, beside what it
 * answers with them.
 *
 * This is the increment the product exists for (`docs/design.md` §3). Everything before
 * it is machinery that makes the comparison true; this is where a person sees it. So it
 * renders **open, full width, above the chart, as the largest object on the screen**,
 * with the takeaway folded into its head — build-spec §3 GA-12, and the arrangement the
 * approved mock draws.
 *
 * ## It is a visual event, not a disclosure
 *
 * An earlier draft of the mock hid the two lists behind a "show me what I would have
 * got" button. That put the one thing no competitor does behind a click and foregrounded
 * the commoditised part. There was never a dead-furniture problem to hedge against,
 * because the engine already makes the block conditional: `trust.comparison` is null
 * unless emptying the guards changed the answer materially (`engine/compare.ts`), so an
 * answer no check moved simply does not draw this.
 *
 * ## Nothing here knows what a movie is
 *
 * Every figure comes off `trust.comparison`, which came off the engine's generic
 * double-run — the same spec, executed again with `guards: []`, diffed. There is no
 * branch on a measure, a dimension, a `GuardId` or a value, and the hero moment appears
 * because emptying the guards genuinely changes this answer, not because this component
 * recognises it. Point the product at other data where a check changes an answer and the
 * same block draws (invariant 6, and build-spec §3 GA-04's first must-not).
 *
 * The nouns are the layer's. Copy never pluralises a declared label — a label is data,
 * and inflecting it is the coercion invariant 4 forbids arriving through a copy string —
 * so it follows the idiom the trust strip already ships: "{n} {label} values".
 *
 * ## No meaning is carried by colour alone
 *
 * `docs/design.md` §7. Each side states in words which it is ("Without the checks" /
 * "What we are showing you"), each row writes out its own value and the records behind
 * it, the closing line states the difference in prose, and the two headings are what a
 * screen reader announces. Strip the colour and nothing is lost.
 */

type Comparison = NonNullable<TrustReport["comparison"]>;

export type CatchBlockProps = {
  readonly question: string;
  readonly comparison: Comparison;
  readonly coverage: TrustReport["coverage"];
  readonly guardsApplied: TrustReport["guardsApplied"];
  readonly measureLabel: string;
  /** `null` when the spec has no breakdown. */
  readonly breakdownLabel: string | null;
  /** The spec's own ordering, the same rule the chart reads. */
  readonly shape: "ranking" | "sequence";
  /** The takeaway, rendered by the caller and folded into this head. */
  readonly takeaway: React.ReactNode;
  readonly locale: string;
  /** The one-tap escape: run this same question with every applied check off. */
  readonly onEscape: () => void;
  readonly busy: boolean;
};

/** The label the surface uses for a breakdown member, without inflecting the layer's word. */
function memberNoun(breakdownLabel: string | null): string {
  return breakdownLabel === null ? "values" : `${breakdownLabel} values`;
}

/**
 * "1 record" / "20 records".
 *
 * The naive leaders in the hero moment rest on **one** rating each, so this is not a
 * tidiness question: the sentence that carries the whole argument would otherwise read
 * "as few as 1 records". `record` is this surface's own English word and inflecting it is
 * ordinary copy — unlike a declared label, which is layer data and stays as declared.
 */
function recordCount(n: number, format: (n: number) => string): string {
  return `${format(n)} ${n === 1 ? "record" : "records"}`;
}

function Row({
  row,
  rank,
  value,
  records,
  tone,
}: {
  readonly row: ResultRow;
  readonly rank: number;
  readonly value: string;
  readonly records: string | null;
  readonly tone: "naive" | "honest";
}) {
  return (
    <li
      className={`grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-1 rounded-lg bg-ga-surface/70 px-3 py-2 text-small ${
        tone === "naive" ? "text-ga-risk-ink" : "text-ga-good-ink"
      }`}
    >
      <span className="text-micro tracking-normal text-ga-ink-muted">{rank}</span>
      {/*
       * Wraps, never truncates. In the hero moment the titles *are* the point, and an
       * ellipsis on the one list that is supposed to embarrass the naive answer hides
       * the evidence (build-spec §3 GA-12, "Done when").
       */}
      <span className="leading-snug break-words text-ga-ink">{row.key ?? "—"}</span>
      <span className="text-right font-semibold whitespace-nowrap">
        {value}
        {records === null ? null : (
          <small className="ml-1.5 font-text text-ga-ink-muted">{records}</small>
        )}
      </span>
    </li>
  );
}

function Side({
  tone,
  badge,
  heading,
  headingId,
  detail,
  rows,
  value,
  records,
  foot,
}: {
  readonly tone: "naive" | "honest";
  readonly badge: string;
  readonly heading: string;
  readonly headingId: string;
  readonly detail: string;
  readonly rows: readonly ResultRow[];
  readonly value: (n: number) => string;
  readonly records: (row: ResultRow) => string | null;
  readonly foot: string;
}) {
  const naive = tone === "naive";
  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-xl border px-5 py-4 ${
        naive
          ? "border-ga-risk-line bg-ga-risk-bg"
          : "border-ga-good-line bg-ga-good-bg"
      }`}
    >
      <p
        className={`inline-block rounded-3xl px-2.5 py-0.5 text-micro font-semibold uppercase ${
          naive ? "bg-ga-risk-ink text-ga-surface" : "bg-ga-good-ink text-ga-surface"
        }`}
      >
        {badge}
      </p>
      <h3
        id={headingId}
        className={`mt-2 text-body font-semibold ${naive ? "text-ga-risk-ink" : "text-ga-good-ink"}`}
      >
        {heading}
      </h3>
      <p className={`mt-1 text-small ${naive ? "text-ga-risk-ink" : "text-ga-good-ink"}`}>
        {detail}
      </p>
      <ol className="mt-3 flex list-none flex-col gap-1.5 p-0">
        {rows.map((row, index) => (
          <Row
            key={`${row.key ?? "row"}-${index}`}
            row={row}
            rank={index + 1}
            value={value(row.value)}
            records={records(row)}
            tone={tone}
          />
        ))}
      </ol>
      <p
        className={`mt-3 text-micro font-semibold tracking-normal ${
          naive ? "text-ga-risk-ink" : "text-ga-good-ink"
        }`}
      >
        {foot}
      </p>
    </section>
  );
}

export function CatchBlock({
  question,
  comparison,
  coverage,
  guardsApplied,
  measureLabel,
  breakdownLabel,
  shape,
  takeaway,
  locale,
  onEscape,
  busy,
}: CatchBlockProps) {
  const format = formatters(locale);
  const { naive, honest, tiedAtTop } = comparison;

  /**
   * One digit width across **both** lists.
   *
   * `Formatters.column` exists because a column that writes `4.47` above `4.3` reads as
   * a precision that changes row by row. Two lists set side by side to be compared are
   * one column for that purpose: taken separately, the naive side's values are all
   * exactly 5 and would be written `5` against the honest side's `4.47`, which is the
   * same defect drawn twice as wide.
   */
  const value = format.column([...naive, ...honest].map((row) => row.value));

  /**
   * The same rule `ResultTable` uses: drop the record count when the measure *is* that
   * count, because a column restating its neighbour reads as a defect rather than as
   * evidence. Derived from the rows, not from knowing which measures are counts.
   */
  const showsRecords = [...naive, ...honest].some((row) => row.n !== row.value);
  const records = (row: ResultRow): string | null =>
    showsRecords ? recordCount(row.n, format.count) : null;

  const naiveLead = naive[0];
  const honestLead = honest[0];
  const members = memberNoun(breakdownLabel);

  // A shared member is one the checks did not remove. Keyed on the member key, which is
  // what the row carries; the engine keys on `(memberId, key)` and the surface only ever
  // sees the label.
  const honestKeys = new Set(honest.map((row) => row.key));
  const survivors = naive.filter((row) => honestKeys.has(row.key)).length;

  const tied = tiedAtTop.naive;
  const naiveIsTie = tied > 1 && shape === "ranking";

  const headline =
    naiveLead === undefined
      ? `Asked without the checks, this question answers from a different set of ${members}.`
      : naiveIsTie
        ? `Asked without the checks, this question would have handed you ` +
          `${format.count(tied)} ${members} tied at ${value(naiveLead.value)}.`
        : `Asked without the checks, this question would have led with ` +
          `${naiveLead.key ?? measureLabel} at ${value(naiveLead.value)}.`;

  const subhead =
    honestLead === undefined
      ? `With the checks applied, nothing is left to show.`
      : shape === "sequence"
        ? `With the checks applied, it starts at ${honestLead.key ?? measureLabel} ` +
          `with ${value(honestLead.value)}.`
        : `With the checks applied, ${honestLead.key ?? measureLabel} leads at ` +
          `${value(honestLead.value)}` +
          (showsRecords ? ` from ${recordCount(honestLead.n, format.count)}.` : ".");

  const naiveHeading = naiveIsTie
    ? `${format.count(tied)} tied at ${value(naiveLead!.value)}`
    : naiveLead === undefined
      ? `Nothing ranked`
      : `Led by ${naiveLead.key ?? measureLabel} at ${value(naiveLead.value)}`;

  const naiveDetail =
    tied > naive.length
      ? `Ranked on ${measureLabel} alone, with nothing checked. First ` +
        `${format.count(naive.length)} of ${format.count(tied)}.`
      : `Ranked on ${measureLabel} alone, with nothing checked.`;

  const naiveFoot =
    survivors === 0
      ? `Not one of these is still here once the checks run.`
      : survivors === naive.length
        ? `Every one of these is still here once the checks run.`
        : `Still here once the checks run: ${format.count(survivors)} of ` +
          `${format.count(naive.length)}.`;

  const honestHeading = `${format.count(coverage.includedMembers)} of ${format.count(
    coverage.totalMembers,
  )} ${members} clear every check`;

  const excluded = guardsApplied.reduce((sum, guard) => sum + guard.excluded, 0);

  /**
   * The closing line, assembled from clauses that each have something to say.
   *
   * Every one is read off the trust report. The evidence clause is the generic form of
   * the hero moment's own argument — the unchecked leaders rest on far less than the
   * checked ones — and it is omitted rather than reworded when the rows do not support
   * it, because a closing line that always finds a story is a line that would find one
   * where there is none.
   */
  const minNaiveRecords = naive.reduce(
    (least, row) => Math.min(least, row.n),
    Number.POSITIVE_INFINITY,
  );
  const minHonestRecords = honest.reduce(
    (least, row) => Math.min(least, row.n),
    Number.POSITIVE_INFINITY,
  );

  const closing: string[] = [];
  if (excluded > 0) {
    closing.push(
      `The checks left out ${format.count(excluded)} ${members}, each one named in ` +
        `what was checked below.`,
    );
  }
  if (honest.length > 0 && showsRecords && minNaiveRecords < minHonestRecords) {
    closing.push(
      `The unchecked leaders rest on as few as ` +
        `${recordCount(minNaiveRecords, format.count)} each; every one you are being ` +
        `shown rests on at least ${format.count(minHonestRecords)}.`,
    );
  }
  if (closing.length === 0) {
    closing.push(`The same ${members} are ranked on both sides, and the figures moved.`);
  }

  return (
    <section
      aria-labelledby="ga-catch-heading"
      className="relative overflow-hidden rounded-2xl bg-ga-surface shadow-ga-overlay ring-1 ring-ga-line-strong"
    >
      {/*
       * Decorative, and it is the only thing in this block that carries no words: the
       * rule runs from the naive tone to the honest one, which is the block's argument
       * drawn rather than stated. Everything it suggests is written out below it.
       */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 block h-1 bg-linear-to-r from-ga-risk-ink via-ga-caution-ink to-ga-good-ink"
      />

      <div className="px-7 pt-6 pb-5 max-sm:px-5">
        <p className="text-small text-ga-ink-muted">
          You asked · <span className="text-ga-ink-secondary">“{question}”</span>
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-3xl bg-ga-caution-ink px-3 py-1 text-micro font-semibold text-ga-surface uppercase">
          <AlertTriangle className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
          The catch
        </p>
        <h2
          id="ga-catch-heading"
          className="mt-3 max-w-measure text-section text-ga-ink"
        >
          {headline}
        </h2>
        <p className="mt-3 max-w-measure text-lead text-ga-ink-secondary">{subhead}</p>
        {/* The takeaway, folded into the head rather than given a card of its own. */}
        <div className="mt-3 max-w-measure">{takeaway}</div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 px-7 pb-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-x-4 max-sm:px-5">
        <Side
          tone="naive"
          badge="Without the checks"
          heading={naiveHeading}
          headingId="ga-catch-naive"
          detail={naiveDetail}
          rows={naive}
          value={value}
          records={records}
          foot={naiveFoot}
        />

        {/*
         * The connector. Decorative: "becomes" is the relationship the two headings
         * already state, and a screen reader reading it between two lists would be
         * announcing furniture.
         */}
        <div
          aria-hidden="true"
          className="flex items-center justify-center gap-2 lg:flex-col lg:pt-12"
        >
          <span className="h-0.5 flex-1 rounded-sm bg-ga-line-strong lg:h-auto lg:w-0.5 lg:flex-1" />
          <span className="rounded-3xl border border-ga-line bg-ga-raised px-2.5 py-1 text-micro font-semibold text-ga-ink-muted uppercase">
            becomes
          </span>
          <span className="h-0.5 flex-1 rounded-sm bg-ga-line-strong lg:h-auto lg:w-0.5 lg:flex-1" />
        </div>

        <Side
          tone="honest"
          badge="What we are showing you"
          heading={honestHeading}
          headingId="ga-catch-honest"
          detail={`Ranked on ${measureLabel}, after the checks named below.`}
          rows={honest}
          value={value}
          records={records}
          foot="Every one of these cleared every check."
        />
      </div>

      <p className="max-w-[88ch] px-7 pt-5 text-body text-ga-ink max-sm:px-5">
        <b className="font-semibold">Why the two lists differ:</b> {closing.join(" ")}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-ga-line bg-ga-raised px-7 py-4 max-sm:px-5">
        <button
          type="button"
          onClick={onEscape}
          disabled={busy}
          className="cursor-pointer rounded-3xl border border-ga-line-strong bg-ga-surface px-4 py-2 text-body font-medium text-ga-ink-secondary transition-colors duration-(--ga-dur-fast) ease-ga hover:border-ga-ink-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          Show me the unchecked list anyway
        </button>
        <span className="text-small text-ga-ink-muted">
          You can always turn a check off — it just won&apos;t be turned off quietly.
        </span>
      </div>
    </section>
  );
}

export type ChecksOffBlockProps = {
  readonly question: string;
  /** The checks that were turned off to produce this answer, in the layer's own words. */
  readonly turnedOff: TrustReport["guardsApplied"];
  readonly takeaway: React.ReactNode;
  readonly onRestore: () => void;
  readonly busy: boolean;
};

/**
 * The escape, taken — and said out loud.
 *
 * build-spec §3 GA-12's third must-not: **the escape may not be silent.** Turning a
 * check off empties the spec's guards, which is also what the engine's naive run does,
 * so the answer that comes back carries no comparison to draw and no guard pills in the
 * trust strip. Left there, the loudest screen in the product would quietly become the
 * one it was built to argue against.
 *
 * So this renders in the catch's own slot, at the catch's own size, and names every
 * check that is not running using the `explanation` the layer declares — the same
 * sentence the trust strip would have shown, marked as not applied. The other visible
 * signal is the trust strip itself, whose guard pills are gone and whose coverage now
 * reads every record (build-spec §3 GA-12: "the visible signal is the trust strip and
 * the block's own head"). GA-11 adds the third, when the recipe sentence exists to
 * rewrite — and building any part of that sentence here is the boundary this card holds.
 */
export function ChecksOffBlock({
  question,
  turnedOff,
  takeaway,
  onRestore,
  busy,
}: ChecksOffBlockProps) {
  return (
    <section
      aria-labelledby="ga-checks-off-heading"
      className="overflow-hidden rounded-2xl border border-ga-caution-line bg-ga-caution-bg shadow-ga-lift"
    >
      <div className="px-7 pt-6 pb-5 max-sm:px-5">
        <p className="text-small text-ga-caution-ink">
          You asked · <span className="font-medium">“{question}”</span>
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-3xl bg-ga-caution-ink px-3 py-1 text-micro font-semibold text-ga-surface uppercase">
          <AlertTriangle className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
          Checks off
        </p>
        <h2
          id="ga-checks-off-heading"
          className="mt-3 max-w-measure text-section text-ga-caution-ink"
        >
          You are looking at this answer with the checks turned off.
        </h2>

        {turnedOff.length > 0 ? (
          <ul className="mt-3 flex max-w-measure list-none flex-col gap-1.5 p-0">
            {turnedOff.map((guard) => (
              <li key={guard.id} className="text-body text-ga-caution-ink">
                <b className="font-semibold">Not applied:</b> {guard.explanation}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-3 max-w-measure">{takeaway}</div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-ga-caution-line bg-ga-surface px-7 py-4 max-sm:px-5">
        <button
          type="button"
          onClick={onRestore}
          disabled={busy}
          className="cursor-pointer rounded-3xl border border-ga-line-strong bg-ga-surface px-4 py-2 text-body font-medium text-ga-accent-ink transition-colors duration-(--ga-dur-fast) ease-ga hover:bg-ga-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          Put the checks back
        </button>
        <span className="text-small text-ga-ink-muted">
          Nothing else about the question changed.
        </span>
      </div>
    </section>
  );
}
