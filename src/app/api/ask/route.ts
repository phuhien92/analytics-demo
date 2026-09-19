import { join } from "node:path";

import type { SemanticLayer } from "@/server/contracts";

import { selectInterpreter } from "@/server/ai/mode";
import { narrateFromTemplate } from "@/server/ai/narrate-template";
import { loadSemanticLayer } from "@/server/semantic/load";
import { LocalStoreWarehouse } from "@/server/warehouse/local-store";

import { askResponse, type AskDependencies } from "./answer";

/**
 * `POST /api/ask` — the composition root.
 *
 * Everything this file owns is the part only a deployed process can own: which store to
 * read, which layer to load, which interpreter this process got. The assembly, the
 * status codes, the frame order and the stream are all in `./answer.ts`, where a test
 * can reach them without a compiled store or an HTTP server.
 *
 * **No model is called here and no provider dependency is imported.** `selectInterpreter`
 * takes its live arm by injection and is handed `null`, which is how a keyless build says
 * it has no live arm (`docs/architecture.md` §8). GA-08 passes its interpreter in at this
 * one line; nothing else about this file moves.
 */

/** The store is read from disk and the layer is parsed off it, so this cannot run on edge. */
export const runtime = "nodejs";

/**
 * Every answer is pinned to its own `requestId` and `computedAt`, so there is no version
 * of this response that can be prerendered or revalidated — and a route that was
 * statically analysed would buffer the stream, which is the one thing it must not do.
 */
export const dynamic = "force-dynamic";

/**
 * Read once per process, not once per request.
 *
 * `.store/` is a build artifact — 2 MB of typed arrays compiled by `npm run ingest` — and
 * the semantic layer is a file on disk. Neither changes while the process lives: a new
 * payload means a new ingest, and a layer edit means a redeploy. Re-reading them per
 * request would buy nothing and cost the read.
 *
 * `data/*.csv` is never touched here. The route reads the **compiled store**; the CSVs
 * are the ingest's input, and a serving path that parsed them would be a second ETL with
 * no manifest, no as-of and nothing to pin (build-spec §3 GA-07, "Must not").
 */
let cached: AskDependencies | null = null;

function dependencies(): AskDependencies {
  if (cached !== null) return cached;

  const layer: SemanticLayer = loadSemanticLayer();
  const warehouse = LocalStoreWarehouse.fromDirectory(join(process.cwd(), ".store"));

  cached = {
    warehouse,
    layer,
    interpreter: selectInterpreter(null),
    narrate: narrateFromTemplate,
    newRequestId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };
  return cached;
}

export async function POST(request: Request): Promise<Response> {
  return askResponse(dependencies(), request);
}
