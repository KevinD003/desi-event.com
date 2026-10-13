/**
 * The calls a buyer's browser makes at checkout.
 *
 * Every one goes through `apiFetch`, the same-origin proxy, so the holds and
 * orders belong to the signed-in account and the session cookie never leaves
 * this origin. Nothing here puts a promo code, a referral code, a guest's name
 * or a seat in a URL: they travel in request bodies, which are not written to
 * access logs or kept in browser history, and nothing here stores them.
 *
 * Every refusal is thrown as an `Error` carrying the API's `status`, `code` and
 * `message`, the shape `describeApiRefusal` reads.
 *
 * @module lib/checkout-api
 */

import { apiFetch } from './api-fetch.js'
import { formatAmount } from './pricing.js'
import { refusalFromResponse } from './refusal.js'

/** Paying the ticket price by card, online (the default). */
export const CARD = 'CARD'

/** Paying the ticket price at the door, and only the booking fee online (SPEC3 §9). */
export const AT_VENUE = 'AT_VENUE'

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
 * @param {'CARD'|'AT_VENUE'} [request.paymentMethod] How the ticket price would be paid; CARD when not said.
 * @param {string} [request.referralCode] A referral code the buyer typed, in the body and nowhere else.
 * @returns {Promise<object>} The quote's `data`.
 * @throws {Error} A refusal or a network failure.
 */
export async function quoteThroughApi({
  eventId,
  lines,
  promoCode,
  holdIds,
  paymentMethod,
  referralCode,
}) {
  const response = await apiFetch('/v1/orders/quote', {
    method: 'POST',
    body: JSON.stringify({
      eventId,
      items: lines.map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity })),
      ...(promoCode ? { promoCode } : {}),
      ...(holdIds && holdIds.length > 0 ? { holdIds } : {}),
      ...(paymentMethod === AT_VENUE ? { paymentMethod: AT_VENUE } : {}),
      ...(referralCode ? { referralCode } : {}),
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
 * @param {number} [request.expectedTotalCents] The total the buyer was shown: what is paid online.
 * @param {'CARD'|'AT_VENUE'} [request.paymentMethod] How the ticket price is paid; CARD when not said.
 * @param {string} [request.referralCode] A referral code the quote applied.
 * @param {number} [request.expectedVenueDueCents] For AT_VENUE, what the buyer was shown for the door.
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
  paymentMethod,
  referralCode,
  expectedVenueDueCents,
}) {
  const atVenue = paymentMethod === AT_VENUE

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
      ...(atVenue ? { paymentMethod: AT_VENUE } : {}),
      ...(referralCode ? { referralCode } : {}),
      ...(atVenue && Number.isInteger(expectedVenueDueCents) ? { expectedVenueDueCents } : {}),
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

// ---------------------------------------------------------------------------
// Paying at the venue and referral codes (SPEC3 §6.5, §12.1; SPEC3-XI §12.1)
// ---------------------------------------------------------------------------

/**
 * What the polite live region says when "Pay at the venue" stops being offered
 * while it was chosen: the choice goes back to card (SPEC3 §12.1).
 */
export const VENUE_UNAVAILABLE_ANNOUNCEMENT =
  'Paying at the venue is not available for this booking. The total is for paying by card.'

/** The urgent alert when the switch went off between the quote and Pay (SPEC3 §6.5). */
export const VENUE_SWITCHED_OFF_SENTENCE =
  'Paying at the venue was switched off for this event while you were booking. Nothing has been charged. The total is now for paying by card.'

/** The urgent alert when a referral code stopped applying between the quote and Pay. */
export const REFERRAL_WITHDRAWN_SENTENCE =
  'Your referral code can no longer be used for this booking, so the booking fee is back. Nothing has been charged. Check the new total, then pay.'

/**
 * The refusals that mean paying at the venue cannot be had for this booking
 * now: the switch is off, the event's limit is reached, the event is online or
 * sold elsewhere, or there is no ticket price left to pay at the door.
 *
 * @type {ReadonlySet<string>}
 */
export const VENUE_REFUSAL_CODES = new Set([
  'VENUE_PAYMENT_OFF',
  'VENUE_PAYMENT_FULL',
  'VENUE_PAYMENT_UNAVAILABLE',
  'NOTHING_TO_PAY_AT_VENUE',
])

/**
 * Whether "Pay at the venue" is offered for this basket: the latest quote
 * says so, or, before anything is held, the event does, and the ticket price
 * after any promo is above 0 (SPEC3 §12.1).
 *
 * @param {object} options What the checkout knows.
 * @param {object|null} options.quote The latest quote, or null.
 * @param {object|null} [options.event] The event, with `venuePayment` as the public detail sends it.
 * @param {object|null} [options.estimate] The browser's estimate, used before a quote.
 * @returns {boolean} Whether the choice is shown.
 */
export function venuePaymentOffered({ quote, event = null, estimate = null }) {
  if (quote) {
    const price = (quote.subtotalCents ?? 0) - (quote.discountCents ?? 0)

    // A quote priced to pay at the venue was accepted as one, so it is on
    // offer; a card quote says so itself.
    if (quote.paymentMethod === AT_VENUE) return price > 0

    return quote.venuePayment?.available === true && price > 0
  }

  const price = (estimate?.subtotalCents ?? 0) - (estimate?.discountCents ?? 0)

  return event?.venuePayment?.available === true && price > 0
}

/**
 * What a quote or an estimate says is paid online and at the door.
 *
 * @param {object|null} figures A quote, an estimate or summary totals.
 * @returns {{online: number, due: number, atVenue: boolean}} The two amounts.
 */
export function paymentParts(figures) {
  const atVenue = figures?.paymentMethod === AT_VENUE

  return {
    atVenue,
    online: figures?.totalCents ?? 0,
    due: atVenue ? (figures?.venueDueCents ?? 0) : 0,
  }
}

/**
 * The Pay button's words for a quote (SPEC3 §12.1).
 *
 * @param {object|null} quote The server's quote, or null when there is none.
 * @returns {string} "Pay $49.31 (simulated)", "Pay booking fee $5.31 (simulated)",
 *   "Book now — pay $45.00 at the door", or "Pay (simulated)" without a quote.
 */
export function payButtonLabel(quote) {
  if (!quote) return 'Pay (simulated)'

  const { atVenue, online, due } = paymentParts(quote)

  if (!atVenue) return `Pay ${formatAmount(online, quote.currency)} (simulated)`
  if (online > 0) return `Pay booking fee ${formatAmount(online, quote.currency)} (simulated)`

  return `Book now — pay ${formatAmount(due, quote.currency)} at the door`
}

/**
 * What the polite live region says when a quote to pay at the venue arrives.
 *
 * @param {object} quote The quote.
 * @returns {string} The sentence, or empty for a card quote.
 */
export function totalUpdatedAnnouncement(quote) {
  const { atVenue, online, due } = paymentParts(quote)

  if (!atVenue) return ''

  return `Total updated: pay now ${formatAmount(online, quote.currency)}, at the door ${formatAmount(due, quote.currency)}.`
}

/**
 * Whether the booking fee's own terms moved between two quotes: the
 * percentage or the amount per ticket an administrator sets. A fee that moved
 * only because the ticket price did (a promo that ran out) is not this.
 *
 * @param {object|null} before The quote the buyer pressed Pay on.
 * @param {object|null} after The quote asked for once Pay was refused.
 * @returns {boolean} True when the terms differ.
 */
export function feeTermsChanged(before, after) {
  if (!before?.fee || !after?.fee) return false

  return (
    before.fee.percentageBps !== after.fee.percentageBps ||
    before.fee.flatCentsPerTicket !== after.fee.flatCentsPerTicket
  )
}

/**
 * What the checkout says once Pay was refused with `PRICE_CHANGED` and the
 * quote was asked for again (SPEC3 §6.5): whether the administrators changed
 * the booking fee, which is urgent, or the price moved for another reason,
 * which is today's notice.
 *
 * @param {object|null} before The quote Pay was pressed on.
 * @param {object} after The new quote.
 * @returns {{urgent: boolean, title: string, sentence: string}} What to show.
 */
export function priceChangedNotice(before, after) {
  const { atVenue, online, due } = paymentParts(after)
  const money = (cents) => formatAmount(cents, after.currency)

  if (feeTermsChanged(before, after)) {
    return {
      urgent: true,
      title: 'The booking fee changed',
      sentence: atVenue
        ? `The booking fee for this event changed while you were booking. Pay now ${money(online)}, at the door ${money(due)}. Nothing has been charged. Check the summary, then confirm.`
        : `The booking fee for this event changed while you were booking. It is now ${money(after.feesCents)}. Nothing has been charged. Check the new total, then pay.`,
    }
  }

  return {
    urgent: false,
    title: 'The total changed',
    sentence: atVenue
      ? `The price changed. Pay now ${money(online)}, at the door ${money(due)}. Nothing was charged. Check the summary and confirm again.`
      : `The total is now ${money(online)}. Nothing was charged. Check the summary and pay again.`,
  }
}

/**
 * What the urgent alert says when paying at the venue could not be had at Pay
 * (SPEC3 §6.5): the switch's own sentence, or the API's own for the others
 * ("Paying at the venue is full for this event. You can still pay by card.").
 *
 * @param {object} error The refusal, as `refusalError` built it.
 * @returns {string} The sentence.
 */
export function venueRefusalSentence(error) {
  if (error?.code === 'VENUE_PAYMENT_OFF') return VENUE_SWITCHED_OFF_SENTENCE

  const message = typeof error?.message === 'string' ? error.message.trim() : ''

  return message && !/^The API answered \d{3}\.?$/u.test(message)
    ? message
    : 'Paying at the venue is not available for this booking now. Nothing has been charged. The total is now for paying by card.'
}
