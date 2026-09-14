/**
 * The site header: brand, primary navigation and a direct route into search.
 *
 * @module components/site-header
 */

import Link from 'next/link'

import { buildEventsHref } from '../lib/search-params.js'

/** Primary navigation. Kept to four items so it fits a 360px viewport. */
const NAV_LINKS = [
  { href: '/events', label: 'All events' },
  { href: buildEventsHref({ category: 'GARBA_DANDIYA' }), label: 'Garba' },
  { href: buildEventsHref({ category: 'MUSIC_CONCERT' }), label: 'Live music' },
  { href: buildEventsHref({ category: 'COMEDY' }), label: 'Comedy' },
]

/**
 * The global site header.
 *
 * @returns {JSX.Element} The rendered header.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-marigold-200/70 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link
          href="/"
          className="flex items-baseline gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2"
        >
          <span className="font-display text-xl font-bold tracking-tight text-indigo-night-900">
            Desi<span className="text-marigold-600">-</span>Event
          </span>
          <span aria-hidden="true" className="hidden text-sm text-marigold-700 sm:inline">
            देसी इवेंट
          </span>
        </Link>

        <nav aria-label="Primary">
          <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex rounded-lg px-2.5 py-1.5 font-medium text-slate-700 transition-colors hover:bg-marigold-50 hover:text-marigold-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}
