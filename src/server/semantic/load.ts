import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SemanticLayerSchema, type SemanticLayer } from "@/server/contracts";

import { GUARD_REGISTRY, REGISTERED_GUARD_IDS, isRegisteredGuard } from "./guards/registry";

/**
 * Parse and validate `semantic/movielens.json`.
 *
 * The layer is versioned data, not code (AGENTS.md invariant 7), so the thing that keeps
 * an edit honest is this loader rather than a compiler. It fails fast and it points at a
 * path: whoever is reading the error is adding a measure or a guard to fix a failing
 * eval, and an error that only says "invalid layer" sends them reading the whole file.
 *
 * Four checks, in order. The schema gives the first; the other three are the cross-file
 * facts a schema cannot see, and each one is a way for the layer to name something that
 * does not exist and have it quietly resolve to nothing at execution time.
 */

/** A layer that did not load, with the path that failed already in the message. */
export class SemanticLayerError extends Error {
  override readonly name = "SemanticLayerError";

  constructor(source: string, path: string, detail: string) {
    super(`${source}: ${path} — ${detail}`);
  }
}

/** `["measures", 0, "labels"]` → `measures[0].labels`. Empty path → the document itself. */
function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";

  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc === "" ? String(segment) : `${acc}.${String(segment)}`;
  }, "");
}

function list(values: readonly string[]): string {
  return [...values].sort().join(", ");
}

/**
 * Validate an already-parsed layer. Pure, so the failure cases are testable without a
 * file on disk, and so a layer arriving over the wire later takes the same path.
 */
export function parseSemanticLayer(raw: unknown, source = "semantic layer"): SemanticLayer {
  const parsed = SemanticLayerSchema.safeParse(raw);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SemanticLayerError(
      source,
      issue ? formatPath(issue.path) : "(root)",
      issue?.message ?? "failed validation",
    );
  }

  const layer = parsed.data;

  // A GuardId is valid because the registry holds it. A layer naming an unregistered id
  // would otherwise reach the engine and resolve to no guard at all — the confident wrong
  // answer, produced by the machinery built to catch it.
  layer.guards.forEach((guard, index) => {
    if (!isRegisteredGuard(guard.id)) {
      throw new SemanticLayerError(
        source,
        formatPath(["guards", index, "id"]),
        `"${guard.id}" is not in the guard registry (registered: ${list(REGISTERED_GUARD_IDS)})`,
      );
    }

    // A threshold under a key no guard reads is worse than a missing threshold: the guard
    // still runs, unthresholded, and nothing says so.
    const reads = GUARD_REGISTRY[guard.id]?.params ?? [];
    for (const param of Object.keys(guard.defaultParams)) {
      if (!reads.includes(param)) {
        throw new SemanticLayerError(
          source,
          formatPath(["guards", index, "defaultParams", param]),
          reads.length === 0
            ? `the "${guard.id}" guard reads no parameters`
            : `the "${guard.id}" guard reads no such parameter (reads: ${list(reads)})`,
        );
      }
    }
  });

  // `tieBreak` is required on every spec and the model never chooses it, so a
  // defaultTieBreak naming nothing makes every resolved spec unexecutable — and the
  // symptom is a 296-way tie ordering itself differently per adapter, not a load error.
  const dimensionIds = layer.dimensions.map((dimension) => dimension.id);
  if (!dimensionIds.includes(layer.defaultTieBreak)) {
    throw new SemanticLayerError(
      source,
      "defaultTieBreak",
      `"${layer.defaultTieBreak}" is not a declared dimension (declared: ${list(dimensionIds)})`,
    );
  }

  return layer;
}

/** Where the shipped layer lives, relative to the project root. */
export const SEMANTIC_LAYER_PATH = join("semantic", "movielens.json");

/**
 * Read and validate the shipped layer. Resolved from `process.cwd()` — the layer is data
 * the deployment carries, not a module the bundler inlines, which is what keeps editing
 * it a normal operation rather than a rebuild.
 */
export function loadSemanticLayer(filePath = join(process.cwd(), SEMANTIC_LAYER_PATH)): SemanticLayer {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new SemanticLayerError(filePath, "(file)", `could not be read: ${String(cause)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new SemanticLayerError(filePath, "(root)", `is not valid JSON: ${String(cause)}`);
  }

  return parseSemanticLayer(raw, filePath);
}
