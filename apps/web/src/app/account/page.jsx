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

import { LINK_PANEL, PageHeader, PANEL, Section } from '../../components/workspace-kit.jsx'
import { workspaceHome } from '../../lib/navigation.js'
import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Your account', robots: { index: false, follow: false } }

/**
 * One place to go from here, drawn as a card that is a single link.
 *
 * @param {object} props Component props.
 * @param {string} props.href Where it goes.
 * @param {string} props.title What it is called.
 * @param {string} props.children One line about what is there.
 * @returns {JSX.Element} The card.
 */
function Destination({ href, title, children }) {
  return (
    <li>
      <Link href={href} className={`group ${LINK_PANEL}`}>
        <span className="flex items-center justify-between gap-3">
          <span className="font-display text-lg font-semibold text-ink">{title}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="size-5 shrink-0 text-accent-strong transition-transform duration-(--duration-fast) ease-standard motion-safe:group-hover:translate-x-0.5"
          >
            <path d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4Z" />
          </svg>
        </span>
        <span className="mt-1 block text-sm text-ink-muted">{children}</span>
      </Link>
    </li>
  )
}

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
    <div className="py-4 sm:grid sm:grid-cols-3 sm:gap-4">
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
      <PageHeader
        title="Your account"
        description="Your tickets, and the account they belong to."
      />

      <Section id="account-facts" title="Signed in as" className="mt-10">
        <dl className={`mt-4 divide-y divide-line px-5 ${PANEL}`}>
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
      </Section>

      <Section id="account-next" title="Where to go">
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Destination href="/tickets" title="My tickets">
            Your passes, what they admit to, and what you have handed on.
          </Destination>
          <Destination href="/account/orders" title="Orders">
            What you bought, what it cost, and the tickets each order gave you.
          </Destination>
          <Destination href="/account/transfers" title="Transfers">
            Tickets you are offering, have handed on, or were given — and where to accept one.
          </Destination>
          <Destination href="/account/security" title="Security">
            Your password, two-step sign-in, and where you are signed in.
          </Destination>
          <Destination href="/account/privacy" title="Privacy">
            What is kept about you, who sees it, and what you can change.
          </Destination>
          {workspace ? (
            <Destination href={workspace} title="Workspace">
              The events, venues, doors and money you look after for an organisation.
            </Destination>
          ) : null}
        </ul>
      </Section>
    </div>
  )
}
