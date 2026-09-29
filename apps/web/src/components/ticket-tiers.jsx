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

import Link from 'next/link'

import { Badge } from './ui.jsx'

import { tierSalesWindow } from '../lib/event-availability.js'
import { formatPrice, priceSelection } from '../lib/pricing.js'
import { groupTiersBySession, sessionForTier, sessionSellsSeats } from '../lib/sessions.js'
import { TEXT_LINK } from './link-classes.js'

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
 * Describe a seated tier's availability, from its own seats.
 *
 * A seated tier's stock is the free seats it sells, which the API counts per
 * tier (`availableQuantity`). Never the night's count: that is every zone's
 * seats together, and read as one tier's it called a sold-out zone "Only 6
 * seats left" and offered seats of a draft or a guest-list tier. Without a
 * seat map to choose from — the fallback catalogue has none — it is not sold
 * here, and says so. A tier whose seats were not counted gets no number.
 *
 * @param {object} tier A reserved ticket type.
 * @param {object|null} session Its night, from `event.sessions`.
 * @param {Date} now The moment in question.
 * @returns {{text: string, variant: string}} Badge text and its colour token.
 */
function seatedAvailability(tier, session, now) {
  if (!session?.hasSeatMap) return { text: 'Seated — not sold on this site', variant: 'neutral' }
  if (tier.status === 'SOLD_OUT') return { text: 'Sold out', variant: 'danger' }
  if (STOPPED[tier.status]) return STOPPED[tier.status]

  const free = Number.isInteger(tier.availableQuantity) ? tier.availableQuantity : null

  if (free === 0) return { text: 'Sold out', variant: 'danger' }
  if (tierSalesWindow(tier, now) !== 'open' || !sessionSellsSeats(session, now)) {
    return { text: 'Not on sale now', variant: 'neutral' }
  }
  if (free !== null && free <= LOW_STOCK_THRESHOLD) {
    return { text: `Only ${free} ${free === 1 ? 'seat' : 'seats'} left`, variant: 'warning' }
  }

  return { text: 'Choose seats', variant: 'success' }
}

/**
 * Describe a tier's availability in words a buyer can act on.
 *
 * The words are the listing cards' own, and the sales window is read the way
 * the hold route reads it (`tierSalesWindow`), so a tier whose sales have not
 * opened says so here rather than "On sale" above a checkout that refuses it.
 *
 * @param {object} tier A ticket type with `availableQuantity` and `isSoldOut`, and optionally `status` and a sales window.
 * @param {Date} [now] The moment in question. Defaults to now.
 * @param {object|null} [session] The tier's night, for a seated tier's seats.
 * @returns {{text: string, variant: string}} Badge text and its colour token.
 */
export function availabilityLabel(tier, now = new Date(), session = null) {
  // Before the quantity check: a seated tier's quantity is zero by design, and
  // reading it called every seated tier sold out. Its stock is its night's
  // seats, read from the night.
  if (tier.reserved) return seatedAvailability(tier, session, now)
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
 * An instant in the event's zone, as a buyer reads it: `Oct 1, 11:59 PM EDT`.
 *
 * @param {string} value An ISO instant.
 * @param {string} zone The event's IANA zone.
 * @returns {string} The reading.
 */
function atLocal(value, zone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

/**
 * The tier's own sales window in a sentence, when it has one worth saying.
 *
 * An early-bird tier that closes on the first of the month says so, in the
 * venue's zone: a buyer deciding whether to wait needs the date, not a badge.
 * Read with the same `tierSalesWindow` the badge and the hold route use.
 *
 * @param {object} tier A ticket type with `salesStartAt` and `salesEndAt`.
 * @param {string} zone The event's IANA zone.
 * @param {Date} [now] The moment in question.
 * @returns {string|null} For example `On sale until Oct 1, 11:59 PM EDT`, or null.
 */
export function salesWindowText(tier, zone, now = new Date()) {
  const state = tierSalesWindow(tier, now)

  if (state === 'not-started') return `On sale from ${atLocal(tier.salesStartAt, zone)}`
  if (state === 'ended') return `Sales ended ${atLocal(tier.salesEndAt, zone)}`
  if (state === 'open' && tier.salesEndAt) return `On sale until ${atLocal(tier.salesEndAt, zone)}`

  return null
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
 * @property {string} [timezone] The event's zone, for the sales-window sentence.
 * @property {object[]} [sessions] The event's nights; with more than one, tiers are grouped under them.
 * @property {string|null} [eventSlug] The event's slug, to link a seated tier to its seat map.
 */

/**
 * A read-only list of an event's ticket tiers, grouped by night when the event
 * has more than one.
 *
 * @param {TicketTiersProps} props Component props.
 * @returns {JSX.Element} The rendered tier list.
 */
export function TicketTiers({
  ticketTypes,
  place = null,
  feeTerms = null,
  timezone = 'UTC',
  sessions = [],
  eventSlug = null,
}) {
  const groups = groupTiersBySession(ticketTypes, sessions)

  if (groups.length === 1 && !groups[0].heading) {
    return (
      <TierList
        tiers={ticketTypes}
        label="Ticket types"
        place={place}
        feeTerms={feeTerms}
        timezone={timezone}
        sessions={sessions}
        eventSlug={eventSlug}
      />
    )
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="text-base font-bold text-ink">{group.heading}</h3>
          <div className="mt-3">
            <TierList
              tiers={group.tiers}
              label={`Ticket types, ${group.heading}`}
              place={place}
              feeTerms={feeTerms}
              timezone={timezone}
              sessions={sessions}
              eventSlug={eventSlug}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * One list of tiers.
 *
 * @param {object} props Component props.
 * @param {object[]} props.tiers The tiers.
 * @param {string} props.label The list's accessible name.
 * @param {object|null} props.place Where the event is held.
 * @param {Array<object>|null} props.feeTerms The event's fee terms.
 * @param {string} props.timezone The event's zone.
 * @param {object[]} props.sessions The event's nights.
 * @param {string|null} props.eventSlug The event's slug.
 * @returns {JSX.Element} The list.
 */
function TierList({ tiers, label, place, feeTerms, timezone, sessions, eventSlug }) {
  return (
    <ul aria-label={label} className="divide-y divide-line">
      {tiers.map((tier) => {
        const session = sessionForTier(tier, sessions)
        const availability = availabilityLabel(tier, new Date(), session)
        const allIn = availability.text === 'Sold out' ? null : tierAllIn(tier, place, feeTerms)
        const salesWindow = salesWindowText(tier, timezone)
        const seatLink =
          tier.reserved && session && eventSlug && availability.variant !== 'danger'
            ? availability.text === 'Choose seats' || availability.variant === 'warning'
              ? `/events/${encodeURIComponent(eventSlug)}/seats/${encodeURIComponent(session.id)}`
              : null
            : null

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
              {salesWindow ? <p className="mt-1 text-sm text-ink-muted">{salesWindow}</p> : null}
              {seatLink ? (
                <p className="mt-2 text-sm">
                  <Link href={seatLink} className={TEXT_LINK}>
                    Choose seats for {tier.name}
                  </Link>
                </p>
              ) : null}
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
