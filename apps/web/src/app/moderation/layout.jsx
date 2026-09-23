/**
 * The moderation area.
 *
 * Signed in, and holding `moderation:review`. The check is here rather than in
 * each page — a page that forgets is a page that leaks, and there is no way to
 * forget a layout — and it is a real one: `readSession` asks the API who the
 * caller is, so a forged cookie gets the same answer as no cookie.
 *
 * What this decides is only whether to render. Every decision inside is
 * authorised again by the API, which additionally demands a recent second
 * factor under the `MODERATION` step-up policy.
 *
 * `noindex` on the whole area. Nothing under here is public, and the queue in
 * particular is a list of things nobody outside the platform should know exist.
 *
 * @module app/moderation/layout
 */

import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} ModerationLayoutProps
 * @property {object} children The page.
 */

/**
 * The moderation shell: the workspace rail around the page, or the area's refusal.
 *
 * @param {ModerationLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function ModerationLayout({ children }) {
  const { session, admitted } = await enterArea('moderation')

  if (!admitted) return <AreaRefusal area="moderation" />

  return (
    <WorkspaceShell session={session} area="moderation">
      {children}
    </WorkspaceShell>
  )
}
