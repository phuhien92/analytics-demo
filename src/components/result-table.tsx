import type { ResultRow } from "@/server/contracts";
import { formatters } from "@/lib/intl";

/**
 * The semantic table behind every chart — **reachable, not merely present**.
 *
 * `docs/design.md` §7 asks for a real `<table>` a screen-reader user can get to, and
 * build-spec §3 GA-10 forbids the usual shortcut: a visually-hidden copy is present in
 * the accessibility tree and unreachable for everyone else, so a sighted user who wants
 * the numbers behind a bar still cannot have them. A `<details>` disclosure is one
 * artifact serving both, it needs no JavaScript, and it is keyboard-operable natively.
 *
 * It is deliberately a plain `<table>` rather than shadcn's. Each shadcn component is
 * earned (`docs/architecture.md` §10), and shadcn's table is a styling wrapper that
 * nests the `<table>` inside a scroll container — which is four utility classes' worth
 * of value in exchange for putting a `<div>` between the figure and the one element this
 * increment's accessibility claim rests on.
 *
 * Every figure here goes through the shared `Intl` formatters (invariant 12), and the
 * member key is a `<th scope="row">` so a screen reader names the row it is reading.
 */

export type ResultTableProps = {
  readonly rows: readonly ResultRow[];
  readonly measureLabel: string;
  /** `null` when the spec has no breakdown — the single-row case. */
  readonly breakdownLabel: string | null;
  readonly caption: string;
  readonly locale: string;
};

export function ResultTable({
  rows,
  measureLabel,
  breakdownLabel,
  caption,
  locale,
}: ResultTableProps) {
  const format = formatters(locale);
  // One digit count down the column, so the decimal points line up and the precision
  // does not appear to change from row to row. See `Formatters.column`.
  const measureValue = format.column(rows.map((row) => row.value));
  const keyHeader = breakdownLabel ?? "measure";
  /**
   * How many records a figure rests on is the column that makes the hero moment
   * readable — 4.47 from 20 ratings beside 4.43 from 317. It is dropped when the measure
   * *is* that count, because then it repeats its neighbour on every row, and a column
   * that restates the one next to it reads as a defect rather than as evidence. Derived
   * from the rows, not from knowing which measures are counts.
   */
  const showsRecordCount = rows.length > 0 && rows.some((row) => row.n !== row.value);

  return (
    <details className="mt-4 border-t border-ga-line pt-3">
      <summary className="cursor-pointer text-small font-medium text-ga-accent-ink marker:text-ga-accent-line">
        Show the numbers
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-small">
          <caption className="pb-2 text-left text-small text-ga-ink-muted">{caption}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-ga-line px-2.5 py-1.5 text-left text-micro font-semibold text-ga-ink-secondary uppercase"
              >
                {keyHeader}
              </th>
              <th
                scope="col"
                className="border-b border-ga-line px-2.5 py-1.5 text-right text-micro font-semibold text-ga-ink-secondary uppercase"
              >
                {measureLabel}
              </th>
              {showsRecordCount ? (
                <th
                  scope="col"
                  className="border-b border-ga-line px-2.5 py-1.5 text-right text-micro font-semibold text-ga-ink-secondary uppercase"
                >
                  Records behind it
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key ?? `row-${index}`}>
                <th
                  scope="row"
                  className="border-b border-ga-line px-2.5 py-1.5 text-left font-text text-ga-ink"
                >
                  {row.key ?? measureLabel}
                </th>
                <td className="border-b border-ga-line px-2.5 py-1.5 text-right text-ga-ink">
                  {measureValue(row.value)}
                </td>
                {showsRecordCount ? (
                  <td className="border-b border-ga-line px-2.5 py-1.5 text-right text-ga-ink-secondary">
                    {format.count(row.n)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
