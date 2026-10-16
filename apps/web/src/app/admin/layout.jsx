/**
 * Platform administration.
 *
 * Signed in, and on the team at The Desi Events as a platform administrator
 * or a super administrator (`platform:admin`: everything here, ADR 0018), or a
 * finance administrator for the booking-fee refund page. The shell refuses
 * everybody else before a page is drawn; each page asks its own question
 * again, so only a super administrator is shown People and roles' platform-role
 * change (`platform:role_manage`); and the API refuses them all again on every
 * request, with a recent second factor demanded for every change.
 *
 * `noindex` on the whole area: none of it is public.
 *
 * @module app/admin/layout
 */

import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'
import { adminTabs } from '../../lib/area-tabs.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} AdminLayoutProps
 * @property {object} children The page.
 */

/**
 * The administration shell: the workspace rail around the page, or the refusal.
 *
 * @param {AdminLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function AdminLayout({ children }) {
  const { session, admitted } = await enterArea('admin')

  if (!admitted) return <AreaRefusal area="admin" />

  return (
    <WorkspaceShell session={session} area="admin" tabs={adminTabs(session)}>
      {children}
    </WorkspaceShell>
  )
}
