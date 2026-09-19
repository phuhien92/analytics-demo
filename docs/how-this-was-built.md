# How this was built

Golden Analytics went from market research to an approved design to a verified stack to a
sixteen-increment build spec before a line of application code was written. This document is
the record of that, and it is kept running rather than reconstructed.

It has three parts.

**Part one** is the decision trail: what was decided, the evidence that drove it, what was
rejected, and what deciding it later would have cost. One entry per decision, short enough to
scan. The whole of it reads in about fifteen minutes; the linked source carries the depth.

**Part two** is the method — how the work was done, stated so it can be adopted. That is the
part worth stealing.

**Part three** is the build: the same kind of entry, one section per increment, added as each
one lands rather than reconstructed at the end.

## How to read the sources

Entries cite the document that holds the evidence.

- `docs/design.md` and `docs/market-research.md` are in this repository. Section numbers are
  design.md's as it stood before the split: the technical sections they name — architecture,
  the QuerySpec, the semantic layer, the warehouse interface, AI usage, testing and the stack
  — now live in `docs/architecture.md` under their own numbering. The citations below are left
  as written, because each was correct when it was made.
- Three research reports — **stack research** (1,058 lines), **UI direction** and the
  **build spec** — are working documents kept with the research working set rather than in
  this repository. They carry the spikes, the measurements and the reasoning behind
  everything summarised here. Where a figure appears below it was measured in one of them,
  not assumed.
- `AGENTS.md` carries the invariants and the settled-decisions table — the contract, not the
  history.

This document does not restate the design. Where an entry has a design consequence it links
to the section rather than repeating it.

---

# Part one — how the product was designed

All of this happened on **2026-09-18**. The date is on each entry as the record requires, but
the numbers are the thing that carries sequence: this was one day's work, not one day's
calendar.

---

### 1. The wedge is silent failure, not query accuracy

**2026-09-18** · `docs/market-research.md` §2–3

**Decided.** Build against the confident wrong answer a non-technical user cannot detect,
not against query accuracy.

**Evidence.** The market splits into four segments — file-first (Bricks, Polymer, Rows),
AI-native (Julius, Basedash, Querio, Hex, Dot, Zenlytic), incumbent BI plus AI (ThoughtSpot,
Omni, Sigma, Looker, Power BI) and warehouse-native (Databricks Genie, Snowflake Cortex) —
and all four race on the same axis. The failure-mode claims agreed *against their sources'
own commercial interest*: Omni, a vendor, writes that "text-to-SQL fails silently and
confidently" and that "catching the error requires reading the generated SQL and
understanding it — the same expertise the tool was supposed to replace." Raw text-to-SQL
scores ~40% on real enterprise schemas against 85–95% with a semantic layer. Fewer than 30%
of business users could run their own analyses in Tableau or Looker (Gartner, 2024).
Anthropic (June 2026) reported that giving an agent grep access to thousands of real SQL
files moved accuracy by under one point — the bottleneck was structure, not access — and
that the silent wrong answer remains unsolved.

**Rejected.** Competing on conversational range or speed-to-dashboard. Both are contested by
funded incumbents and neither addresses the failure every source names.

**Later would have cost.** Everything downstream. The wedge determines the thesis, the
architecture and the hero moment; discovering it after a build is a restart.

---

### 2. The thesis, and the three rules that follow from it

**2026-09-18** · `docs/design.md` §3

**Decided.** *The AI's value is not answering the question you asked. It is telling you that
the question you asked would have misled you.* Three rules follow: **AI interprets, never
computes**; **the recipe is read, never authored**; **trust is proof, not promise**.

**Evidence.** The reasoning is three steps and it is short. The brief describes an analyst
who cannot write SQL. That analyst cannot audit SQL either. So a confident wrong number is
*worse* for her than the two-day ticket, which at least had a human in it. Authoring is
recall, and recall is what killed self-service BI — hence rule 2. Rule 3 follows from the
first two: if the user cannot verify us, we must show her the answer she would have got
beside the honest one, so belief comes from the comparison rather than from a claim.

**Rejected.** Asking the user to verify the tool. That is the failure mode restated as a
feature request.

**Later would have cost.** The three rules are what make the `QuerySpec` shape, the
deterministic engine and the narrate boundary necessary rather than tasteful. Reversing them
is a rewrite of every layer.

---

### 3. Positioning: lead with the catch

**2026-09-18** · `docs/market-research.md` §4, `docs/design.md` §3

**Decided.** *It catches what you'd have missed.*

**Rejected, with reasons.**

| Rejected | Why |
| --- | --- |
| "Canva for data" | Occupied. Bricks markets itself as "the Goldilocks tool that sits perfectly between Canva's ease-of-use and Tableau's power", with 100,000+ professionals claimed. A fine north star; not a wedge. |
| "An answer you can defend in Monday's meeting" | A negative proposition. It sells the absence of a bad thing to a user who has never been burned by it, and it answers step 2 while she is stuck at step 1. |

**Evidence.** Same machinery underneath either phrasing; opposite posture. "We catch the
mistake you were about to make" is a capability. "You can verify our answer" is a
disclaimer.

**Later would have cost.** Positioning drives the interface. The rejected framing puts the
question box at the centre; the accepted one puts the catch there — which is
[entry 18](#18-the-question-box-is-demoted-the-catch-is-the-answer).

---

### 4. The dataset's traps, measured rather than assumed

**2026-09-18** · `docs/design.md` §4, `AGENTS.md`

**Decided.** Pin six measured figures as guard tests that double as ETL regression tests, and
build the hero moment on them.

**Evidence.** Measured directly from MovieLens `ml-latest-small` (9,742 movies, 100,836
ratings, 610 users, Mar 1996 – Sep 2018): **296** titles average a perfect 5.0 and every one
has ≤2 ratings; **8,427 of 9,724** rated titles have fewer than 20 ratings (86.7%); **18**
titles have zero ratings; **34** carry `(no genres listed)`; genre assignments average
**2.27** per movie, so every genre chart double-counts; **13** titles have no parseable year.

The hero moment falls straight out of it. `"What are our top rated titles?"` returns 296
titles tied at 5.00 naively, against *A Streetcar Named Desire* 4.47 (n=20) and *The
Shawshank Redemption* 4.43 (n=317) honestly. Because 86.7% of the catalogue has thin
evidence, the naive list is noise — and it is exactly the list a speed-optimised tool hands
you.

**Rejected.** A contrived demo. The rule recorded in `AGENTS.md` is "keep it real, never
contrived".

**Later would have cost.** The hero moment is the product in one screen. Building the
architecture first and hoping the data would cooperate risks discovering it does not.

---

### 5. The ratings-drift guard is rejected — the data does not support it

**2026-09-18** · `docs/design.md` §4

**Decided.** Do not ship a guard for ratings drifting upward over time.

**Evidence.** Yearly means oscillate between **3.31 and 3.88** with no monotonic trend —
1996: 3.54, 2007: 3.31, 2013: 3.88, 2018: 3.39.

**Rejected.** The guard itself, and with it a plausible-sounding demo beat.

**Later would have cost.** Little in build time, a great deal in credibility. A product whose
entire pitch is catching unsupported conclusions cannot ship a check that is itself an
unsupported conclusion.

---

### 6. DuckDB-WASM is rejected

**2026-09-18** · `docs/design.md` §15, `AGENTS.md` settled decisions

**Decided.** No in-browser SQL engine.

**Evidence.** 142 MB unpacked for a 100,836-row dataset. And the thesis argument, which is
the stronger one: shipping a SQL engine in order to display SQL a non-technical user cannot
read contradicts the product.

**Rejected.** DuckDB-WASM specifically. The rejection was later confirmed to cover WASM only
— server-side DuckDB was never in its scope and remains a future candidate (stack research,
step 5).

**Later would have cost.** A 142 MB dependency is not removed quietly once a UI is built on
its query surface.

---

### 7. Design review: three things production would *replace*, fixed before any code

**2026-09-18** · `docs/design.md` §5

**Decided.** Apply one test to every architectural element — would production *extend* it
(additive, safe to omit) or *replace* it (a rewrite, not safe to omit)? Three replace-class
defects were found in the draft and fixed.

| Defect in the draft | Fix |
| --- | --- |
| `guards: { minRatingsPerTitle: number }` — a MovieLens assumption sitting inside the portable core type | Guards become a **declared registry**; `GuardId` resolves against what the semantic layer declares |
| Single-shot question answering | Conversation becomes **spec amendment**: a follow-up emits a `SpecPatch` against the previous spec |
| Semantic layer as code | The layer becomes **versioned JSON** — editing or reviewing it is a normal operation |

**Evidence.** Each is a rewrite rather than an edit if deferred. Pointed at sales data,
`minRatingsPerTitle` is meaningless and every adapter, validator and prompt changes. Adding
amendment later restructures the API contract, the UI state model and the prompt strategy
simultaneously. A layer only a developer can edit reinstates the human the product removes —
and the market research names semantic-model *production* as the real bottleneck.

**Rejected.** Shipping the draft and extending it later. The extend/replace test is what made
that a decision rather than an assumption.

**Later would have cost.** Three simultaneous rewrites across every layer, discovered at the
point the product is pointed at a second dataset.

---

### 8. Accessibility and locale-keyed labelling move into v1

**2026-09-18** · `docs/design.md` §12 · commit `62834ea`

**Decided.** WCAG 2.1 AA, full keyboard operation, a reachable semantic `<table>` behind
every chart, no meaning carried by colour alone — all in v1. Labels and synonyms are
locale-keyed in the semantic layer; `Intl` for every numeric and date render.

**Evidence.** Both passed the same extend/replace test as entry 7. Retrofitting focus
management and semantic structure touches every component. A flat label shape makes
internationalisation a schema rewrite *plus* a prompt rewrite *plus* a matching rewrite,
because synonyms are how questions match measures — so understanding is itself
locale-dependent. And the third argument is the one that settled it: **accessibility is the
same feature as the trust thesis.** The plain-English takeaway and the recipe sentence *are*
the accessible representation of the chart. Deferring accessibility would mean discarding
something the design already produces.

`Intl` earns its own line: a decimal comma changes whether **4,47** reads as a rating or a
count.

**Rejected.** Deferring either. UI translation and RTL layout *are* deferred — that is
volume, not shape, and nothing structural blocks it.

**Later would have cost.** Auditing every render site, and a schema-plus-prompt-plus-matching
rewrite at the first non-English locale.

---

### 9. The invariants and the settled decisions become a contract

**2026-09-18** · `AGENTS.md` · commit `f95e8c8`

**Decided.** Write the thirteen prime invariants and a settled-decisions table into
`AGENTS.md`, with the rule that if code and `docs/design.md` disagree, the doc wins until the
doc is changed — and a design change lands in the document first, with its rationale, then in
code.

**Evidence.** By this point the product had accumulated a set of rejections — the two
positionings, DuckDB-WASM, the drift guard, `minRatingsPerTitle` in the core type, single-shot
answering — whose reasoning lived only in the conversations that produced them. A rejected
option with no recorded reason is an option that comes back, and the ones above come back
looking reasonable.

**Rejected.** Keeping the reasoning in review threads. It does not survive the people who
were in them, and every increment after this one is worked by someone who was not.

**Later would have cost.** Relitigation, and worse — silent reversal, where a later increment
reintroduces a rejected shape because nothing in the repository says it was rejected.

---

### 10. Data scope: a staged inbound integration, with the as-of point added now

**2026-09-18** · a product call; consequences worked out in stack research, steps 2, 5 and 9

**Decided.** Four parts, taken together.

1. The shape of "meet the data where it is" is **inbound integration** — partner applications
   push data over a webhook or API.
2. The held dataset is **reframed as one such payload**, not a build-time fixture.
3. **The receiver is not built for the demo.** The demo ships the receiver-shaped seam behind
   the existing `Warehouse` interface.
4. **An explicit as-of point is added now**, while it is cheap.

**Evidence.** An integration payload has a known, stable shape, so a semantic layer is
declared **once per integration** and every customer on that integration inherits it. That
compounds in a way uploaded files never do, and the market research names authoring as *the*
bottleneck. The `QuerySpec`, the guards and the engine are untouched — the received payload is
another implementation behind `aggregate(spec)`.

**Rejected.** File ingest, and a second warehouse adapter, both as the primary shape. Also
rejected: building the receiver for the demo, which buys the credibility of "we can take your
data" at the cost of running a data pipeline before anyone is paying for one.

**Later would have cost.** Part 4 is the expensive one, and it is why the decision was taken
early — see [entry 14](#14-blocking-determinism-needs-an-as-of-point-and-invariant-10-needed-rewording).
Parts 1–3 also make §16's exclusion of auth and multi-tenancy time-bounded rather than
permanent: they stop being out of scope the moment the receiver ships.

---

### 11. The semantic layer starts at its thinnest viable, and evals are day-one

**2026-09-18** · a product call; consequences worked out in stack research, steps 6 and 8

**Decided.** Measures and dimensions only. The eval harness is a day-one requirement, not a
testing detail. Every later piece of structure must be **earned by a failing eval**. Richness
of the semantic layer stops being a selling point.

One carve-out was applied: the four trust guards stay in the initial layer. Read literally,
"measures and dimensions only" would remove `min_evidence`,
`disclose_multi_membership`, `exclude_uncategorised` and `exclude_unrated` — and with them the
296-titles-at-5.00 comparison, which is the product. "Thinnest viable" is read as thin in
**synonyms, locale labels and filter vocabulary**, with guards intact.

**Evidence.** Anthropic's reported lesson was that evals, not model choice, drove accuracy.
Under this decision the harness stops being a test suite beside development and becomes the
*mechanism by which the product acquires structure at all*.

**Rejected.** The design's fuller layer, and the split option (rich guards, minimal synonyms)
that was recommended — taken against the recommendation, deliberately.

**Later would have cost.** Nothing, in the layer itself: volume is extend-class and grows back
for free. The cost sits in the *shape*, which is why entry 8's carve-out holds — labels stay
locale-keyed even while shipping no synonyms, because evals cannot warn about shape. A flat
layer passes every eval right up until the first non-English locale.

**And one consequence nobody predicted, found by measurement.** A thin layer makes the cached
prompt prefix small, and Opus 5's minimum cacheable prefix is **512 tokens**. The thinnest-viable
layer estimates at **~373–620 tokens** — it straddles the floor. With five few-shot examples the
prefix reaches **~774–1,032** and clears it under every estimate. So few-shot examples, normally
the first thing trimmed for cost, are here **load-bearing for cost**, and the failure mode is
silent: no error, just full input price forever. Three cheap rules follow — keep at least five
examples, do not minify the layer, and assert `cache_read_input_tokens > 0` across two identical
requests, because that is the only way the failure becomes visible.

---

### 12. The stack is validated by compiling against it, not by reading its documentation

**2026-09-18** · stack research, step 4

**Decided.** Keep the named stack. Add one pin the design left open.

**Evidence.** Every version was checked against the npm registry on the day: `next` 16.3.5,
`@anthropic-ai/sdk` 0.127.0 and `@observablehq/plot` 0.6.17 are all current `latest`, matching
the design's pins exactly. Then the decisive test — `docs/design.md` §10's exact call shape
was written as real TypeScript and compiled:

```
$ tsc --noEmit --strict --module nodenext --moduleResolution nodenext interpret.ts
=== TYPECHECK PASSED ===
```

That is a type-level proof of the call shape, and it needed no API key. Two further facts came
from the SDK's shipped type definitions rather than from prose. `output_format` is **not
merely deprecated — it is removed from the type surface**, and attempting it is a compile
error (`TS2769 … 'output_format' does not exist in type 'MessageCreateParamsBase'`).
`output_config.format` and `effort: "low"` are both confirmed legal.

**Decided in addition: pin `zod@^4`.** The design said only "Zod". It is not a free choice —
the SDK peers `^3.25.0 || ^4.0.0`, but its structured-output helper imports `zod/v4`. On Zod 3
the helper is unavailable and the project would hand-write JSON Schema, losing the property
that makes the model's output format and the runtime validator the *same artifact*.

**Rejected.** Assistant prefill (returns 400 on Opus 5) and `output_format`, both already
settled and now confirmed by compiler rather than by recollection.

**Later would have cost.** A day of confused debugging at the first AI call, and — on the Zod
pin — a second hand-maintained schema that silently drifts from the validator.

---

### 13. Blocking: the hero moment is not reproducible as specified

**2026-09-18** · stack research, step 9, proposed change #1

**Decided.** Add a declared tie-break to the spec's sort:

```ts
sort: { by: "measure" | "breakdown"; dir: "asc" | "desc"; tieBreak: DimensionId }
```

with the semantic layer declaring the default, so the model never chooses it.

**Evidence.** 296 titles tie at *exactly* 5.00. With `limit: 4`, which four appear is decided
entirely by a tie-break rule the spec had no field for. Four orderings any adapter might
legitimately produce were run against the real data and returned **three different answers**.
Worse, `docs/design.md` §4's own naive example — *Lesson Faust*, *Lamerica*, *Heidi Fleiss*,
all n=2 — is produced by only one of the four (rating-count descending), so the approved design
silently assumed a secondary sort its own `QuerySpec` could not express.

This also made a stated demo must-have — the same question asked several ways returning
byte-identical numbers — **unachievable by construction**. Once the tie-break was declared on
both sides, the typed-array and SQLite adapters returned byte-identical rows.

**Rejected.** Leaving the tie-break to adapter convention. An optional tie-break is no
tie-break.

**Later would have cost.** Invariant 10 — *determinism is proved, not asserted* — would have
been unprovable, and the proof suite that is the artifact behind the product's central claim
would have been pinning an answer that three of four reasonable engines disagree with.

---

### 14. Blocking: determinism needs an as-of point, and invariant 10 needed rewording

**2026-09-18** · stack research, step 9, proposed change #2

**Decided.** `QuerySpec.asOf` (nullable; `null` = latest) **paired with**
`ResultSet.provenance.resolvedAsOf` (never null). Reword invariant 10 to:

> *The same question, against the same as-of point, always returns the same numbers — on every
> adapter.*

**Evidence.** MovieLens ratings carry real arrival timestamps spanning 1996-03-29 to
2018-09-24, so inbound data could be *replayed* rather than simulated. The same question at two
moments:

```
asOf 2007-08-02:   4.46 n=149  Shawshank Redemption   4.44 n=43  Dr. Strangelove
asOf 2018-09-25:   4.47 n= 20  Streetcar Named Desire  4.43 n=317 Shawshank Redemption
```

Both correct. They answer different questions — and note that Shawshank's average *fell* from
4.46 to 4.43 as evidence accumulated, so the honest answer itself moves. *"The same question
always returns the same numbers"* is simply false once data arrives.

The fix restores the claim in a **stronger** form, because it is checkable under conditions the
original silently excluded. Verified: at a fixed as-of point, the typed-array and SQLite
adapters agree exactly at both 2007 and 2018, and a case pinned at the old as-of still passes
after the later data arrives.

**Rejected.** Spec-only (cannot say what "latest" meant, so a shared answer cannot be
reproduced) and provenance-only (you can *explain* a past answer but not *re-run* it, and
re-running is exactly what the conformance suite does). The pairing is the design: the spec
asks, the provenance records what it got.

**Later would have cost.** This is the sharpest asymmetry in the whole trail, and it was
measured. **Now:** one field on the spec, one on provenance, one line per adapter — the entire
typed-array implementation is `if (rT[i] > asOf) continue;` — at **+0.087 ms** median over 30
interleaved repetitions. **Later:** every conformance case must be re-derived, because each
expectation was implicitly "as of whenever the fixture was", *and* the store must be rewritten,
because answering "as of T" requires retaining superseded state rather than overwriting in
place. The corpus being rewritten is the artifact behind the product's central claim — the
worst possible thing to redo under time pressure.

---

### 15. Four more findings the design had not anticipated

**2026-09-18** · stack research, steps 5, 6, 9 · proposed changes #3, #6, #8, #9

Not blocking, all cheap, all recorded as design changes rather than absorbed silently.

| Finding | Measured | Consequence |
| --- | --- | --- |
| **Running cost is ~44% higher than stated** | §10's arithmetic is right (`2000 × $5/1M + 200 × $25/1M = $0.015`) but it prices **one** call and the design specifies **two**. True uncached figure **$0.0217**; warm with cache read **$0.01265** (−41.6%) | Immaterial at demo scale — **$0.63 per 50 questions** — but it is the number that gets multiplied in a business model |
| **The source files are CRLF, which silently disables a guard** | `awk '/\r/{c++} END{print c" of "NR}' data/movies.csv` → `9743 of 9743`; all four CSVs. A naive `split('\n')` leaves a trailing `\r`, so `genres === '(no genres listed)'` never matched and `exclude_uncategorised` became a **no-op** (0 titles instead of 34). Genre cardinality inflated **19 → 38** (`"War"` and `"War\r"`) | Both failures are silent. A genre chart would have rendered, looked fine, and been wrong — the exact failure mode this product exists to catch. **The pinned figures caught it**, which validated §14's claim that they double as ETL regression tests |
| **One pinned figure depends on an unrecorded definition** | Genre assignments per movie: **2.2634** over all movies, **2.2713** over categorised movies only, **2.2669** counting no-genre as one. The design pins 2.27; the most natural implementation gives **2.26** | A team implementing this faithfully hits a false ETL regression on day one. The resolution is coherent — `exclude_uncategorised` is on by default, so the denominator *is* the categorised set — but it was implicit. Decided: every pinned figure states its denominator, its active guards and its as-of. The build spec's pinned-figure suite asserts **both** 2.27 (guard on) and 2.26 (guard off) |
| **Observable Plot cannot run on the server without a heavyweight dependency** | Throws without a DOM. With jsdom: **755 ms cold import** paid on every cold start, 8.4 MB on disk, against 13 ms first render and 1.4 ms warm | Render Plot **client-side**. This costs nothing, because invariant 11's reachable semantic `<table>` is plain server-rendered HTML built from the `ResultSet` — the chart is the enhancement, the table is the substance. It also decides the shareable artifact's format: text and HTML, no rasterisation path |

A fifth, recorded as policy rather than an urgent change: **store measures as scaled integers**.
Half-star ratings are dyadic and sum identically forward, reversed and shuffled — so float
accumulation would in fact have been safe here. The same test on two-decimal currency across 317
values **differs at 1.455e-11**. We control the measures in the demo payload; we do not control
what a partner application sends, and an 11th-decimal conformance failure is the hardest
possible thing to diagnose.

**Where entries 13–15 stand.** All of them were taken as design changes, and they enter the
build through the spec: the tie-break and the `asOf`/`resolvedAsOf` pairing land in the first
four increments, and the pinned-figure definitions, the CRLF strip and client-side charts land
with the increments that own them. They have **not yet been written back into
`docs/design.md`**, which still carries the original wording — §4 still names the naive top
four that only one tie-break ordering produces, §6's `QuerySpec` still has neither `tieBreak`
nor `asOf`, §10 still prices one call at ~$0.015, §11 does not say where charts render, and
§12's Film-Noir example still carries the figures that do not reproduce. That reconciliation is
queued as its own change. Until it lands, read those sections against these three entries.

---

### 16. The interface adopts the reference's interaction language and rejects its information language

**2026-09-18** · UI direction report §2, §8a · `docs/design.md` §11, §16

**Decided.** The interface was designed from a dashboard screenshot. One testable rule
governs the adoption:

> **No computed result appears that is not downstream of a question asked in this session.**

*Computed* is load-bearing. Naming the data source — "9,742 titles · 100,836 ratings" — is
provenance, not a finding: it answers nothing and ranks nothing. What the rule forbids is a
**result**: a ranking, a score, a trend, a delta.

**Adopted:** the suggestion-chip row, soft cards on a lavender ground with one accent, the
persistent bottom-anchored composer, chip paging, a trimmed greeting.
**Rejected:** the six-destination left nav, the "Optimization Score" card, the metrics
carousel with sparklines and deltas, and the "Best Selling Products" card.

**Evidence.** The rejected elements are unauditable numbers with trend arrows that nobody
asked for — adopting them inverts the thesis, not merely the scope. The rule was chosen over
"no dashboards" because it is checkable on any screen, where a scope category is not.

**Accepted knowingly:** those rejections remove **roughly half the reference screen's visual
mass**. If what was liked was the *density*, that quality cannot be adopted in v1 without
reversing §16. A middle option — one standing zero-state catalogue summary card, no rankings,
no trends, behind a narrow §16 carve-out — was built and then declined, so the line holds with
no exception and §16 stands unamended. What survives is the *warmth*: soft surfaces, generous
whitespace, one confident accent, a composer always ready.

**Later would have cost.** A §16 amendment, and a screen that argues against its own product.

**Landed.** §16 stands unamended. The full §11 rewrite that states the rule in the design lands
under its own change; §11 already carries the three decisions in entries 17 and 18.

---

### 17. The side column holds saved recipes, not a chat transcript

**2026-09-18** · stack research step 10; UI direction report §4, §5a · `docs/design.md` §11

**Decided.** The persistent column holds **saved recipes** — re-runnable, diffable specs.
Every entry is a spec, never a message.

**Evidence.** This is a state-model objection, not a styling preference. §6 makes the
**spec** the unit of conversational state — cheaper than carrying chat history, and more
verifiable, because an amendment can be rendered as a diff the user reads before it applies.
Build a chat log in the UI and the state model drifts to match it: `useChat`-shaped APIs are
built around a `messages` array, which is exactly the model the design rejects. Three further
objections held: a transcript makes the chart the hero when the product is the catch; the
hero moment is neither chart data nor a chat turn, so it has nowhere to live; and the label
"AI answering questions" asserts the AI produced the numbers that invariant 1 denies.

**And the distinction that keeps this inside §16:** a saved recipe is **not** a saved report.
A report stores *rendered output*, which goes stale silently as the data moves beneath it —
precisely the failure this product exists to remove. A recipe stores the *question*:
re-running it recomputes from scratch, applies the guards as they stand today, and produces a
fresh trust report and provenance every time. So §16 needs no amendment, and this is
incidentally the substrate a blessed-question library would later need.

**Rejected.** A chat-transcript sidebar, and the §6 change that would have had to accompany
it — replace-class across the API contract, the UI state model and the prompt strategy at
once.

**Later would have cost.** A sidebar of specs is a feature; a sidebar of chat is a rewrite.

**Landed.** `docs/design.md` §11, and *a chat transcript in the side column* is now a row in
`AGENTS.md`'s settled-decisions table.

---

### 18. The question box is demoted; the catch is the answer

**2026-09-18** · UI direction report §3 · `docs/design.md` §11

**Decided.** When a guard materially changes the answer, the naive/honest comparison renders
**open, full width, above the chart, as the largest object on the screen**, with the takeaway
folded into its head. The question box is not at the centre of the interface.

**Evidence.** Every product in the market research has a question box; none of them has this.
A surface that leads with the question box advertises the parity feature and buries the
differentiated one. The block is conditional *in the engine* — §8's
`materiallyDifferent(naive, honest)` — so it never renders when it has nothing to say, and
nothing needs hiding behind a control. Measured in the mock: the block renders at 806 px and
is the tallest child of the answer column.

**Rejected.** Putting the comparison behind a "Show me what I would have got" button. That
was the first draft, and it was a hedge against dead furniture on answers where no guard
fired — a problem the engine had already solved upstream. The hedge cost the product's best
moment for nothing.

**One caution recorded with the decision:** the catch is dominant *when it fires*, and it will
not fire on every question. It must never be manufactured to fill a quiet screen. A fabricated
catch would be the silent-failure problem wearing the costume of its fix.

**Later would have cost.** A demo where the differentiator is a click away.

**Landed.** `docs/design.md` §11 records both halves — the question box subordinate to the
answer object, and the comparison as a first-class visual moment rather than a card below the
fold. *A question box as the centre of the interface* is a settled-decisions row.

---

### 19. The no-API-key mode announces itself once, inline

**2026-09-18** · UI direction report §5b · `docs/design.md` §13

**Decided.** On the first degraded answer, one inline note — never silent, never a standing
banner. It says, in this order: the numbers are unaffected; free typing is unavailable; follow-up
amendments are unavailable; the written summary is a fixed template, and the summary itself
carries a template tag. Then it does not reappear that session.

**Evidence.** The ordering is the decision. The one wrong conclusion available to a user here is
that the *figures* are degraded too, and invariant 13 says otherwise — what is lost is language,
not arithmetic, because the engine and its guards never depended on the model. So that statement
goes first. A related judgement follows from the same fact: the recipe sentence stays tappable in
degraded mode, because closed-list phrase edits rewrite the spec deterministically and never call
the model. Free typing and amendments are what need interpretation, which is exactly what the
note names and nothing more.

**Rejected.** Staying silent, which lets a user read a template summary as a narration. And a
persistent banner, which keeps charging for a fact she has already taken in and makes a working
demo look broken. Both are now settled-decisions rows.

**Later would have cost.** Little in code — but this is the decision that keeps invariant 13
honest. "The app degrades, it does not break" is only true to the user if the product says which
half degraded.

---

### 20. shadcn/ui is chosen, and then verified rather than assumed

**2026-09-18** · a product call, held open on one verification · `docs/design.md` §15,
`AGENTS.md` invariant 14

**Decided.** shadcn/ui — Tailwind for the visual language, Radix primitives underneath for the
interactive behaviours, components **copied into the repository** by the CLI rather than taken
as a runtime dependency. With two conditions: **earn each component** (roughly six — chip,
card, popover menu, drawer, table, composer), and **the approved look wins, not the defaults**.

**Evidence.** The components live in the repository where they can be read and audited — the
same instinct as a semantic layer that is data rather than code and a recipe that is a
sentence rather than a formula. The accessibility invariant 11 commits v1 to — focus
management in the provenance drawer, WAI-ARIA keyboard behaviour in the tappable-phrase
popovers — comes from Radix rather than from hand-written code, which is where hand-rolled
accessibility usually fails. Theming is CSS variables, so the approved look becomes the theme
rather than something fought against.

**The open question, and how it was closed.** shadcn's documentation targets Next.js 15 while
§15 pins **16.3.5**. Rather than reason about it, a throwaway App Router scaffold was stood up
at Next 16.3.5 with **React 19.2.8** and **Tailwind 4.3.3**, and shadcn CLI **4.21.0** was run
against the Radix base, adding badge, card, popover, dropdown menu, dialog, drawer, table,
textarea and button — pulling `radix-ui` 1.6.7, `vaul` 1.1.2 and `lucide-react` 1.47.0. The
production build, TypeScript and `eslint-config-next` all pass. In a headless browser the
popover reports `aria-expanded`, the menu opens from the keyboard onto a `menuitem`, the dialog
traps focus and returns it to its trigger on Escape, the drawer opens as a `dialog` and closes
on Escape, and the table renders as a real `<table>`, with no console or page errors.

**And the check found three things a reading would not have.** The CLI needs an explicit preset
(`init -b radix -p nova`) because `--yes` alone still prompts; `--base-color` is gone in 4.x;
and — the one that matters — **the drawer does not move focus into its content on open**, so
the provenance drawer must give itself a focusable first element. That is invariant 11's
requirement, and it would otherwise have been found at the end of the build.

**Rejected.** React Aria in place of Radix (stronger locale and screen-reader coverage,
steeper API for the same six components); a full styled kit such as MUI or Chakra (imposes its
own visual language against the approved mock); hand-rolling everything (smallest dependency
surface, but dialog and popover focus management is exactly where hand-rolled accessibility
fails). All three are now in `AGENTS.md`'s settled-decisions table.

**Later would have cost.** Retrofitting a component library across every component is
replace-class by the §5 test — and the drawer defect would have been found during accessibility
verification at the end of the build, not before the first component.

**Landed.** `docs/design.md` §15 carries the decision, the two conditions and the verification
result; `AGENTS.md` gained invariant 14, *each shadcn component is earned*.

---

### 21. No AI framework

**2026-09-18** · decided during the stack review; reasoning in stack research step 10

**Decided.** `@anthropic-ai/sdk` directly. `interpret()` and `narrate()` stay two narrow
internal functions.

**Evidence.** The product has no tools, no agent loop, no retrieval and no threads — which is
most of what a framework is for. Two things it *would* own are load-bearing here: message
assembly, which is where the prompt-cache breakpoint lives, and the structured-output surface,
which is Anthropic-specific (`output_config.format`) and is the single artifact that makes the
model's output contract and the runtime validator the same schema.

**Rejected.** A framework, and the chat state model that usually arrives with one — see entry
17.

**Not closed off.** The model's only output is a JSON-schema-constrained `QuerySpec` validated
against the semantic layer before execution, so **the contract is the schema, not the SDK**. A
wrong output from any provider hits the same validator. This is already proven rather than
promised: the no-key fallback parser is a second implementation of the same interpret
interface, using no model at all.

**Later would have cost.** Little to add one; a great deal to remove one once message assembly
and caching are inside it.

---

### 22. The build spec is written before any implementation

**2026-09-18** · build spec report

**Decided.** Decompose v1 into **sixteen increments**, ordered so that nothing built early has
to be undone later, each with its own definition of done naming the command that proves it and
what passing looks like — and its own **"must not"** boundaries.

**Evidence.** The three replace-class decisions the stack research identified —
`tieBreak`, `asOf` paired with `resolvedAsOf`, and the guard registry — all land in the first
four increments, before anything reads them. Five boundaries were pulled out as the places
where an early increment would quietly decide something belonging to a later one; the most
expensive is that the ask route must ship the **streaming** narration shape while its only
producer is a template, because otherwise a later increment rewrites the route, the answer
schema and every component that reads it.

Grounded numbers rather than round ones: `MAX_LIMIT = 120` comes from measured dimension
cardinality (release year 106 members, genre 19, rating year 23, release decade 12, title
9,742), and `NARRATE_ROW_CAP = 20` stays separate because it serves a different invariant.

**Recorded honestly: three places where "nothing gets undone" could not be fully achieved.**
`shadcn init` rewrites files the scaffold increment created (mitigated by writing the minimum
possible global CSS); one dense screen is built in five passes, so five increments touch the
same layout (mitigated by fixed slot order and independent components — the weakest point in
the plan); and the semantic layer is edited repeatedly after it lands, by design, because
every synonym is earned by a failing eval.

**Rejected.** Starting to build and decomposing as it went.

**Later would have cost.** The re-ordering is the cheap part; the expensive part is the
boundaries. Each one is a rewrite discovered mid-build rather than a constraint written down
before it.

---

# Part two — how the work was done

This is the method. It is drawn from what happened, including the parts that did not work.

## 1. The documentation came first, and it was reviewed before any code

The design existed, was written down, and was reviewed *as a document* before a line was
written. The review was not a read-through: it applied one test to every architectural
element — **would production extend this, or replace it?** Extend means additive and safe to
omit now. Replace means a rewrite and not safe to omit. That test found three defects
(entry 7) and then, applied again, moved accessibility and locale-keyed labelling into v1
(entry 8). None of those was a coding decision. All three would have been rewrites.

The rule that keeps it honest is in `AGENTS.md`: **if code and `docs/design.md` disagree, the
doc wins until the doc is changed, and a design change lands in the document first, with its
rationale, then in code.** Every measured finding in entries 13–15 landed as a labelled
`PROPOSED DESIGN CHANGE` in a research document before it became a build-spec line.

**To adopt this:** write the design, then review it against a single explicit test rather than
against taste. The test is what converts "I'd have done it differently" into "this is
replace-class, fix it now".

## 2. Claims were checked by measurement, not by reading documentation

This is the difference that matters most, and it is cheap. Documentation tells you what was
intended. A measurement tells you what is true today, on this machine, with these versions.
Four examples, all from this project:

- **Compile against the real SDK.** The design's exact AI call shape was written as TypeScript
  and run through `tsc --noEmit --strict`. It passed — a type-level proof needing no API key.
  The same exercise proved `output_format` is *removed*, not merely deprecated, because the
  compiler said so (`TS2769`). Reading the changelog would have said "deprecated".
- **Scaffold a throwaway project to check a library against an exact framework version.**
  shadcn's docs target Next 15; the design pins 16.3.5. A disposable scaffold at 16.3.5 with
  React 19.2.8 and Tailwind 4.3.3 settled it in one session — and found a real defect a reading
  could not have: the drawer does not move focus into its content on open.
- **Run four implementations to see whether they agree.** The hero moment's 296-way tie was
  resolved four legitimate ways. They produced **three different answers**, one of which was
  the approved design's own example. Nobody would have predicted this from the spec; the spec
  is what hid it.
- **Measure token counts against the caching floor.** Opus 5's minimum cacheable prefix is 512
  tokens. The thinnest-viable semantic layer estimates at **~373–620 tokens** — it straddles
  the floor. With five few-shot examples the prefix reaches **~774–1,032** and clears it. So
  few-shot examples, normally the first thing trimmed for cost, are here **load-bearing for
  cost**, and the failure mode is silent: no error, just full input price forever.

The pattern generalises: measure the thing you are about to depend on, in the environment you
will depend on it in, and write the number down. It caught CRLF line endings silently
disabling a guard (entry 15), a 755 ms cold-start cost for server-rendering charts, and a
57× speed and 8× size gap between two engine choices that nonetheless returned identical
numbers at both as-of points — which is the conformance-suite idea working, demonstrated in a
spike across two genuinely different engines before either adapter was built for real.

**To adopt this:** budget a session for spikes before the design is frozen, write them
disposably, and reproduce their output inline in the report so a reader can check the claim
without rerunning it.

## 3. Research ran beside the work, separately, and produced documents

Three research passes ran as their own pieces of work, in their own throwaway checkouts,
producing **written reports rather than chat**: the stack research, the UI direction, and the
build spec. None of them edited application code. Each ended with a clean tree.

That separation did three things. It kept spikes disposable — a spike that lives in the build
becomes a dependency. It made the reports reviewable by someone who was not there, which is the
whole point. And it let each one be *judged against* the design and the invariants explicitly,
so a finding arrived labelled as a proposed change rather than as a quiet edit.

The reports are long — 1,058, 523 and 1,037 lines. That is the right length for evidence and
the wrong length for a decision trail, which is why this document exists on top of them.

**To adopt this:** research in a separate checkout, ship a document, and require every claim in
it to cite a measurement, a version-checked reference, or stated reasoning.

## 4. Decisions were recorded with their evidence and their rejected alternatives

The mechanism is the **settled-decisions table in `AGENTS.md`** — two columns, *Rejected* and
*Why* — sitting under a heading that says "do not resurrect without a design change". DuckDB-WASM
is in it, with 142 MB and the thesis argument beside it. So is the ratings-drift guard, with the
3.31–3.88 oscillation. So is the positioning that was rejected, the core type that was rejected,
and single-shot question answering.

A rejected option without a recorded reason is an option that comes back. Recording the *why*,
not just the *what*, is what makes the table load-bearing: an agent or an engineer reading it
can tell whether new evidence would reopen the decision, which is a different question from
whether they would have decided the same way.

Part one of this document is the long form of that table. The table is the contract; this is
the history.

**To adopt this:** one file, in the repository, that says what was decided *against* and why.
It costs a paragraph per decision and it saves the same argument being had twice.

## 5. When the measurement disagreed with the plan, the plan changed

A method that never surfaces bad news is not being honest about what it found. This one
surfaced plenty.

The stack research pass found **six things by measurement that the approved design had not
anticipated**, and two of them would have quietly broken the central claim:

1. **The hero moment was not reproducible as specified.** The design's own naive example is
   produced by exactly one of four legitimate orderings. The product's best demo beat rested on
   an assumption the spec could not express (entry 13).
2. **The determinism promise was false as worded.** Not weak — *false*. The same question at two
   moments gives different, equally correct answers. The fix made the claim stronger, not weaker,
   by making it checkable under conditions the original silently excluded (entry 14).

Both were written up as proposed design changes with their evidence, and both were taken. Four
smaller findings were taken the same way (entry 15), including one — the 2.27 genre figure —
that would have looked like a bug on the first day of implementation.

One more is worth naming because it is the method working against the researcher rather than
against the plan. The argument that float addition is non-associative and would make two adapters
disagree was **made, tested, and found false for this data**: half-star ratings are dyadic, so
they sum identically forward, reversed and shuffled. The claim was corrected in the report rather
than quietly dropped, and the finding was downgraded from an urgent change to a policy — because
the *same* test on two-decimal currency does differ, at 1.455e-11, and a partner payload will
eventually carry currency.

**To adopt this:** write findings that contradict the plan in the same document as the ones that
confirm it, label them, and make the plan change in the document before it changes in code.

## 6. Where this method was wrong, or wasteful

A document that only reports success is not evidence of a good workflow.

**A hedge cost the product's best moment, and only a question caught it.** The first interface
draft put the naive/honest comparison behind a "Show me what I would have got" button, hedging
against dead furniture on answers where no guard fired. §8 had already solved that *in the
engine* — the block is conditional on `materiallyDifferent(naive, honest)`. The hedge was
unnecessary, it demoted the differentiator, and nothing in the method caught it. A direct
question — "is this boring?" — did.

**Work was built against a decision that was then reversed.** A standing zero-state catalogue
summary card was selected, and built: markup, CSS, a §11 carve-out paragraph fencing it so it
could not grow, supporting design notes, a rationale bullet and a zero-state caption. The
decision was then reversed and all of it was reverted. The reversal was the right call — it
landed on the original recommendation — but a session of build-then-revert is the cost of
implementing against a decision before it has settled.

**A decision was taken against a stale artifact.** One review page still showed five frames, a
sidebar headed "THIS SESSION", and an option that a later ruling had already removed. The
selection made on it was read carefully rather than literally, and the later explicit ruling
won. That was the right resolution and it was luck that it mattered little. Review surfaces go
stale faster than decisions do.

**Ambiguous assent had to be interpreted.** A freeform "agree with recommendation" arrived
alongside an explicit selection that was *not* the recommendation. It was treated as
encouragement rather than assent, and the explicit selection was taken as authoritative. That is
the safe reading, but the cost is real: somebody had to decide what a sentence meant, and get it
right, rather than the process making the question unambiguous.

**The one number in the approved design that was not measured does not reproduce.** §12's
illustrative screen-reader line — "Film-Noir leads at 4.1, 0.4 above the catalogue average, based
on 18,204 of 100,836 ratings" — was written as prose. Measured: Film-Noir is **4.01** with the
evidence guard (558 ratings behind it) or **3.92** without it (870 ratings), and the catalogue
mean is **3.50**. The delta is roughly right; the coverage figure is not close to either value.
It is illustrative rather than pinned, so nothing depends on it — but it is an awkward place to
carry a wrong number, and it is exactly the kind of figure that slips through because it is "just
an example".

**A pinned regression figure shipped without its definition.** `AGENTS.md` pins 2.27 genre
assignments per movie and instructs that a change means the ETL changed. It does not record the
denominator, and the most natural implementation yields 2.26. The pinning mechanism was right —
it is what caught CRLF — but pinning a number without its definition builds a regression test that
fails for the wrong reason.

**A chart bug survived several review rounds.** In the interface mock, `.bar .fill` was a `<span>`
left at `display:inline`, so every bar rendered at 0×0 — the charts looked like empty tracks. It
was found only when element geometry was *measured* rather than the markup read. Two honest notes:
the numbers were written as text on every row throughout, so the accessibility claim held; and the
same verification pass that found it is the one being recommended here. Structural inspection is
not verification.

**Some verification was by rule inspection rather than by render, and said so.** Narrow-viewport
reflow was confirmed by checking that three media queries exist and target the right selectors,
not by watching them reflow, because the window resize did not change the page viewport. Flagged
rather than claimed. The right outcome; still a gap.

**The token-count finding rests on an estimate, not a count.** The caching-floor measurement is
stated as a range across 3.0–4.0 characters per token because the exact count needed a credential
the research checkout did not have. The conclusion is robust — the layer straddles the floor under
every estimate and clears it with few-shot under every estimate — but it is an estimate, and it is
labelled as one.

**The pinned figures were recomputed more than once.** The stack research and the interface pass
each recomputed all of them from `data/` rather than copying them; the build spec re-measured what
it newly depended on — dimension cardinality, and the blast radius of the thirteen undated titles —
and quoted the rest from the research, saying which. Read one way, two independent reproductions of
the numbers the product's central claim rests on is genuinely valuable, and it is how the CRLF
defect surfaced. Read another way it is the same work done twice because no single artifact held
the result in a form the next reader trusted. Both readings are fair. This document is the attempt
at the second problem.

## 7. What the method costs

One day, honestly accounted: market research, a design, a design review, three research passes with
disposable spikes, a verified component library, an interface mock verified in a real browser, and a
sixteen-increment build spec — and no application code.

That is the trade. What it buys is that the three replace-class decisions are made before anything
reads them, the product's central claim is provable rather than asserted, and the two findings that
would have broken it were found by a spike rather than by a demo.

---

# Part three — how it was built

One section per increment, added as it lands. Same four lines as part one: what was decided, the
evidence, what was rejected, what deciding later would have cost.

---

## GA-01 — Scaffold and the core contracts

**2026-09-18** · `docs/build-spec.md` §3 increment 1 · decisions now standing in
`docs/architecture.md` §2

Three decisions, all of them shape rather than volume, and all of them cheap now and expensive later.

### 23. `tieBreak` is required, not optional

**Decided.** `QuerySpec.sort.tieBreak` is a required field. The model never supplies it:
`ModelQuerySpec` omits it, and `resolveSpec()` fills it from the semantic layer's declared default
before validation.

**Evidence.** The hero moment is a **296-way tie at 5.00**. With no declared tie-break, each adapter
is free to break that tie however its iteration order happens to fall — four reasonable
implementations were measured producing three different answers. Invariant 10 says determinism is
proved, not asserted, and the conformance suite is what proves it; an optional tie-break makes the
suite's expected numbers a property of whichever adapter wrote them down first.

**Rejected.** Optional with an engine-side default. It reads as equivalent and is not: a default
inside the engine is invisible to the spec, so two adapters can satisfy the same spec and disagree,
and the disagreement only surfaces on a tie — which is precisely the case this product exists to
show. An optional tie-break is no tie-break.

**Later would have cost.** Every conformance case, every pinned figure and every stored recipe is a
spec. Making the field required afterwards invalidates all of them at once, and the adapter that was
silently supplying its own order has to be found by reading it.

### 24. `asOf` is nullable on the spec and never null in provenance

**Decided.** `QuerySpec.asOf` is `string | null`, where `null` means "latest".
`Provenance.resolvedAsOf` is a non-nullable timestamp recording what "latest" turned out to be. The
pairing is the design, not redundancy.

**Evidence.** Each half fails alone, in a different direction. Spec-only: a conformance case pinned
at "latest" expires the moment the next payload lands, so the suite that proves determinism stops
being re-runnable. Provenance-only: you can *explain* a past answer but not *re-run* it — and
re-running is exactly what the conformance suite does, including the as-of replay case pinned at
`2007-08-02` against the full 2018 store. The spec asks; the provenance records what it got.

**Rejected.** A single non-nullable `asOf` filled in at request time. It removes the distinction
between "whatever is current" and "this instant", which is the distinction a `SpecPatch` needs when
a follow-up has to interrogate the parent's snapshot rather than time-travel to a new one.

**Later would have cost.** This is storage shape, not a field. Resolving "latest" after the fact
needs an append-only store that can still answer as of a past point; retrofitting that is a rewrite
of the store rather than an addition to a type.

### 25. `contracts/` is a module of its own

**Decided.** The core types live in `src/server/contracts/`, a leaf module importing `zod` and its
own siblings and nothing else — not `node:*`, not `next/*`, and nothing under `warehouse/`,
`engine/` or `ai/`.

**Evidence.** The design implied the `QuerySpec` sits beside the `Warehouse` interface in
`warehouse/types.ts`. It cannot: the spec is read by the warehouse, the engine, the AI layer, the
route *and* the client, so defining it there makes the engine import from the warehouse — inverting
the dependency, since the warehouse *consumes* the spec and does not own it. `warehouse/types.ts`
keeps the `Warehouse` interface itself, which legitimately depends on both. Keeping the module a
leaf is what lets the client import it without dragging the server in, and it is asserted rather
than intended: the increment greps its own imports.

**Rejected.** Types beside the interface that reads them, which is the obvious placement and the one
the design implied.

**Later would have cost.** Moving a type that five callers import is a rename across the build; the
expensive part is that by then the inverted dependency has been built on, so the move is a
refactor of the engine rather than a file relocation.

### What the increment also measured

Two things worth recording because they were checked rather than assumed. `.omit().extend()` does
preserve `strictObject`'s `never()` catchall on `ModelQuerySpecSchema`, so the surface the model
actually emits into rejects `joins` — asserted on the `unrecognized_keys` issue code, not on a
throw, because that issue carries `continue: true` and a test checking only for an abort would pass
for the wrong reason. And `zodOutputFormat(ModelQuerySpecSchema)` converts without throwing, which
clears `z.record` in `GuardRefSchema.params` for structured outputs now rather than at GA-08.

The scaffold's versions were settled the same way, against `create-next-app@16.3.5`'s own output
rather than against habit: it pins React 19.2.8 and ships `typescript: ^5`. TypeScript 7.0.2 was
`latest` and both `tsc --noEmit` and `next build` pass on it, but increment one is the wrong place
to run ahead of the framework's tested line for no gain.

---

## GA-02 — Received payload, ETL, append-only store, pinned figures

**2026-09-18** · `docs/build-spec.md` §3 increment 2 · decisions now standing in
`docs/architecture.md` §2a

Four decisions. Three are storage shape, which is the expensive kind to change later;
the fourth is what the increment measured and refused to round away.

### 26. The store is append-only, and ordering is an index over it

**Decided.** Records are appended and never touched again. `ratings.byEventTime` is a
derived permutation of log positions sorted by `(at, position)`; `asOf T` is a prefix of
that index, found by binary search. A replayed `payloadId` is recognised and not
re-applied. A title redeclared with different content is refused rather than merged.

**Evidence.** Entry 14 made an explicit as-of point a requirement, and entry 24 paired
`QuerySpec.asOf` with a non-nullable `Provenance.resolvedAsOf`. Both are promises about
*re-running* a past answer, and both are worth nothing over a store that overwrites: the
provenance still names a moment, but the moment no longer holds the numbers it named.
Splitting records from ordering is what makes the promise survive a late arrival — the
test appends an event dated 2001 after 100,836 events ending in 2018 and asserts that
every record already written is byte-identical at the same position while the new one
lands mid-index.

**Rejected.** A snapshot store rebuilt per delivery, which is simpler and answers every
question v1 asks. It fails the moment two deliveries exist, and it fails silently: the
figures change and nothing says why. Also rejected: merging a redeclared title, because
picking either version quietly is the coercion invariant 4 exists to remove — and this
store has no correction feature to pick *with*.

**Later would have cost.** A storage rewrite rather than a field addition, landing after
the engine, the conformance suite and every pinned figure had been written against the
old shape.

### 27. Every measure is a scaled integer, and an off-scale value is refused

**Decided.** Ratings are stored as hundredths in an `Int16Array`. The scale is declared
in the manifest, and a delivered value that does not land on it throws, naming the value.

**Evidence.** Half-stars are dyadic, so this dataset would survive as floats — which is
exactly why the decision has to be made as policy now rather than discovered later. The
`Warehouse` boundary is aggregation, and invariant 10 says determinism is proved across
adapters; two adapters summing the same floats in different orders disagree in the 11th
decimal, and the conformance suite is then pinned to whichever wrote its numbers first.
A partner payload carrying prices makes that real rather than theoretical.

**Rejected.** Rounding an off-scale value into place, which is the obvious kindness and
the wrong one: it silently changes a partner's number at the one point in the system no
test is looking at. A declared scale that refuses what does not fit is the same argument
the product makes about silent coercion, applied to itself.

**Later would have cost.** Every stored value, every conformance expectation and every
pinned figure re-derived at once, with no way to tell which differences were the bug and
which were the fix.

### 28. The payload body lives outside `contracts/`, and the envelope stays in it

**Decided.** `contracts/payload.ts` keeps the envelope — `sourceId`, `payloadId`,
`schemaVersion`, `receivedAt` — and the body that names titles, ratings and viewers
lives in `src/server/ingest/payload.ts`, beside the reader that fills it.

**Evidence.** GA-01's must-not is that no core type names a MovieLens entity, and the
body is nothing but MovieLens entities. Splitting at the envelope keeps invariant 6
intact without pretending the body is portable: what survives a change of integration is
the delivery contract, not the records. `read-payload.ts` then reads from disk what a
receiver would read from a request body and validates at that same boundary, so the demo
path and the live path fail in the same place for the same reason — which is the whole
content of "the receiver is not built for the demo" (entry 10).

**Rejected.** A generic record-batch body in `contracts/` that names nothing. It keeps
one schema instead of two, and it buys that by making every field untyped at exactly the
point where a partner's mistake should be caught by name.

**Later would have cost.** Not much in code — but the MovieLens body would have been sat
in the portable contract for the rest of the build, which is the mistake design review
already caught once.

### 29. The pinned figures are asserted with their definitions, and both genre averages are pinned

**Decided.** Each figure carries its definition, its guards in effect — none, asserted —
and its as-of. Genres per title is pinned **twice**: 2.27 with `exclude_uncategorised`
on (22,050 assignments over the 9,708 categorised titles) and 2.26 with it off (the same
22,050 over all 9,742).

**Evidence.** 2.2634 and 2.2713 round to different numbers at two decimal places, and
dividing by every title is what the most natural implementation writes. `AGENTS.md`
pins 2.27 and says a figure that moves means the ETL changed — so a faithful team
reading 2.26 on day one would have gone looking for a regression that was not there.
Pinning both makes the denominator the thing under test instead of the rounding.

The CRLF finding is kept executable the same way. All four files are `\r\n`; read
naively the genre count goes from 19 to 38, and `IMAX` — always last in its row — stops
existing under its own name entirely, so a breakdown by genre loses it with no error
anywhere. The suite pins the shipped 19 **and** the 38, and asserts that the reader's
column lookup catches the defect at the payload boundary before a row is read.

**Rejected.** Pinning 2.27 alone, per `AGENTS.md`. Nothing about the figure was wrong;
what was missing was the definition that makes it reproducible, and the table's own
instruction — investigate before updating — is what turned the discrepancy into a
decision instead of an edit.

**Later would have cost.** A day of investigating a regression that never happened, and
the more expensive outcome on the other side: a team that "fixed" the ETL until it read
2.27 under a definition nobody had written down.

### What the increment also measured

The as-of replay works end to end, checked early because it is cheap to check and
expensive to discover late: at `asOf 2007-08-02` against the full 2018 store, the log is
a strict 50,266-event prefix and the top three titles clearing twenty ratings are
Shawshank 4.46 (n=149), Dr. Strangelove 4.44 (n=43) and Lawrence of Arabia 4.44 (n=32) —
the numbers GA-04's definition of done expects. Those assertions belong to GA-04 and are
not made here; the store they will run against is now known to carry them.

The thirteen undated titles were re-measured and still carry 18 of 100,836 ratings, none
clearing twenty — the evidence base for C4, unchanged. One of the thirteen is why the
year rule stays strict: `Death Note: Desu nôto (2006–2007)` carries a year *range* with
an en-dash, and every looser rule tried files it under 2006 without saying so.

Node 22.23.1 strips TypeScript natively with no flag, so `npm run ingest` needs no runner
dependency and no build step. The cost is that Node resolves no extensionless relative
imports, so the executed chain carries explicit `.ts` extensions; `erasableSyntaxOnly`
was turned on across the project so that a construct which breaks that chain fails at
`tsc` rather than at the next ingest.

---

## Keeping this current

This document is the project's running record, not a retrospective.

**Every increment adds its entries as it lands, in the same commit as the work.** An entry is four
short lines — what was decided, the evidence, what was rejected, what deciding later would have
cost — plus a link to the source that carries the depth. Where an increment's measurement
contradicts `docs/design.md`, the design changes first with its rationale (per `AGENTS.md`), and the
entry records why.

A journal reconstructed at the end is a summary. One written as the work lands is evidence.
