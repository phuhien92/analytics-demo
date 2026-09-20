# Golden Analytics — Design

Date: 2026-09-18
Status: Approved for planning

This document carries the product argument: the problem, the wedge, the thesis, the
dataset and its verified traps, the interface, and what is out of scope. The technical
decisions — the architecture and file layout, the QuerySpec, the semantic layer format,
the warehouse interface, the AI call structure, the testing bar and the stack — live in
`docs/architecture.md` and do not belong here. The test: if it changes what the user
gets or why, it is design; if it changes what is built, it is architecture.

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

**"Canva for data" is the north star, and it needs a wedge.** The destination is the
right one. But Bricks already markets itself as "the Goldilocks tool between Canva's
ease-of-use and Tableau's power" — 100,000+ users, enterprise logos — so the phrase on
its own no longer differentiates. This demo keeps the north star and picks one wedge
that moves toward it.

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

## 5. Trust guards

Each guard has a safe default already applied, a plain-English explanation, and a
one-tap escape. Never a warning that hands the user homework. How guards are declared
in the semantic layer and resolved through the registry is in `docs/architecture.md`
section 4.

| Guard | Default | Rationale (verified) |
| --- | --- | --- |
| `min_evidence` | 20 ratings per title | 86.7% of titles fall below it |
| `disclose_multi_membership` | on | 2.27 genres per title — every genre chart double-counts |
| `exclude_uncategorised` | on | 34 titles with no genre |
| `exclude_unrated` | on | 18 titles never rated |

**Naive comparison** is not a guard but an engine behaviour: run the spec with guards
applied and with `guards: []`, and surface the difference when it is material.

## 6. Interface

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

Three decisions about where weight sits on that surface:

- **The persistent column holds saved recipes, not a transcript.** Each entry is a
  spec that can be re-run and diffed, which is what `docs/architecture.md` section 2
  already makes the unit of conversational state; a message history would carry the
  same information in a form the user cannot re-run, and would leave the
  naive-versus-honest comparison with no inline home. Nor is the column labelled as
  the AI answering questions: invariant 1 says the model never produces a number, and
  the label would claim it does.
- **The question box is subordinate to the answer object.** A box that takes a
  question is the part every tool in `market-research.md` already has, and a blank one
  is the blank-page-with-a-cursor this section already rejects. The answer — takeaway,
  chart, recipe sentence — is the hero, and the recipe sentence with its tappable
  phrases is where interaction lives.
- **The naive-versus-honest comparison is a first-class visual moment**, not a card
  below the fold. It is the differentiated part of the product (section 4), so it
  reads as something happening to the answer rather than as supporting detail.

## 7. Accessibility and internationalisation

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

- **Structural (v1)** — the locale-keyed label mechanics and the `Intl` formatting
  rules are in `docs/architecture.md` section 7.
- **Deferred** — actually translating UI chrome, RTL layout, and any locale beyond
  `en`. Cheap whenever it happens, because nothing structural blocks it.

Noted for later: the 5-star scale is itself a cultural convention, and rating
distributions are not comparable across locales that interpret it differently.

## 8. Error handling

- **Ambiguous question** → clarifying question with concrete options. Never a guess.
- **Out-of-scope request** → say plainly what this data can and cannot answer, and
  offer the nearest question that works.
- **Empty result** → say so, and offer the nearest question that returns something.
- **No API key** → a one-time inline note on the first degraded answer, not a silent
  fall-back and not a persistent banner. It says once that free typing and follow-up
  amendments are unavailable and that the written summary is a template, and it says
  that the numbers are unaffected — they come from the engine either way (invariant 1),
  so only narration and free typing degrade. A silent mode would let the user mistake a
  template for a narration; a standing banner would keep charging for a fact she has
  already taken in.

How the fallback path for an unavailable AI is wired is in `docs/architecture.md`
section 8.

## 9. Out of scope

Auth. Multi-dataset upload. A visual chart editor. Writing back to any source.
Recommender modelling. Dashboards or saved reports. Anything requiring a real
warehouse connection — the interface exists so it can be added, but no adapter ships.

## 10. README requirements

Per the brief, the README must cover: the dataset in use, why this was built, how AI
was used to build it, and what would come next with more time.
