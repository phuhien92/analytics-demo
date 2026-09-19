import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { SemanticLayer } from "@/server/contracts";
import { INTERPRET_MODEL, interpretRequest } from "@/server/ai/interpret";
import { loadSemanticLayer } from "@/server/semantic/load";

/**
 * The live confirmation: two identical requests, and a cache read on the second.
 *
 * ## Why this is opt-in behind its own variable
 *
 * `ANTHROPIC_API_KEY` is the **product's** key. It is what makes the deployed app's
 * question box live, and it is present in any environment where someone is running the
 * app — which is exactly where `npm test` also runs. A suite that fired paid requests
 * because a key happened to be in the environment would put a bill on a command nobody
 * expects to cost anything, and would do it silently.
 *
 * So one variable decides, the way `CONFORMANCE_DATABASE_URL` decides the second adapter
 * (`docs/architecture.md` §5b): `LIVE_INTERPRET_API_KEY` is read, used, and passed to the
 * client explicitly. The SDK is never allowed to pick a key up from the environment on
 * its own here, because "which key did this spend" must not be a question.
 *
 * - **Set and working:** the two requests run and the second must report a cache read.
 * - **Set and failing:** a failure. Someone asked for the live check; not getting it is
 *   not a skip. A suite that downgraded a broken call to "skipped" would go green on the
 *   first outage and never go red again.
 * - **Unset:** a loud skip naming what went unchecked — which is the normal case, and is
 *   why `tests/ai/interpret.test.ts` asserts the same property against the constructed
 *   request instead. That file is what holds this line on every ordinary run.
 *
 * ## What it proves that the offline test cannot
 *
 * Only that the provider agrees. The offline test already pins that the prefix is
 * byte-identical across questions, that the breakpoint is at its end, and that the prefix
 * clears the 512-token floor. What no local assertion can reach is whether Opus 5
 * actually created and then read the cache entry — and since falling under the floor
 * fails silently, that confirmation is worth having available even though it does not run
 * by default.
 */

/** The one variable. Named for the check, never for the product. */
export const LIVE_KEY_VARIABLE = "LIVE_INTERPRET_API_KEY";

/** What it means when it is absent, said once. */
export const LIVE_ABSENT_CONSEQUENCE =
  `${LIVE_KEY_VARIABLE} is not set, so NO live interpret call ran. Prompt caching is ` +
  `UNCONFIRMED against the provider on this run: the prefix's shape is asserted in ` +
  `tests/ai/interpret.test.ts, but whether Opus 5 created and read the cache entry is ` +
  `not. Falling under the 512-token floor fails silently, so set ${LIVE_KEY_VARIABLE} ` +
  `to an Anthropic key and run it again to confirm. It spends money.`;

function liveKey(): string | undefined {
  const value = process.env[LIVE_KEY_VARIABLE]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

const key = liveKey();
const layer: SemanticLayer = loadSemanticLayer();

/** Generous: one uncached Opus 5 call plus one cached one, sequentially. */
const LIVE_TIMEOUT_MS = 120_000;

describe.runIf(key !== undefined)("the cached prefix, confirmed against the provider", () => {
  // The key is passed explicitly rather than resolved from the environment, so this
  // suite cannot quietly spend ANTHROPIC_API_KEY.
  const client = new Anthropic({ apiKey: key ?? "" });

  it(
    "reports a cache read on the second of two identical requests",
    async () => {
      const question = "What are our top rated titles?";

      const first = await client.messages.parse(interpretRequest(question, layer));
      const second = await client.messages.parse(interpretRequest(question, layer));

      // The first call is what writes the entry. If this is zero the prefix never
      // cleared the floor, and nothing else would have said so.
      expect(first.usage.cache_creation_input_tokens ?? 0).toBeGreaterThan(0);
      expect(second.usage.cache_read_input_tokens ?? 0).toBeGreaterThan(0);

      console.info(
        `\n  ${INTERPRET_MODEL} cache: created ${first.usage.cache_creation_input_tokens}, ` +
          `read ${second.usage.cache_read_input_tokens}\n`,
      );
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "returns a spec the contract accepts, with no field the model may not choose",
    async () => {
      const message = await client.messages.parse(
        interpretRequest("Which genres have the most ratings?", layer),
      );

      expect(message.parsed_output).not.toBeNull();
      const text = JSON.stringify(message.parsed_output);
      expect(text).not.toContain("tieBreak");
      expect(text).not.toContain("asOf");
    },
    LIVE_TIMEOUT_MS,
  );
});

/**
 * The loud half of the loud skip.
 *
 * A banner printed at collection time is easy to lose to a buffering reporter or a
 * scrolling CI log, and a suite reporting all green with no live call is exactly the
 * quiet pass that lets an unconfirmed claim read as a confirmed one. So the consequence
 * is stated from inside a named test, where every reporter shows it, and asserted so it
 * cannot rot into a comment.
 */
describe.runIf(key === undefined)(
  "no live interpret call ran, so caching is unconfirmed against the provider",
  () => {
    it("says what was not checked, and what would check it", () => {
      console.info(`\n  ${LIVE_ABSENT_CONSEQUENCE}\n`);

      expect(LIVE_ABSENT_CONSEQUENCE).toContain(LIVE_KEY_VARIABLE);
      expect(LIVE_ABSENT_CONSEQUENCE).toContain("UNCONFIRMED");
      expect(LIVE_ABSENT_CONSEQUENCE).toContain("fails silently");
    });

    it("is skipped on the product's own key, which it must never spend", () => {
      // The distinction this file exists to keep: a key for the app is not permission to
      // bill `npm test`.
      expect(liveKey()).toBeUndefined();
    });
  },
);
