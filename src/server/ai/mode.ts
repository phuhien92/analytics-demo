import type { SemanticLayer } from "@/server/contracts";

import type { ResolveResult } from "@/server/engine/resolve";

import { parseQuestion } from "./fallback-parser";

/**
 * The startup branch on key presence.
 *
 * **A branch, not a caught exception** (build-spec §3 GA-05, "Delivers"). The difference
 * is whether "the app degrades rather than breaks" is a property or an accident: a
 * try/catch around an SDK call degrades only for the failures someone remembered to
 * catch, and it cannot tell "no key" from "the request failed", which are different facts
 * the user is owed differently (`docs/design.md` §8). Deciding once, up front, on a fact
 * that cannot change mid-request, is what makes invariant 13 checkable.
 */

export type AiMode = "live" | "degraded";

/** A question in, an executable spec or a clarifying question out. Both paths share it. */
export type Interpreter = (
  question: string,
  layer: SemanticLayer,
  locale?: string,
) => ResolveResult | Promise<ResolveResult>;

export type SelectedInterpreter = {
  readonly mode: AiMode;
  /** What the answer object reports, so the surface can show its one-time inline note. */
  readonly degraded: boolean;
  readonly interpret: Interpreter;
};

/**
 * Is a usable key present?
 *
 * An empty or whitespace-only value counts as absent. `ANTHROPIC_API_KEY=` is what
 * `.env.example` ships, so a clean clone that copies it has the variable *set* and no key
 * — and a truthiness check would send that clone down the live path to a 401.
 */
export function aiMode(env: Record<string, string | undefined> = process.env): AiMode {
  const key = env["ANTHROPIC_API_KEY"];
  return typeof key === "string" && key.trim() !== "" ? "live" : "degraded";
}

/**
 * Choose the interpreter for this process.
 *
 * `live` is injected rather than imported: GA-08 owns the model call, and importing it
 * here would put the SDK — and its key handling — on the no-key path's import graph,
 * which is the one path that has to work with nothing installed but the dependencies.
 * Passing `null` is how the keyless build says it has no live arm, and it is why this
 * function is fully testable today.
 */
export function selectInterpreter(
  live: Interpreter | null = null,
  env: Record<string, string | undefined> = process.env,
): SelectedInterpreter {
  if (live !== null && aiMode(env) === "live") {
    return { mode: "live", degraded: false, interpret: live };
  }
  return { mode: "degraded", degraded: true, interpret: parseQuestion };
}
