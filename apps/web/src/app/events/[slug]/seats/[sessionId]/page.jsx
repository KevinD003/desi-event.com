/**
 * Choose seats for one night of an event, and buy them.
 *
 * A Server Component that reads the event and the night's seat map as a
 * stranger would (the public client sends no cookies), asks who is signed in,
 * and hands both to the seat checkout, the only part with state. The map is
 * never invented: a night the API does not answer for, one of another event,
 * or an event only the fallback catalogue knows, renders the not-found view
 * rather than a picture of seats that do not exist.
 *
 * Kept out of the index, like checkout: a step in a flow, not a destination.
 *
 * @module app/events/slug/seats/sessionId/page
 */

import { loadEventBySlug, loadSeatMap } from '../../../../../lib/api.js'
import { formatEventLocation, formatTimeZoneLabel } from '../../../../../lib/format.js'
import { signInHref } from '../../../../../lib/next-path.js'
import { readSession } from '../../../../../lib/session.js'
import { formatNightTime, sessionDisplayLabel } from '../../../../../lib/sessions.js'
import { ScallopHem, Toran } from '../../../../../components/festive-decor.jsx'
import { CalendarIcon, ClockIcon, PinIcon } from '../../../../../components/icons.jsx'
import { FadeIn } from '../../../../../components/motion.jsx'
import { NotFoundView } from '../../../../../components/not-found-view.jsx'
import { Breadcrumbs } from '../../../../../components/page-state.jsx'
import { PaymentModeNotice } from '../../../../../components/payment-mode-notice.jsx'
import { SeatCheckout } from '../../../../../components/seat-checkout.jsx'

export const dynamic = 'force-dynamic'

/**
 * Metadata for the seat step.
 *
 * @param {object} props Route props.
 * @param {Promise<{slug: string}>} props.params The resolved route parameters.
 * @returns {Promise<object>} A Next.js metadata object.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params
  const { event } = await loadEventBySlug(slug)

  return {
    title: event ? `Choose seats for ${event.title}` : 'Choose seats',
    robots: { index: false, follow: false },
  }
}

/**
 * @typedef {object} SeatPageProps
 * @property {Promise<{slug: string, sessionId: string}>} params The resolved route parameters.
 */

/**
 * The seat page for one night.
 *
 * @param {SeatPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function SeatPage({ params }) {
  const { slug, sessionId } = await params
  const { event, usedFallback } = await loadEventBySlug(slug)

  // Same reason as the event page: `notFound()` cannot be server-rendered by
  // this version of Next.js. See components/not-found-view.jsx.
  if (!event || usedFallback) return <NotFoundView />

  const map = await loadSeatMap(sessionId)

  if (!map || map.eventId !== event.id) return <NotFoundView />

  const session = await readSession()
  const buyer = session?.user ? { name: session.user.displayName, email: session.user.email } : null
  const night = {
    label: map.label,
    startsAt: map.startsAt,
    endsAt: map.endsAt,
    doorsOpenAt: map.doorsOpenAt,
    timezone: map.timezone,
  }
  const zone = formatTimeZoneLabel({ startsAt: map.startsAt, timezone: map.timezone })
  const locality = event.venue
    ? [event.venue.name, [event.venue.city, event.venue.region].filter(Boolean).join(', ')]
        .filter(Boolean)
        .join(' · ')
    : formatEventLocation(event)

  return (
    <div>
      <section
        aria-labelledby="seats-heading"
        className="relative isolate overflow-hidden bg-surface-inverse text-ink-inverse"
      >
        <Toran />
        <div className="relative mx-auto max-w-content px-4 pt-16 pb-14 sm:px-6 md:pt-20">
          <Breadcrumbs
            tone="inverse"
            trail={[
              { href: '/events', label: 'Events' },
              { href: `/events/${event.slug}`, label: event.title },
              { href: null, label: 'Seats' },
            ]}
          />
          <FadeIn>
            <h1 id="seats-heading" className="mt-2 text-h1 font-semibold text-ink-inverse">
              Choose seats for <span className="text-accent-inverse">{event.title}</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.08}>
            <ul className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2 text-[0.9375rem] text-ink-inverse-muted">
              <li className="flex items-center gap-2">
                <CalendarIcon className="h-4.5 w-4.5 text-accent-inverse" />
                <span>
                  {sessionDisplayLabel(night)}
                  {zone ? ` ${zone}` : ''}
                </span>
              </li>
              {map.doorsOpenAt ? (
                <li className="flex items-center gap-2">
                  <ClockIcon className="h-4.5 w-4.5 text-accent-inverse" />
                  <span>Doors {formatNightTime(map.doorsOpenAt, map.timezone)}</span>
                </li>
              ) : null}
              <li className="flex items-center gap-2">
                <ClockIcon className="h-4.5 w-4.5 text-accent-inverse" />
                <span>Ends {formatNightTime(map.endsAt, map.timezone)}</span>
              </li>
              <li className="flex items-center gap-2">
                <PinIcon className="h-4.5 w-4.5 text-accent-inverse" />
                <span>{locality}</span>
              </li>
            </ul>
            <p className="mt-3 text-sm text-ink-inverse-muted">
              All times are the local time at the venue ({map.timezone}).
            </p>
          </FadeIn>
        </div>
        <ScallopHem />
      </section>

      <div className="mx-auto max-w-content px-4 pt-10 sm:px-6">
        <PaymentModeNotice />

        <div className="mt-8">
          <SeatCheckout
            event={event}
            initialMap={map}
            buyer={buyer}
            signInHref={signInHref(`/events/${event.slug}/seats/${sessionId}`)}
          />
        </div>
      </div>
    </div>
  )
}
