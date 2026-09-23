/**
 * Accepting a ticket somebody offered you.
 *
 * ## Why there is a form here rather than a link in the email
 *
 * The invitation is a bearer secret. A link carrying it would put it in the
 * browser's history, in the `Referer` header of whatever page loaded next, in
 * every proxy's access log along the way, and in any screenshot of the address
 * bar — and it would still be there after the invitation had been used. So the
 * code arrives out of band and is pasted into a field, and this route accepts
 * no query parameter that could carry one.
 *
 * The server holds only the code's digest. It has never held the code.
 *
 * @module app/tickets/accept/page
 */

import Link from 'next/link'

import { TicketTransferResponse } from '../../../components/ticket-transfer-actions.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Accept a ticket', robots: { index: false, follow: false } }

/**
 * The accept screen.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function AcceptTransferPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Accept a ticket</h1>
      <p className="mt-2 text-ink-muted">
        Somebody has offered you a ticket. Paste the invitation code below. Accepting puts the
        ticket in this account and stops the sender’s pass working; declining leaves it with them.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        This site delivers no email, so an invitation code does not arrive on its own.{' '}
        <Link
          href="/limitations"
          className="rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          What this site does not do
        </Link>
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        The code is only ever typed in, never carried in a web address — an address with a secret in
        it survives in your history and in somebody’s server log long after the invitation is spent.
      </p>

      <TicketTransferResponse />
    </div>
  )
}
