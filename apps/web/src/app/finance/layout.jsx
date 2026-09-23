/**
 * The finance area.
 *
 * Signed in and holding `finance:view` somewhere. The check is in the layout
 * rather than in each page for the reason the moderation shell gives: a page
 * that forgets is a page that leaks, and there is no way to forget a layout.
 *
 * What this decides is only whether to render. Every figure inside is
 * authorised again by the API, which additionally demands a recent second
 * factor under the `FINANCE_VIEW` step-up policy — so a session that was signed
 * in an hour ago renders this shell and gets nothing in it.
 *
 * `noindex` on the whole area, which should not need saying about a page of
 * somebody's revenue.
 *
 * @module app/finance/layout
 */

import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'
import { financeTabs } from '../../lib/area-tabs.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} FinanceLayoutProps
 * @property {object} children The page.
 */

/**
 * The finance shell: the workspace rail around the page, or the area's refusal.
 *
 * @param {FinanceLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function FinanceLayout({ children }) {
  const { session, admitted } = await enterArea('finance')

  if (!admitted) return <AreaRefusal area="finance" />

  // Which sections this session is offered is `lib/area-tabs.js`'s to say.
  const tabs = financeTabs(session)

  return (
    <WorkspaceShell session={session} area="finance" tabs={tabs}>
      {children}
    </WorkspaceShell>
  )
}
