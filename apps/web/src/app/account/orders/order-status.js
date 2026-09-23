/**
 * What an order, and a ticket on it, is called on the attendee's own pages.
 *
 * ## Why this is a module and not a table in each page
 *
 * Three pages say the same things — the orders list, one order, and the
 * transfers page — and a status that read "Paid" on one and "Complete" on
 * another would have somebody wondering whether they were two different
 * states. Pure functions, so every rule here is tested without a browser.
 *
 * ## "Paid — simulated"
 *
 * Every payment in this build is simulated: the provider is the in-memory mock
 * or Stripe's sandbox, and the server refuses to start with anything that
 * would move real money. So a paid order is labelled as simulated in its own
 * status word, not only in a notice somewhere above it, because the word is the
 * part that gets read.
 *
 * ## Ticket words are the wallet's
 *
 * The ticket sentences below are the ones `app/tickets/page.jsx` uses, copied
 * because that page keeps them private. A ticket that reads "Ready to use" in
 * the wallet must not read "Valid" on the order that bought it, so the test
 * beside this module reads the wallet's table from its source and goes red if
 * a word or a colour differs.
 *
 * @module app/account/orders/order-status
 */

import { REACHABLE_STATUSES, TICKET_STATUS_WORDS } from '../../../lib/wallet.js'
import {
  formatEventDate,
  formatEventTime,
  formatEventWhen,
  formatTimeZoneLabel,
} from '../../../lib/format.js'

/**
 * @typedef {object} StatusMeaning
 * @property {string} label The words shown.
 * @property {string} tone A status token name: `success`, `pending`, `info`, `danger` or `neutral`.
 */

/**
 * How each order status reads.
 *
 * The five values of `ORDER_STATUSES` in `@desi-event/schemas`. `CANCELLED`
 * is written only from `PENDING` (a declined simulated payment), so a
 * cancelled order was never paid.
 *
 * @type {Readonly<Record<string, StatusMeaning>>}
 */
export const ORDER_STATUS = Object.freeze({
  PAID: { label: 'Paid — simulated', tone: 'success' },
  PENDING: { label: 'Waiting for payment', tone: 'pending' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  REFUNDED: { label: 'Refunded — simulated', tone: 'info' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
})

/**
 * How each reachable ticket status reads: the wallet's own words, from the
 * one table the wallet, the ticket page and this page share.
 *
 * @type {Readonly<Record<string, StatusMeaning>>}
 */
export const TICKET_STATUS = TICKET_STATUS_WORDS

/**
 * What an order status means here.
 *
 * An unknown status keeps its own name, in a neutral colour, rather than being
 * guessed into one of the five.
 *
 * @param {string} status The order's status.
 * @returns {StatusMeaning} The words and the tone.
 */
export function orderStatusMeaning(status) {
  return ORDER_STATUS[status] ?? { label: String(status ?? 'Unknown'), tone: 'neutral' }
}

/**
 * What a ticket status means here.
 *
 * As in the wallet, a status the application cannot produce keeps its raw
 * name: a seeded `VOID` reads `VOID`, not a sentence implying the application
 * knows what it means.
 *
 * @param {string} status The ticket's status.
 * @returns {StatusMeaning} The words and the tone.
 */
export function ticketStatusMeaning(status) {
  return REACHABLE_STATUSES.includes(status)
    ? TICKET_STATUS[status]
    : { label: String(status ?? 'Unknown'), tone: 'info' }
}

/** Whether a status means money was (simulated as) taken. */
const TOOK_PAYMENT = new Set(['PAID', 'REFUNDED'])

/**
 * Whether a (simulated) payment went through on this order.
 *
 * @param {object} order The order.
 * @returns {boolean} True for a paid or refunded order.
 */
export function tookPayment(order) {
  return TOOK_PAYMENT.has(order?.status)
}

/**
 * How many tickets the order was for.
 *
 * From the order lines, not from the ticket rows: a transfer adds rows to an
 * order without adding anything to what was bought.
 *
 * @param {object} order The order.
 * @returns {number} The sum of the lines' quantities.
 */
export function ticketCount(order) {
  return (order?.items ?? []).reduce((total, item) => total + (Number(item.quantity) || 0), 0)
}

/**
 * The buyer's tickets that stand for what they bought now.
 *
 * Every accepted transfer mints a new row that points back at the one it
 * replaced, and the API marks the replaced one `supersededByLaterTicket`. A
 * ticket handed out and handed back leaves two of the buyer's rows for one
 * purchase; only the later one is counted, so an order for one ticket does not
 * appear to hold two.
 *
 * @param {object} order The order.
 * @returns {object[]} The rows that are nobody's earlier version.
 */
export function currentTickets(order) {
  return (order?.tickets ?? []).filter((ticket) => !ticket.supersededByLaterTicket)
}

/**
 * Whether any ticket on the order was handed to somebody else.
 *
 * A row the buyer handed on is kept on their order as `TRANSFERRED_AWAY`, and
 * the recipient's new row supersedes it — so after a plain hand-over the
 * buyer's only row for that ticket is a superseded one. This is the evidence
 * that a ticket missing from {@link currentTickets} went to somebody, rather
 * than never having been issued.
 *
 * @param {object} order The order.
 * @returns {boolean} True when a superseded row was handed away.
 */
export function handedAnyOn(order) {
  return (order?.tickets ?? []).some(
    (ticket) => ticket.supersededByLaterTicket && ticket.purchaserHolding === 'TRANSFERRED_AWAY',
  )
}

/**
 * Which account the tickets on an order were issued to, from this reader's side.
 *
 * Checkout makes the order's account the owner of every ticket it issues, and
 * a ticket's page opens only for the account holding it. But the API returns
 * an order to its buyer by account *or* by email address, so an order can
 * reach somebody whose account did not place it: a guest order placed with
 * their address (no account at all), or one another account placed with it.
 * Linking those tickets would send the reader to a page that says there is no
 * such ticket.
 *
 * @param {object} order The order.
 * @param {string|null|undefined} viewerId The signed-in account's id, or nothing when it could not be read.
 * @returns {'this-account'|'guest'|'other-account'|'unknown'} Whose the tickets are.
 */
export function ticketHolder(order, viewerId) {
  if (!order?.userId) return 'guest'
  if (!viewerId) return 'unknown'

  return order.userId === viewerId ? 'this-account' : 'other-account'
}

/**
 * What opening one of this account's tickets from the order is good for.
 *
 * The ticket's page shows a pass only for a ticket that still admits (`VALID`,
 * or `TRANSFER_PENDING` until the offer is taken), and a ticket can be offered
 * on only from `VALID` — refunded, used and withdrawn tickets have no way out
 * of their state. So the sentence follows the best ticket on the order, and
 * once the event is over it promises nothing at the door.
 *
 * @param {object[]} tickets The listed tickets.
 * @param {object} [options] Context.
 * @param {boolean} [options.eventOver] Whether the event has ended.
 * @returns {string} The sentence.
 */
export function openTicketHint(tickets, { eventOver = false } = {}) {
  const statuses = new Set((tickets ?? []).map((ticket) => ticket.status))

  if (!eventOver && statuses.has('VALID')) {
    return 'Open a ticket to show its pass at the door or, unless it is for a reserved seat, to hand it on.'
  }

  if (!eventOver && statuses.has('TRANSFER_PENDING')) {
    return 'Open a ticket to show its pass at the door or to withdraw the offer made on it.'
  }

  return 'Open a ticket to see where it stands.'
}

/**
 * Whether this order was read as its buyer.
 *
 * The API returns an order to its buyer and to an organisation member holding
 * `order:view`, and it gives the buyer's address to the buyer only
 * (`orderSchema.buyerEmail`: "present on the buyer's own reads only"). This
 * page is the buyer's purchase history, so an order read as an organiser is not
 * one of "your orders" and is not drawn as one.
 *
 * @param {object} order The order.
 * @returns {boolean} True when the payload carries the buyer's address.
 */
export function readAsBuyer(order) {
  return typeof order?.buyerEmail === 'string' && order.buyerEmail !== ''
}

/**
 * The order's heading: its event, or its reference when the event is gone.
 *
 * @param {object} order The order.
 * @returns {string} The title.
 */
export function orderTitle(order) {
  return order?.event?.title || `Order ${order?.reference ?? ''}`.trim()
}

/**
 * Where one order's page is.
 *
 * @param {string} reference The order reference.
 * @returns {string} The path.
 */
export function orderHref(reference) {
  return `/account/orders/${encodeURIComponent(reference)}`
}

/**
 * When the event runs, in its own timezone, with the zone named.
 *
 * @param {object|null|undefined} event The event summary.
 * @returns {string} Something like `Sat, 11 Oct 2026 · 7:00 pm – 11:30 pm IST`, or an empty string.
 */
export function eventWhenText(event) {
  const when = formatEventWhen(event)

  if (!when) return ''

  const zone = formatTimeZoneLabel(event)

  return zone ? `${when} ${zone}` : when
}

/**
 * An instant, in a named zone, with the zone named.
 *
 * For an order's own timestamps and an offer's deadline, shown in the event's
 * timezone so every time on the page is on the same clock.
 *
 * @param {string|null|undefined} value An ISO-8601 timestamp.
 * @param {string} [timeZone] IANA zone; UTC when the event is gone.
 * @returns {string} Something like `Tue, 22 Sept 2026, 6:30 pm IST`, or an empty string.
 */
export function instantText(value, timeZone = 'UTC') {
  const date = formatEventDate(value, timeZone)

  if (!date) return ''

  const zone = formatTimeZoneLabel({ startsAt: value, timezone: timeZone })

  return `${date}, ${formatEventTime(value, timeZone)}${zone ? ` ${zone}` : ''}`
}

/** The highest page the API will serve (`MAX_PAGE` in `@desi-event/schemas`). */
const MAX_PAGE = 10_000

/**
 * The page number a URL asked for.
 *
 * Anything that is not a whole number from 1 up reads as page 1, so a
 * hand-edited URL cannot turn into a validation refusal from the API.
 *
 * @param {Record<string, string|string[]|undefined>} [searchParams] Resolved search parameters.
 * @returns {number} A page number from 1 to 10,000.
 */
export function readPage(searchParams = {}) {
  const raw = searchParams?.page
  const value = Array.isArray(raw) ? raw[0] : raw

  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return 1

  const page = Number(value.trim())

  return page >= 1 ? Math.min(page, MAX_PAGE) : 1
}

/**
 * The link to a page of the orders list.
 *
 * @param {number} page The page.
 * @returns {string} The path, with `page=` only when it is not the first.
 */
export function ordersPageHref(page) {
  return page > 1 ? `/account/orders?page=${page}` : '/account/orders'
}
