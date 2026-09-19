import { describe, expect, test } from "vitest";

import {
  RECOMMENDED_QUESTION_LIMIT,
  recommendQuestions,
  type RecommendContext,
} from "@/lib/recommend-questions";
import type { StarterCard } from "@/lib/view-model";

const starters: readonly StarterCard[] = [
  {
    id: "top-rated-titles",
    question: "What are our top rated titles?",
    recipe: "average rating, by title",
    shape: "ranking",
    measure: "avg_rating",
    breakdown: "title",
  },
  {
    id: "most-rated-titles",
    question: "Which titles have the most ratings?",
    recipe: "number of ratings, by title",
    shape: "ranking",
    measure: "rating_count",
    breakdown: "title",
  },
  {
    id: "rating-by-genre",
    question: "How does average rating compare across genres?",
    recipe: "average rating, by genre",
    shape: "ranking",
    measure: "avg_rating",
    breakdown: "genre",
  },
  {
    id: "ratings-by-genre",
    question: "How many ratings does each genre have?",
    recipe: "number of ratings, by genre",
    shape: "ranking",
    measure: "rating_count",
    breakdown: "genre",
  },
  {
    id: "ratings-by-year",
    question: "How many ratings did we get each year?",
    recipe: "number of ratings, by rating year",
    shape: "sequence",
    measure: "rating_count",
    breakdown: "rating_year",
  },
];

const empty: RecommendContext = {
  currentQuestion: null,
  measure: null,
  breakdown: null,
  nearestQuestions: [],
};

describe("recommendQuestions", () => {
  test("never offers more than two", () => {
    expect(RECOMMENDED_QUESTION_LIMIT).toBe(2);
  });

  test("with no history, offers only the hero", () => {
    const picked = recommendQuestions(starters, empty);
    expect(picked.map((card) => card.id)).toEqual(["top-rated-titles"]);
  });

  test("after an answer, offers related starters and excludes the one just asked", () => {
    const picked = recommendQuestions(starters, {
      currentQuestion: "What are our top rated titles?",
      measure: "avg_rating",
      breakdown: "title",
      nearestQuestions: [],
    });
    expect(picked).toHaveLength(2);
    expect(picked.map((card) => card.id)).toEqual([
      "most-rated-titles",
      "rating-by-genre",
    ]);
    expect(picked.every((card) => card.id !== "top-rated-titles")).toBe(true);
  });

  test("after a refusal, prefers nearest catalogue questions", () => {
    const picked = recommendQuestions(starters, {
      currentQuestion: "What is our revenue by region?",
      measure: null,
      breakdown: null,
      nearestQuestions: [
        "How does average rating compare across genres?",
        "How many ratings does each genre have?",
        "Which titles have the most ratings?",
      ],
    });
    expect(picked.map((card) => card.id)).toEqual([
      "rating-by-genre",
      "ratings-by-genre",
    ]);
  });
});
