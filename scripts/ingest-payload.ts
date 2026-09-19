/**
 * `npm run ingest` — read the held payload, compile the store, write it to `.store/`.
 *
 * Runs on Node's native type stripping, so every relative import in this chain carries
 * an explicit `.ts` extension (architecture §1). No build step, no runner dependency:
 * the clean-clone path is `npm install && npm run ingest && npm run dev`.
 */

import { join } from "node:path";

import { buildStore } from "../src/server/ingest/build-store.ts";
import { readPayload } from "../src/server/ingest/read-payload.ts";
import { writeStore } from "../src/server/ingest/store.ts";

const root = join(import.meta.dirname, "..");
const dataDir = join(root, "data");
const storeDir = join(root, ".store");

const payload = readPayload(dataDir);
const built = buildStore([payload]);

writeStore(storeDir, built.manifest, built.strings, built.columns);

const { titles, ratings, viewers } = built.manifest.counts;

// Raw digits, not `Intl`: this line is a build artifact checked by
// `docs/build-spec.md` §3 GA-02, not user-facing output. Invariant 12 governs what the
// product renders.
console.log(
  `wrote .store — ${built.manifest.payloads.length} payload, as-of ${built.manifest.asOf}, last event ${built.manifest.lastEventAt}`,
);
console.log(`${titles} titles · ${ratings} ratings · ${viewers} viewers`);
