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

**The north star, not the wedge.** "Canva for data" is where the product is heading, and
the catch is the wedge that gets there. It is not the wedge itself because the phrase is
occupied: Bricks markets itself as "the Goldilocks tool that sits perfectly between Canva's
ease-of-use and Tableau's power", with 100,000+ professionals claimed. So the wedge has to be
something underneath it that Bricks does not sell.

**Rejected, with reasons.**

| Rejected | Why |
| --- | --- |
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
both sides, the typed-array and Postgres adapters returned byte-identical rows (GA-06).

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
original silently excluded. Verified: at a fixed as-of point, the typed-array and Postgres
adapters agree exactly at both 2007 and 2018 (GA-06), and a case pinned at the old as-of still passes
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

## GA-03 — Semantic layer, guard registry, loader

**2026-09-18** · `docs/build-spec.md` §3 increment 3 · decisions now standing in
`docs/architecture.md` §3 and §4

The increment sits on one decision taken earlier — the layer ships at its thinnest viable, and
every later piece of structure is earned by a failing eval rather than added because it sounds
useful. What was left to decide was where the line falls, and what stops a data file from lying.

### 30. The registry declares each guard's parameter names, and the loader checks them

**Decided.** `guards/registry.ts` holds four entries, each declaring the parameter names its guard
reads — `min_evidence` reads `minObservations`; the other three read nothing. The loader rejects any
layer whose `defaultParams` carry a key no guard reads, naming the key.

**Evidence.** Thresholds arrive in the spec's `params`, defaulted by the layer, so the number 20
lives in a data file and the code that consumes it lives elsewhere. That split has a gap in the
middle: nothing connects the key the layer writes to the key the engine reads. A layer declaring
`{ "minRatingsPerTitle": 20 }` against a guard that reads `minObservations` parses cleanly, ships,
and runs the guard **unthresholded** — a silent coercion arriving through the layer rather than
through the model, which is the one failure mode this product exists to remove. The registry is the
only place that knows which keys are real, so it is the only place that can say so.

**Rejected.** A registry that is a bare list of ids, with implementations and their parameters both
arriving in GA-04. It is thinner, and it is thin in the wrong direction: the loader is GA-03's
deliverable and a loader that cannot check parameters is a loader that passes a broken layer.
Inferring the parameter names from the implementations in GA-04 was also rejected — it makes the
check exist only once there is something to infer from, which is three increments after the layer is
editable.

**Later would have cost.** The symptom is not an error. It is a guard that silently does nothing,
found by noticing that a number looks wrong — which is the audit this product's user cannot perform.

### 31. Materiality is one global threshold in the layer, not one per measure

**Decided.** `materiality.minValueDelta` is `0.01`, declared in the layer. It settles the first open
implementer choice in `docs/build-spec.md` §7.

**Evidence.** Two things make a naive/honest comparison material and only one needs a number: a
change in the top-`limit` row-set's membership is structural, and a measure delta needs one
presentation step. A per-measure step was the obvious shape and is not expressible —
`MeasureDeclarationSchema` is a `strictObject` of `id`, `labels` and `synonyms`, and presentation
scale lives in the store and the engine (`ResultRow.value` against `rawValue`), not in the
declaration. 0.01 then behaves as a floor across all five measures: exactly one step for
`avg_rating` and `share_rated_4_plus`, and comfortably cleared by any real change in a count.

**Rejected.** Adding a `decimals` field to `MeasureDeclarationSchema`. That is GA-01's contract, and
widening a landed contract to express a threshold that one global number already expresses correctly
is the anticipation this increment is supposed to refuse.

**Later would have cost.** Little, and that is the point — it is declared data, so GA-12 tunes it
against the rendered block as an edit to a JSON file rather than to GA-04's engine.

### 32. Pretty-printing the layer is a measured requirement, not a formatting preference

**Decided.** The shipped layer is pretty-printed, asserted by a test that carries the measurement.

**Evidence.** Measured on the shipped file: **2,157 bytes pretty-printed against 1,568 minified —
589 bytes of whitespace**, not the ~370 the build spec estimated before the file existed. The layer
heads the cached prompt prefix and Opus 5 does not cache a prefix below 512 tokens. At roughly four
characters per token that is ~540 tokens against ~390, so on this file the whitespace is what carries
the prefix over the floor at all. Dropping under it fails silently — no error, no warning, just every
question paying uncached prefix cost.

**Rejected.** Treating this as house style enforced by a formatter. A formatter is the first thing
suspended when a file looks noisy in review, and the reviewer suspending it has no way to see what it
was holding up.

**Later would have cost.** Nothing breaks, which is the expensive part: the regression is a cost and
latency increase with no failing test and no error to trace it to.

### What the increment also measured

The build spec's ~370-byte estimate for minification was low by 219 bytes; the shipped explanations
made the file larger than the plan assumed. The figure now in `docs/architecture.md` §3 is the
measured one, and the test carries it, so the next person to look at it does not re-measure.

`docs/architecture.md` §3 had listed a **filter vocabulary** — minimum ratings per title, release
period, rating period, genre, viewer segment — as part of the layer. GA-01's `SemanticLayerSchema`
has no `filters` key at all, so the doc had been stale since increment one and a layer declaring one
fails to load. §3 now says so rather than leaving the reader to discover it from a parse error.

Every guarantee in `tests/semantic.test.ts` was checked by breaking it: a fifth registry entry, a
hardcoded threshold, a minified layer, an added synonym, a second locale, and each of the loader's
three cross-file checks removed in turn. All thirteen cases fail when the thing they protect is
removed, so none of them passes vacuously.

## GA-04 — The deterministic engine and the local adapter

**2026-09-18** · `docs/build-spec.md` §3 increment 4 · decisions now standing in
`docs/architecture.md` §5 and §5a

This is the increment where the central claim stops being a claim. Everything the product
ever shows is computed here, by pure functions, with no model anywhere near them — and the
catch becomes real, as a generic double-run rather than a rule about this dataset.

Three of the five decisions below were forced by measurement rather than chosen from a
design space. Two of those contradicted what the plan assumed, and one of them is the most
important thing this increment found.

### 33. The adapter returns an `Aggregation`; the engine composes the `ResultSet`

**Decided.** `aggregate()` returns aggregated members — integer `numerator`, `denominator`,
`observations` and a stable `memberId`. Guards, ordering, the limit, the trust report,
provenance and the naive/honest comparison all live in `engine/`.

**Evidence.** `docs/architecture.md` §5 previously sketched `aggregate(spec): Promise<ResultSet>`,
written in GA-01 before an engine existed. Taken literally it puts guard application, the
ordering rule, materiality and the double-run inside **every** adapter. §5's own next
paragraph says the cost of this boundary is that determinism depends on each adapter
behaving identically — so the design that minimises what an adapter decides is the one that
paragraph argues for. The conformance suite then has to police aggregation only, which is
the sole part a `GROUP BY` genuinely does differently. Per `AGENTS.md` the doc changed first,
with this rationale, and then the code.

**Rejected.** Keeping the `ResultSet` signature and writing the trust report once in a shared
helper each adapter calls. That is the same split with no way to enforce it: the second
adapter that forgets to call the helper still compiles, still returns a valid `ResultSet`,
and disagrees only in the trust report — which is the part no test reads as closely as the
numbers.

**Later would have cost.** GA-06 adds the second adapter. Discovering there that the trust
report is adapter-owned means rewriting both adapters and the conformance suite in the
increment whose job is to prove they agree.

### 34. Ordering compares the exact rational, and only presentation rounds

**Decided.** The ordering rule is `<measure> <dir>, <tieBreak> ASC, <memberId> ASC`. The
measure is compared by **integer cross-multiplication** on `numerator/denominator`, never on
the rounded value and never on a float.

**Evidence.** The build spec's replay criterion asks for Shawshank 4.46 (n=149), Dr.
Strangelove 4.44 (n=43), Lawrence of Arabia 4.44 (n=32) at `asOf 2007-08-02`. Measured, a
fourth title sits in that range: **Chinatown (13,750/31) also displays 4.44**. Ordering on
the rounded hundredth puts Chinatown *second* — ties resolve alphabetically and `C` precedes
`D` — and the criterion's stated order becomes unreachable. Ordering on the exact rational
reproduces the criterion exactly, with Chinatown fourth. It is also what every SQL warehouse
does: `ORDER BY AVG(rating) DESC` orders on the full-precision average, so an engine that
rounded first would disagree with its own future Postgres adapter.

**Rejected.** Ordering on `rawValue`. It is simpler and it is what a careless implementation
writes, and it silently changes which rows appear above a `limit`.

**Later would have cost.** This is precisely the class of defect the conformance suite is
built to catch — but only if the two adapters disagree. Both would have rounded first, both
would have agreed, and the suite would have been green while the ranking was wrong.

### 35. Rounding at a true midpoint is half toward zero, and it is stated

**Decided.** `roundHalfTowardZero()` in `engine/numbers.ts`, in one named function, asserted
in `tests/engine.test.ts` alongside the two implementations that disagree with it.

**Evidence — and this is the increment's most important finding.** *A Streetcar Named Desire*
has 20 ratings summing to 8,950 hundredths: a mean of **exactly 4.475**, sitting precisely on
the boundary between two presentation steps. There is no arithmetically correct answer at two
decimals. Four reasonable implementations were measured on that one value:

| Implementation | Result |
| --- | --- |
| `Math.round(sum / n)` — half up on hundredths | **4.48** |
| `Intl.NumberFormat(2dp).format(mean)` | **4.48** |
| `mean.toFixed(2)` | **4.47** |
| `Math.round(mean * 100) / 100` | **4.47** |

Four implementations, two answers, split two–two. This is the same finding that made
`tieBreak` a required field rather than an optional one (entry 23) — four implementations,
three answers — recurring one layer further down, in rounding rather than in ordering. The
pinned hero figure is **4.47**, so the engine rounds half toward zero and says so.

The two `Intl`-based rows disagree for a reason worth recording: ICU formats the *shortest
decimal that round-trips* to the double, so it sees `4.475` and rounds half away from zero,
while `toFixed` formats the actual binary value — `4.474999999999999644…` — and rounds down.
**Invariant 12 is not in tension with any of this**, because rounding to the presentation
scale happens in the engine, on integers, and `Intl` only ever formats an already-rounded
value. Had the rounding been left to the formatter, the hero figure would read 4.48 and the
three pinned documents would have been wrong without anything failing.

**Rejected.** Letting the presentation layer round. It is where rounding intuitively belongs,
and it makes the hero number a property of whichever formatter GA-10 reaches for — changing
with a locale option, and unreviewable from the engine's tests.

**Later would have cost.** A number that differs from three documents, discovered when
someone reads the rendered screen against `AGENTS.md`, with no failing test pointing at the
cause.

### 36. The declared tie-break is not unique, so the order ends in a stable natural key

**Decided.** The ordering rule's final term is the member's `memberId` — the partner's
`movieId` — never a storage position.

**Evidence.** `tieBreak` is `title`, and **five shipped title strings are each shared by two
different `movieId`s**: `Emma (1996)`, `Saturn 3 (1980)`, `Confessions of a Dangerous Mind
(2002)`, `Eros (2004)` and `War of the Worlds (2005)`. A tie-break that is not unique is not
a total order, so `<measure>, <tieBreak>` alone leaves the order within such a pair to
whatever the adapter's iteration produced — which is the one thing the conformance suite
exists to make impossible. The tie-break test shuffles the **payload**, so both title indexes
and rating log positions move; an adapter discriminating on a storage position passes a
reshuffle of one and fails the other.

A second measurement belongs with it: string comparison is by **UTF-16 code unit, never
`localeCompare`**. The two orderings disagree at the very first shipped title — code-unit
order opens with `'Til There Was You (1997)`, ICU collation with `¡Three Amigos! (1986)` —
and `localeCompare` depends on the runtime's ICU build and the ambient locale, so an answer
would reorder itself across Node versions.

**Rejected.** Treating `defaultTieBreak: "title"` as sufficient because it is unique *enough*.
296 titles tie at 5.00 and only four are shown; the odds of a duplicated pair landing in a
rendered top-`limit` are low, which is exactly what makes the defect expensive — it appears
long after the code is trusted.

**Later would have cost.** An intermittent conformance failure with no reproduction, on a
suite whose entire purpose is being reproducible.

### 37. Guard behaviour lives in the registry, so the engine never branches on a `GuardId`

**Decided.** `GuardImplementation` gained an `excludes(subject, params)` predicate over a
structural `{ observations, uncategorised }`. The engine iterates `spec.guards`, looks each
id up and calls it.

**Evidence.** Invariant 6 keeps dataset-specific assumptions out of the core types, and
GA-01 already caught a `minRatingsPerTitle` field trying to get into one. The same assumption
arrives by a second route: a `switch (guard.id)` in the engine is that field one layer down,
with the type system no longer watching. The registry is where GA-03 already put "what the
engine can actually do with a guard", so the predicate belongs beside the parameter names it
already declares. `GuardSubject` is structural rather than an import of `AggregatedMember`,
so a guard cannot reach for a dataset field lying next to it.

Two rules came with it. Guards run **in spec order** and a member is attributed to the first
guard that excludes it — two guards can exclude the same member, and without an order the
trust report's `excluded` counts depend on iteration order and stop being reproducible. And
guards are **member-level** in v1: an entity-level guard is expressible in the same shape but
is not built, because nothing in v1 asks for one.

**Rejected.** A `switch` in `execute.ts`. It is shorter and it reads fine, and it is how the
portable contract acquires a MovieLens assumption without anyone deciding to put one there.

**Later would have cost.** Each new dataset adding a branch to the engine — the failure mode
invariant 6 is written to prevent, arriving through the one file nobody thought to guard.

### What the increment also measured

**296 titles tie at exactly 5.00** at `asOf 2018-09-25`, every one of them with two ratings or
fewer, against *A Streetcar Named Desire* at 4.47 with n=20. The hero moment is produced by
the generic double-run — the same spec, once with `guards: []`, diffed — and no code path
mentions ties, ratings or this dataset.

**296 exceeds `MAX_LIMIT`**, which is 120. The count is therefore asserted from the
aggregation rather than from returned rows; a test that counted rows would have quietly
asserted 120 and passed.

**C4's evidence base is now executable.** 13 undated titles carrying **18 of 100,836 ratings
(0.018%)**, the largest carrying **4** — so **none clears `min_evidence ≥ 20`**. The trust
report's note states it on any date breakdown. The disclosure is written generically, as
"entities the breakdown could not place" reported by the adapter; nothing in the engine knows
what a release year is.

**A first draft of that note said "13 titles carrying 18 of 100,836 ratings".** Both nouns are
MovieLens, sitting inside the engine — invariant 6's leak arriving through a copy string rather
than through a type, which is the one route the must-nots do not name. The wording is neutral
now, and the nouns are deferred to layer-supplied locale-keyed copy when GA-10/GA-11 style the
trust strip. The numbers are the disclosure; the wording is not yet final.

**Integer sums are exactly order-independent, and that is load-bearing.** The tie-break test
rebuilds the store from three seeded shuffles of the payload and every aggregate is unmoved.
A float sum carries no such guarantee, which is the second reason — after cross-adapter
agreement — that the store scales every measure to an integer.

**A materiality case that is false was harder to find than one that is true.** `rating_count`
by `rating_year` is the case where every member clears every guard, so emptying the guards
changes nothing and `comparison` is `null`. Without one, "material" would have been asserted
only in the direction that passes trivially.

---

## GA-05 — Fallback parser, rejection path, eval harness

**2026-09-18** · `docs/build-spec.md` §3 increment 5 · decisions now standing in
`docs/architecture.md` §8 and §9

Two of this increment's three pieces carry more weight than their size suggests. The
rejection path is what turns "the AI never computes the number" from a promise about what
the model is asked to do into a property of the shape — a question the layer cannot answer
comes back as a value the surface renders, not an exception something catches. And the eval
harness is not a testing detail: the layer ships at its thinnest and every later piece of
structure has to be earned by a failing eval, so the harness *is* the mechanism by which the
semantic layer grows. Both of those only work if a failure is evidence someone can act on,
which is why the finding — not the score — is this increment's real deliverable.

### 38. The fallback parser reads declared vocabulary, and its output space is the catalogue

**Decided.** `parseQuestion` matches in two stages: a normalised exact match against the
starter questions' own text, then a lookup for a declared label or synonym of a starter
question's measure *and* of its breakdown. Both must occur and exactly one starter may match.
What comes back is **that starter question's spec** — the parser never composes a new one —
or a `Rejection`.

**Evidence.** GA-05's must-not forbids general natural-language understanding, and GA-03's
must-not defers every synonym to "a failing eval in GA-05". Those two pull in opposite
directions if the parser is a literal string table: nothing a failing eval could add to the
layer would change what the parser understands, so the loop that is supposed to grow the layer
would have nothing to close on until GA-08, three increments later. Stage 2 resolves it without
crossing the must-not, because its dictionary is written by the dataset owner rather than
inferred: no grammar, no stemming, no edit distance, no scoring. Measured on the layer exactly
as GA-03 shipped it — no synonyms at all — stage 2 matched only literal label text and the set
scored **15 of 20**; the five synonyms named cases then earned took it to **19 of 20**.

**Rejected.** Composing a fresh spec from whatever vocabulary was found. It answers more
questions and it is where coercion gets in: *"which genres have the fewest ratings"* carries
nothing but declared vocabulary, and a composing parser answers it with the descending
ranking — the confident wrong answer, produced by the machinery built to catch it. Bounding
the output space to the catalogue makes that failure unreachable rather than unlikely.

**Later would have cost.** GA-08 replaces stage 2 with the model. Discovering there that
synonyms had never been consumed by anything would mean the layer had been growing on
judgement for three increments with no evidence that any addition was load-bearing.

### 39. A word that would flip the answer is a refusal, not a hint

**Decided.** `CONTRARY_TERMS` — locale-keyed, `en` only in v1: *fewest, lowest, worst, least,
bottom, smallest, poorest*. When stage 2 has matched a starter question and the question also
carries one of these, the parser refuses and names the word.

**Evidence.** Every starter question ranks or sequences in one declared direction, and a
question asking for the other end carries exactly the same declared vocabulary. Without this
rule *"which genres have the fewest ratings"* matches `ratings-by-genre` and returns the
descending answer with nothing on screen to say the question was inverted. This is the one
place stage 2 could coerce, so it is the one place a rule was added — and the rule only ever
makes the parser answer *less*, which is why it is safe to state as vocabulary rather than as
understanding. It is a committed rejection case, `r-fewest-ratings`, asserted on the reason and
not merely on the refusal.

**Rejected.** Reading the direction and flipping `sort.dir`. That is interpretation, and a
parser that interprets one word will be asked to interpret the next. Refusing is also the
better product: the clarifying question offers the ranking that does exist, and a starter
question ordered the other way is a catalogue addition a failing eval can earn.

**Later would have cost.** Nothing structural, but it is invisible. A composing parser that
silently inverts an answer produces no error and no test failure — it is found by a user
reading a chart, which is the failure mode this product is sold against.

### 40. The harness compares specs, and the finding is the deliverable

**Decided.** `tests/evals/questions.jsonl` maps a question to an expected `QuerySpec`; the
runner compares them. No model, no prose judging, no key. A failing case emits a **finding**
that names the missing structure, not a mismatch.

**Evidence.** A harness that judged narration would need a model to run, which puts a price on
every iteration — and a loop that costs money per run is a loop that gets run less often,
exactly when the layer most needs it. Spec comparison runs in CI, on a clean clone, and today
with no key in existence. The finding requirement is the half that is easy to lose: *"expected
avg_rating, got null"* sends the reader into the layer to work out why, while *"no measure
matched … — rating_count declares 'number of ratings' and no synonyms in en"* is the sentence
that earns the synonym. `explain()` distinguishes two failures a single message would blur — an
expectation naming something the layer does not declare at all, and something it declares under
no phrase the question uses. They have different fixes.

**Rejected.** A pass/fail runner. C5 (build-spec §6) had already settled this: with pass/fail,
"ship thin and let failing evals earn structure" and "every increment leaves the repository
green" contradict one another, and the way teams resolve that contradiction is by deleting the
failing case — which deletes the evidence the loop runs on.

**Later would have cost.** GA-08 scores the model path against the same lines. A harness whose
expectations were prose would have had to be rewritten to compare specs at exactly the moment a
second interpreter arrived, and the fallback baseline would not have been comparable to it.

### 41. The committed baseline is below 1.00, and one case is held open on purpose

**Decided.** `tests/evals/baseline.json` commits **19 of 20** against layer 1.1.0.
`p-how-well-reviewed` — *"How well reviewed are our movies?"* — fails, and is left failing.

**Evidence.** "How well reviewed" is a judgement *about* a measure, not a name for one.
Declaring it a synonym of `avg_rating` is a product decision about what the dataset owner means,
and making it by reflex to turn the score green is precisely the nearest-match coercion
invariant 4 exists to remove. Leaving it failing costs nothing — `npm test` is green and
`--check-baseline` passes at the committed ratio — and it keeps one worked example of the loop
visible in the repository rather than described in a document. A baseline of 1.000 would say the
set had been trimmed to what already passes.

**Rejected.** Removing the case, and adding the synonym. The first hides the backlog; the
second decides a product question to move a number.

**Later would have cost.** Little, in itself. But a set that only ever contains passing cases
stops being an eval set and becomes a regression suite, and the difference is whether anyone can
see what the product cannot yet do.

### 42. Node is given the resolver the bundler already had

**Decided.** `scripts/module-alias.mjs`, ~30 lines, loaded by `npm run eval` through
`node --import`. It resolves `@/x` under `src/` and fills in a missing `.ts` or `/index.ts` on a
relative specifier, and defers everything else to Node.

**Evidence.** The eval loop has to run on a clean clone with no key, no build step and no runner
dependency — the same bar `npm run ingest` already meets. But the harness reads `resolveSpec` and
the semantic loader, and everything under `src/server/` outside `ingest/` is written for a
bundler: it imports through the `@/` alias and omits extensions. Node's ESM resolver knows
neither convention, and its TypeScript stripping does not add one. Both conventions are already
declared twice — in `tsconfig.json` and again in `vitest.config.ts` — so this is a third mirror
of one declaration for the one runtime that has no resolver of its own.

**Rejected.** Adding `tsx` or `ts-node`, which breaks the zero-config `npm install` the project
is sold on for a script that runs in under a second. And rewriting the twelve modules in the
harness's import graph to relative `.ts` specifiers, which would drag GA-01, GA-03 and GA-04
files into this increment's diff and collide with GA-06 working in the same tree.

**Later would have cost.** GA-08 adds `--live` to the same runner and GA-16 puts it in the
release gate. Discovering at either point that the runner could not import the app's own modules
would mean choosing between a build step and a rewrite, under time pressure.

### 43. The key-presence branch is a branch, and the live arm is injected

**Decided.** `ai/mode.ts`: `aiMode(env)` reads the key once, and `selectInterpreter(live, env)`
returns the live interpreter only when a usable key *and* a live arm are both present. GA-08
passes its interpreter in; this increment passes `null`.

**Evidence.** "The app degrades rather than breaks" is only a property if it is decided rather
than caught. A try/catch around an SDK call degrades for the failures somebody remembered to
catch, and it cannot tell *no key* from *the request failed* — two facts the user is owed
differently (`docs/design.md` §8). Injecting the live arm keeps the SDK off the no-key path's
import graph, which is the one path that must work with nothing but the declared dependencies,
and it is why the branch is fully testable in an increment that ships no model call at all. A
whitespace-only key reads as absent: `.env.example` ships `ANTHROPIC_API_KEY=`, so a clean clone
that copies it has the variable *set* and no key, and a truthiness check would send that clone to
a 401.

**Rejected.** Importing `interpret` here and guarding the call site. It reads the same and it
puts GA-08's module — and its key handling — on the keyless path's import graph.

**Later would have cost.** GA-07 assembles `degraded` into the answer object and GA-13 renders
the one-time inline note from it. A `degraded` flag derived from a caught exception would be set
after the failure rather than before the request, which is one increment too late for the route
to report it.

### What the increment also measured

**The layer as GA-03 shipped it scores 15 of 20; the five synonyms it earned take it to 19.**
Measured by running the committed set against the layer with every synonym stripped. That is the
thinnest-viable decision paying out for the first time — and the number is worth keeping, because
"the layer grew" is the kind of claim that is easy to assert and easy to stop checking.

**Every one of the five synonyms is load-bearing, asserted mechanically.**
`tests/evals/harness.test.ts` removes each declared synonym in turn and requires the score to
fall. Build-spec §8.3 warns that the discipline "decays into 'added because it seemed useful'",
and a comment cannot hold that line: a synonym nothing fails without is one nobody earned. This
is also why GA-03's `ships no synonyms` test did not simply get deleted — the latch moved from a
count to an earning test, which is a stronger statement than the one it replaced.

**One synonym paid for two cases.** `title: "movies"` was earned by `p-best-rated-movies`, and
`p-highest-average-rating` then passed on it plus a label already declared. The case notes record
which eval earned what, including the two that earned nothing.

**`p-average-rating-each-genre` passes with no synonyms at all.** It reaches `avg_rating` and
`genre` through their declared labels, which is what the layer looked like before this increment.
Without a case like it, every paraphrase in the set would have depended on something added here,
and stage 2 would have looked like a mechanism invented to justify its own additions.

**The semantic layer is now 2,363 bytes pretty-printed against 1,719 minified**, up from GA-03's
2,157 and 1,568 — the five synonyms. Re-measured rather than left to drift: the figure is quoted
in `tests/semantic.test.ts` as the evidence for pretty-printing clearing Opus 5's 512-token cache
floor, and a measured number that no longer matches its file is the kind of claim this product
exists to argue against. The change moves in the safe direction, further above the floor.

**The layer's version went 1.0.0 → 1.1.0.** Saved recipes are keyed by `layerVersion` (build-spec
§7), and vocabulary is what decides whether a question reaches a measure. A synonym addition is a
layer change even though no measure, dimension or guard moved.

## GA-07 — The ask route and the answer object

**2026-09-18** · `docs/build-spec.md` §3 increment 7 · decisions now standing in
`docs/architecture.md` §6a

This is the seam between everything built so far and everything still to come, and it is
the first increment whose output a person will eventually see — so the shape of the answer
object is the shape of the product. Almost every decision below is about a *later*
increment: whether GA-08 substitutes an interpreter or restructures a route, whether GA-09
fills a slot or changes a response kind, whether GA-11 renders a refusal or rebuilds the
path to one. Nothing here is a model call, and there is no key; that cost the increment
nothing, because the provider question does not reach this layer.

### 44. Narration streams from the first commit, while the only producer is a template

**Decided.** The answer object carries `narration: { producer, locale }` and never the
text. The takeaway arrives as its own frames on the same response: an `answer` frame, then
zero or more `narration` deltas, then `end`. The degraded template is a single chunk.
`ai/narrate-template.ts` declares the `NarrationProducer` type —
`(ResultSet, SemanticLayer, locale) => AsyncIterable<string>` — that GA-09's model
producer will also satisfy.

**Evidence.** Build-spec §5.1 names this the single most expensive shortcut available in
the whole plan, and the cost is specific rather than rhetorical: a JSON string field is not
one field to change later, it is a change of *response kind*. `Content-Type` moves from
`application/json` to a stream type; the client moves from `await res.json()` to a reader
loop; component state moves from a value to an accumulating buffer; and every test that
read the field is rewritten. Four surfaces, for a field that was always going to stream.

The second argument was not in the plan and is the better one. Because the complete answer
object is written **before any prose**, streaming makes invariant 1 a property of the wire
format rather than a promise about the prompt: the numbers reach the screen before a
narrator says anything about them, so there is no arrangement in which a figure originates
in the narration. That ordering is free here and unobtainable from a JSON body, where the
prose and the figures arrive in the same object and only convention says which came first.

**Rejected: a `takeaway: string` field, filled by a template now and a model later.** It
is the shape that reads as obviously simpler for exactly as long as the producer is a
template.

**Rejected: Server-Sent Events.** The question travels in a body, so this is a POST, and
`EventSource` is GET-only — a browser client uses `fetch` and a stream reader either way,
which is SSE's whole ergonomic advantage gone. Its framing then costs parsing for nothing,
and its reconnect semantics are actively wrong: a dropped connection must be re-asked as a
fresh request with its own `requestId`, never silently resumed into an answer whose
provenance says otherwise. NDJSON, one JSON value per line, is what `curl -N` shows
legibly and what a `TextDecoder` and a line split read.

**Rejected: closing the stream as the end signal.** An `end` frame costs one line and is
the only way a reader can tell a finished narration from a connection that died
mid-sentence — a distinction that becomes real in GA-09, where a model writes the prose.

**Cost of deciding later.** GA-09 rewrites the route, the answer schema, the frame reader
and every component that reads a takeaway, in the same increment that first introduces a
streaming model call — so the streaming bugs and the restructuring would land together,
with nothing known-good to bisect against.

### 45. Every answer states its provenance, and a refusal states it too

**Decided.** `Answer` carries a top-level `provenance` on **both** branches of the union:
`requestId`, `adapterId`, `layerVersion`, `resolvedAsOf`. It is deliberately smaller than
`Provenance`, and on the success branch it is a projection of `resultSet.provenance` taken
by one function, `answerProvenance()`.

**Evidence.** Reproducibility is this product's central claim rather than a nicety, and
the rejection branch as GA-01 shipped it carried only `requestId` and `degraded` — so a
refusal could not say which layer version refused or at which moment. That is the branch
where it matters most: a user who asks the same question twice and is refused once is
looking at exactly the kind of unexplained difference this product exists to remove. The
as-of is therefore resolved **once, up front, before interpretation**, so the refusal
branch states the same moment the success branch would have used.

**Rejected: putting the full `Provenance` on both branches.** It carries `engineVersion`
and `computedAt`, which describe a computation a refusal never ran. Filling them anyway
would be a small lie in the one place this product cannot afford one — and the whole
argument of invariant 5 is that a partial guarantee stated as a whole one reproduces the
failure being criticised.

**Rejected: spreading the `ResultSet` across the answer to avoid duplicating provenance.**
The build spec lists the answer's contents flat, and spreading would have removed the
duplication outright. But the `ResultSet` is the artifact the conformance suite pins and a
saved recipe re-runs, and carrying it whole is the strongest available statement that the
route did not touch the numbers. The duplication is four fields with one derivation, and
`tests/ask-route.test.ts` asserts the projection field by field against the engine's own
record.

**Cost of deciding later.** GA-14 builds the provenance drawer over `requestId`,
`adapterId`, `layerVersion` and `resolvedAsOf`. A drawer that worked on answers and went
blank on refusals would be found there, four increments after the shape was set, with
GA-11's refusal rendering already built on top of it.

### 46. The refusal is served at 200; a fault is a status code

**Decided.** A question the semantic layer cannot answer returns HTTP 200 carrying
`ok: false` with its clarifying question and its concrete options intact. A malformed body
is 400 and a broken deployment is 500, both carrying the `requestId`.

**Evidence.** GA-05 made the rejection a returned value precisely so it could be rendered
rather than caught, and serving it as a 4xx would undo that one layer out: the surface
would have to reconstruct the clarification from a status code, and GA-11's showcase of
refusal-as-a-feature would be a rebuild instead of a rendering. Asserted on the status and
the content **together** — a test that only checked the body would pass against a route
serving this at 422.

Keeping faults visibly apart is what stops that from collapsing into "everything is 200".
A body with no `question` is not a clarifying question, because nothing was asked in a form
that could be clarified; there is no `nearest` to offer and no `asked` to echo.

**Rejected: a 422 for the rejection, on the reading that the request was unprocessable.**
It was processed. The product's answer to that question is the clarifying question, and
that answer is a success.

**Cost of deciding later.** GA-11 renders the refusal. Moving it from a 4xx to a 200 at
that point changes the route, the client's error path and the component boundary in the
increment that is supposed to be a rendering.

### 47. The route assembles, and the assembly is testable without a store or a server

**Decided.** `route.ts` holds only the composition root — the `.store/` read, the layer
load, the process singletons, `POST`. The assembly, the status codes, the frame order and
the stream are in `answer.ts` beside it, behind an injected `AskDependencies`.

**Evidence.** Everything the route's done-criteria assert is HTTP behaviour: a status, a
header, a frame order, two responses agreeing. Reaching that through a real server would
have made the suite need a compiled `.store/` and a spawned process, when no other test in
the build needs either — `tests/rejection.test.ts` and the rest build a warehouse from
`data/` in memory. With the dependencies injected, `tests/ask-route.test.ts` drives the
same `askResponse` the route serves and asserts on a real `Response` object, and the
`curl` runs against `next dev` then confirm the same four criteria over the wire rather
than standing in for them.

It also puts the model's arrival in one line. `selectInterpreter(null)` is the keyless
build saying it has no live arm; GA-08 passes its interpreter at that call and nothing
else in the file moves.

**Rejected: putting the assembly in `route.ts` and testing through a spawned server.** It
buys one integration and costs every unit — and the `curl` criteria already provide the
integration.

**Cost of deciding later.** GA-10 through GA-14 all read this response. A route only
testable through a server makes each of those increments either slow or untested at the
boundary they depend on.

### What the increment also measured

**`next dev` was rewriting `AGENTS.md`.** Next 16.3 appends a generated agent-rules block
to it on every start, found the first time this build had a route to serve. `AGENTS.md` is
the project's agent contract — the invariants and the settled decisions, each landed
deliberately with its rationale — so `agentRules: false` is now set in `next.config.ts`
and the guidance the block carried is cited in `docs/architecture.md` §10 instead. A
document whose authority rests on being deliberate cannot be partly automatic. Recorded
because a future session will otherwise rediscover it as a mysterious dirty file.

**The layer declares no display format, and the template narration exposes it.** All
numeric output goes through `Intl` (invariant 12), but nothing tells `Intl` how many
digits a given measure shows. The widest presentation scale in the shipped layer is
`share_rated_4_plus` at ten-thousandths, so the template caps fraction digits at four,
which keeps every measure's exact presentation value and invents no precision. The cost is
visible: an average of exactly 4.40 renders as `4.4`. A per-measure display format is a
layer field GA-10 will want at its render sites, and it is a GA-03 schema change rather
than something to guess at in a template GA-09 deletes.

**`.pick()` preserves `z.strictObject`'s catchall, asserted rather than assumed.**
`AnswerProvenanceSchema` is derived from `ProvenanceSchema` the way `ModelQuerySpecSchema`
is derived with `.omit().extend()` — one artifact, two surfaces. `AGENTS.md` bans
`.strict()` because it fails silently through Zod's v4 compatibility surface, and a
derivation that quietly dropped strictness would fail the same way, so
`tests/contracts.test.ts` case 7b pins it. Case 7c pins the other half: a `takeaway` field
added to the narration slot is a test failure, not a design decision nobody noticed.

**The hero moment survives the round trip.** `curl -N` with no key returns *A Streetcar
Named Desire* at 4.47 from 20 ratings, `min_evidence` reporting 8,440 titles excluded and
`comparison.material` true — the same figures `tests/engine.test.ts` pins, now assembled,
serialised and read back off the wire.

---

## GA-06 — Proof suite: conformance, second adapter, replay, paraphrase

**2026-09-18** · `docs/build-spec.md` §3 increment 6 · decisions now standing in
`docs/architecture.md` §5b

GA-06 is where the central claim stops being a property of one implementation. Everything
before it proved that *this* engine is deterministic; a single adapter agreeing with itself
is not evidence that the `QuerySpec` is portable, and it cannot be, because there is nothing
for it to disagree with.

The increment found a real defect in shipped code within an hour of the second adapter
existing, which is the whole argument for building it (entry 49). It also found four places
where two engines quietly diverge, none of which had been anticipated in the plan.

### 48. The second adapter is Postgres, reached by one connection string

**Decided.** `warehouse/postgres-store.ts` compiles the same `QuerySpec` to SQL and runs it
against whatever `CONFORMANCE_DATABASE_URL` names — a local server, a Supabase project, any
other Postgres. No embedded engine, no container, no second variable and no mode flag.

**Evidence.** The build spec said SQLite; the captain changed it during the increment, and
the change costs nothing because it is the same work in the same place. What it buys is the
difference between "there is a swappable seam" and "two entirely different engines produce
byte-identical numbers from the same portable query description" — the claim no competitor
in `docs/market-research.md` is making. Supabase *is* Postgres, same wire protocol and same
SQL, so the hosted and local cases differ only in the string; everything that varies between
them — TLS, port, credentials — is already expressible there. A branch in the adapter would
have been a branch with nothing behind it.

An earlier draft of this increment ran the suite on **PGlite**, the Postgres source compiled
to WebAssembly, which reports `PostgreSQL 18.3 … on wasm32-unknown-emscripten` and needs
nothing but `npm install`. It was measured and it worked — the defect in entry 49 was found
on it — and it was removed when the captain chose a server, because keeping it as a fallback
would have made the loud-skip path dead code and the suite would always have appeared to
prove two adapters.

**Rejected.** *testcontainers*: a genuine server, but it needs Docker running, and on a
machine without it the suite cannot run at all — which puts pressure on exactly the skip the
increment's must-not forbids. *A CI service container only*: free in GitHub Actions and
unavailable on a laptop, so the adapter would be proved only where nobody reads the output.

**Later would have cost.** The adapter holds no driver — it imports `@/server/contracts` and
its own sibling types and nothing else, issuing SQL through a one-method `SqlClient`. That
was written for PGlite and then pointed at `pg` without changing a line, which is the same
property that will let it be pointed at a real deployment's client later.

### 49. A member is its label *and* its id, and one adapter could not have found that out

**Decided.** `local-store.ts` keys its member map on `(memberId, key)`, not on the label.
Standing in `docs/architecture.md` §5.

**Evidence.** This is the finding the increment exists to produce, and it arrived as a
disagreement rather than as a review comment. On five of fourteen cases the two adapters
returned **identical rows** and different bookkeeping: the local adapter reported
**9,737 members where the store declares 9,742 titles**, and `includedObservations` differed
by 3 on the guarded hero query. The cause is that five MovieLens title strings are each
shared by two different `movieId`s — a fact `AGENTS.md` already records — and the local
adapter's `Map` key was the label, so it merged them and pooled two films' ratings under one
row. `GROUP BY name, movie_id` kept them apart.

It is the same fact the ordering rule already rests on: the rule ends in `memberId ASC`
*because* the declared tie-break is not unique (entry 36). An adapter that then merges on the
tie-break undoes one layer down what the ordering rule established. Merging two entities the
source distinguishes is silent coercion — invariant 4's failure mode, arriving through a
`Map` key rather than through a type.

**Rejected.** Pinning the corpus at 9,737 and calling the two adapters "agreed on the rows".
The brief for this increment names that move and forbids it: a case that passes in-process
and fails on Postgres is a finding about the engine, not a case to loosen. It would also have
inverted the increment — writing an expectation only one adapter can meet, in the file whose
job is to make that impossible.

**Later would have cost.** The hero rows were unaffected, so nothing user-facing was wrong
today. But coverage is what the trust strip renders, and GA-12 builds the catch on top of it;
the defect would have surfaced as a wrong denominator in a screen, months after the code that
caused it, with no test able to see it. `npm test` was green before and after the fix.

### 50. The suite fails when asked for the second adapter and cannot get it, and skips loudly when it was not asked

**Decided.** Three outcomes. Variable set and working: both adapters run and must agree.
Variable set and unreachable: **failure**. Variable unset: a **loud skip** that names the
consequence — the determinism claim is unproven on that run.

**Evidence.** GA-06's own must-not is *skip the second adapter because one passes*, and the
captain restated it when the target moved to a hosted database, because most people who clone
this will not have credentials. The two halves answer different failures. A silent skip on a
broken connection is how a suite rots into decoration: it goes green on the first outage and
never goes red again, so the failure that matters is the one nobody is told about. An absent
variable is not a failure of anything — nobody asked for the second adapter — but reporting
"46 passed" and nothing else would let a reader conclude the opposite of what was checked.

The banner is written with `writeSync` to file descriptor 1. Measured: piped to a file,
Vitest's default reporter **drops `console` output from files that pass** and prints it only
when something in them fails. The first version used `console.warn`, printed perfectly on a
terminal, and printed nothing at all when redirected — a loud skip that was loud only where
it did not matter, which is the quiet pass the must-not forbids wearing yet another disguise.

**Rejected.** Failing when the variable is absent. It was the first design, and it is wrong
for the population: a suite that cannot run at all on a clean clone is worse than one that
runs what it can and says plainly what it did not check.

### 51. The corpus is pinned at three explicit as-of points, and a test enforces it

**Decided.** Every case carries a non-null `asOf`, drawn from three declared points:
`2018-09-25` (the hero moment), `2007-08-02` (the replay) and `2018-09-26` (the delivery's own
`receivedAt`). `corpus.test.ts` asserts it for every case *and* every paraphrase input, and
asserts that all three points are actually used.

**Evidence.** `asOf: null` means "latest". A case pinned at latest does not fail when the next
payload lands — **it passes against different data**, which is this product's own failure mode
aimed at its own proof. The third point exists because two arbitrary moments do not exercise
the watermark at the boundary the manifest declares; the delivery as-of does.

Each case also writes out its guards in full rather than borrowing them from the layer, and
pins its whole trust report — coverage and notes, not only rows. `corpus.test.ts` asserts the
written-out guards still match `semantic/movielens.json`, so a threshold moving in the layer
cannot change what a pinned number means without failing loudly. It is `AGENTS.md`'s rule for
the pinned figures, applied to the corpus: a figure without its definition is not a pinned
figure.

**Later would have cost.** The corpus is the artifact behind the central claim. A single
unpinned case in it is worth less than no case, because it looks like proof.

### 52. The paraphrase set is pinned at the spec layer, and says what it does not yet prove

**Decided.** Five phrasings of *"What are our top rated titles?"*, each carried with the
loosely-shaped input a parser would emit, resolved through `resolveSpec()` and asserted to
produce one identical `QuerySpec` and byte-identical rows — on every adapter.

**Evidence.** GA-06 depends only on GA-04, and GA-05 (the fallback parser) was running in
parallel on its own branch. Nothing here can map English to a spec yet, and pretending
otherwise would have made the target's "N phrasings produce one byte-identical `ResultSet`"
true by writing the same input five times. The variation is real instead: one input names the
sort, one does not; one names the guards, one lets them default; one spells the tie-break, one
leaves it to the layer. That is where paraphrases actually differ once a parser exists.

The seam is the `ResolveInput`. With a parser in front of it — GA-05 has since landed — the
same corpus becomes the end-to-end paraphrase test and only that one field changes.

**Rejected.** Waiting for GA-05. The two were declared a dependency-safe swap pair and were
built in parallel; blocking on it would have made the pair fictional.

### What the increment also measured

**Four places where two engines diverge, none of them anticipated by the plan.** All four are
kept executable in `tests/conformance/suite.test.ts`, running the wrong expression beside the
pinned one, and all four are written up in `docs/architecture.md` §5b.

**The session time zone is inherited, not neutral — and this is the one that would have been
missed.** `EXTRACT(YEAR FROM to_timestamp(at))` renders in the session's `TimeZone`, which
Postgres takes from its host. A cluster initialised fresh on this machine chose
`America/Los_Angeles` without being asked, and PGlite reported `Etc/GMT+8` with no `TZ` set
anywhere. A rating an hour either side of a UTC new year is then filed under the wrong year,
with no error and no warning. The adapter pins `AT TIME ZONE 'UTC'`, and the suite runs the
**entire** Postgres corpus under `Pacific/Kiritimati` (UTC+14) so the pinning is proved rather
than trusted. The demonstration test itself failed on its first attempt, because the instant
it chose — the UTC new year exactly — does not diverge in a *positive*-offset zone; it takes
two instants, one either side, to state the hazard without depending on the sign of the
offset.

**Collation is the database's, not the engine's.** `'Til There Was You (1997)` orders before
`¡Three Amigos! (1986)` by UTF-16 code unit and after it under `und-x-icu`. That is the
disagreement `AGENTS.md` already records for `localeCompare`, arriving from a database instead
of a runtime — and it **cannot reach a result, because the adapter never orders**. The
GA-04 decision to leave ordering entirely in the engine was argued on determinism grounds
before a second engine existed; this is the measurement that was missing from it.

**`SUM()` over no rows is NULL, not zero**, so the eighteen titles nobody rated came back with
a null numerator until `COALESCE` was stated. **The uncategorised sentinel is unrepresentable
in Postgres**: `UNCATEGORISED_KEY` begins with U+0000 and `text` cannot hold a NUL byte, so it
is reconstructed in JS from the `uncategorised` flag the boundary already carries. That flag
is what `exclude_uncategorised` actually reads — had the guard keyed on the string, the second
adapter could not have implemented the guard at all. **Counts arrive as `bigint`**, which `pg`
hands back as a string and other drivers as a number or a `BigInt`; the adapter converts in one
stated place and refuses anything outside the safe integer range.

**Filter comparisons are type-strict on one side only.** The local adapter compares with `===`
and requires both sides to be numbers for `gte`, `lte` and `between`; Postgres will happily
compare text with `>=` under its collation. The SQL adapter emits `FALSE` for a comparison the
local adapter refuses, so the two disagree on no filter — a divergence avoided by reading the
other implementation rather than by translating it.

**What the run cost, measured rather than estimated.** Against a local Postgres 17.10:
**34 ms** to connect, **1,473 ms** to load 9,742 titles, 22,050 genre assignments and 100,836
ratings through `COPY … FROM STDIN`, and 19 s for the full conformance suite including both
adapters. A second run against the same server reuses the loaded data — the fixture fingerprints
the store and verifies the row counts before trusting what it finds — so only the first pays the
upload. `npm test` end to end, at the time of the run: 146 passed, 1 skipped, 6 files — 190
passed, 1 skipped, 10 files once this branch was rebased onto GA-05 and GA-07, of which
`tests/conformance` is 82 passed and 1 skipped. The rebase re-ran both adapters against a local
Postgres 17.11 and they still agree exactly; the one skip is the loud-skip banner's own test,
inactive precisely because the second adapter did run.

**The suite reports which server it agreed with**, read from `SELECT version()` rather than from
configuration. Collation and ordering semantics differ across Postgres majors, so a suite whose
job is proving two engines agree has to be able to say which engine, or a divergence found later
is unattributable.

**Two stale forward references were corrected in this document.** Entries 23 and 25 each
claimed that "the typed-array and SQLite adapters" agreed — written in GA-01 and GA-02, before
any second adapter existed, about an adapter that was never built. The claims are now true of
Postgres and say so; the entries are otherwise untouched.

---

## GA-10 — The surface: shell, zero state, answer card

**2026-09-19** · `docs/build-spec.md` §3 increment 10 · decisions now standing in
`docs/architecture.md` §11, with the layout addition in §1

The first increment a person looks at, and the one that turns five increments of contracts,
stores, engines and routes into something with a screen. It also lands under a scope
decision taken during it — the build stops after GA-11, at position 12 — which is recorded
as `docs/build-spec.md` §0 and which changed two of this increment's own deliverables. Most
of what follows is about the same tension in different places: the design settled what this
surface *looks like*, and the invariants settle what it is *allowed to say*, and every
decision below is where those two met.

### 48. The demo stops after GA-11, because the app answers questions without a model

**Decided.** Six of the sixteen increments — GA-08, GA-09, GA-13, GA-14, GA-15, GA-16 — are
deferred rather than cancelled, and the build order becomes GA-01…GA-07, then GA-10, GA-12,
GA-11. Recorded as `docs/build-spec.md` §0, marked `post-mvp` on the issue tracker, and
called out in the status line so six unticked increments do not read as an abandoned build.

**Evidence.** One fact about the dependency column, not a preference. GA-10 depends on
GA-07; GA-12 and GA-11 depend on GA-10. None of the three reaches across GA-08 or GA-09. And
invariant 1 is what makes that survivable rather than a compromise: the model never produces
a figure, so the deterministic path and the model path differ in *language*, not in
arithmetic. GA-05's fallback parser covers the starter questions, GA-07's template writes
the takeaway, and the hero moment — 296 titles tied at 5.00 naively against *A Streetcar
Named Desire* at 4.47 from 20 ratings honestly — is reachable with no API key at all.

**Rejected: cutting the surface increments instead and shipping the model path.** It
inverts the dependency graph: GA-08 and GA-09 have nothing to render into, so the demo would
be a `curl` transcript. The wedge is a screen that catches a wrong answer, and the catch is
GA-12.

**Cost of deciding later.** The three surface increments are the ones a reviewer sees, and
deferring them to build two model calls first would have spent the whole budget on the half
of the product that invariant 1 says cannot produce a number.

### 49. The design system's tokens replace shadcn's theme, rather than layering over it

**Decided.** `shadcn init -b radix -p nova` wrote a neutral greyscale house style into
`src/app/globals.css`; it was deleted. Every colour, radius, type step and duration in the
app is a `--ga-*` token from `design-system/styles.css`, declared on `:root` and mapped onto
the semantic names shadcn's components read. `@theme inline` re-exports both vocabularies,
the design system's under a `ga-` prefix.

**Evidence.** Invariant 14 is explicit that the theme *is* the approved look, and the failure
mode of the alternative is specific: a theme layered over shadcn's defaults leaves the
defaults reachable, so any component added later arrives grey and nobody notices until it is
beside a blue one. Two mappings needed thought. `--accent` is the *quiet* ground in shadcn's
vocabulary and the single strong emphasis colour in the design system's, so it maps to
`--ga-accent-soft` and the strong colour is exposed separately. And
`@custom-variant dark (&:is(.dark *))` was kept although nothing sets `.dark`: deleting it
does not remove dark mode, it restores Tailwind v4's `prefers-color-scheme` default, and
every `dark:` utility inside the shadcn components would then fire on a machine set to dark.

**Measured, and not adopted as drawn.** The approved mock uses `--accent:#5B45D6`.
`design-system/README.md` records that landing the tokens moved the accent to `#0A6FD1` and
`--ga-ink-muted` to `#655F7C`, because two measured contrast defects were fixed at the token
definition — `--ga-ink-muted` was failing WCAG 2.1 AA on `--ga-sunken` by 0.0014. The
surface inherits the fixes rather than the drawing, so the shipped colour is not the
screenshot's colour and that is deliberate.

**Rejected: shadcn's Geist default typeface.** The design system declares IBM Plex Sans and
Mono. Loaded through `next/font/google` rather than the design system's own `@import
url(...)`, which is a render-blocking third-party round trip on every page load.

**Cost of deciding later.** Retheming after four more screens exist means auditing every
component for a default that leaked through, which is exactly the audit the invariant exists
to avoid.

### 50. Three shadcn components, and the one element the claim rests on is not one of them

**Decided.** `card`, `button` and `badge` were installed. Nine others were verified in
`docs/architecture.md` §10 and were not. The semantic `<table>` behind every chart is plain
markup.

**Evidence.** Invariant 14's "each component is earned" is a rule about the catalogue, and the
table is the interesting case rather than the obvious ones. shadcn's table nests the
`<table>` inside a scroll container with its own data-slots — four utility classes' worth of
styling, in exchange for putting a `<div>` between the `<figure>` and the single element
this increment's accessibility claim depends on. The trade is not worth making for the one
element a test has to find and a screen reader has to reach.

The starter chips are the other case: they look like cards and they are `<button>`s, because
they are activated. A `<div role="button">` would re-implement Enter, Space and the focus
ring that `:focus-visible` already gives every control for free.

**Rejected: installing the verified set.** §10 verified nine components so the *decision* to
use shadcn would rest on evidence; it was never a shopping list.

**Cost of deciding later.** None, in the sense that a component can always be added. The
cost is the other direction: a catalogue installed now is a catalogue that has to be
maintained, audited for theme drift, and explained.

### 51. The chart's form comes from the spec, and its axis starts at zero even when that looks flat

**Decided.** A spec ordered by its measure renders as horizontal bars; a spec ordered by its
breakdown renders as a line. The bar axis is zero-based, the sequence is drawn with straight
segments, and an ordinal x-scale is declared explicitly.

**Evidence.** `docs/design.md` §6 names the forms — "ranked categories → horizontal bars;
time → line" — but naming them by *dimension* would put dataset knowledge in the surface and
break invariant 6. `spec.sort.by` already carries the distinction, because
`ai/fallback-parser.ts` had to make it first: ordering by the breakdown is what "how many
each year" means, and a chronological axis is the honest rendering of a sequence.

The zero baseline is the decision that cost something visible. The top ten titles sit between
4.28 and 4.47, so ten bars come out nearly the same length, and the approved mock solves that
by rescaling bar fills to the data's range (100%, 77%, 44%). Rescaling reads as a large
difference where the numbers say a small one — this product's own failure mode, drawn as a
picture — and `docs/design.md` §4 already makes the opposite point in prose about genres:
"the gap between the top and bottom category is small". The flatness *is* the finding. The
same argument rejected a monotone spline on the sequence chart, which draws values between
two members that the engine never computed.

**Measured.** Plot warned that the x-scale's strings looked like numbers on the by-year
question, and drew a warning glyph on the figure. `x.type: "point"` is now explicit: `2018`
is a declared breakdown member, not a quantity, and an inferred linear scale would place
members at numeric distances the engine never claimed.

**Rejected: server-rendering Plot.** It needs a DOM, which means jsdom, which §10 measured at
~755 ms of cold import for no accessibility gain. Plot is loaded with a dynamic `import()`
inside the effect, so it is absent from the server bundle *and* from the page's first load.

**Cost of deciding later.** GA-12's comparison block and any later chart inherit the form
rule; deciding it per-chart is how two charts of the same shape end up drawn differently.

### 52. One formatter module, and it writes a whole column to one width

**Decided.** `src/lib/intl.ts` is the only formatter the surface has. It exports `value`,
`count`, `date` and `column`, memoised per locale. `tests/ui/surface-rules.test.ts` reads the
source and fails on a second `new Intl.*` anywhere under `app/`, `components/` or `lib/`, and
on `toFixed`, `toLocaleString` or `toPrecision` anywhere at all.

**Evidence.** Invariant 12's reason is that a decimal comma changes whether `4,47` reads as a
rating or a count, and a second formatter is how one surface ends up with two answers to
that. `column` came out of the rendered screen rather than out of the rule: `Intl` drops
trailing zeros, so the hero list rendered `4.47`, `4.43`, `4.33`, `4.31`, `4.3`, `4.3` — a
precision that appears to change row by row, with the decimal points out of line in a face
chosen for its tabular numerals. The digit count is now taken from the widest value in that
same answer and applied to all of them, capped at four, so nothing is invented and nothing is
rounded here.

`date` formats in UTC, always. An as-of of `2018-09-26T00:00:00.000Z` rendered in the
reader's own zone names *25 September* anywhere west of Greenwich — an answer whose stated
moment moves with the reader — and it would also make the server and the client disagree on
the first paint.

**Rejected: adding a per-measure display format to the semantic layer now.** It is the right
answer and GA-07's journal already predicted this increment would want it. It is a GA-03
schema change, and taking it here would have meant a layer edit, a loader change and a
contracts change inside the increment that builds the screen. Recorded, not taken.

**Cost of deciding later.** Low for the layer field; high for the single module, which is why
that half was not deferred — every component added after this one would have picked its own
formatter.

### 53. The zero state cannot show a computed result, and that is structural rather than editorial

**Decided.** `src/app/page.tsx` and `src/server/surface/zero-state.ts` read the compiled
store's **manifest** and the semantic layer, and import neither `engine/` nor `warehouse/`.
The dataset line — source, titles, ratings, as-of — is the ETL's own declaration of what it
received. Each starter chip's second line is generated from the layer's labels.

**Evidence.** build-spec §1.2 forbids a score card, a metrics row, a sparkline or any
standing tile, and permits naming the data source as provenance. A reader can reasonably ask
why `100,836 ratings` is not a metric, and the answer has to be checkable rather than
asserted: a metric answers a question about the data, and this says what the data *is*. The
structural form of that is the module graph — the first paint has nothing to compute *with*
— and `tests/ui/surface-rules.test.ts` asserts it. A second test enumerates every numeral in
the rendered text against a list of five, so a figure that appears later fails rather than
ships.

The chip captions are the same argument one level down. A hand-written "ranks titles by
average rating" and the spec it describes drift apart silently; generating it from the layer
means renaming a measure renames the promise.

**Rejected: the reference's optimization-score card and metrics carousel**, and a standing
catalogue summary considered in their place. Both are numbers that exist before anyone asked
for anything — no question, no recipe, no guard, no provenance.

**Cost of deciding later.** A standing tile is the kind of thing that arrives as a small
addition and then has to be argued out of the product, because by then somebody likes it.

### What the increment also measured

**The composer cannot be a working question box, so it says so on the control.** Under §0's
cut there is no interpret call and there will not be one. `ai/fallback-parser.ts` reads
declared vocabulary and refuses the rest by design, so a box accepting any sentence would
promise a reading it cannot perform. The field is disabled with its reason beside it, and
the starter-questions control next to it works. `docs/design.md` §8 rejects a persistent
no-key banner because it keeps charging for a fact already taken in — a disabled control
explaining itself is the control's own state, read once, at the moment the user tries to
act. It is the one place this increment deviates from the approved mock, and it is recorded
rather than quietly dropped.

**The provenance drawer became provenance inline.** GA-14 is deferred, so "How did you get
this? →" would have been a control that opens nothing. The same facts are rendered behind a
`<details>`, read straight off `resultSet.provenance`. A side effect worth having: this
increment ships no overlay, so the drawer's focus defect recorded in `docs/architecture.md`
§10 — the primitive does not move focus into its content on open — cannot apply to it.

**The record-count column is dropped when the measure is that count.** On "how many ratings
each year", `n` restates `value` on every row, and a column that repeats its neighbour reads
as a defect rather than as evidence. The rule is derived from the rows, not from knowing
which measures are counts. It stays on the hero moment, where 4.47 from 20 ratings beside
4.43 from 317 is the entire point.

**Long member labels are ellipsised in the chart, never clipped.** Plot clips an overlong
tick label at the plot edge, which ate the *start* of a title: `Sunset Blvd. (a.k.a. Sunset
Boulevard) (1950)` arrived as `unset Blvd.…`, a title that does not exist. The left margin is
now sized from the longest label up to a third of the card, and anything longer gets an
explicit ellipsis. The full label is in the table, which is the artifact that has to be
complete.

**`vitest` 5 uses oxc, not esbuild.** An `esbuild: { jsx: "automatic" }` in
`vitest.config.ts` is accepted and then ignored with a warning; oxc reads `"jsx":
"react-jsx"` from `tsconfig.json` instead, so the option was removed rather than translated.
The surface tests render with `react-dom/server` and assert on the markup string, which needs
no DOM — the same reason §10 gives for keeping jsdom out of the chart's server render.

**The keyboard path was walked, not assumed.** GA-15's verification pass is deferred, which
makes this the increment where it matters. Tab order is skip link → rail → all nine starter
chips → the starter-questions control; the disabled composer field is correctly skipped;
Enter on a chip runs the question; the focus ring is the design system's 3px accent outline
at 2px offset on every one of them; and focus moves to the answer on arrival with
`preventScroll`, so a keyboard user lands on the takeaway rather than halfway down the
answer. Checked at 430px as well: the columns stack, the chart re-measures, and the document
does not scroll horizontally.

**The surface rules read source text, and that read has a known limit.** Because
`tests/ui/surface-rules.test.ts` proves text presence rather than behaviour, dead or
commented-out code carrying a matched token would pass it, and a behaviour-preserving
refactor could fail it. It is kept anyway: a render test can only assert about the
components it renders, so it can never catch the next component someone writes that formats
a number by hand or pulls the chart library into a server module — and that future component
is exactly the failure the single-`Intl` and client-render invariants exist to prevent. No
machinery to close the dead-code gap is added in this increment.

---

## GA-12 — The catch

**2026-09-19** · `docs/build-spec.md` §3 increment 11 · decisions now standing in
`docs/architecture.md` §5a, §6a and §11

The increment the product exists for. Everything before it is machinery that makes the
comparison true; this is where a person sees it. The engine has computed it since GA-04 —
ask for top rated titles and emptying the guards leaves 296 titles tied at exactly 5.00,
against *A Streetcar Named Desire* at 4.47 from 20 ratings — and the whole of this
increment is putting that on screen **without making it a special case**. Two of the four
decisions below are about resisting the shortcut: the engine could have been told about
`min_evidence`, and the component could have been told about titles. Neither was.

### 54. The comparison carries a tie count, because the rows cannot

**Decided.** `TrustReport.comparison` gains `tiedAtTop: { naive, honest }` — how many
members the ordering's **primary key** cannot separate from the leader on each side,
counted before the limit. `executeOnce` computes it with the same comparators
`orderMembers` sorts with, walking the ordered list until the first member that differs.

**Evidence.** The block has to say "296", and 296 is not in the payload it was being
given. `comparison.naive` is capped at `spec.limit` — ten rows for the hero question — so
it can say the top of the unchecked ranking is a tie and not how wide that tie is. The
width is the entire finding: ten rows at 5.00 read as a tie, 296 of 9,742 declared titles
at 5.00 read as a ranking that is not ranking anything. `tests/engine.test.ts` already
counted 296 off the aggregation for the tie-break test; the new assertion checks the
engine's own count against that one rather than against a literal, so two different routes
to the number agree — one filtering members on the rounded value, the other comparing
exact rationals down the ordered list.

**Rejected: letting the surface infer it.** It cannot be inferred from ten rows, so a
block that stated 296 anyway would be stating a figure that originated outside the engine.
Invariant 1 broken in the one place the product can least afford it, inside the block
whose argument is that figures need provenance.

**Rejected: giving the comparison each side's full coverage instead.** It answers a
different question — how many members were ranked — and the hero's naive side would have
read "9,742 of 9,742 titles ranked", which is true, unremarkable, and not the catch.

**Cost of deciding later.** `tiedAtTop` is a required field on a nullable object that the
conformance corpus pins by outcome rather than by shape, so it cost one line in
`compare.ts` and nothing in the suite. Deciding it after GA-11 had built a sentence around
the block's copy would have meant re-deriving the sentence too.

### 55. The escape is a list of guard ids on the request, not a spec

**Decided.** `AskRequest` gains `withoutGuards: string[]` — declared `GuardId`s to leave
off this run. The route resolves the question to a spec as it always does and then removes
those guards from it, by subtraction only. An id the layer does not declare is a **400
naming the id**, not a silently ignored no-op.

**Evidence.** `docs/design.md` §5 gives every guard "a one-tap escape, never a warning that
hands the user homework", and that escape has to cross the wire. Subtraction is the
smallest thing that expresses it and the safest: interpretation is untouched, so a caller
cannot reach the measure, the breakdown, the filters, the ordering or the limit through
this field. And because emptying the guards is exactly what the engine's naive run does,
an escaped answer *is* the naive side of the comparison — recomputed with its own
`requestId`, its own `computedAt` and its own trust report, asserted equal to
`comparison.naive` in `tests/ask-route.test.ts` rather than re-displayed from the previous
answer's payload.

**Rejected: a general amendment transport — the parent spec plus a `SpecPatch`.** The
machinery exists unused since GA-04 (`applyPatch`, `amendSpec`) and GA-11 will need it,
because rewriting a phrase changes measure, breakdown, limit or guard *params*. Building
it here to move one button would have been GA-12 shipping most of GA-11's increment,
against the must-not C1's swap added to this card.

**Rejected: ignoring an undeclared id.** Nobody types a `GuardId` — it reaches the field
only from a caller that read it off a trust report — so an unknown one means the client and
the layer disagree about what exists. Running every check and reporting success is
invariant 4's silent coercion arriving through a no-op instead of through a nearest match.

**Cost of deciding later.** None avoided; this is the transport GA-11 layers its sentence
onto, and it is four lines in the route plus a field on a schema.

### 56. The materiality threshold stands at 0.01, and the measurement says why it barely matters

**Decided.** `minValueDelta` stays at `0.01`, the value GA-03 set. Tuned against the
rendered block, as `docs/build-spec.md` §5 boundary 3 asked GA-12 to do, and left alone.

**Evidence — measured across all nine starter questions at the delivery's as-of.** Four
produce a block: `top-rated-titles`, `rating-by-genre`, `share-4-plus-by-genre` and
`rating-by-decade`. Five do not. The threshold was then swept over
`0.0001 · 0.001 · 0.01 · 0.05 · 0.1 · 0.5` — four orders of magnitude — and **the verdict
set is identical at every one of them.** The reason is structural: every catch this
dataset produces is a *membership* change, which `materiallyDifferent` decides with no
number at all. `min_evidence` removes 8,445 of 9,742 titles and `exclude_uncategorised`
removes one genre, so the two lists do not share members and the value delta is never
consulted.

**What that means, and what it does not.** It does not mean the threshold is dead code: it
means this dataset has no near-miss case, and a dataset whose guards nudge figures without
changing who is ranked would be decided entirely by it. Recording the sweep is the point —
the next person to look at `minValueDelta` finds that it was measured rather than left at
its first guess, and finds the one condition under which it would start to bite.

**Rejected: raising it so the three quieter blocks stop drawing.** They draw because a
check genuinely removed a member from the answer, which is what the block is for. Tuning a
threshold to suppress true positives would be manufacturing the *absence* of a catch,
which is the same defect as manufacturing one.

### 57. Copy inflects the words the surface owns, and never the words the layer declares

**Decided.** The block writes `{n} {label} values` — "296 title values" — following the
idiom the trust strip already ships, and inflects only English nouns of its own:
`record`/`records`. The approved mock reads "296 titles"; the shipped surface does not.

**Evidence.** A label is layer data (invariant 8: labels are locale-keyed, and synonyms are
for matching rather than rendering). Pluralising one in a component is the coercion
invariant 4 forbids, arriving through a copy string rather than through a type — and it
would break on the first locale whose plural is not `+s`, silently, in the one sentence
that carries the product's argument. The trust strip solved this in GA-10 without anyone
naming it; GA-12 names it.

**Measured, and it is why this is not a tidiness question.** The escape made `n === 1`
reachable for the first time: run the hero question with its checks off and the leading
title rests on a **single** rating. The closing line would have read "the unchecked leaders
rest on as few as 1 records each", and `ai/narrate-template.ts` — untouched since GA-07,
because no path had ever produced a one-record leader — wrote "from 1 records" into the
takeaway. Both are fixed; a route test pins the singular against the escaped answer and the
plural against the checked one.

**Rejected: a plural label field in the semantic layer.** It is the correct long-term
answer and it is a GA-03 schema change, which is a design change rather than an
implementation detail. Recorded here as the second layer field wanted, after the
per-measure display format GA-10 recorded.

**Cost of deciding later.** A locale added on top of an inflecting component means auditing
every copy string for an English assumption, which is the audit invariant 8 exists to avoid.

### 58. The feature that catches unsupported claims was making one

**Decided.** Every clause of the catch block's naive side is shape-aware, the way its
subhead already was: a sequence says "would have started at 1900s" and "Ordered by release
decade", never "would have led with" or "Ranked on". One branch, on `shape`, which is
`spec.sort.by` and nothing else. The block is **not** withheld from sequences.

**Evidence — and this is the part worth getting right rather than merely fixing.** The
block exists to show the user a confident claim the data does not support. On
`rating-by-decade` it was *making* one. That starter sorts `by: "breakdown"`, so its
ordering is chronological and its first row is simply the earliest decade — yet the block
announced "would have led with 1900s", "Led by 1900s", "Ranked on average rating alone",
and closed with "the same release decade values are ranked on both sides". Four clauses
each asserting a rank the ordering never computed, on a starter entry 56 had already
measured as producing a block.

The contradiction was internal, not novel. The subhead had been made sequence-aware —
"it starts at …" — so the component **knew** the shape and said something else four
clauses later. `ai/narrate-template.ts` had taken this exact position in GA-07 and written
down why: "calling its first row the leader would be a claim the ordering does not make."
Fixing this was completing an approved design, not extending one.

**Found by review, not by the author.** It is recorded that way deliberately. The hero
question is a ranking, so every figure, screenshot and manual pass in this increment
exercised the ranking branch; the sequence branch shipped in the same component, reachable
from a chip on the zero state, and was never looked at. A defect that only the *other*
starter reveals is exactly what a reviewer who reads the diff rather than the demo is for.

**Rejected: declining to draw the block for sequences.** It was the other remedy the
finding offered, and it is worse. `rating-by-decade` has a genuinely material difference —
a check removes a member — so suppressing the block there withholds a true catch. This
product's two symmetric failures are manufacturing a catch that is not there and hiding
one that is; trading a copy defect for the second is not a fix.

**Cost of deciding later.** Small in code — one branch and a fixture — and large in
credibility. The one screen whose whole argument is "we tell you when the obvious answer
would have misled you" cannot itself assert a ranking that was never computed.

### What the increment also measured

**The block is the largest object on the screen, and that is checked rather than asserted.**
Measured in the browser at 430px: the catch is **1,864 CSS pixels** tall against the chart
card's **476**, both at the column's full **468** width, with zero horizontal overflow. At
1440px the two sides sit either side of the "becomes" connector; below `lg` they stack and
the connector rotates.

**The keyboard path was walked, because GA-15's verification pass is deferred.** Enter on a
starter chip runs the question and moves focus to the answer region; one Tab from there
reaches "Show me the unchecked list anyway" — it is the **first** tabbable element in the
answer column, ahead of both disclosures — `:focus-visible` matches, the ring is the design
system's 3px accent at 2px offset, and Enter takes the escape. "Put the checks back"
returns the catch. No console errors on any of it.

**The accessibility tree reads as the argument reads.** Three labelled regions — the block
and one per side — each with a real heading; every row writes out its own value and its own
record count, so nothing depends on colour or on bar length; and the two elements carrying
no words, the gradient rule and the "becomes" connector, are the two that are
`aria-hidden`. Strip the colour and nothing is lost, which is `docs/design.md` §7's test
rather than a claim about it.

**The naive leaders are not the ones `docs/design.md` §4 names.** The design doc lists
*Lesson Faust*, *Lamerica* and *Heidi Fleiss* at n=2; the engine's ordering rule —
`<measure> desc, <tieBreak> ASC, <memberId> ASC`, by UTF-16 code unit — puts `'Salem's Lot
(2004)`, `12 Angry Men (1997)` and `12 Chairs (1976)` first, each at n=1. Both are true
statements about 296 tied titles and neither is wrong; what decides which three a reader
sees is the tie-break, which is precisely the field GA-01 made required because four
implementations produced three different answers without one. The fixture carries the
engine's answer, not the doc's.

**`tests/ui/` grew a fourth rule it can hold and GA-15 cannot.** The three GA-10 shipped
were about things that fail silently; this one is about a thing that fails *loudly and
later*. `catch-block.test.tsx` drives the block's presence from `materiallyDifferent`
itself, so the component's verdict and the engine's are asserted to be one verdict — a
hand-written "this fixture should render nothing" would pass just as well against a
component that had stopped reading `trust.comparison` at all.
## GA-08 — Interpret: structured outputs on a cached prefix

**2026-09-19** · `docs/build-spec.md` §3 increment 8 · decisions now standing in
`docs/architecture.md` §6, §8 and §9

The increment that was deferred at position 12 and came back. `docs/build-spec.md` §0
deferred GA-08 because the build had no API key and the app answers questions without one;
a key now exists, so the model path is buildable and the question box GA-10 rendered as a
disabled control that explains itself becomes a control that works.

What shaped this increment more than the model call itself was a constraint arriving with
it: **the key is the product's, not the builder's, and no development or test spend was
authorised against it.** That is not a limitation worked around below. It forced the
caching claim onto the artifact that could actually carry it — the request — and the result
is a check that runs on every clone instead of one that runs wherever somebody has a key.

### 59. Caching is asserted against the request, not against a live response

**Decided.** `tests/ai/interpret.test.ts` asserts the properties prompt caching rests on as
properties of the object `interpretRequest()` builds: the `system` prefix byte-identical
across two questions sharing no words, exactly one `cache_control` breakpoint and it on the
final block, the question present in `messages` and absent from every prefix block, and the
prefix clear of the 512-token floor with margin. The live reading of
`cache_read_input_tokens` still exists and still runs two identical requests — as an opt-in
suite that skips loudly (entry 61).

**Evidence.** Caching is a *prefix match*: any byte differing before the breakpoint
invalidates everything after it. That is a property of the request, fully determined before
anything is sent, so a live response can only confirm it after the fact. And the failure it
guards against is silent — no error, no warning, no header, just uncached cost forever — so
the check has to run where silence is cheapest to notice, which is every test run on every
clone with no key.

**Rejected: a live-only assertion, run wherever a key happens to exist.** It would have
made the single most expensive silent regression in the build checkable only in the
environments least likely to run the full suite, and unverifiable in CI. The same reasoning
already runs through this build: the QuerySpec is the contract, and the eval harness
compares specs rather than prose precisely so it needs nothing.

**Cost of deciding later.** A live-only check would have gone quiet the first time someone
ran the suite without a key, and nothing would have said so — which is the shape of the
defect it was supposed to catch.

### 60. The few-shot examples are generated from the catalogue, not authored

**Decided.** `fewShotExamples()` builds the block from `STARTER_QUESTIONS` and the semantic
layer, passing each example through `ModelQuerySpecSchema`. Nine examples ship. The
instruction text and the catalogue block carry nothing but the layer they are handed, proved
by building the prefix from a layer that shares no vocabulary with MovieLens.

**Evidence.** Invariant 6 says nothing dataset-specific belongs in the core types, the
engine, **or the prompt**. A hand-written block naming `avg_rating` and `genre` would put a
MovieLens assumption inside the portable half of the build — the same mistake the design
review already caught once in `guards: { minRatingsPerTitle }`. Generating them also closes
a drift the layer's own loop would otherwise open: the layer grows a synonym every time an
eval earns one, and an authored example would keep teaching the old vocabulary.

**Rejected: authoring five examples by hand for control over their quality.** It buys
phrasing that generation does not, and pays with a second copy of the catalogue that
nothing keeps honest. Validating each generated example through the model's own schema
recovers most of the control: an example cannot teach a shape the runtime would reject.

**The claim was too strong once, and a test caught it.** The first version of this entry said
the prompt names no dataset. It does: `STARTER_QUESTIONS` carries MovieLens ids, so the
examples block does too. The behavioural test that replaced a source scan — build the prefix
from a layer sharing no vocabulary with MovieLens, assert nothing leaks — failed on
`avg_rating`, which is how the overstatement surfaced. What is true is narrower and is what
this entry now claims: the instructions and the catalogue block carry only the layer they are
handed, and generation introduces **no coupling beyond the one `docs/architecture.md` §8
already declared** for the starter questions. Both halves are asserted now, the second
specifically so the limit cannot be quietly restated as the stronger claim later.

**Cost of deciding later.** Regenerating an authored block after the layer had grown means
re-deriving which examples were still true, against a file that had changed for reasons
nobody recorded.

### 61. The live check has its own key variable, because the app's key is not permission to bill `npm test`

**Decided.** The opt-in live suite reads `LIVE_INTERPRET_API_KEY` — never
`ANTHROPIC_API_KEY` — and passes it to the client explicitly rather than letting the SDK
resolve one from the environment. Unset is a loud skip naming what went unchecked; set and
failing is a failure. `npm run eval -- --live` refuses rather than degrades when no key is
present.

**Evidence.** `ANTHROPIC_API_KEY` is present in exactly the environments where the app
runs, which is where `npm test` runs too. A suite gated on it would have fired paid requests
on an ordinary test command, silently, on a machine whose owner had set the variable for the
app. The distinction is not hypothetical: it was discovered while building this increment,
in an environment that had the product's key set.

**Rejected: gating the live suite on `ANTHROPIC_API_KEY` and trusting people to notice.**
It is the same shape as the conformance suite's rejected "skip the second adapter because
one passes" — a default that produces a surprise, where the surprise is a bill.

**Cost of deciding later.** The first unexpected invoice, attributed to nothing, after the
command that caused it had been run hundreds of times.

### 62. An undeclared term is echoed, and the refusal is GA-05's, unchanged

**Decided.** The instructions tell the model to put the user's own word verbatim into
`measure`, `breakdown` or a filter when the catalogue declares no such thing, rather than
substituting the closest declared id. `resolveSpec()` then recognises it as undeclared and
returns the same `Rejection`, through the same builder, as the fallback parser's.

**Evidence.** Structured outputs forces the model to emit *a* spec — there is no refusal
shape available to it. So the only two options were a helpful substitution, which is exactly
the silent coercion invariant 4 exists to remove, or an echo that the deterministic layer can
recognise. The second keeps the refusal path deterministic: what decides that a question
cannot be answered is still `resolveSpec()` reading the layer, never the model's judgement.

**Rejected: a second output shape letting the model return a refusal directly.** It moves
the decision about what is answerable into the model, which is the one thing the semantic
layer exists to prevent, and it would have made GA-11's showcase of refusal depend on the
model's willingness to produce one.

**Cost of deciding later.** GA-11 renders refusals. Discovering there that a refusal is
whatever the model felt like refusing would have been a rebuild of the rendering and the
prompt at once.

### 63. The live arm is supplied without putting the SDK on the keyless import graph

**Decided.** `ai/mode.ts` is untouched. `route.ts` reaches `ai/interpret.ts` through
`await import(...)`, taken only when `aiMode()` says `live`, and hands the result to
`selectInterpreter`. `page.tsx` calls the same `aiMode()` to decide whether the question box
is live.

**Evidence.** GA-05 built the seam as an injection specifically so the SDK and its key
handling would stay off the import graph of the path that must work on a clean clone
(invariant 13). A static `import` in `route.ts` would have honoured the seam's shape and
broken its purpose — the keyless path would depend on a package it never calls. Reading the
mode from one function in both places is what keeps the composer the user sees and the
interpreter the route got from being two different answers.

**Rejected: a static import, on the grounds that the SDK is a declared dependency anyway.**
True and beside the point: the brief for the seam is about the graph, not about whether
`npm install` succeeds.

**Cost of deciding later.** Unwinding a static import after other modules had started
reaching through it.

### 64. Two baselines, in two files, because the paths will not agree

**Decided.** `npm run eval -- --live` scores the same twenty cases the same way and records
against `tests/evals/baseline.live.json`, beside the fallback path's `baseline.json`. Each
file names the path that produced it.

**Evidence.** The model path and the fallback path are different interpreters over one
case set, and their disagreement is the measurement this increment exists to produce. One
file holding whichever ran last would erase it, and `--update-baseline` on a live run would
silently redefine what the keyless regression is checked against — turning the file that
protects GA-05's loop into one that had been quietly overwritten by GA-08.

**Rejected: one file with a `path` field, overwritten by whichever run was last.** The
schema already carries `path`, which is what made this tempting; the field identifies a
score, it does not keep two of them.

**Cost of deciding later.** A keyless regression passing against a live baseline, which is
the eval loop's own confident wrong answer.

### 65. Recorded: the few-shot count, the prefix size, and what is still unmeasured

**The figures this increment was required to record**, measured on the shipped artifacts
rather than estimated:

| Recorded | Value |
| --- | --- |
| Few-shot examples in the stable prefix | **9** (contract floor: 5) |
| `system` blocks, and which carries the breakpoint | **3**, breakpoint on block 3 |
| Instructions block | 1,169 characters |
| Catalogue block | 2,889 characters (**1,826 minified**) |
| Examples block | 3,339 characters |
| **Stable prefix total** | **7,397 characters ≈ 1,849 tokens** at 4 chars/token |
| First `cache_read_input_tokens` reading | **not measured — see below** |

Two of those numbers are the cost argument. The catalogue block alone is ~722 estimated
tokens pretty-printed and **~456 minified**, which is *below* Opus 5's 512-token floor: the
whitespace is what carries a thin layer over it, exactly as `docs/architecture.md` §3
recorded before this prefix existed. The examples add ~835 tokens on top, which is what
turns a prefix that just clears the floor into one with margin. Both are cost requirements,
and trimming either raises the bill.

**The first `cache_read_input_tokens` reading was not taken.** No live call was made during
this increment: the key belongs to the product and no development spend was authorised
against it. The check that would take that reading is written, runs two identical requests,
and skips loudly until `LIVE_INTERPRET_API_KEY` is set — and the property it would confirm
is asserted structurally in the meantime (entry 59). This is recorded as an outstanding
measurement rather than presented as a completed one, because a figure nobody measured
written down beside figures somebody did is the exact failure this product argues against.

### 66. The question box is live exactly when the deployment can read a sentence

**Decided.** `SurfaceData` gains `canInterpret`, read from `aiMode()` on the server and sent
with the page. Live, the composer accepts typing, sends on Enter and offers an **Ask**
button; keyless, it stays the disabled control GA-10 shipped, with GA-10's copy unchanged.
Both states are stated on the control, and `tests/ui/session-column.test.tsx` holds both.

**Evidence.** GA-10 disabled the box because free typing is the one part of this product
that genuinely needs interpretation, and a box accepting any sentence with no interpreter
promises a reading it cannot perform. That argument is unchanged — it just resolves the
other way when an interpreter exists. The keyless state is kept and tested rather than
deleted because invariant 13 makes that a real deployment, not a degraded one nobody ships.

**Rejected: a banner announcing the model, or removing the keyless copy now that a key
exists.** `docs/design.md` §8 already rejected a persistent banner for charging repeatedly
for a fact the user has taken in; and deleting the keyless branch would make invariant 13
true only until someone cloned the repository.

**Cost of deciding later.** A demo whose question box is visibly dead, which invites the
wrong closing question.

---

---

## Keeping this current

This document is the project's running record, not a retrospective.

**Every increment adds its entries as it lands, in the same commit as the work.** An entry is four
short lines — what was decided, the evidence, what was rejected, what deciding later would have
cost — plus a link to the source that carries the depth. Where an increment's measurement
contradicts `docs/design.md`, the design changes first with its rationale (per `AGENTS.md`), and the
entry records why.

A journal reconstructed at the end is a summary. One written as the work lands is evidence.
