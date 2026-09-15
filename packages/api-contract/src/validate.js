/**
 * Structural validation of the contract itself.
 *
 * Nothing here checks runtime traffic — it checks that the route table is
 * coherent before anything is generated from it. A duplicated id or a colliding
 * path would otherwise surface as a mysterious 404 in the browser weeks later.
 *
 * @module @desi-event/api-contract/validate
 */

import { STEP_UP_POLICY_NAMES } from '@desi-event/auth'
import { isCapability, PLATFORM_ONLY_CAPABILITIES } from '@desi-event/permissions'

import { buildOpenApiDocument, OPENAPI_VERSION } from './openapi.js'
import { pathParamNames, routeShape } from './path.js'
import { AUTH_MODES, AUTHENTICATED_MODES, HTTP_METHODS, apiRoutes, routeKey } from './routes.js'

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
  return (
    Boolean(value) && typeof (/** @type {{safeParse?: unknown}} */ (value).safeParse) === 'function'
  )
}

/**
 * The keys of a Zod object schema, and which of them are required.
 *
 * Needed because a `capabilityScope` that names a field the schema does not have
 * is worse than useless: at runtime the value is `undefined`, the guard has no
 * organisation to scope by, and an organisation-scoped check silently becomes a
 * platform-level one. Checking the part exists is not enough — the *key* has to
 * exist too, and it has to be required, because an optional field is absent on
 * exactly the request an attacker would send.
 *
 * Unwraps the wrappers this repository actually uses. `z.preprocess` is the
 * house convention for coercion (a `.transform()` cannot be rendered as JSON
 * Schema), and it presents as a pipe whose input side carries the shape.
 *
 * @param {unknown} schema A candidate Zod object schema.
 * @returns {{keys: Set<string>, required: Set<string>}|null} The keys, or null when the schema cannot be introspected.
 */
export function objectKeysOf(schema) {
  // Breadth-first rather than a single chain, because a wrapper can have two
  // sides and which one carries the shape depends on the wrapper.
  // `z.preprocess(fn, object)` puts the object on `out`; `object.transform(fn)`
  // puts it on `in`. Following only one of them silently returns null, and a null
  // here is reported as "cannot verify the scope", which would make the rule
  // advisory exactly where it needs to be binding.
  /** @type {any[]} */
  const queue = [schema]
  const seen = new Set()

  while (queue.length > 0 && seen.size < 32) {
    const current = queue.shift()

    if (!current || typeof current !== 'object' || seen.has(current)) continue

    seen.add(current)

    const shape = current.shape ?? current._def?.shape
    const resolved = typeof shape === 'function' ? shape() : shape

    if (resolved && typeof resolved === 'object') {
      const keys = new Set(Object.keys(resolved))
      const required = new Set(
        Object.entries(resolved)
          .filter(([, value]) => {
            // `isOptional()` covers `.optional()`, `.nullish()` and `.default()`
            // across Zod versions; a missing method means "assume required",
            // which fails closed.
            const test = value?.isOptional

            return typeof test === 'function' ? !test.call(value) : true
          })
          .map(([key]) => key),
      )

      return { keys, required }
    }

    const def = current._def ?? {}

    queue.push(def.out, def.in, def.innerType, def.schema, def.type)

    if (typeof current.unwrap === 'function') {
      try {
        queue.push(current.unwrap())
      } catch {
        // A wrapper whose unwrap needs arguments. Nothing to follow.
      }
    }
  }

  return null
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

  if (
    typeof route.id !== 'string' ||
    !/^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/.test(route.id ?? '')
  ) {
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

  // A capability is a power the caller was granted, so asserting one only means
  // anything once the caller has been identified. A capability on an anonymous
  // route would read as protection and provide none.
  if ('capability' in route && route.capability !== null) {
    if (typeof route.capability !== 'string' || !isCapability(route.capability)) {
      fail(
        'BAD_CAPABILITY',
        `Route ${routeId} declares capability "${route.capability}", which is not in @desi-event/permissions`,
      )
    }

    if (!AUTHENTICATED_MODES.includes(route.auth)) {
      fail(
        'CAPABILITY_WITHOUT_AUTH',
        `Route ${routeId} requires a capability but its auth mode is "${route.auth}", so no caller is identified`,
      )
    }
  }

  // The scope rules are the other half of finding NF-05, and the half that was
  // left open: the original fix checked a `capabilityScope` *if one was
  // declared*, so a route could omit it entirely and fall back to hunting for an
  // `organizationId` anywhere in the request. When it found none — which is the
  // normal case for a path like `/v1/organizations/:id/...` — the guard asserted
  // with no organisation, which refuses every organiser and passes every
  // platform admin. So the scope is now mandatory for anything organisation-
  // scoped, forbidden for anything platform-only, and checked down to the key.
  const declaresCapability = typeof route.capability === 'string' && route.capability.length > 0
  const platformOnly = declaresCapability && PLATFORM_ONLY_CAPABILITIES.includes(route.capability)
  const hasScope = typeof route.capabilityScope === 'string' && route.capabilityScope.length > 0

  if (declaresCapability && !platformOnly && !hasScope && isCapability(route.capability)) {
    fail(
      'CAPABILITY_SCOPE_REQUIRED',
      `Route ${routeId} declares the organisation-scoped capability "${route.capability}" but no capabilityScope. ` +
        'Name where the organisation is, as "params.id" — without it the check degrades to a platform-level one. ' +
        'A route whose organisation is only known after loading a record should declare no capability and assert in its handler.',
    )
  }

  if (platformOnly && hasScope) {
    fail(
      'PLATFORM_CAPABILITY_WITH_SCOPE',
      `Route ${routeId} declares the platform-only capability "${route.capability}" with capabilityScope ` +
        `"${route.capabilityScope}". Platform capabilities are not held per organisation, so the scope would be ignored.`,
    )
  }

  if (hasScope) {
    const match = /^(params|query|body)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(route.capabilityScope)

    if (!match) {
      fail(
        'BAD_CAPABILITY_SCOPE',
        `Route ${routeId} capabilityScope must look like "params.id", not "${route.capabilityScope}"`,
      )
    } else if (!route[match[1]]) {
      // The scope names a request part the route does not have, so the guard
      // would silently assert with no organisation — which is a platform-level
      // check wearing an organisation route's clothes.
      fail(
        'CAPABILITY_SCOPE_MISSING_PART',
        `Route ${routeId} capabilityScope reads ${match[1]}.${match[2]} but declares no ${match[1]} schema`,
      )
    } else {
      const [, part, key] = match
      const shape = objectKeysOf(route[part])

      if (!shape) {
        fail(
          'CAPABILITY_SCOPE_UNREADABLE',
          `Route ${routeId} capabilityScope reads ${part}.${key} but the ${part} schema is not an object schema, ` +
            'so the key cannot be verified',
        )
      } else if (!shape.keys.has(key)) {
        fail(
          'CAPABILITY_SCOPE_UNKNOWN_KEY',
          `Route ${routeId} capabilityScope reads ${part}.${key}, which the ${part} schema does not declare ` +
            `(it has: ${[...shape.keys].join(', ') || 'nothing'}). At runtime that is undefined and the ` +
            'organisation check silently becomes a platform check.',
        )
      } else if (!shape.required.has(key)) {
        fail(
          'CAPABILITY_SCOPE_OPTIONAL',
          `Route ${routeId} capabilityScope reads ${part}.${key}, which is optional. An optional scope is absent on ` +
            'exactly the request that wants it absent.',
        )
      }
    }

    if (!route.capability) {
      fail(
        'CAPABILITY_SCOPE_WITHOUT_CAPABILITY',
        `Route ${routeId} declares a capabilityScope but no capability`,
      )
    }
  }

  // Finding NF-11. `stepUp` used to be a boolean, so every sensitive action
  // shared one fifteen-minute window: approving a refund and removing somebody's
  // second factor were treated as equally recent. It is now a named policy, and
  // naming it here rather than in the handler is the point — the window is
  // decided by the contract, before a request arrives, so a browser can neither
  // send one nor widen one.
  if ('stepUp' in route && route.stepUp !== null && route.stepUp !== false) {
    if (typeof route.stepUp !== 'string' || !STEP_UP_POLICY_NAMES.includes(route.stepUp)) {
      fail(
        'BAD_STEP_UP',
        `Route ${routeId} stepUp must name a policy — one of ${STEP_UP_POLICY_NAMES.join(', ')} — not ${JSON.stringify(route.stepUp)}`,
      )
    } else if (!AUTHENTICATED_MODES.includes(route.auth)) {
      fail(
        'STEP_UP_WITHOUT_AUTH',
        `Route ${routeId} requires step-up authentication but does not require a credential`,
      )
    }
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

  if (
    !Number.isInteger(route.successStatus) ||
    route.successStatus < 200 ||
    route.successStatus > 299
  ) {
    fail('BAD_SUCCESS_STATUS', `Route ${routeId} successStatus must be a 2xx integer`)
  }

  if (!Array.isArray(route.errors)) {
    fail('BAD_ERRORS', `Route ${routeId} errors must be an array`)
  } else {
    const seen = new Set()

    for (const error of route.errors) {
      if (!Number.isInteger(error?.status) || !error?.code || !error?.description) {
        fail(
          'BAD_ERROR_ENTRY',
          `Route ${routeId} has an error entry missing status, code or description`,
        )
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
    fail(
      'MISSING_PARAMS_SCHEMA',
      `Route ${routeId} has path params (${declared.join(', ')}) but no params schema`,
    )
  }

  if (declared.length === 0 && route.params) {
    fail(
      'UNUSED_PARAMS_SCHEMA',
      `Route ${routeId} declares a params schema but its path has no parameters`,
    )
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
    if (path.includes(':'))
      fail('UNCONVERTED_PATH', `Path "${path}" still uses Fastify ":param" syntax`)

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
          fail(
            'UNDOCUMENTED_PATH_PARAM',
            `${method.toUpperCase()} ${path} does not document "{${name}}"`,
          )
        }
      }

      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!response.description) {
          fail(
            'MISSING_RESPONSE_DESCRIPTION',
            `${method.toUpperCase()} ${path} ${status} has no description`,
          )
        }
      }
    }
  }

  if (operations !== expectedOperations) {
    fail(
      'OPERATION_COUNT',
      `Expected ${expectedOperations} operations in the document, found ${operations}`,
    )
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
          issues.push({
            code: 'LOCAL_DEFS_REF',
            message: `Reference "${value}" was not hoisted into components`,
          })
        } else if (value.startsWith('#/components/schemas/')) {
          const name = value.slice('#/components/schemas/'.length)
          if (!known.has(name)) {
            issues.push({ code: 'DANGLING_REF', message: `Reference "${value}" does not resolve` })
          }
        } else {
          issues.push({
            code: 'EXTERNAL_REF',
            message: `Reference "${value}" is not document-local`,
          })
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
    return {
      ok: false,
      issues: [{ code: 'EMPTY_CONTRACT', message: 'The route table is empty' }],
      document: null,
      routeCount: 0,
    }
  }

  const seenIds = new Set()
  const seenKeys = new Map()

  routes.forEach((route, index) => {
    issues.push(...checkRoute(route, index))

    if (seenIds.has(route?.id)) {
      issues.push({
        code: 'DUPLICATE_ID',
        message: `Route id "${route.id}" is declared twice`,
        routeId: route.id,
      })
    }
    seenIds.add(route?.id)

    const key =
      typeof route?.method === 'string' && typeof route?.path === 'string' ? routeKey(route) : null

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
    issues.push({
      code: 'GENERATION_FAILED',
      message: `Document generation threw: ${error.message}`,
    })
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
