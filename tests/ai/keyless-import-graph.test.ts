import { describe, expect, it, vi } from "vitest";

/**
 * Invariant 13's structural half, asserted behaviourally rather than by reading source.
 *
 * The route reaches `ai/interpret.ts` through a dynamic import gated on `aiMode()`
 * (`docs/architecture.md` §6), so a keyless process loads route and page without ever
 * evaluating `@anthropic-ai/sdk`. What proves that is not the text of `route.ts` but what
 * an import does: the SDK entry is mocked here to *record being evaluated*, the keyless
 * graph is then loaded, and the assertion is that the recording never happened. A static
 * import anywhere on the route or page path would evaluate the SDK while its module
 * loaded and fail the assertion; a behaviour-preserving refactor that keeps the dynamic
 * import still passes.
 *
 * The control case keeps the mechanism non-vacuous. `ai/interpret.ts` is the one module
 * on the graph that *does* statically import the SDK, so loading it through the same
 * registry must fire the recording. If the mock ever stopped intercepting, that test
 * fails — and the keyless assertion is only meaningful because the interception is known
 * to work. Neither module runs its request-time work at import, so loading them is side
 * effect-free.
 */

const sdkEvaluated = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  sdkEvaluated();
  return {};
});

vi.mock("@anthropic-ai/sdk/helpers/zod", () => {
  sdkEvaluated();
  return {};
});

describe("the live arm stays off the keyless import graph", () => {
  it("loads the route and the page without ever evaluating the SDK", async () => {
    sdkEvaluated.mockClear();

    await import("@/app/api/ask/route");
    await import("@/app/page");

    expect(sdkEvaluated).not.toHaveBeenCalled();
  });

  it("would catch a static import: the live arm's own module evaluates the SDK", async () => {
    sdkEvaluated.mockClear();

    await import("@/server/ai/interpret");

    expect(sdkEvaluated).toHaveBeenCalled();
  });
});