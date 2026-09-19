import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { ModelQuerySpecSchema, type SemanticLayer } from "@/server/contracts";

import { resolveSpec, type ResolveInput, type ResolveResult } from "@/server/engine/resolve";

import { STARTER_QUESTIONS } from "./fallback-parser";
import type { Interpreter } from "./mode";

/**
 * Call 1 — interpret. A freely typed question becomes a `ModelQuerySpec`, or a
 * clarifying question.
 *
 * This is the live arm `ai/mode.ts` selects when a key is present. It is **never
 * imported by the keyless path**: `app/api/ask/route.ts` reaches it through a dynamic
 * import taken only when `aiMode()` says `live`, so the SDK and its key handling stay
 * off the import graph of the one path that has to work on a clean clone
 * (`AGENTS.md` invariant 13).
 *
 * ## The model interprets; it never computes
 *
 * Invariant 1, at its first real call site. What comes back is a *spec* — ids drawn
 * from the semantic layer, an ordering and a limit — which `engine/execute.ts` then
 * runs. No figure in this file, and none in the model's response, reaches the user.
 *
 * ## One artifact is both the model contract and the runtime validator
 *
 * `ModelQuerySpecSchema` is handed to the API as the output format *and* is what the
 * response is parsed against. There is no second schema to drift from the first, and
 * the fields the model may not choose are absent by construction rather than by
 * instruction: `ModelQuerySpec` omits `sort.tieBreak` and `asOf` (`contracts/query-spec.ts`),
 * so `parsed_output` cannot carry either one — the layer declares the tie-break and the
 * request carries the as-of.
 *
 * ## Structured outputs, not prefill
 *
 * `output_format` is gone from the SDK's type surface and assistant prefill returns 400
 * on Opus 5 (`docs/architecture.md` §6). `output_config.format` is the only correct
 * route, and `client.messages.parse` is what turns the response into `parsed_output`.
 *
 * ## The prefix is stable and the question is last
 *
 * Everything the model needs to *understand* this dataset — the instructions, the
 * semantic layer, the worked examples — is byte-identical from one question to the
 * next and sits in `system`, with the cache breakpoint on its final block. The question
 * is the whole of `messages`. That arrangement is the cached-prefix design
 * (`docs/architecture.md` §6), and it is asserted structurally in `tests/ai/interpret.test.ts`
 * rather than inferred from a billing line.
 */

/** Pinned in `docs/architecture.md` §6. The provider question is settled; this is it. */
export const INTERPRET_MODEL = "claude-opus-5";

/**
 * Interpretation is extraction-shaped, not reasoning-heavy (`docs/architecture.md` §6).
 *
 * Thinking is left alone rather than disabled: on Opus 5 it is on by default, and
 * disabling it is the documented way to get a tool call written into visible text. Low
 * effort is the cheaper lever and the one the architecture pins.
 */
export const INTERPRET_EFFORT = "low" as const;

/**
 * Room for the spec plus the short reasoning low effort produces.
 *
 * Not lowballed. A response cut off at the ceiling is not an error — it arrives as an
 * unparseable fragment, `parsed_output` is `null`, and the user gets a clarifying
 * question about a catalogue that could in fact have answered them. That failure would
 * look exactly like a question the layer cannot serve, which is the one confusion this
 * product cannot afford.
 */
export const INTERPRET_MAX_TOKENS = 8192;

/**
 * Opus 5 does not cache a prefix below this, **and says nothing when it does not**
 * (`docs/architecture.md` §3). No error, no warning, no header: just
 * `cache_creation_input_tokens: 0` and every question paying uncached prefix cost
 * forever. Nothing downstream can detect it, which is why it is pinned here as a number
 * a test can assert against rather than left as a note.
 */
export const CACHE_FLOOR_TOKENS = 512;

/** The estimator `docs/architecture.md` §3 already measures the layer with. */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * The floor is why this number exists, and why it is a floor rather than a target.
 *
 * Examples are the first thing trimmed for cost, and here trimming them **raises** the
 * bill: under the thinnest-viable layer the catalogue alone straddles the 512-token
 * floor, and the worked examples are what carry the prefix over it (build-spec §5,
 * boundary 4). Five is the contract; the shipped catalogue supplies more.
 */
export const FEW_SHOT_MINIMUM = 5;

/**
 * One worked example: a question, and the spec it stands for.
 *
 * **Generated from the starter catalogue and the layer, never authored.** Invariant 6
 * keeps dataset-specific knowledge out of the prompt, and a hand-written block naming
 * `avg_rating` and `genre` would put a MovieLens assumption inside the portable half of
 * the build — and would drift from the layer the moment a label changed. Building them
 * from `STARTER_QUESTIONS` through `ModelQuerySpecSchema` means the examples cannot
 * disagree with either the catalogue or the contract: a spec that would not validate
 * cannot be shown to the model as one that would.
 */
export type FewShotExample = {
  readonly question: string;
  readonly spec: unknown;
};

export function fewShotExamples(layer: SemanticLayer, locale = "en"): FewShotExample[] {
  const guards = layer.guards.map((guard) => ({ id: guard.id, params: { ...guard.defaultParams } }));

  return STARTER_QUESTIONS.flatMap((starter) => {
    const question = starter.questions[locale];
    // A starter with no copy at this locale teaches the model nothing at this locale.
    // Borrowing another locale's string would put a phrase in the prefix that the
    // question will never be written in.
    if (question === undefined) return [];

    const spec = ModelQuerySpecSchema.safeParse({
      measure: starter.measure,
      breakdown: starter.breakdown,
      filters: [],
      sort: { by: starter.sort.by, dir: starter.sort.dir },
      limit: starter.limit,
      guards,
    });
    if (!spec.success) return [];

    return [{ question, spec: spec.data }];
  });
}

/**
 * What the model is asked to do, in words that name no dataset.
 *
 * Every dataset-specific fact reaches the model as *data* — the catalogue block below —
 * so this text is the same for MovieLens and for whatever a second deployment points at
 * (invariant 6). The two rules that carry real weight are the last two, and both exist
 * because their failure mode is silent:
 *
 * - **Guards default on.** `engine/resolve.ts` fills them only when the field is
 *   absent, and the schema requires it, so a model that emitted `guards: []` would get
 *   a genuinely unguarded answer with nothing on the screen saying so. That is the
 *   confident wrong answer this product exists to catch, produced by the machinery
 *   built to catch it.
 * - **Undeclared terms are echoed, not matched.** This is invariant 4 expressed as a
 *   prompt rule. A model that helpfully substitutes the nearest declared measure turns
 *   a question the layer cannot answer into one it answers wrongly; echoing the user's
 *   own word instead lets `resolveSpec` recognise it as undeclared and return the
 *   clarifying question that names the gap.
 */
export const INTERPRET_INSTRUCTIONS = `You turn a business question into a query specification for an analytics engine.

You do not answer the question and you never state a figure. You choose ids from the catalogue below, and an engine computes the numbers.

Rules:

1. Use only ids the catalogue declares. The catalogue's labels and synonyms are how a question reaches an id.
2. One measure and at most one breakdown. Anything that needs more is not expressible here.
3. Order by "measure" when the question ranks things, and by "breakdown" when it asks about a sequence such as a run of years.
4. "limit" is how many rows to show. Use the whole breakdown when the question asks about each member of a small set, and ten for a ranking over a large one.
5. Always include every guard the catalogue declares, with the parameters it declares, unless the question explicitly asks for the unchecked, raw or naive figure.
6. If the question names a measure, dimension or filter the catalogue does not declare, put the user's own word in that field exactly as they wrote it. Never substitute the closest declared id: a question this catalogue cannot answer must come back as a question, not as a different answer.`;

/** The catalogue, pretty-printed — see `stablePrefix` for why the whitespace stays. */
export function catalogueBlock(layer: SemanticLayer): string {
  return `The catalogue this deployment serves:\n\n${JSON.stringify(layer, null, 2)}`;
}

export function examplesBlock(layer: SemanticLayer, locale = "en"): string {
  const examples = fewShotExamples(layer, locale)
    .map(({ question, spec }) => `Question: ${question}\nSpecification: ${JSON.stringify(spec)}`)
    .join("\n\n");
  return `Worked examples:\n\n${examples}`;
}

/**
 * The stable prefix: everything that does not change from one question to the next.
 *
 * Three blocks, with the cache breakpoint on the **last** one, which caches all three.
 * They are separate rather than concatenated so the prefix can be read — and measured —
 * in the three parts the cost argument is actually about.
 *
 * **The catalogue is pretty-printed and that is load-bearing.** Measured on the shipped
 * file, minifying it saves 644 bytes (`tests/semantic.test.ts`), which is roughly 160
 * tokens off a prefix that has a hard floor under it. The whitespace is also what a
 * human reviewer reads, and reviewing the layer is a normal operation (invariant 7), so
 * the saving costs twice.
 */
export function stablePrefix(
  layer: SemanticLayer,
  locale = "en",
): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: INTERPRET_INSTRUCTIONS },
    { type: "text", text: catalogueBlock(layer) },
    // The breakpoint sits here, at the end of the prefix, so everything above it is one
    // cached block and the question below it is the only thing that varies.
    { type: "text", text: examplesBlock(layer, locale), cache_control: { type: "ephemeral" } },
  ];
}

/**
 * The exact request the SDK is handed.
 *
 * Built by a pure function so the caching property is **checkable without a network
 * call**: the prefix's stability across two different questions, the breakpoint's
 * position, and the question's absence from `system` are all properties of this object.
 * A live reading of `cache_read_input_tokens` confirms the same thing against the
 * provider and is opt-in (`tests/ai/live-interpret.test.ts`); this is what runs on every
 * clone, in CI, and with no key.
 */
export function interpretRequest(
  question: string,
  layer: SemanticLayer,
  locale = "en",
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: INTERPRET_MODEL,
    max_tokens: INTERPRET_MAX_TOKENS,
    system: stablePrefix(layer, locale),
    output_config: {
      effort: INTERPRET_EFFORT,
      // One artifact, two surfaces: the schema the model is held to is the schema the
      // response is validated against.
      format: zodOutputFormat(ModelQuerySpecSchema),
    },
    // The question is the whole of `messages`, and there is no assistant turn: a prefill
    // returns 400 on Opus 5, and anything after the breakpoint is what varies per request.
    messages: [{ role: "user", content: question }],
  };
}

/** How many characters the cached prefix is, and the token estimate that follows from it. */
export function prefixSize(
  layer: SemanticLayer,
  locale = "en",
): { readonly characters: number; readonly estimatedTokens: number } {
  const characters = stablePrefix(layer, locale).reduce((total, block) => total + block.text.length, 0);
  return {
    characters,
    estimatedTokens: Math.floor(characters / CHARS_PER_TOKEN_ESTIMATE),
  };
}

/** Just enough of the SDK to make the call, so a test can stand in for it without a key. */
export type InterpretClient = {
  readonly messages: {
    parse: (
      params: Anthropic.MessageCreateParamsNonStreaming,
    ) => Promise<{ parsed_output?: unknown }>;
  };
};

/**
 * The live interpreter, over an injected client.
 *
 * **It returns a clarifying question; it does not throw one.** A model output naming an
 * undeclared measure reaches `resolveSpec` exactly as the fallback parser's output does,
 * and comes back as a `Rejection` that names the gap and offers questions that work
 * (invariant 4). The same is true of a response that produced no parseable spec at all:
 * an empty input resolves to a clarifying question rather than an exception, because
 * "the model returned nothing usable" is still not a reason to render an error page.
 *
 * A *transport* failure is deliberately not caught here. An outage is not a question the
 * layer could not answer, and rendering it as one would tell the user their question was
 * the problem. It propagates, and `app/api/ask/answer.ts` turns it into the 500 that
 * says the deployment is broken — which is the honest split between the two.
 */
export function createInterpreter(client: InterpretClient): Interpreter {
  return async (question: string, layer: SemanticLayer, locale = "en"): Promise<ResolveResult> => {
    const message = await client.messages.parse(interpretRequest(question, layer, locale));

    // `parsed_output` is null when the response could not be parsed against the schema.
    // An empty input is the honest thing to resolve: it names no measure, so the
    // clarifying question says so and offers the questions that do work.
    return resolveSpec((message.parsed_output ?? {}) as ResolveInput, layer, question);
  };
}

/**
 * The arm `route.ts` injects. Constructed only where a key is present — the SDK reads
 * `ANTHROPIC_API_KEY` from the environment itself, which is the same fact `aiMode()`
 * branched on.
 */
export function liveInterpreter(): Interpreter {
  return createInterpreter(new Anthropic() as unknown as InterpretClient);
}
