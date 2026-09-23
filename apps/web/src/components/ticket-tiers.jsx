/**
 * The ticket tier table on an event's detail page.
 *
 * Availability is shown with a number rather than a vague "limited": "Only 9
 * left" is information a buyer can act on, "selling fast" is not. The count
 * already has active holds subtracted by the time it reaches this component,
 * which is why it can be lower than `quantityTotal − quantitySold`.
 *
 * @module components/ticket-tiers
 */

import { Badge } from './ui.jsx'

import { formatPrice } from '../lib/pricing.js'

/** At or below this many remaining, the exact count is worth showing. */
const LOW_STOCK_THRESHOLD = 25

/**
 * Describe a tier's availability in words a buyer can act on.
 *
 * @param {object} tier A ticket type with `availableQuantity` and `isSoldOut`.
 * @returns {{text: string, variant: string}} Badge text and its colour token.
 */
export function availabilityLabel(tier) {
  if (tier.isSoldOut || tier.availableQuantity <= 0) return { text: 'Sold out', variant: 'danger' }
  if (tier.availableQuantity <= LOW_STOCK_THRESHOLD) {
    return { text: `Only ${tier.availableQuantity} left`, variant: 'warning' }
  }

  return { text: 'On sale', variant: 'success' }
}

/**
 * @typedef {object} TicketTiersProps
 * @property {object[]} ticketTypes Ticket tiers with availability folded in.
 */

/**
 * A read-only list of an event's ticket tiers.
 *
 * @param {TicketTiersProps} props Component props.
 * @returns {JSX.Element} The rendered tier list.
 */
export function TicketTiers({ ticketTypes }) {
  return (
    <ul
      aria-label="Ticket types"
      className="divide-y divide-line rounded-card border border-line bg-surface-raised"
    >
      {ticketTypes.map((tier) => {
        const availability = availabilityLabel(tier)

        return (
          <li
            key={tier.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium text-ink">{tier.name}</p>
              {tier.description ? (
                <p className="mt-1 text-sm text-ink-muted">{tier.description}</p>
              ) : null}
              <p className="mt-2">
                <Badge variant={availability.variant} srLabel="Availability:">
                  {availability.text}
                </Badge>
              </p>
            </div>
            <p className="shrink-0 text-right">
              <span className="font-display text-lg font-semibold text-ink">
                {formatPrice(tier.priceCents, tier.currency)}
              </span>
              <span className="sr-only"> per ticket</span>
            </p>
          </li>
        )
      })}
    </ul>
  )
}
