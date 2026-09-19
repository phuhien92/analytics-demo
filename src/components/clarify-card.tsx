import { HelpCircle } from "lucide-react";

import type { Rejection } from "@/server/contracts";
import { Card } from "@/components/ui/card";

/**
 * The clarifying question — rendered, deliberately minimally.
 *
 * A question the layer cannot answer comes back as content at HTTP 200
 * (`docs/architecture.md` §6a), so the surface has a real second branch to draw and not
 * drawing it would leave a live response shape rendering as nothing. What is here is
 * the honest minimum: what was asked, what is missing, and the nearest questions that do
 * work — each one a button, because the user is going to tap one.
 *
 * Promoting refusal to a *demonstrated* feature is GA-11's, and build-spec §11 says so.
 * This block is the branch handled, not that showcase. It is reachable in this build
 * only if a starter question stops resolving against the layer, which is exactly the
 * moment you want to see it rather than a blank panel.
 *
 * It never guesses (invariant 4). Nothing here coerces the question to a near match; the
 * nearest questions are offered as alternatives the user chooses between.
 */

export type ClarifyCardProps = {
  readonly rejection: Rejection;
  readonly onAsk: (question: string) => void;
  readonly busy: boolean;
};

export function ClarifyCard({ rejection, onAsk, busy }: ClarifyCardProps) {
  return (
    <Card className="gap-3 border border-ga-caution-line bg-ga-caution-bg px-0 py-5 ring-0">
      <div className="flex gap-3 px-5">
        <HelpCircle
          className="mt-0.5 size-5 shrink-0 text-ga-caution-ink"
          aria-hidden="true"
          strokeWidth={2}
        />
        <div className="min-w-0">
          <h2 className="text-subhead text-ga-caution-ink">
            I can&apos;t answer that from this catalogue.
          </h2>
          <p className="mt-1.5 text-body text-ga-caution-ink">
            You asked · “{rejection.asked}”
          </p>
          <ul className="mt-2 list-disc pl-5 text-body text-ga-caution-ink">
            {rejection.missing.map((missing) => (
              <li key={`${missing.kind}:${missing.what}`}>
                No declared {missing.kind} for {missing.what}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {rejection.nearest.length > 0 ? (
        <div className="px-5">
          <h3 className="ga-eyebrow text-ga-caution-ink">Questions this catalogue can answer</h3>
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {rejection.nearest.map((nearest) => (
              <li key={nearest.question}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAsk(nearest.question)}
                  className="w-full cursor-pointer rounded-lg border border-ga-caution-line bg-ga-surface px-3.5 py-2.5 text-left text-body text-ga-ink transition-colors duration-(--ga-dur-fast) ease-ga hover:border-ga-accent-line hover:bg-ga-raised disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {nearest.question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
