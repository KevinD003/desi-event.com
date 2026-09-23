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
import { parseRetryAfter } from './refusal.js'

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
 * @throws {Error} When the API refuses or cannot be reached, carrying `status`,
 *   `code`, and `retryAfterSeconds` when the API said how long to wait.
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
    // So a rate-limited page can say how long, rather than "a little".
    error.retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))
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

/**
 * The events this caller may author.
 *
 * Asks for the drafts explicitly. `GET /events` shows an anonymous caller only
 * what is public; a member of an organisation additionally sees that
 * organisation's private events, and the organiser's own list is the one place
 * that matters. Sorted newest first: the thing somebody just created is the
 * thing they came back for.
 *
 * @param {object} [options] Query options.
 * @param {string} [options.organizationId] Restrict to one organisation.
 * @param {number} [options.perPage] Page size.
 * @returns {Promise<{events: object[], pagination: object}>} The events and their page counters.
 */
export async function listOrganizerEvents(options = {}) {
  const query = new URLSearchParams({
    sort: 'createdAt:desc',
    perPage: String(options.perPage ?? 50),
  })

  if (options.organizationId) query.set('organizationId', options.organizationId)

  const body = await callApi(`/v1/events?${query.toString()}`)

  return { events: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * One event, by id.
 *
 * @param {string} id The event id.
 * @returns {Promise<object>} The event with its venue, organisation and tiers.
 */
export async function getOrganizerEvent(id) {
  return (await callApi(`/v1/events/${encodeURIComponent(id)}`)).data
}

/**
 * An event's sessions.
 *
 * @param {string} id The event id.
 * @returns {Promise<{data: object[], meta: object}>} The sessions and the event's revision.
 */
export async function getEventSessions(id) {
  return callApi(`/v1/events/${encodeURIComponent(id)}/sessions`)
}

/**
 * Whether an event is ready to be published, and every reason it is not.
 *
 * @param {string} id The event id.
 * @returns {Promise<object>} The readiness result.
 */
export async function getEventReadiness(id) {
  return (await callApi(`/v1/events/${encodeURIComponent(id)}/readiness`)).data
}

/**
 * The lifecycle moves available out of an event's current state.
 *
 * @param {string} id The event id.
 * @returns {Promise<object>} The current status and its transitions.
 */
export async function getEventTransitions(id) {
  return (await callApi(`/v1/events/${encodeURIComponent(id)}/transitions`)).data
}

/**
 * An event's moderation history, newest first.
 *
 * @param {string} id The event id.
 * @returns {Promise<object[]>} The decisions taken on this event.
 */
export async function getModerationHistory(id) {
  return (await callApi(`/v1/events/${encodeURIComponent(id)}/moderation-history`)).data ?? []
}

/**
 * What each tier costs a buyer all in.
 *
 * @param {string} id The event id.
 * @returns {Promise<object[]>} One breakdown per tier.
 */
export async function getPricePreview(id) {
  return (await callApi(`/v1/events/${encodeURIComponent(id)}/price-preview`)).data ?? []
}

/**
 * The events waiting for a moderator.
 *
 * @param {object} [options] Query options.
 * @param {string} [options.status] Restrict to one status.
 * @returns {Promise<{events: object[], pagination: object|null}>} The queue.
 */
export async function getModerationQueue(options = {}) {
  const query = new URLSearchParams()

  if (options.status) query.set('status', options.status)

  const suffix = query.toString() ? `?${query.toString()}` : ''
  const body = await callApi(`/v1/moderation/events${suffix}`)

  return { events: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * The finance view for one organisation, or for the platform.
 *
 * @param {object} [options] Query options.
 * @param {string} [options.organizationId] Restrict to one organisation.
 * @param {string} [options.currency] Which currency.
 * @param {string} [options.from] Inclusive lower bound, ISO-8601.
 * @param {string} [options.to] Exclusive upper bound, ISO-8601.
 * @returns {Promise<object>} The summary.
 */
export async function getFinanceSummary(options = {}) {
  const query = new URLSearchParams()

  for (const key of ['organizationId', 'currency', 'from', 'to']) {
    if (options[key]) query.set(key, options[key])
  }

  const suffix = query.toString() ? `?${query.toString()}` : ''

  return (await callApi(`/v1/finance/summary${suffix}`)).data
}

/**
 * Payouts for one organisation.
 *
 * @param {string} organizationId Whose.
 * @returns {Promise<object[]>} The payouts, newest first.
 */
export async function listPayouts(organizationId) {
  const body = await callApi(
    `/v1/finance/payouts?organizationId=${encodeURIComponent(organizationId)}`,
  )

  return body.data ?? []
}

/**
 * Disputes against one organisation's payments.
 *
 * @param {string} organizationId Whose.
 * @returns {Promise<object[]>} The disputes, newest first.
 */
export async function listDisputes(organizationId) {
  const body = await callApi(
    `/v1/finance/disputes?organizationId=${encodeURIComponent(organizationId)}`,
  )

  return body.data ?? []
}

/**
 * The reconciliation queue.
 *
 * @param {object} [options] Query options.
 * @param {string} [options.organizationId] Restrict to one organisation.
 * @param {string} [options.state] Restrict to one state.
 * @returns {Promise<{tasks: object[], pagination: object|null}>} The queue.
 */
export async function getReconciliationQueue(options = {}) {
  const query = new URLSearchParams()

  for (const key of ['organizationId', 'state', 'kind', 'aging']) {
    if (options[key]) query.set(key, options[key])
  }

  const suffix = query.toString() ? `?${query.toString()}` : ''
  const body = await callApi(`/v1/operations/reconciliation${suffix}`)

  return { tasks: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * The notification outbox, as operations sees it.
 *
 * @param {object} [options] Query options.
 * @param {string} [options.status] Restrict to one status.
 * @returns {Promise<{messages: object[], pagination: object|null}>} The queue.
 */
export async function getNotificationQueue(options = {}) {
  const query = new URLSearchParams()

  if (options.status) query.set('status', options.status)

  const suffix = query.toString() ? `?${query.toString()}` : ''
  const body = await callApi(`/v1/operations/notifications${suffix}`)

  return { messages: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * Refunds for one organisation.
 *
 * @param {object} options Query options.
 * @param {string} options.organizationId Whose.
 * @param {string} [options.status] Restrict to one status.
 * @returns {Promise<{refunds: object[], pagination: object|null}>} The queue.
 */
export async function getRefundQueue(options) {
  const query = new URLSearchParams({ organizationId: options.organizationId })

  if (options.status) query.set('status', options.status)

  const body = await callApi(`/v1/refunds?${query.toString()}`)

  return { refunds: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * Organiser analytics for one organisation.
 *
 * `organizationId` is required by the API and therefore required here. A helper
 * that quietly omitted it would turn an organisation question into a platform
 * one at the first call site that forgot.
 *
 * @param {object} options Query options.
 * @param {string} options.organizationId Whose analytics.
 * @param {string} [options.currency] Which currency the money figures are in.
 * @param {string} [options.eventId] Narrow to one event.
 * @param {string} [options.eventSessionId] Narrow sales to one session.
 * @param {string} [options.from] Window start, ISO.
 * @param {string} [options.to] Window end, ISO.
 * @returns {Promise<object>} The analytics payload.
 */
export async function getAnalytics(options) {
  const query = new URLSearchParams({ organizationId: options.organizationId })

  for (const key of ['currency', 'eventId', 'eventSessionId', 'from', 'to']) {
    if (options[key]) query.set(key, options[key])
  }

  const body = await callApi(`/v1/analytics/summary?${query.toString()}`)

  return body.data
}

/**
 * One reconciliation item, with everything a decision about it needs.
 *
 * @param {string} id Which item.
 * @returns {Promise<object>} The task.
 */
export async function getReconciliationTask(id) {
  const body = await callApi(`/v1/operations/reconciliation/${encodeURIComponent(id)}`)

  return body.data
}

/**
 * One refund, with its lines and its attempt count.
 *
 * @param {string} id Which refund.
 * @returns {Promise<object>} The refund.
 */
export async function getRefund(id) {
  const body = await callApi(`/v1/refunds/${encodeURIComponent(id)}`)

  return body.data
}

/**
 * The tickets the signed-in caller holds.
 *
 * @returns {Promise<{tickets: object[], pagination: object|null}>} Their tickets.
 */
export async function getMyTickets() {
  const body = await callApi('/v1/tickets')

  return { tickets: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * One ticket, its event, and every transfer it has been through.
 *
 * @param {string} id Which ticket.
 * @returns {Promise<object>} The detail payload.
 */
export async function getTicket(id) {
  const body = await callApi(`/v1/tickets/${encodeURIComponent(id)}`)

  return body.data
}

/**
 * The events this account may admit people to, with the authority for each.
 *
 * `GET /v1/tickets/admission/events`. Asked of the server on every request:
 * a door scope granted or withdrawn a moment ago is already reflected.
 *
 * @returns {Promise<Array<object>>} The entries.
 */
export async function getAdmissionEvents() {
  const body = await callApi('/v1/tickets/admission/events')

  return body.data
}
