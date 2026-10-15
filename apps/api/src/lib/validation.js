/**
 * Zod as Fastify's validator and serializer.
 *
 * There is no hand-written JSON Schema anywhere in this application. Requests
 * are validated with the very Zod schemas that `@desi-event/api-contract`
 * renders into the OpenAPI document, so the documentation and the enforcement
 * cannot drift: they are the same object.
 *
 * Responses are serialised through the contract's response schemas too. That
 * is deliberate belt-and-braces — the schemas normalise `Date` columns to ISO
 * strings and strip unknown keys, which is what stops a `passwordHash` from
 * ever reaching a client because somebody widened a Prisma `select`.
 *
 * @module @desi-event/api/lib/validation
 */

import { ValidationError, formatIssuePath, formatIssues } from '@desi-event/schemas'

import { UNSTORABLE_CHARACTER_MESSAGE } from './errors.js'

/**
 * Human-readable names for the request parts, used in validation messages.
 *
 * @type {Readonly<Record<string, string>>}
 */
const PART_LABELS = Object.freeze({
  body: 'request body',
  querystring: 'query string',
  params: 'path parameters',
  headers: 'headers',
})

/** U+0000, the one character PostgreSQL stores in no text or JSON column. */
const NUL = '\u0000'

/**
 * Whether PostgreSQL can store a string as it was sent.
 *
 * Two things it cannot. A NUL, which every text column (22021) and every JSON
 * column (22P05) refuses. And a lone UTF-16 surrogate — U+D800 to U+DFFF
 * without its pair, which `JSON.parse` accepts from a `\ud800` escape: a
 * `jsonb` column refuses it outright (22P02, "invalid input syntax for type
 * json") and a text column quietly stores U+FFFD in its place, so what was
 * kept is not what was sent. A well-formed pair, an emoji, is fine.
 *
 * @param {string} text The string.
 * @returns {boolean} True when it holds neither.
 */
function isStorable(text) {
  return !text.includes(NUL) && text.isWellFormed()
}

/**
 * Whether a value is a plain object or an array: what a parsed request is made
 * of. A `Date` a schema coerced, or any other instance, is not walked.
 *
 * @param {unknown} value The value.
 * @returns {boolean} True for an array or a plain object.
 */
function isContainer(value) {
  if (Array.isArray(value)) return true
  if (value === null || typeof value !== 'object') return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * @typedef {object} WalkNode
 * @property {unknown} value The value at this point.
 * @property {string|number|null} key Its key in the parent, or null at the root.
 * @property {WalkNode|null} parent The node that holds it, or null at the root.
 */

/**
 * The path from the root to a node, as Zod spells an issue path.
 *
 * @param {WalkNode} node The node.
 * @returns {Array<string|number>} Its keys, outermost first.
 */
function pathTo(node) {
  /** @type {Array<string|number>} */
  const path = []

  for (let at = node; at && at.key !== null; at = at.parent) path.push(at.key)

  return path.reverse()
}

/**
 * Where the first character PostgreSQL cannot store — a NUL or a lone
 * surrogate (see `isStorable`) — is in a parsed request, if there is one.
 *
 * Walks every string value, and every key, of the value a handler is about to
 * receive. Iterative, and linear in the size of the value — each node keeps a
 * link to its parent and the path is built only for the one reported — so a
 * deeply nested free-form field can neither exhaust the stack nor turn the
 * walk quadratic. Such a character in a key is reported at the object that
 * holds it, so the issue path never carries the character back to the caller.
 *
 * @param {unknown} value The parsed request part.
 * @returns {Array<string|number>|null} The path to it, or null when there is none.
 */
export function findUnstorableCharacter(value) {
  /** @type {WalkNode[]} */
  const pending = [{ value, key: null, parent: null }]

  while (pending.length > 0) {
    const node = /** @type {WalkNode} */ (pending.pop())
    const current = node.value

    if (typeof current === 'string') {
      if (!isStorable(current)) return pathTo(node)
      continue
    }

    if (!isContainer(current)) continue

    /** @type {Array<Array<*>>} */
    const entries = Array.isArray(current)
      ? current.map((item, index) => [index, item])
      : Object.entries(/** @type {object} */ (current))

    if (entries.some(([key]) => typeof key === 'string' && !isStorable(key))) return pathTo(node)

    // Pushed in reverse, so the first offending field in document order is
    // the one reported.
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, item] = entries[index]

      pending.push({ value: item, key, parent: node })
    }
  }

  return null
}

/**
 * Build Fastify's validator compiler backed by Zod.
 *
 * Fastify's contract for a custom compiler is to return `{ value }` or
 * `{ error }`; a *thrown* error is re-labelled as a 500 by Fastify, which is
 * why the failure path returns rather than throws. The returned
 * `ValidationError` is an `Error`, so Fastify passes it through to the error
 * handler untouched with its 400 status and its issue list intact.
 *
 * A request that satisfies its schema is then refused if any string in it
 * carries a NUL or a lone surrogate. PostgreSQL stores a NUL in no text column
 * (22021) and no JSON column (22P05), and a lone surrogate in no JSON column
 * (22P02); free text reaches JSON by many roads — an event page's content, a
 * change notice's reason, an audit row's metadata, an import's dataset. A
 * refusal here is one rule for every route, present and future, made before
 * a handler has written anything, and it names the field. The schema runs
 * first, so a field that refuses control characters itself
 * (`withoutControlCharacters`) keeps its own message.
 *
 * @param {{schema: {safeParse: Function}, httpPart?: string}} args Fastify compiler arguments.
 * @returns {function(*): object} The compiled validator.
 */
export function zodValidatorCompiler({ schema, httpPart }) {
  const label = PART_LABELS[httpPart ?? ''] ?? 'request'

  return (data) => {
    const result = schema.safeParse(data)

    if (!result.success) {
      return {
        error: new ValidationError(`Invalid ${label}`, formatIssues(result.error), {
          cause: result.error,
        }),
      }
    }

    const unstorable = findUnstorableCharacter(result.data)

    if (unstorable) {
      return {
        error: new ValidationError(`Invalid ${label}`, [
          {
            path: formatIssuePath(unstorable),
            code: 'custom',
            message: UNSTORABLE_CHARACTER_MESSAGE,
          },
        ]),
      }
    }

    return { value: result.data }
  }
}

/**
 * Build Fastify's serializer compiler backed by Zod.
 *
 * A response that does not satisfy its contract is a server bug, not a client
 * one, so the failure is raised as a 500 carrying a dedicated code rather than
 * being sent to the caller as a 400.
 *
 * @param {{schema: {safeParse: Function}}} args Fastify compiler arguments.
 * @returns {function(*): string} The compiled serializer.
 */
export function zodSerializerCompiler({ schema }) {
  return (payload) => {
    const result = schema.safeParse(payload)

    if (result.success) return JSON.stringify(result.data)

    const issues = formatIssues(result.error)
    const summary = issues.map((issue) => `${issue.path || '<root>'}: ${issue.message}`).join('; ')
    const error = new Error(`Response does not match its contract (${summary})`)

    Object.assign(error, { statusCode: 500, code: 'RESPONSE_SERIALIZATION_ERROR', issues })

    throw error
  }
}

/**
 * Translate a contract route descriptor into a Fastify route schema.
 *
 * Only the parts Fastify understands are copied across; the prose (summary,
 * description, tags) lives in the OpenAPI document, which is generated from
 * the same descriptor by `buildOpenApiDocument`.
 *
 * The response schema is registered against the route's declared success
 * status only. Error bodies are produced by the error handler and serialised
 * with plain `JSON.stringify`, so a failing request can never be blocked by
 * the success schema.
 *
 * @param {object} route A descriptor from `@desi-event/api-contract`.
 * @param {object} [options] Behaviour switches.
 * @param {boolean} [options.validateResponse] Whether to attach the response schema. Defaults to true.
 * @returns {object} A Fastify route `schema` object.
 */
export function routeSchema(route, options = {}) {
  const { validateResponse = true } = options

  /** @type {Record<string, unknown>} */
  const schema = {}

  if (route.params) schema.params = route.params
  if (route.query) schema.querystring = route.query
  if (route.body) schema.body = route.body
  // A route that produces something other than JSON has no response schema to
  // enforce: the serialiser would try to validate a CSV document against an
  // object schema and refuse it. The contract still carries the column allow
  // list for that route — see `csvColumns` — and the handler is what applies it,
  // so "the response is an allow list" stays true by a different mechanism.
  if (validateResponse && route.response && !route.produces) {
    schema.response = { [route.successStatus]: route.response }
  }

  return schema
}
