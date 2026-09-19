import type { SemanticLayer } from "@/server/contracts";
import type { DatasetProvenance, LayerLabels, StarterCard, SurfaceData } from "@/lib/view-model";

import { STARTER_QUESTIONS, type StarterQuestion } from "@/server/ai/fallback-parser";
import type { Store } from "@/server/ingest/store";
import { INSIGHT_BRIEFING_FIXTURE } from "@/server/surface/insight-briefing.fixture";

/**
 * The zero state's data, assembled on the server.
 *
 * Two sources, and neither is the engine. The starter questions come from
 * `ai/fallback-parser.ts`, which is where they already live because the parser has to
 * recognise them; the dataset line comes from the compiled store's **manifest**, which
 * is what the ETL declared it received. Nothing on this path runs a spec, so the zero
 * state cannot show a computed result even by accident (build-spec §1.2).
 *
 * It sits under `src/server/` rather than in `page.tsx` so it is reachable from
 * `tests/ui/` with a hand-built layer and manifest, with no compiled `.store/`.
 */

/** A declared label at a locale, falling back to the id. Never a nearest match. */
function labelFor(
  declarations: readonly { id: string; labels: Record<string, string> }[],
  id: string,
  locale: string,
): string {
  return declarations.find((declaration) => declaration.id === id)?.labels[locale] ?? id;
}

/**
 * The chip's second line: what this question is about to do, in the layer's words.
 *
 * Generated rather than authored, because a hand-written caption and the spec it
 * describes drift apart silently — which is this product's own failure mode pointed at
 * its zero state. If a label changes in `semantic/movielens.json`, this line changes
 * with it.
 */
export function starterRecipe(
  starter: StarterQuestion,
  layer: SemanticLayer,
  locale: string,
): string {
  const measure = labelFor(layer.measures, starter.measure, locale);
  const breakdown = labelFor(layer.dimensions, starter.breakdown, locale);
  return `${measure}, by ${breakdown}`;
}

export function starterCards(layer: SemanticLayer, locale = "en"): StarterCard[] {
  return STARTER_QUESTIONS.flatMap((starter) => {
    const question = starter.questions[locale];
    // A starter with no copy at this locale is not shown. Falling back to another
    // locale's string would put words in front of the user that the parser at this
    // locale cannot match — silent coercion, one layer out (invariant 4).
    if (question === undefined) return [];
    return [
      {
        id: starter.id,
        question,
        recipe: starterRecipe(starter, layer, locale),
        shape: starter.sort.by === "measure" ? ("ranking" as const) : ("sequence" as const),
      },
    ];
  });
}

/**
 * The dataset line, read off the manifest.
 *
 * The **last** payload is the one that names the source, matching
 * `LocalStoreWarehouse.sourceId`; the counts and the as-of are the store's own, which
 * is the whole delivery rather than the last increment of it.
 */
export function datasetProvenance(store: Store): DatasetProvenance {
  const { manifest } = store;
  const payload = manifest.payloads[manifest.payloads.length - 1];
  return {
    sourceId: payload?.sourceId ?? "unknown",
    payloadId: payload?.payloadId ?? "unknown",
    titles: manifest.counts.titles,
    ratings: manifest.counts.ratings,
    asOf: manifest.asOf,
  };
}

/** Every declared id's label at one locale, so the surface never invents a word. */
export function layerLabels(layer: SemanticLayer, locale = "en"): LayerLabels {
  const at = (declarations: readonly { id: string; labels: Record<string, string> }[]) =>
    Object.fromEntries(
      declarations.map((declaration) => [declaration.id, declaration.labels[locale] ?? declaration.id]),
    );
  return { measures: at(layer.measures), dimensions: at(layer.dimensions) };
}

/**
 * `canInterpret` is a parameter rather than a call to `aiMode()` here, for the same
 * reason the engine never appears in this file: it keeps the first-paint builder a pure
 * function of the manifest, the layer and one stated fact, so `tests/ui/` can render
 * both deployments without an environment.
 */
export function surfaceData(
  store: Store,
  layer: SemanticLayer,
  locale = "en",
  canInterpret = false,
): SurfaceData {
  return {
    dataset: datasetProvenance(store),
    starters: starterCards(layer, locale),
    labels: layerLabels(layer, locale),
    locale,
    // Issue #27: fixture until a proactive job exists. Not engine output.
    insight: INSIGHT_BRIEFING_FIXTURE,
    canInterpret,
  };
}
