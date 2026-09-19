import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SemanticLayer } from "@/server/contracts";
import { parseQuestion } from "@/server/ai/fallback-parser";
import { aiMode, selectInterpreter, type Interpreter } from "@/server/ai/mode";
import { loadSemanticLayer } from "@/server/semantic/load";

/**
 * The startup branch on key presence.
 *
 * Invariant 13 says the app runs on a clean clone with no key — it degrades, it does not
 * break. A try/catch around an SDK call would produce the same behaviour by accident: it
 * degrades only for the failures somebody remembered to catch, and it cannot tell "no key"
 * from "the request failed", which the user is owed differently. So the branch is asserted
 * to *be* a branch.
 */

const layer: SemanticLayer = loadSemanticLayer();
const SOURCE = readFileSync(join(import.meta.dirname, "..", "..", "src", "server", "ai", "mode.ts"), "utf8");

/** Comments stripped, so the assertion below is about the code and not about its prose. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const live: Interpreter = () => ({
  ok: false,
  rejection: {
    kind: "clarify",
    asked: "live",
    missing: [],
    declared: { measures: [], dimensions: [] },
    nearest: [],
  },
});

describe("aiMode", () => {
  it("reads a usable key as live", () => {
    expect(aiMode({ ANTHROPIC_API_KEY: "sk-ant-whatever" })).toBe("live");
  });

  it("reads an absent, empty or whitespace key as degraded", () => {
    // `.env.example` ships `ANTHROPIC_API_KEY=`, so a clean clone that copies it has the
    // variable *set* and no key. A truthiness check would send that clone to a 401.
    expect(aiMode({})).toBe("degraded");
    expect(aiMode({ ANTHROPIC_API_KEY: "" })).toBe("degraded");
    expect(aiMode({ ANTHROPIC_API_KEY: "   " })).toBe("degraded");
    expect(aiMode({ ANTHROPIC_API_KEY: undefined })).toBe("degraded");
  });
});

describe("selectInterpreter", () => {
  it("uses the fallback parser with no key, and says the answer is degraded", () => {
    const selected = selectInterpreter(live, {});

    expect(selected.mode).toBe("degraded");
    expect(selected.degraded).toBe(true);
    expect(selected.interpret).toBe(parseQuestion);
  });

  it("uses the live interpreter when a key and a live arm are both present", () => {
    const selected = selectInterpreter(live, { ANTHROPIC_API_KEY: "sk-ant-whatever" });

    expect(selected.mode).toBe("live");
    expect(selected.degraded).toBe(false);
    expect(selected.interpret).toBe(live);
  });

  it("degrades when there is a key but no live arm", () => {
    // Still load-bearing after GA-08 supplied one. `route.ts` reaches the live arm
    // through a dynamic import, so a caller that has not taken it — a test, a script, a
    // future entry point — passes `null` and must degrade. A key in the environment
    // cannot by itself decide what runs, or "this build called nothing" would be a fact
    // about the environment rather than about the code.
    const selected = selectInterpreter(null, { ANTHROPIC_API_KEY: "sk-ant-whatever" });

    expect(selected.mode).toBe("degraded");
    expect(selected.interpret).toBe(parseQuestion);
  });

  it("answers a starter question identically on either arm's fallback", async () => {
    const selected = selectInterpreter(null, {});
    const result = await selected.interpret("What are our top rated titles?", layer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.measure).toBe("avg_rating");
  });

  it("is a branch, not a caught exception", () => {
    expect(CODE).not.toMatch(/\bcatch\b/);
    expect(CODE).not.toMatch(/\btry\b/);
    expect(CODE).toMatch(/if \(live !== null && aiMode\(env\) === "live"\)/);
  });
});
