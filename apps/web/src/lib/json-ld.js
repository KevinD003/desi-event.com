/**
 * Structured data as the text of a `<script>` element, safely.
 *
 * `JSON.stringify` is not an HTML serialiser. It leaves `<` alone, so a string
 * holding `</script>` closes the element it is inlined in, and whatever
 * follows runs as the page's own script. Every string in a JSON-LD block here
 * is somebody's own words (an event title, a performer's name, a night's
 * label, a venue's name), so that is a stored XSS on a public page, run as
 * every visitor who opens it.
 *
 * The characters that matter to the HTML parser, and the two line separators
 * that end a line in older JavaScript parsers, are written as JSON `\uXXXX`
 * escapes instead. They can only appear inside JSON strings, where the escape
 * means the same character, so the data a search engine reads is unchanged:
 * `JSON.parse` of the output equals `JSON.parse(JSON.stringify(data))`.
 *
 * Every page that inlines JSON goes through this, by way of the `JsonLd`
 * component; `json-ld.test.js` fails a build that inlines it any other way.
 *
 * @module lib/json-ld
 */

/** The characters written as escapes, and nothing else. */
const UNSAFE_IN_SCRIPT = /[<>&\u2028\u2029]/gu

/**
 * `\uXXXX` for one character.
 *
 * @param {string} character One character.
 * @returns {string} Its JSON escape.
 */
function escapeCharacter(character) {
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
}

/**
 * Serialise structured data for the body of an inline `<script>` element.
 *
 * @param {unknown} data A JSON-serialisable value.
 * @returns {string} JSON with `<`, `>`, `&`, U+2028 and U+2029 escaped.
 */
export function serializeJsonLd(data) {
  return (JSON.stringify(data) ?? 'null').replace(UNSAFE_IN_SCRIPT, escapeCharacter)
}
