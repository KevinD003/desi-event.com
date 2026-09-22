/**
 * One ticket, and everywhere it has been.
 *
 * ## Two readers
 *
 * The person holding it, asking whether it still gets them in and offering it
 * to somebody if it does. The organiser, asking whether it should still admit
 * anybody. The API decides which of the two is asking and refuses everybody
 * else; this page renders what came back and asks a scoped capability — with
 * the organisation the payload named — to decide whether to offer withdrawal.
 *
 * ## What never appears on it
 *
 * The pass, and any invitation code. A credential is derived once and handed
 * over once; a screen that displayed one would put it in a screenshot, and a
 * screenshot of a QR code is a ticket. An invitation code is a bearer secret
 * and lives in exactly one place — the message sent to the person it was
 * offered to. Recipient addresses are masked: enough to recognise who you sent
 * it to, not enough for anybody else to harvest.
 *
 * @module app/tickets/id/page
 */

import Link from 'next/link'

import { TicketTransferActions } from '../../../components/ticket-transfer-actions.jsx'
import { AsOf, Breadcrumbs, Empty, Failure, Forbidden } from '../../../components/page-state.jsx'
import { getTicket } from '../../../lib/organizer-api.js'
import { readSession, sessionCan } from '../../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * What each ticket status means, and whether it still admits anybody.
 *
 * @type {Readonly<Record<string, {label: string, admits: boolean}>>}
 */
const STATUS = Object.freeze({
  VALID: { label: 'Ready to use.', admits: true },
  TRANSFER_PENDING: {
    label: 'Offered to somebody. It is still yours and still admits you until they accept.',
    admits: true,
  },
  CHECKED_IN: { label: 'Already used — somebody went in on it.', admits: false },
  TRANSFERRED: {
    label:
      'Handed on. The pass that went with it stopped working the moment the transfer completed.',
    admits: false,
  },
  REVOKED: { label: 'Withdrawn by the organiser. It admits nobody.', admits: false },
  REFUNDED: { label: 'Refunded. It admits nobody.', admits: false },
  CANCELLED: { label: 'Cancelled. It admits nobody.', admits: false },
  SUPERSEDED: { label: 'Replaced by a newer ticket.', admits: false },
  VOID: { label: 'Void. It admits nobody.', admits: false },
})

/**
 * How each transfer status reads.
 *
 * @type {Readonly<Record<string, string>>}
 */
const TRANSFER_STATUS = Object.freeze({
  PENDING: 'Offered, not yet answered',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  CANCELLED: 'Withdrawn by the sender',
  EXPIRED: 'Expired unanswered',
})

/**
 * @typedef {object} TicketDetailProps
 * @property {Promise<{id: string}>} params The route parameters.
 */

/**
 * The ticket detail screen.
 *
 * @param {TicketDetailProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered screen.
 */
export default async function TicketDetailPage({ params }) {
  const { id } = await params
  const session = await readSession()

  let detail = null
  let failure = null

  try {
    detail = await getTicket(id)
  } catch (error) {
    if (error?.status === 403 || error?.status === 404) {
      return <Forbidden area="This ticket" backHref="/tickets" backLabel="Back to my tickets" />
    }

    failure = error?.message ?? null
  }

  if (!detail) {
    return (
      <div>
        <Breadcrumbs
          trail={[
            { href: '/tickets', label: 'My tickets' },
            { href: null, label: 'Ticket' },
          ]}
        />
        <h1 className="mt-3 text-2xl font-bold text-indigo-night-900">Ticket</h1>
        <Failure what="This ticket" detail={failure} />
      </div>
    )
  }

  const { ticket, event, transfers, holder, organizationId, transferBlockedReason } = detail
  const status = STATUS[ticket.status] ?? { label: ticket.status, admits: false }
  // Scoped, with the organisation the payload named. Asked without one this
  // would be a platform question, which is how NF-05 gets in.
  const mayRevoke = sessionCan(session, 'ticket:revoke', organizationId) && status.admits

  return (
    <div>
      <Breadcrumbs
        trail={[
          { href: '/tickets', label: 'My tickets' },
          { href: null, label: ticket.code },
        ]}
      />

      <h1 className="mt-3 text-2xl font-bold text-indigo-night-900">{event.title}</h1>
      <p className="mt-1 text-slate-700">
        <time dateTime={event.startsAt}>{event.startsAt}</time> · {event.timezone}
      </p>
      <AsOf asOf={new Date().toISOString()} />

      <section aria-labelledby="status-heading" className="mt-8">
        <h2 id="status-heading" className="text-lg font-semibold text-indigo-night-900">
          Where it stands
        </h2>
        <p
          className={`mt-3 rounded-card border p-4 text-sm ${
            status.admits
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-slate-300 bg-slate-50 text-slate-800'
          }`}
        >
          {/* The word, not only the colour. */}
          <strong>{status.admits ? 'Admits' : 'Does not admit'}.</strong> {status.label}
        </p>

        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="text-slate-600">Reference</dt>
            <dd className="font-mono text-indigo-night-900">{ticket.code}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-slate-600">Name on it</dt>
            <dd className="text-indigo-night-900">{ticket.attendeeName ?? 'Not given'}</dd>
          </div>
          {ticket.checkedInAt ? (
            <div className="flex flex-wrap gap-2">
              <dt className="text-slate-600">Admitted</dt>
              <dd className="text-indigo-night-900">
                <time dateTime={ticket.checkedInAt}>{ticket.checkedInAt}</time>
              </dd>
            </div>
          ) : null}
        </dl>

        <p className="mt-3 text-sm text-slate-600">
          The pass itself is not shown here. It is handed over once, when the ticket is issued or
          accepted — a pass on a page is a pass in a screenshot, and a screenshot of one is a
          ticket.
        </p>
      </section>

      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="text-lg font-semibold text-indigo-night-900">
          Where it has been
        </h2>
        {transfers.length === 0 ? (
          <Empty
            title="Never handed on"
            description="This ticket has stayed with whoever bought it."
          />
        ) : (
          <ol className="mt-3 space-y-3">
            {transfers.map((transfer) => (
              <li key={transfer.id} className="rounded-card border border-slate-200 bg-white p-4">
                <p className="font-medium text-indigo-night-900">
                  {TRANSFER_STATUS[transfer.status] ?? transfer.status}
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  Offered to {transfer.toEmailMasked} on{' '}
                  <time dateTime={transfer.createdAt}>{transfer.createdAt}</time>.
                  {transfer.status === 'PENDING' ? (
                    <>
                      {' '}
                      Expires <time dateTime={transfer.expiresAt}>{transfer.expiresAt}</time>.
                    </>
                  ) : null}
                </p>
                {transfer.resultTicketId ? (
                  <p className="mt-1 text-sm text-slate-700">
                    It became{' '}
                    <Link
                      href={`/tickets/${transfer.resultTicketId}`}
                      className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                    >
                      a new ticket
                    </Link>
                    , which is the one that admits anybody now.
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-sm text-slate-600">
          Addresses are shortened on purpose: enough to recognise who you sent it to, not enough for
          anybody else to collect them.
        </p>
      </section>

      <section aria-labelledby="actions-heading" className="mt-8">
        <h2 id="actions-heading" className="text-lg font-semibold text-indigo-night-900">
          What you can do
        </h2>
        <TicketTransferActions
          ticket={ticket}
          transfers={transfers}
          holder={holder}
          mayRevoke={mayRevoke}
          transferBlockedReason={transferBlockedReason ?? null}
        />
      </section>

      <p className="mt-8 text-sm">
        <Link
          href="/tickets"
          className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
        >
          Back to my tickets
        </Link>
      </p>
    </div>
  )
}
