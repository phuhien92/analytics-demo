# Golden Analytics — Design

Date: 2026-09-18
Status: Approved for planning

## 1. The problem

Business users cannot get value from their own data. The marketing analyst files a
ticket and waits two days. The sales ops manager squints at a spreadsheet. The
business owner does not know where to start. They are not technical. They are
smart, they have real questions, and they are stuck.

## 2. Why this wedge

Market research (Sept 2026) found the space crowded in four segments:

| Segment | Who | Sells |
| --- | --- | --- |
| File-first | Bricks, Polymer, Rows | Speed to a dashboard |
| AI-native | Julius, Basedash, Querio, Hex, Dot, Zenlytic | Conversational range |
| Incumbent + AI | ThoughtSpot, Omni, Sigma, Looker, Power BI | Governance, sold to the data team |
| Warehouse-native | Databricks Genie, Snowflake Cortex | AI where data lives |

Two findings shaped this design.

**"Canva for data" is taken.** Bricks markets itself as "the Goldilocks tool between
Canva's ease-of-use and Tableau's power" — 100,000+ users, enterprise logos. It is a
fine north star, not a wedge.

**Everyone races on query accuracy; nobody solves silent failure.** The sources agree
against their own commercial interest:

- "Text-to-SQL fails silently and confidently. The output may look right, even if
  it's wrong." (Omni)
- "Catching the error requires reading the generated SQL and understanding it — the
  same expertise the tool was supposed to replace." (Omni)
- Raw text-to-SQL scores ~40% on real enterprise schemas; 85–95% with a semantic
  layer. The fix is structure, not a better model.
- Fewer than 30% of business users could run their own analyses in Tableau/Looker
  (Gartner, 2024).
- Anthropic (June 2026): giving an agent grep access to thousands of real SQL files
  moved accuracy under one point — the bottleneck was structure, not access. They
  report the silent wrong answer as still unsolved; their mitigations are a
  provenance footer and standing evals.

An analyst who cannot write SQL cannot audit SQL. A confident wrong number is worse
for her than the two-day ticket, which at least had a human in it.

## 3. Product thesis

**The AI's value is not answering the question you asked. It is telling you that the
question you asked would have misled you.**

Three rules follow, and they are the whole design:

1. **AI interprets; it never computes.** The model turns a question into a query
   spec. A deterministic engine produces every number.
2. **The recipe is read, never authored.** The user types a question in their own
   words. The system produces the complete recipe. The user only confirms or nudges.
   Authoring is recall and it is what killed self-service BI; reading is recognition.
3. **Trust is the proof, not the promise.** We do not ask the user to verify us. We
   show them the answer they would have got, then the honest one.

### Positioning

Lead with the catch: *it catches what you'd have missed*. Not "an answer you can
defend" — that is a negative proposition that sells the absence of a bad thing to a
user who has never been burned, and it answers step 2 while she is stuck at step 1.

### Known limitation, stated honestly

A user who cannot evaluate SQL can only partly evaluate our recipe sentence. She will
catch "by year" when she meant "by genre". She will not catch a subtly wrong filter.
The verification is genuine but partial. We must not overclaim it, or we reproduce the
silent failure we are criticising. Copy must say what was checked, never "verified".

## 4. The dataset

MovieLens `ml-latest-small` (GroupLens, generated 2018-09-26). 9,742 movies, 100,836
ratings, 3,683 tags, 610 users, Mar 1996 – Sep 2018. Ratings 0.5–5.0 in half-star
steps. Four CSVs join on `movieId`; `userId` is consistent across `ratings` and `tags`.

Framed for a business audience: users = customers, movies = products, ratings =
satisfaction scores, genres = categories, tags = verbatim feedback.

### Verified data traps

Measured directly, not assumed:

| Trap | Verified |
| --- | --- |
| Titles averaging a perfect 5.0 | 296 — every one has ≤2 ratings |
| Rated titles with fewer than 20 ratings | 8,427 of 9,724 (86.7%) |
| Titles with zero ratings | 18 |
| `(no genres listed)` | 34 |
| Genre assignments per movie | 2.27 average — every genre chart double-counts |
| Release year | buried in the title string; 13 have no parseable year |

**Rejected guard:** an earlier hypothesis that ratings drifted upward over time is not
supported. Yearly means oscillate between 3.31 and 3.88 with no monotonic trend
(1996: 3.54, 2007: 3.31, 2013: 3.88, 2018: 3.39). Do not ship it.

### The hero moment

`"What are our top rated titles?"`

Naive answer — 296 titles tied at 5.00, led by *Lesson Faust (1994)* (n=2),
*Lamerica (1994)* (n=2), *Heidi Fleiss: Hollywood Madam (1995)* (n=2).

Honest answer, requiring 20+ ratings — *A Streetcar Named Desire* 4.47 (n=20),
*The Shawshank Redemption* 4.43 (n=317), *Sunset Blvd.* 4.33 (n=27),
*The Philadelphia Story* 4.31 (n=29).

Because 86.7% of the catalogue has thin evidence, the naive list is essentially noise.
This is real, not contrived, and it is the product in one screen.

## 5. Architecture

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
section 12 for why neither is deferrable under this test.

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
scripts/build-warehouse.ts    ETL: CSV -> compiled store
semantic/movielens.json       THE SEMANTIC LAYER — versioned data, not code
src/
  server/
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
  engine.test.ts
  conformance/                spec -> expected numbers; EVERY adapter must pass
  evals/questions.jsonl       question -> expected-spec pairs
```

## 6. The QuerySpec

The central artifact. Every safety property falls out of its shape.

```ts
type QuerySpec = {
  measure:    MeasureId
  breakdown?: DimensionId
  filters:    Filter[]
  sort:       { by: "measure" | "breakdown"; dir: "asc" | "desc" }
  limit:      number
  guards:     Array<{ id: GuardId; params: Record<string, number> }>
}
```

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

## 7. Semantic layer

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

## 8. Trust guards

Declared in the semantic layer, implemented in `guards/registry.ts`. Each has a safe
default already applied, a plain-English explanation, and a one-tap escape. Never a
warning that hands the user homework.

| Guard | Default | Rationale (verified) |
| --- | --- | --- |
| `min_evidence` | 20 ratings per title | 86.7% of titles fall below it |
| `disclose_multi_membership` | on | 2.27 genres per title — every genre chart double-counts |
| `exclude_uncategorised` | on | 34 titles with no genre |
| `exclude_unrated` | on | 18 titles never rated |

**Naive comparison** is not a guard but an engine behaviour: run the spec with guards
applied and with `guards: []`, and surface the difference when it is material.

## 9. Warehouse interface

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

## 10. AI usage

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

## 11. Interface

Default view, in order: plain-English takeaway, chart, one-line recipe sentence with
tappable phrases, and "How did you get this? →" opening the provenance drawer.

The recipe renders as a **sentence, not a form**:

> I looked at the *average rating*, broken down by *genre*, ignoring anything with
> *fewer than 20 ratings*.

Each italicised phrase is tappable and opens a short closed list of plain-English
options — never free text, never a formula. Invalid states are unreachable, so
exploration is consequence-free.

The zero state is starter questions, never a blank builder.

Charts: Observable Plot, form chosen by the shape of the result (ranked categories →
horizontal bars; time → line; distribution → histogram).

## 12. Accessibility and internationalisation

### Accessibility is core, not a nice-to-have

Three reasons it ships in v1:

1. **Cost asymmetry.** Semantic HTML, keyboard navigation on the recipe chips, focus
   management and contrast cost almost nothing when built in, and require touching
   every component when retrofitted.
2. **Market access.** The European Accessibility Act has applied since June 2025 and
   covers a broad range of digital services sold into the EU; enterprise procurement
   asks for WCAG 2.1 AA and a VPAT independently of that. Verify exact scope against
   the go-to-market, but the direction is not in doubt.
3. **It is the same feature as the trust thesis.** Our primary output is a chart — the
   worst artifact for a screen-reader user. But the plain-English takeaway and the
   recipe sentence *are* the accessible representation of that chart. A screen-reader
   user hears "Film-Noir leads at 4.1, 0.4 above the catalogue average, based on
   18,204 of 100,836 ratings", which carries more than bars alone convey to a sighted
   user. Deferring accessibility would mean discarding something the design already
   produces.

Requirements: WCAG 2.1 AA contrast · full keyboard operation of chips and the
provenance drawer · visible focus states · a semantic `<table>` behind every chart,
reachable not merely present · ARIA on interactive chips and the drawer ·
`prefers-reduced-motion` respected · no information carried by colour alone.

### Internationalisation: ready, not translated

Split deliberately:

- **Structural (v1)** — locale-keyed labels and synonyms in the semantic layer
  (section 7); `Intl.NumberFormat` and `Intl.DateTimeFormat` for all numeric and date
  output, since a decimal comma versus a decimal point changes whether 4,47 reads as a
  rating or a count; the narrate call takes locale as a parameter.
- **Deferred** — actually translating UI chrome, RTL layout, and any locale beyond
  `en`. Cheap whenever it happens, because nothing structural blocks it.

Noted for later: the 5-star scale is itself a cultural convention, and rating
distributions are not comparable across locales that interpret it differently.

## 13. Error handling

- **Ambiguous question** → clarifying question with concrete options. Never a guess.
- **Out-of-scope request** → say plainly what this data can and cannot answer, and
  offer the nearest question that works.
- **Empty result** → say so, and offer the nearest question that returns something.
- **AI unavailable** → fallback parser; the app degrades, it does not break.

## 14. Testing

- **Vitest** over the engine. Pure functions, so the determinism claim is provable
  rather than asserted: same spec always yields the same numbers.
- **Guard tests** pinned to the verified figures in section 4 (296, 8,427, 34, 18,
  2.27). These double as regression tests on the ETL.
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

## 15. Stack

Next.js 16.3.5 (App Router, TypeScript) · `@anthropic-ai/sdk` 0.127.0 ·
Observable Plot 0.6.17 · Zod · Vitest · Vercel-ready.

Note: Next 16 removed synchronous access to `params`, `searchParams`, `cookies` and
`headers` — all are async-only.

**Rejected: DuckDB-WASM.** 142 MB unpacked for a 100,836-row dataset, and shipping a
SQL engine to display SQL a non-technical user cannot read contradicts the thesis.

## 16. Out of scope

Auth. Multi-dataset upload. A visual chart editor. Writing back to any source.
Recommender modelling. Dashboards or saved reports. Anything requiring a real
warehouse connection — the interface exists so it can be added, but no adapter ships.

## 17. README requirements

Per the brief, the README must cover: the dataset in use, why this was built, how AI
was used to build it, and what would come next with more time.
