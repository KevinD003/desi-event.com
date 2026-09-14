/**
 * Test helper: an in-memory pino destination.
 *
 * pino writes newline-delimited JSON to any object with a `write` method, so
 * capturing output needs nothing more than this.
 *
 * @returns {object} A stream with `write`, plus `raw()`, `lines()`, `last()` and `clear()` readers.
 */
export function createCaptureStream() {
  /** @type {string[]} */
  const chunks = []

  return {
    write(chunk) {
      chunks.push(chunk)
    },
    raw() {
      return chunks.join('')
    },
    lines() {
      return chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line))
    },
    last() {
      const lines = this.lines()
      return lines[lines.length - 1]
    },
    clear() {
      chunks.length = 0
    },
  }
}
