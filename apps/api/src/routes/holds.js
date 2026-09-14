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

import { conflict, notFound, unprocessable } from '../lib/errors.js'
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { lockTicketTypes, readAvailability } from '../lib/inventory.js'
import { toHold } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'

/** Sales window states and the message each one gets. */
const WINDOW_MESSAGE = Object.freeze({
  NOT_STARTED: 'Sales for this ticket type have not opened yet.',
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

        if (event.status !== 'PUBLISHED') {
          throw unprocessable('This event is not on sale.')
        }

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
            reason: lapsed ? 'EXPIRED_ON_RELEASE' : 'RELEASED_BY_' + mode,
          },
        })

        return { result: 'RELEASED', mode, lapsed }
      })

      if (outcome.result === 'NOT_FOUND') throw notFound('No such hold.')
      if (outcome.result === 'CONVERTED') {
        throw conflict('This hold has already been converted into a paid order.')
      }

      if (outcome.result === 'RELEASED') {
        request.log.info({ holdId, mode: outcome.mode, lapsed: outcome.lapsed }, 'hold released')
      }

      return { ok: true }
    },
  })
}
