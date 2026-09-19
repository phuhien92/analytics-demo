import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json, so a test and the app
    // resolve `@/server/contracts` to the same file.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    /**
     * Still `node`, deliberately. `tests/ui/` renders to static markup and asserts on
     * the HTML, which needs no DOM — the same reason `docs/architecture.md` §10 gives
     * for keeping jsdom out of the server render of a chart. Nothing in the suite waits
     * for an effect, so nothing here needs a browser environment.
     */
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
