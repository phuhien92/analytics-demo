# Screenshots

Tracked, deliberately. This project ships through pull requests and the reviewer compares
the built surface against an approved mock, so a PR that describes a screen in prose is
asking to be reviewed on trust. `gh` cannot upload an image to a pull request body, so the
image has to live somewhere the body can link to, and the repository is the only place
with the right lifetime.

They are the built app, captured against the production build (`npm run build && npm start`)
on the compiled store, never mockups or renderings.

| File | What it shows | Landed by |
| --- | --- | --- |
| `ga-10-zero-state.jpg` | The zero state: starter questions, the dataset named as provenance, and nothing computed | GA-10 |
| `ga-10-numbers-and-provenance.jpg` | "Show the numbers" and "How did you get this?" open: the semantic table behind the chart, and the answer's provenance | GA-10 |
| `ga-12-the-catch.jpg` | The hero moment answered, led by the catch: 296 title values tied at 5.00 against *A Streetcar Named Desire* 4.47 from 20 records, the closing line, and the escape | GA-12 |
| `ga-12-checks-off.jpg` | The escape taken — every check named as not applied, the trust strip down to coverage alone, and the way back | GA-12 |
| `ga-12-no-catch.jpg` | A question no check changed: the takeaway, the chart and the trust strip, and **no comparison block at all** | GA-12 |

A screenshot goes stale the moment the screen changes. Replace the file rather than adding
a second one, and only keep an image a document or a pull request actually links to.

**The `ga-NN-` prefix names the increment that owns the screen, not the date of the file.**
GA-12 replaced `ga-10-answer-hero.jpg`: the catch now leads that screen and the takeaway
moved into its head, so the image was not stale in its figures but in its *shape*, and the
increment that owns it changed with it. `ga-10-numbers-and-provenance.jpg` kept its name —
GA-12 did not touch the disclosures — but was re-captured, because it was asserting 9,737
title values and 67,901 records against an engine that had since been corrected to 9,742
and 67,898. A screenshot stating figures the engine does not produce is this product's own
failure mode pointed at its documentation.

**Answer-column captures are full-page captures.** On a wide viewport the shell owns the
viewport height and only the ask column scrolls (`docs/architecture.md` §11), so the scroll
container is `<main>` rather than the document and a plain full-page capture would still
clip. The capture releases that one constraint and nothing else: the pixels are the ones a
user scrolls through, unrolled.
