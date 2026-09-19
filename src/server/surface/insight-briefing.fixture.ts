/**
 * Static AI insight / recommended-task fixture for the zero-state banner (issue #27).
 *
 * Not from the engine. Not from a model. A labelled mock so the surface can sell the
 * proactive “recommended analysis” idea without a nightly job. Production follow-up:
 * scheduler → re-execute declared recipes → persist a briefing; this module stays the
 * stand-in until then.
 */

import type { InsightBriefing } from "@/lib/view-model";

export const INSIGHT_BRIEFING_FIXTURE: InsightBriefing = {
  asOf: "2018-09-26T00:00:00.000Z",
  stubLabel: "Mock — job not wired",
  insight: "Top-rated list is still dominated by thin 5.0 scores",
  why: "296 titles tie at a perfect 5.00 with ≤2 ratings. An honest cut (20+ ratings) leads with A Streetcar Named Desire at 4.47 — presenting the naive list would mislead a Monday review.",
  taskLabel: "Review honest top titles",
  recipeQuestion: "What are our top rated titles?",
};
