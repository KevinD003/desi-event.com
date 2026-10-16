/**
 * Checkout: choose quantities, see what it comes to, reserve, and book.
 *
 * The page itself is a Server Component that loads the event and its live
 * availability, and asks who is signed in; only the basket is a Client
 * Component, because only the basket has state. The buyer's name and address
 * are passed to it because the order needs them — they are the signed-in
 * person's own, on their own page — and nothing else about the session is.
 *
 * A member of the organiser's team who may book hidden tiers is offered them
 * here too: the tiers are read again as that member (`lib/team-booking.js`),
 * so a guest list or a team allocation is booked through this same checkout.
 *
 * @module app/events/slug/checkout/page
 */

import Link from 'next/link'
import { EmptyState } from '../../../../components/ui.jsx'

import { loadEventBySlug } from '../../../../lib/api.js'
import {
  formatEventLocation,
  formatEventWhen,
  formatTimeZoneLabel,
} from '../../../../lib/format.js'
import { CheckoutBasket } from '../../../../components/checkout-basket.jsx'
import { CalendarIcon, PinIcon, TicketIcon } from '../../../../components/icons.jsx'
import { PRIMARY_LINK_SMALL } from '../../../../components/link-classes.js'
import { FadeIn } from '../../../../components/motion.jsx'
import { Breadcrumbs } from '../../../../components/page-state.jsx'
import { PaymentModeNotice } from '../../../../components/payment-mode-notice.jsx'
import { EventArt } from '../../../../components/event-art.jsx'
import { NotFoundView } from '../../../../components/not-found-view.jsx'
import { SampleDataNotice } from '../../../../components/sample-data-notice.jsx'
import { signInHref } from '../../../../lib/next-path.js'
import { readSession } from '../../../../lib/session.js'
import {
  hasHiddenTier,
  loadTeamTicketTypes,
  mayBookTeamTiers,
} from '../../../../lib/team-booking.js'

export const dynamic = 'force-dynamic'

/**
 * Metadata for the checkout step.
 *
 * Checkout pages are deliberately kept out of the index: they are a step in a
 * flow, not a destination, and a search result landing here skips the event.
 *
 * @param {object} props Route props.
 * @param {Promise<{slug: string}>} props.params The resolved route parameters.
 * @returns {Promise<object>} A Next.js metadata object.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params
  const { event } = await loadEventBySlug(slug)

  return {
    title: event ? `Tickets for ${event.title}` : 'Checkout',
    robots: { index: false, follow: false },
  }
}

/**
 * @typedef {object} CheckoutPageProps
 * @property {Promise<{slug: string}>} params The resolved route parameters.
 */

/**
 * The checkout page for one event.
 *
 * @param {CheckoutPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function CheckoutPage({ params }) {
  const { slug } = await params
  const { event, usedFallback } = await loadEventBySlug(slug)

  // Same reason as the event page: `notFound()` cannot be server-rendered by
  // this version of Next.js. See components/not-found-view.jsx.
  if (!event) return <NotFoundView />

  const session = usedFallback ? null : await readSession()
  const buyer = session?.user ? { name: session.user.displayName, email: session.user.email } : null
  // The team's view when this member may book hidden tiers; the public one
  // otherwise, and also when that read fails, so a checkout never breaks.
  const teamTiers = mayBookTeamTiers(session, event) ? await loadTeamTicketTypes(event.slug) : null
  const ticketTypes = teamTiers ?? event.ticketTypes ?? []
  const bookingForTeam = Boolean(teamTiers) && hasHiddenTier(teamTiers)

  const zone = formatTimeZoneLabel(event)
  const locality = event.venue
    ? [event.venue.name, [event.venue.city, event.venue.region].filter(Boolean).join(', ')]
        .filter(Boolean)
        .join(' · ')
    : formatEventLocation(event)

  return (
    <div>
      <section
        aria-labelledby="checkout-heading"
        className="relative isolate overflow-hidden bg-surface-inverse text-ink-inverse"
      >
        <div className="relative mx-auto flex max-w-content flex-col gap-6 px-4 pt-16 pb-14 sm:px-6 md:flex-row md:items-center md:gap-8 md:pt-20">
          <FadeIn
            distance={0}
            className="hidden h-36 w-54 shrink-0 overflow-hidden rounded-2xl ring-1 ring-ink-inverse/15 shadow-dialog md:block"
          >
            <EventArt event={event} className="h-full" decorative sizes="216px" />
          </FadeIn>
          <div className="min-w-0">
            <Breadcrumbs
              tone="inverse"
              trail={[
                { href: '/events', label: 'Events' },
                { href: `/events/${event.slug}`, label: event.title },
                { href: null, label: 'Tickets' },
              ]}
            />
            <FadeIn>
              <h1 id="checkout-heading" className="mt-2 text-h1 font-semibold text-ink-inverse">
                Tickets for <span className="text-accent-inverse">{event.title}</span>
              </h1>
            </FadeIn>
            <FadeIn delay={0.08}>
              <ul className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2 text-[0.9375rem] text-ink-inverse-muted">
                <li className="flex items-center gap-2">
                  <CalendarIcon className="h-4.5 w-4.5 text-accent-inverse" />
                  <span>
                    {formatEventWhen(event)}
                    {zone ? ` ${zone}` : ''}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <PinIcon className="h-4.5 w-4.5 text-accent-inverse" />
                  <span>{locality}</span>
                </li>
              </ul>
            </FadeIn>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-content px-4 pt-10 sm:px-6">
        <PaymentModeNotice />

        <SampleDataNotice show={usedFallback} />

        {bookingForTeam ? (
          <aside
            aria-labelledby="team-booking-heading"
            data-testid="team-booking-notice"
            className="mt-6 rounded-card border border-status-info/25 bg-status-info-soft px-5 py-4 text-ink sm:px-6 sm:py-5"
          >
            <h2 id="team-booking-heading" className="text-[1.0625rem] font-bold text-ink">
              Booking for your team
            </h2>
            <p className="mt-1 text-[0.9375rem] text-ink">
              You are on this event&rsquo;s team, so its hidden tiers are listed here too, marked
              Team only. Nobody outside the team sees them. The tickets you book are kept in your
              account: hand each one on to a guest with a transfer code from{' '}
              <Link
                href="/tickets"
                className="underline underline-offset-4 hover:text-accent-strong"
              >
                your tickets
              </Link>
              .
            </p>
          </aside>
        ) : null}

        <div className="mt-8">
          {ticketTypes.length === 0 ? (
            <EmptyState
              icon={<TicketIcon className="h-8 w-8" />}
              title="No tickets are on sale for this event"
              description="This event has no ticket tiers open, so there is nothing to choose here. The event page shows the tiers once there are some."
              className="bg-surface-raised"
              action={
                <Link href={`/events/${event.slug}`} className={PRIMARY_LINK_SMALL}>
                  Back to the event
                </Link>
              }
            />
          ) : (
            <CheckoutBasket
              event={event}
              ticketTypes={ticketTypes}
              buyer={buyer}
              signInHref={signInHref(`/events/${event.slug}/checkout`)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
