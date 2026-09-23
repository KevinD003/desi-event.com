/**
 * Server-side reads for the attendee's own account: their orders.
 *
 * Built on `callApi` from `organizer-api.js`, so it inherits that module's one
 * rule — **nothing here falls back**. A purchase history that quietly showed a
 * cached or sample list when the API was down would tell somebody they had
 * bought nothing, or bought something they had not. These throw, carrying the
 * `status`, `code` and `retryAfterSeconds` the pages read a refusal from.
 *
 * The API decides whose orders these are. `GET /v1/orders` lists the signed-in
 * account's own, and `GET /v1/orders/:reference` answers only the buyer or an
 * organisation that may view it; nothing in this module names a user.
 *
 * @module lib/account-api
 */

import { callApi } from './organizer-api.js'

/**
 * @typedef {object} OrderPage
 * @property {object[]} orders The orders on this page, newest first, as the API returned them.
 * @property {{page: number, perPage: number, total: number, totalPages: number, hasNextPage: boolean, hasPreviousPage: boolean}|null} pagination
 *   The API's page counters, or null if it sent none.
 */

/**
 * One page of the signed-in person's orders.
 *
 * @param {object} [options] Paging.
 * @param {number} [options.page] 1-based page number.
 * @param {number} [options.perPage] Page size; the API caps it at 100.
 * @returns {Promise<OrderPage>} The orders and their page counters.
 * @throws {Error} When the API refuses or cannot be reached.
 */
export async function getMyOrders({ page = 1, perPage = 20 } = {}) {
  const query = new URLSearchParams({ page: String(page), perPage: String(perPage) })
  const body = await callApi(`/v1/orders?${query.toString()}`)

  return { orders: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * What an order reference may be: the API's `orderReferenceSchema` before it
 * upper-cases — letters, digits and hyphens, four to thirty-two of them.
 *
 * Checked here, before anything is sent, because encoding alone is not enough
 * to keep a reference from a URL inside `/v1/orders/`: `encodeURIComponent`
 * leaves `.` alone, so a reference of `..` would be resolved into `/v1/`, and
 * one of `.` into `/v1/orders/` — the list of every order on the account.
 *
 * @type {RegExp}
 */
const ORDER_REFERENCE = /^[A-Za-z0-9-]{4,32}$/

/**
 * Whether a string could be an order reference at all.
 *
 * @param {unknown} reference The value from the URL.
 * @returns {boolean} True when it has the shape the API accepts.
 */
export function isOrderReference(reference) {
  return typeof reference === 'string' && ORDER_REFERENCE.test(reference)
}

/**
 * One order, by its customer-facing reference.
 *
 * The reference comes from a URL, so anything that is not shaped like one is
 * refused here without a request, with the same `400 VALIDATION_ERROR` the API
 * answers a malformed reference with — so the page words it exactly as it
 * words the API's own refusal. What does pass is still encoded, which costs
 * nothing.
 *
 * @param {string} reference The order reference, e.g. `DE-8F3K2Q`.
 * @returns {Promise<object>} The order, with its lines, the buyer's own tickets and an event summary.
 * @throws {Error} When the reference is malformed, or the API refuses or cannot be reached.
 */
export async function getMyOrder(reference) {
  if (!isOrderReference(reference)) {
    throw Object.assign(new Error('That is not an order reference.'), {
      status: 400,
      code: 'VALIDATION_ERROR',
      retryAfterSeconds: null,
    })
  }

  const body = await callApi(`/v1/orders/${encodeURIComponent(reference)}`)

  return body.data
}
