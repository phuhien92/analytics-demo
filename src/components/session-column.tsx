import { Sparkles } from "lucide-react";

import type { DatasetProvenance } from "@/lib/view-model";
import { Button } from "@/components/ui/button";
import { formatters } from "@/lib/intl";

/**
 * The persistent side column, and the composer anchored at its foot.
 *
 * ## It holds recipes, not a transcript
 *
 * Settled in `docs/design.md` §6 and listed in `AGENTS.md` among the decisions not to
 * resurrect: `docs/architecture.md` §2 makes the **spec** the unit of conversational
 * state, so a message history would carry the same information in a form the user cannot
 * re-run, and would leave the naive/honest catch with no inline home. The column is
 * empty here because saving is GA-14's increment and GA-14 is deferred
 * (`docs/build-spec.md` §0) — the region and its copy are shell, which is what GA-10
 * delivers.
 *
 * ## Why the composer cannot be typed into
 *
 * This build has no model and will not get one (`docs/build-spec.md` §0). Free typing is
 * the one part of the product that genuinely needs interpretation: `ai/fallback-parser.ts`
 * recognises the catalogue and declared vocabulary, and refuses everything else by
 * design. A box that accepted any sentence here would be promising a reading it cannot
 * perform, which is the confident-answer failure this product exists to remove, pointed
 * at its own input. So the field states what it needs and the starter questions are the
 * way in — which is `docs/design.md` §6's position anyway: the question box is
 * subordinate to the answer, and the zero state is starter questions.
 *
 * It is stated on the control rather than in a banner. `docs/design.md` §8 rejects a
 * persistent no-key banner because it keeps charging for a fact the user has already
 * taken in; a disabled control explaining itself is the control's own state, and it is
 * read once, where the user tries to act.
 */

export type SessionColumnProps = {
  readonly dataset: DatasetProvenance;
  readonly locale: string;
  readonly onShowStarters: () => void;
};

export function SessionColumn({ dataset, locale, onShowStarters }: SessionColumnProps) {
  const format = formatters(locale);

  return (
    <aside
      aria-label="Session"
      className="flex flex-col border-l border-ga-line bg-ga-surface max-lg:border-t max-lg:border-l-0 lg:h-full lg:min-h-0"
    >
      <div className="flex items-center gap-3 border-b border-ga-line px-5 py-4">
        <span
          aria-hidden="true"
          className="size-9 shrink-0 rounded-xl bg-linear-to-br from-ga-accent to-ga-accent-soft"
        />
        <div className="min-w-0">
          <p className="text-body font-medium text-ga-ink">{dataset.sourceId} catalogue</p>
          <p className="truncate text-small text-ga-ink-muted">{dataset.payloadId}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <h2 className="text-subhead text-ga-ink">Saved recipes</h2>
        <p className="mt-2 max-w-measure text-small text-ga-ink-secondary">
          Nothing saved yet. A saved recipe is the <em>question</em>, not the answer — re-run
          it and it recomputes from scratch against the catalogue as of{" "}
          {format.date(dataset.asOf)}, with today&apos;s checks and a fresh record of how it
          was made.
        </p>
      </div>

      <div className="border-t border-ga-line px-5 py-4">
        <form
          onSubmit={(event) => event.preventDefault()}
          className="rounded-xl border border-ga-line-strong bg-ga-raised p-2.5"
        >
          <label className="sr-only" htmlFor="ask-box">
            Ask a question about this catalogue
          </label>
          <textarea
            id="ask-box"
            rows={2}
            disabled
            aria-describedby="ask-box-reason"
            placeholder="Ask anything about this catalogue…"
            className="w-full resize-none bg-transparent text-body text-ga-ink placeholder:text-ga-ink-muted focus-visible:outline-none disabled:cursor-not-allowed"
          />
          <div className="mt-1.5 flex justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onShowStarters}
              className="bg-ga-surface text-ga-accent-ink hover:bg-ga-accent-soft"
            >
              <Sparkles aria-hidden="true" strokeWidth={2} />
              Starter questions
            </Button>
          </div>
        </form>
        <p id="ask-box-reason" className="mt-2 text-small text-ga-ink-secondary">
          Typing a question needs a model to read it, and this build runs without one. The
          starter questions work, and every figure they return comes from the engine either
          way.
        </p>
      </div>
    </aside>
  );
}
