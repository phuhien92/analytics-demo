import { writeSync } from "node:fs";
import { join } from "node:path";

import type { SemanticLayer } from "@/server/contracts";
import { loadSemanticLayer } from "@/server/semantic/load";
import { LocalStoreWarehouse } from "@/server/warehouse/local-store";
import type { SqlClient } from "@/server/warehouse/postgres-store";
import type { Warehouse } from "@/server/warehouse/types";

import { buildStore } from "../../src/server/ingest/build-store.ts";
import { readPayload } from "../../src/server/ingest/read-payload.ts";
import type { Store } from "../../src/server/ingest/store.ts";

import {
  CONFORMANCE_SCHEMA,
  CONNECTION_VARIABLE,
  POSTGRES_ABSENT_CONSEQUENCE,
  POSTGRES_REQUIREMENT,
  conformanceConnectionString,
  createPostgresFixture,
} from "./postgres-fixture.ts";

/**
 * The adapters under test, and the rule that there should be more than one of them.
 *
 * `docs/build-spec.md` §3, GA-06's "Must not": *skip the second adapter because one
 * passes*. A suite that quietly runs one adapter and reports green is that failure
 * wearing a better disguise — the seam is real only if a second, entirely different
 * implementation passes the same corpus through it.
 *
 * So there are exactly three outcomes, and none of them is quiet:
 *
 * | `CONFORMANCE_DATABASE_URL` | connection | outcome |
 * | --- | --- | --- |
 * | set | works | both adapters run; the corpus must agree exactly |
 * | set | fails | **failure** — the operator asked for the second adapter and did not get it |
 * | unset | — | **loud skip** naming the consequence: the claim is unproven on this run |
 *
 * The third row is a concession to the fact that most people cloning this repository will
 * not have a Postgres to hand, and a suite that cannot run at all is worse than one that
 * says plainly what it did not check.
 */

const DATA_DIR = join(import.meta.dirname, "..", "..", "data");

/**
 * The store both adapters read, compiled in memory from `data/`.
 *
 * Deliberately **not** `.store/`: the suite runs on a clean clone without `npm run ingest`
 * having been run, and starting both adapters from one in-memory `Store` means a
 * disagreement between them can only be a disagreement between two aggregation
 * implementations, never between two ETLs.
 */
export function buildConformanceStore(): Store {
  return buildStore([readPayload(DATA_DIR)]).store;
}

/**
 * Print something the test reporter cannot swallow.
 *
 * Measured, not assumed: piped to a file, Vitest's default reporter drops `console`
 * output from files that pass, and prints it only when something in them fails. The skip
 * banner below therefore printed to nothing at all in CI — a "loud skip" that was loud
 * only on a developer's terminal, which is precisely the quiet pass GA-06's "Must not"
 * forbids. `writeSync` to file descriptor 1 goes under the console interception and the
 * reporter both, so what this says is said whatever is watching.
 */
function announce(lines: readonly string[]): void {
  writeSync(1, `\n${lines.join("\n")}\n\n`);
}

/**
 * A connection failure, in words.
 *
 * `AggregateError` — which is what a dual-stack `ECONNREFUSED` arrives as — carries an
 * empty `message` and hides the reason in `errors`. Reported naively the operator is told
 * "Underlying failure:" and nothing else, which is a failure that fails to say why.
 */
function describe_(error: unknown): string {
  if (error instanceof AggregateError) {
    const reasons = error.errors.map((inner) => describe_(inner)).filter((text) => text.length > 0);
    return reasons.length > 0 ? reasons.join("; ") : "connection failed";
  }
  if (error instanceof Error) return error.message.length > 0 ? error.message : error.name;
  return String(error);
}

export type AdapterUnderTest = {
  /** What `describe.each` prints, and what lands in `Provenance.adapterId`. */
  id: string;
  warehouse: Warehouse;
  close: () => Promise<void>;
};

export type ConformanceHarness = {
  store: Store;
  layer: SemanticLayer;
  adapters: readonly AdapterUnderTest[];
  /**
   * Raw SQL against the second adapter's server, for the divergence demonstrations only.
   * `null` when it did not run. Nothing in the corpus uses it: a case that reached past
   * `aggregate()` would stop being a case both adapters can answer.
   */
  sql: SqlClient | null;
  /** Present exactly when the second adapter ran. */
  postgres:
    | { present: true; serverVersion: string; collation: string; connectMs: number; loadMs: number; reusedExistingData: boolean }
    | { present: false; reason: string };
  closeAll: () => Promise<void>;
};

export async function createHarness(): Promise<ConformanceHarness> {
  const store = buildConformanceStore();
  const layer = loadSemanticLayer();

  const local: AdapterUnderTest = {
    id: "local-store",
    warehouse: new LocalStoreWarehouse(store),
    close: () => Promise.resolve(),
  };

  const connectionString = conformanceConnectionString();
  if (connectionString === undefined) {
    // Loud, and about the consequence rather than the absence: a reader skimming the
    // output has to come away knowing what was *not* checked.
    announce([
      "  ┌───────────────────────────────────────────────────────────────────────────┐",
      "  │  CONFORMANCE SUITE: SECOND ADAPTER SKIPPED                                 │",
      "  └───────────────────────────────────────────────────────────────────────────┘",
      `  ${POSTGRES_ABSENT_CONSEQUENCE}`,
      `  What it needs: ${POSTGRES_REQUIREMENT}.`,
    ]);
    return {
      store,
      layer,
      adapters: [local],
      sql: null,
      postgres: { present: false, reason: POSTGRES_ABSENT_CONSEQUENCE },
      closeAll: () => Promise.resolve(),
    };
  }

  let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
  try {
    fixture = await createPostgresFixture(store, connectionString);
  } catch (error) {
    // Set but broken is a failure, never a skip. A suite that downgrades a broken
    // connection to "skipped" goes green on the first outage and never goes red again.
    throw new Error(
      `${CONNECTION_VARIABLE} is set, so the conformance suite requires the second adapter — ` +
        `and could not reach it. This is a failure, not a skip: the run cannot prove the two ` +
        `engines agree, and the operator asked for that proof.\n` +
        `A Supabase project that has been idle is paused, and the first connection after a ` +
        `pause can fail or take many seconds; check the project is active before re-running.\n` +
        `Underlying failure: ${describe_(error)}`,
      { cause: error },
    );
  }

  announce([
    "  Conformance second adapter: connected.",
    // Read from the server, never from configuration: collation and ordering semantics
    // differ across majors, so a divergence found later has to be attributable to one.
    `    server     : ${fixture.serverVersion}`,
    `    collation  : ${fixture.collation}`,
    `    connect    : ${fixture.timings.connectMs} ms`,
    `    data       : ${fixture.timings.reusedExistingData ? "reused, already loaded" : `loaded in ${fixture.timings.loadMs} ms`}`,
    // Disclosed every run, because the suite wrote to someone's database and leaving that
    // unsaid is the kind of quiet side effect this product exists to argue against.
    `    left behind: schema ${CONFORMANCE_SCHEMA} — DROP SCHEMA ${CONFORMANCE_SCHEMA} CASCADE; to remove`,
  ]);

  const postgres: AdapterUnderTest = {
    id: fixture.warehouse.adapterId,
    warehouse: fixture.warehouse,
    close: fixture.close,
  };

  return {
    store,
    layer,
    adapters: [local, postgres],
    sql: fixture.sql,
    postgres: {
      present: true,
      serverVersion: fixture.serverVersion,
      collation: fixture.collation,
      connectMs: fixture.timings.connectMs,
      loadMs: fixture.timings.loadMs,
      reusedExistingData: fixture.timings.reusedExistingData,
    },
    closeAll: async () => {
      for (const adapter of [local, postgres]) await adapter.close();
    },
  };
}
