import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The left rail. One mark, and one control that actually does something.
 *
 * The mock draws a settings button below the spacer. It is not here: v1 has no settings
 * (`docs/design.md` §9 puts auth, uploads and the chart editor out of scope), and a
 * control that opens nothing is the same defect as a trust pill that claims a check
 * nobody ran — smaller, but the same kind.
 */

export type AppRailProps = {
  readonly onNewQuestion: () => void;
};

export function AppRail({ onNewQuestion }: AppRailProps) {
  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 flex-col items-center gap-3 border-r border-ga-line bg-ga-surface px-3 py-4 max-lg:flex-row max-lg:border-r-0 max-lg:border-b"
    >
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-xl bg-ga-accent font-semibold text-ga-ink-on-accent"
      >
        G
      </span>
      <span className="sr-only">Golden Analytics</span>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={onNewQuestion}
        title="Start a new question"
        className="rounded-xl border-ga-line bg-ga-surface text-ga-ink-secondary hover:bg-ga-raised hover:text-ga-accent-ink"
      >
        <Plus aria-hidden="true" strokeWidth={2.2} />
        <span className="sr-only">Start a new question</span>
      </Button>
    </nav>
  );
}
