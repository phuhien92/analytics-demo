import { deepStrictEqual } from "node:assert";

import { afterAll, describe, expect, it } from "vitest";

import type { Provenance, QuerySpec, ResultSet } from "@/server/contracts";
import { execute } from "@/server/engine/execute";
import { compareCodeUnits } from "@/server/engine/numbers";
import { resolveSpec } from "@/server/engine/resolve";
import type { Aggregation, Warehouse } from "@/server/warehouse/types";

import { createHarness } from "./adapters.ts";
import {
  CASES,
  PARAPHRASES,
  PARAPHRASE_QUESTION,
  REPLAY_AS_OF,
  type CaseExpectation,
  type ConformanceCase,
} from "./cases.ts";
import { CONNECTION_VARIABLE, HOSTILE_TIME_ZONE } from "./postgres-fixture.ts";

/**
 * The conformance suite.
 *
 * One corpus, every adapter, identical numbers — the artifact behind invariant 10. The
 * `describe.each` below is the whole design: adding a Snowflake or a columnar adapter
 * costs one entry in `adapters.ts` and nothing here (`docs/build-spec.md` §9).
 *
 * Run it with `npx vitest run tests/conformance`. With `CONFORMANCE_DATABASE_URL` set it
 * runs both adapters and they must agree exactly; without it, it runs one and says
 * loudly that the determinism claim is unproven on that run.
 */

const harness = await createHarness();

afterAll(async () => {
  await harness.closeAll();
});

const COMPUTED_AT = "2026-09-18T00:00:00.000Z";

/**
 * Every test that touches the second adapter gets this, and Vitest's 5-second default is
 * not it.
 *
 * Measured: five paraphrases are five `execute()` calls, each a double-run of three
 * queries over 100,836 ratings — thirty round trips, which took just over five seconds
 * against a Postgres on this machine's own loopback. Against a hosted database it is a
 * network away, and a Supabase project that has been idle is paused, so the first
 * connection alone can take many seconds. A timeout tight enough to fail on a slow link
 * turns a working suite into a flaky one, and a flaky suite stops being run.
 */
const DATABASE_TIMEOUT_MS = 120_000;

function run(spec: QuerySpec, warehouse: Warehouse, requestId = "conformance"): Promise<ResultSet> {
  return execute(spec, { warehouse, layer: harness.layer, requestId, computedAt: COMPUTED_AT });
}

/** What the case pins, pulled out of the `ResultSet` in the shape the case declares. */
function observed(result: ResultSet): CaseExpectation {
  return {
    rows: result.rows,
    coverage: result.trust.coverage,
    notes: result.trust.notes,
    comparison: result.trust.comparison === null ? "none" : "material",
  };
}

/**
 * Members in a stated order, so two adapters can be compared without ordering them.
 *
 * By code unit, never `localeCompare`: an ordering that depends on the runtime's ICU
 * build is exactly what `engine/numbers.ts` refuses, and reintroducing it in the test
 * that polices determinism would be absurd.
 */
function canonical(aggregation: Aggregation): Aggregation {
  return {
    ...aggregation,
    members: [...aggregation.members].sort(
      (a, b) => a.memberId - b.memberId || compareCodeUnits(a.key ?? "", b.key ?? ""),
    ),
  };
}

describe.each(harness.adapters.map((adapter) => [adapter.id, adapter.warehouse] as const))(
  "adapter %s",
  (adapterId, warehouse) => {
    describe.each(CASES.map((testCase) => [testCase.id, testCase] as const))(
      "%s",
      (_caseId, testCase: ConformanceCase) => {
        it(`answers "${testCase.question}"`, async () => {
          const result = await run(testCase.spec, warehouse);
          const actual = observed(result);

          // The rows first, so a failure reads as the wrong answer rather than as the
          // wrong bookkeeping; then everything else the case pins, in full.
          expect(actual.rows, testCase.why).toEqual(testCase.expect.rows);
          expect(actual, testCase.why).toEqual(testCase.expect);

          // Every case is pinned at a moment, and the answer says which one it describes.
          expect(result.provenance.resolvedAsOf).toBe(testCase.spec.asOf);
          expect(result.provenance.adapterId).toBe(adapterId);
        }, DATABASE_TIMEOUT_MS);
      },
    );

    it("replays a case pinned at 2007 against the full 2018 store", async () => {
      const replay = CASES.find((testCase) => testCase.spec.asOf === REPLAY_AS_OF);
      expect(replay, "the corpus must carry an as-of replay case").toBeDefined();

      const latest = await warehouse.latestAsOf();
      const result = await run(replay!.spec, warehouse);

      // The store holds every rating through September 2018; the answer describes 2007.
      expect(latest).toBe(harness.store.manifest.asOf);
      expect(Date.parse(result.provenance.resolvedAsOf)).toBeLessThan(Date.parse(latest));
      expect(result.rows).toEqual(replay!.expect.rows);
    }, DATABASE_TIMEOUT_MS);

    it(`answers ${PARAPHRASES.length} phrasings of "${PARAPHRASE_QUESTION}" identically`, async () => {
      const specs = PARAPHRASES.map((paraphrase) => {
        const resolved = resolveSpec(paraphrase.input, harness.layer, paraphrase.text);
        expect(resolved.ok, `"${paraphrase.text}" must resolve`).toBe(true);
        if (!resolved.ok) throw new Error("unreachable");
        return resolved.spec;
      });

      // Every phrasing lands on one spec: the tie-break is filled from the layer, the
      // guards default to on, and every difference between the inputs is a default.
      for (const spec of specs) deepStrictEqual(spec, specs[0]);

      const results: ResultSet[] = [];
      for (const spec of specs) results.push(await run(spec, warehouse));

      const first = results[0]!;
      for (const result of results) {
        expect(JSON.stringify(result.rows)).toBe(JSON.stringify(first.rows));
        expect(JSON.stringify(result.trust)).toBe(JSON.stringify(first.trust));
      }
    }, DATABASE_TIMEOUT_MS);

    it("returns the same numbers twice, and says so in provenance", async () => {
      const spec = CASES[0]!.spec;
      const first = await run(spec, warehouse, "first");
      const second = await run(spec, warehouse, "second");

      deepStrictEqual(first.rows, second.rows);
      deepStrictEqual(first.trust, second.trust);
      const stable = ({ requestId: _id, computedAt: _at, ...rest }: Provenance) => rest;
      deepStrictEqual(stable(first.provenance), stable(second.provenance));
    }, DATABASE_TIMEOUT_MS);
  },
);

/**
 * The claim itself: two entirely different engines, one portable query description,
 * byte-identical numbers.
 *
 * The comparison is on the **`Aggregation`**, not on the finished `ResultSet`, because
 * that is the only layer the two adapters implement independently — guards, ordering and
 * the trust report are written once in `engine/` and would agree trivially. Comparing
 * where they *could* differ is the value of the exercise; comparing where they cannot is
 * a test that can never fail.
 */
describe.runIf(harness.adapters.length > 1)("the two adapters agree exactly", () => {
  it.each(CASES.map((testCase) => [testCase.id, testCase] as const))(
    "%s aggregates identically on every adapter",
    async (_id, testCase: ConformanceCase) => {
      const aggregations: { id: string; aggregation: Aggregation }[] = [];
      for (const adapter of harness.adapters) {
        aggregations.push({
          id: adapter.id,
          aggregation: canonical(
            await adapter.warehouse.aggregate({
              spec: testCase.spec,
              resolvedAsOf: testCase.spec.asOf!,
            }),
          ),
        });
      }

      const [reference, ...others] = aggregations;
      for (const other of others) {
        expect(
          other.aggregation,
          `${other.id} disagrees with ${reference!.id} on "${testCase.question}" — ${testCase.why}`,
        ).toEqual(reference!.aggregation);
      }
    },
    DATABASE_TIMEOUT_MS,
  );

  it("names the server it agreed with", () => {
    expect(harness.postgres.present).toBe(true);
    if (!harness.postgres.present) throw new Error("unreachable");
    // Read from the server, not from configuration: a divergence found later has to be
    // attributable to a specific engine, and majors differ on collation and ordering.
    expect(harness.postgres.serverVersion).toMatch(/PostgreSQL \d+/);
  });
});

/**
 * Where two engines actually diverge, demonstrated rather than asserted.
 *
 * `docs/build-spec.md` names rounding, ordering and collation as the places two engines
 * disagree. Each case below runs the **wrong** expression beside the pinned one, so the
 * hazard stays executable: someone simplifying the adapter watches a test fail rather
 * than reads a comment. Every one of these was measured, not anticipated.
 */
describe.runIf(harness.adapters.length > 1)("what the boundary protects against", () => {
  /** The second adapter's own connection. Only these demonstrations reach for it. */
  const sql = async (text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => {
    if (harness.sql === null) throw new Error("unreachable: guarded by describe.runIf");
    return (await harness.sql.query(text, params)).rows;
  };

  it("files a new-year rating under the wrong year without an explicit time zone", async () => {
    // An hour either side of a UTC new year. The hazard is symmetric and the session's
    // offset decides which instant it bites: at UTC+14 (this fixture) the earlier one is
    // dragged into 2003, and in the Americas — where this machine's own Postgres reports
    // `America/Los_Angeles` — the later one falls back into 2002. Neither raises anything.
    const BEFORE_UTC_NEW_YEAR = 1_041_375_600; // 2002-12-31T23:00:00Z
    const AFTER_UTC_NEW_YEAR = 1_041_381_000; // 2003-01-01T00:30:00Z

    const rows = await sql(
      `SELECT at,
              EXTRACT(YEAR FROM to_timestamp(at))::int                      AS inherited,
              EXTRACT(YEAR FROM (to_timestamp(at) AT TIME ZONE 'UTC'))::int AS pinned,
              current_setting('TimeZone')                                   AS zone
         FROM unnest($1::int[]) AS at
        ORDER BY at`,
      [[BEFORE_UTC_NEW_YEAR, AFTER_UTC_NEW_YEAR]],
    );

    expect(rows[0]!["zone"]).toBe(HOSTILE_TIME_ZONE);
    // Pinned to UTC, the two instants sit either side of the year, which is what the
    // store means and what `Date#getUTCFullYear` gives the local adapter.
    expect(rows.map((row) => Number(row["pinned"]))).toEqual([2002, 2003]);
    // Left to the session's inherited zone, they do not — and that is a silently
    // different answer to "how many ratings did we get in 2002?".
    expect(rows.map((row) => Number(row["inherited"]))).not.toEqual([2002, 2003]);
  }, DATABASE_TIMEOUT_MS);

  it("orders text differently from the engine, which is why the adapter never orders", async () => {
    // Two real shipped titles. `AGENTS.md` already records that `localeCompare` disagrees
    // with code-unit order at the very first title; here the same disagreement is produced
    // by a *database collation*, which is the form it takes once a second engine exists.
    const titles = ["¡Three Amigos! (1986)", "'Til There Was You (1997)"];
    const byCodeUnit = [...titles].sort(compareCodeUnits);

    const rows = await sql(
      `SELECT name FROM (SELECT unnest($1::text[]) AS name) s ORDER BY name COLLATE "und-x-icu"`,
      [titles],
    );
    const byIcu = rows.map((row) => String(row["name"]));

    expect(byCodeUnit[0]).toBe("'Til There Was You (1997)");
    expect(byIcu[0]).toBe("¡Three Amigos! (1986)");
    // The engine orders and the adapter does not, so this disagreement cannot reach a
    // result. `docs/architecture.md` §5 is that decision; this is the measurement behind it.
    expect(byIcu).not.toEqual(byCodeUnit);
  }, DATABASE_TIMEOUT_MS);

  it("returns NULL rather than zero when a member has no facts", async () => {
    const rows = await sql(
      `SELECT SUM(value_scaled) AS naive, COALESCE(SUM(value_scaled), 0) AS pinned
         FROM rating WHERE FALSE`,
    );
    expect(rows[0]!["naive"]).toBeNull();
    expect(Number(rows[0]!["pinned"])).toBe(0);
  }, DATABASE_TIMEOUT_MS);

  it("cannot store the uncategorised sentinel in a text column", async () => {
    // `UNCATEGORISED_KEY` starts with U+0000 and Postgres `text` cannot hold a NUL byte,
    // so the sentinel is unrepresentable in the second engine. It is reconstructed in JS
    // from the `uncategorised` flag the boundary already carries — which is the field
    // `exclude_uncategorised` actually reads. Had the guard keyed on the string, the
    // second adapter could not have implemented it at all.
    await expect(sql(`SELECT $1::text AS sentinel`, ["\u0000:uncategorised"])).rejects.toThrow();
  }, DATABASE_TIMEOUT_MS);

  it("reports counts as bigint, which a driver need not hand over as a number", async () => {
    const rows = await sql(`SELECT COUNT(*) AS n FROM rating`);
    const raw = rows[0]!["n"];
    // `pg` returns int8 as a string; other drivers return a number or a BigInt. The
    // adapter converts in one stated place rather than trusting the driver's choice.
    expect(["string", "number", "bigint"]).toContain(typeof raw);
    expect(Number(raw)).toBe(harness.store.manifest.counts.ratings);
  }, DATABASE_TIMEOUT_MS);
});

/**
 * The loud half of the loud skip.
 *
 * The banner `adapters.ts` prints at collection time is easy to lose — a reporter that
 * buffers, a CI log that scrolls — and a suite reporting "46 passed" with no second
 * adapter is exactly the quiet pass GA-06's "Must not" forbids. So the consequence is
 * also stated from inside a named test, where every reporter shows it, and asserted so it
 * cannot rot into a comment.
 */
describe.runIf(harness.adapters.length === 1)(
  "the second adapter did not run, so this run proves nothing about determinism",
  () => {
    it("says what was not checked, and what would check it", () => {
      expect(harness.postgres.present).toBe(false);
      if (harness.postgres.present) throw new Error("unreachable");

      console.info(`\n  ${harness.postgres.reason}\n`);

      expect(harness.postgres.reason).toContain(CONNECTION_VARIABLE);
      expect(harness.postgres.reason).toContain("UNPROVEN");
      expect(harness.postgres.reason).toContain("ONE adapter");
    });
  },
);
