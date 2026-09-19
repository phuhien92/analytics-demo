import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Teach Node the two resolution conventions `src/` already uses.
 *
 * `npm run eval` has to run on a clean clone with no key, no build step and no runner
 * dependency — the same bar `npm run ingest` meets (`docs/architecture.md` §10). But the
 * eval harness reads the semantic layer and `resolveSpec`, and everything under
 * `src/server/` outside `ingest/` is written for a bundler: it imports through the `@/`
 * alias and omits file extensions. Node's ESM resolver knows neither convention, and
 * neither does its TypeScript stripping — those are declared in `tsconfig.json` and
 * mirrored in `vitest.config.ts`, which is why the app and the tests never notice.
 *
 * This is the third mirror of that one declaration, for the one runtime that has no
 * resolver of its own. It adds no dependency and no build step: `--import` loads it
 * before the entry point and `module.registerHooks` runs in-thread, synchronously.
 *
 * Deliberately narrow. It resolves `@/x` under `src/` and fills in a missing `.ts` or
 * `/index.ts` on a relative specifier, and defers everything else — `node:*`, bare
 * package names, anything already carrying an extension — to Node.
 */

const SRC = new URL("../src/", import.meta.url);

function firstFile(...candidates) {
  for (const candidate of candidates) {
    try {
      if (statSync(fileURLToPath(candidate)).isFile()) return candidate.href;
    } catch {
      // Not a file, or not there. Try the next candidate.
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const rest = specifier.slice(2);
      const url = firstFile(
        new URL(`${rest}.ts`, SRC),
        new URL(`${rest}/index.ts`, SRC),
        new URL(rest, SRC),
      );
      if (url !== null) return { url, shortCircuit: true };
    }

    if (specifier.startsWith(".") && context.parentURL !== undefined) {
      const url = firstFile(
        new URL(`${specifier}.ts`, context.parentURL),
        new URL(`${specifier}/index.ts`, context.parentURL),
      );
      if (url !== null) return { url, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
