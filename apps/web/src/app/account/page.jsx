/**
 * The account overview: who you are signed in as, and where to go from here.
 *
 * Where signing in lands by default. It used to land on the organiser's event
 * list whoever you were, which for somebody who had only bought a ticket was
 * a workspace they had no use for.
 *
 * Everything here comes from `GET /v1/auth/me` — the one read every page
 * already makes — so this page makes no request of its own and cannot show
 * anything the session did not already carry.
 *
 * @module app/account/page
 */

import Link from 'next/link'

import { workspaceHome } from '../../lib/navigation.js'
import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Your account', robots: { index: false, follow: false } }

/** Classes for a destination card. */
const CARD =
  'block h-full rounded-card border border-line bg-surface-raised p-4 transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

/**
 * One fact about the account, as a term and its description.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {ReactNode} props.children What it says.
 * @returns {JSX.Element} The pair.
 */
function Fact({ term, children }) {
  return (
    <div className="py-3 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-ink-muted">{term}</dt>
      <dd className="mt-1 text-sm break-words text-ink sm:col-span-2 sm:mt-0">{children}</dd>
    </div>
  )
}

/**
 * The account overview page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function AccountPage() {
  const session = await readSession()
  const user = session?.user ?? {}
  const workspace = workspaceHome(session)
  const secondFactor = session?.session ?? {}

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Your account</h1>
      <p className="mt-2 text-ink-muted">Your tickets, and the account they belong to.</p>

      <section aria-labelledby="account-facts" className="mt-8">
        <h2 id="account-facts" className="text-lg font-semibold text-ink">
          Signed in as
        </h2>
        <dl className="mt-2 divide-y divide-line rounded-card border border-line bg-surface-raised px-4">
          <Fact term="Name">{user.displayName}</Fact>
          <Fact term="Email address">
            {user.email}
            {user.emailVerified ? null : (
              <span className="mt-1 block text-ink-muted">
                Not yet confirmed. This build has no email service, so it cannot send the
                confirmation link; nothing you can do here depends on it.
              </span>
            )}
          </Fact>
          <Fact term="Two-step sign-in">
            {secondFactor.mfaEnrolled
              ? 'On — signing in asks for a code as well as your password.'
              : 'Off.'}
            {secondFactor.mfaRequired && !secondFactor.mfaEnrolled ? (
              <span className="mt-1 block text-status-warning">
                An organisation role you hold needs it, and until it is set up the workspace will
                refuse to work for this account.
              </span>
            ) : null}
          </Fact>
        </dl>
      </section>

      <section aria-labelledby="account-next" className="mt-10">
        <h2 id="account-next" className="text-lg font-semibold text-ink">
          Where to go
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          <li>
            <Link href="/tickets" className={CARD}>
              <span className="block font-semibold text-ink">My tickets</span>
              <span className="mt-1 block text-sm text-ink-muted">
                Your passes, what they admit to, and what you have handed on.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/tickets/accept" className={CARD}>
              <span className="block font-semibold text-ink">Accept a ticket</span>
              <span className="mt-1 block text-sm text-ink-muted">
                Somebody offered you a ticket and gave you a code for it.
              </span>
            </Link>
          </li>
          {workspace ? (
            <li>
              <Link href={workspace} className={CARD}>
                <span className="block font-semibold text-ink">Workspace</span>
                <span className="mt-1 block text-sm text-ink-muted">
                  The events, venues, doors and money you look after for an organisation.
                </span>
              </Link>
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  )
}
