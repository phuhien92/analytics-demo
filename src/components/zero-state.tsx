import { ArrowDownWideNarrow, TrendingUp } from "lucide-react";

import type { DatasetProvenance, StarterCard } from "@/lib/view-model";
import { formatters } from "@/lib/intl";

/**
 * The zero state: starter questions, and nothing that was computed for them.
 *
 * `docs/design.md` §6 settles the form — "the zero state is starter questions, never a
 * blank builder" — and build-spec §1.2 settles what may sit beside them: **no score
 * card, no metrics row, no sparkline, no standing tile.** A standing catalogue summary
 * was considered during the UI direction and declined, so the space below the chips
 * stays empty until a question fills it.
 *
 * The one permitted exception is the eyebrow, and it is permitted because naming the
 * data source *is* provenance. `DatasetProvenance` explains why `100,836 ratings` is not
 * a metric: it is read off the compiled store's manifest — the ETL's declaration of what
 * it received — and no spec, guard or as-of resolution is involved in producing it.
 *
 * Each chip carries what it is about to do, generated from the semantic layer's labels
 * (`server/surface/zero-state.ts`). Tapping one is reading a recipe, not firing an
 * unknown action — which is the same argument `docs/design.md` §3 makes for the recipe
 * sentence, one step earlier.
 */

export type ZeroStateProps = {
  readonly dataset: DatasetProvenance;
  readonly starters: readonly StarterCard[];
  readonly locale: string;
  readonly onAsk: (question: string) => void;
  readonly busy: boolean;
};

export function ZeroState({ dataset, starters, locale, onAsk, busy }: ZeroStateProps) {
  const format = formatters(locale);

  return (
    <div className="flex flex-col gap-8">
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
