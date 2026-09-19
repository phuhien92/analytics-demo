"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Answer, TrustReport } from "@/server/contracts";
import type { SurfaceData } from "@/lib/view-model";
import { AnswerCard } from "@/components/answer-card";
import { AppRail } from "@/components/app-rail";
import { ClarifyCard } from "@/components/clarify-card";
import { SessionColumn } from "@/components/session-column";
import { ZeroState } from "@/components/zero-state";
import { AskFault, askStream } from "@/lib/answer-stream";
import { recommendQuestions } from "@/lib/recommend-questions";

/**
 * The shell, and the one piece of state it keeps: the current answer.
 *
 * Three columns — rail, the ask column, the session column — and a single ask column
 * that holds either the zero state or the answer, never both. That is `docs/design.md`
 * §6's arrangement: the answer object is the hero, the question box is subordinate to
 * it, and the persistent column holds recipes rather than a transcript.
 *
 * ## It keeps an answer, not a conversation
 *
 * There is no message list here, and adding one is a design change rather than a
 * refactor (`AGENTS.md`, settled decisions). The unit of state is the spec, which
 * arrives whole inside `resultSet` and is what a saved recipe would re-run.
 *
 * ## Nothing is computed on this side of the wire
 *
 * Every figure the surface draws came off the `answer` frame. The only thing this
 * component derives is *which* of two branches to render, and whether a request is in
 * flight.
 */

/**
 * The checks turned off to produce the answer on screen, or `null`.
 *
 * The one thing the surface carries across a re-run. An escaped answer's own trust
 * report has no guards in it — emptying them is what the escape does — so without this
 * the loudest moment in the product would be followed by a silent one, which build-spec
 * §3 GA-12 forbids in as many words.
 */
type ChecksOff = TrustReport["guardsApplied"] | null;

type Phase =
  | { readonly kind: "zero" }
  | { readonly kind: "asking"; readonly question: string }
  | {
      readonly kind: "answered";
      readonly question: string;
      readonly answer: Answer;
      readonly narration: string;
      readonly complete: boolean;
      readonly closed: boolean;
      readonly checksOff: ChecksOff;
    }
  | { readonly kind: "fault"; readonly question: string; readonly fault: AskFault };

export function AskSurface({
  dataset,
  starters,
  labels,
  locale,
  insight,
  canInterpret,
}: SurfaceData) {
  const [phase, setPhase] = useState<Phase>({ kind: "zero" });
  const inFlight = useRef<AbortController | null>(null);
  const answerRegion = useRef<HTMLDivElement>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  /**
   * Ask, optionally with some declared checks left off.
   *
   * `withoutGuards` and `checksOff` describe the same act from two sides: the ids the
   * request carries, and the guards — with the layer's own explanation of each — the
   * answer is missing. The route is given the ids; the surface keeps the explanations,
   * because that is the copy `ChecksOffBlock` states and an escaped answer no longer
   * carries it.
   */
  const ask = useCallback(
    (question: string, withoutGuards: readonly string[] = [], checksOff: ChecksOff = null) => {
      // A second question abandons the first rather than racing it. Two answers
      // interleaving into one region is how a figure ends up under the wrong heading.
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setPhase({ kind: "asking", question });

      void (async () => {
        // Written from inside the callbacks below, which TypeScript cannot see, so the
        // type is widened once here rather than narrowed to `null` after the closure.
        let received: Answer | null = null as Answer | null;
        let narration = "";
        try {
          const { complete, closed } = await askStream(
            { question, locale, withoutGuards },
            {
              onAnswer: (answer) => {
                received = answer;
                // The object lands before any prose — the wire format's own ordering
                // (`docs/architecture.md` §6a) — so the numbers paint first and the
                // sentence arrives over them.
                setPhase({
                  kind: "answered",
                  question,
                  answer,
                  narration: "",
                  complete: false,
                  closed: false,
                  checksOff,
                });
              },
              onDelta: (delta) => {
                narration += delta;
                setPhase((current) =>
                  current.kind === "answered" && current.question === question
                    ? { ...current, narration }
                    : current,
                );
              },
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (received === null) {
            // A 200 that carried no `answer` frame. Nothing to render, and leaving the
            // surface on "asking" would be a spinner that never resolves — so it is
            // reported as the fault it is.
            throw new AskFault(200, null, "the response carried no answer");
          }
          setPhase((current) =>
            current.kind === "answered" && current.question === question
              ? { ...current, complete, closed }
              : current,
          );
        } catch (error) {
          if (controller.signal.aborted) return;
          if (received === null) {
            setPhase({
              kind: "fault",
              question,
              fault:
                error instanceof AskFault
                  ? error
                  : new AskFault(0, null, "the answer could not be read"),
            });
            return;
          }
          setPhase((current) =>
            current.kind === "answered" && current.question === question
              ? { ...current, complete: false, closed: true }
              : current,
          );
        }
      })();
    },
    [locale],
  );

  const reset = useCallback(() => {
    inFlight.current?.abort();
    setPhase({ kind: "zero" });
  }, []);

  /**
   * The escape, and putting it back. Both are the **same question, re-run** — the only
   * thing that changes is which declared checks the request leaves off, so nothing here
   * rewrites a spec and nothing calls a model.
   *
   * The ids come off the answer's own trust report rather than from the layer, so the
   * escape can only turn off checks that actually ran on the answer being looked at.
   */
  const escape = useCallback(
    (question: string, applied: TrustReport["guardsApplied"]) => {
      ask(
        question,
        applied.map((guard) => guard.id),
        applied,
      );
    },
    [ask],
  );

  // Focus moves to the answer when one arrives, so a keyboard or screen-reader user is
  // taken to what they asked for instead of being left on a chip that is now off screen.
  // `preventScroll` because the browser would otherwise scroll the region's *end* into
  // view and land the reader halfway down the answer — the column is already at the top
  // and the takeaway is the first thing on it.
  useEffect(() => {
    if (phase.kind === "answered" || phase.kind === "fault") {
      answerRegion.current?.focus({ preventScroll: true });
    }
  }, [phase.kind]);

  const busy = phase.kind === "asking";

  const recommended = recommendQuestions(starters, {
    currentQuestion: phase.kind === "zero" ? null : phase.question,
    measure:
      phase.kind === "answered" && phase.answer.ok
        ? phase.answer.resultSet.spec.measure
        : null,
    breakdown:
      phase.kind === "answered" && phase.answer.ok
        ? (phase.answer.resultSet.spec.breakdown ?? null)
        : null,
    nearestQuestions:
      phase.kind === "answered" && !phase.answer.ok
        ? phase.answer.rejection.nearest.map((option) => option.question)
        : [],
  });

  return (
    // The rail and the session column are *persistent* (`docs/design.md` §6), so on a
    // wide viewport the shell owns the viewport height and only the ask column scrolls —
    // which is also what keeps the composer anchored at the foot. Below `lg` the columns
    // stack and the page scrolls as one, because a pinned composer on a short viewport
    // costs more room than it earns.
    <div className="min-h-dvh bg-ga-bg lg:h-dvh lg:overflow-hidden">
      <a
        href="#ask"
        className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-50 focus:rounded-br-lg focus:bg-ga-accent focus:px-4 focus:py-2.5 focus:text-ga-ink-on-accent"
      >
        Skip to the questions
      </a>

      <div className="grid min-h-dvh grid-cols-[auto_minmax(0,1fr)_22rem] lg:h-full lg:min-h-0 max-lg:grid-cols-1 max-lg:grid-rows-[auto_1fr_auto]">
        <AppRail onGoHome={reset} />

        <main id="ask" className="min-w-0 px-7 py-7 max-sm:px-4 lg:min-h-0 lg:overflow-y-auto">
          {phase.kind === "zero" ? (
            <ZeroState
              dataset={dataset}
              starters={starters}
              insight={insight}
              locale={locale}
              onAsk={ask}
              busy={busy}
            />
          ) : (
            <div
              ref={answerRegion}
              tabIndex={-1}
              aria-busy={busy}
              className="flex flex-col gap-4 focus-visible:outline-none"
            >
              {phase.kind === "asking" ? (
                <p role="status" className="text-body text-ga-ink-secondary">
                  Computing “{phase.question}” …
                </p>
              ) : phase.kind === "fault" ? (
                <div className="rounded-xl border border-ga-risk-line bg-ga-risk-bg px-5 py-4">
                  <h2 className="text-subhead text-ga-risk-ink">That question did not run.</h2>
                  <p className="mt-1.5 text-body text-ga-risk-ink">
                    {phase.fault.message}
                    {phase.fault.requestId === null ? "" : ` (request ${phase.fault.requestId})`}
                  </p>
                  <button
                    type="button"
                    onClick={reset}
                    className="mt-3 cursor-pointer rounded-lg border border-ga-risk-line bg-ga-surface px-3.5 py-2 text-body text-ga-ink"
                  >
                    Back to the questions
                  </button>
                </div>
              ) : phase.answer.ok ? (
                <AnswerCard
                  question={phase.question}
                  resultSet={phase.answer.resultSet}
                  labels={labels}
                  narration={phase.narration}
                  narrationComplete={phase.complete}
                  streamClosed={phase.closed}
                  producer={phase.answer.narration.producer}
                  degraded={phase.answer.degraded}
                  locale={locale}
                  checksOff={phase.checksOff}
                  onEscape={() =>
                    escape(phase.question, phase.answer.ok ? phase.answer.resultSet.trust.guardsApplied : [])
                  }
                  onRestore={() => ask(phase.question)}
                  busy={busy}
                />
              ) : (
                <ClarifyCard rejection={phase.answer.rejection} onAsk={ask} busy={busy} />
              )}

              {phase.kind === "answered" ? (
                <div>
                  <button
                    type="button"
                    onClick={reset}
                    className="cursor-pointer rounded-lg border border-ga-line-strong bg-ga-surface px-3.5 py-2 text-body text-ga-accent-ink transition-colors duration-(--ga-dur-fast) ease-ga hover:bg-ga-accent-soft"
                  >
                    Ask another question
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </main>

        <SessionColumn
          dataset={dataset}
          locale={locale}
          recommended={recommended}
          recommendFromHistory={phase.kind !== "zero"}
          onShowStarters={reset}
          canInterpret={canInterpret}
          onAsk={ask}
          busy={busy}
        />
      </div>
    </div>
  );
}
