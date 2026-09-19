import {
  QuerySpecSchema,
  type QuerySpec,
  type Rejection,
  type SemanticLayer,
} from "@/server/contracts";

import { isRegisteredGuard } from "@/server/semantic/guards/registry";

/**
 * Turning a loosely-shaped request into an executable `QuerySpec` — or into a clarifying
 * question.
 *
 * **Nothing here ever throws.** Invariant 4 says anything outside the semantic layer
 * becomes a clarifying question and never a nearest match, and a throw is not a
 * clarifying question: it gets caught somewhere generic and rendered as an error, which
 * is the product failing rather than the product working. Promoting refusal to a
 * demonstrated feature later (GA-05) is then a rendering change, not a rebuild of this
 * path (`docs/architecture.md` §2).
 *
 * It is also where `tieBreak` is filled. The model never chooses it — `ModelQuerySpec`
 * omits the field — so the layer's `defaultTieBreak` lands here, before validation, and
 * every spec that reaches an adapter carries a total ordering rule.
 */

export type ResolveResult =
  | { ok: true; spec: QuerySpec }
  | { ok: false; rejection: Rejection };

/** Everything the caller may hand in. Deliberately loose: the input is untrusted. */
export type ResolveInput = {
  measure?: unknown;
  breakdown?: unknown;
  filters?: unknown;
  sort?: unknown;
  limit?: unknown;
  guards?: unknown;
  asOf?: unknown;
};

const DEFAULT_LIMIT = 10;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Two or three questions that *do* work, so the clarifying question names the gap rather
 * than implying one. Built from the layer, never written down: a measure added to the
 * layer starts appearing here without a code change.
 */
function nearestQuestions(layer: SemanticLayer, locale = "en"): Rejection["nearest"] {
  const dimension = layer.dimensions[0];
  if (dimension === undefined) return [];

  return layer.measures.slice(0, 3).flatMap((measure) => {
    const label = measure.labels[locale] ?? measure.id;
    const spec = QuerySpecSchema.safeParse({
      measure: measure.id,
      breakdown: dimension.id,
      filters: [],
      sort: { by: "measure", dir: "desc", tieBreak: layer.defaultTieBreak },
      limit: DEFAULT_LIMIT,
      guards: layer.guards.map((guard) => ({ id: guard.id, params: guard.defaultParams })),
      asOf: null,
    });
    if (!spec.success) return [];
    return [
      {
        question: `What are our top ${dimension.labels[locale] ?? dimension.id}s by ${label}?`,
        spec: spec.data,
      },
    ];
  });
}

function rejection(
  layer: SemanticLayer,
  asked: string,
  missing: Rejection["missing"],
): { ok: false; rejection: Rejection } {
  return {
    ok: false,
    rejection: {
      kind: "clarify",
      asked,
      missing,
      declared: {
        measures: layer.measures.map((measure) => measure.id),
        dimensions: layer.dimensions.map((dimension) => dimension.id),
      },
      nearest: nearestQuestions(layer),
    },
  };
}

/**
 * Resolve an input against the layer.
 *
 * `asked` is the user's question, echoed back in the rejection. It defaults to a rendering
 * of the input so a caller that has no original text still produces a usable clarification.
 */
export function resolveSpec(
  input: ResolveInput,
  layer: SemanticLayer,
  asked = JSON.stringify(input),
): ResolveResult {
  const declaredMeasures = new Set(layer.measures.map((measure) => measure.id));
  const declaredDimensions = new Set(layer.dimensions.map((dimension) => dimension.id));
  const declaredGuards = new Map(layer.guards.map((guard) => [guard.id, guard]));

  const missing: Rejection["missing"] = [];

  const measure = typeof input.measure === "string" ? input.measure : undefined;
  if (measure === undefined || !declaredMeasures.has(measure)) {
    missing.push({ what: measure ?? "(no measure named)", kind: "measure" });
  }

  const breakdown = typeof input.breakdown === "string" ? input.breakdown : undefined;
  if (breakdown !== undefined && !declaredDimensions.has(breakdown)) {
    missing.push({ what: breakdown, kind: "dimension" });
  }

  const filters = Array.isArray(input.filters) ? input.filters : [];
  for (const filter of filters) {
    const dimension = asRecord(filter)["dimension"];
    if (typeof dimension !== "string" || !declaredDimensions.has(dimension)) {
      missing.push({ what: typeof dimension === "string" ? dimension : "(unnamed)", kind: "filter" });
    }
  }

  // Guards default to *on*: every guard the layer declares, with its declared thresholds.
  // A safe default already applied is the design (design §5); an unguarded answer has to
  // be asked for, and asking for one is what the naive comparison renders.
  const requestedGuards = Array.isArray(input.guards) ? input.guards : undefined;
  const guards =
    requestedGuards === undefined
      ? layer.guards.map((guard) => ({ id: guard.id, params: { ...guard.defaultParams } }))
      : requestedGuards.map((guard) => {
          const record = asRecord(guard);
          const id = typeof record["id"] === "string" ? record["id"] : "";
          const declared = declaredGuards.get(id);
          if (declared === undefined || !isRegisteredGuard(id)) {
            missing.push({ what: id === "" ? "(unnamed guard)" : id, kind: "guard" });
            return { id, params: {} };
          }
          return {
            id,
            params: { ...declared.defaultParams, ...asRecord(record["params"]) } as Record<
              string,
              number
            >,
          };
        });

  if (missing.length > 0) return rejection(layer, asked, missing);

  const sort = asRecord(input.sort);
  const candidate = {
    measure,
    ...(breakdown === undefined ? {} : { breakdown }),
    filters,
    sort: {
      by: sort["by"] === "breakdown" ? "breakdown" : "measure",
      dir: sort["dir"] === "asc" ? "asc" : "desc",
      // The model never chooses the tie-break. Filling it from the layer here is what
      // makes every spec that reaches an adapter carry a total ordering rule.
      tieBreak: typeof sort["tieBreak"] === "string" ? sort["tieBreak"] : layer.defaultTieBreak,
    },
    limit: typeof input.limit === "number" ? input.limit : DEFAULT_LIMIT,
    guards,
    asOf: typeof input.asOf === "string" ? input.asOf : null,
  };

  const parsed = QuerySpecSchema.safeParse(candidate);
  if (!parsed.success) {
    // A shape failure is still a clarifying question, never a throw: the caller gets the
    // same object to render whether the measure was undeclared or the limit was 10,000.
    return rejection(
      layer,
      asked,
      parsed.error.issues.map((issue) => ({
        what: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        kind: "filter" as const,
      })),
    );
  }

  if (!declaredDimensions.has(parsed.data.sort.tieBreak)) {
    return rejection(layer, asked, [{ what: parsed.data.sort.tieBreak, kind: "dimension" }]);
  }

  return { ok: true, spec: parsed.data };
}
