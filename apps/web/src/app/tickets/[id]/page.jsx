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
import { AsOf, Breadcrumbs, Empty, Forbidden } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { PANEL, PosterThumb, Section, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { formatEventWhen, formatTimeZoneLabel } from '../../../lib/format.js'
import { getTicket } from '../../../lib/organizer-api.js'
import { describeApiRefusal } from '../../../lib/refusal.js'
import { readSession, sessionCan } from '../../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Ticket', robots: { index: false, follow: false } }

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
    const { state } = describeApiRefusal(error)

    // Refused and missing alike; a missing second factor is neither.
    if (state === 'permission-denied' || state === 'not-found') {
      return <Forbidden area="This ticket" backHref="/tickets" backLabel="Back to my tickets" />
    }

    failure = error
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
        <h1 className="mt-4 text-h2 font-semibold text-ink">Ticket</h1>
        <ReadRefusal error={failure} what="This ticket" action="see this ticket" />
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

      {/* The event's poster beside its title, so the ticket page and the
          wallet card it was opened from look like the same night. Decoration:
          the heading names the event. */}
      <div className={`mt-4 flex flex-col overflow-hidden sm:flex-row ${PANEL}`}>
        <PosterThumb event={event} className="h-32 sm:h-auto sm:w-56" />
        <div className="min-w-0 flex-1 p-5 sm:p-6">
          <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
            Ticket
          </p>
          <h1 className="mt-2 text-h2 font-semibold text-ink">{event.title}</h1>
          <p className="mt-2 text-ink-muted">
            {/* The event's own clock, zone named, as every other account page
                writes it; this used to print the raw UTC timestamp beside the
                zone's name, which reads as a local time and is not one. */}
            <time dateTime={event.startsAt}>{formatEventWhen(event)}</time> ·{' '}
            {formatTimeZoneLabel(event)}
          </p>
          <AsOf asOf={new Date().toISOString()} />
        </div>
      </div>

      <Section id="status-heading" title="Where it stands">
        <p
          className={`mt-4 rounded-card border p-4 text-sm ${
            status.admits
              ? 'border-status-success/25 bg-status-success-soft text-status-success'
              : 'border-line-strong bg-surface-subtle text-ink'
          }`}
        >
          {/* The word, not only the colour. */}
          <strong>{status.admits ? 'Admits' : 'Does not admit'}.</strong> {status.label}
        </p>

        <dl className={`mt-4 grid grid-cols-1 gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-3 ${PANEL}`}>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-ink-subtle">Reference</dt>
            <dd className="mt-0.5 font-mono text-ink">{ticket.code}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-ink-subtle">Name on it</dt>
            <dd className="mt-0.5 break-words text-ink">{ticket.attendeeName ?? 'Not given'}</dd>
          </div>
          {ticket.checkedInAt ? (
            <div className="min-w-0">
              <dt className="text-xs font-medium text-ink-subtle">Admitted</dt>
              <dd className="mt-0.5 text-ink">
                <time dateTime={ticket.checkedInAt}>{ticket.checkedInAt}</time>
              </dd>
            </div>
          ) : null}
        </dl>
      </Section>

      {holder && status.admits ? (
        // `entry-pass` is where the wallet's "Show my entry pass" link lands.
        <Section id="entry-pass" title="Your entry pass">
          <TicketPass ticketId={ticket.id} />
        </Section>
      ) : null}

      <Section id="history-heading" title="Where it has been">
        {transfers.length === 0 ? (
          <Empty
            title="Never handed on"
            description="This ticket has stayed with whoever bought it."
          />
        ) : (
          <ol className="mt-4 space-y-3">
            {transfers.map((transfer) => (
              <li key={transfer.id} className={`p-4 ${PANEL}`}>
                <p className="font-semibold text-ink">
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
                    <Link href={`/tickets/${transfer.resultTicketId}`} className={TEXT_LINK}>
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
      </Section>

      <Section id="actions-heading" title="What you can do">
        {/* Transfers carry only what the component reads: everything passed to a
            client component is serialised into the page, recipients included. */}
        <TicketTransferActions
          ticket={ticket}
          transfers={transfers.map(({ id, status }) => ({ id, status }))}
          holder={holder}
          mayRevoke={mayRevoke}
          transferBlockedReason={transferBlockedReason ?? null}
        />
      </Section>

      <p className="mt-10 text-sm">
        <Link href="/tickets" className={TEXT_LINK}>
          Back to my tickets
        </Link>
      </p>
    </div>
  )
}
