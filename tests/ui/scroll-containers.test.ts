import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * A column that scrolls must be the containing block for what is inside it.
 *
 * `sr-only` is `position: absolute`. An absolutely positioned box is laid out against its
 * nearest *positioned* ancestor, and a scroll container only clips and scrolls the boxes
 * it contains in that sense. With no positioned ancestor the containing block is the page:
 * the trust strip's hidden "Checked:" labels sat ~2,500 px down the *document* while the
 * ask column that owned them was 700 px tall, so the page grew a second scrollbar and the
 * rail, the session column and the composer scrolled away with it.
 *
 * Measured at 1150×700 after the hero question: `document.scrollHeight` 2,572 before,
 * 700 after, with shell, grid, `main`, rail and session column at 700 in both.
 *
 * This is a source rule because `tests/ui/` has no layout engine — the geometry itself
 * is not assertable here. What is assertable is the property the geometry depends on:
 * every vertical scroll container on the surface is `relative`. It fails silently
 * otherwise, since the next `sr-only` label added anywhere under a scrolling column
 * reopens the bug without touching the shell.
 */

const root = join(import.meta.dirname, "..", "..");
const components = join(root, "src", "components");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    // `components/ui/` is shadcn's copied-in source; its scroll containers are portalled
    // overlays with their own positioning, not columns of the shell.
    if (entry.isDirectory()) return entry.name === "ui" ? [] : sourceFiles(path);
    return extname(entry.name) === ".tsx" ? [path] : [];
  });
}

const scrollers = sourceFiles(components).flatMap((path) =>
  [...readFileSync(path, "utf8").matchAll(/className="([^"]*)"/g)]
    .map((match) => (match[1] ?? "").split(/\s+/))
    .filter((classes) => classes.some((name) => /(^|:)overflow-y-(auto|scroll)$/.test(name)))
    .map((classes) => ({ path: relative(root, path), classes })),
);

describe("a scrolling column contains its own absolutely positioned content", () => {
  test("the ask column and the session list are both found", () => {
    expect(scrollers.map((scroller) => scroller.path).sort()).toEqual([
      "src/components/ask-surface.tsx",
      "src/components/session-column.tsx",
    ]);
  });

  test("every vertical scroll container is positioned", () => {
    for (const { path, classes } of scrollers) {
      expect(classes, path).toContain("relative");
    }
  });
});
