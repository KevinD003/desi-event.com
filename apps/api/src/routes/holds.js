/**
 * Short-lived inventory reservations taken during checkout.
 *
 * The oversell race and how the row lock prevents it are documented in
 * `../lib/inventory.js`; this module is the first place that argument has to
 * hold up.
 *
 * @module @desi-event/api/routes/holds
 */

import { holdExpiresAt, isHoldExpired, salesWindowState, validateQuantityRequest } from '@desi-event/inventory'

import { conflict, notFound, unprocessable } from '../lib/errors.js'
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
      const { ticketTypeId, quantity, orderId, ttlSeconds } = request.body
      const now = new Date()

      const { hold, ticketType } = await prisma.$transaction(async (tx) => {
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

        const created = await tx.ticketHold.create({
          data: {
            ticketTypeId: tier.id,
            orderId: orderId ?? null,
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

        return { hold: created, ticketType: tier }
      })

      request.log.info(
        { holdId: hold.id, ticketTypeId, quantity, expiresAt: hold.expiresAt },
        'inventory held',
      )

      return { data: toHold(hold, ticketType) }
    },
  })

  defineRoute(app, 'holds.release', {
    handler: async (request) => {
      const hold = await prisma.ticketHold.findUnique({ where: { id: request.params.id } })

      if (!hold) throw notFound('No such hold.')

      if (hold.status === 'CONVERTED') {
        throw conflict('This hold has already been converted into a paid order.')
      }

      // Releasing is idempotent: a hold that already lapsed, or that a
      // double-clicking browser already released, is simply reported as
      // released. A checkout page unmounting twice must not raise an error.
      //
      // The status is re-tested inside the write rather than trusted from the
      // read above. Between the two, a checkout completing in another request
      // can move this hold to CONVERTED, and an unconditional update would
      // overwrite that with RELEASED — detaching a paid order from the
      // inventory it holds.
      if (hold.status === 'ACTIVE') {
        const lapsed = isHoldExpired(hold, new Date())

        const { count } = await prisma.ticketHold.updateMany({
          where: { id: hold.id, status: 'ACTIVE' },
          data: { status: lapsed ? 'EXPIRED' : 'RELEASED' },
        })

        if (count === 0) {
          throw conflict('This hold has already been converted into a paid order.')
        }

        request.log.info({ holdId: hold.id, lapsed }, 'hold released')
      }

      return { ok: true }
    },
  })
}
