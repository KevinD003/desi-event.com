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
 * The poster, wearing its category; the start in the event's own zone with the
 * zone's letters ("Sat, Oct 17 · 7:30 PM EDT"); the title; the venue and city,
 * or "Online"; who is putting it on; the price one ticket starts at; and
 * whether tickets can be bought now. The price is all-in when the API sends it
 * all-in — the same figure checkout would charge for one ticket of the
 * cheapest tier — and is said to be before fees when it is not. Nothing is said
 * about how fast anything is selling: the summary carries no such fact.
 *
 * Two things the design shows are not on a card, because a listing summary
 * does not carry them: the venue's state after the city, and the organiser's
 * verified badge. The event's own page shows both, from the full record. A
 * badge inferred here would be an endorsement nobody made.
 *
 * ## Motion
 *
 * The card rises into place as it scrolls into view, lifts 4px while hovered
 * or while its link has keyboard focus, and its poster zooms a little inside
 * its frame. Under reduced motion none of that happens and the card is simply
 * there; the shadow still deepens on hover, because that is a change of state
 * rather than movement.
 *
 * @module components/listing-card
 */

import Link from 'next/link'

import { categoryLabel } from '../lib/catalog.js'
import { eventAvailability, startingPrice } from '../lib/event-availability.js'
import { formatEventStart, toDateTimeAttribute } from '../lib/format.js'
import { formatPrice } from '../lib/pricing.js'
import { PersonIcon, PinIcon } from './icons.jsx'
import { HoverLift, HoverZoom, Reveal } from './motion.jsx'
import { EventPoster } from './poster.jsx'

/**
 * The chip's look, per availability tone. Always with words; the dot is
 * decoration.
 *
 * On sale is outlined in peacock on white; closed — sold out, paused,
 * postponed, cancelled, finished — is the calm plum grey, because a sold-out
 * night is a fact rather than an alarm; "not on sale now" is plain.
 */
const AVAILABILITY_CHIP = Object.freeze({
  open: 'border border-availability-open bg-surface-raised text-availability-open',
  closed: 'bg-availability-closed-soft text-availability-closed',
  neutral: 'bg-surface-subtle text-ink-muted',
})

/** The dot inside each chip, in the chip's own colour. */
const AVAILABILITY_DOT = Object.freeze({
  open: 'bg-availability-open',
  closed: 'bg-availability-closed',
  neutral: 'bg-ink-muted',
})

/**
 * Whether tickets can be bought, in words.
 *
 * @param {object} props Component props.
 * @param {{tone: string, label: string}} props.availability What to say, from `eventAvailability`.
 * @returns {JSX.Element} The chip.
 */
export function AvailabilityChip({ availability }) {
  return (
    <span
      className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold whitespace-nowrap ${AVAILABILITY_CHIP[availability.tone]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${AVAILABILITY_DOT[availability.tone]}`}
      />
      <span className="sr-only">Availability: </span>
      {availability.label}
    </span>
  )
}

/**
 * Where an event is, as a card says it: the venue and the city, "Online" for a
 * streamed event, or that the venue is still to come.
 *
 * @param {object} event An event summary.
 * @returns {string} The place.
 */
function placeOf(event) {
  if (event?.isOnline) return 'Online'

  return [event?.venueName, event?.city].filter(Boolean).join(' · ') || 'Venue to be announced'
}

/**
 * @typedef {object} EventCardProps
 * @property {object} event An event summary.
 * @property {number} [index] Position in the grid, used to stagger the entrance.
 * @property {'h2'|'h3'} [headingLevel] Heading element for the title. Pick the level that keeps the page outline correct.
 * @property {string} [className] Classes for the list item, for a grid that sizes its items itself.
 */

/**
 * An event card, rendered as a list item.
 *
 * @param {EventCardProps} props Component props.
 * @returns {JSX.Element} The rendered card.
 */
export function EventCard({ event, index = 0, headingLevel: Heading = 'h3', className = '' }) {
  const price = startingPrice(event, formatPrice)
  const availability = eventAvailability(event)
  const free = price.amount === 'Free'

  return (
    <Reveal as="li" index={index} className={`flex h-full ${className}`}>
      <HoverLift className="group flex w-full">
        <article className="relative flex w-full flex-col overflow-hidden rounded-card bg-surface-raised shadow-card transition-shadow duration-(--duration-base) ease-standard group-data-lifted:shadow-card-hover hover:shadow-card-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus">
          <div className="relative bg-surface-subtle">
            <HoverZoom className="aspect-[3/2]">
              <EventPoster event={event} className="h-full" />
            </HoverZoom>
            <p className="absolute top-3 left-3 flex flex-wrap gap-2">
              <span className="inline-flex min-h-7 items-center rounded-full bg-surface/95 px-3 text-xs font-bold text-ink shadow-control">
                <span className="sr-only">Category: </span>
                {categoryLabel(event.category)}
              </span>
              {event.isOnline ? (
                <span className="inline-flex min-h-7 items-center rounded-full bg-surface/95 px-3 text-xs font-bold text-accent-secondary shadow-control">
                  Online
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex flex-1 flex-col p-5 sm:p-6">
            <p className="text-sm font-bold text-accent-strong">
              <time dateTime={toDateTimeAttribute(event.startsAt)}>{formatEventStart(event)}</time>
            </p>

            <Heading className="mt-2 text-h3 font-semibold text-ink">
              <Link
                href={`/events/${event.slug}`}
                className="transition-colors duration-(--duration-fast) group-hover:text-accent-strong after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
              >
                {event.title}
              </Link>
            </Heading>

            <p className="mt-2.5 flex gap-1.5 text-sm text-ink-muted">
              <PinIcon className="mt-0.5 h-4 w-4 text-ink-subtle" />
              <span>
                <span className="sr-only">Where: </span>
                {placeOf(event)}
              </span>
            </p>

            {event.organizationName ? (
              <p className="mt-1.5 flex gap-1.5 text-sm text-ink-muted">
                <PersonIcon className="mt-0.5 h-4 w-4 text-ink-subtle" />
                <span className="sr-only">Organiser: </span>
                <span>{event.organizationName}</span>
              </p>
            ) : null}

            <div className="mt-auto pt-4">
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-line pt-4">
                <p className="min-w-0 text-sm text-ink-subtle">
                  {!free && (price.qualifier || price.allIn) ? <span>From </span> : null}
                  <span className="text-xl leading-6 font-bold text-ink tabular-nums">
                    {price.amount}
                  </span>
                  {price.qualifier ? (
                    <span className="mt-0.5 block text-xs text-ink-subtle">{price.qualifier}</span>
                  ) : null}
                </p>
                {availability ? <AvailabilityChip availability={availability} /> : null}
              </div>
            </div>
          </div>
        </article>
      </HoverLift>
    </Reveal>
  )
}

/**
 * @typedef {object} EventGridProps
 * @property {object[]} events Event summaries to render.
 * @property {string} label Accessible name for the list, e.g. `Upcoming events`.
 * @property {'h2'|'h3'} [headingLevel] Heading element used inside each card.
 * @property {'grid'|'rail'} [layout] A wrapping grid (the default), or — for a short featured row — a rail that scrolls sideways on a phone and becomes a four-up grid on a wide screen.
 */

/**
 * A responsive list of event cards.
 *
 * It is a `ul` so that assistive technology announces how many events there
 * are before the visitor starts reading them.
 *
 * The rail scrolls inside itself, never the page: the list is the scroll
 * container, it is reachable by keyboard because every card holds a link, and
 * snapping keeps a card from resting half in view.
 *
 * @param {EventGridProps} props Component props.
 * @returns {JSX.Element} The rendered grid.
 */
export function EventGrid({ events, label, headingLevel = 'h3', layout = 'grid' }) {
  const rail = layout === 'rail'

  return (
    <ul
      aria-label={label}
      className={
        rail
          ? '-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pt-1 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:px-0 sm:pb-1 xl:grid-cols-4'
          : 'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'
      }
    >
      {events.map((event, index) => (
        <EventCard
          key={event.id ?? event.slug}
          event={event}
          index={index}
          headingLevel={headingLevel}
          className={rail ? 'w-[82%] max-w-80 shrink-0 snap-start sm:w-auto sm:max-w-none' : ''}
        />
      ))}
    </ul>
  )
}
