# Design system — foundations

The source of the Golden Analytics foundation design system: the token set (colour,
type scale, spacing, radius, elevation, motion) in `styles.css`, and four preview
cards in `cards/` that document it — `colour.html`, `type-scale.html`,
`space-radius.html`, `states.html`.

This is source, not build output, and it is tracked. It was authored in a cloud
design project; the copy here is the version of record. The design-sync tool flows
one way, repository to cloud, and its reconciliation pass removes remote content the
freshly built bundle does not contain — so cloud-only foundations would eventually be
deleted. Holding them here also gives them history, diffs, review and rollback, which
is what `AGENTS.md` invariant 7 asks of any load-bearing artifact.

Open a card directly in a browser; each one resolves `../styles.css` at a relative
path and needs no build step.

## What is deliberately not here

The compiled bundle, the generated card manifest, the adherence lint config and the
project thumbnail are all derived from the files above or are tooling artifacts. They
regenerate, so they are not stored. Nothing is missing.

## Contrast fixes applied on landing

Two defects measured by the UI-direction scout were fixed at the token definition, so
every card inherits them:

- `--ga-ink-muted` `#6B6588` → `#655F7C`. The old value measured 4.4986 on
  `--ga-sunken`, failing WCAG 2.1 AA for normal text by 0.0014. The new value clears
  4.5 on all four grounds.
- `.ga-state-selected` carried selection by colour alone. Its border is now
  `--ga-accent` rather than `--ga-accent-line`, and the rule adds a check glyph so
  selection survives greyscale.
