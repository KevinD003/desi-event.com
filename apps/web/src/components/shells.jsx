/**
 * The two signed-in shells, and the refusal an area draws instead of one.
 *
 * - **The workspace shell**, for every operational area (organiser,
 *   analytics, finance, operations, moderation, privacy, retention and
 *   platform administration). It is a working shell, not the public site's:
 *   a compact purple bar (the D, which area this is and the others this
 *   account can open, a page finder, the account), one rail listing every
 *   area this account is admitted to (`lib/navigation.js`), the page, and a
 *   slim footer. An area with true sections of its own, not already in the
 *   rail, adds a row of tabs above its page. There is no marketing header or
 *   footer here: somebody scanning tickets at a door or reading a ledger is
 *   not browsing.
 * - **The account shell**, for the attendee's own pages: their tickets and
 *   account. It sits inside the public shell, because these pages belong to
 *   the site the attendee came from, with the account's own pages as a rail
 *   on a desk and a row of segments across the top on a phone.
 *
 * Platform reach is said, not left to be remembered: a platform
 * administrator's bar carries a "Platform administrator" badge, a super
 * administrator's a gold "Super administrator" marker, and every page in the
 * workspace opens with a line saying what that means (`lib/authority.js`).
 *
 * Both shells are server components; only the parts that must follow client
 * navigation or open and close (which entry is current, the rail's sheet and
 * fold, the bar's menus) cross into the client, in `workspace-nav.jsx` and
 * `shell-nav.jsx`.
 *
 * @module components/shells
 */

import Link from 'next/link'
import { Icon } from '@desi-event/ui/icons'

import { AREAS } from '../lib/areas.js'
import { platformAuthority } from '../lib/authority.js'
import { accountItems, workspaceAreas, workspaceGroups } from '../lib/navigation.js'
import { AccountMenu } from './account-menu.jsx'
import { BrandLogo } from './brand-logo.jsx'
import { PageTransition } from './page-transition.jsx'
import { AccountNav, AreaTabs } from './shell-nav.jsx'
import { SignOutButton } from './sign-out-button.jsx'
import { SECONDARY_LINK } from './workspace-kit.jsx'
import {
  AreaSwitcher,
  PageFinder,
  RailProvider,
  RailToggle,
  WorkspaceRail,
} from './workspace-nav.jsx'

/**
 * The first letter of a display name, for a monogram.
 *
 * `Intl.Segmenter` would be the thorough answer for a name that opens with a
 * combining sequence; the spread over code points is enough for a letter in a
 * circle that is `aria-hidden` anyway, and it never splits a surrogate pair.
 *
 * @param {string|undefined} name The display name.
 * @returns {string} One upper-cased character, or an empty string.
 */
export function monogram(name) {
  const [first = ''] = [...(name ?? '').trim()]

  return first.toLocaleUpperCase('en-US')
}

/** The rail's id, which the bar's button names in `aria-controls`. */
export const WORKSPACE_RAIL_ID = 'workspace-rail'

/**
 * The bar's marker of platform reach: a badge for a platform administrator,
 * gold foil for a super administrator. On a phone the words are read rather
 * than drawn, beside the icon, to leave the bar room.
 *
 * @param {object} props Component props.
 * @param {object} props.authority The session's authority.
 * @returns {JSX.Element} The marker.
 */
function AuthorityBadge({ authority }) {
  const gold = authority.level === 'super'

  return (
    <span
      data-authority={authority.level}
      className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-caption font-bold ${
        gold ? 'bg-highlight text-highlight-ink' : 'border border-ink-inverse/40 text-ink-inverse'
      }`}
    >
      <Icon name={gold ? 'star' : 'shield'} className="h-4 w-4" />
      <span className="max-sm:sr-only">{authority.label}</span>
    </span>
  )
}

/**
 * The line every workspace page opens with for somebody with platform reach.
 *
 * Not a live region: it does not change while the page is open, and the door
 * says the same thing about its own lookups in its own words.
 *
 * @param {object} props Component props.
 * @param {object} props.authority The session's authority.
 * @returns {JSX.Element} The line.
 */
function AuthorityLine({ authority }) {
  const gold = authority.level === 'super'

  return (
    <p
      data-authority-line={authority.level}
      className="mb-6 flex items-start gap-2.5 border-b border-line pb-4 text-label text-ink-muted group-has-[[data-register=door]]/content:hidden"
    >
      <Icon
        name={gold ? 'star' : 'shield'}
        className={`mt-px h-5 w-5 ${gold ? 'text-accent-strong' : 'text-ink-subtle'}`}
      />
      <span>
        <strong className="font-semibold text-ink">{authority.label}.</strong> {authority.line}
      </span>
    </p>
  )
}

/**
 * The workspace's bar: the D, the area, the page finder and the account.
 *
 * @param {object} props Component props.
 * @param {object} props.session The session payload.
 * @param {string} props.area The current area's key.
 * @param {Array<{href: string, label: string}>} props.items Every page the rail offers.
 * @param {object|null} props.authority The session's platform reach.
 * @returns {JSX.Element} The bar, the page's banner.
 */
function AppBar({ session, area, items, authority }) {
  return (
    <header className="sticky top-0 z-40 bg-surface-inverse text-ink-inverse [view-transition-name:site-header]">
      <div className="flex h-14 items-center gap-1 px-3 sm:gap-2 sm:px-4 lg:px-5">
        <RailToggle />
        {/* The D alone: on the bar's purple it is the brand, and its
            alternative text names the link. */}
        <Link
          href="/"
          className="flex min-h-11 shrink-0 items-center rounded-control px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <BrandLogo variant="icon" priority className="h-8 w-auto" />
        </Link>
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-ink-inverse/25 sm:block" />
        <AreaSwitcher areas={workspaceAreas(session)} current={area} />
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {authority ? <AuthorityBadge authority={authority} /> : null}
          <PageFinder items={items} />
          <AccountMenu
            tone="inverse"
            displayName={session.user?.displayName ?? 'Your account'}
            items={accountItems(session)}
            workspaceHref={null}
          />
        </div>
      </div>
    </header>
  )
}

/** A link in the workspace's footer: quiet, underlined on hover, 44px tall. */
const FOOTER_LINK =
  'inline-flex min-h-11 items-center rounded-control text-caption font-semibold text-ink-muted underline-offset-4 transition-colors duration-(--duration-fast) hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/**
 * The workspace's footer: one line, the ways back to the site.
 *
 * @returns {JSX.Element} The footer, the page's `contentinfo`.
 */
function WorkspaceFooter() {
  return (
    <footer className="border-t border-line bg-surface [view-transition-name:site-footer]">
      <div className="flex flex-wrap items-center justify-between gap-x-6 px-4 sm:px-6 lg:px-10">
        <p className="py-3 text-caption text-ink-subtle">The Desi Events workspace</p>
        <ul className="flex flex-wrap gap-x-5">
          <li>
            <Link href="/" className={FOOTER_LINK}>
              Back to the site
            </Link>
          </li>
          <li>
            <Link href="/limitations" className={FOOTER_LINK}>
              What this site does not do
            </Link>
          </li>
          <li>
            <Link href="/contact" className={FOOTER_LINK}>
              Contact
            </Link>
          </li>
        </ul>
      </div>
    </footer>
  )
}

/**
 * @typedef {object} WorkspaceShellProps
 * @property {object} session The session payload.
 * @property {string} area The area's key in `lib/areas.js`, for the bar and its tabs' name.
 * @property {Array<{href: string, label: string}>} [tabs] The area's own sections, when they are not already in the rail.
 * @property {ReactNode} children The page.
 */

/**
 * The workspace shell.
 *
 * The page's content box drops its own padding around the door's register
 * (`has-[[data-register=door]]`), so the door can fill the space beside the
 * rail edge to edge; the authority line steps aside there too, because the
 * door says the same thing about its own lookups in its own words.
 *
 * @param {WorkspaceShellProps} props Component props.
 * @returns {JSX.Element} The bar, the rail, the page and the footer.
 */
export function WorkspaceShell({ session, area, tabs = [], children }) {
  const groups = workspaceGroups(session)
  const authority = platformAuthority(session)

  return (
    <RailProvider railId={WORKSPACE_RAIL_ID}>
      <div data-shell="workspace" className="flex flex-1 flex-col [--chrome-top:3.5rem]">
        <AppBar
          session={session}
          area={area}
          items={groups.flatMap((group) => group.items)}
          authority={authority}
        />
        <div className="flex flex-1">
          <WorkspaceRail groups={groups} />
          <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
            <PageTransition
              kind="workspace"
              className="group/content flex w-full max-w-bleed flex-1 flex-col px-4 py-6 sm:px-6 lg:px-10 lg:py-8 has-[[data-register=door]]:max-w-none has-[[data-register=door]]:p-0"
            >
              {authority ? <AuthorityLine authority={authority} /> : null}
              <AreaTabs label={AREAS[area]?.label ?? 'Sections'} items={tabs} />
              <div className={`flex flex-1 flex-col ${tabs.length > 1 ? 'mt-8' : ''}`}>
                {children}
              </div>
            </PageTransition>
          </main>
        </div>
        <WorkspaceFooter />
      </div>
    </RailProvider>
  )
}

/**
 * The account shell, for the attendee's own pages, inside the public shell.
 *
 * @param {object} props Component props.
 * @param {object} props.session The session payload.
 * @param {ReactNode} props.children The page.
 * @returns {JSX.Element} The shell around the page.
 */
export function AccountShell({ session, children }) {
  const name = session.user?.displayName

  return (
    <div className="mx-auto w-full max-w-content px-4 pt-4 pb-12 sm:px-6 lg:pt-10 lg:pb-16">
      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
        <AccountNav
          label="Your account"
          items={accountItems(session)}
          header={
            name ? (
              <p className="hidden min-w-0 px-3 pb-4 text-caption text-ink-subtle lg:block">
                Signed in as
                <span className="block text-label font-semibold break-words text-ink">{name}</span>
              </p>
            ) : null
          }
          footer={
            <div className="mt-4 hidden border-t border-line pt-4 lg:block">
              <SignOutButton className="flex min-h-10 w-full items-center gap-3 rounded-control px-3 text-left text-label font-medium text-opsnav-ink transition-colors duration-(--duration-fast) hover:bg-opsnav-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus" />
            </div>
          }
        />
        <div className="min-w-0 pt-6 lg:pt-0">{children}</div>
      </div>
    </div>
  )
}

/**
 * What an area says to a session it does not admit.
 *
 * The same words the area's layout used before it moved here, because people
 * — and the browser suites — read them. The refusal names who can help and
 * never offers a way round: nothing on the page can grant access. It is
 * drawn in the public shell (the area's layout puts it there), because a
 * session the area does not admit has no workspace to be shown.
 *
 * An area may list alternatives that are the person's own to take — the
 * organiser workspace offers accepting an organiser invitation and joining a
 * team with a code. Neither is a way round somebody else's decision: each code
 * was issued by somebody entitled to issue it, and works only for the address
 * it names.
 *
 * @param {object} props Component props.
 * @param {string} props.area The area's key in `lib/areas.js`.
 * @returns {JSX.Element} The refusal.
 */
export function AreaRefusal({ area }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="flex items-center gap-2 text-label font-semibold text-ink-muted">
        <Icon name="lock" className="h-5 w-5" />
        {AREAS[area].label}
      </p>
      <h1 className="mt-3 text-h1 text-ink">Not for you</h1>
      <p className="mt-4 max-w-[60ch] text-body text-ink-muted">{AREAS[area].refusal}</p>
      {AREAS[area].alternatives?.length ? (
        <ul className="mt-8 flex flex-wrap gap-3">
          {AREAS[area].alternatives.map((alternative) => (
            <li key={alternative.href}>
              <Link href={alternative.href} className={SECONDARY_LINK}>
                {alternative.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-8">
        <Link href="/" className={SECONDARY_LINK}>
          Back to the site
        </Link>
      </p>
    </div>
  )
}
