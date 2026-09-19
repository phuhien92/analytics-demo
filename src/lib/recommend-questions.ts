import type { StarterCard } from "@/lib/view-model";

/**
 * Side-column recommendations: one or two declared starters, shaped by what the
 * session has already asked — never invented copy, never a standing catalogue dump.
 *
 * Zero history → the hero alone (nowhere else to go from). After an answer → starters
 * that share its measure or breakdown, excluding the question just asked. After a
 * refusal → the refusal's `nearest` list, still resolved against the catalogue so a
 * tap stays stage-1 matchable.
 */

export const RECOMMENDED_QUESTION_LIMIT = 2;

export type RecommendContext = {
  /** The question currently on screen, or `null` on the zero state. */
  readonly currentQuestion: string | null;
  /** From the answered spec when `ok`; otherwise `null`. */
  readonly measure: string | null;
  readonly breakdown: string | null;
  /** Refusal nearest question strings, when the answer is a clarifying question. */
  readonly nearestQuestions: readonly string[];
};

function sameQuestion(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Pick at most {@link RECOMMENDED_QUESTION_LIMIT} starters for the session column.
 */
export function recommendQuestions(
  starters: readonly StarterCard[],
  context: RecommendContext,
): readonly StarterCard[] {
  const asked = context.currentQuestion;
  const unused = (card: StarterCard) =>
    asked === null || !sameQuestion(card.question, asked);

  if (context.nearestQuestions.length > 0) {
    const byQuestion = new Map(starters.map((card) => [card.question, card]));
    const fromNearest = context.nearestQuestions.flatMap((question) => {
      const card = byQuestion.get(question);
      if (card === undefined || !unused(card)) return [];
      return [card];
    });
    if (fromNearest.length > 0) {
      return fromNearest.slice(0, RECOMMENDED_QUESTION_LIMIT);
    }
  }

  if (context.measure !== null || context.breakdown !== null) {
    const related = starters.filter((card) => {
      if (!unused(card)) return false;
      return (
        (context.measure !== null && card.measure === context.measure) ||
        (context.breakdown !== null && card.breakdown === context.breakdown)
      );
    });
    if (related.length > 0) {
      return related.slice(0, RECOMMENDED_QUESTION_LIMIT);
    }
  }

  // No history yet — one default, the hero. A second would be a catalogue again.
  return starters.filter(unused).slice(0, 1);
}
