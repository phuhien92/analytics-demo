"use client";

import { useEffect, useRef, useState } from "react";

import type { ResultRow } from "@/server/contracts";
import { formatters } from "@/lib/intl";

/**
 * The chart. **Client-side only**, and that is a recorded decision rather than a habit.
 *
 * Observable Plot needs a DOM. Rendering it on the server means importing jsdom, which
 * `docs/architecture.md` §10 measured at ~755 ms of cold import — paid on every cold
 * start, for no accessibility gain, because the accessible artifact is the `<table>` the
 * server already produces and `ResultTable` already renders. So Plot is loaded lazily,
 * inside the effect, and never reaches the initial bundle either.
 *
 * ## The chart is decoration; the table is the content
 *
 * The SVG is `aria-hidden`. A Plot figure exposes dozens of tick labels and path
 * elements that a screen reader reads as a wall of disconnected numbers, and
 * `docs/design.md` §7 is explicit that the takeaway and the recipe sentence *are* the
 * accessible representation of the chart — with a real `<table>` reachable behind a
 * disclosure any user can open. Hiding the SVG is what makes that claim true instead of
 * leaving the same numbers announced twice, once unusably.
 *
 * ## The form comes from the spec, not from the dataset
 *
 * A spec that orders by its **measure** is a ranking, and ranked categories are
 * horizontal bars. A spec that orders by its **breakdown** is a sequence — "how many
 * each year" asks about a shape over time — and a sequence is a line. That is the whole
 * rule, and it reads only `spec.sort.by`, so nothing dataset-specific lands in the
 * surface (invariant 6). `ai/fallback-parser.ts` already encodes the same distinction
 * when it chooses each starter question's sort.
 *
 * Bar length is never the only encoding: every value is written on its own row in the
 * table, and on the chart beside its bar (`docs/design.md` §7 — no meaning carried by
 * colour or length alone).
 *
 * ## The bar axis starts at zero, even when that makes the bars look alike
 *
 * The top ten titles sit between 4.28 and 4.47, so a zero-based axis draws ten bars of
 * almost the same length. Truncating the axis to the data's own range would separate
 * them dramatically — and would be this product's own failure mode drawn as a picture:
 * a chart that reads as a large difference where the numbers say a small one. The flat
 * shape is the finding. `docs/design.md` §4 makes the same point in prose about
 * genres — "the gap between the top and bottom category is small" — and the takeaway
 * and the table carry the exact figures for anyone who needs to rank them.
 */

export type ChartProps = {
  readonly rows: readonly ResultRow[];
  readonly measureLabel: string;
  readonly breakdownLabel: string | null;
  readonly shape: "ranking" | "sequence";
  readonly locale: string;
};

/** Enough room for one row, so the card does not jump when Plot lands. */
const ROW_HEIGHT = 30;
const CHART_CHROME = 56;
const SEQUENCE_HEIGHT = 300;
/** Approximate advance width of the 12px axis face, for fitting labels to the margin. */
const LABEL_CHAR_PX = 6.4;

function reservedHeight(shape: ChartProps["shape"], rowCount: number): number {
  return shape === "sequence" ? SEQUENCE_HEIGHT : rowCount * ROW_HEIGHT + CHART_CHROME;
}

/**
 * Shorten a member label to what the left margin can show.
 *
 * Plot clips an overlong tick label at the plot edge, which silently eats the *start* of
 * a title — `Sunset Blvd. (a.k.a. Sunset Boulevard) (1950)` arrives as `unset Blvd.…`,
 * a title that does not exist. An explicit ellipsis says a name was shortened; a clip
 * says nothing at all. The full label is a keystroke away in the table, which is the
 * artifact that has to be complete.
 */
function fitLabel(label: string, maxChars: number): string {
  return label.length <= maxChars ? label : `${label.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function Chart({ rows, measureLabel, breakdownLabel, shape, locale }: ChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Plot draws at a fixed width, so the container's width is an input to the render
  // rather than something CSS can stretch afterwards without distorting the type.
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    setWidth(Math.round(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = host.current;
    if (element === null || width === 0 || rows.length === 0) return;

    let cancelled = false;
    const format = formatters(locale);

    // Lazily imported so Plot is neither in the server bundle (it would throw without a
    // DOM) nor in the page's first load.
    void import("@observablehq/plot").then((Plot) => {
      if (cancelled || host.current === null) return;

      // One digit count across the whole series, so the value written beside each bar
      // reads as a column rather than as a precision that changes row by row.
      const measureValue = format.column(rows.map((row) => row.value));

      // Ranked members are named down the left margin, so the margin is sized to the
      // labels themselves — wide enough for the longest, and never past a third of the
      // card, which is where the bars would start losing more than the names gain.
      const longest = rows.reduce((widest, row) => Math.max(widest, (row.key ?? "").length), 0);
      const gutter = Math.max(
        72,
        Math.min(Math.ceil(longest * LABEL_CHAR_PX) + 16, Math.round(width * 0.34)),
      );
      const maxChars = Math.floor((gutter - 16) / LABEL_CHAR_PX);

      const data = rows.map((row) => ({
        key: row.key === null ? measureLabel : fitLabel(row.key, maxChars),
        value: row.value,
        label: measureValue(row.value),
      }));

      const figure =
        shape === "sequence"
          ? Plot.plot({
              width,
              height: SEQUENCE_HEIGHT,
              marginLeft: 56,
              marginBottom: 46,
              style: { background: "transparent", fontSize: "12px" },
              x: {
                // Explicitly ordinal. A breakdown member is a declared dimension value
                // that happens to be spelled with digits — `2018` is a member, not a
                // quantity — and letting Plot infer a linear scale would place members
                // at numeric distances the engine never claimed and would leave gaps
                // where a member simply does not exist.
                type: "point",
                label: breakdownLabel,
                tickRotate: -40,
                labelAnchor: "center",
              },
              y: { label: measureLabel, grid: true, nice: true, zero: true },
              marks: [
                Plot.ruleY([0], { stroke: "var(--ga-line-strong)" }),
                Plot.lineY(data, {
                  x: "key",
                  y: "value",
                  stroke: "var(--ga-accent)",
                  strokeWidth: 2.5,
                  // Straight segments, not a smoothed curve. A monotone spline draws
                  // values between two members that the engine never computed — a small
                  // invented figure, in a product whose whole claim is that it has none.
                  curve: "linear",
                }),
                Plot.dot(data, { x: "key", y: "value", fill: "var(--ga-accent)", r: 3.5 }),
              ],
            })
          : Plot.plot({
              width,
              height: rows.length * ROW_HEIGHT + CHART_CHROME,
              marginLeft: gutter,
              marginRight: 64,
              style: { background: "transparent", fontSize: "12px" },
              x: { label: measureLabel, grid: true, nice: true },
              y: { label: null, domain: data.map((row) => row.key) },
              marks: [
                Plot.barX(data, {
                  y: "key",
                  x: "value",
                  fill: "var(--ga-accent)",
                  rx: 3,
                }),
                Plot.text(data, {
                  y: "key",
                  x: "value",
                  text: "label",
                  dx: 7,
                  textAnchor: "start",
                  fill: "var(--ga-ink)",
                  fontVariant: "tabular-nums",
                }),
                Plot.ruleX([0], { stroke: "var(--ga-line-strong)" }),
              ],
            });

      host.current.replaceChildren(figure);
    });

    return () => {
      cancelled = true;
    };
  }, [rows, measureLabel, breakdownLabel, shape, locale, width]);

  return (
    <div
      ref={host}
      aria-hidden="true"
      className="w-full overflow-hidden [&_svg]:h-auto [&_svg]:max-w-full"
      style={{ minHeight: reservedHeight(shape, rows.length) }}
    />
  );
}
