/**
 * Platform administration.
 *
 * Signed in, and a platform super administrator. Everything in this area
 * changes who can do what across the whole platform, so the shell refuses
 * everybody else before a page is drawn — and the API refuses them again on
 * every request, with a recent second factor demanded for every change.
 *
 * `noindex` on the whole area: none of it is public.
 *
 * @module app/admin/layout
 */

import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'

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
    <WorkspaceShell session={session} area="admin">
      {children}
    </WorkspaceShell>
  )
}
