/**
 * Ticket tiers belonging to an event.
 *
 * @module @desi-event/api/routes/ticket-types
 */

import { CAPABILITIES, assertCan } from '@desi-event/permissions'

import { httpError } from '../lib/errors.js'
import {
  AUTHORING_MODES,
  assertAuthorable,
  assertFeeTermsCurrency,
  assertHeldFeeTermsCurrency,
  authorChange,
  defaultTierCurrency,
  loadForAuthoring,
  refuseProblems,
  rethrowTierTaken,
  tierCurrencyProblems,
} from '../lib/event-authoring.js'
import { AUTHORITY_KINDS } from '../lib/event-authority.js'
import { refuseSoldOnSource } from '../lib/event-lifecycle.js'
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

      // The authoring routes' path (SPEC2-XI X-A): the same per-status rules,
      // the same authority — the organisation's through membership, or the
      // Desi-Event team's in an open editing sitting — the same revision
      // compare-and-set and the same audit. The body is the legacy one, so the
      // revision is whatever the event has once its row is locked.
      const event = await loadForAuthoring(prisma, eventId)
      const { mode, authority } = await assertAuthorable(prisma, event, request.actor, {
        session: request.session,
        allow: [AUTHORING_MODES.DRAFT, AUTHORING_MODES.LIVE],
      })

      // The organisation's path also keeps asking for `ticketType:manage`.
      if (authority.kind === AUTHORITY_KINDS.ORGANIZATION) {
        assertCan(request.actor, CAPABILITIES.TICKET_TYPE_MANAGE, {
          organizationId: event.organizationId,
        })
      }

      // Tickets for a platform-held import are sold on its source (SPEC2-XI I5).
      refuseSoldOnSource(event)

      // A currency left out is the event's own, as the authoring route has it,
      // and a tier priced apart from the rest could never share an order.
      const body = {
        ...request.body,
        currency: request.body.currency ?? defaultTierCurrency(event),
      }

      // The event's own booking fee is in one currency (SPEC3 DF3).
      assertFeeTermsCurrency(event, body.currency)

      refuseProblems(
        tierCurrencyProblems(body, event.ticketTypes),
        'That ticket type is not coherent.',
      )

      // One name per event, as `TicketType_eventId_name_key` has it: refused
      // here with a sentence, and by the index, read the same way, when a
      // namesake lands between this read and the insert. Never a 500.
      const namesake = await prisma.ticketType.findFirst({
        where: { eventId: event.id, name: body.name },
        select: { id: true },
      })

      if (namesake) {
        throw httpError(
          409,
          'TIER_NAME_TAKEN',
          `Another ticket type on this event is already called "${body.name}". Give this one a different name.`,
        )
      }

      /** @type {object} */
      let ticketType

      await authorChange(prisma, {
        event,
        revision: null,
        actor: request.actor,
        authority,
        sessionId: request.session?.id ?? null,
        action: 'event.ticket_type_added',
        /**
         * @param {object} tx The transaction client.
         * @returns {Promise<void>} Resolves when written.
         */
        write: async (tx) => {
          // Again under the event's row: a fee saved since the read above
          // does not move the revision (SPEC3 DF3, DF7).
          await assertHeldFeeTermsCurrency(tx, event.id, body.currency)

          ticketType = await tx.ticketType.create({
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
        },
        metadata: () => ({ tierId: ticketType.id, fields: Object.keys(request.body).sort(), mode }),
      }).catch((error) => rethrowTierTaken(error, body.name))

      request.log.info({ eventId: event.id, ticketTypeId: ticketType.id }, 'ticket type created')

      return { data: ticketType }
    },
  })
}
