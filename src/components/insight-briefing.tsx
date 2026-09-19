import { ArrowRight, Sparkles } from "lucide-react";

import type { InsightBriefing } from "@/lib/view-model";
import { formatters } from "@/lib/intl";

/**
 * AI insight banner on the zero state — recommended next analysis (issue #27).
 *
 * Variant A from the UI prototype, folded in. Fixture-backed until a proactive job
 * exists; the stub label is load-bearing.
 */

export type InsightBriefingBannerProps = {
  readonly briefing: InsightBriefing;
  readonly locale: string;
  readonly onAsk: (question: string) => void;
  readonly busy: boolean;
};

export function InsightBriefingBanner({
  briefing,
  locale,
  onAsk,
  busy,
}: InsightBriefingBannerProps) {
  const format = formatters(locale);

  return (
    <aside
      aria-label="Recommended analysis"
      className="overflow-hidden rounded-xl border border-ga-accent-line bg-ga-accent-soft"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ga-accent-line/60 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-small font-medium text-ga-accent-ink">
          <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
          AI insight · as of {format.date(briefing.asOf)}
        </p>
        <p className="font-mono text-[11px] tracking-wide text-ga-ink-muted uppercase">
          {briefing.stubLabel}
        </p>
      </div>
      <div className="px-4 py-4">
        <p className="text-body font-medium text-ga-ink">{briefing.insight}</p>
        <p className="mt-1.5 max-w-measure text-small text-ga-ink-secondary">{briefing.why}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAsk(briefing.recipeQuestion)}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-ga-accent px-3.5 py-2 text-body font-medium text-ga-ink-on-accent hover:bg-ga-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {briefing.taskLabel}
          <ArrowRight className="size-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
    </aside>
  );
}
