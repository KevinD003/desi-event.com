/**
 * The attendee's ticket area.
 *
 * Signed in, and that is the whole test: a ticket belongs to the person holding
 * it, not to a role. Which ticket they may see is decided by the API, which
 * knows who owns each one; a layout that tried to answer that would be a layout
 * guessing at rows it has not read.
 *
 * `noindex`, because a page listing somebody's tickets is not a page for a
 * search engine.
 *
 * @module app/tickets/layout
 */

import { AccountShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} TicketsLayoutProps
 * @property {object} children The page.
 */

/**
 * The tickets shell: the account rail around the page.
 *
 * @param {TicketsLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function TicketsLayout({ children }) {
  const { session } = await enterArea('tickets')

  return <AccountShell session={session}>{children}</AccountShell>
}
