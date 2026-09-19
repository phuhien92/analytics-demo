/**
 * A CSV reader for received payloads.
 *
 * Two properties are load-bearing here, and both were measured against the supplied
 * files rather than assumed:
 *
 * - **CRLF.** All four files terminate lines with `\r\n`. Left in place, the last field
 *   of every row keeps a trailing `\r`, which forks each genre into two members —
 *   `Drama` and `Drama\r` — and takes the genre count from 19 to 38. `IMAX` is always
 *   last in its list, so under an unstripped parse it exists *only* as `IMAX\r` and the
 *   genre disappears under its own name. Nothing errors; a breakdown by genre simply
 *   splits in half. `tests/pinned-figures.test.ts` pins both numbers.
 * - **Quoted fields.** 2,079 of 9,742 titles contain a comma (`American President, The
 *   (1995)`) and one contains an escaped double quote (`11'09""01 - September 11
 *   (2002)`), so a `split(",")` reader mis-columns a fifth of the title dimension.
 *
 * The `\r\n` handling lives in the scanner rather than in a `replace(/\r\n/g, "\n")`
 * pass over the whole text, because that pass also rewrites line endings *inside*
 * quoted fields — a silent edit to the partner's data, which is the class of failure
 * this product exists to catch.
 */

/** How the scanner treats `\r\n`. */
export type LineEndings =
  /** `\r\n` and `\n` both end a row. The correct reading of the supplied files. */
  | "crlf"
  /** Only `\n` ends a row, so a `\r` stays glued to the last field of the row. This is
   *  not a fallback — it is the defect above, kept expressible so the regression test
   *  can demonstrate it rather than simulate it by hand. */
  | "lf";

export type CsvOptions = {
  lineEndings?: LineEndings;
};

export type CsvTable = {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

const BOM = 0xfeff;

export function parseCsv(text: string, options: CsvOptions = {}): CsvTable {
  const crlfAware = (options.lineEndings ?? "crlf") === "crlf";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === BOM ? 1 : 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i]!;

    if (quoted) {
      if (c === '"') {
        // `""` inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    // A quote only opens a quoted field at the field's start (RFC 4180); anywhere else
    // it is a literal, which is what keeps `11'09"01` readable.
    if (c === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      endField();
      i += 1;
      continue;
    }
    if (crlfAware && c === "\r" && text[i + 1] === "\n") {
      endRow();
      i += 2;
      continue;
    }
    if (c === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  if (field !== "" || row.length > 0) endRow();

  // A file ending in a terminator yields one trailing row of a single empty field.
  const populated = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  const [header, ...body] = populated;
  if (header === undefined) throw new Error("csv: the input has no header row");

  return { header, rows: body };
}

/**
 * The position of a named column, or a throw naming what was there instead. A payload
 * whose columns moved is a broken integration, not a row to skip.
 */
export function columnIndex(table: CsvTable, name: string, file: string): number {
  const at = table.header.indexOf(name);
  if (at === -1) {
    // The header is printed escaped, because the reason this throws is usually an
    // invisible character. `has no column "genres"; its header is [movieId, title,
    // genres]` is a message that reads as a contradiction and costs an hour; the
    // escaped form says `"genres\r"` and costs nothing.
    const header = table.header.map((h) => JSON.stringify(h)).join(", ");
    throw new Error(`csv: ${file} has no column "${name}"; its header is [${header}]`);
  }
  return at;
}

/** The cell at `column`, or a throw naming the row. Ragged rows are a defect, not data. */
export function cell(row: readonly string[], column: number, file: string, line: number): string {
  const value = row[column];
  if (value === undefined) {
    throw new Error(`csv: ${file} line ${line} has ${row.length} fields, wanted at least ${column + 1}`);
  }
  return value;
}
