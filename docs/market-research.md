# AI-Native Analytics: Market Research

**September 2026** · Research behind the Golden Analytics product thesis

---

## Summary

The AI analytics market is crowded, well funded, and racing hard on a single axis:
**the accuracy of the query the AI generates.** Meanwhile every credible source —
including vendors arguing against their own commercial interest — agrees that the
unsolved problem is somewhere else entirely: **the confident wrong answer that a
non-technical user has no way to catch.**

That gap is the opportunity.

---

## 1. The landscape

Four distinct segments, each selling something different.

| Segment | Who | What they sell | Price anchor |
| --- | --- | --- | --- |
| **File-first / non-technical** | Bricks, Polymer, Rows | Speed to a finished dashboard | Bricks $20/user/mo |
| **AI-native startups** | Julius AI, Basedash, Querio, Hex Magic, Dot, Zenlytic, Definite, Deepnote, Fabi | Conversational range | Julius ~$12/user/mo |
| **Incumbent BI + AI** | ThoughtSpot Spotter, Omni, Sigma, Looker, Metabase, Power BI Copilot, Tableau, Domo, Sisense | Governance — sold to the data team | Enterprise |
| **Warehouse-native** | Databricks AI/BI Genie, Snowflake Cortex Analyst | AI where the data already lives | Consumption |

### "Canva for data" is the north star, and Bricks already uses the phrase

**Bricks** markets itself, in its own words, as *"the Goldilocks tool that sits
perfectly between Canva's ease-of-use and Tableau's power."* It claims 100,000+
professionals and shows PwC, Deloitte, NVIDIA, Adobe, ByteDance and MIT logos. Upload a
CSV, an Excel file, a PDF — even a screenshot containing a table — and it returns a
full dashboard in roughly 30 seconds.

The destination is right, and it stays the north star. The phrase alone no longer
differentiates, so the wedge has to sit underneath it: something the user gets from
this product that none of the tools above sell.

---

## 2. The consensus failure mode

This is the heart of the research. The finding is not "AI writes bad queries." It is
that **AI writes wrong queries in a way the target user structurally cannot detect.**

> "Text-to-SQL fails **silently and confidently**. The output may look right, even if
> it's wrong."
> — Omni

> "Catching the error requires reading the generated SQL and understanding it — **the
> same expertise the tool was supposed to replace**."
> — Omni

> "If AI does not understand your metric definitions, your join paths, and your access
> controls, it is not an analytics system. It is **a fluent guessing machine**."
> — Omni

### Supporting evidence

| Finding | Source |
| --- | --- |
| Raw text-to-SQL scores **~40%** on real enterprise schemas; **85–95%** with a semantic layer | Multiple industry evaluations, 2026 |
| **Fewer than 30%** of business users could actually run their own analyses in Tableau or Looker | Gartner, 2024 |
| Giving an agent grep access to thousands of real SQL files moved accuracy **by less than one point** — the bottleneck was *structure*, not *access* | Anthropic, June 2026 |
| The **silent wrong answer remains unsolved**; best available mitigations are a provenance footer and standing evals | Anthropic, June 2026 |
| Same question produces different SQL and different numbers — **"metric drift"** | Omni; dbt 2026 benchmark |
| Counterpoint: simple, well-named models reach 95% without a heavy semantic layer. *"Evaluate AI by its answers, not its SQL."* | MotherDuck / Bird Bench |

### The recurring phrase: "analytics slop"

Practitioners describe a new failure pattern — anyone can now point an AI at a database
and generate a confident report, and **nobody is checking the numbers.** The barrier to
producing analysis collapsed. The barrier to producing *correct* analysis did not.

### What the evidence converges on

**The fix is structure, not a better model.** This was unanimous across sources that
otherwise disagree about everything. Better LLMs do not solve it, because it is not a
capability problem.

---

## 3. Where nobody is competing

Look at what each segment actually sells:

- Bricks sells **speed to a beautiful dashboard**
- Julius, Hex and Basedash sell **conversational range**
- Omni, ThoughtSpot and Looker sell **governance** — and they sell it to the *data
  team*, not to the business user

**Nobody sells confidence to the person who has to stand behind the number.**

The reasoning is short:

1. The brief describes an analyst who cannot write SQL.
2. That same analyst cannot *audit* SQL.
3. Therefore a confident wrong number is **worse** for her than the two-day ticket —
   the ticket at least had a human in the loop who would have caught it.

---

## 4. The conclusion we drew

The first framing we tested was *"an answer you can defend in Monday's meeting without
knowing SQL."* We rejected it. It is a **negative value proposition** — it sells the
absence of a bad thing to a user who has never been burned by it, and it answers step 2
while she is still stuck at step 1.

The reframe that survived scrutiny:

> **The AI's value is not answering the question you asked.
> It is telling you that the question you asked would have misled you.**

Same machinery underneath. Opposite posture. *"We catch the mistake you were about to
make"* is a capability; *"you can verify our answer"* is a disclaimer.

It also converts trust from a **promise** into a **proof** — the user believes the
honest answer precisely because they were first shown the misleading one.

### Validated against the dataset

The MovieLens data supplied for this challenge demonstrates the thesis without any
contrivance:

| Trap | Verified |
| --- | --- |
| Titles averaging a **perfect 5.0** | **296** — every single one has ≤2 ratings |
| Rated titles with **fewer than 20 ratings** | **8,427 of 9,724 (86.7%)** |
| Genre assignments per title | **2.27 average** — every genre chart double-counts |
| Titles with no genre | 34 |
| Titles never rated | 18 |

Ask *"what are our top rated titles?"* and the naive answer is 296 titles tied at 5.00
stars, led by films with two ratings each. Because 86.7% of the catalogue has thin
evidence, **that list is essentially noise** — and it is exactly the list a
speed-optimised tool would hand you.

---

## 5. Limitations of this research

Stated plainly so the conclusions can be weighed properly:

- **No reliable market sizing.** The TAM reports surfaced were paywalled vendor
  boilerplate. This is a positioning and failure-mode landscape, not a sizing study.
- **Vendor-sourced comparisons.** Much of the competitive material comes from vendor
  blogs — Omni, Basedash, Querio and Bricks each rank themselves first. We therefore
  leaned on the **failure-mode claims**, where sources agree *against* their own
  interest, rather than on feature scorecards.
- **No primary user research.** No interviews with the target persona were conducted.
  The persona is taken from the brief.

---

## Sources

- Omni — *Why text-to-SQL fails* (April 2026); *AI-Powered BI Tools 2026* (June 2026)
- Anthropic — *How Anthropic enables self-service data analytics with Claude* (June 2026)
- Definite — *Conversational Analytics: Why It Fails on Real Data*
- Basedash — *Best AI-native BI tools in 2026: 9 platforms compared* (February 2026)
- dbt — *Semantic Layer vs. Text-to-SQL: 2026 Benchmark Update*
- MotherDuck / Bird Bench — text-to-SQL accuracy research (March 2026)
- Gartner — business user self-service analytics survey (2024)
- Bricks, Julius AI, Querio, Holistics, Domo — product and pricing pages
- GroupLens — MovieLens `ml-latest-small`, generated 2018-09-26
