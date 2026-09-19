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
| `ga-10-answer-hero.jpg` | The hero moment answered — *A Streetcar Named Desire* 4.47 from 20 ratings — with the takeaway, the chart and the trust strip | GA-10 |
| `ga-10-numbers-and-provenance.jpg` | "Show the numbers" and "How did you get this?" open: the semantic table behind the chart, and the answer's provenance | GA-10 |

A screenshot goes stale the moment the screen changes. Replace the file rather than adding
a second one, and only keep an image a document or a pull request actually links to.
