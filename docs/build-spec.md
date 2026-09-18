# Golden Analytics — the v1 build spec

**Status: in progress.** GA-01, GA-02 and GA-03 have landed; the remaining thirteen ticks below are empty.

## What this document is

The plan the v1 increments came from: the target v1 is built towards, the order the sixteen
increments are built in, each increment's definition of done and its must-nots, the boundaries and
seams the order protects, and the decisions already taken so they are not taken again by accident.

It exists because the design, the architecture and the code are all visible in this repository but
the reasoning that turned the design into sixteen tasks was not. Without it the increments arrive as
assertions — *assert exactly four guards* — with no trace of why, which is this product's own failure
mode pointed at its documentation.

## What this document is not

It is **not** a live contract, and it is the opposite kind of document from `docs/design.md`.
`AGENTS.md` says the design doc wins over code until the doc is changed. A build spec is *consumed*:
each increment that lands turns a piece of it into history. A landed increment's definition of done
below is a record of what was built, not an instruction to keep the code matching it. Where this file
and shipped code disagree about a landed increment, **the code wins and this file is stale.**

It is also not the technical record. As each open implementer choice below is settled, the decision
migrates out to `docs/architecture.md` and leaves this file. The same is true of §4.3's type listing,
which is explicitly time-boxed — see the banner there.

## When it stops being true

- **Per-increment ticks.** Each increment's definition of done gains one line as it lands: the date
  and the commit. That line is what marks it as history rather than instruction.
- **The end.** When GA-16 lands, this file either gains a `Completed` header naming the commit range,
  or — preferred — is folded into `docs/how-this-was-built.md` as its plan appendix, putting the plan
  beside the narrative of executing it and leaving `docs/` carrying only live documents.

## This file and the issue tracker

The increment definitions in §3 are the source the GitHub issues GA-01…GA-16 were generated from.
**If the two ever disagree, this file wins and the issue is corrected** — the issue is a work queue,
this is the record.

## Where else to look

- [`docs/design.md`](design.md) — the product argument: who this is for, and what the wedge is.
- `docs/architecture.md` — the technical decisions, including every implementer choice that has
  migrated out of §7 of this file.
- `docs/how-this-was-built.md` — the decision history, written as each increment lands.
- [github.com/phuhien92/analytics-demo/issues](https://github.com/phuhien92/analytics-demo/issues) —
  live status. This file does not track progress beyond the ticks.

---

## 1. The target

v1 is finished when every line below is true. Each is checkable by running something, not by
reading the code.

### On a clean clone, with no `ANTHROPIC_API_KEY`

1. `npm install && npm run ingest && npm run dev` serves one page, no credential, no external service.
2. The zero state shows starter questions and the dataset named as provenance. No score card, no
   metrics row, no sparkline, no standing tile — **no computed result appears that is not downstream
   of a question asked in this session.**
3. Clicking *"What are our top rated titles?"* returns, inline and in this order: the naive/honest
   comparison as the largest object on screen, a plain-English takeaway, a chart, the one-line recipe
   sentence, the trust strip, and "How did you get this? →".
4. The comparison shows **296 titles tied at 5.00** on the naive side against **A Streetcar Named
   Desire 4.47 (n=20)** and **The Shawshank Redemption 4.43 (n=317)** on the honest side.
5. A one-time inline note on that first answer states, in order, that the numbers are unaffected,
   that free typing is unavailable, that amendments are unavailable, and that the summary is a fixed
   template. It does not appear again that session.
6. Every phrase in the recipe sentence is tappable and still works — closed-list edits rewrite the
   spec deterministically and never call a model.
7. Every chart has a real `<table>` behind it, reachable through a disclosure any user can open.
8. `npm test` is green, with the live-model suites reported **skipped**, not passed.

### With a key

9. A freely typed question is interpreted into a `QuerySpec` and answered; the takeaway streams.
10. A follow-up renders as a diff — changed **and** unchanged lines — and nothing executes until Apply.
11. A question the semantic layer cannot answer produces a clarifying question naming what is
    missing and offering nearest questions that work. It is never coerced to a near match.
12. `usage.cache_read_input_tokens > 0` on the second identical interpret call.

### The proof suite

13. `npx vitest run tests/conformance` passes the **same case list on two different adapters**
    (typed arrays and SQLite), every case carrying an explicit, non-null `asOf`.
14. A case pinned at `asOf 2007-08-02` still passes against the full 2018 store — the as-of replay.
15. N phrasings of one question produce one byte-identical `ResultSet`.
16. The six pinned figures pass, each asserted **with its definition, its guards in effect and its
    as-of** — not as a bare number.
17. The naive top-4 is stable across three shuffles of the input order.
18. axe reports 0 violations across all six states, and a keyboard-only run through
    ask → amend → provenance drawer is recorded.

### The claims, made structurally rather than asserted

19. No figure originates in a model response: the model emits a spec, the engine emits numbers.
20. The narrate call's request body carries at most 20 aggregated rows plus the trust report, and no
    raw record — asserted by inspecting the body, not the prose.
21. The word "verified" appears nowhere user-facing.
22. `grep -rn "output_format" src/` returns nothing.
23. Turning the key off removes the model entirely and **every number stays identical**.

---
---

## 2. The order

**Ids are stable; positions are not.** C1 moved the catch one session earlier, so GA-12 is built
eleventh and GA-11 twelfth. The ids did not change — GA-12 is still "the catch" in every
cross-reference. **Build in the `#` column's order, not in id order.**

| # | id | title | depends on | size | order |
| --- | --- | --- | --- | --- | --- |
| 1 | GA-01 | Scaffold and the core contracts | — | M | locked (first) |
| 2 | GA-02 | Received payload, ETL, append-only store, pinned figures | GA-01 | M | flexible with GA-03 |
| 3 | GA-03 | Semantic layer, guard registry, loader | GA-01 | S | flexible with GA-02 |
| 4 | GA-04 | The deterministic engine and the local adapter | GA-02, GA-03 | L | locked |
| 5 | GA-05 | Fallback parser, rejection path, eval harness | GA-03, GA-04 | M | flexible with GA-06 |
| 6 | GA-06 | Proof suite: conformance, second adapter, replay, paraphrase | GA-04 | M | flexible with GA-05 |
| 7 | GA-07 | The ask route and the answer object | GA-05 | S | locked |
| 8 | GA-08 | Interpret: structured outputs on a cached prefix | GA-07 | M | locked |
| 9 | GA-09 | Narrate, and amend | GA-07, GA-08 | M | locked |
| 10 | GA-10 | The surface: shell, zero state, answer card | GA-07 | L | locked |
| **11** | **GA-12** | **The catch** | GA-10 | M | **moved up one by C1** |
| **12** | **GA-11** | **The recipe sentence** | GA-10 | M | **moved down one by C1** |
| 13 | GA-13 | The amendment diff, and the degraded note | GA-09, GA-10 | M | locked |
| 14 | GA-14 | Provenance, saved recipes, shareable answer | GA-13 | L | locked |
| 15 | GA-15 | Accessibility verification and the determinism moment | GA-14 | M | locked |
| 16 | GA-16 | README, deploy configuration, release gate | GA-15 | S | locked (last) |

Every increment leaves the repository with `npm test` green and `npm run build` passing.

### The three dependency-safe swap pairs

Derived from the dependency column, not asserted. Nothing downstream distinguishes either member,
so either order builds:

- **GA-02 ↔ GA-03**
- **GA-05 ↔ GA-06**
- **GA-11 ↔ GA-12** — exercised by C1

**GA-08 ↔ GA-09 and GA-13 ↔ GA-14 are *not* safe**, though an earlier draft of the table said they
were: GA-09's *amend* half calls GA-08's interpret, and GA-14's *Compare* reuses GA-13's diff
renderer. Both are locked. This was caught by deriving swap-safety from the dependency column rather
than restating it.

### One line every definition of done carries

The recording contract is an invariant and lives in `AGENTS.md`, so it survives this file's
retirement; it is cited here, not owned here. The decisions an increment made, and the evidence
behind them, are written into `docs/how-this-was-built.md` **as part of that increment** rather than
reconstructed later. It
is a sentence, not a deliverable — and where an increment decides nothing real (GA-15, GA-16) the
line says so rather than inventing one. That document is written and backfilled by a separate task;
it is not an increment here.

**Technical decisions have a second destination.** Where an increment also changes the authoritative
technical record — GA-01's contracts, GA-02's storage model, GA-04's engine semantics, GA-06's adapter
contract — that lands in **`docs/architecture.md`**, never in `docs/design.md`, which stops carrying
technical decisions. An increment that decides nothing architectural writes nothing there and says so
rather than inventing an entry.

The no-mistakes pipeline is skipped for this project, so every definition of done below is
self-sufficient: it names the command that proves the increment and what passing looks like.

### A note on section citations

`docs/design.md` is being split: technical material moves to `docs/architecture.md` and section
numbers change in both documents. **Every `§n` reference to `design.md` in this file is to the
pre-split document** and is deliberately not chased. There are two: `§16` (out of scope, in GA-14)
and `§11` (the Interface section, in §8). The Interface section's *content* stays in
`design.md` and is unaffected — but read "§11" as naming that section, not as a number that will
survive the renumbering.

---

## 3. The increments

### 1. GA-01 — Scaffold and the core contracts

**Size** M — one session · **Depends on** nothing

**Landed** 2026-09-18 · [PR #18](https://github.com/phuhien92/analytics-demo/pull/18). Decisions recorded in
`docs/how-this-was-built.md` part three; the standing technical record is `docs/architecture.md` §2.
From here this definition of done is a record of what was built, not an instruction to keep code
matching it.

**Delivers.** A Next.js 16.3.5 App Router TypeScript app in strict mode; **zod@^4 pinned** (the SDK's structured-output helper imports `zod/v4`); the SDK, Observable Plot and Vitest installed but unused; and **src/server/contracts/** — every type the rest of the build reads, including `tieBreak` required and `asOf` nullable. Schemas use **`z.strictObject()`**, Zod 4's API — not the v3 `.strict()` form.

**Done when.**
- `npx tsc --noEmit` → exit 0, no output.
- `npm run build` → “Compiled successfully”.
- `npx vitest run tests/contracts.test.ts` → ten cases pass, including **a spec carrying `joins` is rejected** — asserted on both `QuerySpecSchema` and the derived `ModelQuerySpecSchema`, and on the issue code `unrecognized_keys` rather than merely on a throw.
- `grep -rn "\.strict()" src/server/contracts/` → no matches. `.strict()` is Zod 3's form; it still works through v4's compat surface, so nothing fails loudly if it creeps into the file every later increment imports.
- `grep -rn "output_format" src/ tests/` → no matches.
- `npm ls zod` → resolves 4.x.
- Recorded in `docs/how-this-was-built.md`: why `tieBreak` is required rather than optional, why `asOf` is nullable on the spec and never null in provenance, and why `contracts/` is a module of its own.
- **The measured dimension cardinality that grounds `MAX_LIMIT = 120` is carried into the code**: a comment on the constant in `contracts/query-spec.ts` naming genre 19, release decade 12, rating year 23, release year 106, title 9,742, and the same line in `docs/architecture.md`. The constant outlives this plan; the measurement must travel with it, or 120 reads as a round number and the next person rounds it differently.
- **§4.3 and §4.4 of this file are deleted**, their surviving reasoning moved to `docs/architecture.md`. They are time-boxed to this increment: once `src/server/contracts/` and `tests/contracts.test.ts` exist, they are a second source of truth. This deletion is part of GA-01, not a follow-up.

**Must not.**
- Implement any aggregation, parsing or model call.
- Import `node:*`, `next/*`, or anything under `warehouse/`, `engine/` or `ai/` from `contracts/` — it is a leaf the UI imports too.
- **Name any MovieLens entity in a core type.** A `minRatingsPerTitle`-shaped field here is the exact mistake design review caught once already.
- Run `shadcn init` — that blocks increment 1 on the in-flight shadcn verification for no gain.
- Write `semantic/movielens.json`.

### 2. GA-02 — Received payload, ETL, append-only store, pinned figures

**Size** M — one session · **Depends on** GA-01 · **Swappable with** GA-03

**Landed** 2026-09-18 · [PR #21](https://github.com/phuhien92/analytics-demo/pull/21). Decisions recorded in
`docs/how-this-was-built.md` part three; the standing technical record is
`docs/architecture.md` §2a. From here this definition of done is a record of what was built, not an
instruction to keep code matching it.

**Delivers.** The `ReceivedPayload` body; `scripts/ingest-payload.ts` reading the four CSVs **as one received payload from a partner application**, CRLF-stripped and quoted-field-safe; a typed-array store holding ratings as **scaled integers** over an append-only event log; and the pinned-figure suite.

**Done when.**
- `npm run ingest` → writes the store and prints `9742 titles · 100836 ratings · 610 viewers`.
- `tests/pinned-figures.test.ts` asserts each figure **with its definition, its guards in effect and its as-of**: 296 titles at 5.00 (max n=2) · 8,427 of 9,724 rated titles under 20 ratings · 18 titles never rated · 34 `(no genres listed)` · 13 undated.
- Genres per movie asserts **2.27 with `exclude_uncategorised` on and 2.26 with it off** — both, because the most natural implementation gives 2.26 and a faithful team would otherwise hit a false ETL regression on day one.
- Genre cardinality asserts **19**, with a companion case asserting an unstripped parse yields 38 — the CRLF regression test. All four supplied CSVs are CRLF (measured).
- A payload missing a required field is rejected with a Zod error whose `path` names the field — asserted on the error, not merely thrown.
- Recorded: why the store is append-only and every measure is a scaled integer, and why the genre average is asserted at both 2.27 and 2.26.

**Must not.**
- Apply any guard. Guards belong to the engine and arrive in the spec.
- **Overwrite any record in place.** The store is append-only or it cannot answer `asOf` later, and retrofitting immutability is a storage rewrite rather than a field addition.
- Store any measure as a float. Half-stars are dyadic and would be safe, but a partner payload carrying prices reintroduces cross-adapter disagreement in the 11th decimal — scaled integers as policy, not coincidence.
- Decide the semantic layer's contents.
- Read `data/*.csv` at request time.

### 3. GA-03 — Semantic layer, guard registry, loader

**Size** S — half a session · **Depends on** GA-01 · **Swappable with** GA-02

**Landed** 2026-09-18 · [PR #19](https://github.com/phuhien92/analytics-demo/pull/19). Decisions recorded in
`docs/how-this-was-built.md` part three; the standing technical record is `docs/architecture.md` §3
and §4. From here this definition of done is a record of what was built, not an instruction to keep
code matching it.

> **C4 settled: Disclose in the trust report's coverage line, no fifth guard** — The thirteen undated titles. See §6.

**Delivers.** `semantic/movielens.json` at its thinnest viable — five measures, five dimensions, the four trust guards, `en` labels only, **no synonyms and no filter vocabulary** — plus `version`, `schemaVersion`, a declared default `tieBreak` and the materiality threshold. A fail-fast loader with path-pointing errors, and the `GuardId` registry. **Four guards, not five** — C4 settled that the undated titles are disclosed in coverage rather than given a fifth guard.

**Done when.**
- The shipped layer loads and `layer.version` is a non-empty string.
- A layer declaring a `GuardId` absent from the registry **fails at load, naming the id**.
- A layer with a flat, non-locale-keyed label fails, naming the path.
- A layer whose `defaultTieBreak` is not a declared dimension fails.
- The shipped file contains newlines — it is pretty-printed, and the test carries the reason: minifying saves ~370 bytes and can drop the cached prefix under Opus 5's 512-token caching floor, **which fails silently with no error**.
- **The registry holds exactly four guards**, asserted, so a fifth cannot arrive without a decision. *C4's other half lands in GA-04: the trust report's coverage note must carry the undated members.*
- Recorded: which five measures and five dimensions shipped and why those, and why the layer is pretty-printed.

**Must not.**
- Add a single synonym or filter-vocabulary entry. Volume is earned by a failing eval in GA-05, never by anticipation.
- Hardcode `20` inside the guard registry. Thresholds arrive as spec `params`, defaulted by the layer.
- Minify the layer.
- **Flatten labels to `"label": "average rating"`.** Thin is volume and grows back free; flat is shape and costs a schema + prompt + matching rewrite — and every eval passes against a flat layer right up until the first non-English locale.

### 4. GA-04 — The deterministic engine and the local adapter

**Size** L — one full session, no slack · **Depends on** GA-02, GA-03

**Landed** — not yet.

**Delivers.** `warehouse/types.ts` (`aggregate(spec)` plus `adapterId`) and `local-store.ts`; `engine/execute.ts` — pure, guards taken from the spec, ordering `<measure> <dir>, <tieBreak> ASC`, the `asOf` watermark filter, provenance and the trust report; `compare.ts`; `amend.ts`; `resolve.ts`.

**Done when.**
- Hero, honest, `asOf 2018-09-25`: Streetcar **4.47 (n=20)**, Shawshank 4.43 (n=317), Sunset Blvd. 4.33 (n=27), Philadelphia Story 4.31 (n=29).
- Hero, naive, `guards: []`: **296 rows tie at 5.00** and the returned top-4 is identical across three shuffles of the input order — the tie-break test.
- Replay at `asOf 2007-08-02`: Shawshank 4.46 (n=149), Dr. Strangelove 4.44 (n=43), Lawrence of Arabia 4.44 (n=32).
- `materiallyDifferent` true on the hero query, false on a named query no guard changes.
- `applyPatch` with `reAsOf` **absent** inherits the parent's `resolvedAsOf`; with `reAsOf: null` it re-resolves to latest.
- `resolveSpec({measure:"revenue"})` returns `{ok:false, rejection}` and `.not.toThrow()`.
- The same spec executed twice is `deepStrictEqual` on rows and all provenance except `requestId` and `computedAt`.
- **Per C4**, a breakdown by a date dimension puts the undated members into the trust report's `notes` — 13 titles carrying 18 of 100,836 ratings — so the drop is declared rather than silent.
- **That measurement lives in the test's own comment and in `docs/architecture.md`**: 13 undated titles, 18 of 100,836 ratings (0.018%), **none clearing `min_evidence ≥ 20`**. It is the whole evidence base for C4 (§6). Left only in the plan, the next person to look at the undated titles re-measures them — or adds the fifth guard C4 declined.
- Recorded: the ordering rule, the materiality definition, and why an undeclared id returns a `Rejection` rather than throwing.

**Must not.**
- **Special-case the 5.00 problem, MovieLens, or any title.** The comparison must emerge from the generic double-run, or the hero moment is a hardcoded demo rather than a property.
- Put a dataset-specific field in any type.
- Throw on an undeclared measure, dimension or guard. The rejection is a returned object, because promoting refusal to a feature later means rebuilding the path.
- Read the semantic layer from anywhere but the loader.
- **Hardcode the materiality threshold** — GA-12 will want to tune it against the rendered block, and that must be a data edit rather than an engine edit.
- Touch `src/server/ai/`.

### 5. GA-05 — Fallback parser, rejection path, eval harness

**Size** M — one session · **Depends on** GA-03, GA-04 · **Swappable with** GA-06

**Landed** — not yet.

> **C5 settled: Confirm — GA-05, scored against a baseline** — A reading confirmed, not a change requested. See §6.

**Delivers.** `ai/fallback-parser.ts`, a deterministic starter-question → spec map with no model and no general NL; an **explicit startup branch on key presence** (a branch, not a caught exception, or “degrades rather than breaks” is accidental); `tests/evals/questions.jsonl`; and `scripts/eval.ts`, a **scored** runner with a committed baseline.

**Done when.**
- `npm run eval` with `ANTHROPIC_API_KEY` unset → exit 0, printing a score and a per-case table.
- `npm run eval -- --check-baseline` → exit 1 on a score below the committed baseline.
- The set carries ≥8 starter/paraphrase cases, 3 rejection cases and 2 amendment cases.
- A deliberately failing fixture prints `no measure matched "revenue" — declared measures are …`, asserted by a test on the runner's output string.
- `tests/rejection.test.ts` → an undeclared question returns a `Rejection` carrying `missing`, `declared`, and ≥1 `nearest` question whose spec executes successfully.
- Recorded: the committed baseline score and what it was set from, and what the fallback parser deliberately refuses.

**Must not.**
- Attempt general natural-language understanding in the fallback parser. It maps the starter questions and refuses everything else — that refusal is the product working, not the parser failing.
- **Require an API key for any part of the eval loop.** The set compares specs, not prose; a loop costing money per run is a loop that gets run less often, and under the thinnest-viable decision this loop *is* how the layer acquires structure.
- Report a bare pass/fail count. A failing eval that does not name the missing structure turns every iteration into an investigation.
- Grow the semantic layer to make a case pass **without recording which eval demanded the addition**.

### 6. GA-06 — Proof suite: conformance, second adapter, replay, paraphrase

**Size** M — one session · **Depends on** GA-04 · **Swappable with** GA-05

**Landed** — not yet.

**Delivers.** `tests/conformance/cases.ts` (spec with explicit `asOf` → expected numbers); `suite.test.ts` as `describe.each(adapters)`; `warehouse/sqlite-store.ts` as the CI-only second adapter; the as-of replay case; and the paraphrase set.

**Done when.**
- `npx vitest run tests/conformance` → **the same case list passes under two describe blocks, one per adapter**.
- The case pinned at `asOf 2007-08-02` passes against the full 2018 store.
- The paraphrase case asserts `JSON.stringify(rowsA) === JSON.stringify(rowsB)` across phrasings.
- A lint-style test asserts no conformance case carries `asOf: null`.
- Recorded: which second adapter was chosen and why, and which as-of points the cases are pinned at.

**Must not.**
- Write an expectation only one adapter can meet.
- Let the SQLite adapter reach the serving path or the deployed bundle.
- Use `asOf: null` in any case. An unpinned case expires the moment the next payload lands, and this corpus is the artifact behind the product's central claim.
- **Skip the second adapter because one passes.** The seam is real if a second adapter passes the same suite through it; without that it is decoration.

### 7. GA-07 — The ask route and the answer object

**Size** S — half a session · **Depends on** GA-05

**Landed** — not yet.

**Delivers.** `src/app/api/ask/route.ts` on the Node runtime, assembling `{requestId, spec, resultSet, trustReport, narration, layerVersion, adapterId, resolvedAsOf, degraded}` — with narration delivered as a **stream from the first commit**, the degraded template sent as a single chunk.

**Done when.**
- `curl -N` against the route with no key streams a template takeaway and returns the answer object; the response carries `X-Content-Type-Options: nosniff`.
- The response validates against `AnswerSchema`.
- Two identical requests return identical `rows` and identical `resolvedAsOf`.
- An undeclared question returns **HTTP 200 carrying a `Rejection`**, not a 4xx or 5xx.
- Recorded: why narration streams from the first commit while the only producer is a template.

**Must not.**
- **Return narration as a JSON string field.** The single most expensive shortcut available in the whole plan: if the shape is not the streaming one now, GA-09 rewrites the route, the answer schema and every component that reads it.
- Vary the response *shape* on key presence. Only `degraded` and the narration's producer change.
- Compute anything. The route assembles; the engine aggregates.
- Read `data/*.csv`.

### 8. GA-08 — Interpret: structured outputs on a cached prefix

**Size** M — one session · **Depends on** GA-07

**Landed** — not yet.

**Delivers.** `ai/interpret.ts` using `client.messages.parse` with `output_config: { format: zodOutputFormat(ModelQuerySpecSchema), effort: "low" }`, importing `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod` and reading the result off `message.parsed_output`; the stable prefix in `system` carrying a `cache_control` breakpoint — pretty-printed semantic layer plus **at least five** few-shot examples — with the user question last. Freely typed questions now work.

**Done when.**
- Live suite (skipped without a key): two identical requests → the second reports `usage.cache_read_input_tokens > 0`.
- A model output naming an undeclared measure produces a `Rejection`; `message.parsed_output` never contains `sort.tieBreak` or `asOf`.
- `npm run eval -- --live` scores the model path against the same question set, recorded beside the fallback baseline.
- `grep -rn "output_format" src/` and a grep for assistant prefill → no matches.
- Recorded: the few-shot count, the measured cached-prefix token size, and the first `cache_read_input_tokens` reading.

**Must not.**
- Use `output_format` — removed from the SDK type surface, not merely deprecated, so it is a compile error. Assistant prefill returns 400 on Opus 5.
- Let the model choose `tieBreak` or `asOf`. The layer declares the tie-break; the request carries the as-of.
- **Trim the few-shot block below five examples.** Under the thinnest-viable layer, the layer alone straddles Opus 5's 512-token caching floor and the few-shot block is what carries the prefix over it — so the examples are load-bearing for *cost*, and the failure mode is silent: no error, just full input price forever.
- Coerce an unmatched term to a nearest match.

### 9. GA-09 — Narrate, and amend

**Size** M — one session · **Depends on** GA-07, GA-08

**Landed** — not yet.

**Delivers.** `ai/narrate.ts`, streamed, receiving **only the capped aggregated rows plus the trust report plus locale**; and `ai/amend.ts`, follow-up → `SpecPatch`.

**Done when.**
- The test asserts the **request body** handed to the SDK carries at most `NARRATE_ROW_CAP` rows and no raw record — inspected on the body, not inferred from the prose.
- Every numeral in the narration is present in the `ResultSet`, asserted by extracting numerals from the output and checking membership.
- `grep -rin "verified" src/ semantic/` → no matches.
- The amendment eval cases now also run on the live path.
- Recorded: what the narrate call is given and what it is denied, and how a narrate failure degrades.

**Must not.**
- Send raw rows, the store, or the CSVs to the narrate call.
- Let narrate compute, re-round, or introduce a figure.
- **Emit the word “verified”.** The verification is genuine but partial, and overclaiming it reproduces the silent failure the product exists to criticise.
- Make narration a hard dependency: a narrate failure degrades to the template, it does not fail the request.

### 10. GA-10 — The surface: shell, zero state, answer card

**Size** L — one full session, no slack · **Depends on** GA-07

**Landed** — not yet.

**Delivers.** `shadcn init` themed with **the approved mock's tokens rather than shadcn defaults**; the app shell (single ask column, persistent side column, bottom-anchored composer); the zero state (starter cards, promise line, dataset in the eyebrow as provenance); and the AnswerCard — takeaway, chart rendered **client-side**, the semantic `<table>` behind a “Show the numbers” disclosure, trust strip inline. `Intl` at every render site from the first component.

**Done when.**
- `npm run dev` with no key: clicking a starter card renders takeaway, chart, table and trust strip. **The comparison block is expected absent until GA-12** — stated here so it is not discovered as a bug.
- `tests/ui/` asserts every chart has a sibling `<table>` with `<th>` reachable through a `<button>` disclosure, not `visibility:hidden`.
- `grep -rn "Plot.plot" src/` returns only files carrying `"use client"`.
- No numeral reaches the DOM except through a shared `Intl` formatter, enforced by a test.
- Recorded: which shadcn components were added and which screen needed each, and which mock tokens became the theme.

**Must not.**
- Server-render Observable Plot. It throws without a DOM, and jsdom costs 755 ms of cold import for no accessibility benefit — the accessible artifact is the table, and the server already produces it.
- Hide the table with visually-hidden CSS. “Reachable, not merely present” means a disclosure any user can open.
- **Render any computed result not downstream of a question asked in this session** — no score card, no metrics row, no sparkline, no standing tile. Naming the data source is provenance and is permitted.
- Adopt shadcn's default theme, or add a shadcn component no screen on this increment needs.

### 11. GA-12 — The catch

**Size** M — one session · **Depends on** GA-10 · **Swappable with** GA-11 · **moved up one by C1**

**Landed** — not yet.

> **C1 settled: Swap them — the catch ships first** — Where the catch lands in the order. See §6.

**Delivers.** The naive/honest comparison rendered **open, full width, above the chart, as the largest object on the screen**, with the takeaway folded into its head; two labelled lists, each row carrying its own sample size; a closing line in prose; and a one-tap guard escape.

**Done when.**
- `npm run dev`, no key, “What are our top rated titles?” → the block renders with **296 titles at 5.00** on the naive side and **Streetcar 4.47 (n=20)** leading the honest side.
- A question no guard changes renders **no block at all**, asserted by a render test driven from `materiallyDifferent`.
- The escape control turns the guard off and re-runs — asserted. *Under C1 this now precedes the recipe sentence, so “and changes the sentence's text” is asserted at GA-11, not here.*
- Titles wrap rather than truncate in the comparison lists. In the hero moment the titles are the point.
- Recorded: the materiality threshold it settled on and what it was tuned against.

**Must not.**
- **Manufacture a catch, or render a placeholder when no guard fired.** A fabricated catch would be the silent-failure problem wearing the costume of its fix.
- Put the block behind a disclosure, a control, or below the fold.
- Let the escape be silent. On this session the visible signal is the trust strip and the block's own head; GA-11 adds the sentence. Silent is still forbidden — only the surface that carries it moves.
- Hardcode the 5.00 case. The block is driven by the engine's generic diff.
- **Build any part of the recipe sentence to get the escape's signal working.** That is GA-11's increment; borrowing it here is exactly the boundary this card exists to hold.

### 12. GA-11 — The recipe sentence

**Size** M — one session · **Depends on** GA-10 · **Swappable with** GA-12 · **moved down one by C1**

**Landed** — not yet.

> **C3 settled: No — keep asOf request-level and invisible** — Whether a user can ask “as of” a past moment in v1. See §6.

**Delivers.** The sentence composed from the layer's labels, each phrase a button opening a short closed list; selection rewrites the spec deterministically and re-runs. It also completes GA-12's guard escape, which now has a sentence to rewrite.

**Done when.**
- A component test proves the keyboard path: Tab reaches each phrase, Enter or Space opens, ArrowDown moves, Escape closes and restores focus to the trigger.
- Selecting an option rewrites the spec and the sentence and **calls no model** — asserted with a spy on the ai module.
- Every option in every list is generated from the loaded layer, asserted rather than authored.
- With no key, phrase editing still works. GA-13's note depends on this being true.
- **GA-12's escape now changes the recipe sentence's text — asserted here.** This is the one assertion C1's swap relocated.
- Recorded: which phrases are editable and what each closed list contains.

**Must not.**
- **Offer a free-text field, a formula input, or a blank builder.** Authoring is recall, and recall is what killed self-service BI; the phrases stay confirmatory.
- Call the model on a phrase edit.
- Let an invalid combination be reachable. Invalid states are absent from the list, not rejected after selection.
- Carry meaning by colour alone on the raised phrase buttons.
- **Offer a timeframe or “as of” phrase.** C3 settled that v1 does not expose an as-of control; adding the phrase here is the cheapest possible way to reverse that decision by accident.

### 13. GA-13 — The amendment diff, and the degraded note

**Size** M — one session · **Depends on** GA-09, GA-10

**Landed** — not yet.

**Delivers.** A follow-up rendered as a `SpecPatch` diff showing **changed and unchanged** lines with Apply / Keep the previous answer; and the one-time inline no-API-key note on the first degraded answer.

**Done when.**
- Nothing executes until Apply, asserted with a spy on the ask route.
- The diff lists **unchanged lines too** — the reassurance a non-technical user needs is what did *not* move.
- The note carries all five statements in order (numbers unaffected · free typing unavailable · amendments unavailable · summary is a fixed template · will not appear again), asserted by a render test, and the summary carries a “Template summary” tag.
- The note does not render on the second degraded answer of the same session.
- Recorded: the note's final copy, and why `asOf` is inherited rather than re-resolved.

**Must not.**
- Apply a patch before confirmation.
- **Re-resolve `asOf` implicitly.** “Now just EU” interrogates the parent's snapshot, or an amendment silently becomes a time-travel operation.
- Render a chat transcript anywhere. The spec is the unit of conversational state; build a message list in the UI and the state model drifts to match it.
- Show the note as a standing banner, or stay silent.

### 14. GA-14 — Provenance, saved recipes, shareable answer

**Size** L — one full session, no slack · **Depends on** GA-13

**Landed** — not yet.

**Delivers.** The provenance drawer as a sheet over the side column, **never pinned open**, showing `requestId`, `adapterId`, `layerVersion`, `resolvedAsOf`, `sourceId`, guards applied and coverage; the saved-recipes column where **every entry is a spec**, with Run again and Compare reusing GA-13's diff renderer; and the shareable answer as copyable text and HTML.

**Done when.**
- The drawer traps focus, closes on Escape and restores focus to its trigger — asserted.
- A saved entry persists **a spec and no rendered rows** — asserted on the persisted value.
- Run again **recomputes**, producing a fresh `requestId` and a current `resolvedAsOf`.
- The copied artifact contains the recipe sentence, the numbers, the trust line and all four provenance identifiers — asserted on the clipboard payload.
- Recorded: why a saved recipe stores a spec and not rows, and how saved entries are keyed.

**Must not.**
- **Store rendered output.** A saved recipe is a *question*; a saved report is an *answer*, and an answer goes stale silently as data moves beneath it. This distinction is what keeps saved recipes inside §16 rather than against it.
- Add approval, sharing, server persistence or a team library. That is the deferred blessed-question library; this increment only leaves it its substrate.
- Export an image. The accessible table is already the artifact and there is no rasterisation path.
- Omit provenance from the copied artifact. An answer pasted into a deck that does not record which dictionary, which source and which moment produced it cannot be defended when challenged.

### 15. GA-15 — Accessibility verification and the determinism moment

**Size** M — one session · **Depends on** GA-14

**Landed** — not yet.

> **C2 settled: Stage on the AI path** — Which path the determinism moment is staged on. See §6.

**Delivers.** The automated axe pass wired into `npm test`; a recorded manual keyboard-only run through ask → amend → provenance drawer; and the determinism moment staged **on the AI path** per C2, with the no-key demonstration given in the same breath.

**Done when.**
- `npm run test:a11y` → **0 violations across all six states**.
- Contrast checked over every visible text node in every state, with the large-text rule applied where it qualifies.
- The manual keyboard run is recorded with the operator's notes committed.
- GA-06's paraphrase test is wired into `npm test` so the demo moment cannot silently regress.
- **The staged moment is rehearsed against the live model**, not the fallback: N phrasings typed freely, one byte-identical `ResultSet`, with the recorded phrasings committed so the rehearsal is repeatable rather than a lucky take.
- Recorded: what the keyboard run found and what axe could not see. *Beyond the staging C2 settles this increment makes no design decision — say so rather than inventing one.*

**Must not.**
- Treat axe as sufficient. It cannot see focus order, a drawer that fails to trap, or a table nobody can reach.
- Fix a violation by deleting content.
- **Absorb accessibility work deferred from earlier increments.** Accessibility is a definition-of-done line on GA-10 through GA-14; this increment verifies, it does not implement.
- **Stage the moment on the fallback parser and present it as the AI path.** C2 chose the AI path precisely because it carries model variance; demonstrating a deterministic parser's determinism under that framing would be the overclaim this product exists to criticise.
- Pad the paraphrase set with phrasings the model has already been shown.

### 16. GA-16 — README, deploy configuration, release gate

**Size** S — half a session · **Depends on** GA-15

**Landed** — not yet.

**Delivers.** The README covering the four required contents — the dataset in use, why this was built, how AI was used to build it, and what would come next; `vercel.json` (Node runtime, per-route `maxDuration`, `supportsResponseStreaming`, `"fluid": true`); and one `npm test` that runs every suite.

**Done when.**
- `npm test` from a clean clone with no key → green, with the live-only suites reported **skipped, not passed**.
- `npm run build` succeeds and the SQLite adapter is absent from the bundle.
- The README contains all four required sections.
- `grep -rin "verified" README.md src/ semantic/` → no matches.
- Recorded: the deploy configuration values and why. *Otherwise this increment decides nothing new; it assembles — say so.*

**Must not.**
- Use the word “verified” anywhere user-facing.
- Report skipped live suites as passing.
- Ship the SQLite adapter into the deployed bundle.

---

## 4. GA-01 in detail

The first increment is specified further than the rest, because every later increment imports what it
creates. The layout and its deviations (§4.1, §4.2) are durable. **The type listing and test list are
not** — see the banner on §4.3.

### 4.1 File layout it creates

```
package.json  tsconfig.json  next.config.ts  vitest.config.ts  .env.example  .gitignore
src/
  app/
    layout.tsx                    minimal shell — GA-10 replaces the body
    page.tsx                      placeholder heading only
    globals.css                   minimal; shadcn init rewrites this in GA-10
  server/
    contracts/                    ← new module, see 4.2 for the deviation
      ids.ts                      branded MeasureId / DimensionId / GuardId
      query-spec.ts               QuerySpec, ModelQuerySpec, Sort, Filter, GuardRef
      spec-patch.ts               SpecPatch
      result-set.ts               ResultSet, ResultRow, TrustReport, Provenance
      rejection.ts                Rejection
      answer.ts                   Answer discriminated union
      payload.ts                  ReceivedPayload envelope (body lands in GA-02)
      semantic-layer.ts           the layer's schema (contents land in GA-03)
      index.ts
tests/
  contracts.test.ts
```

### 4.2 Deviations from `docs/design.md` §5, with reasons

> **Citation caveat.** Every `§5` below is the **pre-split** `docs/design.md`. The layout it fixes is
> architecture material, so it moves to `docs/architecture.md` under a new number when the split
> lands. The deviations and their reasons are unaffected — only where to look them up changes; these
> citations are deliberately not chased.

**a. `src/server/contracts/` is new.** §5 implies the `QuerySpec` lives beside the `Warehouse`
interface in `warehouse/types.ts`. It cannot: the spec is read by the warehouse, the engine, the AI
layer, the route *and* the client, so defining it there makes the engine import from the warehouse —
inverting the dependency, since the warehouse *consumes* the spec and does not own it.
`warehouse/types.ts` keeps the `Warehouse` interface itself, which legitimately depends on both.

**b. `scripts/ingest-payload.ts` rather than §5's `scripts/build-warehouse.ts`.** The settled
inbound-integration framing makes this "ingest one received payload", not "ETL a bundled fixture" —
same code, different contract, and the difference surfaces in provenance, which now names a *source*
rather than a *file*. The filename is the cheapest place to carry framing that is otherwise
expensive to retrofit. **Low confidence:** nothing turns on it. If the captain prefers the doc's
name, keep the doc's name.

**c. Additional files inside directories §5 already names** — `engine/compare.ts`,
`engine/resolve.ts`, `warehouse/sqlite-store.ts`, `tests/pinned-figures.test.ts`,
`tests/semantic.test.ts`, `tests/rejection.test.ts`, `tests/ui/`, `tests/ai/`. Not layout changes;
§5's own comment on `warehouse/` is "(swappable)", which the second adapter is the point of.

### 4.3 and 4.4 — deleted when GA-01 landed

Both were time-boxed to increment 1 and deleted as part of its definition of done. The shape of the
types is now `src/server/contracts/`; the tests that prove it are `tests/contracts.test.ts`; and the
reasoning that outlived both — why `contracts/` is a leaf module of its own, why strictness is what
makes "no joins" structural, why `tieBreak` is required, why `asOf` is paired with `resolvedAsOf`,
and where `MAX_LIMIT` comes from — is in `docs/architecture.md` §2.

A Zod listing kept here beside shipped contracts would be a second source of truth, which is this
product's own failure mode pointed at its documentation.

---
---

## 5. The five boundaries that matter most

Each increment carries its own must-nots. These five are where an early increment would quietly
decide something belonging to a later one, and where the cost is a rewrite rather than an edit.

1. **GA-07 must not return narration as a JSON field.** The narration's *producer* changes in GA-09;
   its *contract* must not. Ship the streaming shape while the only producer is a template.
2. **GA-01 must not name a MovieLens entity in a core type.** A `minRatingsPerTitle` field in the
   portable contract breaks every adapter the moment the product is pointed at other data. This
   mistake was already caught once in design review; the type system will not catch it a second time.
3. **GA-04 must not hardcode the materiality threshold.** GA-12 will want to tune it against the
   rendered block. In the layer that is a data edit; in the engine it is GA-12 editing GA-04's
   internals.
4. **GA-08 must not trim the few-shot block.** Examples are normally the first thing trimmed for
   cost. Here they keep the cached prefix above the 512-token floor, so trimming them *raises* cost
   — silently, with no error, forever.
5. **GA-03 must not flatten the layer's labels.** Thin is volume and grows back free. Flat is shape
   and costs a schema, prompt and matching rewrite. Every eval passes against a flat layer right up
   until the first non-English locale, so the eval loop cannot warn about this one in time.

---

## 6. The captain's five calls, answered and applied

**These decisions travel with the plan deliberately.** Three of them are encoded directly in the
increment assertions above — the escape assertion split across GA-12 and GA-11 (C1), GA-03's *assert
exactly four guards* (C4), GA-11's must-not against a timeframe phrase (C3). An assertion with no
trace of why reads as arbitrary, and the first person who wants a fifth guard deletes the assertion
instead of reopening the decision. A decision separated from the thing it constrains is a decision
that will be reversed by accident.

Answered by the captain on 2026-09-18; every recommendation accepted.
Each is already applied to the increments above; none is still open.

### C1 — Where the catch lands in the order

**Decided: Swap them — the catch ships first** · applied to GA-12 and GA-11

GA-12 sat three increments after the first rendered answer. Both depend only on GA-10 and nothing downstream distinguishes them, so the swap carried no dependency risk.

What changed in the spec:
- GA-12 → position 11, GA-11 → position 12, in the order above. **The ids did not change** — GA-12 is still “the catch” in every cross-reference.
- The one assertion the swap moves is split: GA-12 asserts the escape turns the guard off and re-runs, GA-11 asserts it changes the sentence's text.
- GA-12 gains a must-not forbidding it from building any part of the recipe sentence to get the escape's signal working.

### C2 — Which path the determinism moment is staged on

**Decided: Stage on the AI path** · applied to GA-15

The no-key path is guaranteed by construction but proves less. The AI path proves the interesting claim — that the model lands in the same place — and GA-06's paraphrase test in CI is what makes it safe to stage at all.

What changed in the spec:
- GA-15 delivers the moment staged on the AI path, with the no-key demonstration in the same breath.
- A rehearsal line added: N phrasings typed freely against the live model, one byte-identical `ResultSet`, phrasings committed so the rehearsal is repeatable rather than a lucky take.
- Two must-nots added — never stage on the fallback and present it as the AI path, and never pad the paraphrase set with phrasings the model has already seen.

### C3 — Whether a user can ask “as of” a past moment in v1

**Decided: No — keep asOf request-level and invisible** · applied to GA-11 and GA-01

The field exists in the spec from GA-01 and every conformance case pins it. The seam is complete without a control, and a time-travel control on a single-snapshot demo invites a question the demo cannot answer well.

What changed in the spec:
- GA-11 gains a must-not: **no timeframe or “as of” phrase in the recipe sentence**. That phrase is the cheapest possible way to reverse this decision by accident, which is why the boundary is written down rather than assumed.
- Nothing in GA-01 changes. `asOf` stays on the spec and `resolvedAsOf` in provenance — the decision is about the surface, not the contract.

### C4 — The thirteen undated titles

**Decided: Disclose in the trust report's coverage line, no fifth guard** · applied to GA-03 and GA-04

Measured in this worktree: the 13 undated titles carry **18 of 100,836 ratings (0.018%)** and **none clears `min_evidence ≥ 20`**. A fifth guard would dilute the four that carry the hero moment for a figure that is immaterial today — but a silent drop is the failure mode this product exists to catch, so it still has to be declared.

What changed in the spec:
- GA-03 asserts **the registry holds exactly four guards**, so a fifth cannot arrive later without a decision.
- **GA-04 carries the other half.** The disclosure is a coverage fact, so a breakdown by a date dimension must put the undated members into the trust report's `notes` — asserted there. A decision recorded only where it was declined would have quietly become no decision at all.

### C5 — A reading confirmed, not a change requested

**Decided: Confirm — GA-05, scored against a baseline** · applied to GA-05

GA-05 is the earliest the harness can land at all: it needs the layer from GA-03 and an implementation of the interpret interface to score. It still lands before any AI call and before any pixel, which is the substance of the decision.

What changed in the spec:
- GA-05 unchanged. Its closing note now reads as confirmed rather than flagged.
- The runner stays **scored against a committed baseline** rather than pass/fail — without that, “ship thin and let failing evals earn structure” and “every increment leaves the repository green” contradict one another.

---

## 7. What an implementer still settles

Open choices, each with a recommendation. **This list empties as the build proceeds:** as each is
settled it moves to `docs/architecture.md` and leaves this file.

1. **SQLite driver:** `node:sqlite` (which still prints an `ExperimentalWarning` on Node 22),
   CI-only, warning suppressed in the test runner. `better-sqlite3` adds a native build to a project
   whose selling point is a zero-config `npm install`.
2. **Saved-recipes persistence:** `localStorage`, keyed by `layerVersion`, so a layer change cannot
   resurrect a spec that no longer validates.

**Settled and migrated out.** `MAX_LIMIT = 120` and `NARRATE_ROW_CAP = 20`, with the cardinality
measurement that grounds them, and the Vitest pin — both settled by GA-01 and now standing in
`docs/architecture.md` §2 and §10. The **`asOf` wire format** — ISO-8601 UTC on the spec, in
provenance and in the manifest; unix seconds inside the store, where the comparison happens —
settled by GA-02 and now standing in `docs/architecture.md` §2a, along with the second timestamp
that came with it: `asOf` is when the data arrived, `lastEventAt` is the latest event in it, and
they are different facts. **The materiality threshold** — `minValueDelta: 0.01`, one global value in
the layer rather than one per measure — settled by GA-03 and now standing in
`docs/architecture.md` §3.

---

## 8. Where "nothing built early gets undone" could not be achieved

Three places, descending severity. Everything else in the order is additive.

1. **GA-10 through GA-14 build one dense screen in five passes**, so each touches `page.tsx` and the
   answer-column layout. No ordering avoids this; it is what building one screen incrementally
   costs. *Mitigation:* each region is an independent component dropped into a slot order fixed by
   the approved §11 prose, so the edits are additive insertions rather than rewrites. **This is the
   weakest point in the plan and the place to watch during review.**
2. **GA-10's `shadcn init` rewrites files GA-01 created** — `globals.css`, the Tailwind config,
   possibly `layout.tsx`. A genuine later-rewrites-earlier, though a mechanical one. Running
   `shadcn init` in GA-01 instead was rejected because it blocks the first increment on the shadcn
   verification. *Mitigation:* GA-01 writes the minimum possible global CSS and a placeholder page,
   so what is overwritten is deliberately almost nothing.
3. **The semantic layer is edited repeatedly after GA-03, by design.** Every synonym is earned by a
   failing eval, so GA-03's file grows throughout the build. That is the decided loop, not rework —
   but GA-03's definition of done cannot be "the layer is final", and every increment that edits the
   layer must record which eval demanded the addition, or the discipline decays into "added because
   it seemed useful".

The three replace-class decisions — `tieBreak`, `asOf` paired with `resolvedAsOf`, and the guard
registry — all land in GA-01 through GA-04, before anything reads them.

---

## 9. Seams the build leaves open

None of this is v1 work. It is what the increments deliberately leave room for.

| Seam | Lands in | What later plugs into it |
| --- | --- | --- |
| `ReceivedPayload` contract + the route's handler shape | GA-02, GA-07 | The live receiver: a `POST` satisfying the same contract. Nothing else moves |
| Append-only store + `asOf` / `resolvedAsOf` | GA-02, GA-04 | Retention, late arrivals, backfill and replay become expressible rather than corrupting |
| `describe.each(adapters)` conformance | GA-06 | A Postgres or columnar adapter costs one line in the suite |
| Saved recipes as stored specs | GA-14 | The blessed-question library: storage plus an approval flag over specs |
| The generic double-run diff | GA-04 | "Why did it move": the same operation with two as-of points instead of two guard sets |
| `Rejection` as a returned object | GA-05 | Refusal promoted to a demonstrated feature — a rendering, not a rebuild |
| Locale-keyed labels + `Intl` everywhere | GA-03, GA-10 | Translation and RTL become a data change |
| `narrate()` as one narrow call site | GA-09 | Cheaper narration behind an unchanged interface |
