/**
 * OpenAPI 3.1 generation from the route table.
 *
 * Zod is the only description of a payload in this repository, so the document
 * is derived rather than hand-maintained: if a schema changes, the spec changes
 * with it and cannot silently go stale.
 *
 * @module @desi-event/api-contract/openapi
 */

import { z } from 'zod'

import { ApiContractError } from './errors.js'
import { pathParamNames, toOpenApiPath } from './path.js'
import { API_ERRORS, API_TAGS, apiErrorResponseSchema, apiRoutes } from './routes.js'

/** OpenAPI version the generated document claims. */
export const OPENAPI_VERSION = '3.1.0'

/** Name of the bearer security scheme in `components.securitySchemes`. */
export const BEARER_SCHEME_NAME = 'bearerAuth'

/**
 * OpenAPI 3.1 embeds JSON Schema 2020-12 verbatim, so that is the target we
 * ask Zod for. `unrepresentable: 'any'` keeps constructs like `z.date()` from
 * throwing — they degrade to an unconstrained schema instead of taking the
 * whole document down.
 *
 * @type {{target: string, unrepresentable: string}}
 */
const BASE_JSON_SCHEMA_OPTIONS = { target: 'draft-2020-12', unrepresentable: 'any' }

/**
 * Convert a Zod schema to a JSON Schema fragment fit for embedding.
 *
 * The `$schema` key is stripped because OpenAPI supplies the dialect at the
 * document level and a nested `$schema` is redundant noise.
 *
 * @param {ZodType} schema The Zod schema to convert.
 * @param {'input'|'output'} [io] Whether to describe what a caller sends or what it receives.
 * @returns {object} A JSON Schema object, possibly carrying `$defs`.
 * @throws {ApiContractError} When Zod cannot represent the schema at all.
 */
export function toJsonSchema(schema, io = 'input') {
  let converted

  try {
    converted = z.toJSONSchema(schema, { ...BASE_JSON_SCHEMA_OPTIONS, io })
  } catch (cause) {
    throw new ApiContractError(`Cannot render schema to JSON Schema (io: ${io})`, {
      code: 'SCHEMA_NOT_REPRESENTABLE',
      details: { io },
      cause,
    })
  }

  const { $schema: _dialect, ...rest } = converted

  return rest
}

/**
 * Rewrite `#/$defs/...` pointers so they resolve from the document root.
 *
 * Zod emits definitions local to whichever schema it was handed. Once that
 * fragment is embedded under `paths`, a local pointer no longer resolves, so
 * the definitions are hoisted into `components.schemas` and every reference is
 * repointed at the new home.
 *
 * @param {unknown} node The fragment to rewrite; walked recursively.
 * @param {Record<string, string>} renames Map of original `$defs` key to component name.
 * @returns {unknown} A rewritten copy; the input is not mutated.
 */
function rewriteRefs(node, renames) {
  if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, renames))
  if (!node || typeof node !== 'object') return node

  /** @type {Record<string, unknown>} */
  const out = {}

  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')) {
      const name = value.slice('#/$defs/'.length)
      out.$ref = `#/components/schemas/${renames[name] ?? name}`
      continue
    }

    out[key] = rewriteRefs(value, renames)
  }

  return out
}

/**
 * Lift a fragment's `$defs` into a shared component bag.
 *
 * Names are prefixed with the owning route so two routes whose schemas happen
 * to share a definition name cannot overwrite one another.
 *
 * @param {object} fragment JSON Schema fragment from {@link toJsonSchema}.
 * @param {string} prefix Prefix applied to hoisted names, normally the route id.
 * @param {Record<string, object>} components The document's `components.schemas` bag, mutated in place.
 * @returns {object} The fragment with `$defs` removed and refs repointed.
 */
export function hoistDefinitions(fragment, prefix, components) {
  const { $defs: defs, ...rest } = fragment ?? {}

  if (!defs || Object.keys(defs).length === 0) return rest

  const safePrefix = prefix.replace(/[^A-Za-z0-9_.-]/g, '_')
  /** @type {Record<string, string>} */
  const renames = {}

  for (const name of Object.keys(defs)) {
    renames[name] = `${safePrefix}.${name}`
  }

  for (const [name, definition] of Object.entries(defs)) {
    components[renames[name]] = /** @type {object} */ (rewriteRefs(definition, renames))
  }

  return /** @type {object} */ (rewriteRefs(rest, renames))
}

/**
 * Build the `parameters` array for one location from an object schema.
 *
 * Deriving these from the generated JSON Schema rather than from Zod internals
 * means `.superRefine()`-wrapped objects (the listing query, for one) still
 * yield their properties.
 *
 * @param {ZodType|null} schema Object schema describing the location, or `null`.
 * @param {'path'|'query'} location Where the parameters travel.
 * @param {string} routeId Owning route id, used for hoisted definition names.
 * @param {Record<string, object>} components The document's `components.schemas` bag.
 * @param {string[]} [required] Parameter names that must be treated as required regardless of the schema.
 * @returns {object[]} OpenAPI parameter objects, ordered by property name for stability.
 */
function buildParameters(schema, location, routeId, components, required = []) {
  if (!schema) {
    return required.map((name) => ({
      name,
      in: location,
      required: true,
      schema: { type: 'string' },
    }))
  }

  const fragment = hoistDefinitions(
    toJsonSchema(schema, 'input'),
    `${routeId}.${location}`,
    components,
  )
  const properties = /** @type {Record<string, object>} */ (fragment.properties ?? {})
  const declaredRequired = new Set([...(fragment.required ?? []), ...required])
  const names = new Set([...Object.keys(properties), ...required])

  return [...names].map((name) => {
    const propertySchema = properties[name] ?? { type: 'string' }
    const { description, ...schemaRest } = propertySchema

    /** @type {Record<string, unknown>} */
    const parameter = {
      name,
      in: location,
      // A path parameter is part of the URL, so it is required by definition.
      required: location === 'path' ? true : declaredRequired.has(name),
      schema: schemaRest,
    }

    if (description) parameter.description = description

    return parameter
  })
}

/**
 * Build the `responses` object for a route.
 *
 * @param {ApiRoute} route Route descriptor.
 * @param {Record<string, object>} components The document's `components.schemas` bag.
 * @returns {object} An OpenAPI responses object keyed by status code.
 */
function buildResponses(route, components) {
  const success = hoistDefinitions(
    toJsonSchema(route.response, 'output'),
    `${route.id}.response`,
    components,
  )

  /** @type {Record<string, object>} */
  const responses = {
    [String(route.successStatus)]: {
      description: route.summary,
      content: { 'application/json': { schema: success } },
    },
  }

  for (const error of route.errors) {
    // A status declared twice keeps its first description; the catalogue makes
    // that a non-issue in practice but the guard keeps generation total.
    if (responses[String(error.status)]) continue

    responses[String(error.status)] = {
      description: error.description,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
        },
      },
    }
  }

  return responses
}

/**
 * Build the OpenAPI operation object for one route.
 *
 * @param {ApiRoute} route Route descriptor.
 * @param {Record<string, object>} components The document's `components.schemas` bag.
 * @returns {object} An OpenAPI operation object.
 */
export function buildOperation(route, components) {
  const parameters = [
    ...buildParameters(route.params, 'path', route.id, components, pathParamNames(route.path)),
    ...buildParameters(route.query, 'query', route.id, components),
  ]

  /** @type {Record<string, unknown>} */
  const operation = {
    operationId: route.id,
    summary: route.summary,
    description: route.description,
    tags: [...route.tags],
    responses: buildResponses(route, components),
  }

  if (parameters.length > 0) operation.parameters = parameters

  if (route.body) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: hoistDefinitions(
            toJsonSchema(route.body, 'input'),
            `${route.id}.body`,
            components,
          ),
        },
      },
    }
  }

  if (route.auth === 'bearer') {
    operation.security = [{ [BEARER_SCHEME_NAME]: [] }]
  } else if (route.auth === 'optional') {
    // An empty requirement object means "no credentials also works".
    operation.security = [{}, { [BEARER_SCHEME_NAME]: [] }]
  }

  return operation
}

/**
 * Generate the OpenAPI 3.1 document describing the whole API.
 *
 * @param {object} [options] Document metadata.
 * @param {string} [options.title] API title shown in `info.title`.
 * @param {string} [options.version] API version shown in `info.version`.
 * @param {string} [options.description] Long description shown in `info.description`.
 * @param {Array<{url: string, description?: string}>} [options.servers] Server entries.
 * @param {Array<{name: string, description?: string}>} [options.tags] Tag definitions.
 * @param {Array<ApiRoute>} [options.routes] Routes to document; defaults to the whole table.
 * @returns {object} A complete OpenAPI 3.1 document.
 * @throws {ApiContractError} When two routes collide on method and path, or a schema cannot be rendered.
 */
export function buildOpenApiDocument(options = {}) {
  const {
    title = 'Desi-Event API',
    version = '1.0.0',
    description = 'Ticketing and discovery for South-Asian cultural events.',
    servers = [{ url: 'http://127.0.0.1:4000', description: 'Local development' }],
    tags = API_TAGS,
    routes = apiRoutes,
  } = options

  /** @type {Record<string, object>} */
  const componentSchemas = {}

  componentSchemas.ErrorResponse = hoistDefinitions(
    toJsonSchema(apiErrorResponseSchema, 'output'),
    'ErrorResponse',
    componentSchemas,
  )

  /** @type {Record<string, Record<string, object>>} */
  const paths = {}

  for (const route of routes) {
    const openApiPath = toOpenApiPath(route.path)
    const method = route.method.toLowerCase()
    const pathItem = paths[openApiPath] ?? (paths[openApiPath] = {})

    if (pathItem[method]) {
      throw new ApiContractError(
        `Duplicate operation ${route.method} ${route.path} (route "${route.id}")`,
        {
          code: 'DUPLICATE_ROUTE',
          details: { id: route.id, method: route.method, path: route.path },
        },
      )
    }

    pathItem[method] = buildOperation(route, componentSchemas)
  }

  return {
    openapi: OPENAPI_VERSION,
    info: { title, version, description },
    servers: servers.map((server) => ({ ...server })),
    tags: tags.map((tag) => ({ ...tag })),
    paths,
    components: {
      schemas: componentSchemas,
      securitySchemes: {
        [BEARER_SCHEME_NAME]: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'A JWT issued by `POST /v1/auth/login` or `POST /v1/auth/register`.',
        },
      },
    },
  }
}

/**
 * Status codes any route may document, as a convenience for the API server.
 *
 * @returns {number[]} Sorted, de-duplicated documented error statuses.
 */
export function documentedErrorStatuses() {
  return [...new Set(Object.values(API_ERRORS).map((error) => error.status))].sort((a, b) => a - b)
}
