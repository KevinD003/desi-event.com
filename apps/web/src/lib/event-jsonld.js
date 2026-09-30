/**
 * Structured data for an event, and the lifecycle states it has to tell the
 * truth about.
 *
 * `schema.org/Event` has an `eventStatus` vocabulary precisely because the
 * interesting cases are the ones where something went wrong: an event that was
 * cancelled, or moved, or is now online. A page that omits it is telling a
 * search engine the show is on, and a search engine will repeat that in a rich
 * result long after the organiser has cancelled.
 *
 * So the mapping is the substance of this module, not an afterthought:
 *
 *   - `CANCELLED` becomes `EventCancelled`, and `previousStartDate` carries the
 *     date somebody had in their calendar.
 *   - `POSTPONED` becomes `EventPostponed`, which is the vocabulary's own word
 *     for "it is not happening then and we will say when".
 *   - A postponed event brought back on a new date is `EventRescheduled`, with
 *     `previousStartDate` the date it moved from: `EventScheduled` means "on
 *     the startDate as scheduled", which an event that moved is not.
 *   - Everything else on sale is `EventScheduled`.
 *
 * ## What is not in here
 *
 * Nothing the API would not give an anonymous caller. The structured data is
 * built from the same public payload the page renders, so there is one
 * allow-list rather than two — a second source is how an organiser's contact
 * address ends up in a `<script>` tag after having been kept out of the visible
 * page. That was finding NF-14, and this is the shape it would have taken.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file lib/event-jsonld
 */

import { absoluteMediaUrl } from './media.js'
import { sessionDisplayLabel } from './sessions.js'
import { socialImageFor } from './social-image.js'

/**
 * `schema.org` event-status URLs, by our own lifecycle status.
 *
 * @type {Readonly<Record<string, string>>}
 */
const EVENT_STATUS = Object.freeze({
  PUBLISHED: 'https://schema.org/EventScheduled',
  ON_SALE: 'https://schema.org/EventScheduled',
  SALES_PAUSED: 'https://schema.org/EventScheduled',
  SOLD_OUT: 'https://schema.org/EventScheduled',
  COMPLETED: 'https://schema.org/EventScheduled',
  POSTPONED: 'https://schema.org/EventPostponed',
  CANCELLED: 'https://schema.org/EventCancelled',
})

/**
 * The statuses a postponed event comes back to, where a start that moved makes
 * it `EventRescheduled` rather than `EventScheduled`.
 *
 * @type {ReadonlySet<string>}
 */
const RESCHEDULABLE = new Set(['PUBLISHED', 'ON_SALE', 'SALES_PAUSED', 'SOLD_OUT', 'COMPLETED'])

/**
 * Whether the event was postponed and brought back on another date.
 *
 * `previousStartsAt` is written at postponement and kept, so an event back on
 * sale carries it; it means a reschedule only when the start actually moved.
 *
 * @param {object} event The public event payload.
 * @returns {boolean} True when it now starts somewhere other than it did.
 */
function wasRescheduled(event) {
  if (!event.previousStartsAt || !RESCHEDULABLE.has(event.status)) return false

  const before = Date.parse(event.previousStartsAt)
  const after = Date.parse(event.startsAt)

  return Number.isFinite(before) && Number.isFinite(after) && before !== after
}

/**
 * `schema.org` availability URLs, by what the ticket situation actually is.
 *
 * @type {Readonly<Record<string, string>>}
 */
const AVAILABILITY = Object.freeze({
  ON_SALE: 'https://schema.org/InStock',
  SOLD_OUT: 'https://schema.org/SoldOut',
  SALES_PAUSED: 'https://schema.org/PreOrder',
  PUBLISHED: 'https://schema.org/PreOrder',
})

/**
 * The structured-data object for an event, or null when there is nothing to say.
 *
 * @param {object} event The public event payload.
 * @param {object} [options] Options.
 * @param {string} [options.siteUrl] Absolute origin, for the canonical URL.
 * @returns {object|null} A JSON-LD object, or null.
 */
export function eventJsonLd(event, { siteUrl = '' } = {}) {
  if (!event?.slug || !event?.title) return null

  const url = `${siteUrl}/events/${event.slug}`
  // A hidden tier — a guest list, a complimentary allocation — is not an offer
  // to the public. The public payload leaves them out already; this holds
  // even for a payload that did not.
  const tiers = (event.ticketTypes ?? []).filter(
    (tier) => Number.isFinite(tier.priceCents) && tier.visibility !== 'HIDDEN',
  )

  const rescheduled = wasRescheduled(event)
  const status = rescheduled
    ? 'https://schema.org/EventRescheduled'
    : (EVENT_STATUS[event.status] ?? 'https://schema.org/EventScheduled')

  /** @type {Record<string, unknown>} */
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.summary,
    startDate: event.startsAt,
    endDate: event.endsAt,
    eventStatus: status,
    eventAttendanceMode: event.isOnline
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    url,
  }

  // The date somebody wrote in their diary. Without it a postponement says
  // only that something changed, not what. On an event back on sale it goes
  // with `EventRescheduled` and only then: a start that did not move was not
  // rescheduled from anywhere.
  if (event.previousStartsAt && (rescheduled || !RESCHEDULABLE.has(event.status))) {
    data.previousStartDate = event.previousStartsAt
  }

  // Always the page, never the joining link: the link is for ticket holders,
  // and structured data is read by every search engine and scraper there is.
  if (event.isOnline) {
    data.location = { '@type': 'VirtualLocation', url }
  } else if (event.venue) {
    data.location = {
      '@type': 'Place',
      name: event.venue.name,
      address: {
        '@type': 'PostalAddress',
        streetAddress: event.venue.addressLine1,
        addressLocality: event.venue.city,
        addressRegion: event.venue.region,
        postalCode: event.venue.postalCode,
        addressCountry: event.venue.country,
      },
    }
  }

  if (event.organization?.name) {
    data.organizer = {
      '@type': 'Organization',
      name: event.organization.name,
      ...(event.organization.slug
        ? { url: `${siteUrl}/organizers/${event.organization.slug}` }
        : {}),
    }
  }

  // The line-up with roles is the source of truth; the names alone are what
  // an event saved before it existed has.
  const performers =
    event.performers?.length > 0
      ? event.performers.map((performer) => performer?.name).filter(Boolean)
      : (event.artists ?? [])

  if (performers.length > 0) {
    data.performer = performers.map((name) => ({ '@type': 'PerformingGroup', name }))
  }

  // A cancelled event has no offers. Leaving them in would describe tickets on
  // sale for something that is not happening.
  if (tiers.length > 0 && event.status !== 'CANCELLED') {
    data.offers = tiers.map((tier) => ({
      '@type': 'Offer',
      name: tier.name,
      price: (tier.priceCents / 100).toFixed(2),
      priceCurrency: tier.currency ?? 'USD',
      availability: AVAILABILITY[event.status] ?? 'https://schema.org/PreOrder',
      url,
      ...(tier.salesStartAt ? { validFrom: tier.salesStartAt } : {}),
    }))
  }

  if (event.ageRestriction) {
    data.typicalAgeRange = `${event.ageRestriction}-`
  }

  // Each night of a run of several, as an event of its own, named with its
  // label or its date, and cancelled when that night is.
  const sessions = event.sessions ?? []

  if (sessions.length > 1) {
    data.subEvent = sessions.map((session) => ({
      '@type': 'Event',
      name: `${event.title} — ${sessionDisplayLabel(session)}`,
      startDate: session.startsAt,
      endDate: session.endsAt,
      ...(session.doorsOpenAt ? { doorTime: session.doorsOpenAt } : {}),
      eventStatus: session.status === 'CANCELLED' ? 'https://schema.org/EventCancelled' : status,
      url,
    }))
  }

  // What a search result shows beside the listing: the organiser's approved
  // cover and up to two gallery pictures, each an absolute URL on this site.
  // With none, the generated poster at its social-card address, so the result
  // shows the same picture a shared link does.
  const pictures = [event.coverImage, ...(event.gallery ?? []).slice(0, 2)]
    .map((image) => absoluteMediaUrl(image, siteUrl))
    .filter(Boolean)

  data.image =
    pictures.length > 0
      ? pictures
      : [`${siteUrl}/events/${event.slug}/opengraph-image/${socialImageFor(event).id}`]

  return data
}

/**
 * How a lifecycle state reads on the page, for somebody who is not a developer.
 *
 * Kept beside the structured data on purpose: the two must not disagree. A
 * banner saying "cancelled" over structured data saying `EventScheduled` is
 * worse than either alone, because one of them is feeding a search result.
 *
 * @param {string} status The event status.
 * @returns {object|null} A notice, or null when the ordinary page is right.
 */
export function lifecycleNotice(status) {
  if (status === 'CANCELLED') {
    return {
      variant: 'error',
      title: 'This event has been cancelled',
      body: 'Tickets are not on sale. If you bought one, a refund is owed to you and the organiser has been asked to make it.',
    }
  }

  if (status === 'POSTPONED') {
    return {
      variant: 'warning',
      title: 'This event has been postponed',
      body: 'A new date has not been confirmed. Your ticket stays valid unless the organiser tells you otherwise.',
    }
  }

  if (status === 'SOLD_OUT') {
    return {
      variant: 'info',
      title: 'Sold out',
      body: 'Every ticket has gone. Returns sometimes come back, so it is worth checking again.',
    }
  }

  if (status === 'SALES_PAUSED') {
    return {
      variant: 'info',
      title: 'Sales are paused',
      body: 'The organiser has stopped selling for now. The event is still going ahead.',
    }
  }

  if (status === 'COMPLETED') {
    return {
      variant: 'info',
      title: 'This event has finished',
      body: 'It is kept here so the people who went, and the people who have a ticket stub, can still find it.',
    }
  }

  return null
}
