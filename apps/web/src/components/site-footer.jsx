/**
 * The site footer: secondary navigation and the small print.
 *
 * @module components/site-footer
 */

import Link from 'next/link'

import { EVENT_CATEGORIES } from '../lib/catalog.js'
import { buildEventsHref } from '../lib/search-params.js'

/** Cities the platform has a meaningful programme in. */
const CITIES = ['Mumbai', 'Ahmedabad', 'Toronto', 'London']

/** The first six categories, which is as many as the footer has room for. */
const FOOTER_CATEGORIES = EVENT_CATEGORIES.slice(0, 6)

/**
 * The global site footer.
 *
 * @returns {JSX.Element} The rendered footer.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface-inverse text-ink-inverse-muted">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="font-display text-lg font-bold text-ink-inverse">
            Desi<span className="text-accent-inverse">-</span>Event
          </p>
          <p className="mt-3 max-w-prose text-sm text-ink-inverse-muted">
            Garba nights, qawwali mehfils, melas and stand-up — ticketed properly, for the South
            Asian diaspora and everyone who turns up with them.
          </p>
        </div>

        <nav aria-labelledby="footer-categories">
          <h2 id="footer-categories" className="text-sm font-semibold text-ink-inverse">
            Browse
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {FOOTER_CATEGORIES.map((category) => (
              <li key={category.value}>
                <Link
                  href={buildEventsHref({ category: category.value })}
                  className="rounded-sm text-ink-inverse-muted transition-colors hover:text-accent-inverse focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-inverse"
                >
                  {category.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-cities">
          <h2 id="footer-cities" className="text-sm font-semibold text-ink-inverse">
            Cities
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {CITIES.map((city) => (
              <li key={city}>
                <Link
                  href={buildEventsHref({ city })}
                  className="rounded-sm text-ink-inverse-muted transition-colors hover:text-accent-inverse focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-inverse"
                >
                  {city}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="text-sm font-semibold text-ink-inverse">Organisers</h2>
          <p className="mt-3 text-sm text-ink-inverse-muted">
            Running a night of your own? Desi-Event handles listings, ticketing, holds and door
            check-in. Payments and payouts in this build are simulated: nothing is charged and
            nothing is paid out.
          </p>
          <p className="mt-3 text-sm text-ink-inverse-muted">
            Organiser accounts are set up by the platform in this build; there is no sign-up for an
            organisation.
          </p>
          <p className="mt-3 text-sm">
            <Link
              href="/limitations"
              className="rounded-sm text-accent-inverse underline underline-offset-4 hover:text-ink-inverse focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-inverse"
            >
              What this site does not do
            </Link>
          </p>
        </div>
      </div>

      <div className="border-t border-ink-inverse/10">
        {/* ink-inverse-muted is 12:1 on the inverse band; slate-500, which
            this once was, is 3.74:1 and below AA at this size. */}
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-ink-inverse-muted">
          A demonstration project. Every event, organiser and price on this site is fictional.
        </p>
      </div>
    </footer>
  )
}
