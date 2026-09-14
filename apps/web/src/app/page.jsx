/**
 * The home page: a hero, the soonest events, and a way into every category.
 *
 * Rendered per request because ticket availability changes by the minute and a
 * cached "on sale" badge on a sold-out night is worse than a slower page.
 *
 * @module app/page
 */

import Link from 'next/link'
import { Badge } from '../components/ui.jsx'

import { loadCatalogueOverview } from '../lib/api.js'
import { categoriesWithEvents, citiesWithEvents } from '../lib/catalog.js'
import { buildEventsHref } from '../lib/search-params.js'
import { CategoryGrid } from '../components/category-grid.jsx'
import { EventGrid } from '../components/listing-card.jsx'
import { FadeIn, RevealOnScroll } from '../components/motion.jsx'
import { SampleDataNotice } from '../components/sample-data-notice.jsx'

export const dynamic = 'force-dynamic'

/** How many events the "on soon" rail shows. */
const FEATURED_COUNT = 6

/**
 * The Desi-Event home page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function HomePage() {
  const { events, usedFallback } = await loadCatalogueOverview()

  const featured = events.slice(0, FEATURED_COUNT)
  const categories = categoriesWithEvents(events)
  const cities = citiesWithEvents(events)

  return (
    <div className="mx-auto max-w-6xl px-4 pb-4">
      <section aria-labelledby="hero-heading" className="py-12 sm:py-16">
        <FadeIn as="div" className="max-w-3xl">
          <Badge variant="brand" size="lg">
            Navratri, Diwali and everything after
          </Badge>
          <h1
            id="hero-heading"
            className="mt-5 text-4xl leading-tight font-bold text-indigo-night-900 sm:text-5xl"
          >
            Nine nights of garba. One qawwali that runs past midnight.{' '}
            <span className="text-marigold-700">Tickets that actually work.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-700">
            Desi-Event is where the diaspora finds its nights out — raas circles in Ahmedabad,
            mehfils in Bombay, melas in Mississauga and stand-up in Limehouse. Real inventory, real
            holds at checkout, prices in your own currency.
          </p>
        </FadeIn>

        <FadeIn delay={0.12} className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/events"
            className="inline-flex h-12 items-center justify-center rounded-lg bg-marigold-600 px-6 text-base font-medium text-white shadow-sm transition-colors hover:bg-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2"
          >
            Browse every event
          </Link>
          <Link
            href={buildEventsHref({ category: 'GARBA_DANDIYA' })}
            className="inline-flex h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-6 text-base font-medium text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2"
          >
            Garba &amp; dandiya nights
          </Link>
        </FadeIn>

        <SampleDataNotice show={usedFallback} />
      </section>

      <section aria-labelledby="featured-heading" className="py-8">
        <RevealOnScroll className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="featured-heading" className="text-2xl font-bold text-indigo-night-900">
              On soon
            </h2>
            <p className="mt-1 text-slate-600">The next few nights worth clearing your calendar for.</p>
          </div>
          <Link
            href="/events"
            className="rounded-sm text-sm font-medium text-marigold-700 underline underline-offset-4 hover:text-marigold-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2"
          >
            See all {events.length} events
          </Link>
        </RevealOnScroll>

        <div className="mt-6">
          <EventGrid events={featured} label="Events happening soon" />
        </div>
      </section>

      <section aria-labelledby="categories-heading" className="py-8">
        <RevealOnScroll>
          <h2 id="categories-heading" className="text-2xl font-bold text-indigo-night-900">
            Browse by what you are in the mood for
          </h2>
          <p className="mt-1 text-slate-600">
            Fourteen categories, from a two-hour Bharatanatyam margam to a food festival that takes
            a whole weekend.
          </p>
        </RevealOnScroll>

        <div className="mt-6">
          <CategoryGrid categories={categories} />
        </div>
      </section>

      <section aria-labelledby="cities-heading" className="py-8">
        <RevealOnScroll>
          <h2 id="cities-heading" className="text-2xl font-bold text-indigo-night-900">
            Where we are programming
          </h2>
          <p className="mt-1 text-slate-600">
            Four cities today. Tell us where you are and we will work on the fifth.
          </p>
        </RevealOnScroll>

        <ul aria-label="Browse by city" className="mt-5 flex flex-wrap gap-3">
          {cities.map((city, index) => (
            <RevealOnScroll as="li" key={city} index={index}>
              <Link
                href={buildEventsHref({ city })}
                className="inline-flex items-center rounded-full border border-indigo-night-100 bg-white px-4 py-2 text-sm font-medium text-indigo-night-900 transition-colors hover:border-marigold-300 hover:bg-marigold-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2"
              >
                {city}
              </Link>
            </RevealOnScroll>
          ))}
        </ul>
      </section>
    </div>
  )
}
