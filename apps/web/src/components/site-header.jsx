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

import { accountItems, navigationGroups, workspaceHome } from '../lib/navigation.js'
import { readSession } from '../lib/session.js'
import { AccountMenu, SignInLink } from './account-menu.jsx'
import { PrimaryNav } from './primary-nav.jsx'

/**
 * The global site header.
 *
 * Three things, left to right: the brand, discovery, and the account control.
 * Signed in, the account control opens onto the account's own pages, the
 * workspace when there is one, and sign out; the workspace's own destinations
 * live in its rail rather than in this row, which is how an owner came to be
 * offered eleven header links before Phase 4.
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
          {session ? (
            <AccountMenu
              displayName={session.user?.displayName ?? 'Your account'}
              items={accountItems(session)}
              workspaceHref={workspaceHome(session)}
            />
          ) : (
            <SignInLink />
          )}
        </div>
      </div>
    </header>
  )
}
