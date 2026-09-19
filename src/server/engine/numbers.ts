/**
 * The engine's arithmetic. Pure, integer-only, and stated rather than inherited from
 * whichever formatter happens to run.
 *
 * Both functions here exist because a reasonable implementation chosen casually produces
 * a *different answer* from another reasonable implementation chosen casually. That is
 * the same finding that made `tieBreak` a required field rather than an optional one
 * (`docs/architecture.md` §2), reappearing one layer further down — in how a value is
 * compared, and in how it is rounded.
 */

/** Beyond this, a product of two integers is no longer exact in a double. */
const SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Compare two exact rationals `a.numerator / a.denominator` and `b.…`, by
 * cross-multiplication. Returns <0, 0 or >0.
 *
 * **Ordering never touches a float.** `ORDER BY AVG(rating) DESC` in any SQL warehouse
 * orders on the full-precision average, so the engine must too or a SQL adapter and this
 * one disagree on rows that round to the same displayed number. Measured on the shipped
 * store, at `asOf 2007-08-02`: Dr. Strangelove (19,100/43), Lawrence of Arabia
 * (14,200/32) and Chinatown (13,750/31) **all display 4.44**, and only full precision
 * puts them in that order. Rounding first would reorder them alphabetically and change
 * which three appear above a `limit` of 3.
 *
 * Denominators are positive by construction (`Math.max(observations, 1)` in the adapter),
 * so no sign correction is needed. Magnitudes on the shipped store peak near 5.1e12 —
 * comfortably exact — and the BigInt fallback covers a larger dataset rather than being
 * dead code waiting to be wrong.
 */
export function compareExact(
  a: { numerator: number; denominator: number },
  b: { numerator: number; denominator: number },
): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  if (Math.abs(left) <= SAFE && Math.abs(right) <= SAFE) {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  const bigLeft = BigInt(a.numerator) * BigInt(b.denominator);
  const bigRight = BigInt(b.numerator) * BigInt(a.denominator);
  return bigLeft < bigRight ? -1 : bigLeft > bigRight ? 1 : 0;
}

/**
 * `numerator / denominator`, rounded to an integer **half toward zero**, with exact
 * integer arithmetic.
 *
 * ## Why the rounding mode is stated, and why it is this one
 *
 * *A Streetcar Named Desire* has 20 ratings summing to 8,950 hundredths — a mean of
 * **exactly 4.475**, sitting precisely on the boundary between two presentation steps.
 * There is no arithmetically correct answer at two decimals; there is only a *stated*
 * one. Four reasonable implementations were measured on that value:
 *
 * | Implementation                              | Result   |
 * | ------------------------------------------- | -------- |
 * | `Math.round(sum / n)` — half up, hundredths | **4.48** |
 * | `Intl.NumberFormat(2dp).format(mean)`       | **4.48** |
 * | `mean.toFixed(2)`                           | **4.47** |
 * | `Math.round(mean * 100) / 100`              | **4.47** |
 *
 * Four implementations, two answers, split two–two — and the pinned hero figure is
 * **4.47** (`AGENTS.md`, "Data and pinned figures"; `docs/design.md` §4). So the engine
 * rounds **half toward zero**, which reproduces it, and says so here rather than letting
 * the number fall out of whichever formatter a later increment reaches for.
 *
 * The two `Intl`-based rows disagree for a reason worth knowing: ICU formats the
 * *shortest decimal that round-trips* to the double, so it sees `4.475` and rounds half
 * away from zero, while `toFixed` formats the actual binary value —
 * `4.474999999999999644…` — and rounds down. Invariant 12 is satisfied either way,
 * because rounding to the presentation scale happens **here**, on integers, and `Intl`
 * only ever formats an already-rounded value. That is the whole point of doing it here:
 * a formatter is a rendering choice, and this is an arithmetic one.
 */
export function roundHalfTowardZero(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const negative = numerator < 0 !== denominator < 0;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);

  // `Math.floor(n / d)` can land one too high when the true quotient sits just below an
  // integer, so the quotient is corrected against exact integer products.
  let q = Math.floor(n / d);
  if (q * d > n) q -= 1;
  else if ((q + 1) * d <= n) q += 1;

  const remainder = n - q * d;
  // Round away only past the halfway point: exactly half stays put, which is what makes
  // this "half toward zero" rather than "half up".
  const magnitude = 2 * remainder > d ? q + 1 : q;
  return negative ? -magnitude : magnitude;
}

/**
 * Order two strings by **UTF-16 code unit**, never `localeCompare`.
 *
 * Measured on the shipped titles, the two orderings disagree at the very first element:
 * code-unit order opens with `'Til There Was You (1997)` and ICU collation with
 * `¡Three Amigos! (1986)`. `localeCompare` depends on the runtime's ICU build and the
 * ambient locale, so an answer would reorder itself across Node versions and machines —
 * exactly the class of silent difference invariant 10 exists to forbid. Labels are
 * locale-keyed and numbers go through `Intl` (invariants 8 and 12); *ordering* is a
 * reproducibility concern, and it is deliberately locale-free.
 */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
