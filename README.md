# Overview

This application is an AI-native analytics framework designed for non-technical business users. Its core value is not query speed, but catching the confident wrong answer that a non-technical user cannot audit. This document provides a high-level overview of the system purpose, the trust thesis, the architectural layout.

## **Purpose & Trust Thesis**

Traditional text-to-SQL solutions suffer from silent failures where queries return incorrect figures and non-technical users accept blindly. The app addresses this through the trust thesis: `AI interprets, never computes`. The AI model translates natural language questions into a typed `QuerySpec` . All data aggregation, filtering, sorting, and guard applications are handled by a deterministic execution engine and calculated number strictly comes from the computed `ResultSet`.

The product never simply tells you a result is trustworthy. It proves by showing you two answers side by side: the naive one (no safety guards) and the guarded one. So you can see for yourself what the guards changed. 

---

## Dataset

[MovieLens](https://files.grouplens.org/datasets/movielens/ml-latest-small.zip) is the provided data, checked in under `[data/](data/)`. 


|         |                     |
| ------- | ------------------- |
| Titles  | 9,742               |
| Ratings | 100,836             |
| Tags    | 3,683               |
| Users   | 610                 |
| Span    | Mar 1996 – Sep 2018 |


---

## Why I built this

While I did the market research, I found the space splitting into four segments: file-first, AI-native, incumbent+AI and warehouse-native and all racing focuses on the same axis of query accuracy or conversational range. So, I picked the one most tools skip: the AI's value is not answering the question you asked. It is telling you that the question you asked would have misled you. The project focuses on these 3 rules:

- AI inteprets, never computes.
- The recipe is read, never authored.
- Trust is the proof

***The pitch - "it catches what you'd have missed".*** Find out more details in the market research (`docs/market-research.md`) shaped the positioning

The demo is used the provided dataset but I built the **architecture in production-shaped**: plain language commands a query engine (`QuerySpec` → engine → `warehouse.aggregate(spec)`), the same family as warehouse-native tools. Local store today, a real warehouse later, without rewriting how the AI is used.

---

## High-level Architecture

The app chooses to use Next.js App Router: one app for the screen and `POST /api/ask`.

#### Frontend

Look, behaviour, and ownership are three layers and do not compete each other. Tailwind and CSS variables in `globals.css` carry the theme (design-system tokens mapped onto the names shadcn’s components read) and set at the start. So the next component does not arrive without theming. Radix is only for the interactive pieces supporting accessibility for dialog, drawer, popover: focus trap, Escape, keyboard. Shadcn is the glue: the CLI copies React source into `src/components/ui`, already wired to those primitives, so I can read and change it. A component can be added anytime when a screen needs it.

### Server

The route loads the store and the semantic layer. A `QuerySpec` is the recipe: the model writes it, Zod checks it, the engine runs it. The warehouse answers `aggregate(spec)` with one small table, not raw rows. That table is files on disk today. Postgres is choosen as a second adapter for production. So a clone still runs with no key and no database. Two engines matching is the point of the seam. 

AI uses the Anthropic SDK directly, not an agent framework. This product focuses on a typed-command approach, not an autonomous SQL agent. So I want to own the cache and schema surfaces. This makes that command strict. 

Natural language is a **command** into a query engine. The AI never computes a number.

```mermaid
flowchart LR
  Q[Question] --> R["POST /api/ask<br/>route.ts"]
  R --> I{API key?}
  I -->|yes| L[interpret.ts]
  I -->|no| F[fallback parser]
  L --> S[QuerySpec]
  F --> S
  S --> E[engine / execute]
  E --> W["warehouse.aggregate(spec)<br/>local store today"]
  W --> RS[ResultSet + trust]
  RS --> N[narrate template]
  N --> UI[Answer on screen]
```



1. **Interpret**: turn English into a `QuerySpec`: one structured recipe (what to measure, how to break it down, which checks apply). AI does that when a key is present; without a key, a small parser only matches the starter questions.
2. **Engine**: run recipes the same way every time. It applies the checks, sort, and row cap. If the checks change who is on top, the answer shows both rankings: the naive one and the honest one.
3. **Warehouse**: fetch one aggregated table for that recipe. The engine never looks raw rows.
4. **Narrate**:  write the takeaway from that small table (~20 rows) and the trust report. No raw ratings reach the narrator, so no figure can originate in a model.

---

## How I used AI

I started with market, tech stack, UI mock, and a build spec in `docs/`, then coded under [AGENTS.md](AGENTS.md). One captain agent held the plan I spun a worker per task. I used Claude Design at the start so the screens shared one visual language instead of restyling each increment. Each increment was a GitHub issue and a PR. Review was a separate pass. What we decided, and why, is in [docs/how-this-was-built.md](docs/how-this-was-built.md). 

The AI proposed options. I asked questions back and we narrowed them. We measured instead of trusting summaries. When a measurement disagreed with the plan, we updated the design first, then the code.

Here is some decision I made:

- Demoted the chatbot to the side so the naive/honest catch could lead the screen.
- Treated MovieLens as a delivered payload and every answer is computed as of that moment. 
- Kept the semantic layer thin and evals earn structure 
- Chose shadcn after comparing it with a Tailwind+Radix-only path.
- Spec and issues before building; docs and issues as we went.

---

## Time spent

One day of building, Friday Sep 18 and I went past it on purpose. The interesting part of this problem is the part that does not fit in 45 minutes: proving the number is right.

---

## What I'd do with more time

1. **Wire the first-screen banner to the engine**, so it is a real proactive alert and not a labelled mock.
2. **Targets and goal alerts.** A user should be able to set a target and the app warns when the trend will miss it.
3. **Advanced insight suggestions** shaped by what the user has already asked.
4. **A compact query syntax for advanced users**, so the same engine has two front doors: plain English for most people, a query language for the few who want it.

Next, I’d wire what’s already designed: save recipes, accept new data deliveries, run the same spec against a real warehouse, and turn misread questions into eval cases.

---

## How to run

Requires **Node.js 22+** (Next 16 / native TypeScript stripping for `npm run ingest`).

```bash
# 1. Install
npm install

# 2. Compile the MovieLens CSVs into the local store (creates .store/, not committed)
npm run ingest

# 3. Optional — free typing + model narration
cp .env.example .env.local
# edit .env.local and set ANTHROPIC_API_KEY=...

# 4. Start the app
npm run dev
# → http://localhost:3000
```

***Note***  

The app still runs without the AI api key but the chatbox will be disabled. It shows starter questions work, numbers come from the engine, interpretation uses the deterministic fallback, narration uses a template.

---

