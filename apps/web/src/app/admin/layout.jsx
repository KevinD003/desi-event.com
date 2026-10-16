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

import { PublicShell } from '../../components/public-shell.jsx'
import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} AdminLayoutProps
 * @property {object} children The page.
 */

/**
 * The administration shell: the workspace rail around the page, or the refusal
 * in the public shell.
 *
 * @param {AdminLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function AdminLayout({ children }) {
  const { session, admitted } = await enterArea('admin')

  if (!admitted) {
    return (
      <PublicShell>
        <AreaRefusal area="admin" />
      </PublicShell>
    )
  }

  return (
    // No row of tabs: every section of this area is already an entry in the
    // workspace rail, and the overview at /admin lists them with what each
    // is waiting on. The same links in a third place was a navigation too many.
    <WorkspaceShell session={session} area="admin">
      {children}
    </WorkspaceShell>
  )
}
