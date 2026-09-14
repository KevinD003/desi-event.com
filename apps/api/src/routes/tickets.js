/**
 * Door scanning.
 *
 * @module @desi-event/api/routes/tickets
 */

import { CAPABILITIES, assertCan } from '@desi-event/permissions'

import { conflict, notFound } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'

/** Everything a scan needs in order to authorise itself. */
const TICKET_INCLUDE = Object.freeze({
  orderItem: { include: { order: { include: { event: true } } } },
})

/**
 * Register the ticket routes.
 *
 * ## Idempotence
 *
 * A door scanner on venue Wi-Fi retries. A steward scans the same pass twice
 * because the first beep was drowned out. Neither must produce a second
 * check-in, and neither must stall the queue with an error the steward has to
 * think about.
 *
 * So a re-scan is a no-op that reports itself: the response is the ticket with
 * its **original** `checkedInAt` untouched and `alreadyCheckedIn: true`, which
 * is the conflict the caller needs to see. Exactly one check-in is ever
 * recorded per ticket, and the scanner app can show "already admitted at
 * 19:42" instead of a failure.
 *
 * A ticket that is `VOID` or `REFUNDED`, or whose order is not paid, is a
 * different matter — those are 409s, because letting that person in is wrong
 * rather than redundant.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerTicketRoutes(app, { prisma }) {
  defineRoute(app, 'tickets.checkIn', {
    handler: async (request) => {
      const { code, eventId, checkedInAt, force, deviceId } = request.body

      const ticket = await prisma.ticket.findUnique({ where: { code }, include: TICKET_INCLUDE })
      if (!ticket) throw notFound('No ticket with that code.')

      const order = ticket.orderItem?.order
      const event = order?.event
      if (!event) throw notFound('No ticket with that code.')

      assertCan(request.actor, CAPABILITIES.TICKET_CHECK_IN, {
        organizationId: event.organizationId,
      })

      if (eventId && eventId !== event.id) {
        throw conflict('This ticket belongs to a different event.', {
          ticketEventId: event.id,
          scannedEventId: eventId,
        })
      }

      if (ticket.status === 'VOID' || ticket.status === 'REFUNDED') {
        throw conflict(`This ticket is ${ticket.status.toLowerCase()} and cannot be admitted.`)
      }

      if (order.status !== 'PAID') {
        throw conflict('The order for this ticket is not paid.')
      }

      if (ticket.status === 'CHECKED_IN' && !force) {
        request.log.info(
          { ticketCode: ticket.code, deviceId, checkedInAt: ticket.checkedInAt },
          'duplicate check-in ignored',
        )

        return { data: { ticket: stripRelations(ticket), alreadyCheckedIn: true } }
      }

      const wasCheckedIn = ticket.status === 'CHECKED_IN'

      const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: 'CHECKED_IN',
          checkedInAt: checkedInAt ? new Date(checkedInAt) : new Date(),
        },
      })

      request.log.info(
        { ticketCode: updated.code, eventId: event.id, deviceId, forced: wasCheckedIn },
        'ticket checked in',
      )

      return { data: { ticket: stripRelations(updated), alreadyCheckedIn: wasCheckedIn } }
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
