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

import { databaseErrorCode, httpError } from '../lib/errors.js'
import { generateTicketCode } from '../lib/identifiers.js'
import { CAPTURE_OUTCOMES, compensateCheckout, settleCheckout } from '../lib/checkout.js'
import { MOCK_SIGNATURE_HEADER, verifyMockWebhook } from '../lib/mock-webhook.js'
import { defineRoute } from '../lib/register.js'

/**
 * Register the payment webhook route.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.env The parsed API environment, for the pass-minting secret.
 * @returns {void} Nothing.
 */
export function registerPaymentRoutes(app, { prisma, env }) {
  defineRoute(app, 'payments.webhook', {
    handler: async (request) => {
      const body = request.body
      const now = new Date()

      // Authentication, on a route that has no session to authenticate. Until
      // this existed the handler took the body's word for it, and `settleCheckout`
      // gates only on `status: 'PENDING'` — so a caller who created their own
      // order and was handed its reference could mint themselves tickets.
      //
      // Fail closed, exactly as `/v1/webhooks/stripe` does: no signature, no
      // settlement. There is no mock-mode branch that accepts an unsigned body,
      // because "we are only pretending to take payments" is not a reason to let
      // a stranger issue a ticket.
      const verification = verifyMockWebhook({
        body,
        signature: request.headers[MOCK_SIGNATURE_HEADER],
        authSecret: env.AUTH_SECRET,
        now,
      })

      if (!verification.ok) {
        // The reason goes to the log; the sender gets a bare 400 that
        // distinguishes nothing. Warn rather than error: unverifiable traffic is
        // expected on a public endpoint and should not page anybody.
        request.log.warn(
          { reason: verification.reason },
          'refused an unverifiable payment webhook delivery',
        )

        throw httpError(400, 'WEBHOOK_SIGNATURE_INVALID', 'This delivery could not be verified.')
      }

      const outcome = await prisma
        .$transaction(async (tx) => {
          // Claim the event first. The unique index on
          // (provider, providerEventId) is what makes replay safe rather than
          // merely unlikely: the read below catches the ordinary case — a
          // delivery arriving after the first was processed — and the index
          // catches the one the read cannot, which is two deliveries in flight at
          // the same instant. Both find nothing, both insert, and one of them
          // loses; that loss is handled below rather than raised, because a
          // provider that receives a 500 for a duplicate retries, which makes it
          // worse.
          //
          // The load suite found this: nine 500s per ten-second window at sixteen
          // concurrent duplicates, against a comment claiming it was already safe.
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
              credentialSecret: env.AUTH_SECRET,
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
        .catch((error) => {
          if (databaseErrorCode(error) !== 'P2002') throw error

          return { status: 'DUPLICATE' }
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
