/**
 * An organiser's promo codes: list, make, pause, resume, delete.
 *
 * Every route is scoped to the organisation in the path and guarded by the
 * contract's declarative `promo:manage` check against it; each handler also
 * finds the code *within* that organisation, so a code id from another tenant
 * answers 404 exactly as an id nobody has used.
 *
 * There is no general edit. A discount somebody already used cannot quietly
 * become a different discount: an organiser pauses a code and makes a new one,
 * and both steps are on the record. Making a code and resuming one change what
 * buyers pay, so they need a recent second factor (`PROMO_ACTION`); pausing and
 * deleting only reduce what is on offer, so they do not.
 *
 * Audit rows carry the code's terms and ids and never its text: a code is a
 * bearer discount, and an audit trail is read by more people than the
 * organiser who made it.
 *
 * @module @desi-event/api/routes/promo-codes
 */

import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { databaseErrorCode, httpError, notFound } from '../lib/errors.js'
import {
  assertPromoTermsUsable,
  promoAuditMetadata,
  promoHasEnded,
  promoStatus,
  toOrganiserPromoCode,
} from '../lib/promo-codes.js'
import { defineRoute } from '../lib/register.js'

/** What a listed or written code carries with it. */
const PROMO_INCLUDE = Object.freeze({
  event: { select: { id: true, slug: true, title: true } },
  _count: { select: { orders: true } },
})

/**
 * The most codes a status filter reads before paging.
 *
 * Status is computed from the row and the clock, so filtering on it happens
 * after the read. An organisation with more codes than this has a problem the
 * list is not the place to solve; the filter still answers, over the newest.
 *
 * @type {number}
 */
const STATUS_FILTER_SCAN = 2000

/**
 * Register the promo code routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerPromoCodeRoutes(app, { prisma }) {
  /**
   * A code of this organisation, or the uniform 404.
   *
   * @param {object} db A Prisma client or transaction client.
   * @param {object} params The path parameters.
   * @returns {Promise<object>} The row, with its event and order count.
   * @throws {Error} A 404 when the code is not this organisation's.
   */
  async function codeOf(db, params) {
    const row = await db.promoCode.findFirst({
      where: { id: params.promoCodeId, organizationId: params.id },
      include: PROMO_INCLUDE,
    })

    if (!row) throw notFound('No such promo code.')

    return row
  }

  defineRoute(app, 'promoCodes.list', {
    handler: async (request) => {
      const organizationId = request.params.id
      const { eventId, status } = request.query
      const now = new Date()

      const where = {
        organizationId,
        // One event's codes, and the ones for every event, which apply to it too.
        ...(eventId ? { OR: [{ eventId }, { eventId: null }] } : {}),
      }
      const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }]
      const { skip, take } = toSkipTake(request.query)

      if (!status) {
        const [rows, total] = await Promise.all([
          prisma.promoCode.findMany({ where, orderBy, skip, take, include: PROMO_INCLUDE }),
          prisma.promoCode.count({ where }),
        ])

        return {
          data: rows.map((row) => toOrganiserPromoCode(row, { now })),
          pagination: buildPaginationMeta({
            page: request.query.page,
            perPage: request.query.perPage,
            total,
          }),
        }
      }

      const matching = (
        await prisma.promoCode.findMany({
          where,
          orderBy,
          take: STATUS_FILTER_SCAN,
          include: PROMO_INCLUDE,
        })
      ).filter((row) => promoStatus(row, now) === status)

      return {
        data: matching.slice(skip, skip + take).map((row) => toOrganiserPromoCode(row, { now })),
        pagination: buildPaginationMeta({
          page: request.query.page,
          perPage: request.query.perPage,
          total: matching.length,
        }),
      }
    },
  })

  defineRoute(app, 'promoCodes.create', {
    handler: async (request) => {
      const organizationId = request.params.id
      const body = request.body
      const now = new Date()

      // An event-scoped code must be for one of this organisation's events;
      // anybody else's is not there, as far as this route is concerned.
      let eventCurrencies = null

      if (body.eventId) {
        const event = await prisma.event.findFirst({
          where: { id: body.eventId, organizationId },
          include: { ticketTypes: { select: { currency: true } } },
        })

        if (!event) throw notFound('No such event in this organisation.')

        eventCurrencies = [...new Set(event.ticketTypes.map((tier) => tier.currency))].sort()
      }

      assertPromoTermsUsable(body, { now, eventCurrencies })

      let created

      try {
        created = await prisma.$transaction(async (tx) => {
          const row = await tx.promoCode.create({
            data: {
              organizationId,
              eventId: body.eventId ?? null,
              code: body.code,
              type: body.type,
              value: body.value,
              currency: body.type === 'FIXED_AMOUNT' ? body.currency : null,
              maxRedemptions: body.maxRedemptions ?? null,
              startsAt: body.startsAt ? new Date(body.startsAt) : null,
              endsAt: body.endsAt ? new Date(body.endsAt) : null,
              active: body.active,
            },
          })

          await recordAudit(tx, {
            action: AUDIT_ACTIONS.PROMO_CREATED,
            entityType: 'PromoCode',
            entityId: row.id,
            actorId: request.actor.id,
            metadata: { ...promoAuditMetadata(row), active: row.active, requestId: request.id },
          })

          return tx.promoCode.findUnique({ where: { id: row.id }, include: PROMO_INCLUDE })
        })
      } catch (error) {
        const code = databaseErrorCode(error)

        if (code === 'P2002' || code === '23505') {
          // The code text is the buyer's to type and the organiser's to know,
          // so saying which one clashed tells them nothing new.
          throw httpError(
            409,
            'PROMO_CODE_TAKEN',
            `This organiser already has a code called ${body.code}.`,
          )
        }

        throw error
      }

      return { data: toOrganiserPromoCode(created, { now }) }
    },
  })

  defineRoute(app, 'promoCodes.pause', {
    handler: async (request) => {
      const now = new Date()

      const row = await prisma.$transaction(async (tx) => {
        const existing = await codeOf(tx, request.params)

        // Conditional, so a second pause writes nothing and records nothing.
        const { count } = await tx.promoCode.updateMany({
          where: { id: existing.id, organizationId: request.params.id, active: true },
          data: { active: false },
        })

        if (count === 1) {
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.PROMO_PAUSED,
            entityType: 'PromoCode',
            entityId: existing.id,
            actorId: request.actor.id,
            metadata: { ...promoAuditMetadata(existing), requestId: request.id },
          })
        }

        return codeOf(tx, request.params)
      })

      return { data: toOrganiserPromoCode(row, { now }) }
    },
  })

  defineRoute(app, 'promoCodes.resume', {
    handler: async (request) => {
      const now = new Date()

      const row = await prisma.$transaction(async (tx) => {
        const existing = await codeOf(tx, request.params)

        if (promoHasEnded(existing, now)) {
          throw httpError(
            409,
            'PROMO_ENDED',
            'This code has ended, so it cannot be resumed. Make a new one instead.',
          )
        }

        const { count } = await tx.promoCode.updateMany({
          where: { id: existing.id, organizationId: request.params.id, active: false },
          data: { active: true },
        })

        if (count === 1) {
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.PROMO_RESUMED,
            entityType: 'PromoCode',
            entityId: existing.id,
            actorId: request.actor.id,
            metadata: { ...promoAuditMetadata(existing), requestId: request.id },
          })
        }

        return codeOf(tx, request.params)
      })

      return { data: toOrganiserPromoCode(row, { now }) }
    },
  })

  defineRoute(app, 'promoCodes.remove', {
    handler: async (request) => {
      await prisma.$transaction(async (tx) => {
        const existing = await codeOf(tx, request.params)

        // One conditional statement decides it: a checkout that used the code
        // meanwhile holds the row, and the delete then sees the count it wrote.
        const { count } = await tx.promoCode.deleteMany({
          where: {
            id: existing.id,
            organizationId: request.params.id,
            redemptionCount: 0,
            orders: { none: {} },
          },
        })

        if (count === 0) {
          const current = await tx.promoCode.findFirst({
            where: { id: existing.id, organizationId: request.params.id },
            select: { redemptionCount: true },
          })
          const uses = current?.redemptionCount ?? existing.redemptionCount ?? 0

          throw httpError(
            409,
            'PROMO_IN_USE',
            uses > 0
              ? `Used ${uses} time${uses === 1 ? '' : 's'}, so it can be paused but not deleted.`
              : 'An order names this code, so it can be paused but not deleted.',
            { redemptionCount: uses },
          )
        }

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.PROMO_DELETED,
          entityType: 'PromoCode',
          entityId: existing.id,
          actorId: request.actor.id,
          metadata: { ...promoAuditMetadata(existing), requestId: request.id },
        })
      })

      return { ok: true }
    },
  })
}
