/**
 * The organiser's read-only panel "Booking fee and payment" (SPEC3 §12.4).
 *
 * The booking fee and the pay-at-the-venue switch are decisions the team at
 * The Desi Events makes about an event, so the organiser reads them here and
 * changes nothing: there are no controls, and every sentence says who decides.
 * The figures are the server's (`event.paymentTerms`, sent to the event's own
 * team and to administrators); nothing is computed here but their wording.
 *
 * The link to "Payments at the venue" is offered when the page says this
 * reader may read the organisation's finance (`mayReadVenuePayments`, a
 * boolean the server page worked out) **and** the event takes or has taken
 * bookings to pay at the door, so the organiser keeps the page after the
 * switch is turned off while bookings made under it remain.
 *
 * A plain component: it holds no state and can render on the server.
 *
 * @module components/payment-terms-summary
 */

import Link from 'next/link'

import { percentText, venueStatusText } from '../lib/event-control.js'
import { formatDateIn } from '../lib/format.js'
import { formatAmount } from '../lib/pricing.js'

/** The link's classes: a 44px target, underlined, with a visible focus ring. */
const LINK =
  'inline-flex min-h-11 items-center rounded-sm font-medium underline underline-offset-4 hover:text-accent-strong focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus'

/**
 * A booking fee's terms in words: "3.00% of the ticket price plus $1.49 per
 * ticket", the way the panel of the team at The Desi Events writes them.
 *
 * @param {{percentageBps: number, flatCentsPerTicket: number}} terms The fee.
 * @param {string} currency The currency the event sells in.
 * @returns {string} The words.
 */
export function feeTermsWords(terms, currency) {
  const percent = percentText(terms.percentageBps ?? 0)

  return `${percent}% of the ticket price plus ${formatAmount(terms.flatCentsPerTicket ?? 0, currency)} per ticket`
}

/**
 * The sentence about the event's booking fee (SPEC3 §12.4).
 *
 * @param {object} fee `paymentTerms.fee`.
 * @returns {string} The sentence.
 */
export function feeSentence(fee) {
  if ((fee.percentageBps ?? 0) === 0 && (fee.flatCentsPerTicket ?? 0) === 0) {
    return 'This event has no booking fee.'
  }

  const terms = feeTermsWords(fee, fee.currency ?? 'USD')

  return fee.source === 'EVENT'
    ? `Booking fee on this event: ${terms}. Set by the team at The Desi Events.`
    : `Booking fee on this event: the site’s standard booking fee, ${terms}. Set by the team at The Desi Events.`
}

/**
 * The sentence about paying at the venue (SPEC3 §12.4).
 *
 * @param {object} venuePayment `paymentTerms.venuePayment`.
 * @returns {string} The sentence, with the state as a word.
 */
export function venuePaymentSentence(venuePayment) {
  // The state in the own words of the team at The Desi Events for it
  // (`venueStatusText`), so the organiser reads the switch exactly as the
  // team's panel writes it.
  return `Pay at the venue: ${venueStatusText(venuePayment)}. Only the team at The Desi Events can change this.`
}

/**
 * Who changed a setting, when and why, or null when it was never changed.
 *
 * The date is the day it was where the event is (its own zone), as every
 * other date on the organiser's event pages is written.
 *
 * @param {{changedAt?: string|null, changedByName?: string|null, reason?: string|null}} setting The fee or the switch.
 * @param {string} [timeZone] The event's IANA zone; UTC when unknown.
 * @returns {string|null} "Changed by {name} on {date}: “{reason}”".
 */
export function changedSentence(setting, timeZone = 'UTC') {
  if (!setting?.changedAt) return null

  const date = formatDateIn(setting.changedAt, timeZone)
  const who = setting.changedByName ?? 'the team at The Desi Events'
  const when = date ? ` on ${date}` : ''

  return setting.reason
    ? `Changed by ${who}${when}: “${setting.reason}”`
    : `Changed by ${who}${when}.`
}

/**
 * @typedef {object} PaymentTermsSummaryProps
 * @property {string} eventId The event.
 * @property {object} paymentTerms The event's `paymentTerms`: `{ fee, siteDefault, venuePayment }`.
 * @property {boolean} [mayReadVenuePayments] Whether this reader may read the organisation's finance.
 * @property {string} [timeZone] The event's IANA zone, which the changes' dates are written in.
 */

/**
 * The panel.
 *
 * @param {PaymentTermsSummaryProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function PaymentTermsSummary({
  eventId,
  paymentTerms,
  mayReadVenuePayments = false,
  timeZone = 'UTC',
}) {
  const { fee, venuePayment } = paymentTerms
  const feeChange = changedSentence(fee, timeZone)
  const switchChange = changedSentence(venuePayment, timeZone)
  const link =
    mayReadVenuePayments && (venuePayment.enabled || venuePayment.hasOrders)
      ? `/organizer/events/${encodeURIComponent(eventId)}/venue-payments`
      : null

  return (
    <section
      aria-labelledby="payment-terms-summary-heading"
      data-testid="payment-terms-summary"
      className="max-w-2xl rounded-card border border-line bg-surface-raised p-5 text-ink shadow-card"
    >
      <h2 id="payment-terms-summary-heading" className="text-lg font-semibold text-ink">
        Booking fee and payment
      </h2>
      <p className="mt-2 text-sm">{feeSentence(fee)}</p>
      {feeChange ? <p className="mt-1 text-sm break-words text-ink-muted">{feeChange}</p> : null}
      <p className="mt-3 text-sm">{venuePaymentSentence(venuePayment)}</p>
      {switchChange ? (
        <p className="mt-1 text-sm break-words text-ink-muted">{switchChange}</p>
      ) : null}
      {link ? (
        <p className="mt-2 text-sm">
          <Link href={link} className={LINK}>
            Payments at the venue
          </Link>
        </p>
      ) : null}
    </section>
  )
}
