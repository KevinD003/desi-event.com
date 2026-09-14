/**
 * Payment provider callbacks.
 *
 * The webhook — not the browser redirect — is what fulfils an order. A redirect
 * is a message from the buyer's user agent: it can be closed before it arrives,
 * replayed from history, or forged outright. A provider callback is a message
 * from the provider.
 *
 * Every delivery is recorded against `(provider, providerEventId)`, which is
 * unique. A duplicate delivery therefore cannot be processed twice, and neither
 * can a webhook race the synchronous checkout path: both settle through the
 * same conditional update, and whichever arrives second finds the order already
 * PAID and does nothing.
 *
 * @module @desi-event/api/routes/payments
 */

import { generateTicketCode } from '../lib/identifiers.js'
import { CAPTURE_OUTCOMES, compensateCheckout, settleCheckout } from '../lib/checkout.js'
import { defineRoute } from '../lib/register.js'

/**
 * Register the payment webhook route.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerPaymentRoutes(app, { prisma }) {
  defineRoute(app, 'payments.webhook', {
    handler: async (request) => {
      const body = request.body
      const now = new Date()

      const outcome = await prisma.$transaction(async (tx) => {
        // Claim the event first. The unique index on
        // (provider, providerEventId) means a duplicate delivery loses this
        // race and is acknowledged without doing anything: that is what makes
        // replay safe rather than merely unlikely.
        const alreadySeen = await tx.webhookEvent.findFirst({
          where: { provider: body.provider, providerEventId: body.providerEventId },
        })

        if (alreadySeen) return { status: 'DUPLICATE' }

        const event = await tx.webhookEvent.create({
          data: {
            provider: body.provider,
            providerEventId: body.providerEventId,
            eventType: body.eventType,
            payload: body,
          },
        })

        const order = await tx.order.findUnique({ where: { reference: body.orderReference } })

        if (!order) {
          await tx.webhookEvent.update({
            where: { id: event.id },
            data: { processedAt: now, processingError: 'ORDER_NOT_FOUND' },
          })

          return { status: 'ORDER_NOT_FOUND' }
        }

        const payment = await tx.payment.findFirst({
          where: { orderId: order.id },
          orderBy: { attemptNumber: 'desc' },
        })

        let applied = 'NOOP'

        if (body.eventType === 'payment.succeeded') {
          const { settled } = await settleCheckout(tx, {
            order,
            payment,
            result: {
              outcome: CAPTURE_OUTCOMES.SUCCEEDED,
              intent: null,
              providerRef: body.providerRef ?? null,
              rawStatus: body.eventType,
            },
            now,
            generateTicketCode,
            requestId: request.id,
          })

          applied = settled ? 'SETTLED' : 'ALREADY_SETTLED'
        } else if (payment) {
          const { compensated } = await compensateCheckout(tx, {
            order,
            payment,
            failureCode: body.failureCode ?? 'provider_reported_failure',
            now,
            requestId: request.id,
          })

          applied = compensated ? 'CANCELLED' : 'ALREADY_FINAL'
        }

        await tx.webhookEvent.update({
          where: { id: event.id },
          data: { processedAt: now, orderId: order.id, paymentId: payment?.id ?? null },
        })

        return { status: applied, orderId: order.id }
      })

      // A callback for an order we do not have is still acknowledged. Answering
      // an error would make the provider retry forever for an event that will
      // never become processable.
      if (outcome.status === 'ORDER_NOT_FOUND') {
        request.log.warn(
          { providerEventId: request.body.providerEventId },
          'payment webhook referenced an unknown order',
        )
      } else {
        request.log.info(
          { providerEventId: request.body.providerEventId, outcome: outcome.status },
          'payment webhook processed',
        )
      }

      return { ok: true }
    },
  })
}
