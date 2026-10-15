/**
 * The door, and the ticket's life around it.
 *
 * ## Scanning
 *
 * Preview, then confirm, then exactly one admission. `../lib/admission.js`
 * holds the whole of it; this file wires three routes to it:
 *
 * - `GET /v1/tickets/admission/events` — the events this account may admit to.
 * - `POST /v1/tickets/admission/preview` — resolve and show, write nothing.
 * - `POST /v1/tickets/check-in` — present the same pass with the preview's
 *   reference; everything is re-checked inside the admitting transaction.
 *
 * And the same pair for a whole order's group pass (`../lib/group-admission.js`):
 *
 * - `POST /v1/tickets/admission/group/preview` — every ticket the buyer still
 *   holds on the order, each with its own outcome.
 * - `POST /v1/tickets/admission/group/check-in` — admit the named tickets, in
 *   one transaction, each exactly once.
 *
 * A re-scan of an admitted ticket is a duplicate, not an error: it answers 200
 * with `ALREADY_CHECKED_IN` and the original instant. A ticket that must not be
 * admitted is a 409 carrying a reason from a closed vocabulary. Exactly one
 * `CheckIn` row is ever written per ticket; its unique index and the row lock
 * the confirmation takes are what make that true when two scanners race.
 *
 * ## Transfers
 *
 * Offering, accepting, declining and withdrawing. The reasoning lives in
 * `../lib/tickets.js`; what is here is who may do each one, and how the
 * one-time code reaches the recipient (`../lib/delivery.js`): with no delivery
 * provider it is returned once, `no-store`, to the sender to pass on.
 *
 * ## Paying at the door (SPEC3 §9.3, SPEC3-XI XT)
 *
 * A ticket booked to pay at the venue says what it owes at the door on its own
 * page, its pass and an accepted transfer (`venuePayment`). It can be offered
 * and passed on like any other ticket: what is due stays with it, and the
 * invitation says so; whoever holds it pays at the door.
 *
 * @module @desi-event/api/routes/tickets
 */

import { isSuppressible } from '@desi-event/notifications'
import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { HIDDEN_EMAIL, buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { changesForOrder } from '../lib/event-change-notices.js'
import { EVENT_COVER_INCLUDE, publicCover } from '../lib/event-media.js'
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js'
import { generateTicketCode } from '../lib/identifiers.js'
import { admissionRateLimit, passRateLimit, transferMailRateLimit } from '../plugins/rate-limit.js'
import { credentialMatches, mintTicketCredential } from '../lib/ticket-credentials.js'
import {
  DELIVERY_MODES,
  TRANSFER_DELIVERY_FAILED_SENTENCE,
  assertRecipientDailyCap,
  deliverOrWithdraw,
} from '../lib/delivery.js'
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import {
  SESSION_SUMMARY_SELECT,
  WALLET_INCLUDE,
  joinUrlFor,
  ticketSession,
  ticketVenuePayment,
  toWalletTicket,
  transferRecipient,
} from '../lib/presenters.js'
import {
  TICKET_STATES,
  TRANSFER_TTL_HOURS,
  acceptTransfer,
  admissionRefusal,
  assertHolds,
  endTransfer,
  loadTransferByToken,
  mintTransferToken,
  revokeTicket,
  startTransfer,
  transferTokenDigest,
} from '../lib/tickets.js'
import { confirmAdmission, listAdmissionEvents, previewAdmission } from '../lib/admission.js'
import { settleReferralUsesIfEnded } from '../lib/referral-uses.js'
import { TRANSACTION_BUDGETS, budgetedTransaction } from '../lib/transaction-budget.js'
import { confirmGroupAdmission, previewGroupAdmission } from '../lib/group-admission.js'
import { defineRoute } from '../lib/register.js'

/**
 * How long revoking a ticket may wait behind another change to its order, and
 * what the organiser is told when it waited too long: a 503 with
 * `Retry-After`, the ticket still valid.
 */
const REVOKE_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Another change to this ticket’s order was being saved at the same moment, so the ticket was not revoked. Try again in a moment.',
})

/**
 * A ticket's cancellation unpaid, as its holder is told it: when, by whom and
 * the reason given (SPEC3-XI XU10). Never the name of who gave it.
 */
const VENUE_CANCELLATION_SELECT = Object.freeze({ createdAt: true, authority: true, reason: true })

/** Everything a scan needs in order to authorise itself. */
const TICKET_INCLUDE = Object.freeze({
  // The event's approved cover comes with it, so a ticket shows the picture
  // its event page shows.
  orderItem: { include: { order: { include: { event: { include: EVENT_COVER_INCLUDE } } } } },
  venueCancellation: { select: VENUE_CANCELLATION_SELECT },
})

/** The ticket page's read: the same, plus the night it is for. */
const TICKET_DETAIL_INCLUDE = Object.freeze({
  orderItem: {
    include: {
      order: { include: { event: { include: EVENT_COVER_INCLUDE } } },
      ticketType: { select: { eventSession: { select: SESSION_SUMMARY_SELECT } } },
    },
  },
  eventSeat: { select: { eventSession: { select: SESSION_SUMMARY_SELECT } } },
  venueCancellation: { select: VENUE_CANCELLATION_SELECT },
})

/**
 * One transfer, as either party sees it, or as the organiser does.
 *
 * The token is never here. It goes in the invitation link once and the database
 * holds only its digest; echoing it would put a bearer secret in a browser
 * cache, a proxy log and a screenshot.
 *
 * The recipient is `••••@example.com` for a party to the transfer. The sender
 * typed the address, and the recipient owns it, so the domain tells neither of
 * them anything new, and it lets a sender tell their offers apart. An
 * organiser reading the ticket's history is asking whether it should still
 * admit, which the recipient's address does not answer. They get
 * `Hidden email`.
 *
 * @param {object} row A `TicketTransfer` row.
 * @param {object} [options] Options.
 * @param {boolean} [options.party] Whether the reader is a party to the transfer.
 * @returns {object} A payload satisfying `ticketTransferSchema`.
 */
function toTicketTransfer(row, { party = true } = {}) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    fromUserId: row.fromUserId ?? null,
    toEmailMasked: party ? transferRecipient(row.toEmail) : HIDDEN_EMAIL,
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
 * What changed about a ticket's event since its order was placed and touches
 * the ticket: read as the order's notices are, for the ticket's own night (its
 * seat's, else its tier's), or every night for a ticket good for every night.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} ticket The ticket, with `orderItem.order`, `orderItem.ticketType.eventSession` and `eventSeat.eventSession`.
 * @param {object} event Its event.
 * @returns {Promise<object[]>} `eventChangeNoticeSchema` payloads.
 */
async function changesForTicket(prisma, ticket, event) {
  const order = ticket.orderItem?.order

  if (!order) return []

  const night =
    ticket.eventSeat?.eventSession?.id ?? ticket.orderItem?.ticketType?.eventSession?.id ?? null

  return changesForOrder(prisma, {
    id: order.id,
    eventId: event.id,
    createdAt: order.createdAt,
    eventSessionId: null,
    items: [{ ticketType: { eventSessionId: night } }],
  })
}

/**
 * Register the ticket routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.env The parsed API environment.
 * @param {function(object): Promise<void>} [deps.deliver] Where a single-use code is sent, in EMAIL mode.
 * @param {'MANUAL'|'EMAIL'} [deps.deliveryMode] How codes reach people, resolved once by `buildApp`.
 * @param {{max?: number, timeWindow?: string|number}} [deps.passLimit] Overrides for the admission-pass rate limit; supplied by tests.
 * @param {{max?: number, timeWindow?: string|number}} [deps.admissionLimit] Overrides for the door rate limit; supplied by tests and the load suite.
 * @param {{max?: number, timeWindow?: string|number}} [deps.transferMailLimit] Overrides for the transfer mail budget (EMAIL mode only); supplied by tests.
 * @returns {void} Nothing.
 */
export function registerTicketRoutes(
  app,
  { prisma, env, deliver, deliveryMode, passLimit, admissionLimit, transferMailLimit },
) {
  const mode = deliveryMode ?? app.deliveryMode ?? DELIVERY_MODES.MANUAL

  // The door. The reasoning — resolve first, authorise against the ticket's own
  // event, preview without writing, confirm inside one locked transaction —
  // lives in ../lib/admission.js; what is here is only the wiring.
  defineRoute(app, 'tickets.admissionEvents', {
    handler: async (request, reply) => {
      // Which doors this account stands at is about the account, and a shared
      // cache is the wrong place for it.
      reply.header('cache-control', 'private, no-store')

      const { entries, meta } = await listAdmissionEvents({
        prisma,
        actor: request.actor,
        filters: request.query ?? {},
      })

      return { data: entries, meta }
    },
  })

  defineRoute(app, 'tickets.previewAdmission', {
    config: { rateLimit: admissionRateLimit(admissionLimit) },
    handler: async (request, reply) => {
      // A preview names an attendee. Nothing between the server and the door
      // keeps it: not a browser cache, not a shared proxy.
      reply.header('cache-control', 'private, no-store')
      reply.header('pragma', 'no-cache')

      return {
        data: await previewAdmission({
          prisma,
          env,
          actor: request.actor,
          body: request.body,
          log: request.log,
        }),
      }
    },
  })

  defineRoute(app, 'tickets.checkIn', {
    config: { rateLimit: admissionRateLimit(admissionLimit) },
    handler: async (request, reply) => {
      reply.header('cache-control', 'private, no-store')
      reply.header('pragma', 'no-cache')

      return {
        data: await confirmAdmission({
          prisma,
          env,
          actor: request.actor,
          body: request.body,
          log: request.log,
        }),
      }
    },
  })

  // A group pass at the door: the same wiring as a single ticket, and the same
  // rate limit per scanner. The pass, the printed code and the reference are
  // never logged here; the logger redacts them by name as well.
  defineRoute(app, 'tickets.previewGroupAdmission', {
    config: { rateLimit: admissionRateLimit(admissionLimit) },
    handler: async (request, reply) => {
      reply.header('cache-control', 'private, no-store')
      reply.header('pragma', 'no-cache')

      return {
        data: await previewGroupAdmission({
          prisma,
          env,
          actor: request.actor,
          body: request.body,
          log: request.log,
        }),
      }
    },
  })

  defineRoute(app, 'tickets.checkInGroup', {
    config: { rateLimit: admissionRateLimit(admissionLimit) },
    handler: async (request, reply) => {
      reply.header('cache-control', 'private, no-store')
      reply.header('pragma', 'no-cache')

      return {
        data: await confirmGroupAdmission({
          prisma,
          env,
          actor: request.actor,
          body: request.body,
          log: request.log,
        }),
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
        include: TICKET_DETAIL_INCLUDE,
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
          ticket: {
            ...stripRelations(ticket),
            // What it owes at the door, whether it was paid there and by the
            // reader, and whether (and why) it was cancelled because it was
            // not paid for; null when it owes nothing there.
            venuePayment: ticketVenuePayment(ticket, {
              currency: ticket.orderItem.order.currency,
              viewerUserId: request.actor.id,
            }),
          },
          event: {
            id: event.id,
            slug: event.slug,
            title: event.title,
            category: event.category,
            startsAt: event.startsAt,
            timezone: event.timezone,
            status: event.status,
            coverImage: publicCover(event),
          },
          organizationId: event.organizationId,
          holder,
          transfers: transfers.map((row) => toTicketTransfer(row, { party: holder })),
          session: ticketSession(ticket),
          // The holder's, while the ticket admits. An organiser reading the
          // ticket has the link in their own editor and gets null here.
          onlineJoinUrl: holder ? joinUrlFor(ticket, ticket.orderItem?.order ?? null, event) : null,
          // What changed about the event since the order was placed and
          // touches this ticket: event-wide changes and its own night's, or
          // every night's for a ticket good for every night (SPEC2-XI X-14).
          eventChanges: await changesForTicket(prisma, ticket, event),
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

      // One answer for every way this can fail to be yours, and `assertHolds`
      // is deliberately **not** used for it. That helper is written for the
      // transfer routes, where a ticket bought without an account is worth a
      // distinct 403 telling somebody to claim it — and on this route that 403
      // is an oracle: a guest ticket's id answers differently from an id
      // nobody has ever used, so anybody can learn which identifiers name a
      // real unclaimed ticket. Here the three cases collapse into one.
      //
      // An organiser gets the same 404 as a stranger, because `ticket:revoke`
      // is the power to withdraw a ticket, not to be admitted on it, and a pass
      // is the one thing on a ticket nobody but its holder may read.
      const passHolder = Boolean(ticket?.ownerUserId) && ticket.ownerUserId === request.actor.id

      if (!passHolder) throw notFound('No such ticket.')

      const order = ticket.orderItem?.order ?? null
      const refusal = admissionRefusal(ticket, order, order?.event ?? null)

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
        throw conflict('This ticket has no pass.', {
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

        throw conflict('This pass cannot be verified.', {
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
          // A ticket that owes a payment still gets its pass: the door has to
          // scan it to take the payment.
          venuePayment: ticketVenuePayment(ticket, {
            currency: order?.currency ?? null,
            viewerUserId: request.actor.id,
          }),
        },
      }
    },
  })

  defineRoute(app, 'tickets.startTransfer', {
    // In EMAIL mode a sender may email five transfer codes an hour; in MANUAL
    // nothing is emailed and the budget does not apply.
    config: { rateLimit: transferMailRateLimit(transferMailLimit, { deliveryMode: mode }) },
    handler: async (request, reply) => {
      const now = new Date()
      const toEmail = request.body.toEmail.toLowerCase()

      // The organisation comes along because the outbox row is stamped with it,
      // so a later privacy redaction can find the message by the organisation
      // that sent it rather than by reading its payload.
      const ticket = await prisma.ticket.findUnique({
        where: { id: request.params.id },
        include: { orderItem: { select: { order: { select: { event: true, currency: true } } } } },
      })

      if (!ticket) throw notFound('No such ticket.')

      assertHolds(request.actor, ticket)

      const { token, tokenHash } = mintTransferToken()
      const expiresAt = new Date(now.getTime() + TRANSFER_TTL_HOURS * 3_600_000)

      const outcome = await prisma.$transaction(async (tx) => {
        // In EMAIL mode, one address is sent at most three codes a day. Counted
        // in the transaction that writes the offer, under a lock on the
        // address, so offers sent to it at the same moment take turns.
        if (mode === DELIVERY_MODES.EMAIL) {
          await assertRecipientDailyCap(tx, { email: toEmail, now })
        }

        return startTransfer(tx, {
          ticket,
          toEmail,
          fromUserId: request.actor.id,
          tokenHash,
          expiresAt,
          requestId: request.id,
          delivery: mode,
          now,
        })
      })

      if (!outcome.started) {
        throw conflict('Somebody else moved that ticket on. Read it again.', {
          status: ticket.status,
        })
      }

      // The code reaches the recipient one way or the other, and never goes
      // anywhere else. In EMAIL (DELIVERY_MODE=EMAIL with an SMTP server) the
      // mailer gets it and this response carries null. In MANUAL (the default)
      // this response is the only place it ever exists: the sender is shown it
      // once and passes it on themselves, and the database keeps only its
      // digest, so it cannot be shown again. Either way the response is `no-store`, and the
      // code never reaches a log line, an audit row or the outbox payload.
      const delivery = await deliverOrWithdraw({
        mode,
        secret: token,
        reply,
        deliver,
        log: request.log,
        failureMessage: TRANSFER_DELIVERY_FAILED_SENTENCE,
        // A code that could not be emailed is a code nobody holds: the offer is
        // withdrawn and the ticket is the holder's again, with the record of
        // why in the same transaction.
        withdraw: () =>
          prisma.$transaction(async (tx) => {
            const ended = await endTransfer(tx, {
              transfer: outcome.transfer,
              ticket,
              outcome: 'CANCELLED',
              actorId: request.actor.id,
              requestId: request.id,
              now: new Date(),
            })

            if (!ended) return

            await recordAudit(tx, {
              action: AUDIT_ACTIONS.TICKET_TRANSFER_DELIVERY_FAILED,
              entityType: 'Ticket',
              entityId: ticket.id,
              actorId: request.actor.id,
              metadata: {
                requestId: request.id,
                transferId: outcome.transfer.id,
                deliveryMode: DELIVERY_MODES.EMAIL,
              },
            })
          }),
        message: {
          purpose: 'ticket-transfer',
          to: toEmail,
          ticketId: ticket.id,
          transferId: outcome.transfer.id,
          expiresAt: expiresAt.toISOString(),
          message: request.body.message ?? null,
        },
      })

      // Identifiers and the mode, never the code.
      request.log.info(
        { transferId: outcome.transfer.id, delivery: delivery.mode },
        'issued a ticket transfer invitation',
      )

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
              // Not the printed code: the email never shows it, and until the
              // offer is accepted it still admits the sender's ticket by hand.
              expiresAt: expiresAt.toISOString(),
              // A ticket booked to pay at the door keeps what it owes: the
              // invitation tells the recipient whoever holds it pays this
              // there (SPEC3-XI XT6). 0 for a ticket that owes nothing.
              venueDueCents: ticket.venuePaymentId ? 0 : (ticket.venueDueCents ?? 0),
              currency: ticket.orderItem?.order?.currency ?? null,
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

      return { data: { ...toTicketTransfer(outcome.transfer), delivery } }
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

      // What the new ticket owes at the door: what the old one owed, now the
      // recipient's to pay (SPEC3-XI XT2). Null when it owes nothing there.
      const line = await prisma.orderItem.findUnique({
        where: { id: outcome.ticket.orderItemId },
        select: { order: { select: { currency: true } } },
      })
      const venuePayment = ticketVenuePayment(outcome.ticket, {
        currency: line?.order?.currency ?? null,
        viewerUserId: request.actor.id,
      })

      // The one time a credential crosses the wire. It is derived rather than
      // stored, so this response is the only place it will ever exist outside
      // the recipient's own device.
      return {
        data: { ticket: { ...outcome.ticket, venuePayment }, credential: outcome.credential },
      }
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

      const orderId = ticket.orderItem.order.id
      // Bounded: the order's row can be held by a night's cancellation or a
      // deletion for their whole budget, and the organiser is told within
      // the wait that nothing was revoked (final door review, finding 2).
      const revoked = await budgetedTransaction(prisma, REVOKE_BUDGET, async (tx) => {
        // The order first, then the ticket (SPEC3-XI §2.3.5): every other
        // writer of an order and its tickets takes them in that order, and
        // the referral use below is decided under this lock.
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`

        const moved = await revokeTicket(tx, {
          ticket: stripRelations(ticket),
          reason: request.body.reason,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        })

        // An order that now has no ticket standing and nothing left to refund
        // ended without being used, and gives its referral use back once
        // (SPEC3-XI XR4): after the ticket's write, so the code is the last
        // lock taken.
        if (moved) {
          await settleReferralUsesIfEnded(tx, {
            entries: [{ orderId, cause: 'TICKETS_REVOKED' }],
            actorId: request.actor.id,
            requestId: request.id,
            now,
            log: request.log,
          })
        }

        return moved
      })

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
  const {
    orderItem: _orderItem,
    eventSeat: _eventSeat,
    venueCancellation: _venueCancellation,
    ...rest
  } = ticket

  return rest
}
