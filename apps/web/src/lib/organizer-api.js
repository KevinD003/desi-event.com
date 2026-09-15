/**
 * Server-side reads for the organiser screens.
 *
 * Distinct from `lib/api.js` in one important way: **nothing here falls back**.
 * The public pages answer a dead API with a curated catalogue so a visitor
 * still sees a site; an organiser screen must never do that. Showing somebody a
 * venue list that is not their venue list — or worse, an editor over a layout
 * that is not the real one — would invite them to act on fiction.
 *
 * So these throw, and the screens say the service is unavailable.
 *
 * @module lib/organizer-api
 */

import { cookies } from 'next/headers'

import { getApiBaseUrl } from './api-client.js'

/** How long an organiser read may take. Longer than a public read: this is work, not browsing. */
const TIMEOUT_MS = 5000

/**
 * Call the API as the signed-in caller.
 *
 * Forwards the request's cookies and nothing else. The proxy does the same for
 * the browser; this is the server-render half of the same rule.
 *
 * @param {string} path An API path beginning `/v1/`.
 * @param {object} [options] Fetch options.
 * @returns {Promise<object>} The parsed body.
 * @throws {Error} When the API refuses or cannot be reached, carrying `status`.
 */
export async function callApi(path, options = {}) {
  const jar = await cookies()
  const cookieHeader = jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `The API answered ${response.status}.`)

    error.status = response.status
    error.code = body?.error?.code ?? null
    throw error
  }

  return body
}

/**
 * The venues this caller may author, for one organisation or all of theirs.
 *
 * @param {string} [organizationId] Restrict to one organisation.
 * @returns {Promise<object[]>} The venues.
 */
export async function listVenues(organizationId) {
  const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''
  const body = await callApi(`/v1/venues${query}`)

  return body.data ?? []
}

/**
 * One venue.
 *
 * @param {string} id The venue id.
 * @returns {Promise<object>} The venue.
 */
export async function getVenue(id) {
  return (await callApi(`/v1/venues/${encodeURIComponent(id)}`)).data
}

/**
 * The seating maps for a venue, with their version history.
 *
 * @param {string} venueId The venue.
 * @returns {Promise<object[]>} The maps.
 */
export async function listMaps(venueId) {
  return (await callApi(`/v1/venues/${encodeURIComponent(venueId)}/maps`)).data ?? []
}

/**
 * One map version, with its whole layout.
 *
 * @param {string} versionId The version.
 * @returns {Promise<object>} The version and its layout.
 */
export async function getMapVersion(versionId) {
  return (await callApi(`/v1/venue-map-versions/${encodeURIComponent(versionId)}`)).data
}
