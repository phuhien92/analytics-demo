import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSemanticLayer } from "@/server/semantic/load";

import { ALL_GUARDS, AS_OF_POINTS, CASES, PARAPHRASES } from "./cases.ts";
import { CONNECTION_VARIABLE } from "./postgres-fixture.ts";

/**
 * Lint-style checks over the corpus and over where the second adapter is allowed to
 * reach. None of them needs a database, so they run on every clone, with or without
 * `CONFORMANCE_DATABASE_URL`.
 *
 * They exist because the three ways this suite could quietly stop proving anything are
 * all invisible at a glance: a case drifting to `asOf: null`, a guard threshold moving
 * under a pinned number, and the test-only adapter finding its way into the shipped
 * application.
 */

const ROOT = join(import.meta.dirname, "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if ([".ts", ".tsx"].includes(extname(full))) out.push(full);
  }
  return out;
}

describe("no case carries a null as-of", () => {
  /**
   * The lint `docs/build-spec.md` §3 asks for by name.
   *
   * `asOf: null` means "latest". A case pinned at latest re-pins itself the moment the
   * next payload lands — it does not fail, it *passes against different data*, which is
   * the silent failure this product exists to catch, aimed at its own proof. This corpus
   * is the artifact behind the central claim, so it is the last place that may happen.
   */
  it.each(CASES.map((testCase) => [testCase.id, testCase] as const))(
    "%s pins an explicit moment",
    (_id, testCase) => {
      expect(testCase.spec.asOf, `${testCase.id} must name the moment it describes`).not.toBeNull();
      expect(typeof testCase.spec.asOf).toBe("string");
      expect(Number.isNaN(Date.parse(testCase.spec.asOf!))).toBe(false);
      expect(AS_OF_POINTS, `${testCase.id} uses an undeclared as-of point`).toContain(
        testCase.spec.asOf,
      );
    },
  );

  it.each(PARAPHRASES.map((paraphrase) => [paraphrase.text, paraphrase] as const))(
    "the paraphrase %s pins an explicit moment",
    (_text, paraphrase) => {
      const asOf = paraphrase.input["asOf"];
      expect(asOf).not.toBeNull();
      expect(typeof asOf).toBe("string");
      expect(AS_OF_POINTS).toContain(asOf);
    },
  );

  it("pins cases at every as-of point it declares, including the replay", () => {
    const used = new Set(CASES.map((testCase) => testCase.spec.asOf));
    for (const point of AS_OF_POINTS) expect(used).toContain(point);
  });
});

describe("a case carries its definition, not just a number", () => {
  it("writes out the same guards the layer declares", () => {
    // Written out in `cases.ts` rather than read from the layer, so a threshold moving in
    // `semantic/movielens.json` cannot change what a pinned number means without this
    // failing. A figure without its definition is not a pinned figure (`AGENTS.md`).
    const layer = loadSemanticLayer();
    const declared = layer.guards.map((guard) => ({ id: guard.id, params: guard.defaultParams }));
    expect([...ALL_GUARDS]).toEqual(declared);
  });

  it("gives every case a question and a stated failure mode", () => {
    for (const testCase of CASES) {
      expect(testCase.question.length, `${testCase.id} needs a question`).toBeGreaterThan(0);
      expect(testCase.why.length, `${testCase.id} needs a reason to exist`).toBeGreaterThan(20);
    }
  });

  it("keeps the cases the build spec specified separate from the ones measured here", () => {
    // The three build-spec cases are an independent oracle: their numbers were written
    // down before any code produced them. The rest are regression pins, and their
    // independent check is the second adapter reproducing them.
    const fromSpec = CASES.filter((testCase) => testCase.source === "build-spec");
    expect(fromSpec.map((testCase) => testCase.id)).toEqual([
      "hero-honest-2018",
      "hero-naive-2018",
      "replay-2007",
    ]);
  });

  it("states every row's value as its raw integer over the measure's scale", () => {
    for (const testCase of CASES) {
      for (const row of testCase.expect.rows) {
        expect(Number.isInteger(row.rawValue), `${testCase.id}: ${row.key}`).toBe(true);
        expect(Number.isInteger(row.n), `${testCase.id}: ${row.key}`).toBe(true);
      }
    }
  });
});

describe("the second adapter never reaches the serving path", () => {
  /**
   * GA-06's "Must not": *let the second adapter reach the serving path or the deployed
   * bundle*. It is a test artifact. Three checks, because the module graph, the manifest
   * and the adapter's own imports each fail differently.
   */
  const sources = walk(join(ROOT, "src")).map((file) => ({
    path: relative(ROOT, file),
    text: readFileSync(file, "utf8"),
  }));

  it("is imported by nothing under src/", () => {
    const importers = sources
      .filter((source) => source.path !== "src/server/warehouse/postgres-store.ts")
      .filter((source) => /from\s+["'][^"']*postgres-store["']/.test(source.text))
      .map((source) => source.path);

    expect(importers, "only tests/ may import the Postgres adapter").toEqual([]);
  });

  it("imports no driver and no node built-in, so it cannot pull a database into a bundle", () => {
    const adapter = readFileSync(join(ROOT, "src/server/warehouse/postgres-store.ts"), "utf8");
    const imports = [...adapter.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);

    expect(imports).toEqual(["@/server/contracts", "./types"]);
    expect(adapter).not.toMatch(/from\s+["']node:/);
    expect(adapter).not.toMatch(/from\s+["']pg["']/);
  });

  it("keeps the driver out of the shipped dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    for (const name of ["pg", "@types/pg", "pg-copy-streams", "@types/pg-copy-streams"]) {
      expect(Object.keys(manifest.dependencies), `${name} must not ship`).not.toContain(name);
      expect(Object.keys(manifest.devDependencies)).toContain(name);
    }
  });

  it("puts the connection string in the environment and never in the repository", () => {
    // GitGuardian scans this repository on every push, and a credential in a committed
    // file is not a mistake that can be taken back once pushed.
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(example).toContain(`${CONNECTION_VARIABLE}=`);
    expect(example).toMatch(new RegExp(`^${CONNECTION_VARIABLE}=\\s*$`, "m"));

    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(ignore).toContain(".env*");

    const fixture = readFileSync(join(ROOT, "tests/conformance/postgres-fixture.ts"), "utf8");
    expect(fixture, "the fixture must read the connection string, never carry one").not.toMatch(
      /postgres(ql)?:\/\/[^\s"']*:[^\s"']+@/,
    );
  });
});
