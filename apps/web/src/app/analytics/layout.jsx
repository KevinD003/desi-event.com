/**
 * The analytics area.
 *
 * Signed in and holding `report:view` **in some organisation**. The unscoped
 * question — `sessionCan(session, 'report:view')` with no organisation — asks
 * the *platform* capability list, and `report:view` is an organisation
 * capability, so that question refuses every organiser and passes every
 * platform admin. That inversion is NF-05, and it is why the check below walks
 * the memberships rather than asking once.
 *
 * The layout decides only whether to render a shell. Every figure inside is
 * authorised again by the API, which additionally demands a recent second
 * factor under `FINANCE_VIEW` — so a session signed in an hour ago renders this
 * and gets nothing in it.
 *
 * `noindex`, which should not need saying about a page of somebody's sales.
 *
 * @module app/analytics/layout
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Forbidden } from '../../components/page-state.jsx'
import { readSession, sessionCan } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} AnalyticsLayoutProps
 * @property {object} children The page.
 */

/**
 * The analytics shell.
 *
 * @param {AnalyticsLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function AnalyticsLayout({ children }) {
  const session = await readSession()

  if (!session) redirect('/sign-in?next=/analytics')

  const allowed = (session.memberships ?? []).some((membership) =>
    sessionCan(session, 'report:view', membership.organizationId),
  )

  if (!allowed) {
    return <Forbidden area="Analytics" />
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
        <nav aria-label="Organiser">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            <li>
              <Link
                href="/analytics"
                className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Analytics
              </Link>
            </li>
            <li>
              <Link
                href="/organizer/events"
                className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Events
              </Link>
            </li>
            <li>
              <Link
                href="/finance"
                className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Finance
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
