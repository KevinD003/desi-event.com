/**
 * Read the application's own source for the writes a rule allows in one place.
 *
 * SPEC2 §6 pins three things to a single owner each: which code creates event
 * rows (and that it creates drafts), which code moves the website switch, and
 * which code touches the raw visit rows. A test of one route cannot say that no
 * *other* route does the same thing; a scan of the source can, and it fails on
 * the day somebody adds the second writer, which is the only day the fix is
 * cheap.
 *
 * This is a reader of JavaScript text, not a parser, and it says so in what it
 * promises:
 *
 *   - **Comments are blanked** before anything is matched, so a docstring that
 *     mentions `prisma.event.create(` is not a call site. Strings are kept,
 *     because raw SQL lives in template literals.
 *   - **A Prisma write** is `.<model>.<op>(` (or `['<model>'].<op>(`) for
 *     `create`, `createMany`, `createManyAndReturn`, `update`, `updateMany` or
 *     `upsert`, with its argument list taken by balanced brackets that skip
 *     strings, template literals and comments. The columns it writes are the
 *     keys named inside its `data`, `create` and `update` objects, read as
 *     object literals entry by entry. `where` and `select` are reads and are
 *     never looked at.
 *   - **A row built elsewhere** is reported as opaque rather than guessed at:
 *     `data: stampsFor(…)`, `data: rows`, the shorthand `{ where, data }`, a
 *     spread (`data: { ...body }`), a computed key, or an argument that is not
 *     an object literal at all (`update(params)`). The rules in
 *     security-regression collect every opaque write to a model they guard and
 *     hold it to an explicit allow-list, so a new one fails until it is read.
 *   - **A nested write** is the same thing one relation down:
 *     `organization.update({ data: { events: { create: … } } })` writes event
 *     rows. Relations are read from `schema.prisma`, so a JSON column that
 *     happens to hold a key called `event` is not mistaken for one, and a
 *     relation is followed through as many levels as the write nests.
 *   - **A raw write** is `UPDATE`, `INSERT INTO`, `DELETE FROM` or `MERGE INTO`
 *     a quoted table (optionally `ONLY`, optionally schema-qualified). Prisma's
 *     tables are mixed-case, so an unquoted name would be a different table
 *     PostgreSQL does not have. The statement is read to the end of the string
 *     or template holding it, and a column is named with or without quotes, in
 *     any case.
 *
 * What it does not see, said plainly: a delegate held in a variable
 * (`const events = tx.event; events.update(…)`), SQL assembled from several
 * strings or `Prisma.sql` fragments, and code reached through `eval`. No write
 * of these shapes exists in the application today (its only `Prisma.sql`
 * fragments are the facet counts, which read); the next reviewer should still
 * look.
 *
 * Scans cover `apps/<app>/src` (SPEC2-XI O17) and, where a rule names a package
 * as an owner, `packages/<package>/src`. Seeds, verifiers, scripts and e2e
 * helpers insert rows directly on purpose and are outside every scan, as are
 * test files.
 *
 * @module @desi-event/api/tests/helpers/source-scan
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository root. */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** The Prisma operations that write rows. */
export const WRITE_OPERATIONS = Object.freeze([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
])

/**
 * The operations a relation field takes that write the related rows' columns.
 * `connect`, `set`, `disconnect` and the deletes move or remove rows without
 * naming a column, so they are not here.
 */
export const NESTED_WRITE_OPERATIONS = Object.freeze([
  'create',
  'createMany',
  'connectOrCreate',
  'update',
  'updateMany',
  'upsert',
])

/** The keys of a top-level write argument that hold the row written. */
const ROW_KEYS = Object.freeze(['data', 'create', 'update'])

/** Extensions of the modules an app or a package is built from. */
const SOURCE_EXTENSIONS = /\.(c|m)?jsx?$/u

/** Test files, wherever they sit: not application code. */
const TEST_FILE = /\.(test|spec)\.(c|m)?jsx?$/u

/**
 * Every source file of the apps (and, when asked, the packages), repo-relative
 * with forward slashes.
 *
 * @param {object} [options] Options.
 * @param {boolean} [options.packages] Include `packages/<name>/src` as well.
 * @returns {string[]} The files, sorted.
 */
export function sourceFiles({ packages = false } = {}) {
  const roots = ['apps', ...(packages ? ['packages'] : [])]
  /** @type {string[]} */
  const found = []

  /**
   * @param {string} directory An absolute directory.
   * @returns {void}
   */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue

      const path = join(directory, entry.name)

      if (entry.isDirectory()) walk(path)
      else if (SOURCE_EXTENSIONS.test(entry.name) && !TEST_FILE.test(entry.name)) {
        found.push(relative(REPO_ROOT, path).split(sep).join('/'))
      }
    }
  }

  for (const root of roots) {
    for (const entry of readdirSync(join(REPO_ROOT, root), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue

      const src = join(REPO_ROOT, root, entry.name, 'src')

      try {
        walk(src)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  }

  return found.sort()
}

/**
 * A file's text with its comments blanked, keeping every other character in
 * place so an index into one is an index into the other.
 *
 * @param {string} source The module's text.
 * @returns {string} The text with comments replaced by spaces (newlines kept).
 */
export function withoutComments(source) {
  let out = ''
  let index = 0

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        out += ' '
        index += 1
      }
      continue
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2

      for (; index < stop; index += 1) out += source[index] === '\n' ? '\n' : ' '
      continue
    }

    const literal = literalEnd(source, index)

    if (literal !== -1) {
      out += source.slice(index, literal)
      index = literal
      continue
    }

    out += char
    index += 1
  }

  return out
}

/** Words after which a `/` starts a regular expression rather than dividing. */
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'void',
  'delete',
  'throw',
  'new',
  'yield',
  'await',
  'else',
  'do',
])

/**
 * Whether the `/` at `index` opens a regular-expression literal.
 *
 * Decided by what comes before it, as a tokenizer would: after an operator,
 * an opening bracket, a comma, a colon or a keyword it is a regex; after a
 * name, a number or a closing bracket it is a division.
 *
 * @param {string} text The text.
 * @param {number} index Where the `/` is.
 * @returns {boolean} True for a regex.
 */
function opensRegex(text, index) {
  let at = index - 1

  while (at >= 0 && /\s/u.test(text[at])) at -= 1
  if (at < 0) return true

  const before = text[at]

  if ('(,=:[!&|?{};+-*%<>~^'.includes(before)) return true

  if (/[\w$]/u.test(before)) {
    let start = at

    while (start > 0 && /[\w$]/u.test(text[start - 1])) start -= 1

    return REGEX_AFTER_WORD.has(text.slice(start, at + 1))
  }

  return false
}

/**
 * The index just past a regular-expression literal starting at `start`.
 *
 * @param {string} text The text.
 * @param {number} start Where the opening `/` is.
 * @returns {number} The index after its flags.
 */
function skipRegex(text, start) {
  let index = start + 1
  let inClass = false

  while (index < text.length) {
    const char = text[index]

    if (char === '\\') {
      index += 2
      continue
    }

    if (char === '\n') return index
    if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) {
      index += 1
      while (index < text.length && /[a-z]/u.test(text[index])) index += 1

      return index
    }

    index += 1
  }

  return text.length
}

/**
 * Where a string, template or regex literal starting at `index` ends, or -1
 * when none starts there.
 *
 * @param {string} text The text.
 * @param {number} index The index.
 * @returns {number} The index after the literal, or -1.
 */
function literalEnd(text, index) {
  const char = text[index]

  if (char === "'" || char === '"' || char === '`') return skipString(text, index)

  if (
    char === '/' &&
    text[index + 1] !== '/' &&
    text[index + 1] !== '*' &&
    opensRegex(text, index)
  ) {
    return skipRegex(text, index)
  }

  return -1
}

/**
 * The index just past a string or template literal that starts at `start`.
 *
 * Template substitutions are followed with their own bracket depth, so a
 * template holding `${ a ? 'x' : "y" }` ends where it really ends.
 *
 * @param {string} text The text.
 * @param {number} start Where the opening quote is.
 * @returns {number} The index after the closing quote.
 */
function skipString(text, start) {
  const quote = text[start]
  let index = start + 1

  while (index < text.length) {
    const char = text[index]

    if (char === '\\') {
      index += 2
      continue
    }

    if (char === quote) return index + 1

    if (quote === '`' && char === '$' && text[index + 1] === '{') {
      index = balancedEnd(text, index + 1) + 1
      continue
    }

    index += 1
  }

  return text.length
}

/**
 * The index of the bracket that closes the one at `open`.
 *
 * @param {string} text The text, comments already blanked or not.
 * @param {number} open Index of `(`, `{` or `[`.
 * @returns {number} Index of the matching closer, or the end of the text.
 */
export function balancedEnd(text, open) {
  let depth = 0
  let index = open

  while (index < text.length) {
    const char = text[index]
    const literal = literalEnd(text, index)

    if (literal !== -1) {
      index = literal
      continue
    }

    if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index)

      index = end === -1 ? text.length : end
      continue
    }

    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)

      index = end === -1 ? text.length : end + 2
      continue
    }

    if (char === '(' || char === '{' || char === '[') depth += 1

    if (char === ')' || char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) return index
    }

    index += 1
  }

  return text.length
}

/**
 * The 1-based line an index falls on.
 *
 * @param {string} text The text.
 * @param {number} index The index.
 * @returns {number} The line.
 */
export function lineOf(text, index) {
  let line = 1

  for (let at = 0; at < index; at += 1) if (text[at] === '\n') line += 1

  return line
}

/**
 * Every call of a Prisma delegate operation on one model.
 *
 * Both `tx.event.update(` and `tx['event'].update(` are calls.
 *
 * @param {string} code The text, comments blanked.
 * @param {string} model The delegate name (`event`, `trafficEvent`, …), or a
 *   pattern for several (`[a-z][A-Za-z]*`) with no capturing group of its own.
 * @param {string[]} [operations] Which operations; every one when omitted.
 * @returns {Array<{model: string, operation: string, index: number, line: number, args: string}>} The calls.
 */
export function delegateCalls(code, model, operations) {
  const pattern = new RegExp(
    `(?:\\.\\s*(${model})|\\[\\s*['"\`](${model})['"\`]\\s*\\])\\s*\\.\\s*([A-Za-z]+)\\s*\\(`,
    'gu',
  )
  /** @type {Array<{model: string, operation: string, index: number, line: number, args: string}>} */
  const calls = []

  for (const match of code.matchAll(pattern)) {
    const operation = match[3]

    if (operations && !operations.includes(operation)) continue

    const open = match.index + match[0].length - 1
    const close = balancedEnd(code, open)

    calls.push({
      model: match[1] ?? match[2],
      operation,
      index: match.index,
      line: lineOf(code, match.index),
      args: code.slice(open + 1, close),
    })
  }

  return calls
}

/**
 * The index of the first character at or after `index` that is not space.
 *
 * @param {string} text The text.
 * @param {number} index Where to start.
 * @returns {number} The index.
 */
function skipSpace(text, index) {
  let at = index

  while (at < text.length && /\s/u.test(text[at])) at += 1

  return at
}

/**
 * Where an expression that starts at `start` ends: at the next comma at its
 * own depth, or at `stop`. Strings, templates, regular expressions and
 * brackets are stepped over whole.
 *
 * @param {string} text The text.
 * @param {number} start Where the expression starts.
 * @param {number} stop The index of the enclosing closer.
 * @returns {number} The index of the comma, or `stop`.
 */
function expressionEnd(text, start, stop) {
  let index = start

  while (index < stop) {
    const literal = literalEnd(text, index)

    if (literal !== -1) {
      index = literal
      continue
    }

    const char = text[index]

    if (char === '(' || char === '[' || char === '{') {
      index = balancedEnd(text, index) + 1
      continue
    }

    if (char === ',') return index

    index += 1
  }

  return stop
}

/**
 * Where each element of the array literal whose `[` is at `open` starts.
 *
 * @param {string} text The text.
 * @param {number} open Index of the `[`.
 * @returns {number[]} The elements' first characters.
 */
function arrayElements(text, open) {
  const close = balancedEnd(text, open)
  /** @type {number[]} */
  const starts = []
  let index = open + 1

  while (index < close) {
    index = skipSpace(text, index)

    if (index >= close) break

    if (text[index] === ',') {
      index += 1
      continue
    }

    starts.push(index)
    index = expressionEnd(text, index, close) + 1
  }

  return starts
}

/** A property's key at the start of an entry: quoted, a name or a number. */
const ENTRY_KEY = /^(?:(['"])((?:\\.|(?!\1)[^\\])*)\1|([A-Za-z_$][\w$]*|\d+))\s*(:)?/u

/**
 * The entries of the object literal whose `{` is at `open`, at its own depth.
 *
 * Each is a `property` (`key: value`), a `shorthand` (`key`), a `spread`
 * (`...value`), a `computed` key (`[k]: value`) or a `method`. `start` is
 * where its value begins: the operand of a spread, the value of a property.
 *
 * @param {string} text The text.
 * @param {number} open Index of the `{`.
 * @returns {Array<{key: string|null, kind: 'property'|'shorthand'|'spread'|'computed'|'method', start: number, end: number}>} The entries.
 */
export function objectEntries(text, open) {
  const close = balancedEnd(text, open)
  /** @type {Array<{key: string|null, kind: 'property'|'shorthand'|'spread'|'computed'|'method', start: number, end: number}>} */
  const entries = []
  let index = open + 1

  while (index < close) {
    index = skipSpace(text, index)

    if (index >= close) break

    if (text[index] === ',') {
      index += 1
      continue
    }

    const end = expressionEnd(text, index, close)
    const entry = text.slice(index, end)

    if (entry.startsWith('...')) {
      entries.push({ key: null, kind: 'spread', start: index + 3, end })
    } else if (entry.startsWith('[')) {
      entries.push({ key: null, kind: 'computed', start: index, end })
    } else {
      const key = ENTRY_KEY.exec(entry)

      if (key?.[4]) {
        entries.push({
          key: key[2] ?? key[3],
          kind: 'property',
          start: skipSpace(text, index + key[0].length),
          end,
        })
      } else if (key && entry.trim() === key[0].trim()) {
        entries.push({ key: key[2] ?? key[3], kind: 'shorthand', start: index, end })
      } else {
        entries.push({ key: key ? (key[2] ?? key[3]) : null, kind: 'method', start: index, end })
      }
    }

    index = end + 1
  }

  return entries
}

/**
 * Add the keys of the row whose `{` is at `open` to `sink`, at any depth below
 * it too (a relation write nests its rows; a JSON column nests its document).
 * A spread, a computed key or a method anywhere in it makes it opaque.
 *
 * @param {string} text The text.
 * @param {number} open Index of the `{`.
 * @param {{fields: Set<string>, opaque: boolean}} sink What has been found.
 * @returns {void}
 */
function collectRow(text, open, sink) {
  for (const entry of objectEntries(text, open)) {
    if (entry.kind !== 'property' && entry.kind !== 'shorthand') {
      sink.opaque = true
      continue
    }

    sink.fields.add(entry.key)

    if (entry.kind === 'shorthand') continue

    if (text[entry.start] === '{') collectRow(text, entry.start, sink)
    else if (text[entry.start] === '[') {
      for (const element of arrayElements(text, entry.start)) {
        if (text[element] === '{') collectRow(text, element, sink)
      }
    }
  }
}

/**
 * The rows a value in row position holds: an object literal is one, an array
 * literal holds one per element, and anything else is built elsewhere.
 *
 * @param {string} text The text.
 * @param {number} start Where the value starts.
 * @param {number[]} rows The `{` of each row found.
 * @returns {boolean} True when part of it is opaque.
 */
function rowsAt(text, start, rows) {
  const at = skipSpace(text, start)

  if (text[at] === '{') {
    rows.push(at)
    return false
  }

  if (text[at] !== '[') return true

  let opaque = false

  for (const element of arrayElements(text, at)) {
    if (text[element] === '{') rows.push(element)
    else opaque = true
  }

  return opaque
}

/**
 * The rows a write's argument writes: the values of its `data`, `create` and
 * `update` keys.
 *
 * @param {string} args The text between the call's brackets.
 * @returns {{rows: number[], opaque: boolean}} Each row's `{`, and whether any is built elsewhere.
 */
function argumentRows(args) {
  /** @type {number[]} */
  const rows = []
  const at = skipSpace(args, 0)

  // `update(params)`: the whole argument is built elsewhere.
  if (args[at] !== '{') return { rows, opaque: true }

  let opaque = false

  for (const entry of objectEntries(args, at)) {
    if (entry.kind === 'spread' || entry.kind === 'computed') opaque = true
    else if (ROW_KEYS.includes(entry.key)) {
      // `{ where, data }` names a row built elsewhere.
      if (entry.kind === 'property') opaque = rowsAt(args, entry.start, rows) || opaque
      else opaque = true
    }
  }

  return { rows, opaque }
}

/**
 * What a Prisma write's arguments write.
 *
 * The keys named in its `data`, `create` and `update` objects, at any depth
 * (a relation write nests), plus whether any part of the row is an expression
 * this reader cannot see into: a name, a call, a shorthand `data`, a spread,
 * a computed key, or an argument that is not an object literal.
 *
 * @param {string} args The text between the call's brackets.
 * @returns {{fields: Set<string>, opaque: boolean}} The written keys.
 */
export function writtenFields(args) {
  const { rows, opaque } = argumentRows(args)
  const sink = { fields: new Set(), opaque }

  for (const row of rows) collectRow(args, row, sink)

  return sink
}

/** @type {Map<string, Map<string, string>>|null} */
let models = null

/**
 * Every model in `schema.prisma`, with each field's type.
 *
 * @returns {Map<string, Map<string, string>>} Model name to field name to type name.
 */
export function prismaModels() {
  if (models) return models

  const schema = readFileSync(join(REPO_ROOT, 'packages/db/prisma/schema.prisma'), 'utf8')

  models = new Map()

  for (const block of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gmu)) {
    const fields = new Map()

    for (const line of block[2].split('\n')) {
      const field = /^\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)/u.exec(line)

      if (field) fields.set(field[1], field[2])
    }

    models.set(block[1], fields)
  }

  return models
}

/**
 * The relation fields, on any model, whose type is `model`.
 *
 * @param {string} model The model (`TrafficEvent`).
 * @returns {string[]} The field names, sorted and unique.
 */
export function relationsTo(model) {
  const names = new Set()

  for (const fields of prismaModels().values()) {
    for (const [name, type] of fields) if (type === model) names.add(name)
  }

  return [...names].sort()
}

/**
 * The rows one nested operation writes.
 *
 * `create` takes the rows; `createMany` takes them under `data`;
 * `connectOrCreate` under `create`; `upsert` under `create` and `update`;
 * `update` and `updateMany` under `data`, except a to-one `update`, which may
 * take the row itself. Each may be an array of the same.
 *
 * @param {string} text The text.
 * @param {string} operation The nested operation.
 * @param {number} start Where its value starts.
 * @returns {{rows: number[], opaque: boolean}} Each row's `{`, and whether any is built elsewhere.
 */
function nestedRows(text, operation, start) {
  /** @type {number[]} */
  const rows = []

  if (operation === 'create') return { rows, opaque: rowsAt(text, start, rows) }

  const keys = {
    createMany: ['data'],
    connectOrCreate: ['create'],
    upsert: ['create', 'update'],
  }[operation] ?? ['data']
  let opaque = false

  /**
   * @param {number} at Where one argument of the operation starts.
   * @returns {void}
   */
  const unwrap = (at) => {
    const value = skipSpace(text, at)

    if (text[value] === '[') {
      for (const element of arrayElements(text, value)) unwrap(element)
      return
    }

    if (text[value] !== '{') {
      opaque = true
      return
    }

    const entries = objectEntries(text, value)
    const held = entries.filter((entry) => keys.includes(entry.key))

    if (entries.some((entry) => entry.kind === 'spread' || entry.kind === 'computed')) {
      opaque = true
    }

    if (held.length === 0 && operation === 'update') {
      rows.push(value)
      return
    }

    for (const entry of held) {
      if (entry.kind === 'property') opaque = rowsAt(text, entry.start, rows) || opaque
      else opaque = true
    }
  }

  unwrap(start)

  return { rows, opaque }
}

/**
 * The writes a call makes to one model's rows through relation fields: every
 * nested operation, at any depth, on a relation whose type is `target`.
 *
 * @param {string} args The text between the call's brackets.
 * @param {string} from The model the call is on (`Organization`).
 * @param {string} target The model written to (`Event`).
 * @returns {Array<{path: string, operation: string|null, fields: Set<string>, opaque: boolean, args: string}>}
 *   The writes. `path` is the relations followed (`events`,
 *   `organization.update.events`); `operation` is null when the relation's
 *   value is itself built elsewhere.
 */
export function nestedWrites(args, from, target) {
  const schema = prismaModels()
  /** @type {Array<{path: string, operation: string|null, fields: Set<string>, opaque: boolean, args: string}>} */
  const found = []

  if (!schema.has(from)) return found

  /**
   * @param {number} row The `{` of a row of `model`.
   * @param {string} model The row's model.
   * @param {string} path The relations followed to reach it.
   * @returns {void}
   */
  const visit = (row, model, path) => {
    for (const entry of objectEntries(args, row)) {
      const type = schema.get(model)?.get(entry.key)

      // A scalar, an enum or a JSON column: not a relation, never a nested write.
      if (!type || !schema.has(type)) continue

      const relation = `${path}${entry.key}`

      if (entry.kind !== 'property' || args[entry.start] !== '{') {
        if (type === target) {
          found.push({ path: relation, operation: null, fields: new Set(), opaque: true, args: '' })
        }
        continue
      }

      for (const operation of objectEntries(args, entry.start)) {
        if (operation.kind === 'spread' || operation.kind === 'computed') {
          if (type === target) {
            found.push({
              path: relation,
              operation: null,
              fields: new Set(),
              opaque: true,
              args: args.slice(operation.start, operation.end),
            })
          }
          continue
        }

        if (!NESTED_WRITE_OPERATIONS.includes(operation.key)) continue

        const { rows, opaque } =
          operation.kind === 'property'
            ? nestedRows(args, operation.key, operation.start)
            : { rows: [], opaque: true }

        if (type === target) {
          const sink = { fields: new Set(), opaque }

          for (const nested of rows) collectRow(args, nested, sink)

          found.push({
            path: relation,
            operation: operation.key,
            ...sink,
            args: args.slice(operation.start, operation.end),
          })
        }

        for (const nested of rows) visit(nested, type, `${relation}.${operation.key}.`)
      }
    }
  }

  for (const row of argumentRows(args).rows) visit(row, from, '')

  return found
}

/**
 * Every write to one model's rows in a file: the calls on its own delegate,
 * and the nested writes any other write makes to it through a relation.
 *
 * @param {string} code The text, comments blanked.
 * @param {string} model The model (`Event`, `TrafficEvent`).
 * @returns {Array<{operation: string|null, via: string|null, index: number, line: number, args: string, fields: Set<string>, opaque: boolean}>}
 *   The writes. `via` is null for a call on the model's own delegate, and the
 *   delegate and relations followed (`organization.events`) for a nested one.
 */
export function writesTo(code, model) {
  const delegate = `${model[0].toLowerCase()}${model.slice(1)}`
  const writes = delegateCalls(code, delegate, WRITE_OPERATIONS).map((call) => ({
    operation: call.operation,
    via: null,
    index: call.index,
    line: call.line,
    args: call.args,
    ...writtenFields(call.args),
  }))

  for (const call of delegateCalls(code, '[a-z][A-Za-z]*', WRITE_OPERATIONS)) {
    const from = `${call.model[0].toUpperCase()}${call.model.slice(1)}`

    for (const nested of nestedWrites(call.args, from, model)) {
      writes.push({
        operation: nested.operation,
        via: `${call.model}.${nested.path}`,
        index: call.index,
        line: call.line,
        args: nested.args,
        fields: nested.fields,
        opaque: nested.opaque,
      })
    }
  }

  return writes.sort((a, b) => a.index - b.index)
}

/**
 * Whether a raw statement names a column: with or without quotes, in any
 * case, as PostgreSQL would accept it.
 *
 * @param {string} statement The statement's text.
 * @param {string} column The column.
 * @returns {boolean} True when it is named.
 */
export function namesColumn(statement, column) {
  return new RegExp(`(?<![\\w$])"?${column}"?(?![\\w$])`, 'iu').test(statement)
}

/**
 * Where the string or template literal holding `index` ends, or -1.
 *
 * @param {string} code The text, comments blanked.
 * @param {number} index An index inside the literal.
 * @returns {number} The index after its closing quote, or -1.
 */
function enclosingLiteralEnd(code, index) {
  let at = 0

  while (at <= index && at < code.length) {
    const end = literalEnd(code, at)

    if (end === -1) {
      at += 1
      continue
    }

    if (index < end) return end

    at = end
  }

  return -1
}

/**
 * Raw SQL writes in a file: `UPDATE`, `INSERT INTO`, `DELETE FROM` or
 * `MERGE INTO` a quoted table, optionally `ONLY` and optionally
 * schema-qualified (`public."Event"`), with the statement's text from the verb
 * to the end of the string or template holding it (where the columns are
 * named). Test the columns with {@link namesColumn}.
 *
 * @param {string} code The text, comments blanked.
 * @returns {Array<{verb: string, table: string, line: number, text: string}>} The writes.
 */
export function rawWrites(code) {
  /** @type {Array<{verb: string, table: string, line: number, text: string}>} */
  const writes = []
  const pattern =
    /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|MERGE\s+INTO)(?:\s+ONLY)?\s+(?:(?:"\w+"|\w+)\s*\.\s*)?"(\w+)"/giu

  for (const match of code.matchAll(pattern)) {
    const end = enclosingLiteralEnd(code, match.index)

    writes.push({
      verb: match[1].toUpperCase().replace(/\s+/gu, ' '),
      table: match[2],
      line: lineOf(code, match.index),
      text: code.slice(match.index, end === -1 ? match.index + 800 : end),
    })
  }

  return writes
}

/**
 * Every raw SQL call in a file: `$queryRaw`, `$executeRaw` and their `Unsafe`
 * twins, on any client.
 *
 * A tagged call (`` tx.$queryRaw`SELECT …` ``) binds every `${…}` as a
 * parameter; a call with brackets (`$queryRaw(Prisma.sql`…`)`, or an
 * `Unsafe` one with a string) is reported with `tagged: false` and its
 * argument text, so a rule can tell the two apart. `text` is the template's
 * text, quotes included, or the bracketed argument.
 *
 * @param {string} code The text, comments blanked.
 * @returns {Array<{method: string, unsafe: boolean, tagged: boolean, line: number, text: string}>} The calls, in source order.
 */
export function rawCalls(code) {
  /** @type {Array<{method: string, unsafe: boolean, tagged: boolean, line: number, text: string}>} */
  const calls = []

  for (const match of code.matchAll(/\$(queryRaw|executeRaw)(Unsafe)?\b/gu)) {
    let at = match.index + match[0].length

    while (at < code.length && /\s/u.test(code[at])) at += 1

    const tagged = code[at] === '`'
    const end = tagged ? skipString(code, at) : code[at] === '(' ? balancedEnd(code, at) + 1 : at

    calls.push({
      method: match[1],
      unsafe: Boolean(match[2]),
      tagged,
      line: lineOf(code, match.index),
      text: code.slice(at, end),
    })
  }

  return calls
}

/** A row lock in a raw statement: the table, and how strongly it is held. */
const ROW_LOCK = /\bFROM\s+"(\w+)"[\s\S]*?\bFOR\s+(NO\s+KEY\s+UPDATE|KEY\s+SHARE|UPDATE|SHARE)\b/u

/**
 * The row lock a raw statement takes, if it takes one: `SELECT … FROM
 * "<Table>" … FOR UPDATE | NO KEY UPDATE | SHARE | KEY SHARE`.
 *
 * @param {string} statement A raw call's text.
 * @returns {{table: string, strength: string}|null} The lock, or null for none.
 */
export function rowLockOf(statement) {
  const match = ROW_LOCK.exec(statement)

  return match ? { table: match[1], strength: match[2].replace(/\s+/gu, ' ') } : null
}

/**
 * Every `defineRoute(app, '<id>', …)` registration in a file, with the text of
 * its options (handler included).
 *
 * @param {string} code The text, comments blanked.
 * @returns {Array<{id: string, line: number, body: string}>} The registrations.
 */
export function routeRegistrations(code) {
  /** @type {Array<{id: string, line: number, body: string}>} */
  const routes = []

  for (const match of code.matchAll(/defineRoute\(\s*app\s*,\s*'([^']+)'/gu)) {
    const open = match.index + 'defineRoute'.length

    routes.push({
      id: match[1],
      line: lineOf(code, match.index),
      body: code.slice(open, balancedEnd(code, open) + 1),
    })
  }

  return routes
}

/**
 * The text of a named function's body in a file, and where it sits.
 *
 * Finds `function name(` (optionally `async` and `export`), then the body's
 * braces.
 *
 * @param {string} code The text, comments blanked.
 * @param {string} name The function's name.
 * @returns {{start: number, end: number}|null} The body's range, or null.
 */
export function functionRange(code, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`, 'u').exec(code)

  if (!match) return null

  const paramsOpen = match.index + match[0].length - 1
  const bodyOpen = code.indexOf('{', balancedEnd(code, paramsOpen))

  return { start: bodyOpen, end: balancedEnd(code, bodyOpen) }
}

/**
 * Read a repo-relative file with its comments blanked.
 *
 * @param {string} file A repo-relative path.
 * @returns {string} The text.
 */
export function readCode(file) {
  return withoutComments(readFileSync(join(REPO_ROOT, file), 'utf8'))
}

/**
 * Where every `{` outside a string, template or regular expression is.
 *
 * Each may open an object literal or a block; {@link objectEntries} reads
 * either, and a block's statements never come out as `key: value` properties.
 * A brace inside a template's `${…}` is not visited: an object built inside a
 * template substitution is not where this application writes a filter.
 *
 * @param {string} code The text, comments blanked.
 * @returns {number[]} The index of each `{`.
 */
export function braceStarts(code) {
  /** @type {number[]} */
  const starts = []
  let index = 0

  while (index < code.length) {
    const literal = literalEnd(code, index)

    if (literal !== -1) {
      index = literal
      continue
    }

    if (code[index] === '{') starts.push(index)
    index += 1
  }

  return starts
}

/** The Prisma string filters that run as `LIKE`. */
export const PATTERN_FILTER_KEYS = Object.freeze(['contains', 'startsWith', 'endsWith'])

/**
 * Every value a file hands to a Prisma string filter that PostgreSQL runs as a
 * pattern: `contains`, `startsWith` and `endsWith` (`LIKE`), and an `equals`
 * beside `mode: 'insensitive'` (`ILIKE`).
 *
 * Prisma passes the value through without escaping `_`, `%` or `\`, so a value
 * a person typed matches more than they typed unless `likeLiteral` escaped it
 * first. The value is reported as written (`likeLiteral(q)`, `term`,
 * `` `@${DOMAIN}` ``); a shorthand (`{ contains }`) is reported by its name.
 * What it does not see: a filter spread in from elsewhere (`{ ...filter }`) or
 * built inside a template substitution.
 *
 * @param {string} code The text, comments blanked.
 * @returns {Array<{key: string, value: string, line: number}>} The filters, in source order.
 */
export function patternFilters(code) {
  /** @type {Array<{key: string, value: string, line: number}>} */
  const found = []

  for (const open of braceStarts(code)) {
    const entries = objectEntries(code, open)
    const valueOf = (entry) =>
      entry.kind === 'shorthand' ? entry.key : code.slice(entry.start, entry.end).trim()
    const insensitive = entries.some(
      (entry) =>
        entry.key === 'mode' &&
        entry.kind === 'property' &&
        /^['"`]insensitive['"`]$/u.test(valueOf(entry)),
    )

    for (const entry of entries) {
      if (entry.kind !== 'property' && entry.kind !== 'shorthand') continue

      const key = PATTERN_FILTER_KEYS.includes(entry.key)
        ? entry.key
        : entry.key === 'equals' && insensitive
          ? 'equals (insensitive)'
          : null

      if (key) found.push({ key, value: valueOf(entry), line: lineOf(code, entry.start) })
    }
  }

  return found.sort((a, b) => a.line - b.line)
}

/**
 * Every module a file loads: static `import … from`, a bare `import '…'`,
 * `export … from`, a literal `import('…')` and a literal `require('…')`, with
 * the names a static import binds (`null` for a namespace, a default import,
 * a re-export, a dynamic import or a require, each of which takes the module
 * whole).
 *
 * @param {string} code The text, comments blanked.
 * @returns {Array<{specifier: string, names: string[]|null, line: number}>} The loads.
 */
export function moduleLoads(code) {
  /** @type {Array<{specifier: string, names: string[]|null, line: number}>} */
  const loads = []
  const statics =
    /(?:^|[\n;])\s*(import|export)\s*([\w$*{},\s]*?)\s*(?:\bfrom\s*)?(['"])([^'"\n]+)\3/gu
  const calls = /(?<![\w$.])(?:import|require)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/gu

  for (const match of code.matchAll(statics)) {
    const [, verb, clause, , specifier] = match
    const named = /^\{([^}]*)\}$/u.exec(clause.trim())
    const names =
      verb === 'import' && named
        ? named[1]
            .split(',')
            .map((part) => part.trim().split(/\s+as\s+/u)[0])
            .filter(Boolean)
        : verb === 'import' && clause.trim() === ''
          ? []
          : null

    // The match starts at the whitespace before the keyword; the line is the keyword's.
    const at = match.index + match[0].search(/\b(?:import|export)\b/u)

    loads.push({ specifier, names, line: lineOf(code, at) })
  }

  for (const match of code.matchAll(calls)) {
    loads.push({ specifier: match[2], names: null, line: lineOf(code, match.index) })
  }

  return loads.sort((a, b) => a.line - b.line)
}
