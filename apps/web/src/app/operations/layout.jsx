/**
 * The operations area.
 *
 * Signed in and holding `finance:view` somewhere — the board shows a refund
 * queue as well as the platform ones, and an organiser's finance user is
 * entitled to their own. What each queue shows is decided inside: the platform
 * queues are behind `reconciliation:manage`, which no organisation role carries.
 *
 * The same shape as the finance shell, and the same reasoning: the check lives
 * in the layout because a page that forgets is a page that leaks, and every
 * request inside is authorised again by the API with a step-up window on top.
 *
 * @module app/operations/layout
 */

import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'
import { operationsTabs } from '../../lib/area-tabs.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} OperationsLayoutProps
 * @property {object} children The page.
 */

/**
 * The operations shell: the workspace rail around the page, or the area's refusal.
 *
 * @param {OperationsLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function OperationsLayout({ children }) {
  const { session, admitted } = await enterArea('operations')

  if (!admitted) return <AreaRefusal area="operations" />

  return (
    <WorkspaceShell session={session} area="operations" tabs={operationsTabs(session)}>
      {children}
    </WorkspaceShell>
  )
}
