/**
 * The tickets somebody holds.
 *
 * No pass is here, and there is no pass on the detail screen either. A
 * credential is derived at the moment a ticket is issued or accepted and handed
 * over once; a list that returned one would put it in every cache between the
 * server and the phone, and a list that *showed* one would put it in every
 * screenshot.
 *
 * @module app/tickets/page
 */

import Link from 'next/link'

import { Empty, Failure } from '../../components/page-state.jsx'
import { getMyTickets } from '../../lib/organizer-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * How each status reads to the person holding the ticket.
 *
 * @type {Readonly<Record<string, string>>}
 */
const STATUS = Object.freeze({
  VALID: 'Ready to use',
  TRANSFER_PENDING: 'Offered to somebody — still yours until they accept',
  TRANSFERRED: 'Handed on. This one no longer admits anybody',
  CHECKED_IN: 'Used — you went in',
  REVOKED: 'Withdrawn by the organiser',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
  SUPERSEDED: 'Replaced by a newer ticket',
  VOID: 'Void',
})

/**
 * The list.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function MyTicketsPage() {
  let tickets = []
  let failure = null

  try {
    ;({ tickets } = await getMyTickets())
  } catch (error) {
    failure = error?.message ?? null
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-indigo-night-900">My tickets</h1>
      <p className="mt-2 text-slate-700">
        Everything issued to this account. Open one to show it at the door, hand it on, or see where
        it has been.
      </p>

      {failure ? <Failure what="Your tickets" detail={failure} /> : null}

      {!failure && tickets.length === 0 ? (
        <Empty
          title="No tickets yet"
          description="Anything you buy, or anything somebody hands to you, appears here."
        />
      ) : null}

      {tickets.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {tickets.map((ticket) => (
            <li
              key={ticket.id}
              className="rounded-card border border-slate-200 bg-white p-4 focus-within:ring-2 focus-within:ring-marigold-500"
            >
              <p className="font-medium text-indigo-night-900">
                <Link
                  href={`/tickets/${ticket.id}`}
                  className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                >
                  {ticket.attendeeName ?? 'Ticket'}{' '}
                  <span className="font-mono text-sm text-slate-600">{ticket.code}</span>
                </Link>
              </p>
              <p className="mt-1 text-sm text-slate-700">
                {STATUS[ticket.status] ?? ticket.status}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
