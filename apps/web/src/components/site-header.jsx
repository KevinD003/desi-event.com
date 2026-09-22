/**
 * The site header: brand, role-aware navigation, and the account control.
 *
 * A server component, because what the navigation offers is decided from
 * `GET /v1/auth/me` and that read needs the session cookie. The interactive
 * part — the narrow-viewport disclosure — is the only thing that crosses into
 * the client, in `PrimaryNav`.
 *
 * Before Phase 4 this header carried four links: `/events` and three category
 * filters. Everything else the product could do — the ticket wallet, the
 * organiser workspace, finance, privacy, retention, moderation — was reachable
 * only by typing a URL. That is what the groups below fix.
 *
 * What it deliberately does not do is treat itself as a permission boundary.
 * See `lib/navigation.js`: the API guards every destination, and the same-origin
 * proxy forwards whatever a browser asks for regardless of what is rendered here.
 *
 * @module components/site-header
 */

import Link from 'next/link'

import { navigationGroups } from '../lib/navigation.js'
import { readSession } from '../lib/session.js'
import { PrimaryNav } from './primary-nav.jsx'

/**
 * The account control.
 *
 * Shows the display name rather than the email address. Both identify the
 * person to themselves, but only one of them is a credential-adjacent value
 * that ends up in screenshots, screen-share recordings and support tickets.
 * `displayName` is a required non-empty column, so there is no case where
 * falling back to the email would be needed.
 *
 * @param {object} props Component props.
 * @param {object|null} props.session The session payload.
 * @returns {JSX.Element} The control.
 */
function AccountControl({ session }) {
  if (!session) {
    return (
      <Link
        href="/sign-in"
        className="inline-flex min-h-11 items-center rounded-lg border border-accent-line bg-accent-soft px-3 text-sm font-semibold text-accent-strong transition-colors duration-(--duration-fast) hover:bg-accent-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        Sign in
      </Link>
    )
  }

  return (
    <p className="flex min-h-11 items-center text-sm text-ink-muted">
      <span className="sr-only">Signed in as </span>
      <span className="max-w-[12rem] truncate font-medium text-ink">
        {session.user?.displayName}
      </span>
    </p>
  )
}

/**
 * The global site header.
 *
 * @returns {Promise<JSX.Element>} The rendered header.
 */
export async function SiteHeader() {
  const session = await readSession()
  const groups = navigationGroups(session)

  return (
    <header className="sticky top-0 z-40 border-b border-accent-line/70 bg-surface/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link
          href="/"
          className="flex items-baseline gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          <span className="font-display text-xl font-bold tracking-tight text-ink">
            Desi<span className="text-accent">-</span>Event
          </span>
          <span aria-hidden="true" className="hidden text-sm text-accent-strong sm:inline">
            देसी इवेंट
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <PrimaryNav groups={groups} />
          <AccountControl session={session} />
        </div>
      </div>
    </header>
  )
}
