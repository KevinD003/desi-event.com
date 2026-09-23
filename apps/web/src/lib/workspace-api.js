/**
 * Server-side reads for the team, notification, refund and reconciliation lists.
 *
 * Built on `callApi` from `./organizer-api.js`, and for the same reason it
 * gives: **nothing here falls back**. A list of team members, messages or
 * refunds that was not the real list would invite somebody to act on fiction,
 * so every helper throws what `callApi` threw — `status`, `code` and
 * `retryAfterSeconds` intact — and the page draws the refusal.
 *
 * ## Why the query strings are built here
 *
 * Every list takes filters a person chose in a GET form, and every one of those
 * values came from the address bar. Each helper copies only the fields its
 * endpoint's query schema names (`packages/schemas/src/requests.js`), encodes
 * them with `URLSearchParams`, and leaves out anything empty. A page cannot
 * widen a request by passing an extra key through, and an organisation id is
 * never spliced into a path unencoded.
 *
 * ## The small pure helpers at the bottom
 *
 * `readPage`, `listHref`, `isPastTheEnd`, `formatInstant`, `STATUS_TONE_CLASSES`
 * and `PAGER_LINK_CLASSES` are used by the same list pages to read their page
 * number, build their pagination links, tell an empty list from a page past its
 * end, print their times, colour a status word and size their page links. They are pure, and live here
 * rather than in a component because the pages that use them are server
 * components and nothing that imports this module may reach a browser:
 * `callApi` reads the request's cookies.
 *
 * @module lib/workspace-api
 */

import { callApi } from './organizer-api.js'

/** The page size the four lists ask for. The API's ceiling is 100. */
export const LIST_PAGE_SIZE = 50

/** The events a door-scope picker offers: the API's largest page. */
const EVENT_PICKER_SIZE = 100

/**
 * A query string from the named fields of an options object.
 *
 * Empty strings, null and undefined are left out, so an unset filter is absent
 * from the request rather than sent as `status=`.
 *
 * @param {object} options What the caller passed.
 * @param {ReadonlyArray<string>} keys The fields this endpoint accepts.
 * @returns {string} `?a=1&b=2`, or the empty string.
 */
function queryFrom(options, keys) {
  const query = new URLSearchParams()

  for (const key of keys) {
    const value = options?.[key]

    if (value === undefined || value === null || value === '') continue

    query.set(key, String(value))
  }

  const text = query.toString()

  return text ? `?${text}` : ''
}

/**
 * The team of one organisation: members, open invitations, and the roles the
 * caller may grant.
 *
 * `GET /v1/organizations/:id/members`. The server decides `emailVisibility`
 * (`FULL`, `STEP_UP_REQUIRED` or `HIDDEN`) and the shape follows from it; this
 * returns the payload as it came.
 *
 * @param {string} organizationId Whose team.
 * @returns {Promise<{emailVisibility: string, members: object[], invitations: object[], assignableRoles: string[]}>} The team.
 */
export async function getTeam(organizationId) {
  const body = await callApi(`/v1/organizations/${encodeURIComponent(organizationId)}/members`)

  return body.data
}

/**
 * One organisation's events for the door-scope picker: the hundred that start
 * latest, in date order.
 *
 * `GET /v1/events?organizationId=…&perPage=100&sort=startsAt:desc`, the API's
 * largest page, turned back into date order before it is returned.
 *
 * Latest first rather than soonest first because a member of the organisation
 * sees every event it has ever had — drafts, past and cancelled included — and
 * soonest first would fill the hundred with the oldest of them. An organisation
 * with more than a hundred events would then have no way to name an upcoming
 * one. Asked latest first, the hundred are the upcoming ones and the most
 * recent past ones, which are the ones a door scope is chosen for; what is left
 * out is the oldest, and `pagination.total` says how many there are in all so
 * the picker can say so. (Not `startsAfter`: that filters on the start time, and
 * would leave out a festival that began on Monday and is still running.)
 *
 * @param {string} organizationId Whose events.
 * @returns {Promise<{events: object[], pagination: object|null}>} The events, earliest first, and the API's counters.
 */
export async function listOrganizationEvents(organizationId) {
  const query = new URLSearchParams({
    organizationId,
    perPage: String(EVENT_PICKER_SIZE),
    sort: 'startsAt:desc',
  })
  const body = await callApi(`/v1/events?${query.toString()}`)

  return { events: [...(body.data ?? [])].reverse(), pagination: body.pagination ?? null }
}

/**
 * The notification outbox, as operations sees it.
 *
 * `GET /v1/operations/notifications`. Platform-scoped: the API asks
 * `reconciliation:manage`, and there is no organisation to pass.
 *
 * @param {object} [options] Filters.
 * @param {string} [options.status] One outbox status.
 * @param {string} [options.template] One template name.
 * @param {string} [options.failureCategory] `PERMANENT` or `TRANSIENT`.
 * @param {number} [options.page] Which page.
 * @param {number} [options.perPage] Page size.
 * @returns {Promise<{messages: object[], pagination: object|null}>} The queue.
 */
export async function listNotifications(options = {}) {
  const suffix = queryFrom(options, ['status', 'template', 'failureCategory', 'page', 'perPage'])
  const body = await callApi(`/v1/operations/notifications${suffix}`)

  return { messages: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * One outbox message, redacted by the API.
 *
 * @param {string} id Which message.
 * @returns {Promise<object>} The message.
 */
export async function getNotification(id) {
  const body = await callApi(`/v1/operations/notifications/${encodeURIComponent(id)}`)

  return body.data
}

/**
 * Every refund of one organisation, in any status.
 *
 * `GET /v1/refunds`. `organizationId` is required by the API — it is where the
 * `finance:view` check is scoped — and therefore required here; a helper that
 * quietly dropped it would turn an organisation question into a refusal at the
 * first call site that forgot.
 *
 * @param {object} options Filters.
 * @param {string} options.organizationId Whose refunds.
 * @param {string} [options.status] One refund status.
 * @param {string} [options.orderReference] One order.
 * @param {number} [options.page] Which page.
 * @param {number} [options.perPage] Page size.
 * @returns {Promise<{refunds: object[], pagination: object|null}>} The refunds.
 * @throws {TypeError} When no organisation is named.
 */
export async function listRefunds(options) {
  if (!options?.organizationId) {
    throw new TypeError('listRefunds needs an organisation: the API scopes refunds by it.')
  }

  const suffix = queryFrom(options, [
    'organizationId',
    'status',
    'orderReference',
    'page',
    'perPage',
  ])
  const body = await callApi(`/v1/refunds${suffix}`)

  return { refunds: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * The reconciliation queue, in any state.
 *
 * `GET /v1/operations/reconciliation`. With `organizationId` the API asks
 * `finance:view` there and answers that organisation's items; without one it
 * asks the platform capability and answers everything.
 *
 * `reference` is deliberately not accepted. It matches payment, order and
 * refund ids and provider references, and a filter the list page offered for
 * it would put those identifiers into the address bar.
 *
 * @param {object} [options] Filters.
 * @param {string} [options.organizationId] One organisation, or none for the platform view.
 * @param {string} [options.state] One state.
 * @param {string} [options.kind] One kind.
 * @param {string} [options.aging] `AGING` or `OVERDUE`.
 * @param {number} [options.page] Which page.
 * @param {number} [options.perPage] Page size.
 * @returns {Promise<{tasks: object[], pagination: object|null}>} The queue.
 */
export async function listReconciliationTasks(options = {}) {
  const suffix = queryFrom(options, ['organizationId', 'state', 'kind', 'aging', 'page', 'perPage'])
  const body = await callApi(`/v1/operations/reconciliation${suffix}`)

  return { tasks: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * A page number from the address bar, or 1.
 *
 * @param {unknown} value The raw `page` parameter.
 * @returns {number} A whole number from 1 to 10,000, the API's ceiling.
 */
export function readPage(value) {
  const number = Number(value)

  if (!Number.isInteger(number) || number < 1) return 1

  return Math.min(number, 10_000)
}

/**
 * A list page's own address, with its filters.
 *
 * For pagination links, which must keep every filter the person chose.
 * Empty values are left out; `page` is left out when it is 1.
 *
 * @param {string} path The page's path, beginning `/`.
 * @param {Record<string, string|number|null|undefined>} params The filters and the page.
 * @returns {string} The address.
 */
export function listHref(path, params) {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (key === 'page' && Number(value) === 1) continue

    query.set(key, String(value))
  }

  const text = query.toString()

  return text ? `${path}?${text}` : path
}

/**
 * Whether a list page came back empty only because it is past the end.
 *
 * A page number in the address can outlive its list: bookmarked, typed, or a
 * "Next page" link followed after the list shrank. The API then answers with
 * no rows and the list's real `total`, and a page that drew its "nothing here"
 * state would be saying something false about the whole list.
 *
 * @param {number} shown How many rows the page has.
 * @param {object|null} pagination The API's counters, when it sent them.
 * @param {number} page The page that was asked for.
 * @returns {boolean} True when the page is empty and the list may not be.
 */
export function isPastTheEnd(shown, pagination, page) {
  if (shown > 0) return false
  if (Number.isInteger(pagination?.total)) return pagination.total > 0

  // No counters to go by: an empty first page is an empty list, and an empty
  // later page says nothing about the pages before it.
  return page > 1
}

/**
 * The classes for a list's page links: "Previous page", "Next page", "Go to
 * the first page".
 *
 * Bordered and padded to a 44-pixel target, like the events listing's pager,
 * rather than bare underlined text a thumb has to hunt for.
 *
 * @type {string}
 */
export const PAGER_LINK_CLASSES =
  'inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface-raised px-4 py-2 text-sm font-medium text-ink hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none'

/** How an instant is printed on these pages. */
const INSTANT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

/**
 * An instant as a person reads it, in UTC and saying so.
 *
 * UTC rather than the server's zone, because a server's zone is an accident of
 * where it runs; the `time` element these are printed in carries the exact
 * instant for anything that wants it.
 *
 * @param {string|null|undefined} value An ISO-8601 instant.
 * @returns {string|null} "Sep 23, 2026, 2:05 PM UTC", or null for no instant.
 */
export function formatInstant(value) {
  if (!value) return null

  const at = new Date(value)

  if (Number.isNaN(at.getTime())) return null

  return `${INSTANT.format(at)} UTC`
}

/**
 * The classes for a status word, per tone.
 *
 * Written out whole so Tailwind finds every one of them, and in status tokens
 * only. A status is always drawn as a word *and* a tone: colour alone tells a
 * colour-blind reader nothing, which is WCAG 1.4.1.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STATUS_TONE_CLASSES = Object.freeze({
  success: 'border-status-success/25 bg-status-success-soft text-status-success',
  pending: 'border-status-pending/30 bg-status-pending-soft text-status-pending',
  warning: 'border-status-warning/30 bg-status-warning-soft text-status-warning',
  danger: 'border-status-danger/25 bg-status-danger-soft text-status-danger',
  info: 'border-status-info/25 bg-status-info-soft text-status-info',
  neutral: 'border-line-strong bg-status-neutral-soft text-status-neutral',
})
