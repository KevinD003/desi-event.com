/**
 * An event's booking fee (the platform fee) and its pay-at-the-venue switch,
 * for the Desi-Event team (SPEC3 §7, §9.1): `paymentTerms.get`,
 * `paymentTerms.setFee` and `paymentTerms.setVenuePayment`.
 *
 * The session, `payment_terms:manage` and the PAYMENT_TERMS step-up come from
 * the contract (`defineRoute`); the two writes share one `payment-terms`
 * budget of sixty an hour per administrator, run after those guards so a
 * refused caller spends nothing. The rules — any status but DELETED, never for
 * an event sold on its listing's own site, never by a member of the event's
 * organisation, compare-and-set, audit, history — are `lib/payment-terms.js`'s.
 * Every answer is `no-store`.
 *
 * @module @desi-event/api/routes/payment-terms
 */

import { paymentTermsAdminView, setEventFee, setVenuePayment } from '../lib/payment-terms.js'
import { defineRoute } from '../lib/register.js'
import { DEFAULT_PAYMENT_TERMS_LIMIT, actorBudget } from '../plugins/rate-limit.js'

/**
 * Mark a reply as never to be cached: these are administrators' reads of
 * money settings.
 *
 * @param {object} reply The reply.
 * @returns {void}
 */
function noStore(reply) {
  reply.header('cache-control', 'no-store, private')
}

/**
 * Register the booking fee and pay-at-the-venue routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.env The parsed API environment, for the site default.
 * @param {{max?: number, timeWindow?: string|number}} [deps.paymentTermsLimit] Overrides for the `payment-terms` budget.
 * @returns {void} Nothing.
 */
export function registerPaymentTermsRoutes(app, { prisma, env, paymentTermsLimit = {} } = {}) {
  // One budget for both writes: a change of fee and a change of the switch
  // draw on the same sixty an hour (SPEC3 §4.4).
  const budget = actorBudget({
    name: 'payment-terms',
    ...DEFAULT_PAYMENT_TERMS_LIMIT,
    ...paymentTermsLimit,
  })

  defineRoute(app, 'paymentTerms.get', {
    handler: async (request, reply) => {
      noStore(reply)

      return {
        data: await paymentTermsAdminView(prisma, request.params.id, {
          env,
          before: request.query?.before ?? null,
        }),
      }
    },
  })

  defineRoute(app, 'paymentTerms.setFee', {
    preHandler: [budget],
    handler: async (request, reply) => {
      noStore(reply)

      const body = request.body

      await setEventFee(prisma, {
        eventId: request.params.id,
        source: body.source,
        percentageBps: body.source === 'EVENT' ? body.percentageBps : null,
        flatCentsPerTicket: body.source === 'EVENT' ? body.flatCentsPerTicket : null,
        reason: body.reason,
        expectedSequence: body.expectedSequence,
        actor: request.actor,
        now: new Date(),
      })

      request.log.info(
        { eventId: request.params.id, source: body.source },
        'event booking fee changed',
      )

      return { data: await paymentTermsAdminView(prisma, request.params.id, { env }) }
    },
  })

  defineRoute(app, 'paymentTerms.setVenuePayment', {
    preHandler: [budget],
    handler: async (request, reply) => {
      noStore(reply)

      const body = request.body

      await setVenuePayment(prisma, {
        eventId: request.params.id,
        enabled: body.enabled,
        limit: body.limit ?? null,
        reason: body.reason,
        seen: body.seen,
        actor: request.actor,
        now: new Date(),
      })

      request.log.info(
        { eventId: request.params.id, enabled: body.enabled },
        'event pay-at-the-venue setting changed',
      )

      return { data: await paymentTermsAdminView(prisma, request.params.id, { env }) }
    },
  })
}
