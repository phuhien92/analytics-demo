import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cell, columnIndex, parseCsv, type LineEndings } from "./csv.ts";
import { UNCATEGORISED_MARKER } from "./build-store.ts";
import {
  ReceivedPayloadSchema,
  type RatingEvent,
  type ReceivedPayload,
  type TagEvent,
  type TitleRecord,
} from "./payload.ts";

/**
 * The four supplied CSVs, read as **one payload received from a partner application**.
 *
 * This is the staged half of the data-scope decision (`docs/how-this-was-built.md`
 * entry 10): applications push data in over a webhook or API, the held dataset is one
 * such delivery, and the receiver is not built for the demo. So this module reads from
 * disk what a receiver would have read from a request body, and hands back exactly the
 * object that body would have carried. A live receiver replaces this function and
 * nothing downstream of `ReceivedPayloadSchema` moves (build-spec §9).
 *
 * The envelope is fixed rather than generated, because ingest has to be reproducible:
 * a `receivedAt` of `Date.now()` would give the store a different as-of point on every
 * run and the pinned figures would stop being regression tests.
 */

/**
 * The delivery this repository holds. `receivedAt` is the dataset's own generation date
 * (`data/README.txt`: "This dataset was generated on September 26, 2018"), which is the
 * moment the partner would have sent it — and it is deliberately later than the last
 * event in the payload, because when data was *observed* and when it was *delivered*
 * are different facts and the store records both.
 */
export const MOVIELENS_DELIVERY = {
  sourceId: "movielens",
  payloadId: "ml-latest-small-2018-09-26",
  schemaVersion: 1,
  receivedAt: "2018-09-26T00:00:00.000Z",
} as const;

export type ReadPayloadOptions = {
  /** Defaults to the correct reading. `"lf"` reproduces the CRLF defect on purpose. */
  lineEndings?: LineEndings;
  envelope?: {
    sourceId: string;
    payloadId: string;
    schemaVersion: number;
    receivedAt: string;
  };
};

const readTable = (dir: string, file: string, lineEndings: LineEndings) =>
  parseCsv(readFileSync(join(dir, file), "utf8"), { lineEndings });

/** `""` is how the supplied links file spells "the partner has no id for this title". */
const orNull = (value: string): string | null => (value === "" ? null : value);

export function readPayload(dir: string, options: ReadPayloadOptions = {}): ReceivedPayload {
  const lineEndings = options.lineEndings ?? "crlf";
  const envelope = options.envelope ?? MOVIELENS_DELIVERY;

  const links = readTable(dir, "links.csv", lineEndings);
  const linkMovieId = columnIndex(links, "movieId", "links.csv");
  const linkImdb = columnIndex(links, "imdbId", "links.csv");
  const linkTmdb = columnIndex(links, "tmdbId", "links.csv");
  const externalIds = new Map<string, { imdbId: string | null; tmdbId: string | null }>();
  links.rows.forEach((row, i) => {
    externalIds.set(cell(row, linkMovieId, "links.csv", i + 2), {
      imdbId: orNull(cell(row, linkImdb, "links.csv", i + 2)),
      tmdbId: orNull(cell(row, linkTmdb, "links.csv", i + 2)),
    });
  });

  const movies = readTable(dir, "movies.csv", lineEndings);
  const movieId = columnIndex(movies, "movieId", "movies.csv");
  const movieTitle = columnIndex(movies, "title", "movies.csv");
  const movieGenres = columnIndex(movies, "genres", "movies.csv");
  const titles: TitleRecord[] = movies.rows.map((row, i) => {
    const line = i + 2;
    const rawId = cell(row, movieId, "movies.csv", line);
    const rawGenres = cell(row, movieGenres, "movies.csv", line);
    const external = externalIds.get(rawId) ?? { imdbId: null, tmdbId: null };
    return {
      titleId: Number(rawId),
      title: cell(row, movieTitle, "movies.csv", line),
      // The marker says "none", so it resolves to none. It is not a twentieth genre,
      // and turning it into one is how a `(no genres listed)` bar appears in a chart.
      genres: rawGenres === UNCATEGORISED_MARKER ? [] : rawGenres.split("|").filter((g) => g !== ""),
      imdbId: external.imdbId,
      tmdbId: external.tmdbId,
    };
  });

  const ratingsTable = readTable(dir, "ratings.csv", lineEndings);
  const ratingUser = columnIndex(ratingsTable, "userId", "ratings.csv");
  const ratingMovie = columnIndex(ratingsTable, "movieId", "ratings.csv");
  const ratingValue = columnIndex(ratingsTable, "rating", "ratings.csv");
  const ratingAt = columnIndex(ratingsTable, "timestamp", "ratings.csv");
  const ratings: RatingEvent[] = ratingsTable.rows.map((row, i) => {
    const line = i + 2;
    return {
      viewerId: Number(cell(row, ratingUser, "ratings.csv", line)),
      titleId: Number(cell(row, ratingMovie, "ratings.csv", line)),
      rating: Number(cell(row, ratingValue, "ratings.csv", line)),
      at: Number(cell(row, ratingAt, "ratings.csv", line)),
    };
  });

  const tagsTable = readTable(dir, "tags.csv", lineEndings);
  const tagUser = columnIndex(tagsTable, "userId", "tags.csv");
  const tagMovie = columnIndex(tagsTable, "movieId", "tags.csv");
  const tagText = columnIndex(tagsTable, "tag", "tags.csv");
  const tagAt = columnIndex(tagsTable, "timestamp", "tags.csv");
  const tags: TagEvent[] = tagsTable.rows.map((row, i) => {
    const line = i + 2;
    return {
      viewerId: Number(cell(row, tagUser, "tags.csv", line)),
      titleId: Number(cell(row, tagMovie, "tags.csv", line)),
      tag: cell(row, tagText, "tags.csv", line),
      at: Number(cell(row, tagAt, "tags.csv", line)),
    };
  });

  // Validated here, at the boundary, exactly as a receiver would validate a request
  // body — so the demo path and the live path fail in the same place for the same
  // reason.
  return ReceivedPayloadSchema.parse({ ...envelope, titles, ratings, tags });
}
