/**
 * The site header: brand, role-aware navigation, and the account control.
 *
 * A server component, because what the navigation offers is decided from
 * `GET /v1/auth/me` and that read needs the session cookie. The interactive
 * parts — the narrow-viewport disclosure and the shadow that appears once the
 * page scrolls — are the only things that cross into the client, in
 * `PrimaryNav` and `HeaderFrame`.
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
 * ## Layout
 *
 * One row, 72px tall on a wide screen: the wordmark, the four ways into the
 * catalogue, and the account control. On a narrow one the row keeps the
 * wordmark, the account control and a Menu button, and the sheet the button
 * opens wraps onto a row of its own underneath. The account control is handed
 * to `PrimaryNav`, which renders it between the wide row and the Menu button,
 * so the DOM — and with it the tab order — runs in the order the eye reads at
 * every width. Reordering with CSS `order` instead left keyboard focus jumping
 * back up the row after the sheet.
 * A band of mirror-work runs along the foot.
 *
 * @module components/site-header
 */

import Link from 'next/link'

import { accountItems, navigationGroups, workspaceHome } from '../lib/navigation.js'
import { readSession } from '../lib/session.js'
import { AccountMenu, SignInLink } from './account-menu.jsx'
import { Wordmark } from './festive-decor.jsx'
import { HeaderFrame } from './header-frame.jsx'
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
    <HeaderFrame>
      <div className="mx-auto flex min-h-16 max-w-content flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 sm:min-h-18 sm:px-6 lg:gap-x-8">
        <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-control sm:gap-3">
          <Wordmark />
        </Link>

        <PrimaryNav
          groups={groups}
          account={
            <div className="ml-auto flex items-center gap-2 md:ml-0">
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
          }
        />
      </div>
    </HeaderFrame>
  )
}
