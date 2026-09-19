import { join } from "node:path";

import { AskSurface } from "@/components/ask-surface";
import { aiMode } from "@/server/ai/mode";
import { loadSemanticLayer } from "@/server/semantic/load";
import { readStore } from "@/server/ingest/store";
import { surfaceData } from "@/server/surface/zero-state";

/**
 * The one page.
 *
 * A server component, because the two things the surface needs before anyone asks
 * anything are both on disk: the semantic layer's labels, and the compiled store's
 * manifest. Reading them here means the zero state is in the first HTML response rather
 * than after a round trip, and it means the client bundle never contains either.
 *
 * **Nothing is executed here.** `surfaceData()` touches the manifest and the layer and
 * never the engine, so no computed result can reach this page (build-spec §1.2). The
 * first number downstream of a question arrives on the `/api/ask` stream, in a session
 * where someone asked for it.
 *
 * `force-dynamic` because the store is read at request time; prerendering this page
 * would bake one build's manifest into the HTML and quietly serve it after a re-ingest.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  const layer = loadSemanticLayer();
  const store = readStore(join(process.cwd(), ".store"));
  // The same branch `/api/ask` takes, read from the same function, so the composer the
  // user sees and the interpreter the route got are never two different answers.
  // `aiMode()` reads the environment and nothing else — no SDK, no engine, no key value
  // leaves the server.
  return <AskSurface {...surfaceData(store, layer, "en", aiMode() === "live")} />;
}
