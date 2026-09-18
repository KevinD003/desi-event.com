/**
 * The retention area.
 *
 * Signed in and holding `retention:view` **platform-wide**. Unlike the privacy
 * shell next door, this one asks the plain unscoped question — and the
 * difference is the whole reason the two areas are not one.
 *
 * ## Why the unscoped question is right here and wrong there
 *
 * `sessionCan(session, capability)` with no organisation consults the platform
 * capability list. For `privacy:redact`, an organisation capability held by
 * owners, that question is backwards: it refuses every owner and passes every
 * platform administrator. That is the NF-05 trap, and the privacy shell walks
 * memberships to avoid it.
 *
 * `retention:view` is the mirror image. It is in `PLATFORM_ONLY_CAPABILITIES`,
 * which is asserted at module load never to appear in any organisation role, so
 * a membership walk here would search a list that can never contain it and
 * refuse everybody. The unscoped question is the only one that means anything.
 *
 * ## Why an area of its own rather than a page under /operations
 *
 * Because that shell gates on `finance:view`, which is a different authority.
 * Nesting here would both admit a finance user who was never granted retention
 * and refuse a retention reader who holds no finance capability — wrong in both
 * directions at once.
 *
 * @module app/retention/layout
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { readSession, sessionCan } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} RetentionLayoutProps
 * @property {object} children The page.
 */

/**
 * The retention shell.
 *
 * @param {RetentionLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function RetentionLayout({ children }) {
  const session = await readSession()

  if (!session) redirect('/sign-in?next=/retention')

  if (!sessionCan(session, 'retention:view')) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold text-indigo-night-900">Not for you</h1>
        <p className="mt-2 text-slate-700">
          This area shows what a retention rehearsal counted across the whole platform. It is not
          held by any role inside an organisation, and nothing on this page can grant it to you.
        </p>
        <p className="mt-4">
          <Link
            href="/"
            className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
          >
            Back to the site
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 pb-4">
        <nav aria-label="Retention">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            <li>
              <Link
                href="/retention"
                className="rounded-sm font-medium text-indigo-night-900 underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                Rehearsals
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
