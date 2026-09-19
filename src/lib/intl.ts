/**
 * The one place a number or a date turns into text.
 *
 * `AGENTS.md` invariant 12: all numeric and date output goes through `Intl`. The reason
 * is not tidiness — a decimal comma changes whether `4,47` reads as a rating or as a
 * count, and a date rendered in the reader's own zone can name a different day from the
 * one the answer was computed at.
 *
 * So there is one module, every component calls it, and `tests/ui/intl.test.ts` proves
 * the rule by reading the surface's own source: no `toFixed`, no `toLocaleString`, no
 * second `new Intl.*` anywhere under `src/components/` or `src/app/`. A formatter that
 * can be reached two ways is a formatter that disagrees with itself.
 *
 * Nothing here rounds. `engine/numbers.ts` rounds to the presentation scale, on
 * integers, half toward zero, because that is an arithmetic decision and this is a
 * rendering one (`docs/architecture.md` §5a). `ResultRow.value` arrives already at its
 * presentation scale; these formatters only choose how to write it down.
 */

/**
 * Presentation digits, in the absence of a declared display format.
 *
 * The same cap `ai/narrate-template.ts` chose, and for the same reason: the layer
 * declares no per-measure display format, and the widest presentation scale it ships is
 * `share_rated_4_plus` at ten-thousandths, so four digits keep every measure's exact
 * value and invent precision for none of them. The visible cost is that an average of
 * exactly 4.40 renders as `4.4`.
 *
 * The two modules agree on the constant by re-stating it rather than by importing:
 * `src/server/ai/` is server code and this module is imported by the client. A
 * per-measure display format in the semantic layer is what removes both copies, and is
 * recorded as the next layer field in `docs/how-this-was-built.md`.
 */
export const MAX_FRACTION_DIGITS = 4;

export type Formatters = {
  /** A measure's presentation value — already rounded by the engine. */
  readonly value: (n: number) => string;
  /**
   * One formatter for a whole column of values, all written to the same width.
   *
   * `value` alone writes `4.47` and `4.3` on consecutive rows, because trailing zeros
   * are not significant to `Intl` and the two figures genuinely need different digits.
   * Down a ranked column that reads as a precision that changes row by row, and the
   * decimal points stop lining up in a face that was chosen for its tabular numerals.
   *
   * So the digit count is taken **from the column**: the most any one of its values
   * needs, capped at `MAX_FRACTION_DIGITS`, and then applied to all of them. No
   * precision is invented — every digit shown is one some row in this same answer
   * actually carries — and nothing is rounded here either, because the engine already
   * rounded to the presentation scale (`docs/architecture.md` §5a).
   *
   * The declared alternative is a per-measure display format in the semantic layer,
   * which would state the scale rather than infer it. That is a GA-03 schema change and
   * it is recorded as the next layer field in `docs/how-this-was-built.md` rather than
   * taken here.
   */
  readonly column: (values: readonly number[]) => (n: number) => string;
  /** A whole count: rows behind a figure, titles in the catalogue. */
  readonly count: (n: number) => string;
  /** An ISO-8601 UTC instant, as a day. Rendered **in UTC** — see below. */
  readonly date: (iso: string) => string;
};

/**
 * How many fraction digits this value carries once written out, up to the cap.
 *
 * Read off the decimal string rather than computed, so a value the engine produced as
 * `4.47` reports 2 and one produced as `5` reports 0. `toFixed`/`toPrecision` are not
 * involved: nothing here changes the number, it only measures how wide it is.
 */
function fractionDigits(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const [, fraction] = String(value).split(".");
  if (fraction === undefined) return 0;
  // An exponent means a magnitude no presentation scale in this product reaches; the
  // cap is the honest answer rather than parsing scientific notation.
  return fraction.includes("e") ? MAX_FRACTION_DIGITS : Math.min(fraction.length, MAX_FRACTION_DIGITS);
}

const cache = new Map<string, Formatters>();

/**
 * The formatters for one locale, built once.
 *
 * `Intl.NumberFormat` construction is the expensive part of formatting, and an answer
 * writes a number on every row of a table, every bar of a chart and every pill of the
 * trust strip. Constructing per call would rebuild the same object a hundred times per
 * render.
 */
export function formatters(locale: string): Formatters {
  const cached = cache.get(locale);
  if (cached !== undefined) return cached;

  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: MAX_FRACTION_DIGITS });
  const count = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  /**
   * `timeZone: "UTC"`, always. Every instant in this product is ISO-8601 UTC
   * (`docs/architecture.md` §2a), and an as-of of `2018-09-26T00:00:00.000Z` rendered
   * in a reader's own zone names **25 September** anywhere west of Greenwich. An answer
   * whose stated moment moves with the reader is the confident wrong answer wearing a
   * timestamp, and it would also mean the server and the client disagreed on the first
   * paint.
   */
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });

  const built: Formatters = {
    value: (n) => value.format(n),
    column: (values) => {
      const digits = values.reduce((widest, n) => Math.max(widest, fractionDigits(n)), 0);
      const formatter = new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      return (n) => formatter.format(n);
    },
    count: (n) => count.format(n),
    date: (iso) => date.format(new Date(iso)),
  };
  cache.set(locale, built);
  return built;
}
