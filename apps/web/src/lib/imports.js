/**
 * How an event copied from its listing on another site reads in public
 * (SPEC2-XI I-E).
 *
 * The API sends `importedFrom` on an event only while it is held by the
 * Desi-Event team for that site: `{ sourceName, presentedBy, listedOn,
 * prices, priceListed, ticketsOnSource }`. Tickets for such an event are sold
 * on the source site, so nothing here offers to sell one: the card says where
 * the tickets are and what the cheapest paid one cost when it was listed, and
 * the event page says the prices as listed on that date.
 *
 * Pure and dependency-light, so a server component and a client one may both
 * import it.
 *
 * @module lib/imports
 */

import { formatPrice } from './pricing.js'

/** The date a listing was read, as the page prints it: "30 September 2026". */
const LISTED_ON = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * The listed prices that are real numbers.
 *
 * @param {object|null|undefined} importedFrom The event's `importedFrom`.
 * @returns {{name: string, priceCents: number, currency: string}[]} The prices.
 */
function listedPrices(importedFrom) {
  return (importedFrom?.prices ?? []).filter(
    (price) => Number.isInteger(price?.priceCents) && price.priceCents >= 0,
  )
}

/**
 * The day a listing was read, in words, or null when it cannot be read.
 *
 * @param {string|null|undefined} listedOn `YYYY-MM-DD`, in UTC.
 * @returns {string|null} "30 September 2026".
 */
export function listedOnWords(listedOn) {
  if (typeof listedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(listedOn)) return null

  const time = Date.parse(`${listedOn}T00:00:00Z`)

  return Number.isFinite(time) ? LISTED_ON.format(new Date(time)) : null
}

/**
 * What a listing card says in its price slot for an imported event.
 *
 * "On Sulekha from {the lowest price above zero}"; "Free, on Sulekha" when
 * every listed price is zero; "On Sulekha" when the listing gives no price. A
 * free child's ticket beside paid ones never makes it say "from Free".
 *
 * @param {object} importedFrom The event's `importedFrom`.
 * @returns {string} The words.
 */
export function importedCardPrice(importedFrom) {
  const source = importedFrom?.sourceName ?? 'Sulekha'
  const prices = importedFrom?.priceListed === false ? [] : listedPrices(importedFrom)

  if (prices.length === 0) return `On ${source}`

  const paid = prices.filter((price) => price.priceCents > 0)

  if (paid.length === 0) return `Free, on ${source}`

  const lowest = paid.reduce((cheapest, price) =>
    price.priceCents < cheapest.priceCents ? price : cheapest,
  )

  return `On ${source} from ${formatPrice(lowest.priceCents, lowest.currency ?? 'USD')}`
}

/**
 * The prices sentence on an imported event's page.
 *
 * "As listed on Sulekha on 30 September 2026: Adult $25.00, Child Free." or
 * "Sulekha does not list a price for this event."
 *
 * @param {object} importedFrom The event's `importedFrom`.
 * @returns {string} The sentence.
 */
export function importedPricesSentence(importedFrom) {
  const source = importedFrom?.sourceName ?? 'Sulekha'
  const prices = importedFrom?.priceListed === false ? [] : listedPrices(importedFrom)

  if (prices.length === 0) return `${source} does not list a price for this event.`

  const when = listedOnWords(importedFrom.listedOn)
  const list = prices
    .map((price) => `${price.name} ${formatPrice(price.priceCents, price.currency ?? 'USD')}`)
    .join(', ')

  return `As listed on ${source}${when ? ` on ${when}` : ''}: ${list}.`
}

/**
 * Whether the listing gave an end time for every night.
 *
 * Where it gave none, the API keeps a planning estimate as the end, which is
 * never shown: the page shows the start alone.
 *
 * @param {{sessions?: {endTimeListed?: boolean}[]}} event The public event.
 * @returns {boolean} False when any night's end was not listed.
 */
export function endTimeListed(event) {
  return !(event?.sessions ?? []).some((session) => session?.endTimeListed === false)
}
