/**
 * An event's detail page: what it is, when and where it runs, and what a seat
 * costs right now.
 *
 * @module app/events/slug/page
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, CardBody } from '../../../components/ui.jsx'

import { loadEventBySlug } from '../../../lib/api.js'
import { categoryLabel } from '../../../lib/catalog.js'
import {
  formatEventDate,
  formatEventTime,
  formatEventWhen,
  formatTimeZoneLabel,
  formatVenueAddress,
  toDateTimeAttribute,
  toParagraphs,
} from '../../../lib/format.js'
import { formatPrice } from '../../../lib/pricing.js'
import { EventPoster } from '../../../components/poster.jsx'
import { FadeIn, RevealOnScroll } from '../../../components/motion.jsx'
import { SampleDataNotice } from '../../../components/sample-data-notice.jsx'
import { TicketTiers } from '../../../components/ticket-tiers.jsx'

export const dynamic = 'force-dynamic'

/**
 * The cheapest ticket still on sale, used for the "from" price.
 *
 * @param {object[]} ticketTypes Ticket tiers with availability folded in.
 * @returns {object|null} The cheapest available tier, or `null` when everything has gone.
 */
function cheapestAvailable(ticketTypes) {
  const available = ticketTypes.filter((tier) => !tier.isSoldOut)
  if (available.length === 0) return null

  return available.reduce((lowest, tier) => (tier.priceCents < lowest.priceCents ? tier : lowest))
}

/**
 * Per-event metadata for search engines and link previews.
 *
 * @param {object} props Route props.
 * @param {Promise<{slug: string}>} props.params The resolved route parameters.
 * @returns {Promise<object>} A Next.js metadata object.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params
  const { event } = await loadEventBySlug(slug)

  if (!event) {
    return { title: 'Event not found', robots: { index: false, follow: false } }
  }

  const where = event.venue ? `${event.venue.name}, ${event.venue.city}` : 'Online'
  const when = formatEventDate(event.startsAt, event.timezone)

  return {
    title: event.title,
    description: event.summary,
    alternates: { canonical: `/events/${event.slug}` },
    openGraph: {
      type: 'article',
      title: `${event.title} — ${when}, ${where}`,
      description: event.summary,
      url: `/events/${event.slug}`,
    },
    twitter: { card: 'summary_large_image', title: event.title, description: event.summary },
  }
}

/**
 * @typedef {object} EventDetailPageProps
 * @property {Promise<{slug: string}>} params The resolved route parameters.
 */

/**
 * The event detail page.
 *
 * @param {EventDetailPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function EventDetailPage({ params }) {
  const { slug } = await params
  const { event, usedFallback } = await loadEventBySlug(slug)

  if (!event) notFound()

  const ticketTypes = event.ticketTypes ?? []
  const cheapest = cheapestAvailable(ticketTypes)
  const address = formatVenueAddress(event.venue)
  const zoneLabel = formatTimeZoneLabel(event)
  const paragraphs = toParagraphs(event.description)

  return (
    <article className="mx-auto max-w-6xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/"
              className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500"
            >
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href="/events"
              className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500"
            >
              Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-slate-500">
            {event.title}
          </li>
        </ol>
      </nav>

      <FadeIn className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand" size="lg">
            {categoryLabel(event.category)}
          </Badge>
          {event.venue?.city ? <Badge variant="info">{event.venue.city}</Badge> : null}
          {ticketTypes.length > 0 && !cheapest ? (
            <Badge variant="danger" srLabel="Availability:">
              Sold out
            </Badge>
          ) : null}
        </div>

        <h1 className="mt-4 text-3xl leading-tight font-bold text-indigo-night-900 sm:text-4xl">
          {event.title}
        </h1>
        <p className="mt-3 max-w-3xl text-lg text-slate-700">{event.summary}</p>
      </FadeIn>

      <SampleDataNotice show={usedFallback} />

      <FadeIn delay={0.08} className="mt-8 overflow-hidden rounded-card">
        <EventPoster event={event} variant="hero" />
      </FadeIn>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1.7fr_1fr] lg:items-start">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-2xl font-bold text-indigo-night-900">
              About this event
            </h2>
            <div className="mt-4 space-y-4 text-slate-700">
              {paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 48)}>{paragraph}</p>
              ))}
            </div>

            {event.languages?.length > 0 ? (
              <p className="mt-5 text-sm text-slate-600">
                <span className="font-medium text-slate-800">Languages: </span>
                {event.languages.join(', ')}
              </p>
            ) : null}
          </section>

          <RevealOnScroll as="section" aria-labelledby="schedule-heading">
            <h2 id="schedule-heading" className="text-2xl font-bold text-indigo-night-900">
              Schedule
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-card border border-slate-200 bg-white p-4">
                <dt className="text-sm font-medium text-slate-500">Doors / start</dt>
                <dd className="mt-1 text-slate-900">
                  <time dateTime={toDateTimeAttribute(event.startsAt)}>
                    {formatEventDate(event.startsAt, event.timezone)} ·{' '}
                    {formatEventTime(event.startsAt, event.timezone)}
                  </time>
                </dd>
              </div>
              <div className="rounded-card border border-slate-200 bg-white p-4">
                <dt className="text-sm font-medium text-slate-500">Ends</dt>
                <dd className="mt-1 text-slate-900">
                  <time dateTime={toDateTimeAttribute(event.endsAt)}>
                    {formatEventDate(event.endsAt, event.timezone)} ·{' '}
                    {formatEventTime(event.endsAt, event.timezone)}
                  </time>
                </dd>
              </div>
              <div className="rounded-card border border-slate-200 bg-white p-4 sm:col-span-2">
                <dt className="text-sm font-medium text-slate-500">Local time</dt>
                <dd className="mt-1 text-slate-900">
                  All times are {zoneLabel ? `${zoneLabel} — ` : ''}the local time at the venue (
                  {event.timezone}), not your own.
                </dd>
              </div>
            </dl>
          </RevealOnScroll>

          <RevealOnScroll as="section" aria-labelledby="venue-heading">
            <h2 id="venue-heading" className="text-2xl font-bold text-indigo-night-900">
              Venue
            </h2>
            {event.venue ? (
              <Card className="mt-4">
                <CardBody>
                  <p className="font-display text-lg font-semibold text-indigo-night-900">
                    {event.venue.name}
                  </p>
                  <address className="mt-2 text-slate-700 not-italic">
                    {address.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </address>
                  {event.venue.capacity ? (
                    <p className="mt-3 text-sm text-slate-500">
                      Capacity {event.venue.capacity.toLocaleString('en-IN')}
                    </p>
                  ) : null}
                </CardBody>
              </Card>
            ) : (
              <p className="mt-4 text-slate-700">The venue for this event has not been announced.</p>
            )}
          </RevealOnScroll>

          {event.organization ? (
            <RevealOnScroll as="section" aria-labelledby="organiser-heading">
              <h2 id="organiser-heading" className="text-2xl font-bold text-indigo-night-900">
                Presented by
              </h2>
              <Card className="mt-4">
                <CardBody>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-semibold text-indigo-night-900">
                      {event.organization.name}
                    </span>
                    {event.organization.verified ? (
                      <Badge variant="success" srLabel="Organiser status:">
                        Verified organiser
                      </Badge>
                    ) : null}
                  </p>
                  {event.organization.description ? (
                    <p className="mt-2 text-slate-700">{event.organization.description}</p>
                  ) : null}
                </CardBody>
              </Card>
            </RevealOnScroll>
          ) : null}
        </div>

        <aside aria-labelledby="tickets-heading" className="lg:sticky lg:top-24">
          <h2 id="tickets-heading" className="text-2xl font-bold text-indigo-night-900">
            Tickets
          </h2>
          <p className="mt-2 text-sm text-slate-600">{formatEventWhen(event)}</p>

          {ticketTypes.length === 0 ? (
            <p className="mt-4 text-slate-700">
              Tickets for this event are not on sale yet. Check back shortly.
            </p>
          ) : (
            <>
              <div className="mt-4">
                <TicketTiers ticketTypes={ticketTypes} />
              </div>

              {cheapest ? (
                <div className="mt-5 rounded-card border border-marigold-200 bg-marigold-50 p-4">
                  <p className="text-sm text-slate-700">
                    From{' '}
                    <span className="font-display text-xl font-semibold text-indigo-night-900">
                      {formatPrice(cheapest.priceCents, cheapest.currency)}
                    </span>
                  </p>
                  <Link
                    href={`/events/${event.slug}/checkout`}
                    className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-lg bg-marigold-600 px-6 text-base font-medium text-white shadow-sm transition-colors hover:bg-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2"
                  >
                    Choose tickets
                  </Link>
                </div>
              ) : (
                <p className="mt-5 rounded-card border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                  Every tier has sold out. Tickets sometimes return when holds expire, so it is
                  worth looking again closer to the day.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </article>
  )
}
