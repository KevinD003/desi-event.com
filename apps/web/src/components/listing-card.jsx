/**
 * A single event in a listing grid.
 *
 * The whole card is clickable but there is exactly one link in it: the title
 * link is stretched over the card with a pseudo-element. Wrapping the card in a
 * link instead would give a screen reader user one enormous link whose
 * accessible name is the entire card, and adding a second "View" link would
 * make every card appear twice in the links list.
 *
 * @module components/listing-card
 */

import Link from 'next/link'
import { Badge, Card, CardBody, CardFooter } from './ui.jsx'

import { categoryLabel } from '../lib/catalog.js'
import {
  formatEventDate,
  formatEventLocation,
  formatEventTime,
  toDateTimeAttribute,
} from '../lib/format.js'
import { formatPrice } from '../lib/pricing.js'
import { HoverLift, RevealOnScroll } from './motion.jsx'
import { EventPoster } from './poster.jsx'

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
  const priceLabel =
    event.minPriceCents == null
      ? 'Price to be announced'
      : formatPrice(event.minPriceCents, event.currency ?? 'INR')

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
              {event.soldOut ? (
                <Badge variant="danger" srLabel="Availability:">
                  Sold out
                </Badge>
              ) : null}
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

          <CardFooter className="justify-between bg-accent-soft/60">
            <p className="text-sm text-ink-muted">
              <span className="text-ink-muted">From </span>
              <span className="font-semibold text-ink">{priceLabel}</span>
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
