/**
 * Waitlist sign-up for sold-out events.
 *
 * @module @desi-event/api/routes/waitlist
 */

import { notFound } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'

/**
 * Register the waitlist routes.
 *
 * Signing up twice returns the existing entry rather than failing. A buyer who
 * refreshes the page is not making a mistake worth an error message, and the
 * `(eventId, email)` unique index means a duplicate insert would fail anyway.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerWaitlistRoutes(app, { prisma }) {
  defineRoute(app, 'waitlist.join', {
    handler: async (request) => {
      const { eventId } = request.params
      const { email, quantity } = request.body

      const event = await prisma.event.findUnique({ where: { id: eventId } })
      if (!event) throw notFound('No such event.')

      // Upsert rather than read-then-create. Two things depend on it: a second
      // join updates the quantity instead of silently discarding it, and two
      // simultaneous joins for the same address cannot race the
      // (eventId, email) unique index into a 500.
      const entry = await prisma.waitlistEntry.upsert({
        where: { eventId_email: { eventId: event.id, email } },
        update: { quantity },
        create: {
          // The path wins over the body, so a stale payload cannot sign
          // somebody up for a different event.
          eventId: event.id,
          email,
          quantity,
          // Ownership follows the authenticated caller. A userId in the body
          // would let anyone attach a waitlist entry to another account.
          userId: request.actor?.id ?? null,
          notified: false,
        },
      })

      request.log.info({ eventId: event.id, waitlistEntryId: entry.id }, 'waitlist joined')

      // `userId` is deliberately not echoed. This endpoint accepts an
      // unauthenticated caller who supplies any address, so returning the
      // account behind an address would turn it into a lookup for linking
      // email addresses to accounts.
      return { data: { ...entry, userId: undefined } }
    },
  })
}
