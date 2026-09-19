import { join } from "node:path";

import type { SemanticLayer } from "@/server/contracts";

import { aiMode, selectInterpreter, type Interpreter } from "@/server/ai/mode";
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
 * **No provider dependency is imported on the keyless path.** `selectInterpreter` takes
 * its live arm by injection (`docs/architecture.md` §8), and `liveArm()` below reaches
 * `ai/interpret.ts` through a *dynamic* import taken only when a key is present. So the
 * SDK — and its key handling — never enters the import graph of the one path that has to
 * work on a clean clone with nothing but the dependencies installed (invariant 13).
 * Handing `selectInterpreter` a `null` is still how a keyless process says it has no
 * live arm; the only change is that a keyed one now has something to hand it.
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

/**
 * The live arm, or `null` — and the import that only a keyed process pays for.
 *
 * The branch is on the same `aiMode()` `selectInterpreter` consults, so the two cannot
 * disagree about which mode this process is in. What the branch buys is the *import*:
 * a static `import ... from "@/server/ai/interpret"` would pull `@anthropic-ai/sdk` into
 * this module's graph unconditionally, and the keyless path would then depend on a
 * package it never calls. It is not caught either — a key present with a broken SDK is a
 * broken deployment, and `answer.ts` already has a 500 that says exactly that.
 */
async function liveArm(): Promise<Interpreter | null> {
  if (aiMode() !== "live") return null;
  const { liveInterpreter } = await import("@/server/ai/interpret");
  return liveInterpreter();
}

async function dependencies(): Promise<AskDependencies> {
  if (cached !== null) return cached;

  const layer: SemanticLayer = loadSemanticLayer();
  const warehouse = LocalStoreWarehouse.fromDirectory(join(process.cwd(), ".store"));

  cached = {
    warehouse,
    layer,
    interpreter: selectInterpreter(await liveArm()),
    narrate: narrateFromTemplate,
    newRequestId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };
  return cached;
}

export async function POST(request: Request): Promise<Response> {
  return askResponse(await dependencies(), request);
}
