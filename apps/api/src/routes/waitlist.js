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
      const { email, quantity, userId } = request.body

      const event = await prisma.event.findUnique({ where: { id: eventId } })
      if (!event) throw notFound('No such event.')

      const existing = await prisma.waitlistEntry.findFirst({ where: { eventId: event.id, email } })
      if (existing) return { data: existing }

      const entry = await prisma.waitlistEntry.create({
        data: {
          // The path wins over the body, so a stale payload cannot sign
          // somebody up for a different event.
          eventId: event.id,
          email,
          quantity,
          userId: userId ?? request.actor?.id ?? null,
          notified: false,
        },
      })

      request.log.info({ eventId: event.id, waitlistEntryId: entry.id }, 'waitlist joined')

      return { data: entry }
    },
  })
}
