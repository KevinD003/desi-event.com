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
 * ## A ticket booked to pay at the door
 *
 * Its holder reads, under "Where it stands", what it owes at the door, or that
 * it was cancelled because it was not paid for, or that money they paid at
 * the door is with the organiser (`VenuePaymentNote`, SPEC3-XI §12.7). An
 * organiser reading the same ticket is not addressed by those sentences and
 * is not shown them.
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

import { EventChangesList } from '../../../components/event-changes-list.jsx'
import { TicketObject } from '../../../components/ticket-object.jsx'
import { TicketPass, VenuePaymentNote } from '../../../components/ticket-pass.jsx'
import {
  TicketStanding,
  TicketStandingChip,
  TicketStandingProvider,
} from '../../../components/ticket-standing.jsx'
import { TicketTransferActions } from '../../../components/ticket-transfer-actions.jsx'
import { Breadcrumbs, Empty, Forbidden } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { Section, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { deletedForHolder } from '../../../lib/event-control.js'
import { formatEventWhen, formatInstantIn, formatTimeZoneLabel } from '../../../lib/format.js'
import { isEventDay } from '../../../lib/wallet.js'
import { getTicket } from '../../../lib/organizer-api.js'
import { describeApiRefusal } from '../../../lib/refusal.js'
import { readSession, sessionCan } from '../../../lib/session.js'
import { joinLinkHost, sessionDisplayLabel } from '../../../lib/sessions.js'

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
  CANCELLED: { label: 'Withdrawn — this ticket no longer works at the door.', admits: false },
  SUPERSEDED: { label: 'Replaced by a newer ticket.', admits: false },
  VOID: { label: 'Void. It admits nobody.', admits: false },
})

/**
 * How each transfer status reads.
 *
 * @type {Readonly<Record<string, string>>}
 */
const TRANSFER_STATUS = Object.freeze({
  PENDING: 'Offered, awaiting an answer',
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

  const { ticket, event, transfers, holder, organizationId } = detail
  // The server gives the joining link to the holder only, and only while the
  // ticket admits; the page shows it only then too.
  const joinUrl = holder && detail.onlineJoinUrl ? detail.onlineJoinUrl : null
  const joinHost = joinUrl ? joinLinkHost(joinUrl) : null
  const status = STATUS[ticket.status] ?? { label: ticket.status, admits: false }
  // Scoped, with the organisation the payload named. Asked without one this
  // would be a platform question, which is how NF-05 gets in.
  const mayRevoke = sessionCan(session, 'ticket:revoke', organizationId) && status.admits
  const zone = event.timezone ?? 'UTC'
  // The day the ticket is for, at the venue: the face says "Today" and a gold
  // keyline is drawn round it once.
  const today = isEventDay(
    { admits: status.admits, event, session: detail.session ?? null },
    new Date(),
  )
  const night = detail.session ?? null

  return (
    <TicketStandingProvider>
      <Breadcrumbs
        trail={[
          { href: '/tickets', label: 'My tickets' },
          { href: null, label: ticket.code },
        ]}
      />

      {/* The ticket itself: what it is on the face, the pass on the stub. */}
      <TicketObject
        className="mt-4"
        eventDay={today}
        muted={!status.admits}
        stubClassName="md:w-80"
        face={
          <>
            <div className="flex flex-wrap items-center gap-2">
              {today ? (
                <span className="inline-flex min-h-6 items-center rounded-plate bg-celebration px-2 text-micro font-bold text-highlight-ink uppercase">
                  Today
                </span>
              ) : null}
              <TicketStandingChip admits={status.admits} />
            </div>
            <h1 className="mt-3 font-display text-h1 font-bold text-balance text-ticket-ink">
              {event.title}
            </h1>
            <p className="mt-3 text-label text-ticket-ink">
              {/* The event's own clock, zone named, as every other account
                  page writes it. */}
              <time dateTime={event.startsAt}>{formatEventWhen(event)}</time> ·{' '}
              {formatTimeZoneLabel(event)}
            </p>

            <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-caption font-medium text-ink-muted">Reference</dt>
                <dd className="mt-0.5 font-mono text-label font-semibold">{ticket.code}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-caption font-medium text-ink-muted">Name on it</dt>
                <dd className="mt-0.5 text-label font-semibold break-words">
                  {ticket.attendeeName ?? 'Not given'}
                </dd>
              </div>
              {night ? (
                <div className="min-w-0">
                  <dt className="text-caption font-medium text-ink-muted">Night</dt>
                  <dd className="mt-0.5 text-label font-semibold">{sessionDisplayLabel(night)}</dd>
                </div>
              ) : null}
              {ticket.checkedInAt ? (
                <div className="min-w-0">
                  <dt className="text-caption font-medium text-ink-muted">Admitted</dt>
                  <dd className="mt-0.5 text-label font-semibold">
                    <time dateTime={ticket.checkedInAt}>
                      {formatInstantIn(ticket.checkedInAt, zone)}
                    </time>
                  </dd>
                </div>
              ) : null}
            </dl>
          </>
        }
        stub={
          holder && status.admits ? (
            // `entry-pass` is where the wallet's "Show my entry pass" link lands.
            <section aria-labelledby="entry-pass" className="flex flex-col pt-2 md:pt-0 md:pl-2">
              <h2 id="entry-pass" className="font-display text-h3 font-bold text-ticket-ink">
                Your entry pass
              </h2>
              <TicketPass ticketId={ticket.id} />
            </section>
          ) : (
            <div className="flex flex-col gap-2 pt-2 md:pt-0 md:pl-2">
              <p className="font-display text-h3 font-bold text-ticket-ink">
                {holder ? 'No pass' : 'Pass'}
              </p>
              <p className="text-caption text-ink-muted">
                {holder
                  ? 'This ticket does not admit anybody now, so there is no pass to show.'
                  : 'Only the person holding a ticket can see its pass.'}
              </p>
            </div>
          )
        }
      />

      {event.status === 'DELETED' ? (
        <p className="mt-6 max-w-prose rounded-card border border-status-danger/25 bg-status-danger-soft p-4 text-sm text-ink">
          {deletedForHolder(
            (detail.eventChanges ?? []).find((notice) => notice.kind === 'DELETED') ?? null,
          )}{' '}
          It is no longer on the site, and this ticket no longer works at the door.
        </p>
      ) : null}

      {(detail.eventChanges ?? []).length > 0 ? (
        <div className="mt-8">
          <EventChangesList
            notices={detail.eventChanges}
            timeZone={zone}
            sessions={detail.session ? [detail.session] : []}
          />
        </div>
      ) : null}

      <Section id="status-heading" title="Where it stands">
        <TicketStanding admits={status.admits} label={status.label} />

        {/* A ticket booked to pay at the door says, to its holder, what it
            owes there, that it was cancelled because it was not paid for, or
            that money they paid at the door is the organiser's to return
            (SPEC3-XI §12.7). Dates in the event's own zone, as every account
            page writes them; the ticket row does not carry its event, so the
            zone comes from the page's. Only what the note reads crosses to the
            client. */}
        {holder ? (
          <VenuePaymentNote
            ticket={{ status: ticket.status, venuePayment: ticket.venuePayment ?? null }}
            timeZone={zone}
          />
        ) : null}
      </Section>

      {joinUrl && joinHost ? (
        <Section id="join-heading" title="Join the online event">
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            The organiser’s joining link, for you as the holder of this ticket. Keep it to yourself:
            anybody with the link can use it.
          </p>
          <p className="mt-3">
            <a
              href={joinUrl}
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className={TEXT_LINK}
            >
              Join online at {joinHost}
            </a>
          </p>
        </Section>
      ) : null}

      <Section id="history-heading" title="Where it has been">
        {transfers.length === 0 ? (
          <Empty
            title="Never handed on"
            description="This ticket has stayed with whoever bought it."
          />
        ) : (
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {transfers.map((transfer) => (
              <li key={transfer.id} className="py-4">
                <p className="font-semibold text-ink">
                  {TRANSFER_STATUS[transfer.status] ?? transfer.status}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {transfer.toEmailMasked === HIDDEN_EMAIL
                    ? 'Offered on '
                    : `Offered to ${transfer.toEmailMasked} on `}
                  <time dateTime={transfer.createdAt}>
                    {formatInstantIn(transfer.createdAt, zone)}
                  </time>
                  .
                  {transfer.status === 'PENDING' ? (
                    <>
                      {' '}
                      Expires{' '}
                      <time dateTime={transfer.expiresAt}>
                        {formatInstantIn(transfer.expiresAt, zone)}
                      </time>
                      .
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
          deliveryMode={
            session?.deliveryMode === 'EMAIL' || session?.deliveryMode === 'MANUAL'
              ? session.deliveryMode
              : null
          }
        />
      </Section>

      <p className="mt-10 text-sm">
        <Link href="/tickets" className={TEXT_LINK}>
          Back to my tickets
        </Link>
      </p>
    </TicketStandingProvider>
  )
}
