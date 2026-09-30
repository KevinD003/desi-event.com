/**
 * Authoring routes: sessions, ticket types, inventory, readiness, pricing.
 *
 * Thin handlers over `lib/event-authoring.js`, which owns the rules. Every
 * write takes a revision precondition and every one asserts the same two
 * things first: may this actor edit this organisation's events, and is this
 * event in a state where editing means anything — a draft, or a live event
 * taking the edits that cannot take anything away from a buyer.
 *
 * None of these routes declares a `capability` in the contract. The
 * organisation that owns an event is only known once the event is loaded, and
 * the capability guard's own documentation says such a route asserts in its
 * handler — a `capabilityScope` of `params.id` would hand it an *event* id and
 * ask it to treat that as an organisation.
 *
 * ## Locks
 *
 * `authorChange` takes the Event row first (its revision update). A change
 * that must see every hold — a tier's quantity or price, a session's capacity,
 * a removal — then locks the TicketType or EventSession row and re-reads what
 * is using it inside the same transaction, because a hold can land between a
 * read and a write. Checkout locks TicketType rows and never waits on the Event
 * row, so the two orders cannot form a cycle.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/routes/event-authoring
 */

import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'
import { resolveTaxPolicy } from '@desi-event/pricing'
import { sessionMaterialChanges } from '@desi-event/schemas/lifecycle'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import {
  AUTHORING_MODES,
  allInPreview,
  assertAuthorable,
  authorChange,
  bindReservedSeatsAudited,
  changedFields,
  defaultTierCurrency,
  loadForAuthoring,
  loadZonesByVersion,
  lockSessionRow,
  prepareInventory,
  refuseConflict,
  refuseProblems,
  rethrowTierTaken,
  sessionChangeProblems,
  sessionProblems,
  sessionRemovable,
  sessionUsage,
  ticketTypeProblems,
  tierChangeProblems,
  tierCurrencyProblems,
  tierRemovable,
  tierUsage,
} from '../lib/event-authoring.js'
import {
  boundSeatCounts,
  inventoryProblems,
  publishabilityProblems,
  sellabilityProblems,
} from '../lib/event-lifecycle.js'
import {
  classifyChanges,
  materialChangeWork,
  refuseUnconfirmedSession,
} from '../lib/event-material-change.js'
import { databaseErrorCode, httpError, notFound, unprocessable } from '../lib/errors.js'
import { lockTicketTypes } from '../lib/inventory.js'
import { defineRoute } from '../lib/register.js'
import { feeConfigFor } from './orders.js'

/** Usage of a session or tier that nothing has touched yet. */
const UNUSED_SESSION = Object.freeze({
  sold: 0,
  held: 0,
  orders: 0,
  holdItems: 0,
  holds: 0,
  seats: 0,
  checkIns: 0,
})
const UNUSED_TIER = Object.freeze({ sold: 0, held: 0, orderItems: 0, holdItems: 0, activeHolds: 0 })

/**
 * Shape a session for the wire.
 *
 * An allow-list rather than the row, for the same reason every presenter here
 * is one: a column added later must not become a field somebody is reading.
 *
 * @param {object} session The session row.
 * @param {Map<string, object[]>} zonesByVersion Price zones per map version.
 * @param {object} [usage] What is using it, from `sessionUsage`.
 * @returns {object} The payload.
 */
function toSession(session, zonesByVersion, usage = UNUSED_SESSION) {
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
    label: session.label ?? null,
    venueMapVersionId: session.venueMapVersionId,
    capacity: session.capacity,
    sortOrder: session.sortOrder,
    priceZones: session.venueMapVersionId
      ? (zonesByVersion.get(session.venueMapVersionId) ?? []).map((zone) => ({
          id: zone.id,
          name: zone.name,
          colourToken: zone.colourToken,
          sortOrder: zone.sortOrder,
        }))
      : [],
    usage: { sold: usage.sold, held: usage.held },
    removable: sessionRemovable(usage),
  }
}

/**
 * Shape a ticket type for its organisation.
 *
 * Every field the edit form needs to prefill, plus what is using it. Plain
 * values, never clamped: this is the read the people who can fix a legacy row
 * use, so it shows the row as it is.
 *
 * @param {object} tier The ticket type row.
 * @param {object} [usage] What is using it, from `tierUsage`.
 * @returns {object} The payload.
 */
function toAuthorTier(tier, usage = UNUSED_TIER) {
  return {
    id: tier.id,
    eventId: tier.eventId,
    name: tier.name,
    description: tier.description ?? null,
    priceCents: tier.priceCents,
    currency: tier.currency,
    quantityTotal: tier.quantityTotal,
    quantitySold: tier.quantitySold ?? 0,
    minPerOrder: tier.minPerOrder,
    maxPerOrder: tier.maxPerOrder,
    salesStartAt: tier.salesStartAt ? new Date(tier.salesStartAt).toISOString() : null,
    salesEndAt: tier.salesEndAt ? new Date(tier.salesEndAt).toISOString() : null,
    status: tier.status,
    sortOrder: tier.sortOrder ?? 0,
    eventSessionId: tier.eventSessionId ?? null,
    priceZoneId: tier.priceZoneId ?? null,
    reserved: Boolean(tier.reserved),
    complimentary: Boolean(tier.complimentary),
    visibility: tier.visibility === 'HIDDEN' ? 'HIDDEN' : 'PUBLIC',
    heldQuantity: usage.held,
    hasOrders: usage.orderItems > 0,
    removable: tierRemovable(usage),
  }
}

/**
 * The sessions whose seats a change to a reserved tier affects.
 *
 * @param {object|null} before The tier before the change, or null for a new one.
 * @param {object} after The tier after it.
 * @returns {string[]} Session ids, distinct.
 */
function seatedSessionsOf(before, after) {
  const ids = new Set()

  if (before?.reserved && before.eventSessionId) ids.add(before.eventSessionId)
  if (after?.reserved && after.eventSessionId) ids.add(after.eventSessionId)

  return [...ids]
}

/**
 * Turn a foreign-key refusal from a removal into the conflict it means.
 *
 * The usage check runs under a row lock and should leave nothing for the
 * database to refuse; this is the net under it, so a line that slips past is a
 * 409 an organiser can read rather than a 500.
 *
 * @param {unknown} error Whatever was thrown.
 * @param {string} code The conflict code to answer with.
 * @param {string} message The sentence.
 * @returns {never} Always throws.
 * @throws {Error} The conflict, or the original error.
 */
function rethrowInUse(error, code, message) {
  const database = databaseErrorCode(error)

  if (database === 'P2003' || database === '23503') throw httpError(409, code, message)

  throw error
}

/**
 * Register the authoring routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} [deps.env] The parsed API environment, for the fee terms checkout charges with.
 * @returns {void} Nothing.
 */
export function registerEventAuthoringRoutes(app, { prisma, env }) {
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
   * @returns {Promise<object>} `{ event, mode }`: the event and its editing mode, `draft` or `live`.
   */
  async function authorable(request) {
    const event = await loadForAuthoring(prisma, request.params.id)
    const mode = assertAuthorable(event, request.actor)

    return { event, mode }
  }

  defineRoute(app, 'events.sessions', {
    handler: async (request) => {
      const event = await readable(request)
      const usage = await sessionUsage(prisma, event.sessions, event.ticketTypes)

      return {
        data: event.sessions.map((session) =>
          toSession(session, event.zonesByVersion, usage.get(session.id)),
        ),
        meta: { revision: event.revision },
      }
    },
  })

  defineRoute(app, 'events.ticketTypes', {
    handler: async (request) => {
      const event = await readable(request)
      const usage = await tierUsage(prisma, event.ticketTypes)

      return {
        data: event.ticketTypes.map((tier) => toAuthorTier(tier, usage.get(tier.id))),
        meta: { revision: event.revision },
      }
    },
  })

  defineRoute(app, 'events.addSession', {
    handler: async (request) => {
      const { event, mode } = await authorable(request)
      const { revision, confirmMaterialChange: _c, changeReason: _r, ...proposed } = request.body

      refuseProblems(
        sessionProblems(proposed, event, { mustBeFuture: mode === AUTHORING_MODES.LIVE }),
        'That session is not coherent.',
      )
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
              label: proposed.label ?? null,
              salesStartAt: proposed.salesStartAt ? new Date(proposed.salesStartAt) : null,
              salesEndAt: proposed.salesEndAt ? new Date(proposed.salesEndAt) : null,
              venueMapVersionId: proposed.venueMapVersionId ?? null,
              capacity: proposed.capacity ?? null,
              sortOrder: proposed.sortOrder ?? 0,
            },
          })
        },
        metadata: () => ({ sessionId: created.id, fields: Object.keys(proposed).sort(), mode }),
      })

      const zones = await loadZonesByVersion(prisma, [created.venueMapVersionId])

      return { data: toSession(created, zones), meta: { revision: revision + 1 } }
    },
  })

  defineRoute(app, 'events.updateSession', {
    handler: async (request) => {
      const { event, mode } = await authorable(request)
      const {
        revision,
        confirmMaterialChange = false,
        changeReason = null,
        ...patch
      } = request.body
      const existing = event.sessions.find((s) => s.id === request.params.sessionId)

      if (!existing) throw notFound('No such session on this event.')

      // Validate the merged shape, not the patch: a window is only valid as a
      // whole, so moving one end has to be checked against the end that stayed.
      const merged = { ...existing, ...patch }

      refuseProblems(sessionProblems(merged, event), 'That session is not coherent.')

      const changed = changedFields(existing, patch)
      const usage = (await sessionUsage(prisma, [existing], event.ticketTypes)).get(existing.id)

      refuseConflict(sessionChangeProblems(existing, patch, usage, mode))

      if (changed.includes('venueMapVersionId')) {
        await assertMapStillMovable(prisma, existing)
        await assertMapPublishable(prisma, patch.venueMapVersionId, event)
        assertNoTierPricesTheMap(event, existing, patch.venueMapVersionId)
      }

      // A live session's date, door time or zone is what somebody bought for
      // that night: the same confirmation, reason and notice as the event's own.
      const material =
        mode === AUTHORING_MODES.LIVE
          ? sessionMaterialChanges(Object.fromEntries(changed.map((field) => [field, true])))
          : []

      if (material.length > 0 && !confirmMaterialChange) {
        refuseUnconfirmedSession(material, event.status)
      }

      if (material.length > 0 && !changeReason) {
        throw unprocessable(
          'A confirmed change to a session needs a reason, because a notice with it is recorded for everybody holding a ticket for that night.',
          { problems: ['Give a reason for the change.'], fields: material },
        )
      }

      const lowersCapacity =
        changed.includes('capacity') &&
        patch.capacity != null &&
        (existing.capacity == null || patch.capacity < existing.capacity)

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
          if (lowersCapacity) {
            // Under the night's tier locks and then its own row lock, in the
            // order checkout takes them, so a hold or a sale landing since the
            // read above is counted rather than oversold. The tiers are read
            // again under the locks: their `quantitySold` is what settlement
            // moves, and the copy loaded before this transaction predates any
            // sale that settled while this change waited for the event row.
            await lockTicketTypes(
              tx,
              (
                await tx.ticketType.findMany({
                  where: { eventSessionId: existing.id },
                  select: { id: true },
                })
              ).map((tier) => tier.id),
            )
            await lockSessionRow(tx, existing.id)

            const tiers = await tx.ticketType.findMany({ where: { eventId: event.id } })
            const fresh = (await sessionUsage(tx, [existing], tiers)).get(existing.id)

            refuseConflict(sessionChangeProblems(existing, patch, fresh, mode))
          }

          updated = await tx.eventSession.update({
            where: { id: existing.id },
            data: toSessionPatch(patch),
          })

          if (material.length === 0) return

          const { before, after } = classifyChanges(
            existing,
            Object.fromEntries(material.map((field) => [field, toSessionPatch(patch)[field]])),
          )
          const work = await materialChangeWork(tx, {
            event,
            revision: revision + 1,
            material,
            before,
            after,
            reason: changeReason,
            session: updated,
          })

          await recordAudit(tx, {
            action: AUDIT_ACTIONS.EVENT_SESSION_MATERIAL_CHANGE,
            entityType: 'EventSession',
            entityId: existing.id,
            actorId: request.actor?.id ?? null,
            metadata: {
              eventId: event.id,
              fields: material,
              before,
              after,
              reason: changeReason,
              ordersAffected: work.orders,
              // Created, not delivered: this build queues notices and sends none.
              notificationsQueued: work.notifications,
            },
          })
        },
        metadata: { sessionId: existing.id, fields: changed, mode },
      })

      const zones = await loadZonesByVersion(prisma, [updated.venueMapVersionId])
      const tiersNow = await prisma.ticketType.findMany({ where: { eventId: event.id } })
      const after = (await sessionUsage(prisma, [updated], tiersNow)).get(updated.id)

      return { data: toSession(updated, zones, after), meta: { revision: revision + 1 } }
    },
  })

  defineRoute(app, 'events.removeSession', {
    handler: async (request) => {
      const { event, mode } = await authorable(request)
      const { revision } = request.query
      const existing = event.sessions.find((s) => s.id === request.params.sessionId)

      if (!existing) throw notFound('No such session on this event.')

      const inUse =
        'Tickets for this session have been sold, held or scanned, so it cannot be removed. Cancel the event instead, which owes those people a refund and says so.'
      const onSession = event.ticketTypes.filter((tier) => tier.eventSessionId === existing.id)

      /**
       * Refuse to leave a public event with no night at all.
       *
       * A draft may be emptied and filled again; publication checks it has a
       * session. A published or on-sale event with none is a page that says it
       * is happening and cannot say when, so the last night goes by postponing
       * or cancelling, which tell the people who bought tickets.
       *
       * @param {number} count How many sessions the event has now.
       * @returns {void} Nothing.
       * @throws {Error} A 409 `LAST_SESSION` on a live event's last session.
       */
      const assertNotLast = (count) => {
        if (mode === AUTHORING_MODES.LIVE && count <= 1) {
          throw httpError(
            409,
            'LAST_SESSION',
            'This is the only session of a public event, so it cannot be removed. Postpone the event to move it, or cancel the event instead.',
            { sessionId: existing.id },
          )
        }
      }

      /**
       * Refuse when anything depends on the session.
       *
       * @param {object} db A Prisma client or transaction client.
       * @returns {Promise<void>} Resolves when it may go.
       */
      const assertRemovable = async (db) => {
        const usage = (await sessionUsage(db, [existing], event.ticketTypes)).get(existing.id)

        if (!sessionRemovable(usage)) {
          throw httpError(409, 'SESSION_IN_USE', inUse, { sessionId: existing.id, ...usage })
        }
      }

      await assertRemovable(prisma)
      assertNotLast(event.sessions.length)

      /** @type {string[]} */
      let removedTierIds = []

      try {
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
            // Checkout locks tiers first, so locking them here makes a purchase
            // either land before this check or wait for the removal.
            await lockTicketTypes(
              tx,
              onSession.map((tier) => tier.id),
            )
            await lockSessionRow(tx, existing.id)
            await assertRemovable(tx)
            assertNotLast(await tx.eventSession.count({ where: { eventId: event.id } }))

            // The session's tiers go with it (`onDelete: Cascade`), on sale or
            // not; nothing depends on them, or the check above refused. The
            // audit row names them, so a tier that vanished is accounted for.
            removedTierIds = (
              await tx.ticketType.findMany({
                where: { eventSessionId: existing.id },
                select: { id: true },
              })
            ).map((tier) => tier.id)

            await tx.eventSeat.deleteMany({ where: { eventSessionId: existing.id } })
            await tx.eventSession.delete({ where: { id: existing.id } })
          },
          metadata: () => ({ sessionId: existing.id, fields: [], removedTierIds }),
        })
      } catch (error) {
        rethrowInUse(error, 'SESSION_IN_USE', inUse)
      }

      return { ok: true }
    },
  })

  defineRoute(app, 'events.addTicketType', {
    handler: async (request) => {
      const { event, mode } = await authorable(request)
      const { revision, ...body } = request.body
      // A complimentary tier is free and hidden, and the database refuses
      // anything else (ticket_type_complimentary_free_and_hidden). A tier
      // named without a currency is priced in the event's own.
      const proposed = {
        ...body,
        currency: body.currency ?? defaultTierCurrency(event),
        visibility: body.visibility ?? (body.complimentary ? 'HIDDEN' : 'PUBLIC'),
      }

      refuseProblems(
        [
          ...ticketTypeProblems(
            {
              minPerOrder: 1,
              maxPerOrder: 10,
              quantityTotal: 0,
              reserved: false,
              complimentary: false,
              ...proposed,
            },
            event,
            event.sessions,
            { siblings: event.ticketTypes },
          ),
          ...tierCurrencyProblems(proposed, event.ticketTypes),
        ],
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
              currency: proposed.currency,
              quantityTotal: proposed.quantityTotal ?? 0,
              minPerOrder: proposed.minPerOrder ?? 1,
              maxPerOrder: proposed.maxPerOrder ?? 10,
              salesStartAt: proposed.salesStartAt ? new Date(proposed.salesStartAt) : null,
              salesEndAt: proposed.salesEndAt ? new Date(proposed.salesEndAt) : null,
              eventSessionId: proposed.eventSessionId ?? null,
              priceZoneId: proposed.priceZoneId ?? null,
              reserved: proposed.reserved ?? false,
              complimentary: proposed.complimentary ?? false,
              visibility: proposed.visibility,
              sortOrder: proposed.sortOrder ?? 0,
              // Drafts by default, on a live event too: a tier appears on the
              // public page when the organiser says so, not the moment it is typed.
              status: proposed.status ?? 'DRAFT',
            },
          })

          for (const eventSessionId of seatedSessionsOf(null, created)) {
            await bindReservedSeatsAudited(tx, {
              eventId: event.id,
              eventSessionId,
              actor: request.actor,
            })
          }
        },
        metadata: () => ({ tierId: created.id, fields: Object.keys(body).sort(), mode }),
      }).catch((error) => rethrowTierTaken(error, proposed.name))

      return { data: toAuthorTier(created), meta: { revision: revision + 1 } }
    },
  })

  defineRoute(app, 'events.updateTicketType', {
    handler: async (request) => {
      const { event, mode } = await authorable(request)
      const { revision, ...patch } = request.body
      const existing = event.ticketTypes.find((t) => t.id === request.params.tierId)

      if (!existing) throw notFound('No such ticket type on this event.')

      // Making a tier complimentary also hides it, as creating one does.
      if (patch.complimentary === true && patch.visibility === undefined) {
        patch.visibility = 'HIDDEN'
      }

      const merged = { ...existing, ...patch }

      refuseProblems(
        [
          ...ticketTypeProblems(merged, event, event.sessions, { siblings: event.ticketTypes }),
          ...(patch.currency !== undefined && patch.currency !== existing.currency
            ? tierCurrencyProblems(merged, event.ticketTypes)
            : []),
        ],
        'That ticket type is not coherent.',
      )

      const usage = (await tierUsage(prisma, [existing])).get(existing.id)

      refuseConflict(tierChangeProblems(existing, patch, usage, mode))

      const changed = changedFields(existing, patch)

      /** @type {object} */
      let updated
      /** @type {object} */
      let fresh = usage

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
          // Re-read under the tier's lock: a hold can land between the check
          // above and this write, and a quantity cut must count it.
          await lockTicketTypes(tx, [existing.id])

          const current = await tx.ticketType.findUnique({ where: { id: existing.id } })

          fresh = (await tierUsage(tx, [current])).get(current.id)
          refuseConflict(tierChangeProblems(current, patch, fresh, mode))

          updated = await tx.ticketType.update({
            where: { id: existing.id },
            data: toTierPatch(patch),
          })

          for (const eventSessionId of seatedSessionsOf(existing, updated)) {
            await bindReservedSeatsAudited(tx, {
              eventId: event.id,
              eventSessionId,
              actor: request.actor,
            })
          }
        },
        metadata: { tierId: existing.id, fields: changed, mode },
      }).catch((error) => rethrowTierTaken(error, merged.name))

      return { data: toAuthorTier(updated, fresh), meta: { revision: revision + 1 } }
    },
  })

  defineRoute(app, 'events.removeTicketType', {
    handler: async (request) => {
      const { event } = await authorable(request)
      const { revision } = request.query
      const existing = event.ticketTypes.find((t) => t.id === request.params.tierId)

      if (!existing) throw notFound('No such ticket type on this event.')

      const inUse = `"${existing.name}" has been sold, ordered or held, so removing it would take tickets away from people. Pause it or hide it instead.`

      /**
       * Refuse when anything depends on the tier.
       *
       * @param {object} db A Prisma client or transaction client.
       * @param {object} tier The tier row.
       * @returns {Promise<void>} Resolves when it may go.
       */
      const assertRemovable = async (db, tier) => {
        const usage = (await tierUsage(db, [tier])).get(tier.id)

        if (!tierRemovable(usage)) {
          throw httpError(409, 'TIER_IN_USE', inUse, { tierId: tier.id, ...usage })
        }
      }

      await assertRemovable(prisma, existing)

      try {
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
            await lockTicketTypes(tx, [existing.id])

            const current = await tx.ticketType.findUnique({ where: { id: existing.id } })

            await assertRemovable(tx, current)
            await tx.ticketType.delete({ where: { id: existing.id } })
          },
          metadata: { tierId: existing.id, fields: [] },
        })
      } catch (error) {
        rethrowInUse(error, 'TIER_IN_USE', inUse)
      }

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
      const sellable = sellabilityProblems(event, {
        boundSeats: await boundSeatCounts(prisma, event),
      })
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
      // What checkout would charge: the same fee terms and the venue's tax.
      const { rateBps } = resolveTaxPolicy({
        country: event.venue?.country ?? null,
        region: event.venue?.region ?? null,
        at: new Date(),
      })

      return {
        data: event.ticketTypes.map((tier) => ({
          ticketTypeId: tier.id,
          name: tier.name,
          ...allInPreview(tier, {
            feeConfig: env ? feeConfigFor(env, tier.currency ?? 'INR') : undefined,
            taxRateBps: rateBps,
          }),
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
    throw httpError(
      409,
      'MAP_FROZEN',
      'Seats have already been sold or held at this session, so its seating map is what those people bought. It keeps the version it has.',
      { sessionId: session.id, seats: sold },
    )
  }
}

/**
 * Refuse to move a session's map while a ticket type on it prices one of its zones.
 *
 * A zone belongs to one map version. Moving the session to another version, or
 * to general admission, would leave such a tier pricing seats that nobody at
 * this session can reach. The database refuses it as well, through the trigger
 * `desi_event_session_map_keeps_tier_zones`; this is the sentence that says
 * what to do about it.
 *
 * @param {object} event The event, with its ticket types.
 * @param {object} session The existing session.
 * @param {string|null} versionId The proposed version; null for general admission.
 * @returns {void}
 * @throws {Error} A 409 when a tier on the session prices a zone.
 */
function assertNoTierPricesTheMap(event, session, versionId) {
  if ((versionId ?? null) === (session.venueMapVersionId ?? null)) return

  const priced = event.ticketTypes.filter(
    (tier) => tier.eventSessionId === session.id && tier.priceZoneId,
  )

  if (priced.length > 0) {
    throw httpError(
      409,
      'MAP_PRICED',
      priced.length === 1
        ? `"${priced[0].name}" prices seats on this session's current seating map. Remove it before changing the map, then price the new map's zones.`
        : `${priced.length} ticket types price seats on this session's current seating map. Remove them before changing the map, then price the new map's zones.`,
      { sessionId: session.id, ticketTypeIds: priced.map((tier) => tier.id) },
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
  // A night's name: null clears it, and the date labels the night again.
  if (patch.label !== undefined) data.label = patch.label
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
    'visibility',
    // Only DRAFT, ON_SALE and PAUSED reach here: the request schema does not
    // accept SOLD_OUT, which is derived from inventory, or CLOSED, which is
    // what the sales window ending means.
    'status',
  ]) {
    if (patch[key] !== undefined) data[key] = patch[key]
  }

  if (patch.salesStartAt !== undefined) {
    data.salesStartAt = patch.salesStartAt ? new Date(patch.salesStartAt) : null
  }
  if (patch.salesEndAt !== undefined) {
    data.salesEndAt = patch.salesEndAt ? new Date(patch.salesEndAt) : null
  }

  // Making a tier complimentary also hides it, as creating one does.
  if (data.complimentary === true && data.visibility === undefined) data.visibility = 'HIDDEN'

  return data
}
