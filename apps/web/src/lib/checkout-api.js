/**
 * The calls a buyer's browser makes at checkout.
 *
 * Every one goes through `apiFetch`, the same-origin proxy, so the holds and
 * orders belong to the signed-in account and the session cookie never leaves
 * this origin. Nothing here puts a promo code, a guest's name or a seat in a
 * URL: they travel in request bodies, which are not written to access logs or
 * kept in browser history.
 *
 * Every refusal is thrown as an `Error` carrying the API's `status`, `code` and
 * `message`, the shape `describeApiRefusal` reads.
 *
 * @module lib/checkout-api
 */

import { apiFetch } from './api-fetch.js'
import { refusalFromResponse } from './refusal.js'

/**
 * An error carrying a refusal, in the shape `describeApiRefusal` reads.
 *
 * @param {Response} response A response that was not ok.
 * @returns {Promise<Error>} The error.
 */
export async function refusalError(response) {
  const refusal = await refusalFromResponse(response)

  return Object.assign(new Error(refusal.message ?? `The API answered ${refusal.status}.`), refusal)
}

/**
 * Release holds, quietly. A hold left behind lapses on its own when its time
 * runs out; releasing it early only gives the tickets or seats back sooner.
 *
 * @param {string[]} holdIds The holds.
 * @returns {Promise<void>} Resolves when every attempt has finished.
 */
export async function releaseThroughApi(holdIds) {
  await Promise.all(
    holdIds.map((id) =>
      apiFetch(`/v1/holds/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null),
    ),
  )
}

/**
 * Hold every selected general-admission tier for this account.
 *
 * One at a time, so a refusal part-way releases what was already held rather
 * than leaving half a basket reserved.
 *
 * @param {Array<{ticketTypeId: string, quantity: number}>} lines Selected lines.
 * @returns {Promise<object[]>} One hold record per line.
 * @throws {Error} A refusal or a network failure.
 */
export async function reserveThroughApi(lines) {
  const holds = []

  for (const line of lines) {
    let response

    try {
      response = await apiFetch('/v1/holds', {
        method: 'POST',
        body: JSON.stringify({ ticketTypeId: line.ticketTypeId, quantity: line.quantity }),
      })
    } catch (error) {
      await releaseThroughApi(holds.map((hold) => hold.id))
      throw error
    }

    if (!response.ok) {
      const error = await refusalError(response)

      await releaseThroughApi(holds.map((hold) => hold.id))
      throw error
    }

    holds.push((await response.json()).data)
  }

  return holds
}

/**
 * Hold seats at one night, as the signed-in account.
 *
 * The request names seats and nothing else: the tier, the price and how long
 * the hold lasts are the server's to decide.
 *
 * @param {string} sessionId The night.
 * @param {string[]} seatIds `Seat` ids.
 * @returns {Promise<object>} The hold, with its `seats`, `subtotalCents` and `expiresAt`.
 * @throws {Error} A refusal or a network failure.
 */
export async function holdSeatsThroughApi(sessionId, seatIds) {
  const response = await apiFetch(`/v1/sessions/${encodeURIComponent(sessionId)}/holds`, {
    method: 'POST',
    body: JSON.stringify({ seatIds }),
  })

  if (!response.ok) throw await refusalError(response)

  return (await response.json()).data
}

/**
 * Read a night's seat map again, through the same-origin proxy.
 *
 * @param {string} sessionId The night.
 * @returns {Promise<object>} The map's `data`.
 * @throws {Error} A refusal or a network failure.
 */
export async function loadSeatMapThroughApi(sessionId) {
  const response = await apiFetch(`/v1/sessions/${encodeURIComponent(sessionId)}/seats`)

  if (!response.ok) throw await refusalError(response)

  return (await response.json()).data
}

/**
 * Ask the server what these lines, holds and code would come to now.
 *
 * Computed by the same function as the charge, so the figure it returns is the
 * figure the order will be charged; its `totalCents` is sent back as the
 * order's `expectedTotalCents`.
 *
 * @param {object} request What to price.
 * @param {string} request.eventId The event.
 * @param {Array<{ticketTypeId: string, quantity: number}>} request.lines The lines.
 * @param {string} [request.promoCode] A code the buyer typed.
 * @param {string[]} [request.holdIds] The holds the order will spend.
 * @returns {Promise<object>} The quote's `data`.
 * @throws {Error} A refusal or a network failure.
 */
export async function quoteThroughApi({ eventId, lines, promoCode, holdIds }) {
  const response = await apiFetch('/v1/orders/quote', {
    method: 'POST',
    body: JSON.stringify({
      eventId,
      items: lines.map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity })),
      ...(promoCode ? { promoCode } : {}),
      ...(holdIds && holdIds.length > 0 ? { holdIds } : {}),
    }),
  })

  if (!response.ok) throw await refusalError(response)

  return (await response.json()).data
}

/**
 * Place the order against the holds, with the simulated payment.
 *
 * `expectedTotalCents` is the quote's total: a precondition, never a price. If
 * the server's figure has moved since the quote, it refuses with 409
 * `PRICE_CHANGED` and nothing is charged.
 *
 * @param {object} request What to buy.
 * @param {string} request.eventId The event.
 * @param {{name: string, email: string}} request.buyer The signed-in buyer.
 * @param {Array<{ticketTypeId: string, quantity: number}>} request.lines The lines.
 * @param {string[]} request.holdIds The holds being spent.
 * @param {string} request.idempotencyKey This attempt's key.
 * @param {string} [request.promoCode] A code the quote applied.
 * @param {Array<{ticketTypeId: string, eventSeatId?: string, name: string}>} [request.attendees] Guests' names; blank ones already dropped.
 * @param {number} [request.expectedTotalCents] The total the buyer was shown.
 * @returns {Promise<object>} The order.
 * @throws {Error} A refusal or a network failure.
 */
export async function placeOrderThroughApi({
  eventId,
  buyer,
  lines,
  holdIds,
  idempotencyKey,
  promoCode,
  attendees,
  expectedTotalCents,
}) {
  const response = await apiFetch('/v1/orders', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({
      eventId,
      buyerEmail: buyer.email,
      buyerName: buyer.name,
      items: lines.map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity })),
      holdIds,
      ...(promoCode ? { promoCode } : {}),
      ...(attendees && attendees.length > 0 ? { attendees } : {}),
      ...(Number.isInteger(expectedTotalCents) ? { expectedTotalCents } : {}),
    }),
  })

  if (!response.ok) throw await refusalError(response)

  return (await response.json()).data
}

/**
 * A fresh idempotency key for one purchase attempt. Held in memory only.
 *
 * @returns {string} The key.
 */
export function newAttemptKey() {
  return globalThis.crypto.randomUUID()
}

/**
 * When the earliest hold lapses, on the buyer's own clock.
 *
 * @param {object[]} holds The holds.
 * @returns {string|null} A time, or null when none says.
 */
export function heldUntil(holds) {
  const times = holds
    .map((hold) => Date.parse(hold?.expiresAt))
    .filter((time) => Number.isFinite(time))

  if (times.length === 0) return null

  return new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(
    new Date(Math.min(...times)),
  )
}
