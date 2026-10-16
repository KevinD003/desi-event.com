/**
 * The page for an address that cannot be read.
 *
 * An address whose percent-escapes do not decode — a link cut off in the
 * middle of a character, `/events/%E0%A4%A` — matches a route but cannot be
 * routed. The proxy (`src/proxy.js`) answers it with this page and a `400`,
 * instead of Next.js's own bare "400 | Bad Request" document, so the visitor
 * stays on the site with a way on. Nothing from the address is read or shown.
 *
 * Reachable by its own address too, where it answers `200`; it is never
 * indexed and nothing links to it.
 *
 * @module app/bad-address/page
 */

import Link from 'next/link'
import { Icon } from '@desi-event/ui/icons'

import { OUTLINE_LINK, PRIMARY_LINK } from '../../components/link-classes.js'

export const metadata = {
  title: 'That address could not be read',
  robots: { index: false, follow: false },
}

/**
 * The bad-address page.
 *
 * @returns {JSX.Element} The page.
 */
export default function BadAddressPage() {
  return (
    <div className="mx-auto w-full max-w-bleed px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
      <h1 className="max-w-[16ch] text-display text-ink">That address could not be read</h1>
      <p className="mt-6 max-w-[56ch] text-body text-ink-muted">
        Part of the link looks cut off, so there is no page to open. If you copied it from a
        message, try copying it again in full. Otherwise every event is still listed.
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link href="/events" className={PRIMARY_LINK}>
          Browse every event
          <Icon name="arrow-right" className="h-4.5 w-4.5" />
        </Link>
        <Link href="/" className={`${OUTLINE_LINK} min-h-12 text-base`}>
          Back to the home page
        </Link>
      </div>
    </div>
  )
}
