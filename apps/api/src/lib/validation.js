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

import { ValidationError, formatIssues } from '@desi-event/schemas'

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

/**
 * Build Fastify's validator compiler backed by Zod.
 *
 * Fastify's contract for a custom compiler is to return `{ value }` or
 * `{ error }`; a *thrown* error is re-labelled as a 500 by Fastify, which is
 * why the failure path returns rather than throws. The returned
 * `ValidationError` is an `Error`, so Fastify passes it through to the error
 * handler untouched with its 400 status and its issue list intact.
 *
 * @param {{schema: {safeParse: Function}, httpPart?: string}} args Fastify compiler arguments.
 * @returns {function(*): object} The compiled validator.
 */
export function zodValidatorCompiler({ schema, httpPart }) {
  const label = PART_LABELS[httpPart ?? ''] ?? 'request'

  return (data) => {
    const result = schema.safeParse(data)

    if (result.success) return { value: result.data }

    return {
      error: new ValidationError(`Invalid ${label}`, formatIssues(result.error), {
        cause: result.error,
      }),
    }
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
  if (validateResponse && route.response) {
    schema.response = { [route.successStatus]: route.response }
  }

  return schema
}
