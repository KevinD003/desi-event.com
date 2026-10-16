/**
 * A header and a footer for the pages that cannot draw the real ones.
 *
 * The error page replaces everything beneath the root layout, the area's own
 * shell included, and it runs in the browser, where the site header (which
 * asks the API who is signed in) cannot. Rather than leave the reader on a
 * page with no way back and no landmarks, it draws these: the logo leading
 * home and the way into the catalogue above, the small print and the ways to
 * reach the team below. No hooks and no session, so they render anywhere.
 *
 * Exactly one `banner` and one `contentinfo`, like every other page.
 *
 * @module components/bare-chrome
 */

import Link from 'next/link'
import { Icon } from '@desi-event/ui/icons'

import { SIMULATED_PAYMENTS } from '../lib/brand.js'
import { BrandLogo } from './brand-logo.jsx'
import { BrandRule } from './festive-decor.jsx'

/** A link in the bare header or footer: 44px tall, the outline focus. */
const LINK =
  'inline-flex min-h-11 items-center rounded-control px-2 text-label font-semibold transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/**
 * The bare header: the logo home and the way into the catalogue.
 *
 * @returns {JSX.Element} The header, the page's banner.
 */
export function BareHeader() {
  return (
    <header className="bg-surface [view-transition-name:site-header]">
      <div className="mx-auto flex min-h-16 max-w-bleed items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <Link href="/" className="flex min-h-11 shrink-0 items-center rounded-control">
          <BrandLogo variant="light" className="h-8 w-auto sm:h-10" />
        </Link>
        <Link href="/events" className={`${LINK} text-ink hover:text-accent-strong`}>
          Discover events
        </Link>
      </div>
      <BrandRule />
    </header>
  )
}

/**
 * The bare footer: the small print and the ways to reach the team.
 *
 * @returns {JSX.Element} The footer, the page's `contentinfo`.
 */
export function BareFooter() {
  return (
    <footer className="mt-20 bg-surface-inverse text-ink-inverse-muted [view-transition-name:site-footer]">
      <div className="mx-auto flex max-w-bleed flex-col gap-4 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-10">
        <p className="flex items-center gap-2.5 text-label font-bold text-ink-inverse">
          <Icon name="shield" className="h-5 w-5 text-accent-inverse" />
          {SIMULATED_PAYMENTS}
        </p>
        <ul className="flex flex-wrap gap-x-4">
          <li>
            <Link
              href="/limitations"
              className={`${LINK} text-ink-inverse-muted hover:text-ink-inverse`}
            >
              What this site does not do
            </Link>
          </li>
          <li>
            <Link
              href="/contact"
              className={`${LINK} text-ink-inverse-muted hover:text-ink-inverse`}
            >
              Contact
            </Link>
          </li>
        </ul>
      </div>
    </footer>
  )
}
