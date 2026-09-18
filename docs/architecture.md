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
data/                         the held payload, as four CSVs
design-system/                design foundations as static source — tokens + preview cards
scripts/ingest-payload.ts     `npm run ingest`: received payload -> compiled store
semantic/movielens.json       THE SEMANTIC LAYER — versioned data, not code
.store/                       the compiled store — a build artifact, never committed
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
    ingest/                   RECEIVED PAYLOAD -> STORE; see section 2a
      payload.ts                the payload body, composed onto the envelope
      csv.ts                    CRLF-aware, quoted-field-safe reader
      read-payload.ts           the four CSVs read as one received payload
      build-store.ts            payload -> append-only log + derived indexes
      store.ts                  the store's shape, and its binary read/write
    warehouse/                DATA ACCESS LAYER (swappable)
      types.ts                  interface Warehouse { aggregate(spec) }
      local-store.ts            typed-array adapter
    semantic/
      load.ts                 parse + validate semantic/*.json, fail fast
      guards/registry.ts      the four declared guards; no thresholds
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
  pinned-figures.test.ts      the pinned figures, as regression tests on the ETL
  semantic.test.ts            the layer loads, and a broken one does not
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

## 2a. The received payload and the store

Landed by GA-02. Section 2 is the shape a question travels in; this is the shape the
data arrives and rests in.

### The payload is an envelope plus a body, and only the envelope is portable

Applications push data in over a webhook or API; the held dataset is one such delivery,
and the receiver is not built for the demo (`docs/how-this-was-built.md` entry 10). That
decision has a shape:

- **`contracts/payload.ts` carries the envelope** — `sourceId`, `payloadId`,
  `schemaVersion`, `receivedAt`. It is an integration contract and names no dataset
  (invariant 6).
- **`ingest/payload.ts` carries the body** — titles, ratings, tags — because the body is
  *this* integration's shape and naming its entities is correct out there and forbidden
  in `contracts/`.
- **`ingest/read-payload.ts` reads from disk what a receiver would read from a request
  body**, and validates it at that boundary. A live receiver replaces that one function;
  nothing downstream of `ReceivedPayloadSchema` moves.

The envelope is fixed rather than generated. A `receivedAt` of `Date.now()` would give
the store a different as-of point on every run, and the pinned figures would stop being
regression tests.

### The store is an append-only log with derived indexes

A record, once written, is never touched again. This is what makes `asOf` answerable at
all: a past as-of is a prefix of the event-time index, not a different store, so
`Provenance.resolvedAsOf` names something re-runnable rather than something merely
explainable. Retrofitting immutability is a storage rewrite, not a field addition, which
is why it lands before anything reads the store.

Two consequences carry their weight:

- **Records live in arrival order; ordering is an index.** `ratings.byEventTime` is a
  permutation of log positions sorted by `(at, position)`. A late-arriving event —
  earlier in event time than events already written — appends at the end of the log and
  lands in the middle of the index. Nothing already written moves, and the property is
  asserted rather than intended (`tests/pinned-figures.test.ts`).
- **A replayed `payloadId` is recognised, not re-applied**, so `npm run ingest` is
  idempotent and a redelivery cannot double the log.

A title redeclared with different content is **refused**, not merged. Corrections are a
feature this store does not have, and silently keeping either version is the coercion
invariant 4 exists to prevent.

### Time is unix seconds inside the store and ISO-8601 UTC everywhere else

Settled by GA-02, and formerly an open implementer choice. ISO-8601 UTC on the spec, in
provenance and in the manifest, because it is diffable and pasteable into the shareable
artifact; unix seconds in the columns, where the comparison happens. `isoToUnixSeconds`
and `unixSecondsToIso` are the only crossing points.

The store carries **two timestamps and they are different facts**: `asOf` is the latest
delivery's `receivedAt` — when the data arrived — and `lastEventAt` is the latest event
in the log. For the held payload they are 2018-09-26 and 2018-09-24T14:27:30Z. Collapsing
them would make "as of when?" unanswerable the first time a payload arrives late.

### Every measure is a scaled integer, and the scale is declared

Ratings are stored as hundredths in an `Int16Array`. Half-stars are dyadic and would
survive as floats, but a partner payload carrying prices would not, and two adapters
disagreeing in the 11th decimal is exactly the silent difference this product claims to
catch. Policy, not coincidence.

The scale is declared in the manifest, and **a value that does not land on it is
rejected rather than rounded**. Rounding silently changes a partner's number at the one
point no test is looking.

### The reader fails loudly where the data can lie quietly

- The genre marker `(no genres listed)` resolves to **zero genres**, never to a
  twentieth genre. It is not a value; it is the absence of one.
- A release year is parsed only from four digits in parentheses at the very end of the
  delivered title. Thirteen titles do not match, and one of them —
  `Death Note: Desu nôto (2006–2007)` — is why the rule is not loosened: a looser rule
  files a year *range* under 2006 without saying so. The unparseable thirteen become a
  declared gap, which GA-04 discloses in the trust report's coverage note (C4).
- A column looked up by name and not found throws, with the header printed **escaped**.
  The reason it is usually not found is an invisible character, and
  `has no column "genres"; its header is [movieId, title, genres]` reads as a
  contradiction. See the CRLF note below.
- The store records the endianness it was written with and refuses to be read on a
  machine that disagrees, rather than returning byte-swapped numbers.

### CRLF is the defect the pinned figures exist to catch

All four supplied files terminate lines with `\r\n`. Read naively — only `\n` treated as
a terminator — every genre that falls last in its row forks into a `\r`-suffixed twin and
the genre count goes from **19 to 38**. `IMAX` is always last in its list, so under that
reading the genre does not exist under its own name at all: a breakdown by genre silently
loses it and splits the rest. Nothing errors.

Two things follow. The stripping lives **in the scanner**, not in a
`replace(/\r\n/g, "\n")` pass over the text, because that pass also rewrites line
endings inside quoted fields — a silent edit to the partner's data. And both numbers are
pinned: the shipped 19, and the 38 a naive parse would have produced.

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

The model may select only from what the layer declares. Anything outside it is **rejected
and turned into a clarifying question — never coerced to the nearest match.** Silent
coercion is how you get a plausible answer to a question nobody asked. That rejection path
is what makes "the AI never computes the number" structurally true rather than a promise.

### What the shipped layer declares

Landed in GA-03 at its thinnest viable. Asserted in `tests/semantic.test.ts`, not only
described here — a listing beside the shipped file is a second source of truth otherwise.

- **Measures** (5) — `avg_rating`, `rating_count`, `viewer_count`, `title_count`,
  `share_rated_4_plus`
- **Dimensions** (5) — `title`, `genre`, `release_year`, `release_decade`,
  `rating_year`
- **Guards** (4) — section 4
- **No synonyms, and no filter vocabulary.**

Both omissions are deliberate. An earlier draft of this section listed a filter vocabulary
— minimum ratings per title, release period, rating period, genre, viewer segment — and
`SemanticLayerSchema` has no `filters` key at all, so a layer declaring one now fails to
load. Volume is earned by a failing eval in GA-05, never by anticipation, and the two
directions are not symmetric: **thin is reversible, flat is not.** Adding a synonym is a
data edit; flattening the locale keying costs a schema, a prompt and a matching rewrite,
and every eval passes against a flat layer right up until the first non-English locale, so
the eval loop cannot warn about that one in time.

`defaultTieBreak` is `title` — the only dimension that is unique per member, which is what
a tie-break has to be for the 296-way tie at 5.00 to resolve identically on every adapter.

### The layer is pretty-printed, and that is load-bearing

Measured on the shipped file: **2,157 bytes pretty-printed against 1,568 minified — 589
bytes of whitespace.** The layer heads the cached prompt prefix (section 6), and Opus 5
does not cache a prefix below 512 tokens. At roughly four characters per token that is
~540 tokens pretty against ~390 minified, so pretty-printing is what carries this layer
over the floor on its own. Dropping under it **fails silently** — no error and no warning,
just every question paying uncached prefix cost forever. Minifying the layer is therefore
a cost regression disguised as a saving, and `tests/semantic.test.ts` asserts the newlines
and carries the measurement with them.

### The materiality threshold is data, not engine logic

`materiality.minValueDelta` is **0.01**, declared in the layer. Two things make a
naive/honest comparison material, and only one of them needs a number: a change in the
top-`limit` row-set's membership is structural and needs none, and a measure delta needs
one presentation step. One global value rather than one per measure, because a measure's
presentation scale lives in the store and the engine (`ResultRow.value` against
`rawValue`), not in `MeasureDeclarationSchema` — and 0.01 behaves as a floor across all
five: it is exactly one step for `avg_rating` and `share_rated_4_plus`, and any real
change in a count clears it comfortably.

It is declared here rather than in the engine so GA-12 can tune the comparison against the
rendered block as a data edit, instead of GA-12 editing GA-04's internals.

### The loader is what keeps a data file honest

`src/server/semantic/load.ts` fails fast and points at a path — `measures[0].labels`, not
"invalid layer" — because whoever reads the error is adding a measure or a guard to fix a
failing eval. `parseSemanticLayer()` is pure and takes already-parsed input, so the failure
cases are testable without a file on disk and a layer arriving over the wire later takes
the same path.

Four checks. The schema gives the first; the other three are cross-file facts a schema
cannot see, and each is a way for the layer to name something that does not exist and have
it resolve quietly to nothing at execution time:

1. `SemanticLayerSchema`, which rejects a flat label and any undeclared key.
2. Every declared `GuardId` is in the registry, naming the id and the registered set.
3. Every `defaultParams` key is one the named guard actually reads. A threshold under a
   key no guard reads is worse than a missing threshold — the guard still runs,
   unthresholded, and nothing says so. That is invariant 4's silent coercion arriving
   through the layer rather than through the model.
4. `defaultTieBreak` names a declared dimension. Its failure mode is not a load error but
   a tie ordering itself differently on every adapter, which is the one thing the
   conformance suite exists to make impossible.

## 4. Trust guard declaration

Declared in the semantic layer, implemented in `src/server/semantic/guards/registry.ts`.
The four guards themselves, their defaults and the measured rationale for each are in
`docs/design.md` section 5.

The split is the point. The **layer** says which guards a dataset ships and what their
thresholds default to; the **registry** says what the engine can actually do with one. A
`GuardId` in a `QuerySpec` is valid because the registry holds it, never because a core
type named it (invariant 6) — which is what lets the same portable contract point at other
data.

**Exactly four guards, asserted.** C4 settled that the thirteen undated titles are
disclosed in the trust report's coverage line rather than given a fifth guard: they carry
18 of 100,836 ratings (0.018%) and none clears `min_evidence`, so a fifth would dilute the
four that carry the hero moment for an immaterial figure. `tests/semantic.test.ts` asserts
the count and carries that reasoning, so a fifth guard cannot arrive without someone
deleting a test that says why not.

**No threshold lives in the registry.** `min_evidence` declares that it *reads*
`minObservations`; what that number is arrives in the spec's `params`, defaulted by the
layer at 20. Each entry declaring its parameter names is what lets the loader reject a
typo'd default — the registry is the only place that knows which keys are real.

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
- **Pinned figures** (`tests/pinned-figures.test.ts`), tied to the measured figures in
  `docs/design.md` section 4 (296, 8,427, 34, 18, 13, 2.27). These double as regression
  tests on the ETL, so a figure that moves means the ETL changed and is investigated
  rather than updated. Each is asserted **with its definition, its guards in effect —
  none, and asserted to be none — and its as-of**, because a bare number is the kind of
  claim this product exists to argue against. Two pairs are pinned rather than one
  figure: genres per title at **2.27 with `exclude_uncategorised` on and 2.26 with it
  off**, since the off reading is what the most natural implementation writes and a team
  pinning only 2.27 would read 2.26 as a day-one regression; and genre cardinality at
  **19 shipped against the 38 a naive unstripped parse produces**.
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

**`npm run ingest` runs on Node's native TypeScript stripping**, with no runner
dependency and no build step, so the clean-clone path stays
`npm install && npm run ingest && npm run dev`. Two settings hold that in place, and
both were added by GA-02: `allowImportingTsExtensions`, because every relative import in
the node-executed chain (`scripts/` and `src/server/ingest/`) carries an explicit `.ts`
extension — Node resolves no others; and `erasableSyntaxOnly`, so an `enum` or a
parameter property landing anywhere in the project fails at `tsc` rather than at the next
`npm run ingest`.

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
