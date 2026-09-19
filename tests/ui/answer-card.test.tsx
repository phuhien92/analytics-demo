import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { AnswerCard } from "@/components/answer-card";
import { ResultTable } from "@/components/result-table";
import { formatters } from "@/lib/intl";

import { labels, ratingsByYear, topRatedTitles } from "./fixtures";

/**
 * The accessibility claim this increment makes, asserted rather than described.
 *
 * `docs/design.md` §7 says the takeaway and the recipe sentence *are* the accessible
 * representation of the chart, with a semantic `<table>` behind it that is **reachable,
 * not merely present**. GA-15 is the pass that would have caught a regression here and
 * it is deferred (`docs/build-spec.md` §0), so these are the tests that hold the line
 * instead.
 */

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function answerMarkup(): string {
  return render(
    <AnswerCard
      question="What are our top rated titles?"
      resultSet={topRatedTitles}
      labels={labels}
      narration="Streetcar Named Desire, A (1951) leads on average rating at 4.47."
      narrationComplete
      producer="template"
      degraded
      locale="en"
    />,
  );
}

describe("the table behind the chart", () => {
  test("every chart is a <figure> carrying a real <table>", () => {
    const html = answerMarkup();
    expect(html).toContain("<figure");
    expect(html).toContain("<figcaption");
    expect(html).toContain("<table");
    expect(html).toContain("<caption");
    // The member is a row header, so a screen reader names the row it is reading.
    expect(html).toContain('<th scope="row"');
    expect(html).toContain('<th scope="col"');
  });

  test("the table is reached through a disclosure, not hidden with CSS", () => {
    const html = answerMarkup();
    // `<summary>` is a native disclosure control: it carries an implicit `button` role,
    // is in the tab order, and toggles from Enter and Space without any script. Build
    // spec §3 GA-10 asks for a disclosure "any user can open"; this is the form that
    // still opens when the client bundle does not load.
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Show the numbers");

    // The forbidden shortcut: present in the accessibility tree, unreachable for
    // everyone else. The table must not be inside anything visually hidden.
    const table = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(table).not.toMatch(/visibility:\s*hidden/);
    expect(table).not.toMatch(/display:\s*none/);
    expect(table).not.toMatch(/\bsr-only\b/);
  });

  test("the chart itself is hidden from the accessibility tree", () => {
    // A Plot figure announces dozens of disconnected tick labels. The table is the
    // accessible artifact, so the SVG's host is `aria-hidden` and the numbers are
    // announced once, in a form that carries their meaning.
    expect(answerMarkup()).toContain('aria-hidden="true"');
  });
});

describe("what the answer states", () => {
  test("the takeaway echoes the question and carries the narration", () => {
    const html = answerMarkup();
    expect(html).toContain("What are our top rated titles?");
    expect(html).toContain("leads on average rating at 4.47");
  });

  test("the trust strip states what was checked, and never claims more", () => {
    const html = answerMarkup();
    expect(html).toContain(
      "Checked how many ratings each title has, and left out the ones below the threshold.",
    );
    expect(html).toContain("8,440");
    expect(html).toContain("67,901");
    // Invariant 5. The verification is genuine but partial, and the copy says what was
    // checked rather than claiming the answer is verified.
    expect(html.toLowerCase()).not.toContain("verified");
  });

  test("provenance names the moment, the adapter and who wrote the summary", () => {
    const html = answerMarkup();
    expect(html).toContain("How did you get this?");
    expect(html).toContain("September 26, 2018");
    expect(html).toContain("local-store");
    expect(html).toContain("a fixed template");
  });

  test("the comparison block is absent until GA-12", () => {
    // Stated in build-spec §3 GA-10 so it is not discovered as a bug. The data for it is
    // already on the result set; nothing renders it yet.
    expect(answerMarkup()).not.toContain("would have");
  });
});

describe("the record-count column", () => {
  test("is shown when it says something the measure does not", () => {
    const html = render(
      <ResultTable
        rows={topRatedTitles.rows}
        measureLabel="average rating"
        breakdownLabel="title"
        caption="average rating by title, ranked"
        locale="en"
      />,
    );
    expect(html).toContain("Records behind it");
    // The hero moment is only legible with it: 4.47 from 20 beside 4.43 from 317.
    expect(html).toContain("317");
  });

  test("is dropped when the measure is that count", () => {
    const html = render(
      <ResultTable
        rows={ratingsByYear.rows}
        measureLabel="number of ratings"
        breakdownLabel="rating year"
        caption="number of ratings by rating year"
        locale="en"
      />,
    );
    expect(html).not.toContain("Records behind it");
  });
});

describe("numbers are written to one width down a column", () => {
  test("4.3 renders as 4.30 beside 4.47", () => {
    const html = answerMarkup();
    const column = formatters("en").column(topRatedTitles.rows.map((row) => row.value));
    expect(column(4.3)).toBe("4.30");
    expect(html).toContain("4.30");
    expect(html).toContain("4.47");
  });
});
