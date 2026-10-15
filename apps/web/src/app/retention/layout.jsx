/**
 * The retention area.
 *
 * Signed in and holding `retention:view` **platform-wide**. Unlike the privacy
 * shell next door, this one asks the plain unscoped question — and the
 * difference is the whole reason the two areas are not one.
 *
 * ## Why the unscoped question is right here and wrong there
 *
 * `sessionCan(session, capability)` with no organisation consults the platform
 * capability list. For `privacy:redact`, an organisation capability held by
 * owners, that question is backwards: it refuses every owner and passes every
 * platform administrator. That is the NF-05 trap, and the privacy shell walks
 * memberships to avoid it.
 *
 * `retention:view` is the mirror image. It is in `PLATFORM_ONLY_CAPABILITIES`,
 * which is asserted at module load never to appear in any organisation role, so
 * a membership walk here would search a list that can never contain it and
 * refuse everybody. The unscoped question is the only one that means anything.
 *
 * ## Why an area of its own rather than a page under /operations
 *
 * Because that shell gates on `finance:view`, which is a different authority.
 * Nesting here would both admit a finance user who was never granted retention
 * and refuse a retention reader who holds no finance capability — wrong in both
 * directions at once.
 *
 * @module app/retention/layout
 */

import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} RetentionLayoutProps
 * @property {object} children The page.
 */

/**
 * The retention shell: the workspace rail around the page, or the area's refusal.
 *
 * @param {RetentionLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function RetentionLayout({ children }) {
  const { session, admitted } = await enterArea('retention')

  if (!admitted) return <AreaRefusal area="retention" />

  return (
    <WorkspaceShell session={session} area="retention">
      {children}
    </WorkspaceShell>
  )
}
