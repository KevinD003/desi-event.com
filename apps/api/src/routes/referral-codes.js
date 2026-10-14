/**
 * Referral codes, for the team at The Desi Events (SPEC3 §8): codes that remove the
 * whole booking fee from an order. `referralCodes.list`, `.byAdministrator`,
 * `.create`, `.get`, `.update`, `.switchOff` and `.switchOn`.
 *
 * The session, `referral_code:manage` and the PAYMENT_TERMS step-up (on
 * create, update and switch-on) come from the contract; the four writes share
 * one `referral-admin` budget of sixty an hour per administrator, run after
 * those guards. The rules are `lib/referral-codes.js`'s. Every answer is
 * `no-store`: the code's text is in it.
 *
 * No log call here takes a referral code's row or its text.
 *
 * @module @desi-event/api/routes/referral-codes
 */

import { buildPaginationMeta } from '@desi-event/schemas'
import { REFERRAL_PAGE_SIZE } from '@desi-event/schemas/payment-terms'

import {
  adminReferralCode,
  createReferralCode,
  listReferralCodes,
  referralCodeDetail,
  referralCodesByAdministrator,
  switchReferralCode,
  updateReferralCode,
} from '../lib/referral-codes.js'
import { defineRoute } from '../lib/register.js'
import { DEFAULT_REFERRAL_ADMIN_LIMIT, actorBudget } from '../plugins/rate-limit.js'

/**
 * Mark a reply as never to be cached: it carries codes' texts.
 *
 * @param {object} reply The reply.
 * @returns {void}
 */
function noStore(reply) {
  reply.header('cache-control', 'no-store, private')
}

/**
 * Register the referral code routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {{max?: number, timeWindow?: string|number}} [deps.referralAdminLimit] Overrides for the `referral-admin` budget.
 * @returns {void} Nothing.
 */
export function registerReferralCodeRoutes(app, { prisma, referralAdminLimit = {} } = {}) {
  // One budget for every write: making, changing and switching codes draw on
  // the same sixty an hour (SPEC3 §4.4).
  const budget = actorBudget({
    name: 'referral-admin',
    ...DEFAULT_REFERRAL_ADMIN_LIMIT,
    ...referralAdminLimit,
  })

  defineRoute(app, 'referralCodes.list', {
    handler: async (request, reply) => {
      noStore(reply)

      const query = request.query ?? {}
      const page = query.page ?? 1
      // Fifty a page, as the contract has it (SPEC3 §8.4).
      const perPage = Math.min(query.perPage ?? REFERRAL_PAGE_SIZE, REFERRAL_PAGE_SIZE)
      const { data, total } = await listReferralCodes(
        prisma,
        { ...query, page, perPage },
        new Date(),
      )

      return { data, pagination: buildPaginationMeta({ page, perPage, total }) }
    },
  })

  defineRoute(app, 'referralCodes.byAdministrator', {
    handler: async (_request, reply) => {
      noStore(reply)

      return { data: await referralCodesByAdministrator(prisma) }
    },
  })

  defineRoute(app, 'referralCodes.create', {
    preHandler: [budget],
    handler: async (request, reply) => {
      noStore(reply)

      const now = new Date()
      const row = await createReferralCode(prisma, {
        body: request.body,
        actor: request.actor,
        now,
        requestId: request.id,
      })

      // Ids only: never the row, never its text.
      request.log.info({ referralCodeId: row.id }, 'referral code created')

      return { data: await adminReferralCode(prisma, row.id, now) }
    },
  })

  defineRoute(app, 'referralCodes.get', {
    handler: async (request, reply) => {
      noStore(reply)

      const { data, page, perPage, total } = await referralCodeDetail(
        prisma,
        request.params.id,
        request.query ?? {},
        new Date(),
      )

      return { data, pagination: buildPaginationMeta({ page, perPage, total }) }
    },
  })

  defineRoute(app, 'referralCodes.update', {
    preHandler: [budget],
    handler: async (request, reply) => {
      noStore(reply)

      const now = new Date()
      const row = await updateReferralCode(prisma, {
        id: request.params.id,
        body: request.body,
        actor: request.actor,
        now,
        requestId: request.id,
      })

      return { data: await adminReferralCode(prisma, row.id, now) }
    },
  })

  defineRoute(app, 'referralCodes.switchOff', {
    preHandler: [budget],
    handler: async (request, reply) => {
      noStore(reply)

      const now = new Date()
      const row = await switchReferralCode(prisma, {
        id: request.params.id,
        active: false,
        reason: request.body?.reason ?? null,
        actor: request.actor,
        now,
        requestId: request.id,
      })

      return { data: await adminReferralCode(prisma, row.id, now) }
    },
  })

  defineRoute(app, 'referralCodes.switchOn', {
    preHandler: [budget],
    handler: async (request, reply) => {
      noStore(reply)

      const now = new Date()
      const row = await switchReferralCode(prisma, {
        id: request.params.id,
        active: true,
        actor: request.actor,
        now,
        requestId: request.id,
      })

      return { data: await adminReferralCode(prisma, row.id, now) }
    },
  })
}
