/**
 * The privacy area.
 *
 * Signed in and holding `privacy:redact` in at least one organisation. That
 * capability is OWNER-only and organisation-scoped, which makes the shape of
 * the check here load-bearing rather than incidental.
 *
 * ## Why the membership walk, and not the plain question
 *
 * `sessionCan(session, 'privacy:redact')` with no organisation asks the
 * **platform** capability list. `privacy:redact` is an organisation capability,
 * so the unscoped question refuses every organisation owner — the only people
 * who are supposed to be here — and passes a platform administrator, who holds
 * every capability platform-wide before an organisation id is ever consulted.
 * That inversion is the NF-05 trap, and it is exactly backwards for this area.
 *
 * So the check walks memberships. The platform question is kept as well, but
 * deliberately second: the API defends against a platform account reaching one
 * organisation's subject at a second layer, and the shell's job is to let the
 * right people in, not to be the last word on who may act.
 *
 * ## Why the shell refuses at all, when the API refuses anyway
 *
 * Because a page that forgets is a page that leaks, and every request inside is
 * authorised again by the API with a step-up window on top. The same reasoning
 * as the finance and operations shells; this area simply has more to lose.
 *
 * @module app/privacy/layout
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { readSession, sessionCan } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} PrivacyLayoutProps
 * @property {object} children The page.
 */

/**
 * The privacy shell.
 *
 * @param {PrivacyLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function PrivacyLayout({ children }) {
  const session = await readSession()

  if (!session) redirect('/sign-in?next=/privacy')

  const memberships = session.memberships ?? []
  const allowed =
    memberships.some((membership) =>
      sessionCan(session, 'privacy:redact', membership.organizationId),
    ) || sessionCan(session, 'privacy:redact')

  if (!allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold text-indigo-night-900">Not for you</h1>
        <p className="mt-2 text-slate-700">
          This area erases people from an organisation&rsquo;s records, which is not something that
          can be undone. It is held by organisation owners alone. If you think you should have
          access, ask whoever runs the organisation — nothing on this page can grant it to you.
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
        <nav aria-label="Privacy">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            <li>
              <Link
                href="/privacy"
                className="rounded-sm font-medium text-indigo-night-900 underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                Requests
              </Link>
            </li>
            <li>
              <Link
                href="/privacy/exports"
                className="rounded-sm font-medium text-indigo-night-900 underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                Exports
              </Link>
            </li>
            <li>
              <Link
                href="/privacy/holds"
                className="rounded-sm font-medium text-indigo-night-900 underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                Holds
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
