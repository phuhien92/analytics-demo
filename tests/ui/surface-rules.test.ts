import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Three rules this increment can only hold by reading its own source.
 *
 * Each one is a `Must not` from build-spec §3 GA-10, and each fails silently in a way a
 * render test would not catch: a second formatter produces a *plausible* number, a
 * server-side `Plot.plot` throws only on a cold start, and a zero state that runs a spec
 * looks exactly like one that does not until you read the code.
 */

const root = join(import.meta.dirname, "..", "..");
const src = join(root, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

/**
 * Comments stripped, because this file's argument is about what the code *does*.
 * `engine/numbers.ts` names `toFixed` four times while explaining why the engine does
 * not use it, and a rule that cannot tell an explanation from a call would push that
 * explanation out of the file where it belongs.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const files = sourceFiles(src).map((path) => ({
  path: relative(root, path),
  text: readFileSync(path, "utf8"),
  code: code(readFileSync(path, "utf8")),
}));

describe("no numeral reaches the DOM except through a shared Intl formatter", () => {
  /**
   * Two scopes, because there are two places a number becomes text and they answer to
   * the same invariant for different reasons.
   *
   * **The surface** — `app/`, `components/`, `lib/` — formats the figures a reader
   * sees, and it does so through `lib/intl.ts` alone. One module means one set of
   * digits down a column and one time zone for an as-of; two would disagree quietly,
   * which is the whole failure mode.
   *
   * **The server** writes two kinds of prose that travel over the wire already
   * rendered: the templated takeaway (`ai/narrate-template.ts`) and the engine's trust
   * notes (`engine/execute.ts`). The surface prints those verbatim, so they carry their
   * own formatter — but invariant 12 still binds them, and what it forbids is
   * `toFixed`, `toLocaleString` and `toPrecision`, which is the second test below.
   */
  const surface = files.filter(
    (file) =>
      /^src\/(app|components|lib)\//.test(file.path) && file.path !== "src/lib/intl.ts",
  );

  test("the surface constructs no formatter of its own", () => {
    expect(surface.length).toBeGreaterThan(8);
    const offenders = surface.filter((file) => /new Intl\./.test(file.code));
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test("nothing anywhere reaches for toFixed, toLocaleString or toPrecision", () => {
    // `Intl` is locale-aware and these are not: `toFixed` writes a decimal point into a
    // locale that uses a comma, which is exactly the `4,47` reads-as-a-count confusion
    // invariant 12 exists to prevent.
    const offenders = files.filter((file) =>
      /\.(toFixed|toLocaleString|toPrecision)\s*\(/.test(file.code),
    );
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test("every server module that formats a number uses Intl", () => {
    const producers = ["src/server/ai/narrate-template.ts", "src/server/engine/execute.ts"];
    for (const path of producers) {
      const file = files.find((candidate) => candidate.path === path);
      expect(file, path).toBeDefined();
      expect(file?.code).toMatch(/new Intl\.NumberFormat/);
    }
  });

  test("the formatter module is actually reachable, so the rule is not vacuous", () => {
    const users = files.filter((file) => /from "@\/lib\/intl"/.test(file.code));
    expect(users.length).toBeGreaterThan(3);
  });
});

describe("Observable Plot renders on the client only", () => {
  test('every file calling Plot.plot carries "use client"', () => {
    const plotting = files.filter((file) => /Plot\.plot\s*\(/.test(file.text));
    expect(plotting.length).toBeGreaterThan(0);
    for (const file of plotting) {
      expect(file.text.trimStart().startsWith('"use client"'), file.path).toBe(true);
    }
  });

  test("nothing imports Plot at module scope, so it stays out of the first load", () => {
    const staticImports = files.filter((file) =>
      /^import .*@observablehq\/plot/m.test(file.text),
    );
    expect(staticImports.map((file) => file.path)).toEqual([]);
  });
});

describe("the zero state cannot show a computed result", () => {
  /**
   * build-spec §1.2: no score card, no metrics row, no sparkline, no standing tile —
   * **no computed result that is not downstream of a question asked in this session.**
   * The strongest available form of that is structural: the modules that build the first
   * paint do not reach the engine at all, so there is nothing for them to compute with.
   */
  const firstPaint = ["src/app/page.tsx", "src/server/surface/zero-state.ts"];

  test("neither the page nor the zero-state builder imports the engine", () => {
    for (const path of firstPaint) {
      const file = files.find((candidate) => candidate.path === path);
      expect(file, path).toBeDefined();
      expect(file?.text).not.toMatch(/from "@\/server\/engine\//);
      expect(file?.text).not.toMatch(/from "@\/server\/warehouse\//);
    }
  });

  test("the zero state's own component renders no result set", () => {
    const file = files.find((candidate) => candidate.path === "src/components/zero-state.tsx");
    expect(file).toBeDefined();
    expect(file?.text).not.toMatch(/ResultSet|ResultRow|TrustReport/);
  });
});
