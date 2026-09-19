import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { ResultRow, ResultSet } from "@/server/contracts";
import { AnswerCard } from "@/components/answer-card";
import { buildComparison, materiallyDifferent } from "@/server/engine/compare";

import { labels, layer, topRatedTitles, topRatedTitlesCaught, topRatedTitlesUnchecked } from "./fixtures";

/**
 * The catch, asserted rather than described.
 *
 * This is the increment the product exists for, and the assertions below are its
 * definition of done (build-spec §3 GA-12): the hero moment renders with its real
 * figures, a question no check changed renders **nothing**, the escape is present and
 * loud, and the titles wrap rather than truncate because in this moment the titles are
 * the point.
 *
 * GA-15's accessibility verification pass is deferred (`docs/build-spec.md` §0), so the
 * accessibility assertions here are not a convenience — they are what holds the line.
 */

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function answerMarkup(
  resultSet: ResultSet,
  options: { checksOff?: ResultSet["trust"]["guardsApplied"] } = {},
): string {
  return render(
    <AnswerCard
      question="What are our top rated titles?"
      resultSet={resultSet}
      labels={labels}
      narration="Streetcar Named Desire, A (1951) leads on average rating at 4.47."
      narrationComplete
      streamClosed
      producer="template"
      degraded
      locale="en"
      checksOff={options.checksOff ?? null}
      onEscape={() => {}}
      onRestore={() => {}}
      busy={false}
    />,
  );
}

describe("the hero moment", () => {
  const html = answerMarkup(topRatedTitlesCaught);

  test("the naive side states 296 tied at 5.00", () => {
    // The pinned figure, and the one a limited row set cannot produce: three rows at
    // 5.00 is a tie, 296 members at 5.00 is the finding. It reaches the surface on
    // `comparison.tiedAtTop` (`tests/engine.test.ts` asserts the engine computes it).
    expect(html).toContain("296");
    expect(html).toContain("5.00");
    expect(html).toContain("Without the checks");
  });

  test("the honest side leads with Streetcar at 4.47 from 20 records", () => {
    expect(html).toContain("Streetcar Named Desire, A (1951)");
    expect(html).toContain("4.47");
    expect(html).toContain("20 records");
    expect(html).toContain("What we are showing you");
  });

  test("both lists are written to one digit width", () => {
    // `5` and `4.47` set side by side would show a precision that changes between the
    // two things being compared. One column formatter spans both sides, so the naive
    // values render `5.00` — which is also what the approved mock draws.
    expect(html).toContain("4.43");
    expect(html).not.toMatch(/>5</);
  });

  test("the record counts are inflected, because the leaders rest on one rating each", () => {
    expect(html).toContain("1 record<");
    expect(html).not.toContain("1 records");
  });

  test("the closing line states the difference in prose", () => {
    expect(html).toContain("Why the two lists differ");
    expect(html).toContain("8,445");
    expect(html).toContain("as few as 1 record each");
  });
});

describe("where the block sits", () => {
  const html = answerMarkup(topRatedTitlesCaught);
  const beforeChart = html.slice(0, html.indexOf("<figure"));

  test("it is above the chart", () => {
    expect(html.indexOf("ga-catch-heading")).toBeGreaterThan(-1);
    expect(html.indexOf("ga-catch-heading")).toBeLessThan(html.indexOf("<figure"));
  });

  test("it is open — not behind a disclosure, a control or a hidden attribute", () => {
    // build-spec §3 GA-12's second must-not. The comparison is the answer when a check
    // changed it, so demoting it to something the user has to open is the mistake the
    // mock's own note records making once.
    expect(beforeChart).not.toContain("<details");
    // The `hidden` *attribute*, not the word: `overflow-hidden` is a corner radius and
    // `aria-hidden` is on the two decorative elements that carry no words.
    expect(beforeChart).not.toMatch(/\shidden(=""|>|\s)/);
    expect(beforeChart).not.toMatch(/visibility:\s*hidden|display:\s*none|\bsr-only\b/);
  });

  test("the takeaway is folded into its head rather than sitting above it", () => {
    const head = html.slice(0, html.indexOf("ga-catch-naive"));
    expect(head).toContain("leads on average rating at 4.47");
  });
});

describe("no block is manufactured", () => {
  /**
   * Driven from `materiallyDifferent` itself, which is the only thing that decides
   * whether there is a catch. The point is not that these particular rows produce no
   * block — it is that the component's verdict and the engine's are the same verdict.
   */
  const cases: readonly {
    name: string;
    naive: readonly ResultRow[];
    honest: readonly ResultRow[];
  }[] = [
    {
      name: "identical rows",
      naive: topRatedTitles.rows,
      honest: topRatedTitles.rows,
    },
    {
      name: "a value that moved by less than the declared threshold",
      naive: [{ key: "a", value: 4.005, rawValue: 4005, n: 10 }],
      honest: [{ key: "a", value: 4.0, rawValue: 4000, n: 10 }],
    },
    {
      name: "different members",
      naive: [{ key: "b", value: 5, rawValue: 500, n: 1 }],
      honest: [{ key: "a", value: 4.43, rawValue: 443, n: 317 }],
    },
  ];

  for (const { name, naive, honest } of cases) {
    test(`${name}: the block renders exactly when the engine says it is material`, () => {
      const comparison = buildComparison(naive, honest, { naive: 1, honest: 1 }, layer);
      const material = materiallyDifferent(naive, honest, layer.materiality.minValueDelta);

      // The two are the same decision, taken once. `buildComparison` returning null is
      // how "not material" reaches the surface at all.
      expect(comparison === null).toBe(!material);

      const html = answerMarkup({
        ...topRatedTitles,
        trust: { ...topRatedTitles.trust, comparison },
      });
      expect(html.includes("The catch"), name).toBe(material);
      expect(html.includes("Without the checks"), name).toBe(material);
    });
  }

  test("an answer with no comparison keeps the plain takeaway card", () => {
    const html = answerMarkup(topRatedTitles);
    expect(html).not.toContain("The catch");
    expect(html).toContain("You asked");
    expect(html).toContain("leads on average rating at 4.47");
  });
});

describe("the titles wrap rather than truncate", () => {
  test("no row clamps, truncates or ellipsises its member", () => {
    const html = answerMarkup(topRatedTitlesCaught);
    const lists = html.slice(html.indexOf("<ol"), html.lastIndexOf("</ol>"));
    expect(lists).not.toMatch(/\btruncate\b|\btext-ellipsis\b|\bline-clamp-/);
    expect(lists).toContain("break-words");
    // The longest title in the honest three, written out in full.
    expect(lists).toContain("Sunset Blvd. (a.k.a. Sunset Boulevard) (1950)");
  });
});

describe("no meaning is carried by colour alone", () => {
  const html = answerMarkup(topRatedTitlesCaught);

  test("each side names itself in words", () => {
    expect(html).toContain("Without the checks");
    expect(html).toContain("What we are showing you");
  });

  test("each row writes out its own value and its own sample size", () => {
    // The bar-length equivalent: nothing on a row depends on reading its colour.
    expect(html).toContain("1 record");
    expect(html).toContain("317 records");
  });

  test("the block and both sides are labelled regions with real headings", () => {
    expect(html).toContain('aria-labelledby="ga-catch-heading"');
    expect(html).toContain('aria-labelledby="ga-catch-naive"');
    expect(html).toContain('aria-labelledby="ga-catch-honest"');
    expect(html).toContain('id="ga-catch-heading"');
  });

  test("the decorative rule and the connector are hidden from the accessibility tree", () => {
    expect(html).toContain("becomes");
    const connector = html.slice(html.indexOf("becomes") - 400, html.indexOf("becomes"));
    expect(connector).toContain('aria-hidden="true"');
  });

  test("it never claims the answer is verified", () => {
    expect(html.toLowerCase()).not.toContain("verified");
  });
});

describe("the escape", () => {
  test("is a real button, present and not hidden", () => {
    const html = answerMarkup(topRatedTitlesCaught);
    expect(html).toContain("Show me the unchecked list anyway");
    expect(html).toMatch(/<button[^>]*>Show me the unchecked list anyway<\/button>/);
    expect(html).toContain("it just won&#x27;t be turned off quietly");
  });

  test("is absent when there is no catch to escape from", () => {
    expect(answerMarkup(topRatedTitles)).not.toContain("Show me the unchecked list anyway");
  });

  test("taking it is not silent: the answer says which checks are not running", () => {
    // build-spec §3 GA-12's third must-not. An escaped answer's own trust report has no
    // guards in it, so without this the loudest screen in the product would be followed
    // by a quiet one.
    const html = answerMarkup(topRatedTitlesUnchecked, {
      checksOff: topRatedTitlesCaught.trust.guardsApplied,
    });
    expect(html).toContain("Checks off");
    expect(html).toContain("You are looking at this answer with the checks turned off.");
    expect(html).toContain("Not applied:");
    expect(html).toContain(
      "Checked how many ratings each title has, and left out the ones below the threshold.",
    );
    expect(html).toContain("Put the checks back");
  });

  test("the escaped answer draws no comparison and no catch", () => {
    const html = answerMarkup(topRatedTitlesUnchecked, {
      checksOff: topRatedTitlesCaught.trust.guardsApplied,
    });
    expect(html).not.toContain("The catch");
    expect(html).not.toContain("Show me the unchecked list anyway");
  });

  test("the trust strip is the second signal: its guard pills are gone", () => {
    const html = answerMarkup(topRatedTitlesUnchecked, {
      checksOff: topRatedTitlesCaught.trust.guardsApplied,
    });
    // The strip still states coverage — now every record, and every member — and
    // carries no guard pill, because no guard ran. Its two coverage pills keep their
    // own "Checked:" label, so the assertion is on the guard's declared sentence.
    const strip = html.slice(
      html.indexOf('aria-label="What was checked"'),
      html.indexOf("</ul>", html.indexOf('aria-label="What was checked"')),
    );
    expect(strip).toContain("100,836</b> of 100,836 records");
    expect(strip).toContain("9,742</b> of 9,742 title values included");
    expect(strip).not.toContain("Checked how many ratings each title has");
  });
});

describe("the block does not build the recipe sentence", () => {
  /**
   * build-spec §3 GA-12's last must-not, and the boundary C1's swap created. The escape
   * has a visible signal on this increment — the block's own head and the trust strip —
   * and GA-11 adds the third when there is a sentence to rewrite. Borrowing that
   * sentence here to get the signal working is what this card exists to prevent.
   */
  test("no tappable phrase, no closed list, no sentence scaffolding", () => {
    const html = answerMarkup(topRatedTitlesCaught);
    expect(html).not.toContain("I looked at the");
    expect(html).not.toContain("Tap any underlined phrase");
    expect(html).not.toContain('aria-haspopup="listbox"');
  });
});
