/**
 * A single event in a listing grid.
 *
 * The whole card is clickable but there is exactly one link in it: the title
 * link is stretched over the card with a pseudo-element. Wrapping the card in a
 * link instead would give a screen reader user one enormous link whose
 * accessible name is the entire card, and adding a second "View" link would
 * make every card appear twice in the links list.
 *
 * ## What a card says
 *
 * Title, poster, date and local time in the event's own zone, venue or
 * "Online", city, who is putting it on, the category, whether tickets can be
 * bought now, and the price one ticket starts at. The price is all-in when the
 * API sends it all-in — the same figure checkout would charge for one ticket of
 * the cheapest tier — and is said to be before fees when it is not. Nothing is
 * said about how fast anything is selling: the summary carries no such fact.
 *
 * @module components/listing-card
 */

import Link from 'next/link'
import { Badge, Card, CardBody, CardFooter } from './ui.jsx'

import { categoryLabel } from '../lib/catalog.js'
import { eventAvailability, startingPrice } from '../lib/event-availability.js'
import {
  formatEventDate,
  formatEventLocation,
  formatEventTime,
  toDateTimeAttribute,
} from '../lib/format.js'
import { formatPrice } from '../lib/pricing.js'
import { HoverLift, RevealOnScroll } from './motion.jsx'
import { EventPoster } from './poster.jsx'

/** The chip's colours, per availability tone. Always with words. */
const AVAILABILITY_CHIP = Object.freeze({
  open: 'border-availability-open/30 bg-availability-open-soft text-availability-open',
  closed: 'border-availability-closed/30 bg-availability-closed-soft text-availability-closed',
  neutral: 'border-line bg-surface-subtle text-ink-muted',
})

/**
 * Whether tickets can be bought, in words.
 *
 * @param {object} props Component props.
 * @param {{tone: string, label: string}} props.availability What to say, from `eventAvailability`.
 * @returns {JSX.Element} The chip.
 */
function AvailabilityChip({ availability }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${AVAILABILITY_CHIP[availability.tone]}`}
    >
      <span className="sr-only">Availability: </span>
      {availability.label}
    </span>
  )
}

/**
 * @typedef {object} EventCardProps
 * @property {object} event An event summary.
 * @property {number} [index] Position in the grid, used to stagger the entrance.
 * @property {'h2'|'h3'} [headingLevel] Heading element for the title. Pick the level that keeps the page outline correct.
 */

/**
 * An event card, rendered as a list item.
 *
 * @param {EventCardProps} props Component props.
 * @returns {JSX.Element} The rendered card.
 */
export function EventCard({ event, index = 0, headingLevel: Heading = 'h3' }) {
  const price = startingPrice(event, formatPrice)
  const availability = eventAvailability(event)

  return (
    <RevealOnScroll as="li" index={index} className="h-full">
      <HoverLift className="h-full">
        <Card
          as="article"
          interactive
          className="relative flex h-full flex-col overflow-hidden bg-surface-raised"
        >
          <EventPoster event={event} />

          <CardBody className="flex flex-1 flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand">{categoryLabel(event.category)}</Badge>
              {availability ? <AvailabilityChip availability={availability} /> : null}
              {event.isOnline ? <Badge variant="info">Online</Badge> : null}
            </div>

            <Heading className="font-display text-lg leading-snug font-semibold text-ink">
              <Link
                href={`/events/${event.slug}`}
                className="rounded-sm after:absolute after:inset-0 after:content-[''] hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
              >
                {event.title}
              </Link>
            </Heading>

            {event.organizationName ? (
              <p className="text-sm text-ink-muted">
                <span className="sr-only">Organiser: </span>
                By <span className="font-medium text-ink">{event.organizationName}</span>
              </p>
            ) : null}

            <p className="line-clamp-3 text-sm text-ink-muted">{event.summary}</p>

            <dl className="mt-auto space-y-1 pt-2 text-sm text-ink-muted">
              <div className="flex gap-2">
                <dt className="sr-only">Date</dt>
                <dd>
                  <time dateTime={toDateTimeAttribute(event.startsAt)}>
                    {formatEventDate(event.startsAt, event.timezone)}
                  </time>
                  <span aria-hidden="true"> · </span>
                  <span>{formatEventTime(event.startsAt, event.timezone)}</span>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="sr-only">Location</dt>
                <dd className="text-ink-muted">{formatEventLocation(event)}</dd>
              </div>
            </dl>
          </CardBody>

          <CardFooter className="justify-between gap-3 bg-accent-soft/60">
            <p className="text-sm text-ink-muted">
              {price.qualifier || price.allIn ? (
                <span className="text-ink-muted">From </span>
              ) : null}
              <span className="font-semibold text-ink">{price.amount}</span>
              {price.qualifier ? (
                <span className="block text-xs text-ink-muted">{price.qualifier}</span>
              ) : null}
            </p>
            <span aria-hidden="true" className="text-sm font-medium text-accent-strong">
              Details →
            </span>
          </CardFooter>
        </Card>
      </HoverLift>
    </RevealOnScroll>
  )
}

/**
 * @typedef {object} EventGridProps
 * @property {object[]} events Event summaries to render.
 * @property {string} label Accessible name for the list, e.g. `Upcoming events`.
 * @property {'h2'|'h3'} [headingLevel] Heading element used inside each card.
 */

/**
 * A responsive grid of event cards.
 *
 * It is a `ul` so that assistive technology announces how many events there
 * are before the visitor starts reading them.
 *
 * @param {EventGridProps} props Component props.
 * @returns {JSX.Element} The rendered grid.
 */
export function EventGrid({ events, label, headingLevel = 'h3' }) {
  return (
    <ul aria-label={label} className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((event, index) => (
        <EventCard
          key={event.id ?? event.slug}
          event={event}
          index={index}
          headingLevel={headingLevel}
        />
      ))}
    </ul>
  )
}
