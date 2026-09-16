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

import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js'
import { generateTicketCode } from '../lib/identifiers.js'
import { maskRecipient } from '../lib/presenters.js'
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
 * @returns {void} Nothing.
 */
export function registerTicketRoutes(app, { prisma, env, deliver }) {
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
        .catch((error) => {
          // The `CheckIn` unique index fired: somebody else admitted this
          // ticket between the read and the write. Not an error to the person
          // at the door — the ticket is in, which is what they wanted.
          if (error?.code === 'P2002') return { admitted: false, checkIn: null }

          throw error
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
        }),
        prisma.ticket.count({ where }),
      ])

      return {
        data: rows,
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'tickets.startTransfer', {
    handler: async (request, reply) => {
      const now = new Date()
      const toEmail = request.body.toEmail.toLowerCase()

      const ticket = await prisma.ticket.findUnique({ where: { id: request.params.id } })

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
            payload: {
              ticketId: ticket.id,
              transferId: outcome.transfer.id,
              ticketCode: ticket.code,
              expiresAt: expiresAt.toISOString(),
            },
            businessEvent: `ticket.transfer.invited:${outcome.transfer.id}`,
            dedupeKey: `ticket.transfer.invited:${outcome.transfer.id}`,
            // Being offered a ticket somebody paid for is not marketing.
            suppressible: false,
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
