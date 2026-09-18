# Golden Analytics — agent contract

AI-native analytics for non-technical business users. The wedge is not query
accuracy; it is catching the confident wrong answer that the user cannot audit.

Authoritative sources, in this order:

- `docs/design.md` — the approved design. Section numbers referenced below are its.
- `docs/market-research.md` — the evidence the design rests on.
- This file — the invariants an agent must not break, and the decisions already
  settled so they are not relitigated or silently reversed.

If code and `docs/design.md` disagree, the doc wins until the doc is changed.
A design change lands in `docs/design.md` first, with its rationale, then in code.

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
   "verified" — the verification is real but partial (§3), and overclaiming it
   reproduces the silent failure we criticise.
6. **Guards are declared data, not hardcoded logic.** `GuardId` resolves against
   the registry the semantic layer declares. Nothing dataset-specific belongs in
   the core types, the engine, or the prompt.
7. **The semantic layer is versioned JSON, not code.** Editing or reviewing it is
   a normal operation. A layer only a developer can edit reinstates the human the
   product removes.
8. **Labels and synonyms are locale-keyed** (§7). Synonyms are how questions match
   measures, so understanding is locale-dependent. v1 ships `en` only; adding a
   locale stays a data change.
9. **The warehouse boundary is aggregation, not rows**: `aggregate(spec)`. A real
   adapter pushes the work down; it never streams rows to the app.
10. **Determinism is proved, not asserted.** The conformance suite (spec →
    expected numbers) is the artifact behind the central claim, and every
    `Warehouse` adapter must pass it.
11. **Accessibility ships in v1** (§12). WCAG 2.1 AA, full keyboard operation, a
    reachable semantic `<table>` behind every chart, no meaning carried by colour
    alone. The takeaway and recipe sentence *are* the accessible chart.
12. **All numeric and date output goes through `Intl`.** A decimal comma changes
    whether 4,47 reads as a rating or a count.
13. **The app runs on a clean clone with no API key** via the deterministic
    fallback parser. It degrades; it does not break.
14. **Each shadcn component is earned** (§15). One is added when a screen actually
    needs it — the same thinnest-viable rule the semantic layer follows. Never
    install the catalogue, and never let the shipped defaults stand in for the
    approved look; the theme is the approved look.

## The QuerySpec

The central artifact (§6). Every safety property falls out of its shape.

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
| A chat transcript in the side column | §6 makes the spec, not a message history, the unit of conversational state, and a transcript leaves the naive/honest catch with no inline home; the column holds saved, re-runnable recipes |
| A question box as the centre of the interface | It is the commoditised part every tool in `market-research.md` already has, and a blank box is the blank builder §11 rejects |
| A silent no-API-key mode | Lets the user read a template summary as a narration |
| A persistent no-API-key banner | Keeps charging for a fact already taken in; a one-time inline note on the first degraded answer instead |
| `output_format` / assistant prefill | Deprecated; prefill returns 400 on Opus 5. Use structured outputs via `output_config.format` |

Out of scope for v1 (§16): auth, multi-dataset upload, a visual chart editor,
write-back, recommender modelling, dashboards or saved reports, and any real
warehouse connection — the interface exists so one can be added; no adapter ships.

Deferred but genuinely additive (§5): UI translation and RTL, generic service
resilience, row-level security, correction harvesting into the eval set, caching
and pushdown past ~1M rows, per-tenant cache namespacing, observability.

## Data and pinned figures

MovieLens `ml-latest-small` (GroupLens, 2018-09-26) in `data/`: 9,742 movies,
100,836 ratings, 3,683 tags, 610 users, Mar 1996 – Sep 2018. Four CSVs join on
`movieId`; `userId` is consistent across `ratings` and `tags`.

These were measured, not assumed, and are pinned as guard tests — they double as
regression tests on the ETL. Changing one means the ETL changed; investigate
before updating the expectation.

| Figure | Value |
| --- | --- |
| Titles averaging a perfect 5.0 | 296 (every one ≤2 ratings) |
| Rated titles with <20 ratings | 8,427 of 9,724 (86.7%) |
| Titles with zero ratings | 18 |
| `(no genres listed)` | 34 |
| Genre assignments per movie | 2.27 average |
| Titles with no parseable year | 13 |

The hero moment (§4) is `"What are our top rated titles?"`: 296 titles tied at
5.00 naively, versus *A Streetcar Named Desire* 4.47 (n=20) and *The Shawshank
Redemption* 4.43 (n=317) honestly. Keep it real, never contrived.

## Layout and stack

Layout is fixed in §5 — `semantic/` holds the layer as data, `src/server/`
splits `warehouse/` (swappable), `semantic/`, `engine/` (pure) and `ai/`, and
`tests/` carries `engine.test.ts`, `conformance/` and `evals/questions.jsonl`.

Next.js 16.3.5 (App Router, TypeScript) · `@anthropic-ai/sdk` 0.127.0 on
`claude-opus-5` · Observable Plot 0.6.17 · Zod · Vitest · Vercel-ready.

Next 16 removed synchronous access to `params`, `searchParams`, `cookies` and
`headers`; all are async-only.

Interpretation runs at `output_config.effort: "low"` — it is extraction-shaped,
not reasoning-heavy. Prompt caching sits on the stable prefix (semantic layer plus
few-shot examples) with the user question last.

## Testing bar

Vitest over the engine, the pinned guard figures above, the conformance suite,
an eval set of question → expected-spec pairs including amendment cases,
rejection tests proving undeclared questions produce a clarifying question, and
an automated axe pass plus a manual keyboard-only run through ask → amend →
provenance drawer.

## README requirements

The README must cover the dataset in use, why this was built, how AI was used to
build it, and what would come next with more time.
