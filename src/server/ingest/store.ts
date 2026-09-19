import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The compiled store: an append-only event log with derived indexes over it.
 *
 * **Append-only is the whole design, not a discipline.** A record, once written, is
 * never touched again; `asOf T` is answered by reading the events whose own time is at
 * or before T. Overwrite a rating in place and every past answer silently changes,
 * which makes `Provenance.resolvedAsOf` a fiction and the conformance suite
 * unre-runnable. Retrofitting immutability later is a storage rewrite, which is why it
 * lands here rather than when the first late payload arrives (build-spec §3 GA-02,
 * §9).
 *
 * Two consequences the shape carries:
 *
 * - **Records live in arrival order; ordering is an index.** `ratings.byEventTime` is a
 *   permutation of log positions sorted by `(at, position)`. A late-arriving payload
 *   appends records and the index is rebuilt — no existing record moves or changes.
 * - **Every measure is a scaled integer.** Ratings are stored as hundredths in an
 *   `Int16Array`. Half-stars are dyadic and would survive as floats, but a partner
 *   payload carrying prices would not, and two adapters disagreeing in the 11th decimal
 *   is exactly the silent difference this product claims to catch. Policy, not
 *   coincidence.
 *
 * Time is unix seconds throughout the store, and ISO-8601 UTC on the wire and in the
 * manifest — the comparison happens here, the diffing and pasting happens there
 * (architecture §2).
 */

export const STORE_VERSION = 1;

/** Hundredths. `4.47` is stored as `447`. */
export const RATING_SCALE = 100;

/** `year` for a title whose release year could not be parsed. */
export const YEAR_UNKNOWN = -1;

export type ColumnDType = "i32" | "i16" | "u32" | "u8";

export type ColumnMeta = {
  name: string;
  dtype: ColumnDType;
  length: number;
  byteOffset: number;
};

export type PayloadRecord = {
  payloadId: string;
  sourceId: string;
  schemaVersion: number;
  receivedAt: string;
  /** First log position this payload contributed, per log. Append-only bookkeeping. */
  firstRatingSeq: number;
  ratingCount: number;
  firstTagSeq: number;
  tagCount: number;
  titlesDeclared: number;
};

export type StoreManifest = {
  storeVersion: number;
  /** Typed-array views are platform-ordered; a mismatch is refused, never guessed. */
  endianness: "little" | "big";
  /** Append-only, in arrival order. A replayed payloadId is recognised, not re-applied. */
  payloads: PayloadRecord[];
  /**
   * The store's explicit as-of point: the latest `receivedAt` of any applied payload.
   * Non-null by construction — an implicit "now" is what makes a past answer
   * unre-runnable.
   */
  asOf: string;
  /** The latest event time in the log. Distinct from `asOf`, and both are facts. */
  lastEventAt: string;
  /** The earliest event time in the log. */
  firstEventAt: string;
  scales: { rating: number };
  /** The genre registry, sorted. Declared by the data, named by the semantic layer. */
  genres: string[];
  counts: {
    titles: number;
    ratings: number;
    tags: number;
    viewers: number;
    /** Titles the partner marked as carrying no genres. */
    uncategorisedTitles: number;
    /** Titles whose release year could not be parsed from the delivered title. */
    undatedTitles: number;
    genreAssignments: number;
  };
  columns: ColumnMeta[];
};

export type StoreStrings = {
  titles: string[];
  imdbIds: (string | null)[];
  tmdbIds: (string | null)[];
  tagTexts: string[];
};

export type Store = {
  manifest: StoreManifest;
  titles: {
    id: Int32Array;
    name: readonly string[];
    year: Int16Array;
    /** Ragged genre lists: title `i` owns `genreValue[genreOffset[i] .. genreOffset[i+1])`. */
    genreOffset: Uint32Array;
    genreValue: Uint8Array;
    imdbId: readonly (string | null)[];
    tmdbId: readonly (string | null)[];
  };
  ratings: {
    viewerId: Int32Array;
    titleIndex: Int32Array;
    /** Hundredths. Never a float. */
    valueScaled: Int16Array;
    at: Uint32Array;
    /** Log positions sorted by `(at, position)`. Derived; records never move. */
    byEventTime: Uint32Array;
  };
  tags: {
    viewerId: Int32Array;
    titleIndex: Int32Array;
    textId: Int32Array;
    at: Uint32Array;
    byEventTime: Uint32Array;
    texts: readonly string[];
  };
};

const MANIFEST_FILE = "manifest.json";
const STRINGS_FILE = "strings.json";
const COLUMNS_FILE = "columns.bin";

export function platformEndianness(): "little" | "big" {
  return new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? "little" : "big";
}

/** ISO-8601 UTC in, unix seconds out. The store compares seconds; the wire carries ISO. */
export function isoToUnixSeconds(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`store: "${iso}" is not an ISO-8601 timestamp`);
  return Math.floor(ms / 1000);
}

export function unixSecondsToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * The log positions of every rating at or before `asOfSeconds`, in event-time order.
 *
 * This is the whole payoff of the append-only log: a prefix of the event-time index,
 * found by binary search, with no record read twice and none mutated.
 */
export function ratingsAsOf(store: Store, asOfSeconds: number): Uint32Array {
  const index = store.ratings.byEventTime;
  const at = store.ratings.at;
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (at[index[mid]!]! <= asOfSeconds) lo = mid + 1;
    else hi = mid;
  }
  return index.subarray(0, lo);
}

const BYTES_PER: Record<ColumnDType, number> = { i32: 4, i16: 2, u32: 4, u8: 1 };
const ALIGNMENT = 8;

type AnyColumn = Int32Array | Int16Array | Uint32Array | Uint8Array;

function dtypeOf(column: AnyColumn): ColumnDType {
  if (column instanceof Int32Array) return "i32";
  if (column instanceof Int16Array) return "i16";
  if (column instanceof Uint32Array) return "u32";
  return "u8";
}

export function writeStore(
  dir: string,
  manifest: Omit<StoreManifest, "columns" | "endianness" | "storeVersion">,
  strings: StoreStrings,
  columns: Record<string, AnyColumn>,
): void {
  const names = Object.keys(columns).sort();

  let byteLength = 0;
  const metas: ColumnMeta[] = [];
  for (const name of names) {
    const column = columns[name]!;
    byteLength = Math.ceil(byteLength / ALIGNMENT) * ALIGNMENT;
    metas.push({ name, dtype: dtypeOf(column), length: column.length, byteOffset: byteLength });
    byteLength += column.length * BYTES_PER[dtypeOf(column)];
  }

  const buffer = new Uint8Array(Math.ceil(byteLength / ALIGNMENT) * ALIGNMENT);
  for (const meta of metas) {
    const column = columns[meta.name]!;
    buffer.set(
      new Uint8Array(column.buffer, column.byteOffset, column.length * BYTES_PER[meta.dtype]),
      meta.byteOffset,
    );
  }

  const full: StoreManifest = {
    storeVersion: STORE_VERSION,
    endianness: platformEndianness(),
    ...manifest,
    columns: metas,
  };

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(full, null, 2)}\n`);
  writeFileSync(join(dir, STRINGS_FILE), `${JSON.stringify(strings)}\n`);
  writeFileSync(join(dir, COLUMNS_FILE), buffer);
}

export function readStore(dir: string): Store {
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8")) as StoreManifest;
  if (manifest.storeVersion !== STORE_VERSION) {
    throw new Error(
      `store: ${dir} is version ${manifest.storeVersion}, this build reads ${STORE_VERSION}; re-run \`npm run ingest\``,
    );
  }
  if (manifest.endianness !== platformEndianness()) {
    throw new Error(
      `store: ${dir} was written ${manifest.endianness}-endian and this machine is ${platformEndianness()}-endian; re-run \`npm run ingest\``,
    );
  }
  const strings = JSON.parse(readFileSync(join(dir, STRINGS_FILE), "utf8")) as StoreStrings;
  const bytes = readFileSync(join(dir, COLUMNS_FILE));
  // `readFileSync` may hand back a view into a pooled buffer, so offsets are relative.
  const base = bytes.byteOffset;

  const view = (name: string): AnyColumn => {
    const meta = manifest.columns.find((c) => c.name === name);
    if (meta === undefined) throw new Error(`store: ${dir} has no column "${name}"`);
    const offset = base + meta.byteOffset;
    switch (meta.dtype) {
      case "i32":
        return new Int32Array(bytes.buffer, offset, meta.length);
      case "i16":
        return new Int16Array(bytes.buffer, offset, meta.length);
      case "u32":
        return new Uint32Array(bytes.buffer, offset, meta.length);
      case "u8":
        return new Uint8Array(bytes.buffer, offset, meta.length);
    }
  };

  return {
    manifest,
    titles: {
      id: view("titleId") as Int32Array,
      name: strings.titles,
      year: view("titleYear") as Int16Array,
      genreOffset: view("titleGenreOffset") as Uint32Array,
      genreValue: view("titleGenreValue") as Uint8Array,
      imdbId: strings.imdbIds,
      tmdbId: strings.tmdbIds,
    },
    ratings: {
      viewerId: view("ratingViewerId") as Int32Array,
      titleIndex: view("ratingTitleIndex") as Int32Array,
      valueScaled: view("ratingValueScaled") as Int16Array,
      at: view("ratingAt") as Uint32Array,
      byEventTime: view("ratingByEventTime") as Uint32Array,
    },
    tags: {
      viewerId: view("tagViewerId") as Int32Array,
      titleIndex: view("tagTitleIndex") as Int32Array,
      textId: view("tagTextId") as Int32Array,
      at: view("tagAt") as Uint32Array,
      byEventTime: view("tagByEventTime") as Uint32Array,
      texts: strings.tagTexts,
    },
  };
}
