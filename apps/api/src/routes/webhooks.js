/**
 * The webhook endpoints.
 *
 * Two routes, one per endpoint secret, and both do the same three things:
 * verify the signature over the **exact bytes**, store the delivery durably, and
 * answer 2xx. Nothing else happens inside the request.
 *
 * The raw body is the subtlety worth the most care. Fastify parses
 * `application/json` by default, and a parsed body is a body whose bytes are
 * gone — so these routes install a content-type parser of their own that keeps
 * the buffer. That parser is scoped to these routes rather than set globally,
 * because a global raw parser would silently stop validating every other request
 * body in the application.
 *
 * Processing happens from the stored row, not here: see
 * `../lib/webhook-handlers.js` for what each event does and
 * `../lib/webhook-intake.js` for why the split exists.
 *
 * @module @desi-event/api/routes/webhooks
 */

import { PAYMENT_MODES, WEBHOOK_ENDPOINTS, verifyWebhook } from '@desi-event/providers'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { httpError } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { dispatchDelivery } from '../lib/webhook-handlers.js'
import {
  claimDelivery,
  markFailed,
  markIgnored,
  markProcessed,
  storeDelivery,
} from '../lib/webhook-intake.js'

/**
 * The largest webhook body this endpoint accepts.
 *
 * Stripe's events are a few kilobytes; a megabyte is generous and bounds what an
 * unauthenticated endpoint can be made to buffer. The limit is applied before the
 * signature is checked, because buffering an unbounded body in order to decide
 * whether to trust it is the wrong order.
 *
 * @type {number}
 */
export const MAX_WEBHOOK_BYTES = 1_048_576

/**
 * Install a content-type parser that keeps the bytes.
 *
 * Registered per route via `addContentTypeParser` on a scoped instance, so the
 * rest of the API keeps its parsed, validated bodies. `parseAs: 'buffer'` is the
 * whole point: what arrives in `request.body` is what Stripe signed.
 *
 * @param {object} scope A Fastify instance scoped to the webhook routes.
 * @returns {void}
 */
export function installRawBodyParser(scope) {
  scope.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: MAX_WEBHOOK_BYTES },
    (request, body, done) => {
      // No parsing at all. Handing the buffer through unchanged is the only way
      // the signature can be checked against the bytes that were sent.
      done(null, body)
    },
  )
}

/**
 * Register the webhook routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.payments The resolved payment mode, which carries the signing secrets.
 * @param {boolean} [deps.processInline] Process a delivery before answering. Off by default; used by the tests, which have no worker.
 * @returns {void} Nothing.
 */
export function registerWebhookRoutes(app, { prisma, payments, processInline = false }) {
  /**
   * The signing secret for an endpoint, or null when none is configured.
   *
   * In mock mode there are no Stripe secrets and the endpoints refuse every
   * delivery — which is correct: a deployment with no Stripe integration should
   * not accept Stripe webhooks. There is deliberately no "accept anything in mock
   * mode" branch.
   *
   * @param {string} endpoint One of `WEBHOOK_ENDPOINTS`.
   * @returns {string|null} The secret.
   */
  function secretFor(endpoint) {
    if (payments?.mode !== PAYMENT_MODES.STRIPE_TEST) return null

    return endpoint === WEBHOOK_ENDPOINTS.CONNECT
      ? (payments.credentials?.connectWebhookSecret ?? null)
      : (payments.credentials?.webhookSecret ?? null)
  }

  /**
   * Handle one delivery.
   *
   * @param {object} request The incoming request.
   * @param {string} endpoint Which endpoint it arrived at.
   * @returns {Promise<object>} The acknowledgement body.
   * @throws {Error} A 400 when the delivery cannot be verified.
   */
  async function receive(request, endpoint) {
    const rawBody = request.body
    const signature = request.headers['stripe-signature']
    const secret = secretFor(endpoint)

    let verified

    try {
      verified = verifyWebhook({
        rawBody,
        signature: Array.isArray(signature) ? signature[0] : signature,
        secret,
      })
    } catch (error) {
      // The reason is in the error's details and goes to the log; the sender gets
      // a bare 400. Logged at warn rather than error: an unverifiable delivery is
      // expected traffic on a public endpoint.
      request.log.warn(
        { endpoint, reason: error?.details?.reason ?? null },
        'refused an unverifiable webhook delivery',
      )

      throw httpError(400, 'WEBHOOK_SIGNATURE_INVALID', 'This delivery could not be verified.')
    }

    const { row, duplicate } = await storeDelivery(prisma, { ...verified, rawBody })

    if (duplicate) {
      // Already stored. A 2xx, because the provider has done its job and should
      // stop retrying — the work, if any remains, is ours to finish from the row.
      request.log.info(
        { endpoint, providerEventId: verified.event.id, webhookEventId: row?.id ?? null },
        'webhook delivery was already stored',
      )

      return { ok: true, duplicate: true }
    }

    await recordAudit(prisma, {
      action: AUDIT_ACTIONS.WEBHOOK_RECEIVED,
      entityType: 'WebhookEvent',
      entityId: row.id,
      metadata: {
        endpoint,
        eventType: verified.event.type,
        accountContext: verified.accountContext,
      },
    })

    if (processInline) await processStoredDelivery(prisma, row, request.log)

    return { ok: true, duplicate: false }
  }

  defineRoute(app, 'webhooks.stripe', {
    handler: (request) => receive(request, WEBHOOK_ENDPOINTS.ACCOUNT),
  })

  defineRoute(app, 'webhooks.stripeConnect', {
    handler: (request) => receive(request, WEBHOOK_ENDPOINTS.CONNECT),
  })
}

/**
 * Process one stored delivery.
 *
 * Exported so the worker and the tests share exactly this path. Claims the row
 * first, so two workers cannot both process it; records what happened; and turns
 * an unexpected throw into a scheduled retry rather than a lost event.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} row The stored `WebhookEvent`.
 * @param {object} [log] A logger.
 * @returns {Promise<object>} What happened, for the caller's own logging.
 */
export async function processStoredDelivery(prisma, row, log) {
  const claimed = await claimDelivery(prisma, row)

  if (!claimed) return { outcome: 'skipped', reason: 'another worker has it' }

  try {
    const result = await dispatchDelivery(prisma, row)

    if (result.outcome === 'ignored') {
      await markIgnored(prisma, row.id)
    } else {
      await markProcessed(prisma, row.id, {
        orderId: result.orderId ?? null,
        paymentId: result.paymentId ?? null,
      })
    }

    log?.info(
      { webhookEventId: row.id, eventType: row.eventType, outcome: result.outcome },
      'processed a webhook delivery',
    )

    return result
  } catch (error) {
    // An unexpected failure. The delivery stays stored and comes back; nothing is
    // lost, and the provider was already told 2xx so it is not retrying in
    // parallel with us.
    const { state, nextAttemptAt } = await markFailed(
      prisma,
      { ...row, attemptCount: (row.attemptCount ?? 0) + 1 },
      error,
    )

    log?.error(
      { webhookEventId: row.id, eventType: row.eventType, state, nextAttemptAt },
      'failed to process a webhook delivery',
    )

    return { outcome: 'failed', state, nextAttemptAt }
  }
}
