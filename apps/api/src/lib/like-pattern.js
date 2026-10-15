/**
 * Text a person typed, made safe to hand to a `LIKE` pattern.
 *
 * Prisma builds `contains`, `startsWith` and `endsWith` as `LIKE`, and a
 * case-insensitive `equals` (`mode: 'insensitive'`) as `ILIKE`, and it passes
 * the value through without escaping it. So in a search or a filter, `_`
 * matches any one character and `%` any run of them: a city filter of
 * `San_Jose` would find `SanXJose`, and a filter of `%` would find every city
 * there is. PostgreSQL's `LIKE` takes `\` as its escape character unless told
 * otherwise, so putting one before each of the three makes the value match
 * character for character.
 *
 * Only for values that reach a pattern operator. An `equals` without
 * `mode: 'insensitive'` is a plain `=`, where a backslash would be a real
 * character and escaping would break the match.
 *
 * @module @desi-event/api/lib/like-pattern
 */

/**
 * A search term with the LIKE wildcards (`%`, `_`) and the escape character
 * (`\`) escaped, so PostgreSQL matches it character for character.
 *
 * @param {string} text The search.
 * @returns {string} The escaped term.
 */
export function likeLiteral(text) {
  return text.replace(/[\\%_]/gu, (character) => `\\${character}`)
}

/**
 * A case-insensitive, character-for-character match on one column.
 *
 * Prisma runs this as `ILIKE` with the escaped value, which is how "the same
 * text in any case" is asked for without the value's own `_` or `%` turning
 * into wildcards.
 *
 * @param {string} text What the column must equal, ignoring case.
 * @returns {{equals: string, mode: 'insensitive'}} A Prisma string filter.
 */
export function equalsIgnoringCase(text) {
  return { equals: likeLiteral(text), mode: 'insensitive' }
}
