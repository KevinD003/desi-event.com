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
 * catalogue, and the account control — signed out, "Sign in" and then "Sign
 * up". On a narrow one the row keeps the wordmark, the account control and a
 * Menu button, and the sheet the button opens wraps onto a row of its own
 * underneath. The account control is handed to `PrimaryNav`, which renders it
 * between the wide row and the Menu button, so the DOM — and with it the tab
 * order — runs in the order the eye reads at every width. Reordering with CSS
 * `order` instead left keyboard focus jumping back up the row after the sheet.
 * A band of mirror-work runs along the foot.
 *
 * ### Two links on a phone
 *
 * Signed out, the account control is two links, and below 480px the row does
 * not hold the full wordmark, both of them and Menu: measured at 320px, the
 * wordmark is 146px, the links 149px and Menu 44px, against 288px inside the
 * gutters. Left alone the row wrapped — and it already wrapped at 320px and
 * 360px with "Sign in" alone, leaving Menu by itself on a second line. So
 * below 480px, signed out only, the row compacts instead: the wordmark keeps
 * its name and drops the diamond beside it, the name is set at 16px, the
 * links at 13px with less padding, and the gaps close up. Everything stays
 * on one 64px line from 320px, every target is still 44px tall, and "Sign
 * up" is never hidden. From 480px the full sizes return.
 *
 * Between 768px and about 905px the four discovery links leave no room for
 * the account control, as they did for "Sign in" alone up to about 806px; it
 * wraps onto a second line, held to the right, under the navigation.
 *
 * @module components/site-header
 */

import Link from 'next/link'

import { accountItems, navigationGroups, workspaceHome } from '../lib/navigation.js'
import { readSession } from '../lib/session.js'
import { AccountMenu, SignInLink, SignUpLink } from './account-menu.jsx'
import { Wordmark } from './festive-decor.jsx'
import { HeaderFrame } from './header-frame.jsx'
import { PrimaryNav } from './primary-nav.jsx'

/** The header's row, the brand link and the account control, signed in: as they were. */
const SIGNED_IN = Object.freeze({
  row: 'mx-auto flex min-h-16 max-w-content flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 sm:min-h-18 sm:px-6 lg:gap-x-8',
  brand: 'flex min-h-11 items-center gap-2.5 rounded-control sm:gap-3',
  account: 'ml-auto flex items-center gap-2 md:ml-0',
})

/**
 * Signed out: the same, compacted below 480px so the two links and Menu share
 * the wordmark's line (see "Two links on a phone" above). The brand link
 * reaches into `Wordmark` for its diamond (the `svg`) and its name (the
 * `.font-display` line); `site-header.test.jsx` holds both in place. The
 * account control stays pushed to the right up to `lg`, so when it wraps onto
 * a second line between 768px and about 905px it sits under the navigation
 * rather than under the wordmark.
 */
const SIGNED_OUT = Object.freeze({
  row: 'mx-auto flex min-h-16 max-w-content flex-wrap items-center justify-between gap-x-2 gap-y-2 px-4 py-2.5 min-[480px]:gap-x-3 sm:min-h-18 sm:px-6 lg:gap-x-8',
  brand:
    'flex min-h-11 items-center gap-2.5 rounded-control max-[480px]:[&_.font-display]:text-base max-[480px]:[&>svg]:hidden sm:gap-3',
  account: 'ml-auto flex items-center gap-1 min-[480px]:gap-2 lg:ml-0',
})

/**
 * The global site header.
 *
 * Three things, left to right: the brand, discovery, and the account control.
 * Signed out, that is "Sign in" and "Sign up", in that order. Signed in, it
 * opens onto the account's own pages, the workspace when there is one, and
 * sign out; the workspace's own destinations live in its rail rather than in
 * this row, which is how an owner came to be offered eleven header links
 * before Phase 4.
 *
 * @returns {Promise<JSX.Element>} The rendered header.
 */
export async function SiteHeader() {
  const session = await readSession()
  const groups = navigationGroups(session)
  const layout = session ? SIGNED_IN : SIGNED_OUT

  return (
    <HeaderFrame>
      <div className={layout.row}>
        <Link href="/" className={layout.brand}>
          <Wordmark />
        </Link>

        <PrimaryNav
          groups={groups}
          account={
            <div className={layout.account}>
              {session ? (
                <AccountMenu
                  displayName={session.user?.displayName ?? 'Your account'}
                  items={accountItems(session)}
                  workspaceHref={workspaceHome(session)}
                />
              ) : (
                <>
                  <SignInLink />
                  <SignUpLink />
                </>
              )}
            </div>
          }
        />
      </div>
    </HeaderFrame>
  )
}
