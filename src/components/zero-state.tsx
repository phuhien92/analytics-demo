import { ArrowDownWideNarrow, TrendingUp } from "lucide-react";

import type { DatasetProvenance, InsightBriefing, StarterCard } from "@/lib/view-model";
import { formatters } from "@/lib/intl";
import { InsightBriefingBanner } from "@/components/insight-briefing";

/**
 * The zero state: starter questions, and nothing that was computed for them.
 *
 * `docs/design.md` §6 settles the form — "the zero state is starter questions, never a
 * blank builder" — and build-spec §1.2 settles what may sit beside them: **no score
 * card, no metrics row, no sparkline, no standing tile.** A standing catalogue summary
 * was considered during the UI direction and declined, so the space below the chips
 * stays empty until a question fills it.
 *
 * **Issue #27 exception (mock):** an AI insight banner may recommend a declared
 * analysis. It is fixture copy, stub-labelled, and its CTA only fires the normal ask
 * path — it does not display an engine result before a question in this session.
 *
 * The one permitted provenance line is the eyebrow: naming the data source. Each chip
 * carries what it is about to do, generated from the semantic layer's labels.
 */

export type ZeroStateProps = {
  readonly dataset: DatasetProvenance;
  readonly starters: readonly StarterCard[];
  readonly insight: InsightBriefing;
  readonly locale: string;
  readonly onAsk: (question: string) => void;
  readonly busy: boolean;
};

export function ZeroState({ dataset, starters, insight, locale, onAsk, busy }: ZeroStateProps) {
  const format = formatters(locale);

  return (
    <div className="flex flex-col gap-8">
      <InsightBriefingBanner
        briefing={insight}
        locale={locale}
        onAsk={onAsk}
        busy={busy}
      />

      <div>
        <p className="ga-eyebrow">
          {dataset.sourceId} catalogue · {format.count(dataset.titles)} titles ·{" "}
          {format.count(dataset.ratings)} ratings · as of {format.date(dataset.asOf)}
        </p>
        <h1 className="mt-2 text-title text-ga-ink">What would you like to know?</h1>
        <p className="mt-3 max-w-measure text-lead text-ga-ink-secondary">
          Pick a question. I&apos;ll show you the recipe I used — and tell you when the
          obvious answer would have misled you.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-subhead text-ga-ink">Start with one of these</h2>
        <ul className="grid list-none grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3 p-0">
          {starters.map((starter) => {
            const Icon = starter.shape === "sequence" ? TrendingUp : ArrowDownWideNarrow;
            return (
              <li key={starter.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAsk(starter.question)}
                  className="flex h-full w-full cursor-pointer flex-col items-start gap-2.5 rounded-xl border border-ga-line bg-ga-surface p-4 text-left transition-colors duration-(--ga-dur-fast) ease-ga hover:border-ga-accent-line hover:bg-ga-raised disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 place-items-center rounded-md bg-ga-accent-soft text-ga-accent-ink"
                  >
                    <Icon className="size-4" strokeWidth={2} />
                  </span>
                  <span className="text-body font-medium text-ga-ink">{starter.question}</span>
                  <span className="text-small text-ga-ink-muted">{starter.recipe}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
