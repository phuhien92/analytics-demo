import type { ReceivedPayload } from "./payload.ts";
import {
  RATING_SCALE,
  STORE_VERSION,
  YEAR_UNKNOWN,
  type ColumnMeta,
  type Store,
  type StoreManifest,
  type StoreStrings,
  isoToUnixSeconds,
  platformEndianness,
  unixSecondsToIso,
} from "./store.ts";

/**
 * Received payloads in, compiled store out. Pure: no disk, no clock, no environment.
 *
 * The function takes an *array* of payloads because the store is a log, not a snapshot.
 * v1 delivers one, but a second costs nothing here and proves the property the whole
 * shape exists for: applying `[a, b]` leaves every record `[a]` wrote byte-identical
 * and only extends the log (`tests/pinned-figures.test.ts`).
 */

/** What the partner writes in the genres cell when a title carries none. */
export const UNCATEGORISED_MARKER = "(no genres listed)";

/**
 * The release year, or null.
 *
 * Deliberately strict: four digits in parentheses at the very end of the delivered
 * title. Thirteen of the 9,742 titles do not match, and one of them is the reason the
 * rule is not loosened — `Death Note: Desu nôto (2006–2007)` carries a year *range*,
 * and a looser rule would silently file it under 2006. Nothing undeclared is coerced
 * (AGENTS.md invariant 4); an unparseable year becomes a declared gap instead, which
 * GA-04 discloses in the trust report's coverage note.
 */
export function parseReleaseYear(title: string): number | null {
  const match = /\((\d{4})\)$/.exec(title.trim());
  return match === null ? null : Number(match[1]);
}

/**
 * A presentation-scale value as a scaled integer, or a throw naming it.
 *
 * A value that does not land on the declared scale is **rejected, not rounded**. The
 * alternative silently changes a partner's number, which is the failure this product
 * exists to catch — and it would do it at the one point no test is looking.
 */
export function toScaledInt(value: number, scale: number, context: string): number {
  if (!Number.isFinite(value)) throw new Error(`ingest: ${context} is not a finite number (${value})`);
  const scaled = value * scale;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new Error(
      `ingest: ${context} is ${value}, which does not land on the declared scale of 1/${scale}`,
    );
  }
  return rounded;
}

type TitleDeclaration = {
  titleId: number;
  title: string;
  genres: readonly string[];
  imdbId: string | null;
  tmdbId: string | null;
};

const declarationKey = (t: TitleDeclaration): string =>
  JSON.stringify([t.title, [...t.genres], t.imdbId, t.tmdbId]);

/**
 * An append-only log. `append` is the only way in; there is no index setter, so
 * overwriting a record in place is not expressible rather than merely discouraged.
 */
class EventLog<T> {
  readonly #records: T[] = [];

  append(record: T): number {
    this.#records.push(record);
    return this.#records.length - 1;
  }

  get length(): number {
    return this.#records.length;
  }

  /** Read-only view. Callers index it; nothing hands back a mutable reference. */
  read(position: number): T {
    const record = this.#records[position];
    if (record === undefined) throw new Error(`log: position ${position} is past the end`);
    return record;
  }
}

type LoggedRating = { viewerId: number; titleIndex: number; valueScaled: number; at: number };
type LoggedTag = { viewerId: number; titleIndex: number; textId: number; at: number };

/**
 * The store's columns, named. A fixed set rather than a bag of strings: a column that
 * arrives without a name here does not reach the writer.
 */
export type StoreColumns = {
  titleId: Int32Array;
  titleYear: Int16Array;
  titleGenreOffset: Uint32Array;
  titleGenreValue: Uint8Array;
  ratingViewerId: Int32Array;
  ratingTitleIndex: Int32Array;
  ratingValueScaled: Int16Array;
  ratingAt: Uint32Array;
  ratingByEventTime: Uint32Array;
  tagViewerId: Int32Array;
  tagTitleIndex: Int32Array;
  tagTextId: Int32Array;
  tagAt: Uint32Array;
  tagByEventTime: Uint32Array;
};

export type BuiltStore = {
  store: Store;
  manifest: Omit<StoreManifest, "columns" | "endianness" | "storeVersion">;
  strings: StoreStrings;
  columns: StoreColumns;
  /** Payload ids that were already applied and so were not applied again. */
  skipped: string[];
};

export function buildStore(payloads: readonly ReceivedPayload[]): BuiltStore {
  if (payloads.length === 0) throw new Error("ingest: no payloads to build from");

  const applied: StoreManifest["payloads"] = [];
  const skipped: string[] = [];
  const seenPayloadIds = new Set<string>();

  const titleIndexById = new Map<number, number>();
  const titleDeclarations: TitleDeclaration[] = [];

  const ratingLog = new EventLog<LoggedRating>();
  const tagLog = new EventLog<LoggedTag>();
  const tagTextIds = new Map<string, number>();
  const tagTexts: string[] = [];
  const viewers = new Set<number>();

  for (const payload of payloads) {
    // A replayed delivery is recognisable by its payloadId, so re-running ingest
    // appends nothing rather than doubling the log.
    if (seenPayloadIds.has(payload.payloadId)) {
      skipped.push(payload.payloadId);
      continue;
    }
    seenPayloadIds.add(payload.payloadId);

    for (const title of payload.titles) {
      const existing = titleIndexById.get(title.titleId);
      if (existing !== undefined) {
        // A correction is a feature this store does not have. Keeping either version
        // silently is a coercion, so a genuine disagreement is refused.
        if (declarationKey(titleDeclarations[existing]!) !== declarationKey(title)) {
          throw new Error(
            `ingest: payload ${payload.payloadId} redeclares title ${title.titleId} with different content; ` +
              `this store appends, it does not correct`,
          );
        }
        continue;
      }
      titleIndexById.set(title.titleId, titleDeclarations.length);
      titleDeclarations.push(title);
    }

    const firstRatingSeq = ratingLog.length;
    for (const rating of payload.ratings) {
      const titleIndex = titleIndexById.get(rating.titleId);
      if (titleIndex === undefined) {
        throw new Error(
          `ingest: payload ${payload.payloadId} rates title ${rating.titleId}, which no payload declares`,
        );
      }
      ratingLog.append({
        viewerId: rating.viewerId,
        titleIndex,
        valueScaled: toScaledInt(
          rating.rating,
          RATING_SCALE,
          `rating by viewer ${rating.viewerId} on title ${rating.titleId}`,
        ),
        at: rating.at,
      });
      viewers.add(rating.viewerId);
    }

    const firstTagSeq = tagLog.length;
    for (const tag of payload.tags) {
      const titleIndex = titleIndexById.get(tag.titleId);
      if (titleIndex === undefined) {
        throw new Error(
          `ingest: payload ${payload.payloadId} tags title ${tag.titleId}, which no payload declares`,
        );
      }
      let textId = tagTextIds.get(tag.tag);
      if (textId === undefined) {
        textId = tagTexts.length;
        tagTextIds.set(tag.tag, textId);
        tagTexts.push(tag.tag);
      }
      tagLog.append({ viewerId: tag.viewerId, titleIndex, textId, at: tag.at });
      viewers.add(tag.viewerId);
    }

    applied.push({
      payloadId: payload.payloadId,
      sourceId: payload.sourceId,
      schemaVersion: payload.schemaVersion,
      receivedAt: payload.receivedAt,
      firstRatingSeq,
      ratingCount: ratingLog.length - firstRatingSeq,
      firstTagSeq,
      tagCount: tagLog.length - firstTagSeq,
      titlesDeclared: payload.titles.length,
    });
  }

  if (applied.length === 0) {
    throw new Error("ingest: every payload was a replay; nothing to build");
  }

  // ---- titles ----------------------------------------------------------------
  const titleCount = titleDeclarations.length;
  const titleId = new Int32Array(titleCount);
  const titleYear = new Int16Array(titleCount);
  const titleGenreOffset = new Uint32Array(titleCount + 1);
  const titleNames: string[] = new Array<string>(titleCount);
  const imdbIds: (string | null)[] = new Array<string | null>(titleCount);
  const tmdbIds: (string | null)[] = new Array<string | null>(titleCount);

  const genreNames = [...new Set(titleDeclarations.flatMap((t) => t.genres))].sort();
  if (genreNames.length > 255) {
    throw new Error(`ingest: ${genreNames.length} genres exceeds the Uint8 genre column`);
  }
  const genreIdByName = new Map(genreNames.map((name, i) => [name, i]));

  const genreValues: number[] = [];
  let uncategorisedTitles = 0;
  let undatedTitles = 0;

  for (let i = 0; i < titleCount; i += 1) {
    const declaration = titleDeclarations[i]!;
    titleId[i] = declaration.titleId;
    titleNames[i] = declaration.title;
    imdbIds[i] = declaration.imdbId;
    tmdbIds[i] = declaration.tmdbId;

    const year = parseReleaseYear(declaration.title);
    if (year === null) undatedTitles += 1;
    titleYear[i] = year ?? YEAR_UNKNOWN;

    titleGenreOffset[i] = genreValues.length;
    if (declaration.genres.length === 0) uncategorisedTitles += 1;
    for (const genre of declaration.genres) genreValues.push(genreIdByName.get(genre)!);
  }
  titleGenreOffset[titleCount] = genreValues.length;
  const titleGenreValue = Uint8Array.from(genreValues);

  // ---- event logs ------------------------------------------------------------
  const ratingCount = ratingLog.length;
  const ratingViewerId = new Int32Array(ratingCount);
  const ratingTitleIndex = new Int32Array(ratingCount);
  const ratingValueScaled = new Int16Array(ratingCount);
  const ratingAt = new Uint32Array(ratingCount);
  for (let i = 0; i < ratingCount; i += 1) {
    const record = ratingLog.read(i);
    ratingViewerId[i] = record.viewerId;
    ratingTitleIndex[i] = record.titleIndex;
    ratingValueScaled[i] = record.valueScaled;
    ratingAt[i] = record.at;
  }

  const tagCount = tagLog.length;
  const tagViewerId = new Int32Array(tagCount);
  const tagTitleIndex = new Int32Array(tagCount);
  const tagTextId = new Int32Array(tagCount);
  const tagAt = new Uint32Array(tagCount);
  for (let i = 0; i < tagCount; i += 1) {
    const record = tagLog.read(i);
    tagViewerId[i] = record.viewerId;
    tagTitleIndex[i] = record.titleIndex;
    tagTextId[i] = record.textId;
    tagAt[i] = record.at;
  }

  // Ordering is an index over immutable records, never a reordering of them. A late
  // payload appends and this is rebuilt; nothing already written moves.
  const orderByEventTime = (at: Uint32Array): Uint32Array => {
    const index = new Uint32Array(at.length);
    for (let i = 0; i < at.length; i += 1) index[i] = i;
    return index.sort((a, b) => (at[a]! - at[b]!) || (a - b));
  };
  const ratingByEventTime = orderByEventTime(ratingAt);
  const tagByEventTime = orderByEventTime(tagAt);

  const eventTimes: number[] = [];
  if (ratingCount > 0) {
    eventTimes.push(ratingAt[ratingByEventTime[0]!]!, ratingAt[ratingByEventTime[ratingCount - 1]!]!);
  }
  if (tagCount > 0) {
    eventTimes.push(tagAt[tagByEventTime[0]!]!, tagAt[tagByEventTime[tagCount - 1]!]!);
  }
  if (eventTimes.length === 0) throw new Error("ingest: the payloads carry no events");

  const asOf = applied
    .map((p) => p.receivedAt)
    .reduce((latest, candidate) => (isoToUnixSeconds(candidate) > isoToUnixSeconds(latest) ? candidate : latest));

  const manifest: BuiltStore["manifest"] = {
    payloads: applied,
    asOf,
    firstEventAt: unixSecondsToIso(Math.min(...eventTimes)),
    lastEventAt: unixSecondsToIso(Math.max(...eventTimes)),
    scales: { rating: RATING_SCALE },
    genres: genreNames,
    counts: {
      titles: titleCount,
      ratings: ratingCount,
      tags: tagCount,
      viewers: viewers.size,
      uncategorisedTitles,
      undatedTitles,
      genreAssignments: titleGenreValue.length,
    },
  };

  const strings: StoreStrings = {
    titles: titleNames,
    imdbIds,
    tmdbIds,
    tagTexts,
  };

  const columns: StoreColumns = {
    titleId,
    titleYear,
    titleGenreOffset,
    titleGenreValue,
    ratingViewerId,
    ratingTitleIndex,
    ratingValueScaled,
    ratingAt,
    ratingByEventTime,
    tagViewerId,
    tagTitleIndex,
    tagTextId,
    tagAt,
    tagByEventTime,
  };

  const store: Store = {
    // The in-memory store has no on-disk layout yet; `writeStore` assigns the column
    // offsets. Everything else is already final.
    manifest: {
      storeVersion: STORE_VERSION,
      endianness: platformEndianness(),
      columns: [] as ColumnMeta[],
      ...manifest,
    },
    titles: {
      id: titleId,
      name: titleNames,
      year: titleYear,
      genreOffset: titleGenreOffset,
      genreValue: titleGenreValue,
      imdbId: imdbIds,
      tmdbId: tmdbIds,
    },
    ratings: {
      viewerId: ratingViewerId,
      titleIndex: ratingTitleIndex,
      valueScaled: ratingValueScaled,
      at: ratingAt,
      byEventTime: ratingByEventTime,
    },
    tags: {
      viewerId: tagViewerId,
      titleIndex: tagTitleIndex,
      textId: tagTextId,
      at: tagAt,
      byEventTime: tagByEventTime,
      texts: tagTexts,
    },
  };

  return { store, manifest, strings, columns, skipped };
}
