import type { ResultSet, SemanticLayer } from "@/server/contracts";

/**
 * The deterministic narration producer — the only one until GA-09 adds the model.
 *
 * It sits in `ai/` beside `fallback-parser.ts` for the same reason: this is the no-key
 * path's half of the two calls `docs/architecture.md` §6 describes, and GA-09's
 * `narrate.ts` lands next to it exporting the **same** `NarrationProducer` signature. The
 * route then picks between two producers rather than growing a branch — a substitution,
 * not a restructuring.
 *
 * ## It quotes; it never computes
 *
 * Every figure below is already a field on the `ResultSet` the engine returned. Nothing
 * here adds, divides, or derives a percentage — invariant 1 says every number comes from
 * the deterministic engine, and a template that computed a ratio "just for the sentence"
 * would be a figure originating outside it. The only count it takes for itself is
 * `guardsApplied.length`, which is a property of the *spec* rather than a fact about the
 * data.
 *
 * ## What it deliberately does not say
 *
 * It never previews the naive/honest comparison, even though `trust.comparison` is right
 * there and it is the product's best moment. GA-12 renders that block, and a template
 * sentence that told the story first is a thing GA-12 would have to unbuild.
 *
 * It never says "verified" (invariant 5). The verification is real but partial, and
 * copy says what was *checked*.
 */

/**
 * A narration producer: a result set in, the takeaway out, chunk by chunk.
 *
 * An `AsyncIterable<string>` from the first commit because GA-09's producer is an SDK
 * token stream and this one is a single chunk, and that is the only difference between
 * them. Anything narrower — returning a string, resolving a promise — would make GA-09
 * change this type, and with it the route, the frame encoder and every test.
 */
export type NarrationProducer = (
  resultSet: ResultSet,
  layer: SemanticLayer,
  locale: string,
) => AsyncIterable<string>;

/**
 * Presentation digits, without a declared display format.
 *
 * All numeric output goes through `Intl` (invariant 12) — a decimal comma changes
 * whether 4,47 reads as a rating or a count. What `Intl` is not told here is how many
 * digits a given measure shows, because the layer declares no display format: the widest
 * presentation scale in the shipped layer is `share_rated_4_plus` at ten-thousandths, so
 * a cap of four keeps every measure's exact presentation value and invents no precision
 * for the rest. The cost is that an average of exactly 4.40 renders as `4.4`. A
 * per-measure display format is a layer field GA-10 will want; it is recorded as such in
 * `docs/how-this-was-built.md` rather than guessed at here.
 */
const MAX_FRACTION_DIGITS = 4;

/**
 * "1 record" / "20 records".
 *
 * The escape (build-spec §3 GA-12) is what made this reachable: run the hero question
 * with its checks off and the leading title rests on a **single** rating, so the
 * takeaway read "from 1 records". `record` is this template's own English word and
 * inflecting it is ordinary copy — unlike a declared label, which is layer data and is
 * written exactly as declared.
 */
function records(n: number, numbers: Intl.NumberFormat): string {
  return `${numbers.format(n)} ${n === 1 ? "record" : "records"}`;
}

function labelFor(
  declarations: readonly { id: string; labels: Record<string, string> }[],
  id: string,
  locale: string,
): string {
  return declarations.find((declaration) => declaration.id === id)?.labels[locale] ?? id;
}

/**
 * The takeaway, as one string.
 *
 * Two sentences: what the top row says, and what the answer covers. Both are read
 * straight off the result set. Exported separately from the producer so a test can
 * assert on the text without draining a stream.
 */
export function templateTakeaway(
  resultSet: ResultSet,
  layer: SemanticLayer,
  locale = "en",
): string {
  const { spec, rows, trust } = resultSet;
  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: MAX_FRACTION_DIGITS });
  const measure = labelFor(layer.measures, spec.measure, locale);
  const breakdown =
    spec.breakdown === undefined ? null : labelFor(layer.dimensions, spec.breakdown, locale);

  const checks =
    trust.guardsApplied.length === 0
      ? "No checks were applied."
      : trust.guardsApplied.length === 1
        ? "1 check was applied."
        : `${numbers.format(trust.guardsApplied.length)} checks were applied.`;

  const coverage =
    breakdown === null
      ? `${numbers.format(trust.coverage.includedObservations)} of ` +
        `${records(trust.coverage.totalObservations, numbers)} are included. ${checks}`
      : `${numbers.format(trust.coverage.includedMembers)} of ` +
        `${numbers.format(trust.coverage.totalMembers)} ${breakdown} values are included, ` +
        `covering ${numbers.format(trust.coverage.includedObservations)} of ` +
        `${records(trust.coverage.totalObservations, numbers)}. ${checks}`;

  const top = rows[0];
  if (top === undefined) {
    return breakdown === null
      ? `No records are left for ${measure} once the checks are applied. ${checks}`
      : `No ${breakdown} values are left for ${measure} once the checks are applied. ${checks}`;
  }

  // A breakdown ordered by the member key is a sequence, not a ranking — "each year"
  // asks about a shape over time, and calling its first row the leader would be a claim
  // the ordering does not make.
  const headline =
    top.key === null
      ? `${measure} is ${numbers.format(top.value)}, from ${records(top.n, numbers)}.`
      : spec.sort.by === "breakdown"
        ? `${measure} by ${breakdown ?? ""}, starting at ${top.key} with ` +
          `${numbers.format(top.value)} from ${records(top.n, numbers)}.`
        : `${top.key} leads on ${measure} at ${numbers.format(top.value)}, ` +
          `from ${records(top.n, numbers)}.`;

  return `${headline} ${coverage}`;
}

/**
 * The template, as a stream of exactly one chunk.
 *
 * One chunk is the honest shape for a producer with nothing to wait for — inventing
 * chunk boundaries to look like a model would make the degraded path pretend to be the
 * live one, and the surface is owed the truth about which wrote the sentence.
 */
export const narrateFromTemplate: NarrationProducer = async function* (
  resultSet,
  layer,
  locale,
) {
  yield templateTakeaway(resultSet, layer, locale);
};
