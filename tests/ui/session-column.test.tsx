import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { SessionColumn } from "@/components/session-column";
import type { DatasetProvenance } from "@/lib/view-model";

/**
 * The composer, in both deployments.
 *
 * GA-08 makes free typing work, and the control has to say which build it is in without
 * a banner: `docs/design.md` §8 rejects a persistent no-key banner because it keeps
 * charging for a fact the user has already taken in. So the state lives on the control,
 * and these tests hold both halves of it — including the half that is *still* the
 * keyless build, because invariant 13 makes that a real deployment and not a degraded
 * one nobody ships.
 *
 * What is deliberately asserted here is the **copy and the disabled attribute**, not the
 * typing behaviour: `tests/ui/` renders with `react-dom/server` and has no DOM
 * (`docs/architecture.md` §10). What a keystroke does is a property of `AskSurface`'s
 * `ask`, which `tests/ask-route.test.ts` already exercises end to end.
 */

const dataset: DatasetProvenance = {
  sourceId: "movielens",
  payloadId: "ml-latest-small-2018-09-26",
  titles: 9742,
  ratings: 100836,
  asOf: "2018-09-26T00:00:00.000Z",
};

/**
 * The rendered `<textarea>` tag alone.
 *
 * Sliced out rather than matched across the whole markup because the field carries the
 * class `disabled:cursor-not-allowed` in *both* states — a substring search for
 * "disabled" would pass against the styling and never read the attribute, which is the
 * one thing these two tests are about.
 */
function field(markup: string): string {
  return markup.slice(markup.indexOf("<textarea"), markup.indexOf("</textarea>"));
}

/** React renders a boolean attribute as `disabled=""`, or omits it entirely. */
function isDisabled(markup: string): boolean {
  return / disabled=""/.test(field(markup));
}

function render(canInterpret: boolean): string {
  return renderToStaticMarkup(
    <SessionColumn
      dataset={dataset}
      locale="en"
      onShowStarters={() => {}}
      canInterpret={canInterpret}
      onAsk={() => {}}
      busy={false}
    />,
  );
}

describe("with an interpreter, the box is live", () => {
  test("the field is not disabled", () => {
    expect(isDisabled(render(true))).toBe(false);
  });

  test("it offers a way to send that is not the starter questions", () => {
    expect(render(true)).toContain(">Ask</button>");
  });

  test("the note promises a reading, and states the refusal before it happens", () => {
    const markup = render(true);

    // Invariant 4, said on the control: an undeclared term comes back as a question.
    expect(markup).toContain("comes back as a question rather than a guess");
    // Invariant 1, said in the same breath, because this is where a user would assume
    // otherwise: the model reads, the engine computes.
    expect(markup).toContain("computed by the engine, never written by the model");
  });

  test("it never claims the answer is verified", () => {
    // Invariant 5. The verification is real but partial, and overclaiming it reproduces
    // the silent failure this product criticises.
    expect(render(true)).not.toMatch(/verified/i);
  });
});

describe("without one, the box explains itself instead", () => {
  test("the field is disabled", () => {
    expect(isDisabled(render(false))).toBe(true);
  });

  test("the reason names the missing model rather than an error", () => {
    const markup = render(false);

    expect(markup).toContain("needs a model to read it");
    // The keyless build is a working build, and the note has to leave the user somewhere
    // to go rather than merely reporting an absence.
    expect(markup).toContain("The starter questions work");
    expect(markup).toContain("comes from the engine either way");
  });

  test("it offers no send control, so nothing suggests typing would work", () => {
    expect(render(false)).not.toContain(">Ask</button>");
  });
});

describe("both states", () => {
  test("keep the field labelled and the reason associated with it", () => {
    // The reason is the control's accessible description in both builds, so a screen
    // reader hears *why* before trying to type rather than after (invariant 11).
    for (const markup of [render(true), render(false)]) {
      expect(markup).toContain('for="ask-box"');
      expect(markup).toContain('aria-describedby="ask-box-reason"');
      expect(markup).toContain('id="ask-box-reason"');
    }
  });

  test("keep the starter questions reachable, which is the way in either way", () => {
    for (const markup of [render(true), render(false)]) {
      expect(markup).toContain("Starter questions");
    }
  });
});
