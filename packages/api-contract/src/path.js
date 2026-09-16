/**
 * Path helpers shared by the OpenAPI builder and the HTTP client.
 *
 * Route descriptors declare Fastify-style paths (`/v1/events/:slug`). OpenAPI
 * wants `{slug}` and the client wants a concrete URL; deriving both from one
 * parser keeps the two representations from drifting apart.
 *
 * @module @desi-event/api-contract/path
 */

import { ApiContractError } from './errors.js'

/** A path segment that names a parameter, e.g. `:eventId`. */
const PARAM_SEGMENT = /^:([A-Za-z_][A-Za-z0-9_]*)$/

/**
 * Split a route path into segments, dropping the empty leading segment.
 *
 * @param {string} path Fastify-style route path.
 * @returns {string[]} Non-empty path segments.
 */
function segmentsOf(path) {
  return path.split('/').filter((segment) => segment.length > 0)
}

/**
 * List the path parameter names a route declares, in order of appearance.
 *
 * @param {string} path Fastify-style route path, e.g. `/v1/events/:id/publish`.
 * @returns {string[]} Parameter names without the leading colon.
 */
export function pathParamNames(path) {
  const names = []

  for (const segment of segmentsOf(path)) {
    const match = PARAM_SEGMENT.exec(segment)
    if (match) names.push(match[1])
  }

  return names
}

/**
 * Convert a Fastify-style path to the OpenAPI template form.
 *
 * @param {string} path Fastify-style route path, e.g. `/v1/events/:slug`.
 * @returns {string} OpenAPI path, e.g. `/v1/events/{slug}`.
 */
export function toOpenApiPath(path) {
  const converted = segmentsOf(path).map((segment) => {
    const match = PARAM_SEGMENT.exec(segment)
    return match ? `{${match[1]}}` : segment
  })

  return `/${converted.join('/')}`
}

/**
 * Substitute path parameters to produce a concrete, encoded path.
 *
 * Every value is passed through `encodeURIComponent`, so a slug containing a
 * slash cannot smuggle an extra path segment into the request.
 *
 * @param {string} path Fastify-style route path.
 * @param {Record<string, unknown>} [params] Parameter values by name.
 * @returns {string} The path with every `:name` segment replaced.
 * @throws {ApiContractError} When a declared parameter is missing or empty.
 */
export function buildPath(path, params = {}) {
  const source = params ?? {}

  const filled = segmentsOf(path).map((segment) => {
    const match = PARAM_SEGMENT.exec(segment)
    if (!match) return segment

    const name = match[1]
    const value = source[name]

    if (value === undefined || value === null || value === '') {
      throw new ApiContractError(`Missing path parameter "${name}" for ${path}`, {
        code: 'MISSING_PATH_PARAM',
        details: { path, param: name },
      })
    }

    return encodeURIComponent(String(value))
  })

  return `/${filled.join('/')}`
}

/**
 * Join a base URL and a path without doubling or dropping the separator.
 *
 * @param {string} baseUrl Origin, optionally with a path prefix and trailing slash.
 * @param {string} path Absolute path beginning with `/`.
 * @returns {string} The joined URL.
 */
export function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, '')}${path}`
}

/**
 * Reduce a path to its routing shape, with parameter names blanked out.
 *
 * `/v1/events/:slug` and `/v1/events/:id` are different OpenAPI paths but the
 * same route as far as a router is concerned — Fastify refuses to register
 * both. Comparing shapes catches that clash in the contract instead of at boot.
 *
 * @param {string} path Fastify-style route path.
 * @returns {string} The path with every parameter segment replaced by `{}`.
 */
export function routeShape(path) {
  const shaped = segmentsOf(path).map((segment) => (PARAM_SEGMENT.test(segment) ? '{}' : segment))

  return `/${shaped.join('/')}`
}
