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
 * One slim row, 64px tall: the logo, the four ways into the catalogue, a
 * search trigger, and the account control — signed out, "Sign in" and then
 * "Sign up". Under it runs the single 2px magenta brand rule, the only
 * ornament the header carries (it used to carry a band of mirror-work). On a
 * narrow screen the row keeps the logo, the account control and a Menu
 * button, and the sheet the button opens wraps onto a row of its own
 * underneath, inside the header. The account control is handed to
 * `PrimaryNav`, which renders it between the wide row and the Menu button,
 * so the DOM — and with it the tab order — runs in the order the eye reads at
 * every width. Reordering with CSS `order` instead left keyboard focus
 * jumping back up the row after the sheet.
 *
 * The search trigger joins the row from 1024px, where it fits beside the
 * account control on one line; below that, "Discover events" is the way to
 * the listing's own search, and at 320px the tab order is exactly what it
 * was: the logo, "Sign in", "Sign up", Menu.
 *
 * ### The logo
 *
 * The brand is the owner's logo (`BrandLogo`, the variant drawn for a light
 * surface — this header is always white), a picture whose alternative text,
 * "The Desi Events", is the link's whole name. It is fetched first, as the
 * one picture on every page above the fold. The file is 162 × 40 at 1x with
 * a 2x copy, and it is drawn at 40px tall (162px wide) from 640px, inside the
 * 44px target of the link, in a 64px row.
 *
 * ### Two links on a phone
 *
 * Signed out, the account control is two links, and on a phone the row must
 * hold the logo, both of them and Menu on one 64px line: measured at 320px,
 * the links are 130px at their compact size and Menu 44px (86px from 359px,
 * where "Menu" is drawn beside its icon), against 288px inside the gutters.
 * So below 520px, signed out only, the row compacts: the links are set at
 * 13px with less padding below 480px, the gaps close up, and the logo is
 * drawn smaller — 36px tall (145px) from 520px, 28px (113px) from 380px, and
 * 23px (93px) below that. At 24px (97px) the row wrapped at 359-360px, where
 * Menu gains its word, by a pixel; at 28px it holds one line from 377px, so
 * the step sits three pixels above that. Everything stays on one 64px line from
 * 320px, every target is still 44px tall, and "Sign up" is never hidden.
 *
 * Signed in, the account control is one button: the logo is 32px tall (129px)
 * below 440px and 36px from there to 640px. Below 640px the button shows the
 * name's initial alone (its accessible name is still "<name>, account"), so
 * the row stays on one line from 320px whatever the name.
 *
 * The four discovery links join the row from 1024px, the width at which the
 * logo, the links, the search trigger and the account control fit one line
 * signed in or out; below it Menu carries them. At 768px they used to share
 * the row with the account control and push it onto a second line, which is
 * why the breakpoint moved up from 768px. Measured in Chromium with the
 * site's own faces at 320, 360, 640, 768, 900, 1024 and 1280px.
 *
 * @module components/site-header
 */

import Link from 'next/link'

import { accountItems, navigationGroups, workspaceHome } from '../lib/navigation.js'
import { readSession } from '../lib/session.js'
import { AccountMenu, SignInLink, SignUpLink } from './account-menu.jsx'
import { BrandLogo } from './brand-logo.jsx'
import { HeaderFrame } from './header-frame.jsx'
import { HeaderSearch } from './header-search.jsx'
import { PrimaryNav } from './primary-nav.jsx'

/**
 * The header's row, the brand link, the logo and the account control, signed
 * in: the logo is 32px tall below 440px, 36px to 640px and 40px from there
 * (see "Two links on a phone" above).
 */
const SIGNED_IN = Object.freeze({
  row: 'mx-auto flex min-h-16 max-w-bleed flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 lg:gap-x-4 lg:px-10 xl:gap-x-6',
  brand: 'flex min-h-11 shrink-0 items-center rounded-control',
  logo: 'h-8 w-auto min-[440px]:h-9 sm:h-10',
  account: 'ml-auto flex items-center gap-2',
})

/**
 * Signed out: the same, with the logo smaller still below 520px — 28px tall
 * from 380px and 23px below — so the two links and Menu share its line (see
 * "Two links on a phone" above); `site-header.test.jsx` holds these heights
 * in place. The account control is pushed to the right at every width, with
 * the search trigger in front of it from `lg`.
 */
const SIGNED_OUT = Object.freeze({
  row: 'mx-auto flex min-h-16 max-w-bleed flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5 min-[480px]:gap-x-3 sm:px-6 lg:gap-x-4 lg:px-10 xl:gap-x-6',
  brand: 'flex min-h-11 shrink-0 items-center rounded-control',
  logo: 'h-5.75 w-auto min-[380px]:h-7 min-[520px]:h-9 sm:h-10',
  account: 'ml-auto flex items-center gap-1 min-[480px]:gap-2',
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
          <BrandLogo variant="light" priority className={layout.logo} />
        </Link>

        <PrimaryNav
          groups={groups}
          account={
            <div className={layout.account}>
              <HeaderSearch />
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
