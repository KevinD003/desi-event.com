/**
 * Accepting a ticket somebody offered you.
 *
 * ## Why there is a form here rather than a link in the email
 *
 * The invitation is a bearer secret. A link carrying it would put it in the
 * browser's history, in the `Referer` header of whatever page loaded next, in
 * every proxy's access log along the way, and in any screenshot of the address
 * bar — and it would still be there after the invitation had been used. So the
 * code arrives out of band — shown once to the sender, who passes it on, or,
 * where the site's operator has set up a mail server, emailed to the address
 * it was offered to, never in a link — and is pasted into a field, and this
 * route accepts no query parameter that could carry one. The page says which,
 * from the delivery mode the session (`GET /v1/auth/me`) reports.
 *
 * The server holds only the code's digest. It has never held the code.
 *
 * @module app/tickets/accept/page
 */

import Link from 'next/link'

import { TicketTransferResponse } from '../../../components/ticket-transfer-actions.jsx'
import { readSession } from '../../../lib/session.js'

/**
 * How the code reaches the person it was offered to, per delivery mode.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HOW_THE_CODE_ARRIVES = Object.freeze({
  MANUAL:
    'The person offering you the ticket gives you the code themselves: codes are not emailed from this site.',
  EMAIL: 'The code is emailed to the address the ticket was offered to.',
})

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Accept a ticket', robots: { index: false, follow: false } }

/**
 * The accept screen.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function AcceptTransferPage() {
  const session = await readSession()
  const arrives = HOW_THE_CODE_ARRIVES[session?.deliveryMode] ?? null

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Your account
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Accept a ticket</h1>
      <p className="mt-2 text-ink-muted">
        Somebody has offered you a ticket. Accepting puts the ticket in this account and stops the
        sender’s pass working; declining leaves it with them. A reserved seat goes with its ticket.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        {arrives ? `${arrives} ` : null}
        Sign in with the address the ticket was offered to, then paste the code below.{' '}
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
