/**
 * The operations area.
 *
 * Signed in and holding `finance:view` somewhere — the board shows a refund
 * queue as well as the platform ones, and an organiser's finance user is
 * entitled to their own. What each queue shows is decided inside: the platform
 * queues are behind `reconciliation:manage`, which no organisation role carries.
 *
 * The same shape as the finance shell, and the same reasoning: the check lives
 * in the layout because a page that forgets is a page that leaks, and every
 * request inside is authorised again by the API with a step-up window on top.
 *
 * @module app/operations/layout
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { readSession, sessionCan } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} OperationsLayoutProps
 * @property {object} children The page.
 */

/**
 * The operations shell.
 *
 * @param {OperationsLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function OperationsLayout({ children }) {
  const session = await readSession()

  if (!session) redirect('/sign-in?next=/operations')

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
        <h1 className="text-2xl font-bold text-indigo-night-900">Not for you</h1>
        <p className="mt-2 text-slate-700">
          This area shows the work the machine could not finish: unresolved payments, messages that
          did not go, refunds waiting. If you think you should have access, ask whoever runs the
          organisation — nothing here can grant it to you.
        </p>
        <p className="mt-4">
          <Link href="/" className="underline underline-offset-4 hover:text-marigold-700">
            Back to the site
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 pb-4">
        <nav aria-label="Operations">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            <li>
              <Link
                href="/finance"
                className="rounded-sm font-medium text-indigo-night-900 underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                Overview
              </Link>
            </li>
            <li>
              <Link
                href="/operations"
                className="rounded-sm font-medium text-indigo-night-900 underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                Operations
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
