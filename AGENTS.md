<!-- firstmate:maintained-by-project -->

# Golden Analytics — agent contract

AI-native analytics for non-technical business users. The wedge is not query
accuracy; it is catching the confident wrong answer that the user cannot audit.

Authoritative sources, in this order:

- `docs/design.md` — the approved product argument: the problem, the wedge, the
  thesis, the dataset, the interface, what is out of scope.
- `docs/architecture.md` — the approved technical decisions: architecture and file
  layout, the QuerySpec, the semantic layer, the warehouse interface, AI usage,
  testing, the stack.
- `docs/market-research.md` — the evidence the design rests on.
- This file — the invariants an agent must not break, and the decisions already
  settled so they are not relitigated or silently reversed.
- `docs/how-this-was-built.md` — the running record of how each decision was
  reached, and the method that produced it. Not authoritative over the design;
  it is how the design got here.
- `docs/build-spec.md` — the v1 build plan the sixteen increments came from. A
  *consumed* document, not a live contract: each landed increment turns a piece of
  it into history, and the code wins where the two disagree.

If code and the docs disagree, the doc wins until the doc is changed. A change lands
in the doc first, with its rationale, then in code — and in the right doc: technical
decisions belong in `docs/architecture.md`, product decisions in `docs/design.md`. The
test is whether it changes what is built, or what the user gets and why. Section
citations below name their document: `design §4`, `architecture §2`.

## Prime invariants

Breaking any of these is a design change, not an implementation detail. Stop and
raise it rather than working around it.

1. **AI interprets; it never computes.** The model turns a question into a
   `QuerySpec`, and narrates a computed result. Every number comes from the
   deterministic engine. No figure may originate in a model response.
2. **Narration never sees raw data.** The narrate call receives the aggregated
   result (~20 rows) plus the trust report, so it cannot invent a figure.
3. **The recipe is read, never authored.** The system produces the complete
   recipe; the user confirms or nudges it through closed lists of plain-English
   options. No free text, no formulas, no blank builder — the zero state is
   starter questions.
4. **Nothing undeclared is coerced.** Anything outside the semantic layer becomes
   a clarifying question, never a nearest match. Silent coercion is the failure
   mode this product exists to remove.
5. **Trust is shown, not claimed.** Copy says what was checked. Never the word
   "verified" — the verification is real but partial (design §3), and overclaiming it
   reproduces the silent failure we criticise.
6. **Guards are declared data, not hardcoded logic.** `GuardId` resolves against
   the registry the semantic layer declares. Nothing dataset-specific belongs in
   the core types, the engine, or the prompt.
7. **The semantic layer is versioned JSON, not code.** Editing or reviewing it is
   a normal operation. A layer only a developer can edit reinstates the human the
   product removes.
8. **Labels and synonyms are locale-keyed** (architecture §3). Synonyms are how
   questions match measures, so understanding is locale-dependent. v1 ships `en`
   only; adding a locale stays a data change.
9. **The warehouse boundary is aggregation, not rows**: `aggregate(spec)`. A real
   adapter pushes the work down; it never streams rows to the app.
10. **Determinism is proved, not asserted.** The conformance suite (spec →
    expected numbers) is the artifact behind the central claim, and every
    `Warehouse` adapter must pass it.
11. **Accessibility ships in v1** (design §7). WCAG 2.1 AA, full keyboard
    operation, a reachable semantic `<table>` behind every chart, no meaning
    carried by colour alone. The takeaway and recipe sentence *are* the
    accessible chart.
12. **All numeric and date output goes through `Intl`.** A decimal comma changes
    whether 4,47 reads as a rating or a count.
13. **The app runs on a clean clone with no API key** via the deterministic
    fallback parser. It degrades; it does not break.
14. **Each shadcn component is earned** (architecture §10). One is added when a
    screen actually needs it — the same thinnest-viable rule the semantic layer
    follows. Never install the catalogue, and never let the shipped defaults stand
    in for the approved look; the theme is the approved look.

## The QuerySpec

The central artifact (architecture §2). Every safety property falls out of its shape.

- **No join field exists.** Relationships are declared once in the semantic layer,
  so the most-cited text-to-SQL failure is eliminated by construction.
- **One measure, one breakdown** in v1. Narrow IRs validate, render and verbalise
  cleanly; anything unexpressible becomes a clarifying question.
- **Guards live in the spec**, which is what makes the naive/honest comparison
  generic: run the same spec twice, once with `guards: []`, and diff. Never
  special-case a dataset quirk.
- **A follow-up emits a `SpecPatch`** against the previous spec. The unit of
  conversational state is the spec, not a transcript — cheaper, and an amendment
  can be rendered as a diff the user reads before it applies.

## Settled decisions — do not resurrect without a design change

| Rejected | Why |
| --- | --- |
| DuckDB-WASM | 142 MB for a 100,836-row dataset, and shipping a SQL engine to show SQL the user cannot read contradicts the thesis |
| A ratings-drift-over-time guard | Not supported by the data: yearly means oscillate 3.31–3.88 with no trend |
| "Canva for data" positioning | Taken by Bricks; a north star, not a wedge |
| "An answer you can defend" | Sells the absence of a bad thing to a user who has never been burned; answers step 2 while she is at step 1 |
| `guards: { minRatingsPerTitle }` in the core type | A MovieLens assumption inside the portable contract |
| React Aria in place of Radix | Stronger locale and screen-reader coverage, but a steeper API for the same six components |
| A full styled kit (MUI, Chakra) | Imposes its own visual language against the approved mock |
| Hand-rolling every primitive | Smallest dependency surface, but dialog and popover focus management is exactly where hand-rolled accessibility fails |
| Single-shot question answering | Amendment added later restructures API, UI state and prompts at once |
| Semantic layer as code | Reinstates the developer in the loop |
| Streaming rows out, aggregating in the app | Does not survive a real warehouse |
| A chat transcript in the side column | architecture §2 makes the spec, not a message history, the unit of conversational state, and a transcript leaves the naive/honest catch with no inline home; the column holds saved, re-runnable recipes |
| A question box as the centre of the interface | It is the commoditised part every tool in `market-research.md` already has, and a blank box is the blank builder design §6 rejects |
| A silent no-API-key mode | Lets the user read a template summary as a narration |
| A persistent no-API-key banner | Keeps charging for a fact already taken in; a one-time inline note on the first degraded answer instead |
| `output_format` / assistant prefill | Deprecated; prefill returns 400 on Opus 5. Use structured outputs via `output_config.format` |
| Rounding half up, or letting the formatter round | *A Streetcar Named Desire* averages **exactly 4.475** — a true midpoint. `Math.round` and `Intl` give 4.48; `toFixed` and `Math.round(v*100)` give 4.47. The engine rounds **half toward zero** at the presentation scale, so the pinned 4.47 is arithmetic, not an accident of the formatter (architecture §5a) |
| Ordering on the rounded value | Three titles display 4.44 at the 2007 replay; only the exact rational ranks them as the build spec states, and it is what `ORDER BY AVG(...)` does |
| `localeCompare` for ordering | Depends on the runtime's ICU build; disagrees with code-unit order at the very first shipped title |
| A `takeaway: string` field on the answer | A field-to-stream change is a change of *response kind* — content type, the client's fetch handling, component state, every test — so GA-09 would rewrite four surfaces. Narration streams from GA-07's first commit; the answer object holds only the slot, `{ producer, locale }` (architecture §6a) |
| Server-Sent Events for the answer stream | The question travels in a body, so this is a POST and `EventSource` is GET-only — a client uses `fetch` and a reader either way. Its reconnect semantics would resume a stream whose provenance says otherwise. NDJSON, fixed frame order: `answer`, narration deltas, `end` |
| A 4xx for a question the layer cannot answer | It was processed; the clarifying question *is* the answer. A status code cannot carry `nearest`, so GA-11's showcase of refusal would be a rebuild rather than a rendering. Refusals are 200; a malformed body is 400 and a broken deployment is 500 |

Out of scope for v1 (design §9): auth, multi-dataset upload, a visual chart editor,
write-back, recommender modelling, dashboards or saved reports, and any real
warehouse connection — the interface exists so one can be added; no adapter ships.

Deferred but genuinely additive (architecture §1): UI translation and RTL, generic
service resilience, row-level security, correction harvesting into the eval set,
caching and pushdown past ~1M rows, per-tenant cache namespacing, observability.

## The running record

Every increment records its decisions in `docs/how-this-was-built.md` as it
lands, in the same commit as the work — what was decided, the evidence, what was
rejected, and what deciding it later would have cost. The table above is the
contract; that document is the history behind it, and it is where a measured
finding that contradicted the plan gets written down.

A journal reconstructed at the end is a summary. One written as the work lands is
evidence, so do not defer it to the last increment.

## Data and pinned figures

MovieLens `ml-latest-small` (GroupLens, 2018-09-26) in `data/`: 9,742 movies,
100,836 ratings, 3,683 tags, 610 users, Mar 1996 – Sep 2018. Four CSVs join on
`movieId`; `userId` is consistent across `ratings` and `tags`.

These were measured, not assumed, and are pinned as guard tests — they double as
regression tests on the ETL. Changing one means the ETL changed; investigate
before updating the expectation.

**A figure without its definition is not a pinned figure.** Each is asserted in
`tests/pinned-figures.test.ts` with its definition, its guards in effect — none, and
asserted to be none — and its as-of (`2018-09-26T00:00:00.000Z`, the delivery's
`receivedAt`).

| Figure | Value | Definition that makes it reproducible |
| --- | --- | --- |
| Titles averaging a perfect 5.0 | 296 (every one ≤2 ratings) | mean of every rating at or before the as-of, exactly 5.00 |
| Rated titles with <20 ratings | 8,427 of 9,724 (86.7%) | of titles with ≥1 rating; 20 is the figure measured, not a filter applied |
| Titles with zero ratings | 18 | declared titles with no rating at the as-of |
| `(no genres listed)` | 34 | the marker resolves to **zero** genres, never a twentieth genre |
| Genre assignments per movie | **2.27** *and* **2.26** | 22,050 assignments over the 9,708 categorised titles (`exclude_uncategorised` on) and over all 9,742 (off). Both are pinned: the off reading is what the natural implementation writes, and a team pinning only 2.27 reads 2.26 as a day-one regression |
| Genre cardinality | **19**, against **38** naive | 38 is what an unstripped (CRLF) parse yields. `IMAX` is always last in its row, so under that parse it stops existing under its own name and a genre breakdown loses it silently |
| Titles with no parseable year | 13 | four digits in parentheses at the very end of the delivered title. `Death Note: Desu nôto (2006–2007)` is a year *range* and is refused, not filed under 2006 |

The hero moment (design §4) is `"What are our top rated titles?"`: 296 titles tied at
5.00 naively, versus *A Streetcar Named Desire* 4.47 (n=20) and *The Shawshank
Redemption* 4.43 (n=317) honestly. Keep it real, never contrived. 4.47 is **20 ratings
summing to 8,950 hundredths — a mean of exactly 4.475**, rounded half toward zero; the
ordering rule is `<measure> <dir>, <tieBreak> ASC, <memberId> ASC`, and `title` alone does
not complete it because five title strings are each shared by two `movieId`s.

## Layout and stack

Layout is fixed in architecture §1 — `semantic/` holds the layer as data,
`src/server/` splits `contracts/` (a leaf), `ingest/` (payload → store),
`warehouse/` (swappable), `semantic/`, `engine/` (pure) and `ai/`, and `tests/`
carries `contracts.test.ts`, `pinned-figures.test.ts`, `semantic.test.ts`,
`engine.test.ts`, `rejection.test.ts`, `ask-route.test.ts`, `ai/`, `conformance/` and
`evals/` (`questions.jsonl`, `baseline.json`, `harness.test.ts`). `src/app/api/ask/` splits
`route.ts` (the composition root: disk reads, process singletons, `POST`) from `answer.ts`
(assembly, status codes, frame order, the stream), so the whole HTTP surface is testable
with an injected warehouse — no compiled `.store/`, no server.

`npm run ingest` compiles the received payload into `.store/` — a build artifact,
never committed. It runs on Node's native TypeScript stripping, so every relative
import under `scripts/` and `src/server/ingest/` carries an explicit `.ts`
extension and `erasableSyntaxOnly` is on project-wide (architecture §10).

`npm run eval` scores `tests/evals/questions.jsonl` against the committed baseline.
**It compares specs, never prose, so it never calls a model and needs no key** — that
is what lets the layer acquire structure in CI and on a clean clone. A failing eval
must name the missing structure, not report a mismatch; a synonym is added only when a
named case demanded it, and `tests/evals/harness.test.ts` asserts every declared
synonym is load-bearing by removing it and requiring the score to fall. It runs on the
same native stripping through `scripts/module-alias.mjs`, which gives Node the `@/`
alias and extensionless resolution `tsconfig.json` and `vitest.config.ts` declare.

`src/server/contracts/` is where every shared type lives, and it stays a leaf: it
imports `zod` and its own siblings, nothing else — not `node:*`, not `next/*`, and
nothing under `warehouse/`, `engine/` or `ai/`, because the client imports it too.
Every schema in it is `z.strictObject()`; `.strict()` is Zod 3's form and still works
through the v4 compatibility surface, so it fails silently rather than loudly and is
banned from the module.

Next.js 16.3.5 (App Router, TypeScript) · `@anthropic-ai/sdk` 0.127.0 on
`claude-opus-5` · Observable Plot 0.6.17 · Zod · Vitest · Vercel-ready.

Next 16 removed synchronous access to `params`, `searchParams`, `cookies` and
`headers`; all are async-only. **This is not the Next 16 a model was trained
on** — `node_modules/next/dist/docs/` is the version-accurate reference. `next.config.ts`
sets `agentRules: false`, because `next dev` otherwise appends a generated block to *this
file* on every start; a contract whose authority rests on being deliberate cannot be partly
automatic (architecture §10).

Interpretation runs at `output_config.effort: "low"` — it is extraction-shaped,
not reasoning-heavy. Prompt caching sits on the stable prefix (semantic layer plus
few-shot examples) with the user question last.

**The 512-token cache floor is why two things that look like preferences are not.**
Opus 5 does not cache a prefix below it, and falling under it fails silently — no
error, just every question paying uncached cost. So `semantic/movielens.json` stays
pretty-printed (measured: 2,157 bytes against 1,568 minified; ~540 tokens against
~390, so the whitespace is what clears the floor), and GA-08's few-shot block is
never trimmed for cost. Trimming either one *raises* the bill.

## Testing bar

Vitest over the engine, the pinned guard figures above, the conformance suite,
an eval set of question → expected-spec pairs including amendment cases,
rejection tests proving undeclared questions produce a clarifying question, and
an automated axe pass plus a manual keyboard-only run through ask → amend →
provenance drawer.

## README requirements

The README must cover the dataset in use, why this was built, how AI was used to
build it, and what would come next with more time.
