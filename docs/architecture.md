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
      answer.ts                 Answer union, AnswerFrame, the narration slot
      ask.ts                    AskRequest: the ask route's request body
      payload.ts                ReceivedPayload envelope
      semantic-layer.ts         the layer's schema
    ingest/                   RECEIVED PAYLOAD -> STORE; see section 2a
      payload.ts                the payload body, composed onto the envelope
      csv.ts                    CRLF-aware, quoted-field-safe reader
      read-payload.ts           the four CSVs read as one received payload
      build-store.ts            payload -> append-only log + derived indexes
      store.ts                  the store's shape, and its binary read/write
    warehouse/                DATA ACCESS LAYER (swappable); see section 5
      types.ts                  interface Warehouse { aggregate(request) }, Aggregation
      local-store.ts            typed-array adapter; the only module that knows
                                what a measure means
      postgres-store.ts         the same spec compiled to SQL; TEST ONLY — nothing
                                under src/ imports it, and it holds no driver
    semantic/
      load.ts                 parse + validate semantic/*.json, fail fast
      guards/registry.ts      the four declared guards; no thresholds
    engine/                   PURE AND DETERMINISTIC; see section 5a
      execute.ts              QuerySpec -> ResultSet: guards, ordering, limit,
                              trust report, provenance, the double-run
      numbers.ts              exact-rational compare, half-toward-zero rounding,
                              code-unit string order
      compare.ts              materiallyDifferent() and the comparison block
      resolve.ts              loose input -> QuerySpec, or a Rejection
      amend.ts                SpecPatch -> QuerySpec
    ai/
      interpret.ts            question -> QuerySpec (structured output)
      amend.ts                follow-up -> SpecPatch
      narrate.ts              ResultSet -> takeaway (streamed)
      narrate-template.ts     the same, deterministic; the no-key producer
      fallback-parser.ts      deterministic, no-API-key path
    surface/
      zero-state.ts           manifest + layer -> the first paint's data; see section 11
  app/
    api/ask/
      route.ts                the composition root: disk, process singletons, POST
      answer.ts               assembly, status codes, frame order, the stream
    globals.css               THE THEME — design-system tokens under shadcn's names
    layout.tsx                the approved typefaces
    page.tsx                  a server component; reads the manifest, runs no spec
  lib/                        CLIENT-SAFE, no node: imports
    intl.ts                   the one formatter; invariant 12 lives here
    answer-stream.ts          the NDJSON reader for POST /api/ask
    view-model.ts             types only, shared by the server builder and the client
    utils.ts                  shadcn's `cn`
  components/                 AskSurface, AppRail, ZeroState, AnswerCard, Chart,
                              ResultTable, TrustStrip, ProvenanceDetails,
                              ClarifyCard, SessionColumn
                              (RecipeSentence is GA-11's; NaiveComparison is GA-12's)
    ui/                       shadcn components, copied in as source: card, button, badge
tests/
  contracts.test.ts           the core contracts hold their shape
  pinned-figures.test.ts      the pinned figures, as regression tests on the ETL
  semantic.test.ts            the layer loads, and a broken one does not
  engine.test.ts              the engine: hero, replay, tie-break, determinism
  ask-route.test.ts           the route: refusal at 200, provenance, the stream
  ui/                         the surface: the reachable table, the formatter rule,
                              the zero state's permitted numerals
  conformance/                spec -> expected numbers; EVERY adapter must pass
    cases.ts                  the corpus: 14 cases + the paraphrase set, each
                              pinned at an explicit, non-null as-of
    adapters.ts               the adapters under test; skip loudly or fail loudly
    postgres-fixture.ts       connect, load, and report the server's own version
    suite.test.ts             describe.each(adapters), plus the divergences
    corpus.test.ts            lints: no null as-of, and the adapter stays out of
                              the serving path. Needs no database.
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
  readonly adapterId: string
  readonly sourceId: string
  latestAsOf(): Promise<string>
  aggregate(request: { spec: QuerySpec; resolvedAsOf: string }): Promise<Aggregation>
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

### The adapter returns an `Aggregation`, and the engine composes the `ResultSet`

Settled by GA-04. An adapter aggregates and stops there; guards, ordering, the limit, the
trust report, provenance and the naive/honest comparison all belong to `engine/`.

This is a determinism decision rather than a layering preference, and it follows from the
paragraph above. Determinism depends on each adapter behaving identically, so **the less
an adapter decides, the less can differ**. Had `aggregate` returned a finished `ResultSet`,
every adapter would re-implement guard application, the ordering rule, materiality and the
double-run, and the conformance suite would have to police all of it in each one. It
returns the aggregated members instead, and everything downstream is written once.

Its cost is real and accepted: an adapter returns every member rather than the top `limit`
ones, because guards are applied above it and a member excluded by `min_evidence` has to
exist before it can be excluded. That is bounded by dimension cardinality — 9,742 for
`title`, the largest — and pushdown past ~1M rows is already on the deferred list in §1.

### Exact integers cross the boundary; floats never do

An `AggregatedMember` carries `numerator` and `denominator` as **integers**, not a computed
average, plus `observations` and a stable `memberId`. `avg_rating` returns Σ hundredths
over the rating count, and the engine performs the single division.

Integer addition is exactly order-independent, so two adapters that visit the same ratings
in a different order agree bit-for-bit. A floating-point sum does not carry that guarantee,
and the disagreement would land in the last decimal — the silent difference this product
claims to catch. It is also what makes the tie-break test meaningful: the shuffled-payload
cases in `tests/engine.test.ts` change arrival order and every sum is unmoved.

`memberId` is a **stable natural key from the source data** — the partner's `movieId` —
never a storage position, because it is the final ordering discriminator and a storage
position differs between adapters by definition.

### A member is identified by its label *and* its `memberId`

Settled by GA-06, and found by the second adapter rather than reasoned out. An adapter that
groups on the label alone merges entities the source keeps apart: five MovieLens title
strings are each shared by two different `movieId`s, so the local adapter reported **9,737
members where the store declares 9,742 titles**, and pooled two films' ratings under one row.
`GROUP BY name, movie_id` in the Postgres adapter kept them apart, the two engines disagreed,
and the local adapter was wrong.

It is the same fact the ordering rule already rests on — the rule ends in `memberId ASC`
*because* the declared tie-break is not unique (§5a) — so an adapter that merges on the
tie-break undoes one layer down what the ordering rule established. Merging two entities the
source distinguishes is silent coercion, which is what invariant 4 exists to remove; here it
arrived through a `Map` key rather than through a type.

The hero rows were unaffected, which is the point worth keeping: the defect moved coverage
counts and pooled five pairs of titles, and no test that existed could see it, because a
single adapter agreeing with itself cannot.

## 5a. The engine

Pure functions in `src/server/engine/`. Every number the product shows is computed here
(invariant 1), and nothing in it names a dataset: measures live in the adapter, guard
behaviour in the registry, thresholds in the layer.

### The ordering rule is `<measure> <dir>, <tieBreak> ASC, <memberId> ASC`

Total, stated, and identical on every adapter. Each part earns its place:

1. **The measure**, compared on the **exact rational by integer cross-multiplication** —
   `a.numerator * b.denominator` against `b.numerator * a.denominator` — never on the
   rounded value and never on a float. `ORDER BY AVG(rating) DESC` in any SQL warehouse
   orders on the full-precision average, so the engine must too, or a SQL adapter and this
   one disagree on rows that display the same number. Measured at `asOf 2007-08-02`:
   Dr. Strangelove (19,100/43), Lawrence of Arabia (14,200/32) and Chinatown (13,750/31)
   **all display 4.44**, and only full precision puts them in that order. Rounding first
   would reorder them alphabetically and change which three appear above a `limit` of 3.
2. **The tie-break**, required on every spec because 296 titles tie at exactly 5.00 (§2).
   It is the member's own key when the tie-break dimension *is* the breakdown dimension;
   otherwise the dimension is not a property of the member and the rule falls through.
3. **The member's stable natural id**, which is what makes the order *total* rather than
   usually-total. **A declared tie-break need not be unique**: five MovieLens title strings
   are each shared by two different `movieId`s — `Emma (1996)`, `Saturn 3 (1980)`,
   `Confessions of a Dangerous Mind (2002)`, `Eros (2004)` and `War of the Worlds (2005)`.
   Without a third key the order within such a pair is whatever the adapter's iteration
   produced, which is the one thing the conformance suite exists to make impossible.

String comparison is by **UTF-16 code unit, never `localeCompare`**. The two disagree at
the very first shipped title — code-unit order opens with `'Til There Was You (1997)` and
ICU collation with `¡Three Amigos! (1986)` — and `localeCompare` depends on the runtime's
ICU build and the ambient locale, so an answer would reorder itself across Node versions.
Labels are locale-keyed and numbers go through `Intl` (§7); *ordering* is a reproducibility
concern and is deliberately locale-free.

### Rounding to the presentation scale is half toward zero, and it is stated

*A Streetcar Named Desire* has 20 ratings summing to 8,950 hundredths — a mean of **exactly
4.475**, sitting precisely on the boundary between two presentation steps. There is no
arithmetically correct answer at two decimals; there is only a stated one. Four reasonable
implementations were measured on that value:

| Implementation | Result |
| --- | --- |
| `Math.round(sum / n)` — half up on hundredths | **4.48** |
| `Intl.NumberFormat(2dp).format(mean)` | **4.48** |
| `mean.toFixed(2)` | **4.47** |
| `Math.round(mean * 100) / 100` | **4.47** |

Four implementations, two answers, split two–two — the same shape of finding that made
`tieBreak` a required field (§2), one layer further down. The pinned hero figure is **4.47**
(`AGENTS.md`; `docs/design.md` §4), so `roundHalfTowardZero()` is what the engine states,
and it states it in one named function rather than letting the number fall out of whichever
formatter a later increment reaches for.

The two `Intl` rows disagree for a reason worth knowing: ICU formats the *shortest decimal
that round-trips* to the double, so it sees `4.475` and rounds half away from zero, while
`toFixed` formats the actual binary value — `4.474999999999999644…` — and rounds down.
**Invariant 12 is unaffected either way**, because rounding to the presentation scale
happens in the engine, on integers, and `Intl` only ever formats an already-rounded value.
A formatter is a rendering choice; this is an arithmetic one.

### Guards are applied in spec order, and attribution follows it

The engine iterates `spec.guards`, looks each id up in the registry and calls the
`excludes` predicate the registry declares. **It never branches on a `GuardId`**, so a
`minRatingsPerTitle`-shaped assumption cannot reach engine code one layer down from the
core type that already forbids it (invariant 6).

A member is attributed to the **first** guard that excludes it. That is stated rather than
obvious: two guards can exclude the same member, and without an order the `excluded` counts
in the trust report would depend on iteration order and stop being reproducible.

Guards are **member-level** in v1: a predicate over `{ observations, uncategorised }`. An
entity-level guard — excluding unrated titles from a *count* measure, rather than excluding
members with no observations — is expressible in the same registry shape but is not built,
because nothing in v1 asks for one.

### The naive comparison is a double-run, not a flag

`execute()` runs the spec, runs it again with `guards: []` through the same code path, and
diffs. Nothing in the engine knows about ties, ratings or MovieLens; the hero moment appears
because emptying the guards genuinely changes the answer, and it would appear on any dataset
where that is true. A spec carrying no guards is its own naive run, so the comparison is
skipped rather than computed against itself.

`materiallyDifferent()` is the verdict, and the threshold is read from the layer (§3) so
GA-12 tunes it as a data edit. Membership change in the top-`limit` rows is structural and
needs no number; a shared member's value moving by at least `minValueDelta` needs one. A
row whose value held while its `n` moved also counts — the number survived, the reason to
believe it did not.

**The comparison also carries `tiedAtTop`, because the rows cannot.** Each side's rows are
capped at `spec.limit`, so they can say the top of the unchecked ranking is a tie and not
how wide that tie is — and the width is the whole finding. Ten rows at 5.00 read as a tie;
**296 members** at 5.00 read as a ranking that is not ranking anything. So `executeOnce`
counts, on each side, the members the ordering's **primary key** cannot separate from the
leader: the ones the tie-break and the member id decided between rather than the measure.
It is counted with the same comparators `orderMembers` sorts with, on the ordered list, so
it stops at the first member that differs. A dataset with no ties reports 1 on both sides,
and nothing in the count knows what a title is.

The alternative was letting the surface infer it, and it cannot: 296 is not derivable from
ten rows, so a block that stated it would be stating a figure that originated outside the
engine — invariant 1 broken in the one place the product can least afford it.

### `resolveSpec()` returns a `Rejection`; it never throws

Invariant 4's mechanism. An undeclared measure, dimension or guard — and a spec that fails
schema validation — all return the same clarifying object, so the caller renders one shape
whether the measure was undeclared or the limit was 10,000. A throw would be caught
somewhere generic and rendered as an error, which is the product failing rather than the
product working; showcasing refusal later (GA-05) is then a rendering change.

It is also where `tieBreak` is filled from the layer's `defaultTieBreak`, before validation,
so every spec reaching an adapter carries a total ordering rule — and where guards default
to **on**, every guard the layer declares with its declared thresholds. An unguarded answer
has to be asked for, and asking for one is what the comparison renders.

### Coverage counts observations as the breakdown counts them

A multi-valued breakdown counts one fact once per member it belongs to, on **both** sides of
the coverage ratio, so the ratio stays coherent. The overlap itself is not removed — it is
declared, by `disclose_multi_membership`, in the trust report's notes.

Per C4, a breakdown a dimension cannot place reports the drop in `notes` rather than through
a fifth guard: 13 undated titles carrying **18 of 100,836 ratings (0.018%)**, **none clearing
`min_evidence ≥ 20`** — the largest carries 4. That measurement is the whole evidence base
for C4 and is asserted in `tests/engine.test.ts`, so the next person to look at the undated
titles neither re-measures them nor adds the guard C4 declined. The adapter reports it
generically as "entities the breakdown could not place"; nothing in the engine knows what a
release year is — and deliberately nothing in it knows they are *titles* either. A hardcoded
"titles" in the note would be dataset-specific content inside the engine: invariant 6's leak
arriving through a copy string rather than through a type. The neutral nouns it uses are a
placeholder for layer-supplied, locale-keyed copy when GA-10/GA-11 style the trust strip.
**The numbers are the disclosure; the wording is not yet final.**

## 5b. The second adapter, and what running two of them proved

The conformance suite runs the same corpus through **two independent implementations of
aggregation**: the in-process typed-array adapter that serves the application, and
`warehouse/postgres-store.ts`, which compiles the same `QuerySpec` to SQL. Determinism across
adapters is the cost of a swappable warehouse (§5); this is what converts that cost into the
artifact that proves the promise.

**Postgres, not SQLite.** The build spec named SQLite; the captain changed it during GA-06.
The work is the same work in the same place, and Postgres is what a real deployment would
actually be pointed at — which turns "there is a swappable seam" into "two entirely different
engines produce byte-identical numbers from the same portable query description".

**It is a test artifact.** No database enters the serving path, the deployed bundle or the
demo's setup, and invariant 13 is untouched: a clean clone still runs with no key and nothing
to install. `tests/conformance/corpus.test.ts` asserts all of it — that nothing under `src/`
imports the adapter, that the adapter imports nothing but `contracts` and its own sibling
types (no driver, no `node:*`), and that `pg` and `pg-copy-streams` are devDependencies.

**One environment variable, any Postgres.** `CONFORMANCE_DATABASE_URL` holds a connection
string and nothing else decides anything — a local server, a Supabase project or any other
Postgres are the same case, because Supabase *is* Postgres. TLS, port and credentials are
already expressible in the string, so there is no mode flag and no branch in the adapter.

**Three outcomes, none of them quiet.** Set and working: both adapters run and must agree
exactly. Set and unreachable: **failure**, because the operator asked for the second adapter
and did not get it, and a suite that downgrades a broken connection to "skipped" goes green on
the first outage and never goes red again. Unset: a **loud skip** that names the consequence —
the determinism claim is unproven on that run. The banner is written straight to file
descriptor 1, because Vitest's reporter drops `console` output from passing files when stdout
is not a terminal, and a loud skip that is loud only on a developer's machine is the quiet
pass GA-06's own "must not" forbids.

**The suite reports which server it agreed with**, read from `SELECT version()` rather than
from configuration. Collation and ordering semantics differ across Postgres majors, so a
conformance suite whose job is proving two engines agree has to be able to say which engine,
or a later divergence is unattributable.

### Where two engines actually diverge

Each of these was measured during GA-06 and each is kept executable in
`tests/conformance/suite.test.ts`, running the wrong expression beside the pinned one.

- **The session time zone is inherited, not neutral.** `EXTRACT(YEAR FROM to_timestamp(at))`
  renders in the session's `TimeZone`, which Postgres takes from its host — a freshly
  initialised cluster on this machine chose `America/Los_Angeles`. A rating an hour either
  side of a UTC new year then lands in the wrong year with no error anywhere. The adapter
  pins `AT TIME ZONE 'UTC'`, and the suite runs the **entire** Postgres corpus under
  `Pacific/Kiritimati` (UTC+14) so the pinning is proved rather than trusted.
- **Collation is the database's, not the engine's.** Ordering `'Til There Was You (1997)`
  against `¡Three Amigos! (1986)` under `und-x-icu` reverses UTF-16 code-unit order — the
  same disagreement `AGENTS.md` already records for `localeCompare`, now arriving from a
  database instead of a runtime. It cannot reach a result **because the adapter never
  orders**: §5's split is what makes collation unable to change an answer.
- **`SUM()` over no rows is NULL, not zero.** A member enumerated from the dimension and
  matched by nothing — the eighteen titles nobody rated — returns a null numerator without
  `COALESCE`, where the typed-array loop returns 0.
- **The uncategorised sentinel is unrepresentable in SQL.** `UNCATEGORISED_KEY` begins with
  U+0000 and Postgres `text` cannot hold a NUL byte. It is reconstructed in JS from the
  `uncategorised` flag the boundary already carries — which is the field
  `exclude_uncategorised` actually reads. Had the guard keyed on the string, the second
  adapter could not have implemented it at all.
- **Counts arrive as `bigint`.** `pg` hands int8 back as a string, other drivers as a number
  or a `BigInt`. The adapter converts in one stated place and refuses anything outside the
  safe integer range, rather than trusting whichever choice a driver made.
- **Filter comparisons are type-strict on one side only.** The local adapter compares with
  `===` and requires both sides to be numbers for `gte`, `lte` and `between`; Postgres will
  happily compare text with `>=` under its collation. The SQL adapter emits `FALSE` for a
  comparison the local adapter refuses, so the two disagree on no filter.

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

## 6a. The ask route and the answer object

Landed by GA-07. Section 6 is what the two model calls are; this is the seam they are
composed at, and the shape the answer travels in. The route runs the deterministic path
today — GA-05's fallback parser interprets, GA-07's template narrates — and GA-08 and
GA-09 each substitute one producer behind an unchanged contract.

### The route assembles; the engine aggregates

`src/app/api/ask/route.ts` holds only what a deployed process owns: which store to read,
which layer to load, which interpreter this process got. Everything else — parsing the
request, assembling the answer, the status codes, the frame order, the stream — is in
`answer.ts` beside it, so all of it is reachable from a test with an in-memory warehouse,
with no compiled `.store/` and no HTTP server.

Nothing on the path adds, orders, rounds or thresholds. The one arithmetic-looking line
is `request.asOf ?? warehouse.latestAsOf()`, which chooses a moment rather than computing
a figure — and it is resolved **once, up front**, before interpretation, so the refusal
branch states the same as-of the success branch would have used.

The route reads the compiled store, never `data/*.csv`. A serving path that parsed the
CSVs would be a second ETL with no manifest, no as-of and nothing to pin. The store and
the layer are read **once per process**: `.store/` is a build artifact and a layer edit
is a redeploy, so neither can change while the process lives.

### The refusal is served at 200, and it states its provenance

A question the layer cannot answer returns `ok: false` carrying its clarifying question
and its concrete options, at HTTP 200. Section 8 explains why the rejection is a returned
value rather than a throw; this is the same argument one layer out. A 4xx would mean the
surface had to reconstruct the clarification from a status code, and promoting refusal to
a demonstrated feature in GA-11 would be a rebuild rather than a rendering.

A **fault** is kept visibly apart from a refusal. A body that is not JSON, or that carries
no `question`, is a 400; a missing store or an adapter that cannot compute a declared id is
a 500. Neither is a clarifying question, because nothing was asked in a form that could be
clarified. Both carry the `requestId`, so a server log and a user report join up.

`Answer` carries a top-level `provenance` on **both** branches: `requestId`, `adapterId`,
`layerVersion`, `resolvedAsOf`. Which moment, which layer and which adapter refused is
exactly what a user comparing two sessions needs, and before this the rejection branch
could say neither.

That object is deliberately **smaller than `Provenance`**. The full record carries
`engineVersion` and `computedAt`, which describe a computation a refusal never ran. On the
success branch it is a projection of `resultSet.provenance`, taken by `answerProvenance()`
so there is one derivation rather than two, and asserted field by field in
`tests/ask-route.test.ts`.

The `ResultSet` itself is carried **whole and unmodified** rather than spread across the
answer. The spec, the rows and the trust report then reach the client as the one artifact
the conformance suite pins and a saved recipe re-runs, instead of as fields the route took
apart and put back — which is the strongest available statement that the route did not
touch the numbers.

### Narration is a stream from the first commit, and the answer object has only its slot

The answer object holds `narration: { producer, locale }` and never the text. The takeaway
arrives as its own frames on the same response.

Putting the prose in a JSON string field is the single most expensive shortcut in the plan
(build-spec §5.1). The narration's *producer* changes in GA-09; its *contract* must not.
A field-to-stream change is a change of response kind — the content type, the client's
fetch handling, component state, and every test that reads it — so it is paid once now,
while the only producer is a template, or four times later.

Streaming also fixes an ordering the product depends on. The complete answer object
arrives **before any prose**, which is invariant 1 expressed as a wire format: the numbers
are on screen before a narrator says anything about them, so no figure can originate in
the narration.

`producer` is not a restatement of `degraded`. `degraded` says no key was present, so the
deterministic parser interpreted the question. `producer` says who wrote the takeaway —
and GA-09's contract is that a narrate failure falls back to the template *without failing
the request*, which produces a live answer with a templated takeaway. Two different facts,
and the surface owes the user a different note for each.

`ai/narrate-template.ts` exports the `NarrationProducer` type both producers satisfy:
`(ResultSet, SemanticLayer, locale) => AsyncIterable<string>`. The template yields one
chunk, GA-09's yields SDK deltas, and that is the only difference between them. Anything
narrower — returning a string, resolving a promise — would make GA-09 change the type, and
with it the route, the frame encoder and every test.

The template quotes; it never computes. Every figure in it is already a field on the
`ResultSet`. It never previews the naive/honest comparison, which GA-12 renders and would
otherwise have to unbuild, and it never says "verified" (invariant 5).

### The wire format is newline-delimited JSON, in a fixed frame order

`application/x-ndjson`, one JSON value per line: an `answer` frame, then zero or more
`narration` deltas, then `end`.

**Not Server-Sent Events.** The question travels in a body, so this is a POST, and
`EventSource` is GET-only — a browser client reads this with `fetch` and a stream reader
either way. Against that, SSE's framing is parsing work for nothing, and its reconnect
semantics are actively wrong here: a dropped connection must be re-asked as a fresh
request with its own `requestId`, never silently resumed into an answer whose provenance
says otherwise.

`end` is a frame rather than the stream simply closing, because a reader otherwise cannot
tell a finished narration from a connection that died mid-sentence — and GA-09 streams
that narration from a model, where the distinction becomes real.

**Everything fallible happens before the first byte.** Parsing, interpretation and
execution all resolve before the stream opens, because once a byte is written the status
line is gone and a failure can only be expressed as a truncation. Only narration runs
inside the stream, and GA-09's contract is that it degrades rather than fails.

### Every response carries `nosniff` and `no-store`

`X-Content-Type-Options: nosniff` on answers, refusals and faults alike. The body echoes
the user's own question back inside `rejection.asked`, and without the header a browser is
free to disregard the declared type, sniff markup out of that echo and render it — so it
is what keeps a clarifying question from becoming an injection surface.

`Cache-Control: no-store` because an answer is pinned to a `requestId` and a `computedAt`.
A cached one would be a different answer wearing another answer's provenance, which is the
confident wrong answer this product exists to catch.

### The request carries the as-of

`AskRequest` was settled at `{ question, locale, asOf }` in GA-07 and gained a fourth
field, `withoutGuards`, in GA-12 — see below. The question is the only free text anywhere
in the product; every other field is context the **caller** owns and the model never chooses
(build-spec §3 GA-08). The as-of is what makes a past answer re-runnable rather than
merely explainable, and it is the seam GA-06's replay case and GA-14's saved recipes both
come through. An empty question is a legitimate value: it returns the clarifying question
that lists the starter questions.

### The guard escape is a list of ids on the request, applied by subtraction

`AskRequest` gained a fourth field in GA-12: `withoutGuards`, the declared `GuardId`s to
leave **off** this run. `docs/design.md` §5 gives every guard a safe default already
applied and a one-tap escape, "never a warning that hands the user homework", and that
escape has to be expressible on the wire.

It is **a list of ids, not a spec**. The route resolves the question to a spec exactly as
it always does, then removes those guards from it — so interpretation is unchanged, and a
caller cannot reach the measure, the breakdown, the filters, the ordering or the limit
through this field. Emptying the guards is what the engine's naive run already does, so an
escaped answer *is* the naive side of the comparison, recomputed with its own `requestId`,
its own `computedAt` and its own trust report rather than re-displayed from the previous
answer's payload.

An id the layer does not declare is a **400, not a silently ignored no-op**. Nobody types a
`GuardId`; it reaches this field only from a caller that read it off a trust report, so an
unknown one means the client and the layer disagree about what exists. Running every check
and reporting success would be invariant 4's silent coercion arriving through a no-op
rather than through a nearest match.

The alternative considered was a general amendment transport — the parent spec plus a
`SpecPatch`, through the `applyPatch`/`amendSpec` pair GA-04 already ships. It was declined
for this increment: GA-11 rewrites measure, breakdown, limit and guard *params* and will
need that transport, but building it here would have meant GA-12 shipping most of GA-11's
machinery to move one button, against the must-not C1's swap added.

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

### The branch is on key presence, taken once, before any request

`ai/mode.ts`. `aiMode(env)` reads `ANTHROPIC_API_KEY` and returns `live` or `degraded`;
`selectInterpreter(live, env)` returns the live interpreter only when a usable key **and**
a live arm are both present, and the fallback parser otherwise.

**A branch, not a caught exception.** A `try`/`catch` around an SDK call degrades only for
the failures somebody remembered to catch, and it cannot distinguish *no key* from *the
request failed* — two facts the user is owed differently. Deciding once, on a fact that
cannot change mid-request, is what makes "degrades rather than breaks" checkable rather
than accidental. A whitespace-only value reads as absent, because `.env.example` ships
`ANTHROPIC_API_KEY=` and a clean clone that copies it has the variable set and no key.

The live arm is **injected, not imported**: GA-08 owns the model call, and importing it
here would put the SDK on the import graph of the one path that must work with nothing but
the declared dependencies.

### The fallback parser matches declared vocabulary, and nothing else

`ai/fallback-parser.ts`. Two stages, and its entire output space is the starter questions'
specs plus a `Rejection` — it never composes a spec that is not already in the catalogue.

1. **The catalogue.** A normalised exact match (lowercased, punctuation to spaces,
   whitespace collapsed) against a starter question's own text.
2. **Declared vocabulary.** Failing that, a lookup for a declared label or synonym of a
   starter question's measure *and* of its breakdown dimension. Both must occur, exactly
   one starter question may match, and the result is that starter question's spec.

No grammar, no intent classification, no stemming, no edit distance, no number or date
extraction. Stage 2 is a dictionary the dataset owner wrote, not language understanding:
against the layer with its synonyms stripped it matches only literal label text. It exists
because the layer ships thinnest-viable and every synonym is earned by a failing eval — a
parser that could not read a synonym would leave that loop with nothing to close on until
the model path arrives.

**`CONTRARY_TERMS` is a refusal rule.** Every starter question ranks or sequences in one
declared direction, so a question asking for the other end carries the same declared
vocabulary. *"Which genres have the fewest ratings"* would otherwise match the descending
ranking and answer it. The parser refuses instead, naming the word. The rule only ever
makes the parser answer less, and it is locale-keyed like every other piece of vocabulary.

**Starter questions live in the parser, not the layer, in v1.** They are product copy and
the source the zero state renders; the layer's schema declares measures, dimensions and
guards, and a sixth top-level field is a semantic-layer change rather than a parser one.
Moving them into the layer is the natural next step — it is what would let a second dataset
ship its own zero state as data.

### The rejection is a returned value

Two builders, answering two different failures, deliberately not merged: `engine/resolve.ts`
rejects a *spec* naming an undeclared id, and `ai/fallback-parser.ts` rejects a *question*
with no place in the catalogue. Only the second has starter copy to offer, so its `nearest`
carries real starter questions — ranked towards whatever measure or dimension did match —
rather than synthesised phrasings, because the user is going to tap one.

Neither throws. An exception cannot carry the clarifying question or its options; it gets
caught somewhere generic and rendered as an error, which is the product failing rather than
the product working. `tests/rejection.test.ts` asserts the returned object, including that
every offered `nearest.spec` actually executes — a spec can validate and still name
something the adapter cannot compute, which is the difference between a suggestion and an
offer.

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
  is the artifact that proves the product's central promise. Fourteen cases, pinned at
  three explicit as-of points, each carrying its guards in full and its whole trust
  report, plus a five-phrasing paraphrase set. Three cases take their numbers from
  `docs/build-spec.md`, written before any code produced them; the rest are regression
  pins whose independent check is the second adapter reproducing them. A lint test
  asserts no case carries `asOf: null` — a case pinned at "latest" does not fail when
  the next payload lands, it passes against different data, which is this product's own
  failure mode aimed at its own proof. The second adapter is Postgres, addressed by one
  connection string; see §5b for the three outcomes and what each means.
- **Eval set** of question → expected-spec pairs, including amendment cases
  (spec + follow-up → expected patch). Anthropic's reported lesson was that evals, not
  model choice, drove accuracy. `tests/evals/questions.jsonl`, run by `npm run eval`.
  Four things about it are decisions rather than details:
  - **It compares specs, not prose, so it needs no API key.** It runs in CI, on a clean
    clone, and it ran before any model call existed. A loop that costs money per run is a
    loop that gets run less often, exactly when the layer most needs it. The interpreter is
    a parameter, so the same lines score the model path when one exists.
  - **A failure names the missing structure.** Not "expected avg_rating, got null" — that
    turns every iteration into an investigation. The runner distinguishes an expectation
    naming something the layer does not declare (`no measure matched "revenue" — declared
    measures are …`) from something it declares under no phrase the question uses
    (`rating_count declares "number of ratings" and no synonyms in en`). Different fixes.
  - **It is scored against a committed baseline**, `tests/evals/baseline.json`, not
    pass/fail. Under pass/fail, "ship thin and let failing evals earn structure" and "every
    increment leaves the repository green" contradict each other, and the contradiction gets
    resolved by deleting the failing case — which deletes the evidence. The baseline records
    the ratio, the layer version it was measured against, and what it was set from;
    `--check-baseline` exits 1 below it, comparing cross-multiplied rationals so an exact
    match never fails on a float's last bit.
  - **A case may be left failing.** The committed set carries one, and the baseline is
    below 1.000 because of it. A baseline of 1.000 says the set was trimmed to what already
    passes.
- **Every declared synonym is load-bearing**, asserted mechanically:
  `tests/evals/harness.test.ts` removes each in turn and requires the eval score to fall.
  The layer grows throughout the build by design, and a comment cannot hold the line that
  each addition was earned — a synonym nothing fails without is one nobody earned.
- **Rejection tests** (`tests/rejection.test.ts`) — questions the semantic layer cannot
  answer must produce a clarifying question, never a coerced near-match. Asserted on the
  returned object: that it validates, that it names what is missing and what is declared,
  and that every `nearest` spec it offers actually executes. A test asserting only
  `toThrow()` would pass against exactly the design this avoids.
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

**`npm run eval` runs on the same native stripping, through one extra file.** Everything
under `src/server/` outside `ingest/` is written for a bundler — it imports through the `@/`
alias and omits file extensions — and Node's ESM resolver knows neither convention. Both are
already declared twice, in `tsconfig.json` and again in `vitest.config.ts`;
`scripts/module-alias.mjs` is a third mirror of that one declaration for the one runtime
with no resolver of its own. It is ~30 lines on `module.registerHooks`, loaded by
`--import`, resolving `@/x` under `src/` and filling in a missing `.ts` or `/index.ts` on a
relative specifier, and deferring everything else to Node. It adds no dependency and no
build step, which is the point: `tsx` or `ts-node` would break the zero-config
`npm install` this project is sold on, for a script that runs in under a second.

**The conformance driver is a devDependency and nothing else is.** `pg` 8.23.0,
`pg-copy-streams` 6.0.6 and their types exist for `tests/conformance/` alone; the
application has no database and ships none. `tests/conformance/corpus.test.ts` asserts
they are absent from `dependencies`, and `next build` produces a bundle with no trace of
the adapter or the driver.

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

**`agentRules: false` is set in `next.config.ts`.** Next 16.3 appends a generated block
to `AGENTS.md` on every `next dev` start
(`node_modules/next/dist/server/lib/generate-agent-files.js`), which made `npm run dev`
dirty a tracked file on every run — found by GA-07, the first increment with a route to
serve. `AGENTS.md` here is the project's agent contract: the invariants an agent must not
break and the decisions already settled, each landed deliberately with its rationale. A
document whose authority rests on being deliberate cannot be partly automatic, so the flag
is off and the guidance the block carries is cited here instead: **Next 16 is not the Next
16 a model was trained on** — `node_modules/next/dist/docs/` is the version-accurate
reference, and the async-only note above is one instance of why.

**Rejected: DuckDB-WASM.** 142 MB unpacked for a 100,836-row dataset, and shipping a
SQL engine to display SQL a non-technical user cannot read contradicts the thesis.

## 11. The surface

Landed by GA-10. What the user actually sees, and the decisions that constrain what a
later increment may put there. `docs/design.md` §6 owns the *arrangement* — takeaway,
chart, recipe sentence, provenance, with the persistent column holding recipes and the
question box subordinate to the answer. This section is the technical half.

### Tailwind v4 carries the theme, and the theme is the design system

`shadcn init -b radix -p nova` writes a neutral greyscale house style into
`src/app/globals.css`. It is replaced, not extended. `design-system/styles.css` is the
version of record (invariant 14, "the theme is the approved look"), so every colour,
radius, type step and duration in the app is one of its `--ga-*` tokens, declared once on
`:root` and then **mapped onto the semantic names shadcn's components read** —
`--primary` to `--ga-accent`, `--muted-foreground` to `--ga-ink-muted`, `--radius-4xl` to
the pill the trust strip is drawn with. `@theme inline` re-exports both vocabularies as
utilities, the design system's under a `ga-` prefix so a component says which one it is
speaking.

Two mappings are worth reading twice.

**`--accent` is not the accent.** In the design system "accent" is the single strong
emphasis colour; in shadcn it is the *quiet* ground a hovered or selected row sits on.
They are mapped accordingly (`--accent` → `--ga-accent-soft`), and the strong colour is
`--color-ga-accent`.

**The `dark` variant is kept and never used.** `@custom-variant dark (&:is(.dark *))`
re-points Tailwind's `dark:` at a class nothing sets. Deleting the line does not remove
dark mode — it restores Tailwind v4's built-in `prefers-color-scheme` behaviour, and
every `dark:` utility inside the shadcn components would then fire on a machine set to
dark, repainting the approved look with greys that were never contrast-checked. There is
one theme here, `color-scheme: light` says so, and the line is what holds it.

**The mock's hex values are not the theme.** The interactive mock was drawn against
`--accent:#5B45D6`; `design-system/README.md` records that landing the tokens moved the
accent to `#0A6FD1` and `--ga-ink-muted` to `#655F7C`, because two measured contrast
defects were fixed at the token definition. The surface inherits the fixes rather than the
drawing.

### Three components, each earned

Invariant 14 says a shadcn component is added when a screen needs it. This screen took
**card** (the takeaway and the chart panel), **button** (the rail's new-question control
and the composer's starter-questions control) and **badge** (the trust strip's pills).
Nine of the CLI's components were verified in §10 and are not installed.

**The `<table>` is deliberately not shadcn's.** shadcn's table nests the `<table>` inside
a scroll container — four utility classes' worth of styling, in exchange for a `<div>`
between the figure and the one element this increment's accessibility claim rests on. It
is written as plain semantic markup instead.

**The starter chips are buttons, not cards.** They are activated, so they are `<button>`;
the card look is styling. A `<div role="button">` would have to re-implement Enter, Space
and the focus ring that `:focus-visible` already gives every control.

### Observable Plot renders on the client, lazily

Server-rendering Plot needs a DOM, which means jsdom, which §10 measured at ~755 ms of
cold import — paid on every cold start, for no accessibility gain, because the accessible
artifact is the `<table>` the server already produces. So `Plot.plot` is called only
inside `"use client"` code, and the module is loaded with a dynamic `import()` inside the
effect so it stays out of the page's first load. `tests/ui/surface-rules.test.ts` asserts
both: every file calling `Plot.plot` carries the directive, and no file imports Plot at
module scope.

**The chart's form comes from the spec, not from the dataset.** A spec ordered by its
measure is a ranking and renders as horizontal bars; a spec ordered by its breakdown is a
sequence and renders as a line. The rule reads `spec.sort.by` and nothing else, so no
dataset-specific knowledge lands in the surface (invariant 6).

**The bar axis starts at zero, and the sequence is drawn with straight segments.** The top
ten titles sit between 4.28 and 4.47, so a zero-based axis draws ten bars of nearly the
same length — and that flatness is the finding. Truncating the axis to the data's range
would read as a large difference where the numbers say a small one, which is this
product's own failure mode drawn as a picture. For the same reason a sequence is not
smoothed: a monotone spline draws values between two members that the engine never
computed.

**A breakdown member is ordinal even when it is spelled with digits.** The sequence chart
sets `x.type: "point"` explicitly. `2018` is a declared member, not a quantity, and an
inferred linear scale would place members at numeric distances the engine never claimed.

### The accessible chart is a reachable table, not a hidden one

`docs/design.md` §7 asks for a semantic `<table>` behind every chart, **reachable rather
than merely present**. It is a native `<details>`/`<summary>` disclosure: a `<summary>`
carries an implicit `button` role, is in the tab order, toggles from Enter and Space, and
keeps working when the client bundle does not load. A visually-hidden copy is the
forbidden shortcut — present in the accessibility tree and unreachable for everyone else —
and `tests/ui/answer-card.test.tsx` asserts against `visibility:hidden`, `display:none`
and `sr-only` inside the disclosure.

The Plot SVG itself is `aria-hidden`. A Plot figure exposes dozens of tick labels and path
elements that announce as a wall of disconnected numbers; the table announces the same
figures once, with their row headers, in a form that carries their meaning.

### `src/lib/intl.ts` is the only formatter on the surface

Invariant 12 in one module. It exports `value`, `count`, `date` and `column`, memoised per
locale, and `tests/ui/surface-rules.test.ts` proves the rule by reading the source: nothing
under `app/`, `components/` or `lib/` constructs its own `Intl` formatter, and nothing
anywhere calls `toFixed`, `toLocaleString` or `toPrecision`.

**`column` writes a whole column to one width.** `Intl` drops trailing zeros, so a ranked
list renders `4.47` and then `4.3`, and a precision that changes row by row reads as a
defect in a face chosen for its tabular numerals. The digit count is taken from the widest
value in that same answer and applied to all of them, capped at four. No precision is
invented, and nothing is rounded here — the engine already rounded to the presentation
scale (§5a).

**Dates render in UTC.** Every instant in this product is ISO-8601 UTC (§2a), and an
as-of of `2018-09-26T00:00:00.000Z` rendered in the reader's own zone names *25 September*
anywhere west of Greenwich. An answer whose stated moment moves with the reader is a
confident wrong answer wearing a timestamp, and it would also make the server and the
client disagree on the first paint.

**The declared alternative is a per-measure display format in the semantic layer**, which
would state the presentation scale rather than infer it from the rows. That is a GA-03
schema change and it is the next layer field this build wants; it is recorded rather than
taken.

### The zero state cannot show a computed result, structurally

build-spec §1.2 forbids a score card, a metrics row, a sparkline or any standing tile, and
permits exactly one thing: naming the data source. The permission is honoured by reading
the compiled store's **manifest** — the ETL's own declaration of what it received — rather
than by running a spec. `src/app/page.tsx` and `src/server/surface/zero-state.ts` import
neither `engine/` nor `warehouse/`, which `tests/ui/surface-rules.test.ts` asserts, so the
first paint has nothing to compute with. A second test enumerates every numeral in the
rendered text.

Each starter chip's second line — "average rating, by title" — is generated from the
layer's declared labels. A hand-written caption and the spec it describes drift apart
silently, which is this product's own failure mode pointed at its zero state.

### What the shell owns, and what it does not

`AskSurface` keeps one piece of state: the current answer. There is **no message list**,
because §2 makes the spec the unit of conversational state and a transcript is a settled
rejection. A second question aborts the first rather than racing it; two answers
interleaving into one region is how a figure ends up under the wrong heading. Focus moves
to the answer when it arrives, with `preventScroll`, so a keyboard user is taken to the
takeaway rather than to the region's end.

**The composer's free-text field is disabled, and says why on the control.** Under the §0
cut there is no interpret call and there will not be one. `ai/fallback-parser.ts` reads
declared vocabulary and refuses the rest by design, so a box accepting any sentence would
promise a reading it cannot perform — the confident-answer failure this product exists to
remove, pointed at its own input. `docs/design.md` §8 rejects a persistent no-key banner
because it keeps charging for a fact the user has already taken in; a disabled control
explaining itself is the control's own state, read once, where the user tries to act.

**Provenance is inline, not a drawer.** GA-14 is deferred, so "How did you get this?" is a
`<details>` listing the fields already on `resultSet.provenance`. Nothing is recomputed:
the point of the block is that the numbers above it can be reproduced, and a provenance
the surface assembled for itself would be a second account of the same run. It also means
this increment ships no overlay, so the focus defect §10 records against the drawer
primitive cannot apply to it.

### The catch is the answer's head, and it is conditional by construction

`docs/design.md` §3 makes the naive/honest comparison the wedge, so GA-12 renders it
**open, full width, above the chart, as the largest object on the screen**, with the
takeaway folded into its head. Measured on the shipped surface at 430px: the block is 1,864
CSS pixels tall against the chart card's 476, both at the column's full 468.

The answer's head is one of three, and exactly one — `ChecksOffBlock` when the escape was
taken, `CatchBlock` when `trust.comparison` is not null, and the plain takeaway card
otherwise. The narration is built once in `AnswerCard` and handed to whichever head runs,
so the prose and its cut-short caution cannot drift between three renderings of the same
sentence.

**Nothing manufactures a catch.** The block is drawn from `trust.comparison`, which the
engine returns as null unless emptying the guards changed the answer materially, so an
answer no check moved draws nothing at all — there was never a dead-furniture problem to
hedge against, and `tests/ui/catch-block.test.tsx` drives that assertion from
`materiallyDifferent` itself rather than from a hand-written expectation.

**Copy never inflects a declared label.** A label is layer data, and pluralising it is the
coercion invariant 4 forbids arriving through a copy string, so the block follows the idiom
the trust strip already ships: `{n} {label} values`. The approved mock reads "296 titles";
the surface reads "296 title values", and that difference is deliberate. Words the surface
owns — `record`/`records` — *are* inflected, because the escape made `n === 1` reachable
for the first time and "as few as 1 records" is the sentence carrying the whole argument.

**Copy never claims an ordering the spec did not make.** The block reads `shape` — the
same `spec.sort.by` rule the chart reads — for every clause on the naive side, the honest
side's detail and the closing fallback, not just the subhead. A sequence is ordered by its
breakdown, so its first row is the earliest member and calling it a leader is a claim the
ordering does not make; `ai/narrate-template.ts` refuses the same word for the same reason.
The block renders for sequences regardless: withholding it would hide a true catch, which
is the mirror of manufacturing a false one.

**One column formatter spans both lists.** `Formatters.column` exists so a column does not
appear to change precision row by row; two lists set side by side to be compared are one
column for that purpose. Taken separately the naive side is all exactly `5` against the
honest side's `4.47`, which is the same defect drawn twice as wide.

### The escape is loud on both sides of the re-run

build-spec §3 GA-12 forbids a silent escape, and the mechanism actively works against
that: turning the checks off empties the spec's guards, which is what the naive run does,
so the answer that comes back carries **no comparison to draw and no guard pills in the
trust strip**. Left there, the loudest screen in the product would quietly become the one
it was built to argue against.

Two signals, both verified live. The trust strip's guard pills are gone and its coverage
reads every record and every member — 100,836 of 100,836, 9,742 of 9,742. And
`ChecksOffBlock` renders in the catch's own slot, at the catch's own size, naming each
check that is not running with the `explanation` the layer declares, marked *Not applied*.

It needs one thing the answer cannot supply, and that is the whole reason the surface
carries state across a re-run: an escaped answer's trust report has no guards in it, so
`AskSurface` keeps the *previous* answer's `guardsApplied` and hands it down as
`checksOff`. The ids sent to the route come off that same report, so the escape can only
turn off checks that actually ran on the answer being looked at.

GA-11 adds the third signal, when there is a recipe sentence to rewrite. **No part of that
sentence is built here** — C1's swap moved the catch ahead of the sentence, and borrowing
the sentence to make the escape's signal work is the boundary the swap created.
