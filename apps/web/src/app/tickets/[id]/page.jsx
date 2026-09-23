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
 * ## The pass, only when asked, only to the holder
 *
 * The page is rendered without the pass. The holder of a ticket that still
 * admits can ask for it, and `TicketPass` fetches it from the holder-only,
 * `no-store` endpoint and draws it as a QR code on this device — the text of
 * the credential never reaches the markup. The organiser reading the same page
 * is never offered it.
 *
 * ## What never appears on it
 *
 * Any invitation code, and the credential as text. An invitation code is a
 * bearer secret and lives in exactly one place — the message sent to the
 * person it was offered to. The server decides how much of a recipient's
 * address this page gets: the domain alone, as `••••@example.com`, for the
 * holder who sent the offer, and `Hidden email` for an organiser, who does not
 * need it. Nothing of the local part reaches the page, so no stylesheet is
 * doing the hiding.
 *
 * @module app/tickets/id/page
 */

import { HIDDEN_EMAIL } from '@desi-event/schemas'
import Link from 'next/link'

import { TicketPass } from '../../../components/ticket-pass.jsx'
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
        <h1 className="mt-3 text-2xl font-bold text-ink">Ticket</h1>
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

      <h1 className="mt-3 text-2xl font-bold text-ink">{event.title}</h1>
      <p className="mt-1 text-ink-muted">
        <time dateTime={event.startsAt}>{event.startsAt}</time> · {event.timezone}
      </p>
      <AsOf asOf={new Date().toISOString()} />

      <section aria-labelledby="status-heading" className="mt-8">
        <h2 id="status-heading" className="text-lg font-semibold text-ink">
          Where it stands
        </h2>
        <p
          className={`mt-3 rounded-card border p-4 text-sm ${
            status.admits
              ? 'border-status-success/25 bg-status-success-soft text-status-success'
              : 'border-line-strong bg-surface-subtle text-ink'
          }`}
        >
          {/* The word, not only the colour. */}
          <strong>{status.admits ? 'Admits' : 'Does not admit'}.</strong> {status.label}
        </p>

        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Reference</dt>
            <dd className="font-mono text-ink">{ticket.code}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Name on it</dt>
            <dd className="text-ink">{ticket.attendeeName ?? 'Not given'}</dd>
          </div>
          {ticket.checkedInAt ? (
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-muted">Admitted</dt>
              <dd className="text-ink">
                <time dateTime={ticket.checkedInAt}>{ticket.checkedInAt}</time>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {holder && status.admits ? (
        <section aria-labelledby="pass-heading" className="mt-8">
          <h2 id="pass-heading" className="text-lg font-semibold text-ink">
            Your entry pass
          </h2>
          <TicketPass ticketId={ticket.id} />
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="text-lg font-semibold text-ink">
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
              <li
                key={transfer.id}
                className="rounded-card border border-line bg-surface-raised p-4"
              >
                <p className="font-medium text-ink">
                  {TRANSFER_STATUS[transfer.status] ?? transfer.status}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {transfer.toEmailMasked === HIDDEN_EMAIL
                    ? 'Offered on '
                    : `Offered to ${transfer.toEmailMasked} on `}
                  <time dateTime={transfer.createdAt}>{transfer.createdAt}</time>.
                  {transfer.status === 'PENDING' ? (
                    <>
                      {' '}
                      Expires <time dateTime={transfer.expiresAt}>{transfer.expiresAt}</time>.
                    </>
                  ) : null}
                </p>
                {transfer.resultTicketId ? (
                  <p className="mt-1 text-sm text-ink-muted">
                    It became{' '}
                    <Link
                      href={`/tickets/${transfer.resultTicketId}`}
                      className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
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
        <p className="mt-3 text-sm text-ink-muted">
          {holder
            ? 'Only the part of an address after the @ is shown, so nobody else who opens this page can collect it.'
            : 'Who a ticket was offered to is not shown here: whether it should still admit does not depend on it.'}
        </p>
      </section>

      <section aria-labelledby="actions-heading" className="mt-8">
        <h2 id="actions-heading" className="text-lg font-semibold text-ink">
          What you can do
        </h2>
        {/* Transfers carry only what the component reads: everything passed to a
            client component is serialised into the page, recipients included. */}
        <TicketTransferActions
          ticket={ticket}
          transfers={transfers.map(({ id, status }) => ({ id, status }))}
          holder={holder}
          mayRevoke={mayRevoke}
          transferBlockedReason={transferBlockedReason ?? null}
        />
      </section>

      <p className="mt-8 text-sm">
        <Link
          href="/tickets"
          className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          Back to my tickets
        </Link>
      </p>
    </div>
  )
}
