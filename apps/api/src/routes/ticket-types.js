/**
 * Ticket tiers belonging to an event.
 *
 * @module @desi-event/api/routes/ticket-types
 */

import { CAPABILITIES, assertCan } from '@desi-event/permissions'

import { notFound } from '../lib/errors.js'
import { readAvailabilityMap } from '../lib/inventory.js'
import { toTicketType } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'
import { loadVisibleEvent } from './events.js'

/**
 * Register the ticket type routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerTicketTypeRoutes(app, { prisma }) {
  defineRoute(app, 'ticketTypes.listForEvent', {
    handler: async (request) => {
      const event = await loadVisibleEvent(prisma, { id: request.params.eventId }, request.actor)

      const ticketTypes = await prisma.ticketType.findMany({
        where: { eventId: event.id },
        orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
      })

      // Availability is read live rather than taken from `quantitySold`, so a
      // tier with every remaining seat in somebody's cart reads as sold out
      // instead of selling the same seat twice.
      const availability = await readAvailabilityMap(prisma, ticketTypes, { now: new Date() })

      return {
        data: ticketTypes.map((ticketType) =>
          toTicketType(ticketType, availability.get(ticketType.id)),
        ),
      }
    },
  })

  defineRoute(app, 'ticketTypes.create', {
    handler: async (request) => {
      const { eventId } = request.params

      const event = await prisma.event.findUnique({ where: { id: eventId } })
      if (!event) throw notFound('No such event.')

      assertCan(request.actor, CAPABILITIES.TICKET_TYPE_MANAGE, {
        organizationId: event.organizationId,
      })

      const body = request.body

      const ticketType = await prisma.ticketType.create({
        data: {
          ...body,
          // The path identifies the event; a body field claiming otherwise is
          // ignored rather than honoured, so a copy-pasted payload cannot
          // attach a tier to somebody else's event.
          eventId: event.id,
          salesStartAt: body.salesStartAt ? new Date(body.salesStartAt) : null,
          salesEndAt: body.salesEndAt ? new Date(body.salesEndAt) : null,
          description: body.description ?? null,
        },
      })

      request.log.info({ eventId: event.id, ticketTypeId: ticketType.id }, 'ticket type created')

      return { data: ticketType }
    },
  })
}
