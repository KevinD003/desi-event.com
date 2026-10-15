/**
 * The path of the request being rendered, on the server.
 *
 * A server layout is not told which page it wraps. `proxy.js` copies the path
 * onto the request as {@link REQUEST_PATH_HEADER} before any layout runs, and
 * this reads it back.
 *
 * The header cannot be supplied by a browser: the proxy overwrites it on every
 * request it matches, and every page request is one it matches. Even so,
 * nothing here trusts the value beyond what a path is good for — choosing a
 * colour register and building a same-site `next` link, which is validated
 * again by `safeNextPath` before it is used.
 *
 * @module lib/request-path
 */

import { headers } from 'next/headers'

import { REQUEST_PATH_HEADER } from './request-path-header.js'

export { REQUEST_PATH_HEADER }

/**
 * The current request's path and query, as the proxy recorded it.
 *
 * @returns {Promise<string|null>} Something like `/tickets/abc?tab=pass`, or null outside a proxied request.
 */
export async function requestPath() {
  const list = await headers()
  const value = list.get(REQUEST_PATH_HEADER)

  return typeof value === 'string' && value.startsWith('/') ? value : null
}

/**
 * The current request's path without its query.
 *
 * @returns {Promise<string|null>} The pathname, or null outside a proxied request.
 */
export async function requestPathname() {
  const value = await requestPath()

  return value ? value.split('?')[0] : null
}
