/**
 * Checkout: choose quantities, see what it comes to, reserve, and book.
 *
 * The page itself is a Server Component that loads the event and its live
 * availability, and asks who is signed in; only the basket is a Client
 * Component, because only the basket has state. The buyer's name and address
 * are passed to it because the order needs them — they are the signed-in
 * person's own, on their own page — and nothing else about the session is.
 *
 * @module app/events/slug/checkout/page
 */

import Link from 'next/link'
import { EmptyState } from '../../../../components/ui.jsx'

import { loadEventBySlug } from '../../../../lib/api.js'
import { formatEventWhen, formatEventLocation } from '../../../../lib/format.js'
import { CheckoutBasket } from '../../../../components/checkout-basket.jsx'
import { PaymentModeNotice } from '../../../../components/payment-mode-notice.jsx'
import { NotFoundView } from '../../../../components/not-found-view.jsx'
import { SampleDataNotice } from '../../../../components/sample-data-notice.jsx'
import { signInHref } from '../../../../lib/next-path.js'
import { readSession } from '../../../../lib/session.js'

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

  const ticketTypes = event.ticketTypes ?? []
  const session = usedFallback ? null : await readSession()
  const buyer = session?.user ? { name: session.user.displayName, email: session.user.email } : null

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/events"
              className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={`/events/${event.slug}`}
              className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {event.title}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink-muted">
            Tickets
          </li>
        </ol>
      </nav>

      <h1 className="mt-6 text-3xl font-bold text-ink sm:text-4xl">Tickets for {event.title}</h1>
      <p className="mt-2 text-ink-muted">
        {formatEventWhen(event)} · {formatEventLocation(event)}
      </p>

      <PaymentModeNotice />

      <SampleDataNotice show={usedFallback} />

      <div className="mt-8">
        {ticketTypes.length === 0 ? (
          <EmptyState
            icon="◎"
            title="Tickets are not on sale yet"
            description="This event has no ticket tiers open. Keep an eye on the event page — they usually go live a few weeks ahead."
            action={
              <Link
                href={`/events/${event.slug}`}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-action-primary px-4 text-sm font-medium text-action-primary-ink transition-colors hover:bg-action-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
              >
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
  )
}
