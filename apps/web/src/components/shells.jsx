/**
 * The two signed-in shells, and the refusal an area draws instead of one.
 *
 * Before Phase 4 every area layout drew its own strip of links — Organiser,
 * Finance, Operations, Privacy, Retention, Moderation, Tickets — each always
 * showing all of its entries, none marking where you were, and none reaching
 * any other area. Somebody who ran events and handled their money had no way
 * from one to the other but the address bar.
 *
 * Now there are two shells:
 *
 * - **The workspace shell**, for every operational area: one rail listing
 *   every area this account is admitted to (see `lib/areas.js` and
 *   `lib/navigation.js`), and, for an area with several sections, a row of
 *   tabs above its page.
 * - **The account shell**, for the attendee's own pages: tickets and the
 *   account, with sign out.
 *
 * Both are server components; only the lists that must follow client
 * navigation (which entry is current) cross into the client.
 *
 * @module components/shells
 */

import Link from 'next/link'

import { AREAS } from '../lib/areas.js'
import { accountItems, workspaceGroups } from '../lib/navigation.js'
import { AreaTabs, ShellRail } from './shell-nav.jsx'
import { SignOutButton } from './sign-out-button.jsx'
import { PANEL, SECONDARY_LINK } from './workspace-kit.jsx'

/**
 * The first letter of a display name, for the rail's monogram.
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

/**
 * Who is signed in, above a rail.
 *
 * A monogram and the display name — never the email address: the rail is on
 * every signed-in page, and an address there would be in every screenshot of
 * one. The monogram is decoration and hidden from assistive technology; the
 * sentence beside it says the same thing in words.
 *
 * @param {object} props Component props.
 * @param {object} props.session The session payload.
 * @returns {JSX.Element} The line.
 */
function SignedInAs({ session }) {
  const name = session.user?.displayName
  const letter = monogram(name)

  return (
    <div className="mb-3 flex items-center gap-3 border-b border-opsnav-line px-2.5 pb-3">
      {letter ? (
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-base font-semibold text-accent-strong"
        >
          {letter}
        </span>
      ) : null}
      <p className="min-w-0 text-xs text-ink-subtle">
        Signed in as{' '}
        <span className="block text-sm font-semibold break-words text-ink">{name}</span>
      </p>
    </div>
  )
}

/**
 * @typedef {object} WorkspaceShellProps
 * @property {object} session The session payload.
 * @property {string} area The area's key in `lib/areas.js`, for its tabs' name.
 * @property {Array<{href: string, label: string}>} [tabs] The area's sections.
 * @property {ReactNode} children The page.
 */

/**
 * The workspace shell.
 *
 * @param {WorkspaceShellProps} props Component props.
 * @returns {JSX.Element} The shell around the page.
 */
export function WorkspaceShell({ session, area, tabs = [], children }) {
  return (
    <div className="mx-auto w-full max-w-bleed px-4 py-6 sm:px-6 lg:py-10">
      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
        <ShellRail
          label="Workspace"
          toggleLabel="Workspace menu"
          groups={workspaceGroups(session)}
          header={<SignedInAs session={session} />}
        />
        <div className="min-w-0">
          <AreaTabs label={AREAS[area]?.label ?? 'Sections'} items={tabs} />
          <div className={tabs.length > 1 ? 'mt-8' : ''}>{children}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * The account shell, for the attendee's own pages.
 *
 * @param {object} props Component props.
 * @param {object} props.session The session payload.
 * @param {ReactNode} props.children The page.
 * @returns {JSX.Element} The shell around the page.
 */
export function AccountShell({ session, children }) {
  return (
    <div className="mx-auto w-full max-w-content px-4 py-6 sm:px-6 lg:py-10">
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <ShellRail
          label="Your account"
          toggleLabel="Account menu"
          groups={[{ id: 'account', label: 'Your account', items: accountItems(session) }]}
          header={<SignedInAs session={session} />}
          footer={
            <div className="mt-3 border-t border-opsnav-line pt-3">
              <SignOutButton className="flex min-h-11 w-full items-center rounded-control px-2.5 text-left text-sm font-medium text-opsnav-ink transition-colors duration-(--duration-fast) hover:bg-opsnav-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:pointer-fine:min-h-10" />
            </div>
          }
        />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}

/**
 * What an area says to a session it does not admit.
 *
 * The same words the area's layout used before it moved here, because people
 * — and the browser suites — read them. The refusal names who can help and
 * never offers a way round: nothing on the page can grant access.
 *
 * @param {object} props Component props.
 * @param {string} props.area The area's key in `lib/areas.js`.
 * @returns {JSX.Element} The refusal.
 */
export function AreaRefusal({ area }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div className={`p-6 sm:p-8 ${PANEL}`}>
        <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
          {AREAS[area].label}
        </p>
        <h1 className="mt-2 text-h2 font-semibold text-ink">Not for you</h1>
        <p className="mt-3 text-ink-muted">{AREAS[area].refusal}</p>
        <p className="mt-6">
          <Link href="/" className={SECONDARY_LINK}>
            Back to the site
          </Link>
        </p>
      </div>
    </div>
  )
}
