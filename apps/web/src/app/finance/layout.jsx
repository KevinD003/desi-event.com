/**
 * The finance area.
 *
 * Signed in and holding `finance:view` somewhere. The check is in the layout
 * rather than in each page for the reason the moderation shell gives: a page
 * that forgets is a page that leaks, and there is no way to forget a layout.
 *
 * What this decides is only whether to render. Every figure inside is
 * authorised again by the API, which additionally demands a recent second
 * factor under the `FINANCE_VIEW` step-up policy — so a session that was signed
 * in an hour ago renders this shell and gets nothing in it.
 *
 * `noindex` on the whole area, which should not need saying about a page of
 * somebody's revenue.
 *
 * @module app/finance/layout
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { readSession, sessionCan } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} FinanceLayoutProps
 * @property {object} children The page.
 */

/**
 * The finance shell.
 *
 * @param {FinanceLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function FinanceLayout({ children }) {
  const session = await readSession()

  if (!session) redirect('/sign-in?next=/finance')

  // Any membership will do, not the platform list. `sessionCan` with no
  // organisation asks the *platform* capability list, and `finance:view` is an
  // organisation capability — so the unscoped question is the one that refuses
  // every organiser and passes every platform admin, which is exactly the
  // inversion the API's own capability guard is written against.
  const allowed =
    sessionCan(session, 'finance:view') ||
    (session.memberships ?? []).some((membership) =>
      sessionCan(session, 'finance:view', membership.organizationId),
    )

  if (!allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold text-ink">Not for you</h1>
        <p className="mt-2 text-ink-muted">
          This area shows what an organisation is owed and what has been paid out. If you think you
          should have access, ask whoever runs the organisation — nothing here can grant it to you.
        </p>
        <p className="mt-4">
          <Link href="/" className="underline underline-offset-4 hover:text-accent-strong">
            Back to the site
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
        <nav aria-label="Finance">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            <li>
              <Link
                href="/finance"
                className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Overview
              </Link>
            </li>
            <li>
              <Link
                href="/finance/connect"
                className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Payout setup
              </Link>
            </li>
            <li>
              <Link
                href="/operations"
                className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Operations
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
