/**
 * Server-side reads for the payout-setup screen.
 *
 * One function, because there is one thing to read. The action goes through
 * `apiFetch` from the client component, so the browser's own session carries it
 * — the same split the privacy screens use.
 *
 * The organisation id is encoded before it enters the path. `privacy-api.js`
 * interpolates unencoded at five call sites; the value it passes is resolved
 * server-side from session memberships rather than supplied by a caller, so it
 * is not reachable today, but a module written after that one should not copy
 * the shape. `organizer-api.js:84` is the precedent that does encode.
 *
 * @module lib/connect-api
 */

import { callApi } from './organizer-api.js'

/**
 * The simulated payout-setup state for one organisation.
 *
 * @param {string} organizationId Whose state.
 * @returns {Promise<object>} `{ data }`.
 */
export async function getConnectStatus(organizationId) {
  return callApi(`/v1/organizations/${encodeURIComponent(organizationId)}/connect`)
}
