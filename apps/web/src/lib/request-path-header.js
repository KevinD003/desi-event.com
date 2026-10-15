/**
 * The request header `proxy.js` writes the path and query into.
 *
 * Its own module so the proxy can import it without importing `next/headers`,
 * which belongs to the render and has no business in the proxy's graph.
 *
 * @module lib/request-path-header
 */

/** The header name. Lower case, as every header reaches a server. */
export const REQUEST_PATH_HEADER = 'x-desi-request-path'
