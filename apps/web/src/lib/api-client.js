/**
 * The API client itself, with no server-only baggage attached.
 *
 * This exists as a separate module from `api.js` for one reason: `api.js`
 * imports the curated fallback catalogue, which is thirty kilobytes of event
 * data that exists so server-rendered pages still work when the API is down.
 * The browser never needs it — a client component that reached for the API
 * client dragged the whole catalogue into the browser bundle with it.
 *
 * Anything imported from a `'use client'` component belongs here. Anything that
 * falls back to sample data belongs in `api.js`, which is only ever imported on
 * the server.
 *
 * @module lib/api-client
 */

import { createApiClient } from '@desi-event/api-contract'

/** Where the ticketing service lives when nothing is configured. */
export const DEFAULT_API_URL = 'http://127.0.0.1:4000'

/** @type {object|null} */
let cachedClient = null
/** @type {string|null} */
let cachedBaseUrl = null

/**
 * The configured API origin.
 *
 * Read through `process.env.NEXT_PUBLIC_API_URL` rather than destructured, so
 * that Next's build-time inlining of `NEXT_PUBLIC_*` works in browser bundles.
 *
 * @returns {string} An absolute origin such as `http://127.0.0.1:4000`.
 */
export function getApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL

  return typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : DEFAULT_API_URL
}

/**
 * The memoised API client.
 *
 * @returns {object} A client bound to the configured origin.
 */
export function getApiClient() {
  const baseUrl = getApiBaseUrl()

  if (!cachedClient || cachedBaseUrl !== baseUrl) {
    cachedClient = createApiClient({ baseUrl })
    cachedBaseUrl = baseUrl
  }

  return cachedClient
}

/**
 * Discard the memoised client. Exists for tests, which swap the environment
 * between cases.
 *
 * @returns {void}
 */
export function resetApiClient() {
  cachedClient = null
  cachedBaseUrl = null
}
