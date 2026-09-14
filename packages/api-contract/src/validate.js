/**
 * Structural validation of the contract itself.
 *
 * Nothing here checks runtime traffic — it checks that the route table is
 * coherent before anything is generated from it. A duplicated id or a colliding
 * path would otherwise surface as a mysterious 404 in the browser weeks later.
 *
 * @module @desi-event/api-contract/validate
 */

import { buildOpenApiDocument, OPENAPI_VERSION } from './openapi.js'
import { pathParamNames, routeShape } from './path.js'
import { AUTH_MODES, HTTP_METHODS, apiRoutes, routeKey } from './routes.js'

/** Fields every descriptor must define, even if only as `null`. */
const REQUIRED_FIELDS = Object.freeze([
  'id',
  'method',
  'path',
  'summary',
  'description',
  'tags',
  'auth',
  'params',
  'query',
  'body',
  'response',
  'errors',
])

/**
 * A single problem found in the contract.
 *
 * @typedef {object} ContractIssue
 * @property {string} code Machine-readable problem code.
 * @property {string} message Human-readable explanation.
 * @property {string} [routeId] The offending route, when the problem is route-local.
 */

/**
 * Whether a value looks like a Zod schema.
 *
 * Duck-typed on `safeParse` rather than `instanceof` so a second copy of Zod in
 * the dependency tree does not produce a spurious failure.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} True when the value can parse.
 */
function isZodSchema(value) {
  return Boolean(value) && typeof (/** @type {{safeParse?: unknown}} */ (value).safeParse) === 'function'
}

/**
 * Check one route descriptor in isolation.
 *
 * @param {ApiRoute} route Route descriptor.
 * @param {number} index Position in the table, used when `id` itself is missing.
 * @returns {ContractIssue[]} Problems found with this route.
 */
function checkRoute(route, index) {
  /** @type {ContractIssue[]} */
  const issues = []
  const routeId = typeof route?.id === 'string' ? route.id : `#${index}`

  /**
   * @param {string} code Problem code.
   * @param {string} message Explanation.
   * @returns {void}
   */
  const fail = (code, message) => {
    issues.push({ code, message, routeId })
  }

  if (!route || typeof route !== 'object') {
    return [{ code: 'NOT_AN_OBJECT', message: `Route ${routeId} is not an object`, routeId }]
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in route)) fail('MISSING_FIELD', `Route ${routeId} is missing "${field}"`)
  }

  if (typeof route.id !== 'string' || !/^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/.test(route.id ?? '')) {
    fail('BAD_ID', `Route id "${routeId}" must be a dotted camelCase pair, e.g. "events.list"`)
  }

  if (!HTTP_METHODS.includes(route.method)) {
    fail('BAD_METHOD', `Route ${routeId} has unsupported method "${route.method}"`)
  }

  if (typeof route.path !== 'string' || !route.path.startsWith('/')) {
    fail('BAD_PATH', `Route ${routeId} path must start with "/"`)
  }

  if (!AUTH_MODES.includes(route.auth)) {
    fail('BAD_AUTH', `Route ${routeId} has unknown auth mode "${route.auth}"`)
  }

  if (!Array.isArray(route.tags) || route.tags.length === 0) {
    fail('MISSING_TAGS', `Route ${routeId} must carry at least one tag`)
  }

  if (typeof route.summary !== 'string' || route.summary.trim() === '') {
    fail('MISSING_SUMMARY', `Route ${routeId} needs a summary`)
  }

  if (typeof route.description !== 'string' || route.description.trim() === '') {
    fail('MISSING_DESCRIPTION', `Route ${routeId} needs a description`)
  }

  if (!isZodSchema(route.response)) {
    fail('MISSING_RESPONSE', `Route ${routeId} must declare a response schema`)
  }

  for (const part of ['params', 'query', 'body']) {
    const value = route[part]
    if (value !== null && !isZodSchema(value)) {
      fail('BAD_SCHEMA', `Route ${routeId} "${part}" must be a Zod schema or null`)
    }
  }

  if (!Number.isInteger(route.successStatus) || route.successStatus < 200 || route.successStatus > 299) {
    fail('BAD_SUCCESS_STATUS', `Route ${routeId} successStatus must be a 2xx integer`)
  }

  if (!Array.isArray(route.errors)) {
    fail('BAD_ERRORS', `Route ${routeId} errors must be an array`)
  } else {
    const seen = new Set()

    for (const error of route.errors) {
      if (!Number.isInteger(error?.status) || !error?.code || !error?.description) {
        fail('BAD_ERROR_ENTRY', `Route ${routeId} has an error entry missing status, code or description`)
        continue
      }

      if (seen.has(error.status)) {
        fail('DUPLICATE_ERROR_STATUS', `Route ${routeId} documents status ${error.status} twice`)
      }

      seen.add(error.status)
    }
  }

  // A `:param` with no schema property would be undocumented in the spec.
  const declared = pathParamNames(route.path ?? '')

  if (declared.length > 0 && !route.params) {
    fail('MISSING_PARAMS_SCHEMA', `Route ${routeId} has path params (${declared.join(', ')}) but no params schema`)
  }

  if (declared.length === 0 && route.params) {
    fail('UNUSED_PARAMS_SCHEMA', `Route ${routeId} declares a params schema but its path has no parameters`)
  }

  if (route.body && ['GET', 'DELETE'].includes(route.method)) {
    fail('BODY_ON_BODYLESS_METHOD', `Route ${routeId} declares a body on a ${route.method}`)
  }

  return issues
}

/**
 * Check the generated document for the structure OpenAPI 3.1 requires.
 *
 * @param {object} document A document from `buildOpenApiDocument`.
 * @param {number} expectedOperations How many operations the route table should have produced.
 * @returns {ContractIssue[]} Problems found in the document.
 */
function checkDocument(document, expectedOperations) {
  /** @type {ContractIssue[]} */
  const issues = []

  /**
   * @param {string} code Problem code.
   * @param {string} message Explanation.
   * @returns {void}
   */
  const fail = (code, message) => {
    issues.push({ code, message })
  }

  if (document?.openapi !== OPENAPI_VERSION) {
    fail('BAD_OPENAPI_VERSION', `Expected openapi "${OPENAPI_VERSION}", got "${document?.openapi}"`)
  }

  if (!document?.info?.title || !document?.info?.version) {
    fail('BAD_INFO', 'Document info must carry a title and a version')
  }

  if (!Array.isArray(document?.servers) || document.servers.length === 0) {
    fail('MISSING_SERVERS', 'Document must list at least one server')
  }

  if (!document?.components?.securitySchemes?.bearerAuth) {
    fail('MISSING_SECURITY_SCHEME', 'Document must define the bearerAuth security scheme')
  }

  const paths = document?.paths ?? {}
  let operations = 0

  for (const [path, item] of Object.entries(paths)) {
    if (!path.startsWith('/')) fail('BAD_DOCUMENT_PATH', `Path "${path}" must start with "/"`)
    if (path.includes(':')) fail('UNCONVERTED_PATH', `Path "${path}" still uses Fastify ":param" syntax`)

    const templated = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])

    for (const [method, operation] of Object.entries(item)) {
      operations += 1

      if (!operation.operationId) {
        fail('MISSING_OPERATION_ID', `${method.toUpperCase()} ${path} has no operationId`)
      }

      if (!operation.responses || Object.keys(operation.responses).length === 0) {
        fail('MISSING_RESPONSES', `${method.toUpperCase()} ${path} documents no responses`)
      }

      const pathParams = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name)

      for (const name of templated) {
        if (!pathParams.includes(name)) {
          fail('UNDOCUMENTED_PATH_PARAM', `${method.toUpperCase()} ${path} does not document "{${name}}"`)
        }
      }

      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!response.description) {
          fail('MISSING_RESPONSE_DESCRIPTION', `${method.toUpperCase()} ${path} ${status} has no description`)
        }
      }
    }
  }

  if (operations !== expectedOperations) {
    fail('OPERATION_COUNT', `Expected ${expectedOperations} operations in the document, found ${operations}`)
  }

  issues.push(...checkDanglingRefs(document))

  return issues
}

/**
 * Find `$ref` pointers that do not resolve inside the document.
 *
 * `z.toJSONSchema` may emit `#/$defs/...` pointers; those are hoisted into
 * `components.schemas` during generation, and this is the proof the hoisting
 * actually happened.
 *
 * @param {object} document The generated document.
 * @returns {ContractIssue[]} One issue per unresolvable reference.
 */
function checkDanglingRefs(document) {
  /** @type {ContractIssue[]} */
  const issues = []
  const known = new Set(Object.keys(document?.components?.schemas ?? {}))

  /**
   * @param {unknown} node Node to walk.
   * @returns {void}
   */
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }

    if (!node || typeof node !== 'object') return

    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        if (value.startsWith('#/$defs/')) {
          issues.push({ code: 'LOCAL_DEFS_REF', message: `Reference "${value}" was not hoisted into components` })
        } else if (value.startsWith('#/components/schemas/')) {
          const name = value.slice('#/components/schemas/'.length)
          if (!known.has(name)) {
            issues.push({ code: 'DANGLING_REF', message: `Reference "${value}" does not resolve` })
          }
        } else {
          issues.push({ code: 'EXTERNAL_REF', message: `Reference "${value}" is not document-local` })
        }
        continue
      }

      walk(value)
    }
  }

  walk(document?.paths)
  walk(document?.components?.schemas)

  return issues
}

/**
 * Validate the contract and the document it produces.
 *
 * @param {object} [options] Validation options.
 * @param {Array<ApiRoute>} [options.routes] Routes to validate; defaults to the whole table.
 * @returns {{ok: boolean, issues: ContractIssue[], document: object|null, routeCount: number}} The verdict, every issue found, and the document when generation succeeded.
 */
export function validateContract(options = {}) {
  const { routes = apiRoutes } = options

  /** @type {ContractIssue[]} */
  const issues = []

  if (!Array.isArray(routes) || routes.length === 0) {
    return { ok: false, issues: [{ code: 'EMPTY_CONTRACT', message: 'The route table is empty' }], document: null, routeCount: 0 }
  }

  const seenIds = new Set()
  const seenKeys = new Map()

  routes.forEach((route, index) => {
    issues.push(...checkRoute(route, index))

    if (seenIds.has(route?.id)) {
      issues.push({ code: 'DUPLICATE_ID', message: `Route id "${route.id}" is declared twice`, routeId: route.id })
    }
    seenIds.add(route?.id)

    const key = typeof route?.method === 'string' && typeof route?.path === 'string' ? routeKey(route) : null

    if (key) {
      // Compared on the routing shape, so `/e/:id` and `/e/:slug` — which
      // Fastify would also reject — are caught here rather than at boot.
      const normalised = `${route.method} ${routeShape(route.path)}`

      if (seenKeys.has(normalised)) {
        issues.push({
          code: 'DUPLICATE_ROUTE',
          message: `${normalised} is claimed by both "${seenKeys.get(normalised)}" and "${route.id}"`,
          routeId: route.id,
        })
      } else {
        seenKeys.set(normalised, route.id)
      }
    }
  })

  /** @type {object|null} */
  let document = null

  try {
    document = buildOpenApiDocument({ routes })
  } catch (error) {
    issues.push({ code: 'GENERATION_FAILED', message: `Document generation threw: ${error.message}` })
  }

  if (document) issues.push(...checkDocument(document, routes.length))

  return { ok: issues.length === 0, issues, document, routeCount: routes.length }
}

/**
 * Validate the contract and throw on the first sign of trouble.
 *
 * @param {object} [options] Same options as {@link validateContract}.
 * @returns {object} The generated OpenAPI document.
 * @throws {Error} When the contract is invalid; the message lists every issue.
 */
export function assertContractValid(options = {}) {
  const result = validateContract(options)

  if (!result.ok) {
    const lines = result.issues.map((issue) => ` - [${issue.code}] ${issue.message}`)
    throw new Error(`Invalid API contract (${result.issues.length} issue(s)):\n${lines.join('\n')}`)
  }

  return /** @type {object} */ (result.document)
}
