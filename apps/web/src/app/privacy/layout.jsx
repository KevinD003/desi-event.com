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

import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} PrivacyLayoutProps
 * @property {object} children The page.
 */

/**
 * The privacy shell: the workspace rail around the page, or the area's refusal.
 *
 * @param {PrivacyLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function PrivacyLayout({ children }) {
  const { session, admitted } = await enterArea('privacy')

  if (!admitted) return <AreaRefusal area="privacy" />

  const tabs = [
    { href: '/privacy', label: 'Requests' },
    { href: '/privacy/exports', label: 'Exports' },
    { href: '/privacy/holds', label: 'Holds' },
  ]

  return (
    <WorkspaceShell session={session} area="privacy" tabs={tabs}>
      {children}
    </WorkspaceShell>
  )
}
