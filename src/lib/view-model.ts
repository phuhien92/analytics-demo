/**
 * What the server hands the surface before anybody has asked anything.
 *
 * Types only, so both sides can import it: `src/server/surface/zero-state.ts` builds
 * these on the server, and the client components read them. Nothing here is computed
 * from a question — see `DatasetProvenance` for why that distinction is the whole point
 * of the zero state.
 */

/**
 * Which data this is, stated before any question — and **not** a computed result.
 *
 * build-spec §1.2 forbids a score card, a metrics row, a sparkline or any standing tile,
 * and permits exactly one thing: "naming the data source is provenance". These four
 * fields are read off the compiled store's **manifest** — the ETL's own declaration of
 * what it received — rather than produced by running a spec through the engine. No
 * aggregation, no guard, no as-of resolution: the same facts `npm run ingest` prints.
 *
 * The line it draws is worth stating, because a reader could reasonably ask why
 * `100,836 ratings` is not a metric. A metric answers a question about the data. This
 * says what the data *is*, the way a chart's axis says what it is measuring. A user who
 * cannot see which catalogue they are looking at cannot judge any answer that follows.
 */
export type DatasetProvenance = {
  /** The source the payload declared, e.g. `movielens`. */
  readonly sourceId: string;
  /** The payload's own id, e.g. `ml-latest-small-2018-09-26`. */
  readonly payloadId: string;
  readonly titles: number;
  readonly ratings: number;
  /** ISO-8601 UTC. The moment every answer in this session is computed at. */
  readonly asOf: string;
};

/**
 * One starter question, as the zero state renders it.
 *
 * `question` is the parser's own copy, so tapping a chip sends a string the catalogue
 * matches at stage 1 rather than one that has to be re-recognised. `recipe` is generated
 * from the semantic layer's labels rather than written here — the chip tells the user
 * what it is about to do, and that promise has to be the layer's, not a caption that can
 * drift from it.
 */
export type StarterCard = {
  readonly id: string;
  readonly question: string;
  /** e.g. "average rating, by title". Built from the layer's declared labels. */
  readonly recipe: string;
  /**
   * `ranking` when the spec orders by the measure, `sequence` when it orders by the
   * breakdown. Derived from the spec's own shape, never from the dataset — it is the
   * same distinction that chooses the chart form.
   */
  readonly shape: "ranking" | "sequence";
};

/**
 * The layer's declared labels, flattened to one locale.
 *
 * An `Answer` carries ids — `avg_rating`, `genre` — because the spec is what a saved
 * recipe re-runs and an id is what survives a label edit. The surface still has to write
 * "average rating", and it must be the layer's word for it rather than a second copy
 * kept in a component. So the labels travel from the server once, with the page, and
 * every id the surface renders is looked up in them.
 */
export type LayerLabels = {
  readonly measures: Readonly<Record<string, string>>;
  readonly dimensions: Readonly<Record<string, string>>;
};

/** Everything the surface needs before a question is asked. */
export type SurfaceData = {
  readonly dataset: DatasetProvenance;
  readonly starters: readonly StarterCard[];
  readonly labels: LayerLabels;
  readonly locale: string;
};
