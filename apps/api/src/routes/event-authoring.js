/**
 * Authoring routes: sessions, ticket types, inventory, readiness, pricing.
 *
 * Thin handlers over `lib/event-authoring.js`, which owns the rules. Every
 * write takes a revision precondition and every one asserts the same two
 * things first: may this actor edit this organisation's events, and is this
 * event in a state where editing means anything.
 *
 * None of these routes declares a `capability` in the contract. The
 * organisation that owns an event is only known once the event is loaded, and
 * the capability guard's own documentation says such a route asserts in its
 * handler — a `capabilityScope` of `params.id` would hand it an *event* id and
 * ask it to treat that as an organisation.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/routes/event-authoring
 */

import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'

import {
  allInPreview,
  assertAuthorable,
  authorChange,
  loadForAuthoring,
  prepareInventory,
  refuseProblems,
  sessionProblems,
  ticketTypeProblems,
} from '../lib/event-authoring.js'
import {
  inventoryProblems,
  publishabilityProblems,
  sellabilityProblems,
} from '../lib/event-lifecycle.js'
import { conflict, notFound } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'

/**
 * Shape a session for the wire.
 *
 * An allow-list rather than the row, for the same reason every presenter here
 * is one: a column added later must not become a field somebody is reading.
 *
 * @param {object} session The session row.
 * @returns {object} The payload.
 */
function toSession(session) {
  return {
    id: session.id,
    eventId: session.eventId,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    doorsOpenAt: session.doorsOpenAt?.toISOString() ?? null,
    timezone: session.timezone,
    salesStartAt: session.salesStartAt?.toISOString() ?? null,
    salesEndAt: session.salesEndAt?.toISOString() ?? null,
    status: session.status,
    venueMapVersionId: session.venueMapVersionId,
    capacity: session.capacity,
    sortOrder: session.sortOrder,
  }
}

/**
 * Shape a ticket type for the wire.
 *
 * @param {object} tier The ticket type row.
 * @returns {object} The payload.
 */
function toTier(tier) {
  return {
    id: tier.id,
    eventId: tier.eventId,
    name: tier.name,
    description: tier.description,
    priceCents: tier.priceCents,
    currency: tier.currency,
    quantityTotal: tier.quantityTotal,
    quantitySold: tier.quantitySold,
    minPerOrder: tier.minPerOrder,
    maxPerOrder: tier.maxPerOrder,
    salesStartAt: tier.salesStartAt?.toISOString() ?? null,
    salesEndAt: tier.salesEndAt?.toISOString() ?? null,
    status: tier.status,
    sortOrder: tier.sortOrder,
  }
}

/**
 * Register the authoring routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerEventAuthoringRoutes(app, { prisma }) {
  /**
   * Load an event and assert the caller may read its internals.
   *
   * Readiness, sessions and pricing are the organisation's business and a
   * moderator's. They are not the public's, and a 404 rather than a 403 keeps
   * "does this organiser have an unannounced event" from being answerable.
   *
   * @param {object} request The Fastify request.
   * @returns {Promise<object>} The event.
   */
  async function readable(request) {
    const event = await loadForAuthoring(prisma, request.params.id)

    const permitted =
      can(request.actor, CAPABILITIES.MODERATION_REVIEW) ||
      can(request.actor, CAPABILITIES.EVENT_VIEW_DRAFT, { organizationId: event.organizationId })

    if (!permitted) throw notFound('No such event.')

    return event
  }

  /**
   * Load an event and assert the caller may change its content.
   *
   * @param {object} request The Fastify request.
   * @returns {Promise<object>} The event.
   */
  async function authorable(request) {
    const event = await loadForAuthoring(prisma, request.params.id)

    assertAuthorable(event, request.actor)

    return event
  }

  defineRoute(app, 'events.sessions', {
    handler: async (request) => {
      const event = await readable(request)

      return {
        data: event.sessions.map(toSession),
        meta: { revision: event.revision },
      }
    },
  })

  defineRoute(app, 'events.addSession', {
    handler: async (request) => {
      const event = await authorable(request)
      const { revision, ...proposed } = request.body

      refuseProblems(sessionProblems(proposed, event), 'That session is not coherent.')
      await assertMapPublishable(prisma, proposed.venueMapVersionId, event)

      /** @type {object} */
      let created

      await authorChange(prisma, {
        event,
        revision,
        actor: request.actor,
        action: 'event.session_added',
        /**
         * @param {object} tx The transaction client.
         * @returns {Promise<void>} Resolves when written.
         */
        write: async (tx) => {
          created = await tx.eventSession.create({
            data: {
              eventId: event.id,
              startsAt: new Date(proposed.startsAt),
              endsAt: new Date(proposed.endsAt),
              doorsOpenAt: proposed.doorsOpenAt ? new Date(proposed.doorsOpenAt) : null,
              timezone: proposed.timezone,
              salesStartAt: proposed.salesStartAt ? new Date(proposed.salesStartAt) : null,
              salesEndAt: proposed.salesEndAt ? new Date(proposed.salesEndAt) : null,
              venueMapVersionId: proposed.venueMapVersionId ?? null,
              capacity: proposed.capacity ?? null,
              sortOrder: proposed.sortOrder ?? 0,
            },
          })
        },
      })

      return { data: toSession(created), meta: { revision: revision + 1 } }
    },
  })

  defineRoute(app, 'events.updateSession', {
    handler: async (request) => {
      const event = await authorable(request)
      const { revision, ...patch } = request.body
      const existing = event.sessions.find((s) => s.id === request.params.sessionId)

      if (!existing) throw notFound('No such session on this event.')

      // Validate the merged shape, not the patch: a window is only valid as a
      // whole, so moving one end has to be checked against the end that stayed.
      const merged = { ...existing, ...patch }

      refuseProblems(sessionProblems(merged, event), 'That session is not coherent.')

      if (patch.venueMapVersionId !== undefined) {
        await assertMapStillMovable(prisma, existing)
        await assertMapPublishable(prisma, patch.venueMapVersionId, event)
      }

      /** @type {object} */
      let updated

      await authorChange(prisma, {
        event,
        revision,
        actor: request.actor,
        action: 'event.session_updated',
        /**
         * @param {object} tx The transaction client.
         * @returns {Promise<void>} Resolves when written.
         */
        write: async (tx) => {
          updated = await tx.eventSession.update({
            where: { id: existing.id },
            data: toSessionPatch(patch),
          })
        },
      })

      return { data: toSession(updated), meta: { revision: revision + 1 } }
    },
  })

  defineRoute(app, 'events.removeSession', {
    handler: async (request) => {
      const event = await authorable(request)
      const { revision } = request.query
      const existing = event.sessions.find((s) => s.id === request.params.sessionId)

      if (!existing) throw notFound('No such session on this event.')

      const sold = await prisma.order.count({ where: { eventSessionId: existing.id } })

      if (sold > 0) {
        throw conflict(
          'Somebody has already bought a ticket for this session, so it cannot be removed. Cancel the event instead, which owes them a refund and says so.',
          { sessionId: existing.id, orders: sold, code: 'SESSION_IN_USE' },
        )
      }

      await authorChange(prisma, {
        event,
        revision,
        actor: request.actor,
        action: 'event.session_removed',
        /**
         * @param {object} tx The transaction client.
         * @returns {Promise<void>} Resolves when written.
         */
        write: async (tx) => {
          await tx.eventSeat.deleteMany({ where: { eventSessionId: existing.id } })
          await tx.eventSession.delete({ where: { id: existing.id } })
        },
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'events.addTicketType', {
    handler: async (request) => {
      const event = await authorable(request)
      const { revision, ...proposed } = request.body

      refuseProblems(
        ticketTypeProblems(proposed, event, event.sessions),
        'That ticket type is not coherent.',
      )

      /** @type {object} */
      let created

      await authorChange(prisma, {
        event,
        revision,
        actor: request.actor,
        action: 'event.ticket_type_added',
        /**
         * @param {object} tx The transaction client.
         * @returns {Promise<void>} Resolves when written.
         */
        write: async (tx) => {
          created = await tx.ticketType.create({
            data: {
              eventId: event.id,
              name: proposed.name,
              description: proposed.description ?? null,
              priceCents: proposed.priceCents,
              currency: proposed.currency ?? 'INR',
              quantityTotal: proposed.quantityTotal ?? 0,
              minPerOrder: proposed.minPerOrder ?? 1,
              maxPerOrder: proposed.maxPerOrder ?? 10,
              salesStartAt: proposed.salesStartAt ? new Date(proposed.salesStartAt) : null,
              salesEndAt: proposed.salesEndAt ? new Date(proposed.salesEndAt) : null,
              eventSessionId: proposed.eventSessionId ?? null,
              priceZoneId: proposed.priceZoneId ?? null,
              reserved: proposed.reserved ?? false,
              complimentary: proposed.complimentary ?? false,
              sortOrder: proposed.sortOrder ?? 0,
            },
          })
        },
      })

      return { data: toTier(created), meta: { revision: revision + 1 } }
    },
  })

  defineRoute(app, 'events.updateTicketType', {
    handler: async (request) => {
      const event = await authorable(request)
      const { revision, ...patch } = request.body
      const existing = event.ticketTypes.find((t) => t.id === request.params.tierId)

      if (!existing) throw notFound('No such ticket type on this event.')

      const merged = { ...existing, ...patch }

      refuseProblems(
        ticketTypeProblems(merged, event, event.sessions),
        'That ticket type is not coherent.',
      )

      if (patch.priceCents !== undefined && existing.quantitySold > 0) {
        throw conflict(
          `"${existing.name}" has already sold ${existing.quantitySold}. Changing its price would change what those buyers agreed to pay.`,
          { tierId: existing.id, sold: existing.quantitySold, code: 'TIER_SOLD' },
        )
      }

      /** @type {object} */
      let updated

      await authorChange(prisma, {
        event,
        revision,
        actor: request.actor,
        action: 'event.ticket_type_updated',
        /**
         * @param {object} tx The transaction client.
         * @returns {Promise<void>} Resolves when written.
         */
        write: async (tx) => {
          updated = await tx.ticketType.update({
            where: { id: existing.id },
            data: toTierPatch(patch),
          })
        },
      })

      return { data: toTier(updated), meta: { revision: revision + 1 } }
    },
  })

  defineRoute(app, 'events.removeTicketType', {
    handler: async (request) => {
      const event = await authorable(request)
      const { revision } = request.query
      const existing = event.ticketTypes.find((t) => t.id === request.params.tierId)

      if (!existing) throw notFound('No such ticket type on this event.')

      if (existing.quantitySold > 0) {
        throw conflict(
          `"${existing.name}" has already sold ${existing.quantitySold}, so it cannot be removed.`,
          { tierId: existing.id, sold: existing.quantitySold, code: 'TIER_SOLD' },
        )
      }

      await authorChange(prisma, {
        event,
        revision,
        actor: request.actor,
        action: 'event.ticket_type_removed',
        /**
         * @param {object} tx The transaction client.
         * @returns {Promise<void>} Resolves when written.
         */
        write: async (tx) => {
          await tx.ticketType.delete({ where: { id: existing.id } })
        },
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'events.prepareInventory', {
    handler: async (request) => {
      const event = await loadForAuthoring(prisma, request.params.id)

      assertCan(request.actor, CAPABILITIES.INVENTORY_MANAGE, {
        organizationId: event.organizationId,
      })

      const result = await prepareInventory(prisma, {
        event,
        sessionId: request.body.eventSessionId,
        actor: request.actor,
      })

      return { data: result }
    },
  })

  defineRoute(app, 'events.readiness', {
    handler: async (request) => {
      const event = await readable(request)

      const publishable = publishabilityProblems(event)
      const sellable = sellabilityProblems(event)
      const inventory = await inventoryProblems(prisma, event)
      const organizerVerified = event.organization?.verificationStatus === 'VERIFIED'

      return {
        data: {
          ready:
            publishable.length === 0 &&
            sellable.length === 0 &&
            inventory.length === 0 &&
            organizerVerified,
          status: event.status,
          publishable,
          sellable,
          inventory,
          organizerVerified,
        },
      }
    },
  })

  defineRoute(app, 'events.pricePreview', {
    handler: async (request) => {
      const event = await readable(request)

      return {
        data: event.ticketTypes.map((tier) => ({
          ticketTypeId: tier.id,
          name: tier.name,
          ...allInPreview(tier),
        })),
      }
    },
  })
}

/**
 * Refuse a map version that is not a published one belonging to this venue.
 *
 * The database refuses a draft version outright — the trigger says a version
 * "is still editable and cannot back a session" — and this is the sentence that
 * says why in the organiser's terms rather than in a constraint's.
 *
 * @param {object} prisma The Prisma client.
 * @param {string|null|undefined} versionId The proposed version.
 * @param {object} event The event.
 * @returns {Promise<void>} Resolves when acceptable.
 * @throws {Error} A 404 or 422.
 */
async function assertMapPublishable(prisma, versionId, event) {
  if (!versionId) return

  const version = await prisma.venueMapVersion.findUnique({
    where: { id: versionId },
    include: { venueMap: true },
  })

  if (!version) throw notFound('No such seating-map version.')

  refuseProblems(
    [
      version.publishedAt
        ? null
        : 'That seating-map version is still a draft. Publish it before a session sells against it.',
      // A shared venue may be *used* by anybody and *edited* by nobody but its
      // owner. Using one here is a read, so it is allowed; what is refused is a
      // map belonging to a venue this event is not held at.
      version.venueMap.venueId === event.venueId
        ? null
        : 'That seating map belongs to a different venue from the one this event is held at.',
    ].filter(Boolean),
    'That seating-map version cannot back this session.',
  )
}

/**
 * Refuse to move a session's map once anything has been sold against it.
 *
 * The database enforces this as well. Both exist because the message matters:
 * a trigger name is not something an organiser can act on.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} session The existing session.
 * @returns {Promise<void>} Resolves when movable.
 * @throws {Error} A 409.
 */
async function assertMapStillMovable(prisma, session) {
  const sold = await prisma.eventSeat.count({
    where: { eventSessionId: session.id, status: { in: ['SOLD', 'COMPLIMENTARY', 'HELD'] } },
  })

  if (sold > 0) {
    throw conflict(
      'Seats have already been sold or held at this session, so its seating map is what those people bought. It keeps the version it has.',
      { sessionId: session.id, seats: sold, code: 'MAP_FROZEN' },
    )
  }
}

/**
 * The Prisma patch for a session, with dates parsed and absent keys omitted.
 *
 * Absent is not null: a field the caller did not mention must keep its value,
 * and spreading `undefined` into Prisma would be a no-op only by luck.
 *
 * @param {object} patch The request patch.
 * @returns {object} The Prisma data.
 */
function toSessionPatch(patch) {
  /** @type {Record<string, unknown>} */
  const data = {}

  if (patch.startsAt !== undefined) data.startsAt = new Date(patch.startsAt)
  if (patch.endsAt !== undefined) data.endsAt = new Date(patch.endsAt)
  if (patch.doorsOpenAt !== undefined) {
    data.doorsOpenAt = patch.doorsOpenAt ? new Date(patch.doorsOpenAt) : null
  }
  if (patch.timezone !== undefined) data.timezone = patch.timezone
  if (patch.salesStartAt !== undefined) {
    data.salesStartAt = patch.salesStartAt ? new Date(patch.salesStartAt) : null
  }
  if (patch.salesEndAt !== undefined) {
    data.salesEndAt = patch.salesEndAt ? new Date(patch.salesEndAt) : null
  }
  if (patch.venueMapVersionId !== undefined) data.venueMapVersionId = patch.venueMapVersionId
  if (patch.capacity !== undefined) data.capacity = patch.capacity
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder

  return data
}

/**
 * The Prisma patch for a ticket type.
 *
 * @param {object} patch The request patch.
 * @returns {object} The Prisma data.
 */
function toTierPatch(patch) {
  /** @type {Record<string, unknown>} */
  const data = {}

  for (const key of [
    'name',
    'description',
    'priceCents',
    'currency',
    'quantityTotal',
    'minPerOrder',
    'maxPerOrder',
    'eventSessionId',
    'priceZoneId',
    'reserved',
    'complimentary',
    'sortOrder',
  ]) {
    if (patch[key] !== undefined) data[key] = patch[key]
  }

  if (patch.salesStartAt !== undefined) {
    data.salesStartAt = patch.salesStartAt ? new Date(patch.salesStartAt) : null
  }
  if (patch.salesEndAt !== undefined) {
    data.salesEndAt = patch.salesEndAt ? new Date(patch.salesEndAt) : null
  }

  return data
}
