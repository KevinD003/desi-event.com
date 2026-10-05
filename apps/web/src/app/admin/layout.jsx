/**
 * Platform administration.
 *
 * Signed in, and on the Desi-Event team as a platform administrator
 * (`organizer:invite`: inviting organisers) or a super administrator
 * (`platform:admin` as well: changing who can do what across the platform).
 * The shell refuses everybody else before a page is drawn; each page asks its
 * own question again, so a platform administrator who opens People and roles
 * is told it is not theirs; and the API refuses them all again on every
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
