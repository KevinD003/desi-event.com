/**
 * The door, and the ticket's life around it.
 *
 * ## Scanning
 *
 * A pass is the primary key at the door. `credential` is the bearer secret
 * inside the QR code; the server hashes it and looks the digest up, so a
 * database that leaks does not leak passes and a scanner never sends a
 * guessable identifier. `code` — the printed reference — is the fallback for a
 * pass that will not scan, and it is deliberately the fallback: the schema says
 * it "admits nobody by itself", and it is accepted only from somebody who
 * already holds `ticket:check_in` in the organisation that owns the event.
 *
 * ## Idempotence
 *
 * A door scanner on venue Wi-Fi retries. A steward scans the same pass twice
 * because the first beep was drowned out. Neither must produce a second
 * check-in, and neither must stall the queue with an error the steward has to
 * think about.
 *
 * So a re-scan is a no-op that reports itself: the response carries the
 * **original** `checkedInAt` and `alreadyCheckedIn: true`, which is what a
 * scanner app shows as "already admitted at 19:42". Exactly one `CheckIn` row
 * is ever written per ticket, and its unique index is what makes that true when
 * two scanners race rather than merely when one retries.
 *
 * A ticket that was refunded, revoked, transferred away or cancelled is a
 * different matter — those are 409s, because letting that person in is wrong
 * rather than redundant.
 *
 * ## Transfers
 *
 * Offering, accepting, declining and withdrawing. The reasoning lives in
 * `../lib/tickets.js`; what is here is who may do each one.
 *
 * @module @desi-event/api/routes/tickets
 */

import { isSuppressible } from '@desi-event/notifications'
import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { conflict, databaseErrorCode, forbidden, notFound, unprocessable } from '../lib/errors.js'
import { generateTicketCode } from '../lib/identifiers.js'
import { passRateLimit } from '../plugins/rate-limit.js'
import { credentialMatches, mintTicketCredential } from '../lib/ticket-credentials.js'
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { WALLET_INCLUDE, maskRecipient, toWalletTicket } from '../lib/presenters.js'
import {
  TICKET_STATES,
  TRANSFER_TTL_HOURS,
  acceptTransfer,
  admissionRefusal,
  admit,
  assertHolds,
  endTransfer,
  findTicketForScan,
  loadTransferByToken,
  mintTransferToken,
  revokeTicket,
  startTransfer,
  transferTokenDigest,
} from '../lib/tickets.js'
import { defineRoute } from '../lib/register.js'

/** Everything a scan needs in order to authorise itself. */
const TICKET_INCLUDE = Object.freeze({
  orderItem: { include: { order: { include: { event: true } } } },
})

/**
 * One transfer, as either party sees it.
 *
 * The token is never here. It goes in the invitation link once and the database
 * holds only its digest; echoing it would put a bearer secret in a browser
 * cache, a proxy log and a screenshot.
 *
 * @param {object} row A `TicketTransfer` row.
 * @returns {object} A payload satisfying `ticketTransferSchema`.
 */
function toTicketTransfer(row) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    fromUserId: row.fromUserId ?? null,
    toEmailMasked: maskRecipient(row.toEmail),
    status: row.status,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt ?? null,
    declinedAt: row.declinedAt ?? null,
    cancelledAt: row.cancelledAt ?? null,
    resultTicketId: row.resultTicketId ?? null,
    createdAt: row.createdAt,
  }
}

/**
 * Register the ticket routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.env The parsed API environment.
 * @param {function(object): Promise<void>} [deps.deliver] Where a single-use link is sent.
 * @param {{max?: number, timeWindow?: string|number}} [deps.passLimit] Overrides for the admission-pass rate limit; supplied by tests.
 * @returns {void} Nothing.
 */
export function registerTicketRoutes(app, { prisma, env, deliver, passLimit }) {
  defineRoute(app, 'tickets.checkIn', {
    handler: async (request) => {
      const { credential, code, eventId, eventSessionId, checkedInAt, deviceId, gate } =
        request.body
      const now = checkedInAt ? new Date(checkedInAt) : new Date()

      const ticket = await findTicketForScan(prisma, {
        credential,
        code,
        include: TICKET_INCLUDE,
      })

      // The same answer for a pass that names nothing and a pass that is not a
      // pass. Distinguishing them would turn the endpoint into an oracle for
      // whether a guessed credential named something real.
      if (!ticket) throw notFound('No ticket with that pass.')

      const order = ticket.orderItem?.order
      const event = order?.event

      if (!event) throw notFound('No ticket with that pass.')

      assertCan(request.actor, CAPABILITIES.TICKET_CHECK_IN, {
        organizationId: event.organizationId,
      })

      if (eventId && eventId !== event.id) {
        throw conflict('This ticket belongs to a different event.', {
          ticketEventId: event.id,
          scannedEventId: eventId,
        })
      }

      const refusal = admissionRefusal(ticket, order)

      if (refusal) throw conflict(refusal, { status: ticket.status })

      // There is no `force`. It used to re-stamp `checkedInAt`, and with a
      // `CheckIn` row that is unique per ticket the only thing it could mean
      // now is "rewrite the admission record" — and a record that whoever is
      // holding the scanner can rewrite is not a record. A correction is a
      // different action with a different audit trail, not a boolean on a scan.
      if (ticket.status === TICKET_STATES.CHECKED_IN) {
        request.log.info(
          { ticketCode: ticket.code, deviceId, checkedInAt: ticket.checkedInAt },
          'duplicate check-in ignored',
        )

        return {
          data: {
            ticket: stripRelations(ticket),
            alreadyCheckedIn: true,
            checkedInAt: ticket.checkedInAt,
            attendeeName: ticket.attendeeName ?? null,
          },
        }
      }

      const outcome = await prisma
        .$transaction((tx) =>
          admit(tx, {
            ticket,
            eventSessionId: eventSessionId ?? order.eventSessionId ?? null,
            scannedByUserId: request.actor.id,
            // What the scanner calls itself, recorded in the audit trail and
            // not in `CheckIn.deviceId` — that column is a foreign key to a
            // device this system issued, and a string from the field is not one.
            scannerId: deviceId ?? null,
            gate: gate ?? null,
            now,
          }),
        )
        .catch(async (error) => {
          // Two ways the database refuses a racing scan, and both are ordinary
          // at a door with a queue behind it:
          //
          //   - `P2002`, the `CheckIn` unique index: somebody else admitted
          //     this ticket between the read and the write.
          //   - `P0001`, `desi_check_in_ticket_admissible`: the ticket's status
          //     moved between the read and the insert. The trigger is a BEFORE
          //     INSERT, so it fires before the index does and this is the more
          //     likely of the two.
          //
          // Neither is a 500. The load suite found the second one at a 1.7%
          // error rate under sixteen concurrent scanners, which is a real
          // failure at a real door and is exactly what that suite is for.
          //
          // What it becomes depends on what the ticket now *is*, re-read rather
          // than assumed: already admitted is a duplicate and answers 200, and
          // anything else is a refusal that the person scanning needs to see.
          // Read from wherever Prisma put it. A trigger's `P0001` is nested
          // under the driver adapter's cause and the outer code is Prisma's
          // own — checking only the outer one is how this reached a door as a
          // 500 in the first place.
          const code = databaseErrorCode(error)

          if (code !== 'P2002' && code !== 'P0001') throw error

          const current = await prisma.ticket.findUnique({ where: { id: ticket.id } })

          if (current?.status !== TICKET_STATES.CHECKED_IN) {
            throw conflict(
              admissionRefusal(current ?? ticket, order) ??
                'That ticket changed while it was being scanned. Scan it again.',
              { status: current?.status ?? ticket.status },
            )
          }

          return { admitted: false, checkIn: null }
        })

      const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

      request.log.info(
        { ticketCode: after.code, eventId: event.id, deviceId, admitted: outcome.admitted },
        outcome.admitted ? 'ticket checked in' : 'ticket was already in',
      )

      return {
        data: {
          ticket: after,
          alreadyCheckedIn: !outcome.admitted,
          checkedInAt: after.checkedInAt,
          attendeeName: after.attendeeName ?? null,
        },
      }
    },
  })

  defineRoute(app, 'tickets.listMine', {
    handler: async (request) => {
      const { page, perPage, eventId, status } = request.query
      const { skip, take } = toSkipTake({ page, perPage })

      const where = {
        ownerUserId: request.actor.id,
        ...(status ? { status } : {}),
        ...(eventId ? { orderItem: { order: { eventId } } } : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.ticket.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take,
          include: WALLET_INCLUDE,
        }),
        prisma.ticket.count({ where }),
      ])

      return {
        // `where` already scopes every row to this account. The presenter is
        // told who is reading anyway, because whether an order reference is
        // theirs to see is a question about the reader, and a presenter that
        // infers the reader from the query that fetched the rows is one filter
        // away from being wrong.
        data: rows.map((row) => toWalletTicket(row, { viewerUserId: request.actor.id })),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'tickets.get', {
    handler: async (request) => {
      const ticket = await prisma.ticket.findUnique({
        where: { id: request.params.id },
        include: TICKET_INCLUDE,
      })

      if (!ticket) throw notFound('No such ticket.')

      const event = ticket.orderItem?.order?.event

      if (!event) throw notFound('No such ticket.')

      // Two readers, two questions, one branch. The person holding it asks
      // whether it still admits them; the organiser asks whether it still
      // should. Anybody else is told what somebody guessing identifiers is
      // told, which is nothing.
      const holder = Boolean(ticket.ownerUserId) && ticket.ownerUserId === request.actor.id

      if (!holder) {
        assertCan(request.actor, CAPABILITIES.TICKET_REVOKE, {
          organizationId: event.organizationId,
        })
      }

      const transfers = await prisma.ticketTransfer.findMany({
        where: { ticketId: ticket.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })

      return {
        data: {
          ticket: stripRelations(ticket),
          event: {
            id: event.id,
            slug: event.slug,
            title: event.title,
            startsAt: event.startsAt,
            timezone: event.timezone,
            status: event.status,
          },
          organizationId: event.organizationId,
          holder,
          transfers: transfers.map(toTicketTransfer),
        },
      }
    },
  })

  defineRoute(app, 'tickets.pass', {
    config: { rateLimit: passRateLimit(passLimit) },
    handler: async (request, reply) => {
      const ticket = await prisma.ticket.findUnique({
        where: { id: request.params.id },
        include: TICKET_INCLUDE,
      })

      // `assertHolds` answers 404 rather than 403 for somebody who is not the
      // holder, which is what makes this endpoint useless as an oracle: a
      // ticket that exists and is not yours reads exactly like one that does
      // not exist. An organiser gets the same answer as a stranger, because
      // `ticket:revoke` is the power to withdraw a ticket, not to be admitted
      // on it, and a pass is the one thing on a ticket nobody but its holder
      // has any business reading.
      if (!ticket) throw notFound('No such ticket.')

      assertHolds(request.actor, ticket)

      const order = ticket.orderItem?.order ?? null
      const refusal = admissionRefusal(ticket, order)

      // Transferred away, revoked, refunded, cancelled, void, superseded, or on
      // an unpaid order. The sentence is the door's own, from the same pure
      // function, so a holder is never told their pass is fine by one part of
      // the system and refused by another.
      if (refusal) throw conflict(refusal, { status: ticket.status })

      // A ticket whose digest was cleared has no pass. Accepting a transfer
      // clears it; so does revocation. This should already be unreachable
      // through `admissionRefusal`, and it is checked anyway, because the thing
      // on the other side of this branch is a bearer secret.
      if (!ticket.credentialHash) {
        throw conflict('This ticket has no pass. Ask the organiser to reissue it.', {
          status: ticket.status,
        })
      }

      const credential = mintTicketCredential({
        secret: env.AUTH_SECRET,
        ticketId: ticket.id,
        version: ticket.credentialVersion,
      })

      // Derived, then checked against what is stored. Without this the endpoint
      // would hand somebody a string that looks like a pass and opens nothing —
      // after a secret rotation, or a version that drifted from its digest —
      // and they would find out at the door. Constant-time, because the
      // comparison is against a digest.
      if (!credentialMatches(credential, ticket.credentialHash)) {
        request.log.error(
          { ticketId: ticket.id, credentialVersion: ticket.credentialVersion },
          'derived ticket credential does not match the stored digest',
        )

        throw conflict('This pass cannot be verified. Ask the organiser to reissue it.', {
          status: ticket.status,
        })
      }

      await recordAudit(prisma, {
        action: AUDIT_ACTIONS.TICKET_PASS_ISSUED,
        entityType: 'Ticket',
        entityId: ticket.id,
        actorId: request.actor.id,
        // The version and the instant, so a holder can be shown when their pass
        // was last taken out and an investigation can see how often. Not the
        // credential: an audit row is read by more people than a response is,
        // and a secret in one is a secret in every export of it.
        metadata: {
          requestId: request.id,
          at: new Date().toISOString(),
          credentialVersion: ticket.credentialVersion,
        },
      })

      // Not by a browser, not by a proxy, not by anything in between. `private`
      // alone would still let the browser keep it; `no-store` is what stops a
      // pass surviving in the back button after somebody hands their phone over.
      reply.header('cache-control', 'no-store, private')
      reply.header('pragma', 'no-cache')

      // Nothing is logged here. `request.log` records the route and the status,
      // which is what an operator needs; the body is the one place this value
      // is allowed to exist.
      return {
        data: {
          ticketId: ticket.id,
          credential,
          credentialVersion: ticket.credentialVersion,
          issuedAt: ticket.credentialIssuedAt ?? null,
        },
      }
    },
  })

  defineRoute(app, 'tickets.startTransfer', {
    handler: async (request, reply) => {
      const now = new Date()
      const toEmail = request.body.toEmail.toLowerCase()

      // The organisation comes along because the outbox row is stamped with it,
      // so a later privacy redaction can find the message by the organisation
      // that sent it rather than by reading its payload.
      const ticket = await prisma.ticket.findUnique({
        where: { id: request.params.id },
        include: { orderItem: { select: { order: { select: { event: true } } } } },
      })

      if (!ticket) throw notFound('No such ticket.')

      assertHolds(request.actor, ticket)

      const { token, tokenHash } = mintTransferToken()
      const expiresAt = new Date(now.getTime() + TRANSFER_TTL_HOURS * 3_600_000)

      const outcome = await prisma.$transaction((tx) =>
        startTransfer(tx, {
          ticket,
          toEmail,
          fromUserId: request.actor.id,
          tokenHash,
          expiresAt,
          requestId: request.id,
          now,
        }),
      )

      if (!outcome.started) {
        throw conflict('Somebody else moved that ticket on. Read it again.', {
          status: ticket.status,
        })
      }

      // The token goes to the recipient and nowhere else. Not into this
      // response — the sender does not need it, and a response carrying it
      // would put a bearer secret wherever their browser keeps responses — and
      // not into the outbox payload, which a worker and whoever is debugging it
      // both read. The `deliver` seam is where single-use links go, and it is
      // the same one email verification and password resets use.
      if (typeof deliver === 'function') {
        await deliver({
          purpose: 'ticket-transfer',
          token,
          to: toEmail,
          ticketId: ticket.id,
          transferId: outcome.transfer.id,
          expiresAt: expiresAt.toISOString(),
          message: request.body.message ?? null,
        })
      } else {
        app.log.info(
          { transferId: outcome.transfer.id },
          'issued a ticket transfer invitation; no delivery provider is configured',
        )
      }

      // The outbox row is the durable record that somebody is owed a message.
      // It carries who and about what, and no secret: a worker reads it, and so
      // does whoever is looking at why a message did not go.
      await prisma.notificationOutbox.createMany({
        data: [
          {
            template: 'ticket.transfer.invited',
            channel: 'EMAIL',
            recipient: toEmail,
            userId: outcome.transfer.toUserId ?? null,
            // Stamped so a privacy redaction can find this row. Until now every
            // outbox row carried `organizationId: null`, which made an
            // organisation-scoped scrub of delivery evidence a no-op. Delivery
            // is unaffected: the dispatcher never reads this column.
            organizationId: ticket.orderItem?.order?.event?.organizationId ?? null,
            payload: {
              ticketId: ticket.id,
              transferId: outcome.transfer.id,
              ticketCode: ticket.code,
              expiresAt: expiresAt.toISOString(),
            },
            businessEvent: `ticket.transfer.invited:${outcome.transfer.id}`,
            dedupeKey: `ticket.transfer.invited:${outcome.transfer.id}`,
            // Being offered a ticket somebody paid for is not marketing. Asked
            // of the one list rather than answered here.
            suppressible: isSuppressible('ticket.transfer.invited'),
          },
        ],
        skipDuplicates: true,
      })

      reply.code(201)

      return { data: toTicketTransfer(outcome.transfer) }
    },
  })

  defineRoute(app, 'tickets.acceptTransfer', {
    handler: async (request) => {
      const now = new Date()
      const tokenHash = transferTokenDigest(request.body.token)
      const { transfer, ticket } = await loadTransferByToken(prisma, tokenHash, now)

      // The invitation named an address. Whoever is signed in has to be at it:
      // a token that worked for anybody who had it would make a forwarded email
      // a way to take somebody else's ticket.
      if (request.actor.email.toLowerCase() !== transfer.toEmail) {
        throw forbidden('That invitation was sent to a different address.', 'TRANSFER_NOT_YOURS')
      }

      if (ticket.status !== TICKET_STATES.TRANSFER_PENDING) {
        throw conflict('That ticket is no longer being transferred.', { status: ticket.status })
      }

      const outcome = await prisma.$transaction((tx) =>
        acceptTransfer(tx, {
          transfer,
          ticket,
          recipient: request.actor,
          credentialSecret: env.AUTH_SECRET,
          generateTicketCode,
          requestId: request.id,
          now,
        }),
      )

      if (!outcome.accepted) {
        throw conflict('That invitation was already answered.', { status: transfer.status })
      }

      // The one time a credential crosses the wire. It is derived rather than
      // stored, so this response is the only place it will ever exist outside
      // the recipient's own device.
      return { data: { ticket: outcome.ticket, credential: outcome.credential } }
    },
  })

  defineRoute(app, 'tickets.declineTransfer', {
    handler: async (request) => {
      const now = new Date()
      const tokenHash = transferTokenDigest(request.body.token)
      const { transfer, ticket } = await loadTransferByToken(prisma, tokenHash, now)

      if (request.actor.email.toLowerCase() !== transfer.toEmail) {
        throw forbidden('That invitation was sent to a different address.', 'TRANSFER_NOT_YOURS')
      }

      const ended = await prisma.$transaction((tx) =>
        endTransfer(tx, {
          transfer,
          ticket,
          outcome: 'DECLINED',
          actorId: request.actor.id,
          requestId: request.id,
          now,
        }),
      )

      if (!ended) {
        throw conflict('That invitation was already answered.', { status: transfer.status })
      }

      const after = await prisma.ticketTransfer.findUnique({ where: { id: transfer.id } })

      return { data: toTicketTransfer(after) }
    },
  })

  defineRoute(app, 'tickets.cancelTransfer', {
    handler: async (request) => {
      const now = new Date()
      const ticket = await prisma.ticket.findUnique({ where: { id: request.params.id } })

      if (!ticket) throw notFound('No such ticket.')

      assertHolds(request.actor, ticket)

      const transfer = await prisma.ticketTransfer.findFirst({
        where: { ticketId: ticket.id, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      })

      if (!transfer) {
        throw unprocessable('That ticket has no invitation outstanding.', { ticketId: ticket.id })
      }

      const ended = await prisma.$transaction((tx) =>
        endTransfer(tx, {
          transfer,
          ticket,
          outcome: 'CANCELLED',
          actorId: request.actor.id,
          requestId: request.id,
          now,
        }),
      )

      if (!ended) {
        throw conflict('That invitation was already answered.', { status: transfer.status })
      }

      const after = await prisma.ticketTransfer.findUnique({ where: { id: transfer.id } })

      return { data: toTicketTransfer(after) }
    },
  })

  defineRoute(app, 'tickets.revoke', {
    handler: async (request) => {
      const now = new Date()
      const ticket = await prisma.ticket.findUnique({
        where: { id: request.params.id },
        include: TICKET_INCLUDE,
      })

      if (!ticket) throw notFound('No such ticket.')

      const event = ticket.orderItem?.order?.event

      if (!event) throw notFound('No such ticket.')

      assertCan(request.actor, CAPABILITIES.TICKET_REVOKE, {
        organizationId: event.organizationId,
      })

      const revoked = await prisma.$transaction((tx) =>
        revokeTicket(tx, {
          ticket: stripRelations(ticket),
          reason: request.body.reason,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        }),
      )

      if (!revoked) {
        throw conflict('Somebody else moved that ticket on. Read it again.', {
          status: ticket.status,
        })
      }

      const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

      return { data: after }
    },
  })
}

/**
 * Drop the joined relations from a ticket row.
 *
 * The scan query pulls the order and event in to authorise the request; the
 * response schema describes a bare ticket, and sending the whole join would
 * leak the buyer's email to door staff.
 *
 * @param {object} ticket A `Ticket` row, possibly with `orderItem` joined.
 * @returns {object} The ticket's own columns only.
 */
function stripRelations(ticket) {
  const { orderItem: _orderItem, ...rest } = ticket

  return rest
}
