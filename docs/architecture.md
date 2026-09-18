# Golden Analytics — Architecture

Date: 2026-09-18
Status: Approved for planning

This document carries the technical decisions: the architecture and file layout, the
QuerySpec, the semantic layer format, the warehouse interface, the AI call structure,
the testing bar and the stack. The product argument — the problem, the wedge, the
thesis, the dataset and its verified traps, the interface, and what is out of scope —
lives in `docs/design.md` and does not belong here. The test: if it changes what is
built, it is architecture; if it changes what the user gets or why, it is design.

## 1. Architecture

### Scope bar

Feature scope is a demo: one dataset, no auth, no multi-tenancy, no pipeline.

**Architecture scope is production-shaped.** The distinction that matters is between
what production would *extend* (additive — fine to omit) and what it would *replace*
(a rewrite — not fine to omit). Three of the latter were caught in design review and
are fixed below:

1. **Guards are a declared registry**, not a hardcoded field. An earlier draft put
   `guards: { minRatingsPerTitle: number }` in the core type — a MovieLens-specific
   assumption sitting inside the portable contract. Pointed at sales data it is
   meaningless, and every adapter, validator and prompt would have to change.
2. **Conversation is spec amendment**, not single-shot. Real analysis is iterative
   ("now just EU", "by month instead"). Adding this later restructures the API
   contract, the UI state model and the prompt strategy simultaneously.
3. **The semantic layer is versioned data, not code.** The research named semantic
   model *production* as the real bottleneck. A layer only a developer can edit
   reinstates the human this product claims to remove.

Accessibility and locale-aware labelling are treated the same way and ship in v1 — see
`docs/design.md` section 7 for why neither is deferrable under this test.

Deferred as genuinely additive: UI translation and RTL layout; generic service
resilience (retry, backoff, circuit breaking); row-level security; correction
harvesting into a growing eval set; caching and pushdown past ~1M rows; conditional
execution of the naive/honest comparison; per-tenant cache namespacing; observability.

The CSVs stand in for real server-side data. The engine runs on the server behind a
swappable data-access interface, so replacing the local store with Postgres or
Snowflake is one implementation, not a rewrite.

```
question ──▶ [AI: interpret] ──▶ QuerySpec ──▶ [Zod validate against
                Claude,            (JSON)        semantic layer — reject
                effort: low,                     anything not declared]
                cached prefix]                            │
                                                          ▼
                                          [Engine: deterministic TypeScript]
                                          pure functions, no AI, unit-tested
                                                          │
                                                          ▼
                                          ResultSet + TrustReport
                                          (rows, excluded, coverage, naive
                                           comparison when it differs)
                                                          │
                                                          ▼
                                          [AI: narrate] ──▶ takeaway
                                          sees ~20 aggregated rows, never
                                          raw data, cannot invent a figure
```

A follow-up ("now just EU") takes the same path but the model emits a **SpecPatch**
against the previous spec rather than a fresh spec. The conversational unit of state is
the spec, not a transcript — cheaper than carrying chat history, and more verifiable,
because an amendment can be rendered as a diff the user reads before it applies.

### Layout

```
data/                         provided CSVs (source-of-truth stand-in)
design-system/                design foundations as static source — tokens + preview cards
scripts/build-warehouse.ts    ETL: CSV -> compiled store
semantic/movielens.json       THE SEMANTIC LAYER — versioned data, not code
src/
  server/
    contracts/                THE CORE CONTRACTS — a leaf module; see section 2
      ids.ts                    branded MeasureId / DimensionId / GuardId
      query-spec.ts             QuerySpec, ModelQuerySpec, Sort, Filter, GuardRef
      spec-patch.ts             SpecPatch
      result-set.ts             ResultSet, ResultRow, TrustReport, Provenance
      rejection.ts              Rejection
      answer.ts                 Answer discriminated union
      payload.ts                ReceivedPayload envelope
      semantic-layer.ts         the layer's schema
    warehouse/                DATA ACCESS LAYER (swappable)
      types.ts                  interface Warehouse { aggregate(spec) }
      local-store.ts            typed-array adapter
    semantic/
      load.ts                 parse + validate semantic/*.json
      guards/registry.ts      declared guard implementations
    engine/
      execute.ts              QuerySpec -> ResultSet (pure, deterministic)
      amend.ts                SpecPatch -> QuerySpec
    ai/
      interpret.ts            question -> QuerySpec (structured output)
      amend.ts                follow-up -> SpecPatch
      narrate.ts              ResultSet -> takeaway (streamed)
      fallback-parser.ts      deterministic, no-API-key path
  app/
    api/ask/route.ts
    page.tsx
  components/                 QuestionBox, AnswerCard, RecipeSentence,
                              Chart, NaiveComparison, ProvenanceDrawer
tests/
  contracts.test.ts           the core contracts hold their shape
  engine.test.ts
  conformance/                spec -> expected numbers; EVERY adapter must pass
  evals/questions.jsonl       question -> expected-spec pairs
```

## 2. The QuerySpec and the core contracts

The central artifact. Every safety property falls out of its shape.

```ts
type QuerySpec = {
  measure:    MeasureId
  breakdown?: DimensionId
  filters:    Filter[]
  sort:       { by: "measure" | "breakdown"; dir: "asc" | "desc"; tieBreak: DimensionId }
  limit:      number
  guards:     Array<{ id: GuardId; params: Record<string, number> }>
  asOf:       string | null        // ISO-8601 UTC; null = latest
}
```

`src/server/contracts/` is the shipped source of truth for this and for `SpecPatch`,
`ResultSet`, `Rejection`, `Answer`, the received-payload envelope and the semantic
layer's schema. Read the module, not a restatement of it; what follows is why it has the
shape it has.

Four deliberate properties:

- **Joins are not expressible.** There is no join field; relationships are declared once
  in the semantic layer. The most-cited text-to-SQL failure mode — wrong joins on
  multi-table queries — is eliminated by construction, not by prompting. The model
  cannot express the mistake.
- **One measure, one breakdown** in v1. Narrow IRs are easy to validate, easy to render,
  and easy to state as a sentence. Breadth buys question coverage at the cost of every
  property we care about; anything unexpressible becomes an honest clarifying question.
- **Guards are declared, not hardcoded.** `GuardId` resolves against the registry the
  semantic layer declares, exactly like measures. Nothing dataset-specific lives in the
  type.
- **Guards live in the spec, not hidden in the engine** — which makes the hero moment
  generic rather than special-cased:

```ts
const honest = execute({ ...spec })
const naive  = execute({ ...spec, guards: [] })
if (materiallyDifferent(naive, honest)) showComparison(naive, honest)
```

Same engine, run twice, diff the output. We never hardcode "watch out for the 5.0
problem" — the comparison emerges from any question where a guard changes the answer.

### `contracts/` is a module of its own

The spec is read by the warehouse, the engine, the AI layer, the route *and* the client.
Defining it beside the `Warehouse` interface would make the engine import from the
warehouse — inverting the dependency, since the warehouse *consumes* the spec and does
not own it. `warehouse/types.ts` keeps the `Warehouse` interface itself, which
legitimately depends on both.

So `contracts/` is a leaf: it imports `zod` and its own siblings, and nothing else — not
`node:*`, not `next/*`, and nothing under `warehouse/`, `engine/` or `ai/`. That is what
lets the client import it without dragging the server in.

### Strictness is what makes "no joins" structural

Every schema is `z.strictObject()` — Zod 4's API; `.strict()` is the v3 form and is
banned from this module, because it still works through the compatibility surface and so
would not fail loudly. Without strictness, "joins are not expressible" is true of the
*type* but not of the *validator*: a model emitting `{"joins": [...]}` would parse, the
field would be ignored, and the design's strongest claim would rest on nothing reading it
rather than on nothing accepting it.

`strictObject` sets the catchall to `never()`, and an undeclared key raises an
`unrecognized_keys` issue. That issue carries `continue: true`, so parsing does not abort
— but the issue is still collected, so `safeParse` returns `success: false`. Worth
stating precisely, because "continue" reads like leniency in the source and is not. The
contracts suite asserts on the issue code rather than on a throw, for that reason.

`ModelQuerySpecSchema` — what the model may emit — is *derived* from `QuerySpecSchema`
through `.omit().extend()` rather than written twice. Whether that derivation preserves
the `never()` catchall is an implementation detail of Zod that a minor release could
change, so it is a test, not an assumption.

### `tieBreak` is required, not optional

An optional tie-break is no tie-break: an adapter may legitimately omit it, and the
296-way tie at 5.00 then resolves differently again. Four reasonable implementations were
measured producing three different answers, so this field is the difference between
invariant 10 being provable and not. The model never chooses it — `ModelQuerySpec` omits
it, and `resolveSpec()` fills it from the layer's declared default before validation.

### `asOf` is nullable on the spec and never null in provenance

`null` means "latest", which only the engine can resolve; `Provenance.resolvedAsOf`
records what "latest" meant. Spec-only fails, because a conformance case pinned at
"latest" expires the moment the next payload lands. Provenance-only fails, because you
can then *explain* a past answer but not *re-run* it — and re-running is exactly what the
conformance suite does. The pairing is the design: the spec asks, the provenance records
what it got.

### Two limits, not one

`MAX_LIMIT = 120` bounds what the client and the chart receive. It is grounded in
measured dimension cardinality rather than rounded to a pleasant number: genre 19,
release decade 12, rating year 23, release year 106, title 9,742. The largest declared
non-title dimension is release year at 106 members, so 120 leaves a year breakdown
expressible with headroom. The measurement travels with the constant, in a comment on it,
or 120 reads as a round number and the next person rounds it differently.

`NARRATE_ROW_CAP = 20` bounds what the narrate call receives. Collapsing the two into one
number means either a year breakdown is inexpressible or the narrate call sees more than
~20 rows, so they stay separate: they serve different invariants.

### A `SpecPatch`'s absent `reAsOf` is not a null one

A follow-up emits a patch against the previous spec — a closed set of operations, not a
deep partial, so each one renders as a line in a diff the user reads before it applies.
`reAsOf` absent means *inherit the parent's `resolvedAsOf`*: "now just EU" interrogates
the same snapshot. `reAsOf: null` means *re-resolve to latest*, which is deliberate time
travel the user asked for. The field is `.optional()` rather than defaulted precisely so
that `"reAsOf" in patch` stays a real discriminator through parsing.

### `Rejection` is a returned value, and `Answer` is a union

Invariant 4's whole mechanism is that anything undeclared becomes a clarifying question.
A throw gets caught somewhere generic and rendered as an error; a returned object is
rendered as the clarifying question that *is* the product working. Showcasing refusal
later is then a rendering change rather than rebuilding the path.

`Answer` is a discriminated union on `ok`, so there is no shape that omits rejection and
every caller has to handle both paths — enforced at compile time by an exhaustiveness
check, not by convention.

## 3. Semantic layer

Declared as **versioned JSON** (`semantic/movielens.json`), loaded and validated at
boot. Generating, editing or reviewing it is a normal operation, not a code change.

Every entry's display name and synonyms are **keyed by locale**. This is structural,
not a feature: the recipe sentence is *composed* from these labels, and synonyms are how
a question is matched to a measure — so natural-language understanding is itself
locale-dependent. A flat label shape would make internationalisation a schema rewrite
plus a prompt rewrite plus a matching rewrite. The nesting level costs nothing now.

```json
{
  "measures": [{
    "id": "avg_rating",
    "labels":   { "en": "average rating", "vi": "điểm đánh giá trung bình" },
    "synonyms": { "en": ["avg rating", "rating", "how well rated"],
                  "vi": ["điểm trung bình"] }
  }]
}
```

v1 ships `en` only. Adding a locale becomes a data change.

- **Measures** — average rating, number of ratings, number of viewers, number of
  titles, share rated 4+
- **Dimensions** — genre, release decade, release year, rating year, title
- **Filters** — minimum ratings per title, release period, rating period, genre,
  viewer segment
- **Guards** — see below; declared here, implemented in the registry

The model may select only from this set. Anything outside it is **rejected and turned
into a clarifying question — never coerced to the nearest match.** Silent coercion is
how you get a plausible answer to a question nobody asked. That rejection path is what
makes "the AI never computes the number" structurally true rather than a promise.

## 4. Trust guard declaration

Declared in the semantic layer, implemented in `guards/registry.ts`. The guards
themselves, their defaults and the verified rationale for each are in
`docs/design.md` section 5.

## 5. Warehouse interface

The boundary sits at **aggregation, not rows**:

```ts
interface Warehouse {
  aggregate(spec: QuerySpec): Promise<ResultSet>
}
```

The QuerySpec is the portable IR. The local adapter loops over typed arrays; a future
Postgres or Snowflake adapter compiles the same spec to SQL and pushes the work down.
The alternative — streaming rows out and aggregating in the app — is simpler but does
not survive production, since a real warehouse adapter would have to pull every row
over the wire.

The cost is that determinism now depends on each adapter behaving identically. That is
answered by the **conformance suite**: one set of spec → expected-numbers cases that
every adapter must pass. It converts the weakness into the artifact that proves the
central claim.

## 6. AI usage

`@anthropic-ai/sdk` on `claude-opus-5`.

**Call 1 — interpret.** Structured outputs via `output_config.format`. Note the
`output_format` parameter is deprecated and assistant prefill returns 400 on Opus 5, so
structured outputs is the only correct route. `output_config.effort: "low"` —
interpretation is extraction-shaped, not reasoning-heavy. Zod-validated against the
semantic layer before execution.

**Call 2 — narrate.** Streamed. Receives the computed aggregate (~20 rows) plus the
trust report. Never the raw data.

**Prompt caching** on the stable prefix (semantic layer + few-shot examples), user
question last. Roughly 2k in / 200 out per question (~$0.015 uncached); caching cuts
that substantially and improves latency.

**No API key** — the deterministic fallback parser covers the starter questions, so the
app runs on a clean clone.

## 7. Locale-keyed labels and `Intl` formatting

The structural half of internationalisation, which ships in v1. Why it is split this
way, and what is deferred, is in `docs/design.md` section 7.

- **Structural (v1)** — locale-keyed labels and synonyms in the semantic layer
  (section 3); `Intl.NumberFormat` and `Intl.DateTimeFormat` for all numeric and date
  output, since a decimal comma versus a decimal point changes whether 4,47 reads as a
  rating or a count; the narrate call takes locale as a parameter.

## 8. Error handling: the fallback path

What the user is shown for each error case is in `docs/design.md` section 8.

- **AI unavailable** → fallback parser; the app degrades, it does not break.

## 9. Testing

- **Contract tests** over `contracts/`. No data and no network: that a spec carrying
  `joins` is rejected, on the executable schema *and* on the derived model schema; that
  `limit` is bounded; that `tieBreak` is required on one surface and absent from the
  other; that a null `resolvedAsOf` is unconstructible; that a `SpecPatch`'s absent
  `reAsOf` survives parsing as absent; that `Answer` is exhaustive; that a validation
  error points at the offending path; and that the model schema converts to a JSON
  Schema for structured outputs. The last one catches at increment one any Zod construct
  that does not survive that conversion, rather than seven increments later.
- **Vitest** over the engine. Pure functions, so the determinism claim is provable
  rather than asserted: same spec always yields the same numbers.
- **Guard tests** pinned to the verified figures in `docs/design.md` section 4 (296,
  8,427, 34, 18, 2.27). These double as regression tests on the ETL.
- **Conformance suite** — spec → expected-numbers cases that every `Warehouse` adapter
  must pass. This is what makes the determinism claim survive a second adapter, and it
  is the artifact that proves the product's central promise.
- **Eval set** of question → expected-spec pairs, including amendment cases
  (spec + follow-up → expected patch). Anthropic's reported lesson was that evals, not
  model choice, drove accuracy.
- **Rejection tests** — questions the semantic layer cannot answer must produce a
  clarifying question, never a coerced near-match.
- **Accessibility checks** — automated axe pass on the main flow, plus a manual
  keyboard-only run through ask → amend → open provenance drawer. The data table
  behind each chart is asserted present and reachable.

## 10. Stack

Next.js 16.3.5 (App Router, TypeScript) · `@anthropic-ai/sdk` 0.127.0 ·
Observable Plot 0.6.17 · shadcn/ui on Tailwind v4 and Radix · Zod · Vitest ·
Vercel-ready.

Note: Next 16 removed synchronous access to `params`, `searchParams`, `cookies` and
`headers` — all are async-only.

**Versions are pinned exactly, not by range**, so a clean clone resolves what was
verified: React 19.2.8 (the version the shadcn verification below ran against, and what
`create-next-app@16.3.5` itself pins), TypeScript 5.9.3, Vitest 5.0.1. The one range is
`zod@^4`, because the SDK's structured-output helper imports `zod/v4` and the two must
dedupe onto one copy. TypeScript 7.0.2 was `latest` at scaffold time and both
`tsc --noEmit` and `next build` pass on it, but Next 16.3.5's own template ships
`typescript: ^5`, so the framework-tested line is what we run on.

**shadcn/ui is the component library and the styling approach.** Tailwind carries the
visual language, Radix primitives carry the interactive behaviour, and the shadcn CLI
copies each component into the repository as source rather than adding a runtime
dependency. The components then live where they can be read and audited — the same
instinct as a semantic layer that is data rather than code, and a recipe that is a
sentence rather than a formula. The accessibility `docs/design.md` §7 commits v1 to
comes from Radix: focus management in the provenance drawer and WAI-ARIA keyboard
behaviour in the tappable-phrase popovers are exactly where hand-written
implementations fail. Theming is CSS variables, so the approved look becomes the theme
rather than something fought against, and the tooling has right-to-left support, which
is a head start on the internationalisation `docs/design.md` §7 defers but does not
block.

Two conditions hold with it. **Each component is earned**: one is added when a screen
actually needs it, mirroring the thinnest-viable rule the semantic layer already
follows — the ask surface needs roughly six, not a catalogue. **The approved look wins,
not the defaults**: shadcn ships a neutral house style, and the mock's soft surfaces,
generous whitespace and one confident accent are applied deliberately as the theme.
That same theme populates the golden-analytics design-system project.

Verified on Next 16.3.5, not assumed. A throwaway App Router scaffold at Next 16.3.5
with React 19.2.8 and Tailwind 4.3.3 took `shadcn` CLI 4.21.0 init against the Radix
base, then badge, card, popover, dropdown menu, dialog, drawer, table, textarea and
button — pulling `radix-ui` 1.6.7, `vaul` 1.1.2 and `lucide-react` 1.47.0. The
production build, TypeScript and `eslint-config-next` all pass, and in a headless
browser the popover reports `aria-expanded`, the menu opens from the keyboard onto a
`menuitem`, the dialog traps focus and returns it to its trigger on Escape, the drawer
opens as a `dialog` and closes on Escape, and the table renders as a real `<table>`,
with no console or page errors. Two notes: the CLI requires an explicit preset
(`init -b radix -p nova`) because `--yes` alone still prompts, and `--base-color` is
gone in 4.x; and the drawer does not move focus into its content on open, so the
provenance drawer must give itself a focusable first element.

**Rejected: DuckDB-WASM.** 142 MB unpacked for a 100,836-row dataset, and shipping a
SQL engine to display SQL a non-technical user cannot read contradicts the thesis.
