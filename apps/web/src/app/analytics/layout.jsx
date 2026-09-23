/**
 * The analytics area.
 *
 * Signed in and holding `report:view` **in some organisation**. The unscoped
 * question — `sessionCan(session, 'report:view')` with no organisation — asks
 * the *platform* capability list, and `report:view` is an organisation
 * capability, so that question refuses every organiser and passes every
 * platform admin. That inversion is NF-05, and it is why the check below walks
 * the memberships rather than asking once.
 *
 * The layout decides only whether to render a shell. Every figure inside is
 * authorised again by the API, which additionally demands a recent second
 * factor under `FINANCE_VIEW` — so a session signed in an hour ago renders this
 * and gets nothing in it.
 *
 * `noindex`, which should not need saying about a page of somebody's sales.
 *
 * @module app/analytics/layout
 */

import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} AnalyticsLayoutProps
 * @property {object} children The page.
 */

/**
 * The analytics shell: the workspace rail around the page, or the area's refusal.
 *
 * @param {AnalyticsLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function AnalyticsLayout({ children }) {
  const { session, admitted } = await enterArea('analytics')

  if (!admitted) return <AreaRefusal area="analytics" />

  return (
    <WorkspaceShell session={session} area="analytics">
      {children}
    </WorkspaceShell>
  )
}
