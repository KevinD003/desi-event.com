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
  const currency = event?.currency ?? 'INR'

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
