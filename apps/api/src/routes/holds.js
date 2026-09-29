/**
 * Short-lived inventory reservations taken during checkout.
 *
 * The oversell race and how the row lock prevents it are documented in
 * `../lib/inventory.js`; this module is the first place that argument has to
 * hold up.
 *
 * @module @desi-event/api/routes/holds
 */

import {
  authorizeHoldRelease,
  holdExpiresAt,
  isHoldExpired,
  resolveHoldOwnership,
  salesWindowState,
  validateQuantityRequest,
} from '@desi-event/inventory'
import { CAPABILITIES, can } from '@desi-event/permissions'
import { BOOKABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { conflict, httpError, notFound, unprocessable } from '../lib/errors.js'
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { lockTicketTypes, readAvailability } from '../lib/inventory.js'
import { toHold } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'
import { releaseSeats } from '../lib/seating.js'
import {
  assertSessionCapacity,
  assertSessionOnSale,
  lockEventSessions,
  mayBookHiddenTier,
} from '../lib/session-inventory.js'

/** Sales window states and the message each one gets. */
const WINDOW_MESSAGE = Object.freeze({
  NOT_STARTED: 'Sales for this ticket type have not opened.',
  ENDED: 'Sales for this ticket type have closed.',
  PAUSED: 'Sales for this ticket type are paused.',
  CLOSED: 'This ticket type is no longer on sale.',
  DRAFT: 'This ticket type is not on sale.',
})

/**
 * Register the hold routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.env The parsed API environment, for `TICKET_HOLD_TTL_SECONDS`.
 * @returns {void} Nothing.
 */
export function registerHoldRoutes(app, { prisma, env }) {
  defineRoute(app, 'holds.create', {
    handler: async (request) => {
      const { ticketTypeId, quantity, ttlSeconds } = request.body
      const now = new Date()

      const { hold, ticketType, guestToken } = await prisma.$transaction(async (tx) => {
        // FIRST statement of the transaction: take the row lock before reading
        // any counter. A second request for the same tier blocks here until
        // this transaction commits, so it cannot decide on a stale view of
        // availability. See ../lib/inventory.js for the full argument.
        await lockTicketTypes(tx, [ticketTypeId])

        const tier = await tx.ticketType.findUnique({ where: { id: ticketTypeId } })
        if (!tier) throw notFound('No such ticket type.')

        const event = await tx.event.findUnique({ where: { id: tier.eventId } })
        if (!event) throw notFound('No such ticket type.')

        // A hidden tier is a guest list or a team allocation. To anybody but
        // the team it does not exist — the same 404 as an id nobody has used,
        // so this route is not an oracle for which tiers there are.
        if (tier.visibility === 'HIDDEN' && !mayBookHiddenTier(request.actor, event)) {
          throw notFound('No such ticket type.')
        }

        if (!BOOKABLE_STATUSES.has(event.status)) {
          throw unprocessable('This event is not on sale.')
        }

        // A reserved tier is sold seat by seat, through the session's seat map.
        // A quantity hold on one would reserve stock with no seat behind it.
        if (tier.reserved) {
          throw httpError(
            422,
            'SEATED_TIER',
            'This ticket type is reserved seating: choose your seats on the seat map.',
            { ticketTypeId: tier.id, eventSessionId: tier.eventSessionId ?? null },
          )
        }

        // The night's own lock, after the tier's and before any read of the
        // night: see ../lib/session-inventory.js for the order.
        let session = null

        if (tier.eventSessionId) {
          await lockEventSessions(tx, [tier.eventSessionId])
          session = await tx.eventSession.findUnique({ where: { id: tier.eventSessionId } })
        }

        if (session) assertSessionOnSale(session, now)

        const windowState = salesWindowState({
          status: tier.status,
          salesStartAt: tier.salesStartAt,
          salesEndAt: tier.salesEndAt,
          now,
        })

        if (windowState !== 'ON_SALE') {
          throw unprocessable(WINDOW_MESSAGE[windowState] ?? 'This ticket type is not on sale.', {
            windowState,
          })
        }

        // Recomputed from live rows inside the lock — never carried in from a
        // read taken before it.
        const { availableQuantity } = await readAvailability(tx, tier, { now })

        validateQuantityRequest({
          quantity,
          minPerOrder: tier.minPerOrder,
          maxPerOrder: tier.maxPerOrder,
          availableQuantity,
        })

        // The night's capacity, shared by every general-admission tier sold
        // for it, read under the night's lock.
        if (session) await assertSessionCapacity(tx, { session, requested: quantity, now })

        // Identity comes from the verified actor, or from a freshly minted
        // guest token. Nothing in the request body reaches these columns, so a
        // caller cannot create a hold owned by somebody else — and the
        // `ticket_hold_single_owner` check constraint rejects the row outright
        // if this ever returns both or neither.
        const { ownership, guestToken } = resolveHoldOwnership({ actor: request.actor })

        const created = await tx.ticketHold.create({
          data: {
            ticketTypeId: tier.id,
            orderId: null,
            userId: ownership.userId,
            guestTokenHash: ownership.guestTokenHash,
            quantity,
            status: 'ACTIVE',
            // A caller may ask for a SHORTER hold than the configured one,
            // never a longer one. Without the clamp an anonymous request could
            // name a TTL of a year and take a tier off sale for everybody: the
            // hold counts against availability until it expires.
            expiresAt: holdExpiresAt(
              now,
              Math.min(ttlSeconds ?? env.TICKET_HOLD_TTL_SECONDS, env.TICKET_HOLD_TTL_SECONDS),
            ),
          },
        })

        return { hold: created, ticketType: tier, guestToken }
      })

      request.log.info(
        { holdId: hold.id, ticketTypeId, quantity, expiresAt: hold.expiresAt },
        'inventory held',
      )

      // The token is returned exactly once. It is not stored in plaintext and
      // cannot be recovered, so a caller that loses it must wait for expiry.
      return { data: { ...toHold(hold, ticketType), ...(guestToken ? { guestToken } : {}) } }
    },
  })

  defineRoute(app, 'holds.release', {
    handler: async (request) => {
      const holdId = request.params.id
      const guestToken = request.headers['x-hold-token'] ?? null
      const now = new Date()

      // One transaction covers the ownership check AND the state transition.
      // Splitting them would leave a window in which a hold that was authorised
      // for release is converted into a paid order before the write lands.
      const outcome = await prisma.$transaction(async (tx) => {
        const hold = await tx.ticketHold.findUnique({ where: { id: holdId } })

        // "No such hold" and "not yours" must be indistinguishable. Answering
        // 403 for a hold that exists and 404 for one that does not turns this
        // endpoint into an oracle for which ids are real.
        if (!hold) return { result: 'NOT_FOUND' }

        const ticketType = await tx.ticketType.findUnique({
          where: { id: hold.ticketTypeId },
          select: { eventId: true },
        })
        const event = ticketType
          ? await tx.event.findUnique({
              where: { id: ticketType.eventId },
              select: { organizationId: true },
            })
          : null

        const canOverride =
          Boolean(event) &&
          can(request.actor, CAPABILITIES.HOLD_RELEASE_ANY, {
            organizationId: event.organizationId,
          })

        const { allowed, mode } = authorizeHoldRelease({
          hold,
          actor: request.actor,
          guestToken,
          canOverride,
        })

        if (!allowed) {
          // Recorded so that probing shows up in the audit trail even though
          // the caller cannot tell a denial from a miss.
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.HOLD_RELEASE_DENIED,
            entityType: 'TicketHold',
            entityId: hold.id,
            actorId: request.actor?.id ?? null,
            metadata: {
              requestId: request.id,
              at: now.toISOString(),
              presentedGuestToken: Boolean(guestToken),
            },
          })

          return { result: 'NOT_FOUND' }
        }

        if (hold.status === 'CONVERTED') {
          return { result: 'CONVERTED' }
        }

        // Already released or expired: report success without writing again.
        // A replayed request must not produce a second audit entry or a second
        // business transition.
        if (hold.status !== 'ACTIVE') {
          return { result: 'ALREADY_RELEASED', mode }
        }

        // A hold an order is waiting on belongs to that order until its payment
        // is confirmed or refused: a capture that timed out is settled later,
        // and giving the seats back now would let somebody else buy them first.
        if (hold.orderId) {
          const order = await tx.order.findUnique({
            where: { id: hold.orderId },
            select: { status: true },
          })

          if (order?.status === 'PENDING') return { result: 'AWAITING_PAYMENT' }
        }

        const lapsed = isHoldExpired(hold, now)
        const nextStatus = lapsed ? 'EXPIRED' : 'RELEASED'

        // Conditional on ACTIVE so that two simultaneous releases produce
        // exactly one transition: the loser sees count 0 and writes nothing.
        const { count } = await tx.ticketHold.updateMany({
          where: { id: hold.id, status: 'ACTIVE' },
          data: {
            status: nextStatus,
            releasedAt: now,
            releasedBy: request.actor?.id ?? mode,
            releaseReason: lapsed ? 'EXPIRED_ON_RELEASE' : mode,
          },
        })

        if (count === 0) {
          const current = await tx.ticketHold.findUnique({
            where: { id: hold.id },
            select: { status: true },
          })

          return current?.status === 'CONVERTED'
            ? { result: 'CONVERTED' }
            : { result: 'ALREADY_RELEASED', mode }
        }

        // A seat hold's seats go back on sale in the same commit as the hold's
        // new status. Before this, a released or lapsed seat hold left its
        // seats HELD with nobody holding them, off sale for good. Conditional
        // on HELD and this hold, so a seat already sold is never touched.
        const seatsReleased = await releaseSeats(tx, hold.id)

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.HOLD_RELEASED,
          entityType: 'TicketHold',
          entityId: hold.id,
          actorId: request.actor?.id ?? null,
          metadata: {
            mode,
            requestId: request.id,
            at: now.toISOString(),
            previousStatus: 'ACTIVE',
            newStatus: nextStatus,
            ticketTypeId: hold.ticketTypeId,
            quantity: hold.quantity,
            seatsReleased,
            reason: lapsed ? 'EXPIRED_ON_RELEASE' : 'RELEASED_BY_' + mode,
          },
        })

        return { result: 'RELEASED', mode, lapsed }
      })

      if (outcome.result === 'NOT_FOUND') throw notFound('No such hold.')
      if (outcome.result === 'CONVERTED') {
        throw conflict('This hold has already been converted into a paid order.')
      }
      if (outcome.result === 'AWAITING_PAYMENT') {
        throw conflict(
          'This hold belongs to an order whose payment is still being confirmed. It stays with that order until the payment is settled or refused.',
        )
      }

      if (outcome.result === 'RELEASED') {
        request.log.info({ holdId, mode: outcome.mode, lapsed: outcome.lapsed }, 'hold released')
      }

      return { ok: true }
    },
  })
}
