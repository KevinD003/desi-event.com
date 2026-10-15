/**
 * What a listing says about whether an event's tickets can be bought.
 *
 * Every word here is read from a fact the API sends — the event's status,
 * `soldOut`, `salesOpen` — and nothing is inferred. There is no "selling fast",
 * no "few left" and no count on a card: the summary carries no remaining
 * quantity, and a card that implied one would be inventing urgency. The event
 * page shows a tier's real remaining count when there is one.
 *
 * The tones are the availability tokens (`open`, `closed`) plus a neutral one
 * for "not yet", and every one is a word as well as a colour.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file lib/event-availability
 */

/**
 * @typedef {object} Availability
 * @property {'open'|'closed'|'neutral'} tone Which availability token it is drawn in.
 * @property {string} label What it says.
 */

/** Statuses that end the question, whatever the tiers say. */
const FINAL = Object.freeze({
  CANCELLED: 'Cancelled',
  POSTPONED: 'Postponed',
  COMPLETED: 'Finished',
})

/**
 * The availability of an event, as a card should state it.
 *
 * @param {object} event An event summary.
 * @returns {Availability|null} What to say, or null when the summary does not say.
 */
export function eventAvailability(event) {
  if (FINAL[event?.status]) return { tone: 'closed', label: FINAL[event.status] }

  if (event?.status === 'SOLD_OUT' || event?.soldOut === true) {
    return { tone: 'closed', label: 'Sold out' }
  }

  if (event?.status === 'SALES_PAUSED') return { tone: 'closed', label: 'Sales paused' }

  if (event?.salesOpen === true) return { tone: 'open', label: 'On sale' }
  if (event?.salesOpen === false) return { tone: 'neutral', label: 'Not on sale now' }

  return null
}

/** `TicketTypeStatus.ON_SALE`: the one tier status a hold is accepted in. */
const TIER_ON_SALE = 'ON_SALE'

/**
 * Where a tier's sales window stands at a moment.
 *
 * The same reading as `salesWindowState` in `@desi-event/inventory`, which the
 * hold route and the listing's `salesOpen` are both judged by: open from
 * `salesStartAt` (inclusive) until `salesEndAt` (exclusive), either end
 * optional. It is restated here rather than imported because that package's
 * barrel pulls in `node:crypto` and is barred from the browser
 * (`lib/browser-bundle.js`), and the tier list that reads this is reached from
 * the client-side checkout basket.
 *
 * A window that cannot be read — a date that does not parse, an end before its
 * start — is `unreadable`, and the callers treat that as not on sale, as the
 * API does: a listing is safer quiet than claiming a sale the hold route would
 * refuse.
 *
 * @param {object} tier A ticket tier with `salesStartAt` and `salesEndAt`, either of which may be null.
 * @param {Date} [now] The moment in question. Defaults to now.
 * @returns {'open'|'not-started'|'ended'|'unreadable'} The window's state.
 */
export function tierSalesWindow(tier, now = new Date()) {
  const at = now.getTime()
  const start = tier?.salesStartAt == null ? null : new Date(tier.salesStartAt).getTime()
  const end = tier?.salesEndAt == null ? null : new Date(tier.salesEndAt).getTime()

  if (Number.isNaN(at) || Number.isNaN(start) || Number.isNaN(end)) return 'unreadable'
  if (start !== null && end !== null && end < start) return 'unreadable'
  if (start !== null && at < start) return 'not-started'
  if (end !== null && at >= end) return 'ended'

  return 'open'
}

/**
 * Whether one ticket tier can be bought on this site right now.
 *
 * The per-tier half of the API's `salesOpen`: a general-admission tier (a
 * seated one is not sold here), in `ON_SALE` status, with stock left, inside
 * its sales window. The event page's "On sale" and its "From" price are both
 * read from this, so neither can claim a tier that a listing card, or the hold
 * route behind "Choose tickets", would say is not on sale.
 *
 * @param {object} tier A ticket tier with availability folded in (`isSoldOut`, `availableQuantity`).
 * @param {Date} [now] The moment in question. Defaults to now.
 * @returns {boolean} True when a hold on the tier would be accepted, stock permitting.
 */
export function tierOnSaleNow(tier, now = new Date()) {
  if (!tier || tier.reserved || tier.status !== TIER_ON_SALE || tier.isSoldOut === true) {
    return false
  }

  const remaining = Number.isFinite(tier.availableQuantity)
    ? tier.availableQuantity
    : (tier.quantityTotal ?? 0) - (tier.quantitySold ?? 0)

  return remaining > 0 && tierSalesWindow(tier, now) === 'open'
}

/**
 * Whether every general-admission tier has run out of stock.
 *
 * Stock only, not status: a paused tier or one whose sales have not opened has
 * not sold out, and saying it had would be false in the other direction. Seated
 * tiers are left out as the API leaves them out of `soldOut` — their stock is
 * their seats — so an event with no general-admission tiers never reads as
 * sold out.
 *
 * @param {object[]} ticketTypes The event's tiers.
 * @returns {boolean} True when there is at least one general-admission tier and none has stock left.
 */
export function allTiersSoldOut(ticketTypes) {
  const counted = (ticketTypes ?? []).filter((tier) => !tier.reserved)

  return (
    counted.length > 0 &&
    counted.every(
      (tier) =>
        tier.status === 'SOLD_OUT' || (tier.quantityTotal ?? 0) - (tier.quantitySold ?? 0) <= 0,
    )
  )
}

/**
 * @typedef {object} StartingPrice
 * @property {string} amount The formatted amount, or words when there is none.
 * @property {string|null} qualifier What the amount includes, when it is a price.
 * @property {boolean} allIn True when the amount is what one ticket costs in total.
 */

/**
 * The "from" price on a card.
 *
 * All-in when the API sent `minTotalCents` — one ticket of the cheapest tier
 * with the booking fee and any tax, priced as checkout prices it. Otherwise the
 * face value, said to be before fees, because a card that showed a face value
 * as if it were the price is the practice all-in pricing exists to stop.
 *
 * @param {object} event An event summary.
 * @param {function(number, string): string} format Money formatter.
 * @returns {StartingPrice} The price.
 */
export function startingPrice(event, format) {
  const currency = event?.currency ?? 'USD'

  if (Number.isInteger(event?.minTotalCents)) {
    return {
      amount: format(event.minTotalCents, currency),
      qualifier: event.minTotalCents === 0 ? null : 'including any fees and tax',
      allIn: true,
    }
  }

  if (Number.isInteger(event?.minPriceCents)) {
    return {
      amount: format(event.minPriceCents, currency),
      qualifier: event.minPriceCents === 0 ? null : 'before fees and tax',
      allIn: false,
    }
  }

  return { amount: 'Price to be announced', qualifier: null, allIn: false }
}
