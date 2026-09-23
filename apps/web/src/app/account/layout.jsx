/**
 * The attendee's own account.
 *
 * Signed in, and that is the whole test: these pages are about the person
 * themselves, so nobody needs a capability to open them. Drawn in the account
 * shell beside their tickets, so the two are one place to them.
 *
 * `noindex`, because a page about somebody's account is not a page for a
 * search engine.
 *
 * @module app/account/layout
 */

import { AccountShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} AccountLayoutProps
 * @property {object} children The page.
 */

/**
 * The account shell.
 *
 * @param {AccountLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function AccountLayout({ children }) {
  const { session } = await enterArea('account')

  return <AccountShell session={session}>{children}</AccountShell>
}
