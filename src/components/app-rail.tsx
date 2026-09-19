import Link from "next/link";

/**
 * The left rail — brand home only.
 *
 * The mark returns to the zero state (starter questions). A separate “new question”
 * control lived here in the mock; once the mark does the same job it is redundant, and
 * a second control that clears the answer without saying anything new is noise.
 *
 * Settings is still absent on purpose: v1 has none (`docs/design.md` §9).
 */

export type AppRailProps = {
  /** Return to the zero state. */
  readonly onGoHome: () => void;
};

export function AppRail({ onGoHome }: AppRailProps) {
  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 flex-col items-center gap-3 border-r border-ga-line bg-ga-surface px-3 py-4 max-lg:flex-row max-lg:border-r-0 max-lg:border-b"
    >
      <Link
        href="/"
        onClick={onGoHome}
        title="Golden Analytics home"
        className="grid size-9 place-items-center rounded-xl bg-ga-accent font-semibold text-ga-ink-on-accent transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ga-accent"
      >
        <span aria-hidden="true">G</span>
        <span className="sr-only">Golden Analytics home</span>
      </Link>
    </nav>
  );
}
