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
 * @param {string} [options.status] Restrict to one status, such as `DELETED`.
 * @param {number} [options.perPage] Page size.
 * @returns {Promise<{events: object[], pagination: object}>} The events and their page counters.
 */
export async function listOrganizerEvents(options = {}) {
  const query = new URLSearchParams({
    sort: 'createdAt:desc',
    perPage: String(options.perPage ?? 50),
  })

  if (options.organizationId) query.set('organizationId', options.organizationId)
  // A deleted event is listed only when asked for by name: the API leaves
  // DELETED out of every list that does not name it.
  if (options.status) query.set('status', options.status)

  const body = await callApi(`/v1/events?${query.toString()}`)

  return { events: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * An organisation's promo codes, newest first.
 *
 * `GET /v1/organizations/:id/promo-codes`. The query carries ids and a page
 * number only — never a code, which is a bearer discount.
 *
 * @param {string} organizationId The organisation.
 * @param {object} [options] Filters.
 * @param {string} [options.eventId] One event's codes, with the organisation-wide ones.
 * @param {number} [options.page] Which page.
 * @returns {Promise<{codes: object[], pagination: object|null}>} The codes.
 */
export async function listPromoCodes(organizationId, options = {}) {
  const query = new URLSearchParams({ perPage: '50' })

  if (options.eventId) query.set('eventId', options.eventId)
  if (Number.isInteger(options.page) && options.page > 1) query.set('page', String(options.page))

  const body = await callApi(
    `/v1/organizations/${encodeURIComponent(organizationId)}/promo-codes?${query.toString()}`,
  )

  return { codes: body.data ?? [], pagination: body.pagination ?? null }
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
 * An event's ticket types as its organiser sees them: hidden and draft ones
 * too, with what is sold and held, whether each can be removed, and the
 * event's revision.
 *
 * `GET /v1/events/:id/tiers`, answered only to members who may see drafts.
 *
 * @param {string} id The event id.
 * @returns {Promise<{data: object[], meta: {revision: number}}>} The ticket types and the revision.
 */
export async function getEventTicketTypes(id) {
  return callApi(`/v1/events/${encodeURIComponent(id)}/tiers`)
}

/**
 * An event's pictures, each with its review state, and the event's revision.
 *
 * For the organiser's editor and the moderator's review. Never a public read:
 * the API answers it only to members who may see the event's drafts, to
 * moderators and to platform administrators.
 *
 * @param {string} id The event id.
 * @returns {Promise<{data: object[], meta: {revision: number}}>} The pictures and the revision.
 */
export async function getEventMedia(id) {
  return callApi(`/v1/events/${encodeURIComponent(id)}/media`)
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
 * Website links, for the administrators who turn them on and off.
 *
 * @param {object} [options] Query options.
 * @param {string} [options.state] `waiting` (the API's default), `drafts`, `on`, `off` or `all`.
 * @param {string} [options.q] Matches the title, the web address or the website.
 * @param {number} [options.page] The page.
 * @param {number} [options.perPage] Rows per page.
 * @returns {Promise<{links: object[], pagination: object|null}>} The list.
 */
export async function getWebsiteLinks(options = {}) {
  const query = new URLSearchParams()

  if (options.state) query.set('state', options.state)
  if (options.q) query.set('q', options.q)
  if (options.page) query.set('page', String(options.page))
  if (options.perPage) query.set('perPage', String(options.perPage))

  const suffix = query.toString() ? `?${query.toString()}` : ''
  const body = await callApi(`/v1/moderation/website-links${suffix}`)

  return { links: body.data ?? [], pagination: body.pagination ?? null }
}

/** The fields `GET /v1/platform/events` takes, and nothing else. */
const PLATFORM_EVENT_KEYS = Object.freeze([
  'q',
  'status',
  'organizationId',
  'deleted',
  'imported',
  'sort',
  'page',
  'perPage',
])

/**
 * Every organisation's events, for the Desi-Event team's platform editors
 * (`GET /v1/platform/events`).
 *
 * Only the fields the endpoint's query schema names are sent, so a page cannot
 * widen the request by passing a key through. The API refuses the list to
 * anybody without the platform editing capability.
 *
 * @param {object} [options] Query options.
 * @param {string} [options.q] Matches the title, the web address or the organisation's name.
 * @param {string} [options.status] One status.
 * @param {string} [options.organizationId] One organisation's events.
 * @param {string} [options.deleted] `exclude` (the API's default), `only` or `include`.
 * @param {string} [options.imported] `include` (the API's default), `only` or `exclude`.
 * @param {string} [options.sort] `updatedAt:desc`, `startsAt:asc` or `createdAt:desc`.
 * @param {number} [options.page] Which page.
 * @param {number} [options.perPage] How many to a page.
 * @returns {Promise<{events: object[], pagination: object|null}>} The rows and their counters.
 */
export async function listPlatformEvents(options = {}) {
  const query = new URLSearchParams()

  for (const key of PLATFORM_EVENT_KEYS) {
    const value = options[key]

    if (value === undefined || value === null || value === '') continue

    query.set(key, String(value))
  }

  const suffix = query.toString() ? `?${query.toString()}` : ''
  const body = await callApi(`/v1/platform/events${suffix}`)

  return { events: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * The Desi-Event team's editing sittings on an event, newest first, each with
 * its reason and what it changed. The administrator's name is sent only to the
 * Desi-Event team.
 *
 * @param {string} id The event id.
 * @returns {Promise<object[]>} The sittings.
 */
export async function getPlatformEdits(id) {
  return (await callApi(`/v1/events/${encodeURIComponent(id)}/platform-edits`)).data ?? []
}

/**
 * Pictures of posted events waiting for the Desi-Event team, oldest first
 * (`GET /v1/moderation/media`).
 *
 * @param {object} [options] Query options.
 * @param {string} [options.status] `PENDING` (the API's default) or `REJECTED`.
 * @param {number} [options.page] Which page.
 * @param {number} [options.perPage] How many to a page.
 * @returns {Promise<{pictures: object[], pagination: object|null}>} The queue.
 */
export async function getMediaQueue(options = {}) {
  const query = new URLSearchParams()

  if (options.status) query.set('status', options.status)
  if (options.page) query.set('page', String(options.page))
  if (options.perPage) query.set('perPage', String(options.perPage))

  const suffix = query.toString() ? `?${query.toString()}` : ''
  const body = await callApi(`/v1/moderation/media${suffix}`)

  return { pictures: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * What deleting an event would do now, as the server decides it: the outcome
 * or the choice, the counts its sentences are built from, and whether this
 * reader may.
 *
 * @param {string} id The event id.
 * @returns {Promise<object>} The preview.
 */
export async function getDeletionPreview(id) {
  return (await callApi(`/v1/events/${encodeURIComponent(id)}/deletion`)).data
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

/** The fields `GET /v1/traffic/events` takes, and nothing else. */
const PLATFORM_TRAFFIC_KEYS = Object.freeze([
  'q',
  'scope',
  'organizationId',
  'from',
  'to',
  'page',
  'perPage',
])

/**
 * Every event's visits, for platform administrators (`GET /v1/traffic/events`).
 *
 * Only the fields the endpoint's query schema names are sent, so a page cannot
 * widen the request by passing a key through; the API refuses the whole list
 * to anybody without the platform capability that reads it.
 *
 * @param {object} [options] Query options.
 * @param {string} [options.q] Matches the title, the web address or the organiser's name.
 * @param {string} [options.scope] `public` (the API's default) or `all`.
 * @param {string} [options.organizationId] One organisation's events.
 * @param {string} [options.from] Window start, ISO.
 * @param {string} [options.to] Window end, ISO.
 * @param {number} [options.page] Which page.
 * @param {number} [options.perPage] How many to a page.
 * @returns {Promise<{data: object, pagination: object|null}>} The list and its counters.
 */
export async function getPlatformTraffic(options = {}) {
  const query = new URLSearchParams()

  for (const key of PLATFORM_TRAFFIC_KEYS) {
    const value = options[key]

    if (value === undefined || value === null || value === '') continue

    query.set(key, String(value))
  }

  const suffix = query.toString() ? `?${query.toString()}` : ''
  const body = await callApi(`/v1/traffic/events${suffix}`)

  return { data: body.data, pagination: body.pagination ?? null }
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
 * The tickets the signed-in caller holds, newest first.
 *
 * @param {object} [options] Options.
 * @param {number} [options.perPage] How many to read; the API allows up to 100 and defaults to 20.
 * @returns {Promise<{tickets: object[], pagination: object|null}>} Their tickets.
 */
export async function getMyTickets({ perPage } = {}) {
  const body = await callApi(perPage ? `/v1/tickets?perPage=${perPage}` : '/v1/tickets')

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
 * a door scope granted or withdrawn a moment ago is already reflected. A
 * platform super administrator's list covers every organisation and can be
 * narrowed by organisation and by a search; neither value is a secret, so
 * both travel in the query string. Empty values are left out.
 *
 * @param {object} [filters] Narrow the list.
 * @param {string} [filters.organizationId] One organisation's events.
 * @param {string} [filters.q] A search of the event title or organisation name.
 * @returns {Promise<{entries: Array<object>, meta: {scope: string, organizations: Array<{id: string, name: string}>, truncated: boolean}}>} The list.
 */
export async function getAdmissionEvents({ organizationId, q } = {}) {
  const query = new URLSearchParams()

  if (organizationId) query.set('organizationId', organizationId)
  if (q) query.set('q', q)

  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  const body = await callApi(`/v1/tickets/admission/events${suffix}`)

  return {
    entries: body.data ?? [],
    meta: body.meta ?? { scope: 'MEMBERSHIPS', organizations: [], truncated: false },
  }
}

/**
 * Keep the page fields a list route takes, and nothing else.
 *
 * @param {object} options What the page asked for.
 * @param {ReadonlyArray<string>} keys The fields the route's query schema names.
 * @returns {string} The query string, with its `?`, or an empty string.
 */
function pageQuery(options, keys) {
  const query = new URLSearchParams()

  for (const key of keys) {
    const value = options?.[key]

    if (value === undefined || value === null || value === '') continue

    query.set(key, String(value))
  }

  return query.size > 0 ? `?${query.toString()}` : ''
}

/**
 * An event's payments taken at the door and its bookings still unpaid there,
 * for the organiser's "Payments at the venue" page (`venuePayments.report`,
 * SPEC3 §9.8, SPEC3-XI §9.8).
 *
 * Asks for a second factor within the FINANCE_VIEW window: a lapsed one is
 * thrown as `STEP_UP_REQUIRED`, which the page offers to clear in place.
 *
 * @param {string} id The event id.
 * @param {object} [options] Which page.
 * @param {number} [options.page] Which page of payments and unpaid bookings.
 * @param {number} [options.perPage] How many to a page.
 * @returns {Promise<object>} The report.
 */
export async function getVenuePayments(id, options = {}) {
  const suffix = pageQuery(options, ['page', 'perPage'])

  return (await callApi(`/v1/events/${encodeURIComponent(id)}/venue-payments${suffix}`)).data
}

/**
 * An event's bookings waiting to be paid at the door, each with its unpaid
 * tickets (`venueBookings.unpaid`, SPEC3-XI §11.1): for the Desi-Event team's
 * "Bookings waiting to be paid at the door". Buyer and attendee names are null
 * for a platform reader. Asks for a second factor within the FINANCE_VIEW
 * window, as the report does.
 *
 * @param {string} id The event id.
 * @param {object} [options] Which page, or which booking.
 * @param {number} [options.page] Which page.
 * @param {number} [options.perPage] How many to a page.
 * @param {string} [options.order] One booking, by its reference.
 * @returns {Promise<object>} `{ eventId, eventTitle, currency, bookings, pagination }`.
 */
export async function getVenueBookings(id, options = {}) {
  const suffix = pageQuery(options, ['page', 'perPage', 'order'])

  return (await callApi(`/v1/events/${encodeURIComponent(id)}/venue-bookings${suffix}`)).data
}
