/**
 * What a placed order means to the buyer who placed it.
 *
 * A checkout answer is a booking only when the order it carries is paid. The
 * API answers a retry of an unfinished attempt with a refusal rather than a
 * 201 (see `docs/PAYMENTS.md`, "A retry is the same attempt"), but the screen
 * does not rely on that alone: a success status with an order that is not
 * `PAID` is shown as not booked, never as "Booked … the tickets are in your
 * account now".
 *
 * @module lib/checkout-outcome
 */

/**
 * Whether an order the checkout received is a booking.
 *
 * @param {{status?: string}|null|undefined} order The order as the API returned it.
 * @returns {boolean} True only for a paid order.
 */
export function isBooked(order) {
  return order?.status === 'PAID'
}

/**
 * The notice for an order that came back without being paid, in the shape
 * `describeApiRefusal` gives a `payment-unsettled` refusal, so both are drawn
 * the same way: what happened, not to pay again, and where the order is.
 *
 * @param {{reference?: string, status?: string}} order The order as the API returned it.
 * @returns {{state: string, title: string, detail: string, recoverable: boolean, retryAfterSeconds: null, orderReference?: string}} The notice, shaped like a refusal.
 */
export function notBookedNotice(order) {
  const reference = typeof order?.reference === 'string' ? order.reference : null
  const named = reference ? `Order ${reference}` : 'This order'

  return {
    state: 'payment-unsettled',
    title: 'Not booked',
    detail:
      order?.status === 'PENDING'
        ? `${named} was placed, and whether its payment went through is still being checked, so nothing is booked yet. Please do not pay again; its page shows where it stands.`
        : `${named} is not booked: it is not paid. Its page shows what happened.`,
    recoverable: false,
    retryAfterSeconds: null,
    ...(reference ? { orderReference: reference } : {}),
  }
}

/**
 * Where the buyer finds the order a notice is about.
 *
 * @param {string|null|undefined} reference The order's reference, when the API named one.
 * @returns {string} The order's page, or the list of orders.
 */
export function orderHref(reference) {
  return reference ? `/account/orders/${encodeURIComponent(reference)}` : '/account/orders'
}
