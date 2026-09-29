/**
 * Ticket tiers belonging to an event.
 *
 * @module @desi-event/api/routes/ticket-types
 */

import { CAPABILITIES, assertCan } from '@desi-event/permissions'

import { notFound } from '../lib/errors.js'
import { readAvailabilityMap } from '../lib/inventory.js'
import { isPublicTier, toTicketType } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'
import { readSessionUsage } from '../lib/session-inventory.js'
import { loadVisibleEvent, maySeeDrafts } from './events.js'

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

      const all = await prisma.ticketType.findMany({
        where: { eventId: event.id },
        orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
      })

      // The same rule as the event page: a draft tier is the organiser holding
      // something back, and a hidden one is a guest list. Both are for the
      // organisation and moderators only.
      const ticketTypes = maySeeDrafts(event, request.actor)
        ? all
        : all.filter((ticketType) => ticketType.status !== 'DRAFT' && isPublicTier(ticketType))

      // Availability is read live rather than taken from `quantitySold`, so a
      // tier with every remaining seat in somebody's cart reads as sold out
      // instead of selling the same seat twice.
      const now = new Date()
      const general = ticketTypes.filter((ticketType) => !ticketType.reserved)
      const availability = await readAvailabilityMap(prisma, general, { now })

      // A night's capacity is shared by its general-admission tiers, so no
      // tier can offer more than the night has left. A read, not a lock: the
      // hold route re-checks under the lock.
      const sessions = new Map((event.sessions ?? []).map((session) => [session.id, session]))
      /** @type {Map<string, number|null>} */
      const sessionLeft = new Map()

      for (const ticketType of general) {
        const session = sessions.get(ticketType.eventSessionId)

        if (!session || sessionLeft.has(session.id)) continue

        sessionLeft.set(session.id, (await readSessionUsage(prisma, session, { now })).available)
      }

      for (const ticketType of general) {
        const left = sessionLeft.get(ticketType.eventSessionId)
        const own = availability.get(ticketType.id)

        if (own && Number.isInteger(left) && left < own.availableQuantity) {
          availability.set(ticketType.id, {
            ...own,
            availableQuantity: left,
            isSoldOut: left === 0,
          })
        }
      }

      // A reserved tier's stock is its seats: the free ones it sells.
      for (const ticketType of ticketTypes.filter((tier) => tier.reserved)) {
        const free = await prisma.eventSeat.count({
          where: { ticketTypeId: ticketType.id, status: 'AVAILABLE' },
        })

        availability.set(ticketType.id, { availableQuantity: free, isSoldOut: free === 0 })
      }

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
