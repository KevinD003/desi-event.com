/**
 * Find the readable strings in source files that name the site imported events
 * are listed on (the owner's request, 2026-10-15: no page a visitor or an
 * administrator reads names it, in any case).
 *
 * Every string literal and template-literal part of each file is read through
 * the JavaScript parser ESLint uses, so comments (developer documentation) are
 * never strings. A string is allowed only when it is one of the identifiers the
 * import still needs — the source's enum value and a dataset's file name — and
 * every other string that mentions the name, an address on the site included,
 * is reported with its file and line.
 *
 * For tests: `apps/api` and `apps/worker` hold their own sources, sentence
 * tables and templates to it.
 *
 * @module @desi-event/config/source-name-scan
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const espree = createRequire(require.resolve('eslint'))('espree')

/** The name, in any case. */
export const SOURCE_NAME = /sulekha/iu

/**
 * Strings that are identifiers, not words a person reads. Since 2026-10-15 no
 * address on the source's site is allowed either: nothing links, redirects or
 * connects there, so no code needs one (the address rule names the site with
 * a regular expression, which is not a string).
 *
 * @type {ReadonlyArray<RegExp>}
 */
export const ALLOWED_STRINGS = Object.freeze([
  // The import source's enum value.
  /^SULEKHA$/u,
  // A committed dataset's file name.
  /^sulekha-[a-z0-9-]+\.json$/u,
])

/**
 * Whether a string that mentions the name is an allowed identifier.
 *
 * @param {string} text The string.
 * @returns {boolean} True when allowed.
 */
export function isAllowedString(text) {
  return ALLOWED_STRINGS.some((pattern) => pattern.test(text))
}

/**
 * The strings a file's code holds (comments excluded), each with its line.
 *
 * @param {string} code The source text.
 * @returns {{text: string, line: number}[]} Its strings.
 */
export function stringsOf(code) {
  const ast = espree.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    loc: true,
    ecmaFeatures: { jsx: true },
  })
  const found = []
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return

    if (node.type === 'Literal' && typeof node.value === 'string') {
      found.push({ text: node.value, line: node.loc.start.line })
    } else if (node.type === 'TemplateElement') {
      found.push({ text: node.value.cooked ?? node.value.raw, line: node.loc.start.line })
    } else if (node.type === 'JSXText') {
      found.push({ text: node.value, line: node.loc.start.line })
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'range' || key === 'parent') continue
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }

  visit(ast)

  return found
}

/**
 * Every `.js`, `.mjs` and `.jsx` file under a directory, tests left out.
 *
 * @param {string} root The directory.
 * @returns {string[]} The files, sorted.
 */
export function sourceFilesUnder(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue

      const full = path.join(dir, entry)

      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(?:m?js|jsx)$/u.test(entry) && !/\.(?:test|spec)\.m?jsx?$/u.test(entry)) {
        out.push(full)
      }
    }
  }

  walk(root)

  return out
}

/**
 * The readable strings under some directories that name the source site.
 *
 * @param {string[]} roots Directories.
 * @param {object} [options] Options.
 * @param {string} [options.relativeTo] What the places are written relative to.
 * @returns {string[]} Each as `file:line: text`.
 */
export function stringsNamingTheSource(roots, { relativeTo = process.cwd() } = {}) {
  const places = []

  for (const root of roots) {
    for (const file of sourceFilesUnder(root)) {
      for (const { text, line } of stringsOf(readFileSync(file, 'utf8'))) {
        if (SOURCE_NAME.test(text) && !isAllowedString(text)) {
          places.push(`${path.relative(relativeTo, file)}:${line}: ${text}`)
        }
      }
    }
  }

  return places
}

/**
 * Every string inside a value (an object, an array, a rendered payload) that
 * names the source site, with where it is.
 *
 * @param {unknown} value The value.
 * @param {string} [at] Where the value is.
 * @returns {string[]} Each as `path: text`.
 */
export function valuesNamingTheSource(value, at = '$') {
  if (typeof value === 'string') {
    return SOURCE_NAME.test(value) && !isAllowedString(value) ? [`${at}: ${value}`] : []
  }
  if (Array.isArray(value))
    return value.flatMap((item, i) => valuesNamingTheSource(item, `${at}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      valuesNamingTheSource(item, `${at}.${key}`),
    )
  }

  return []
}
