import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ZeroState } from "@/components/zero-state";
import { STARTER_QUESTIONS } from "@/server/ai/fallback-parser";
import type { Store, StoreManifest } from "@/server/ingest/store";
import { INSIGHT_BRIEFING_FIXTURE } from "@/server/surface/insight-briefing.fixture";
import { datasetProvenance, layerLabels, starterCards } from "@/server/surface/zero-state";

import { layer } from "./fixtures";

/**
 * The zero state: what it may say before anyone has asked anything, and where its words
 * come from.
 *
 * build-spec §1.2 is the rule being held — **no computed result that is not downstream
 * of a question asked in this session**, with naming the data source permitted as
 * provenance. `tests/ui/surface-rules.test.ts` holds it structurally (the first-paint
 * modules cannot reach the engine); these tests hold the copy.
 */

const manifest = {
  storeVersion: 1,
  endianness: "little",
  payloads: [
    {
      payloadId: "ml-latest-small-2018-09-26",
      sourceId: "movielens",
      schemaVersion: 1,
      receivedAt: "2018-09-26T00:00:00.000Z",
      firstRatingSeq: 0,
      ratingCount: 100836,
      firstTagSeq: 0,
      tagCount: 3683,
      titlesDeclared: 9742,
    },
  ],
  asOf: "2018-09-26T00:00:00.000Z",
  lastEventAt: "2018-09-24T14:27:30.000Z",
  firstEventAt: "1996-03-29T18:36:55.000Z",
  scales: { rating: 100 },
  genres: [],
  counts: {
    titles: 9742,
    ratings: 100836,
    tags: 3683,
    viewers: 610,
    uncategorisedTitles: 34,
    undatedTitles: 13,
    genreAssignments: 22050,
  },
  columns: [],
} satisfies StoreManifest;

// Only the manifest is read, which is the point: the dataset line is the ETL's own
// declaration, not an aggregation over the columns. The columns are left off entirely,
// so a `datasetProvenance` that ever started counting rows would fail here rather than
// pass quietly against a store that happened to be loaded.
const store = { manifest } as unknown as Store;

describe("the dataset line is provenance, read off the manifest", () => {
  test("it carries the source, the counts and the as-of, and nothing derived", () => {
    expect(datasetProvenance(store)).toEqual({
      sourceId: "movielens",
      payloadId: "ml-latest-small-2018-09-26",
      titles: 9742,
      ratings: 100836,
      asOf: "2018-09-26T00:00:00.000Z",
    });
  });
});

describe("the starter chips", () => {
  test("every declared starter question is offered", () => {
    const cards = starterCards(layer, "en");
    expect(cards.map((card) => card.id)).toEqual(STARTER_QUESTIONS.map((starter) => starter.id));
    expect(cards.length).toBeGreaterThan(0);
  });

  test("a chip's second line is generated from the layer's labels, not authored", () => {
    const cards = starterCards(layer, "en");
    const hero = cards.find((card) => card.id === "top-rated-titles");
    expect(hero?.question).toBe("What are our top rated titles?");
    expect(hero?.recipe).toBe("average rating, by title");

    // Rename the measure in the layer and the chip's promise follows it. A hand-written
    // caption would not, and a caption that disagrees with the spec it describes is this
    // product's own failure mode pointed at its zero state.
    const renamed = {
      ...layer,
      measures: layer.measures.map((measure) =>
        measure.id === "avg_rating" ? { ...measure, labels: { en: "typical score" } } : measure,
      ),
    };
    const after = starterCards(renamed, "en").find((card) => card.id === "top-rated-titles");
    expect(after?.recipe).toBe("typical score, by title");
  });

  test("a locale with no copy for a starter drops it rather than showing another locale's", () => {
    expect(starterCards(layer, "fr")).toEqual([]);
  });

  test("the shape comes from the spec's ordering, never from the dataset", () => {
    const cards = starterCards(layer, "en");
    expect(cards.find((card) => card.id === "top-rated-titles")?.shape).toBe("ranking");
    expect(cards.find((card) => card.id === "ratings-by-year")?.shape).toBe("sequence");
  });
});

describe("what the zero state renders", () => {
  const html = renderToStaticMarkup(
    <ZeroState
      dataset={datasetProvenance(store)}
      starters={starterCards(layer, "en")}
      insight={INSIGHT_BRIEFING_FIXTURE}
      locale="en"
      onAsk={() => {}}
      busy={false}
    />,
  );

  test("the eyebrow names the data source, through Intl", () => {
    expect(html).toContain("movielens catalogue");
    expect(html).toContain("9,742 titles");
    expect(html).toContain("100,836 ratings");
    expect(html).toContain("September 26, 2018");
  });

  test("the insight banner is stub-labelled and recommends a declared question", () => {
    expect(html).toContain("AI insight");
    expect(html).not.toContain("overnight pass");
    expect(html).toContain("Mock — job not wired");
    expect(html).toContain("Review honest top titles");
    expect(html).toContain(INSIGHT_BRIEFING_FIXTURE.insight);
  });

  test("every starter is a real button, so the keyboard reaches all of them", () => {
    const buttons = html.match(/<button/g) ?? [];
    // Starters plus the insight CTA.
    expect(buttons.length).toBe(STARTER_QUESTIONS.length + 1);
    expect(html).toContain('type="button"');
  });

  test("it is a list of questions, never a blank builder", () => {
    // `docs/design.md` §6: the zero state is starter questions. No free-text field is
    // reachable from it, and GA-11's closed lists are what interaction becomes.
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });

  test("no figure appears that a question produced", () => {
    /**
     * Every numeral in the *visible text* is accounted for: provenance from the
     * manifest, starter wording, and the issue #27 insight fixture (stub-labelled,
     * not engine output). Any other number would be a standing metric.
     */
    // Tags out, then character references — React writes an apostrophe as `&#x27;`, and
    // a raw scan would read that as the number 27.
    const text = html.replace(/<[^>]*>/g, " ").replace(/&#?[0-9a-zA-Z]+;/g, " ");
    const numerals = (text.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[.,]+$/, ""));
    const allowed = new Set([
      "9,742", // titles declared, from the manifest
      "100,836", // ratings received, from the manifest
      "26", // the as-of's day (eyebrow + insight)
      "2018", // the as-of's year
      "4", // "share rated 4 or higher" — a starter question's own words
      "5.0", // insight fixture — thin perfect scores (also matched as 5.00)
      "5.00",
      "296", // insight fixture
      "2", // insight fixture ≤2 ratings
      "20", // insight fixture honest floor
      "4.47", // insight fixture Streetcar
    ]);
    for (const numeral of numerals) {
      expect(allowed.has(numeral), `unexpected numeral on the zero state: ${numeral}`).toBe(true);
    }
    expect(numerals.length).toBeGreaterThan(3);
  });
});

describe("the layer's labels travel to the client", () => {
  test("every declared id resolves to its label at the locale", () => {
    const labels = layerLabels(layer, "en");
    expect(labels.measures.avg_rating).toBe("average rating");
    expect(labels.dimensions.release_decade).toBe("release decade");
  });

  test("an id with no label at the locale falls back to the id, never to another word", () => {
    const labels = layerLabels(layer, "fr");
    expect(labels.measures.avg_rating).toBe("avg_rating");
  });
});
