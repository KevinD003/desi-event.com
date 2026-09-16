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
    <footer className="mt-16 border-t border-slate-200 bg-indigo-night-950 text-slate-300">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="font-display text-lg font-bold text-white">
            Desi<span className="text-marigold-400">-</span>Event
          </p>
          <p className="mt-3 max-w-prose text-sm text-slate-400">
            Garba nights, qawwali mehfils, melas and stand-up — ticketed properly, for the South
            Asian diaspora and everyone who turns up with them.
          </p>
        </div>

        <nav aria-labelledby="footer-categories">
          <h2 id="footer-categories" className="text-sm font-semibold text-white">
            Browse
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {FOOTER_CATEGORIES.map((category) => (
              <li key={category.value}>
                <Link
                  href={buildEventsHref({ category: category.value })}
                  className="rounded-sm text-slate-400 transition-colors hover:text-marigold-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-night-950"
                >
                  {category.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-cities">
          <h2 id="footer-cities" className="text-sm font-semibold text-white">
            Cities
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {CITIES.map((city) => (
              <li key={city}>
                <Link
                  href={buildEventsHref({ city })}
                  className="rounded-sm text-slate-400 transition-colors hover:text-marigold-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-night-950"
                >
                  {city}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="text-sm font-semibold text-white">Organisers</h2>
          <p className="mt-3 text-sm text-slate-400">
            Running a night of your own? Desi-Event handles ticketing, holds, door scanning and
            payouts in your own currency.
          </p>
          <p className="mt-3 text-sm text-slate-400">
            <a
              href="mailto:organisers@desi-event.example"
              className="rounded-sm text-marigold-300 underline underline-offset-4 hover:text-marigold-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-night-950"
            >
              organisers@desi-event.example
            </a>
          </p>
        </div>
      </div>

      <div className="border-t border-white/10">
        {/* slate-400, not 500: on the indigo-night footer, 500 is 3.74:1 and
            AA asks for 4.5:1 at this size. 400 is 6.78:1. */}
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-slate-400">
          A demonstration project. Every event, organiser and price on this site is fictional.
        </p>
      </div>
    </footer>
  )
}
