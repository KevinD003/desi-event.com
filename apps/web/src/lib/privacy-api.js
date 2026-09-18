/**
 * Server-side reads and commands for the privacy screens.
 *
 * Separate from `lib/organizer-api.js` for the same reason that file is
 * separate from `lib/api.js`: the audience is different and so is the failure
 * rule. A public page may fall back to a curated catalogue; an organiser page
 * may not, because acting on fiction is worse than seeing nothing. A privacy
 * page may not either, and one thing more — it must never soften a refusal.
 *
 * ## What the browser is not allowed to decide
 *
 * Every function here takes an organisation id and puts it **in the path**,
 * because that is where the API's capability guard reads it from. Nothing here
 * accepts a state, a policy version, an idempotency key, a confirmation hash,
 * lease data, a `force` flag or a `skipHolds` flag, and nothing here invents
 * one. The server decides all of it; the browser's entire authority is "this
 * operator asked, with this session, for this organisation".
 *
 * That is not a style preference. `privacyRequestConfirmSchema` deliberately
 * has no `confirmed` boolean and no `force`, so that a replayed request cannot
 * perform a redaction. Passing such a field from here would be inventing the
 * hole the schema was shaped to avoid.
 *
 * ## Why the errors come through unflattened
 *
 * `callApi` throws with `status` and `code` attached. The privacy surface
 * distinguishes refusals that look identical over HTTP — a 403 is a missing
 * capability *or* a lapsed step-up, and a 409 is a legal hold *or* a request
 * already in flight *or* a confirmation that expired. Screens need the code to
 * say the right sentence, so nothing here collapses an error into a boolean.
 *
 * @module lib/privacy-api
 */

import { callApi } from './organizer-api.js'

/**
 * Build a query string from defined values only.
 *
 * An explicit helper rather than `URLSearchParams` over the whole object,
 * because `undefined` stringifies to the literal `"undefined"` and a filter
 * reading `state=undefined` is a filter the API will reject as invalid rather
 * than ignore.
 *
 * @param {Record<string, string|number|undefined|null>} params The filters.
 * @returns {string} A query string beginning `?`, or the empty string.
 */
function query(params) {
  const pairs = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  )

  if (pairs.length === 0) return ''

  return `?${pairs.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')}`
}

/**
 * The privacy requests raised in one organisation.
 *
 * @param {string} organizationId Whose requests.
 * @param {object} [options] Filters.
 * @param {string} [options.state] One `PrivacyRequestState`.
 * @param {string} [options.subjectId] One subject's requests only.
 * @param {number} [options.page] 1-based page.
 * @param {number} [options.perPage] Page size.
 * @returns {Promise<object>} `{ data, pagination }`.
 */
export async function listPrivacyRequests(organizationId, options = {}) {
  const search = query({
    state: options.state,
    subjectId: options.subjectId,
    page: options.page,
    perPage: options.perPage,
  })

  return callApi(`/v1/organizations/${organizationId}/privacy/requests${search}`)
}

/**
 * One privacy request.
 *
 * @param {string} organizationId Whose request.
 * @param {string} requestId Which request.
 * @returns {Promise<object>} `{ data }`.
 */
export async function getPrivacyRequest(organizationId, requestId) {
  return callApi(`/v1/organizations/${organizationId}/privacy/requests/${requestId}`)
}

/**
 * One request's evidence timeline.
 *
 * Request-scoped by the contract. Hold placement and release are written with a
 * null `privacyRequestId`, so they do not appear here — the hold list is where
 * those live, and the screens say so rather than implying this is everything
 * that ever happened to the subject.
 *
 * @param {string} organizationId Whose request.
 * @param {string} requestId Which request.
 * @param {object} [options] Pagination.
 * @param {number} [options.page] 1-based page.
 * @param {number} [options.perPage] Page size.
 * @returns {Promise<object>} `{ data, pagination }`.
 */
export async function listPrivacyRequestEvents(organizationId, requestId, options = {}) {
  const search = query({ page: options.page, perPage: options.perPage })

  return callApi(
    `/v1/organizations/${organizationId}/privacy/requests/${requestId}/events${search}`,
  )
}

/**
 * The holds in one organisation.
 *
 * @param {string} organizationId Whose holds.
 * @param {object} [options] Filters.
 * @param {string} [options.state] One `PrivacyHoldState`.
 * @param {string} [options.subjectId] One subject's holds only.
 * @param {number} [options.page] 1-based page.
 * @param {number} [options.perPage] Page size.
 * @returns {Promise<object>} `{ data, pagination }`.
 */
export async function listPrivacyHolds(organizationId, options = {}) {
  const search = query({
    state: options.state,
    subjectId: options.subjectId,
    page: options.page,
    perPage: options.perPage,
  })

  return callApi(`/v1/organizations/${organizationId}/privacy/holds${search}`)
}

/**
 * Every retention rehearsal the platform has recorded.
 *
 * Takes no organisation id, and that is not an oversight. `RetentionSweep` has
 * no `organizationId` — a sweep counts across every tenant at once — so there
 * is no honest per-organisation figure to ask for, and a parameter that looked
 * like one would be a parameter that lied.
 *
 * There is deliberately no sibling that *starts* a sweep. The API exposes no
 * such route: initiation is an operator action against the worker, so the one
 * surface reachable from a browser cannot begin a job whose durations nobody
 * has approved.
 *
 * @param {object} [options] Filters.
 * @param {string} [options.retentionClass] One class only.
 * @param {string} [options.state] One `RetentionSweepState`.
 * @param {number} [options.page] 1-based page.
 * @param {number} [options.perPage] Page size.
 * @returns {Promise<object>} `{ data, pagination, notEvaluated }`.
 */
export async function listRetentionSweeps(options = {}) {
  const search = query({
    retentionClass: options.retentionClass,
    state: options.state,
    page: options.page,
    perPage: options.perPage,
  })

  return callApi(`/v1/operations/retention/sweeps${search}`)
}
