/**
 * A typed-by-convention HTTP client generated from the route table.
 *
 * Every route id becomes a nested method — `events.list` is
 * `client.events.list(...)` — so a route that is renamed or removed breaks
 * calling code immediately instead of failing at runtime against a 404.
 *
 * `fetch` is injected rather than closed over so tests can drive the client
 * with a stub and never touch the network.
 *
 * @module @desi-event/api-contract/client
 */

import { ApiClientError, ApiContractError, NETWORK_ERROR_STATUS, isApiClientError } from './errors.js'
import { buildPath, joinUrl, pathParamNames } from './path.js'
import { apiRoutes } from './routes.js'

export { ApiClientError, ApiContractError, NETWORK_ERROR_STATUS, isApiClientError }

/** Keys recognised in the structured call form, `{ params, query, body }`. */
const STRUCTURED_KEYS = Object.freeze(['params', 'query', 'body'])

/** Methods whose requests never carry a JSON body. */
const BODYLESS_METHODS = Object.freeze(['GET', 'HEAD'])

/**
 * Serialise a plain object into a query string.
 *
 * `undefined` and `null` are dropped rather than sent as the strings
 * `"undefined"`/`"null"`; arrays repeat the key; `Date`s become ISO strings so
 * they round-trip through `isoDateTimeSchema`.
 *
 * @param {Record<string, unknown>} [query] Query values by name.
 * @returns {string} The encoded query string, without a leading `?`; empty when there is nothing to send.
 */
export function serialiseQuery(query = {}) {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue

    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue
      search.append(key, encodeQueryValue(item))
    }
  }

  return search.toString()
}

/**
 * Render a single query value as a string.
 *
 * @param {unknown} value Scalar value to encode.
 * @returns {string} The string form sent on the wire.
 */
function encodeQueryValue(value) {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  return String(value)
}

/**
 * Fold path parameters into a request body so both agree on the same ids.
 *
 * Only applies to routes that actually carry a body, and only to plain-object
 * bodies — a body the caller deliberately made an array or a scalar is left
 * untouched.
 *
 * @param {ApiRoute} route Route descriptor.
 * @param {unknown} body The body as supplied by the caller.
 * @param {Record<string, unknown>} params Resolved path parameters.
 * @returns {unknown} The body to send.
 */
function mergeParamsIntoBody(route, body, params) {
  if (!route.body || BODYLESS_METHODS.includes(route.method)) return body
  if (Object.keys(params).length === 0) return body
  if (body === undefined || body === null) return { ...params }
  if (typeof body !== 'object' || Array.isArray(body)) return body

  return { ...body, ...params }
}

/**
 * Whether a value may stand in for one of the structured request parts.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} True for `undefined` and for non-array objects.
 */
function isObjectOrUndefined(value) {
  return value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value))
}

/**
 * Split a call argument into the three request parts a route may use.
 *
 * Two call styles are supported. The structured form names each part
 * explicitly (`{ params: {...}, body: {...} }`). The flat form — what most
 * calls use — passes one object: path parameters are read out by name and
 * whatever is left becomes the body, or the query on a bodyless route.
 *
 * Path parameters are also folded into the body of a body-carrying route.
 * Several request schemas require the same id that the path already names
 * (`joinWaitlistRequestSchema.eventId`, for one), and the URL is authoritative,
 * so the two can never be made to disagree.
 *
 * @param {ApiRoute} route Route descriptor.
 * @param {Record<string, unknown>} [input] The caller's single argument.
 * @returns {{params: Record<string, unknown>, query: Record<string, unknown>, body: unknown}} The split request parts.
 * @throws {ApiContractError} When the flat form carries fields the route has nowhere to put.
 */
export function splitInput(route, input = {}) {
  const source = input ?? {}

  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new ApiContractError(`Route "${route.id}" expects an object argument`, {
      code: 'INVALID_INPUT',
      details: { id: route.id },
    })
  }

  const keys = Object.keys(source)
  // `{ query: 'garba' }` is a flat query, not the structured form; requiring
  // each recognised key to hold an object keeps that ambiguity from biting.
  const isStructured =
    keys.length > 0 &&
    keys.every((key) => STRUCTURED_KEYS.includes(key) && isObjectOrUndefined(source[key]))

  if (isStructured) {
    const params = /** @type {Record<string, unknown>} */ (source.params ?? {})

    return {
      params,
      query: /** @type {Record<string, unknown>} */ (source.query ?? {}),
      body: mergeParamsIntoBody(route, source.body, params),
    }
  }

  /** @type {Record<string, unknown>} */
  const params = {}
  /** @type {Record<string, unknown>} */
  const rest = { ...source }

  for (const name of pathParamNames(route.path)) {
    if (name in rest) {
      params[name] = rest[name]
      delete rest[name]
    }
  }

  const acceptsBody = Boolean(route.body) && !BODYLESS_METHODS.includes(route.method)

  if (acceptsBody) return { params, query: {}, body: mergeParamsIntoBody(route, rest, params) }
  if (route.query) return { params, query: rest, body: undefined }

  if (Object.keys(rest).length > 0) {
    throw new ApiContractError(
      `Route "${route.id}" takes no query or body, but received: ${Object.keys(rest).join(', ')}`,
      { code: 'UNEXPECTED_INPUT', details: { id: route.id, keys: Object.keys(rest) } },
    )
  }

  return { params, query: {}, body: undefined }
}

/**
 * Resolve a token that may be a literal, a getter, or absent.
 *
 * @param {string|Function|null|undefined} token The configured token.
 * @returns {Promise<string|null>} The bearer token, or `null` when there is none.
 */
async function resolveToken(token) {
  const value = typeof token === 'function' ? await token() : token

  return value ? String(value) : null
}

/**
 * Read and parse a response body according to its content type.
 *
 * @param {Response} response The fetch response.
 * @returns {Promise<unknown>} Parsed JSON, raw text, or `null` for an empty body.
 */
async function parseBody(response) {
  if (response.status === 204 || response.status === 205) return null

  const text = await response.text()
  if (text === '') return null

  const contentType = response.headers?.get?.('content-type') ?? ''

  if (contentType.includes('json')) {
    try {
      return JSON.parse(text)
    } catch {
      // A malformed JSON body is still evidence; hand it back verbatim rather
      // than replacing the server's message with a parse error.
      return text
    }
  }

  return text
}

/**
 * Build a client bound to one API origin.
 *
 * @param {object} options Client configuration.
 * @param {string} options.baseUrl Origin the API is served from, e.g. `https://api.desi-event.com`.
 * @param {Function} [options.fetch] Fetch implementation; defaults to the global one.
 * @param {string|Function|null} [options.token] Bearer token, or a getter for one.
 * @param {Record<string, string>} [options.headers] Headers added to every request.
 * @param {Array<ApiRoute>} [options.routes] Routes to expose; defaults to the whole table.
 * @returns {object} A client with one method per route id.
 * @throws {ApiContractError} When `baseUrl` is missing or no fetch implementation is available.
 */
export function createApiClient(options = {}) {
  const {
    baseUrl,
    fetch: fetchImpl = globalThis.fetch,
    token = null,
    headers: defaultHeaders = {},
    routes = apiRoutes,
  } = options

  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new ApiContractError('createApiClient requires a string baseUrl', {
      code: 'MISSING_BASE_URL',
    })
  }

  if (typeof fetchImpl !== 'function') {
    throw new ApiContractError('createApiClient requires a fetch implementation', {
      code: 'MISSING_FETCH',
    })
  }

  /**
   * Perform one request against a route descriptor.
   *
   * @param {string} routeId Route id, e.g. `events.list`.
   * @param {Record<string, unknown>} [input] Path params, query and/or body.
   * @param {object} [callOptions] Per-call overrides.
   * @param {Record<string, string>} [callOptions.headers] Extra headers for this call.
   * @param {string|null} [callOptions.token] Token overriding the client-level one; `null` sends none.
   * @param {AbortSignal} [callOptions.signal] Abort signal.
   * @returns {Promise<unknown>} The parsed success body.
   * @throws {ApiClientError} On a non-2xx response or a transport failure.
   * @throws {ApiContractError} When the route id is unknown or the input cannot be placed.
   */
  async function request(routeId, input = {}, callOptions = {}) {
    const route = routes.find((candidate) => candidate.id === routeId)

    if (!route) {
      throw new ApiContractError(`Unknown route id "${routeId}"`, { code: 'UNKNOWN_ROUTE' })
    }

    const { params, query, body } = splitInput(route, input)
    const search = serialiseQuery(query)
    const url = joinUrl(baseUrl, buildPath(route.path, params)) + (search ? `?${search}` : '')

    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json', ...defaultHeaders, ...(callOptions.headers ?? {}) }

    const hasToken = Object.prototype.hasOwnProperty.call(callOptions, 'token')
    const bearer = await resolveToken(hasToken ? callOptions.token : token)

    if (bearer && route.auth !== 'none') headers.authorization = `Bearer ${bearer}`

    /** @type {RequestInit} */
    const init = { method: route.method, headers }

    if (body !== undefined && !BODYLESS_METHODS.includes(route.method)) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    if (callOptions.signal) init.signal = callOptions.signal

    let response

    try {
      response = await fetchImpl(url, init)
    } catch (cause) {
      throw new ApiClientError(`Request to ${route.method} ${url} failed: ${cause?.message ?? cause}`, {
        status: NETWORK_ERROR_STATUS,
        code: 'NETWORK_ERROR',
        method: route.method,
        url,
        routeId: route.id,
        cause,
      })
    }

    const parsed = await parseBody(response)

    if (!response.ok) {
      throw new ApiClientError(errorMessage(route, response, parsed), {
        status: response.status,
        body: parsed,
        method: route.method,
        url,
        routeId: route.id,
      })
    }

    return parsed
  }

  /** @type {Record<string, unknown>} */
  const client = {
    request,

    /**
     * Derive a client that sends a different bearer token.
     *
     * @param {string|Function|null} nextToken Token for the derived client.
     * @returns {object} A new client sharing this one's baseUrl, fetch and headers.
     */
    withToken(nextToken) {
      return createApiClient({ ...options, token: nextToken })
    },
  }

  for (const route of routes) {
    attachRoute(client, route, request)
  }

  return /** @type {object} */ (
    client
  )
}

/**
 * Hang a route's method off the client at its dotted id.
 *
 * @param {Record<string, unknown>} client The client object being assembled.
 * @param {ApiRoute} route Route descriptor.
 * @param {Function} request The shared request function.
 * @returns {void}
 * @throws {ApiContractError} When two route ids claim the same method name.
 */
function attachRoute(client, route, request) {
  const segments = route.id.split('.')
  const methodName = segments.pop()

  let target = client

  for (const segment of segments) {
    if (!target[segment]) target[segment] = {}
    target = /** @type {Record<string, unknown>} */ (target[segment])
  }

  if (target[methodName]) {
    throw new ApiContractError(`Duplicate client method for route id "${route.id}"`, {
      code: 'DUPLICATE_ROUTE_ID',
      details: { id: route.id },
    })
  }

  /**
   * @param {Record<string, unknown>} [input] Path params, query and/or body.
   * @param {object} [callOptions] Per-call overrides.
   * @returns {Promise<unknown>} The parsed success body.
   */
  target[methodName] = (input, callOptions) => request(route.id, input, callOptions)

  Object.defineProperty(target[methodName], 'name', { value: route.id })
}

/**
 * Compose the message for a failed request, preferring the server's own words.
 *
 * @param {ApiRoute} route Route descriptor.
 * @param {Response} response The failing response.
 * @param {unknown} body Parsed response body.
 * @returns {string} A message suitable for logs.
 */
function errorMessage(route, response, body) {
  const serverMessage =
    body && typeof body === 'object' && typeof body.error?.message === 'string'
      ? body.error.message
      : null

  const suffix = serverMessage ? `: ${serverMessage}` : ''

  return `${route.method} ${route.path} failed with ${response.status}${suffix}`
}
