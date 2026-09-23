/**
 * The attendee's ticket area.
 *
 * Signed in, and that is the whole test: a ticket belongs to the person holding
 * it, not to a role. Which ticket they may see is decided by the API, which
 * knows who owns each one; a layout that tried to answer that would be a layout
 * guessing at rows it has not read.
 *
 * `noindex`, because a page listing somebody's tickets is not a page for a
 * search engine.
 *
 * @module app/tickets/layout
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} TicketsLayoutProps
 * @property {object} children The page.
 */

/**
 * The tickets shell.
 *
 * @param {TicketsLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function TicketsLayout({ children }) {
  const session = await readSession()

  if (!session) redirect('/sign-in?next=/tickets')

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
        <nav aria-label="Tickets">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            <li>
              <Link
                href="/tickets"
                className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                My tickets
              </Link>
            </li>
            <li>
              <Link
                href="/tickets/accept"
                className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Accept an invitation
              </Link>
            </li>
            <li>
              <Link
                href="/events"
                className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                What’s on
              </Link>
            </li>
          </ul>
        </nav>
        <p className="text-sm text-ink-muted">
          Signed in as <span className="font-medium">{session.user?.displayName}</span>
        </p>
      </div>

      <div className="mt-8">{children}</div>
    </div>
  )
}
