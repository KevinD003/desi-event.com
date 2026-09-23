/**
 * The ticket tier list on an event's detail page.
 *
 * Availability is shown with a number rather than a vague "limited": "Only 9
 * left" is information a buyer can act on, "selling fast" is not. The count
 * already has active holds subtracted by the time it reaches this component,
 * which is why it can be lower than `quantityTotal − quantitySold`.
 *
 * Each tier shows its face value and, where the fee terms and the venue are
 * known, what one ticket comes to with them — priced by the same function and
 * the same terms checkout charges with, so the figure here is the figure there.
 *
 * @module components/ticket-tiers
 */

import { Badge } from './ui.jsx'

import { tierSalesWindow } from '../lib/event-availability.js'
import { formatPrice, priceSelection } from '../lib/pricing.js'

/** At or below this many remaining, the exact count is worth showing. */
const LOW_STOCK_THRESHOLD = 25

/**
 * Tier statuses that stop a sale on purpose, and what each says. Checked before
 * the quantity: the availability fold marks any tier not `ON_SALE` as having
 * nothing available, and reading that as stock called a paused tier sold out.
 */
const STOPPED = Object.freeze({
  PAUSED: { text: 'Sales paused', variant: 'neutral' },
  CLOSED: { text: 'Not on sale now', variant: 'neutral' },
  DRAFT: { text: 'Not on sale now', variant: 'neutral' },
})

/**
 * Describe a tier's availability in words a buyer can act on.
 *
 * The words are the listing cards' own, and the sales window is read the way
 * the hold route reads it (`tierSalesWindow`), so a tier whose sales have not
 * opened says so here rather than "On sale" above a checkout that refuses it.
 *
 * @param {object} tier A ticket type with `availableQuantity` and `isSoldOut`, and optionally `status` and a sales window.
 * @param {Date} [now] The moment in question. Defaults to now.
 * @returns {{text: string, variant: string}} Badge text and its colour token.
 */
export function availabilityLabel(tier, now = new Date()) {
  // Before the quantity check: a seated tier's quantity is zero by design, and
  // reading it called every seated tier sold out. There is no seat picker on
  // this site, so the honest sentence is that it is not sold here.
  if (tier.reserved) return { text: 'Seated — not sold on this site', variant: 'neutral' }
  if (tier.status === 'SOLD_OUT') return { text: 'Sold out', variant: 'danger' }
  if (STOPPED[tier.status]) return STOPPED[tier.status]
  if (tier.isSoldOut || tier.availableQuantity <= 0) return { text: 'Sold out', variant: 'danger' }
  if (tierSalesWindow(tier, now) !== 'open') return { text: 'Not on sale now', variant: 'neutral' }
  if (tier.availableQuantity <= LOW_STOCK_THRESHOLD) {
    return { text: `Only ${tier.availableQuantity} left`, variant: 'warning' }
  }

  return { text: 'On sale', variant: 'success' }
}

/**
 * What one ticket of a tier comes to with the booking fee and any tax, or null
 * when that is the face value anyway, or cannot be worked out.
 *
 * @param {object} tier A ticket type.
 * @param {{country?: string, region?: string}|null} place Where the event is held.
 * @param {Array<object>|null} feeTerms The fee terms the API published for the event.
 * @returns {{totalCents: number, feesCents: number, taxCents: number}|null} The breakdown.
 */
export function tierAllIn(tier, place, feeTerms) {
  if (!place || !Number.isInteger(tier?.priceCents) || tier.priceCents === 0) return null

  const totals = priceSelection({
    lines: [
      { ticketTypeId: tier.id, name: tier.name, quantity: 1, unitPriceCents: tier.priceCents },
    ],
    currency: tier.currency ?? 'USD',
    place,
    feeTerms,
  })

  if (totals.totalCents === tier.priceCents) return null

  return { totalCents: totals.totalCents, feesCents: totals.feesCents, taxCents: totals.taxCents }
}

/**
 * @typedef {object} TicketTiersProps
 * @property {object[]} ticketTypes Ticket tiers with availability folded in.
 * @property {{country?: string, region?: string}|null} [place] Where the event is held, for the fee-inclusive price. Without it only face values are shown.
 * @property {Array<object>|null} [feeTerms] The fee terms the API published for the event.
 */

/**
 * A read-only list of an event's ticket tiers.
 *
 * @param {TicketTiersProps} props Component props.
 * @returns {JSX.Element} The rendered tier list.
 */
export function TicketTiers({ ticketTypes, place = null, feeTerms = null }) {
  return (
    <ul aria-label="Ticket types" className="divide-y divide-line">
      {ticketTypes.map((tier) => {
        const availability = availabilityLabel(tier)
        const allIn = availability.text === 'Sold out' ? null : tierAllIn(tier, place, feeTerms)

        return (
          <li
            key={tier.id}
            className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <p className="font-bold text-ink">{tier.name}</p>
              {tier.description ? (
                <p className="mt-0.5 text-sm text-ink-muted">{tier.description}</p>
              ) : null}
              <p className="mt-2">
                <Badge variant={availability.variant} srLabel="Availability:">
                  {availability.text}
                </Badge>
              </p>
            </div>
            <p className="shrink-0 sm:text-right">
              <span className="block text-lg font-bold text-ink tabular-nums">
                {formatPrice(tier.priceCents, tier.currency)}
              </span>
              <span className="sr-only"> per ticket</span>
              {allIn ? (
                <span className="block text-xs text-ink-subtle tabular-nums">
                  {formatPrice(allIn.totalCents, tier.currency)} with fees
                  {allIn.taxCents > 0 ? ' and tax' : ''}
                </span>
              ) : null}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
