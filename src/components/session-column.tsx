"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

import type { DatasetProvenance, StarterCard } from "@/lib/view-model";
import { Button } from "@/components/ui/button";

/**
 * The persistent side column, and the composer anchored at its foot.
 *
 * ## Recommended questions for now; saved recipes later
 *
 * Settled in `docs/design.md` §6: the column holds **recipes**, not a transcript —
 * re-runnable questions, not a message history. Saving those recipes is GA-14 and is
 * deferred (`docs/build-spec.md` §0). Until then the column shows **one or two**
 * recommended questions shaped by the current session (`lib/recommend-questions.ts`) —
 * declared starters only, never invented copy, never labelled “saved.” When GA-14 lands,
 * the same row shape becomes a stored spec.
 *
 * ## The composer is live exactly when the deployment can read a sentence
 *
 * Free typing is the one part of this product that genuinely needs interpretation.
 * `ai/fallback-parser.ts` recognises the catalogue and the layer's declared vocabulary
 * and refuses everything else by design, so on a keyless build a box that accepted any
 * sentence would be promising a reading it cannot perform — the confident-answer failure
 * this product exists to remove, pointed at its own input. GA-08 supplies the reading,
 * and `canInterpret` carries which of the two deployments this is (`lib/view-model.ts`).
 *
 * Both states are stated **on the control** rather than in a banner. `docs/design.md` §8
 * rejects a persistent no-key banner because it keeps charging for a fact the user has
 * already taken in; a control that explains itself is the control's own state, read once,
 * where the user tries to act. Live, the note is not a boast — it says the same thing the
 * refusal path will say, before the user has to discover it: an undeclared term comes
 * back as a question rather than a guess (invariant 4).
 *
 * The starter questions stay the way in either way. `docs/design.md` §6 puts the question
 * box subordinate to the answer and makes the zero state starter questions, and a live
 * model does not change that ordering.
 */

export type SessionColumnProps = {
  readonly dataset: DatasetProvenance;
  readonly locale: string;
  /** At most two, already chosen for this session's history. */
  readonly recommended: readonly StarterCard[];
  /** False on the zero state — the pick is a start, not a follow-on. */
  readonly recommendFromHistory: boolean;
  readonly onShowStarters: () => void;
  /** Whether this deployment can read a freely typed question (`lib/view-model.ts`). */
  readonly canInterpret: boolean;
  readonly onAsk: (question: string) => void;
  readonly busy: boolean;
};

export function SessionColumn({
  dataset,
  recommended,
  recommendFromHistory,
  onShowStarters,
  canInterpret,
  onAsk,
  busy,
}: SessionColumnProps) {
  const [draft, setDraft] = useState("");
  const question = draft.trim();
  const canSubmit = canInterpret && question !== "" && !busy;

  const submit = () => {
    if (!canSubmit) return;
    onAsk(question);
    // Cleared on send: the column holds recipes, not a transcript, and a question left
    // sitting in the box after its answer has rendered reads as one still unasked.
    setDraft("");
  };

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
        <h2 className="text-subhead text-ga-ink">Recommended</h2>
        <p className="mt-2 text-small text-ga-ink-secondary">
          {recommended.length === 0
            ? "Ask a question and related ones from this catalogue will show up here."
            : recommendFromHistory
              ? "Next from this catalogue, based on what you just asked."
              : "A place to start from this catalogue."}
        </p>
        {recommended.length > 0 ? (
          <ul className="mt-4 m-0 flex list-none flex-col gap-0 border-t border-ga-line p-0">
            {recommended.map((starter) => (
              <li key={starter.id} className="border-b border-ga-line">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAsk(starter.question)}
                  className="flex w-full cursor-pointer flex-col gap-0.5 px-0 py-3 text-left transition-colors duration-(--ga-dur-fast) ease-ga hover:bg-ga-raised disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="text-body font-medium text-ga-ink">{starter.question}</span>
                  <span className="text-small text-ga-ink-muted">{starter.recipe}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="border-t border-ga-line px-5 py-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="rounded-xl border border-ga-line-strong bg-ga-raised p-2.5"
        >
          <label className="sr-only" htmlFor="ask-box">
            Ask a question about this catalogue
          </label>
          <textarea
            id="ask-box"
            rows={2}
            disabled={!canInterpret}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            // Enter sends, Shift+Enter breaks the line. A two-row box people will write
            // one sentence into; requiring a reach for the button to send it is friction
            // with nothing on the other side of it.
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            aria-describedby="ask-box-reason"
            placeholder="Ask anything about this catalogue…"
            className="w-full resize-none bg-transparent text-body text-ga-ink placeholder:text-ga-ink-muted focus-visible:outline-none disabled:cursor-not-allowed"
          />
          <div className="mt-1.5 flex justify-end gap-2">
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
            {canInterpret ? (
              <Button type="submit" size="sm" disabled={!canSubmit}>
                Ask
              </Button>
            ) : null}
          </div>
        </form>
        <p id="ask-box-reason" className="mt-2 text-small text-ga-ink-secondary">
          {canInterpret
            ? "Type a question and I'll read it against this catalogue's declared terms. Anything it doesn't declare comes back as a question rather than a guess — and every figure is computed by the engine, never written by the model."
            : "Typing a question needs a model to read it, and this build runs without one. The starter questions work, and every figure they return comes from the engine either way."}
        </p>
      </div>
    </aside>
  );
}
