/**
 * The organiser area.
 *
 * Everything under `/organizer` requires a session, and the check happens here
 * rather than in each page: a page that forgets is a page that leaks, and there
 * is no way to forget a layout.
 *
 * The check is a real one. `readSession` asks the API who the caller is, so a
 * forged cookie gets the same answer as no cookie. What this layout decides is
 * only whether to render; every action inside is authorised again by the API.
 *
 * @module app/organizer/layout
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  robots: { index: false, follow: false },
}

/**
 * @typedef {object} OrganizerLayoutProps
 * @property {object} children The page.
 */

/**
 * The organiser shell.
 *
 * @param {OrganizerLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function OrganizerLayout({ children }) {
  const session = await readSession()

  if (!session) redirect('/sign-in?next=/organizer/venues')

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 pb-4">
        <nav aria-label="Organiser">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            <li>
              <Link
                href="/organizer/venues"
                className="rounded-sm font-medium text-indigo-night-900 underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                Venues
              </Link>
            </li>
          </ul>
        </nav>
        <p className="text-sm text-slate-600">
          Signed in as <span className="font-medium">{session.user?.displayName}</span>
        </p>
      </div>

      <div className="mt-8">{children}</div>
    </div>
  )
}
