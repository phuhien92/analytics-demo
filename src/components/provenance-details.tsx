import type { Provenance } from "@/server/contracts";
import { formatters } from "@/lib/intl";

/**
 * "How did you get this?" — the record the answer already carries, written out.
 *
 * `docs/design.md` §6 puts this last in the default view order, as a drawer. The drawer
 * is GA-14's, and GA-14 is deferred (`docs/build-spec.md` §0), so this increment renders
 * the same facts inline behind a `<details>` rather than shipping a control that opens
 * nothing. Two things follow from that and both are deliberate: there is no overlay, so
 * the focus-management defect `docs/architecture.md` §10 records against the drawer
 * primitive cannot apply here; and the provenance is *present* in the demo rather than
 * postponed with the increment that would have styled it.
 *
 * Every field is read off `resultSet.provenance`. Nothing is recomputed: the point of
 * this block is that the numbers above it can be reproduced, and a provenance the
 * surface assembled for itself would be a second account of the same run.
 */

export type ProvenanceDetailsProps = {
  readonly provenance: Provenance;
  /** What wrote the takeaway — not the same fact as `degraded`. */
  readonly producer: "template" | "model";
  readonly degraded: boolean;
  readonly locale: string;
};

function Row({ term, children }: { readonly term: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-ga-line py-2 last:border-b-0">
      <dt className="min-w-44 text-micro font-medium text-ga-ink-muted uppercase">{term}</dt>
      <dd className="font-mono text-small text-ga-ink">{children}</dd>
    </div>
  );
}

export function ProvenanceDetails({
  provenance,
  producer,
  degraded,
  locale,
}: ProvenanceDetailsProps) {
  const format = formatters(locale);

  return (
    <details className="rounded-xl border border-ga-line-strong bg-ga-surface px-5 py-4">
      <summary className="cursor-pointer text-body font-medium text-ga-accent-ink marker:text-ga-accent-line">
        How did you get this?
      </summary>
      <dl className="mt-3">
        <Row term="Data as of">{format.date(provenance.resolvedAsOf)}</Row>
        <Row term="Source">{provenance.sourceId}</Row>
        <Row term="Computed by">
          {provenance.adapterId} · engine {provenance.engineVersion}
        </Row>
        <Row term="Semantic layer">
          {provenance.layerVersion} · schema {format.count(provenance.layerSchemaVersion)}
        </Row>
        <Row term="Computed at">{format.date(provenance.computedAt)}</Row>
        <Row term="Request">{provenance.requestId}</Row>
        <Row term="Summary written by">
          {producer === "template" ? "a fixed template" : "the model"}
          {degraded ? " · no model was available, so the deterministic parser read the question" : ""}
        </Row>
      </dl>
      <p className="mt-3 max-w-measure text-small text-ga-ink-secondary">
        Every figure above the line came from the engine, not from a written summary.
      </p>
    </details>
  );
}
