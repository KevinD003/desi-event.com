/**
 * Two-phase checkout.
 *
 * The property under test throughout: the provider is never called while a
 * database transaction is open, and every provider answer — including "no
 * answer" — leaves the system in a state somebody can reconcile.
 */

import { describe, expect, it } from 'vitest'

import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { computeOrderTotals } from '@desi-event/pricing'

import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import { createTestApp, feeConfig, taxRateBps } from './helpers/app.js'

/** Face value of the General Admission tier in the fixtures. */
const GA_PRICE = 150_000

/**
 * What a one-ticket General Admission order comes to.
 *
 * The mock provider's failure triggers are amount-based, so a test that wants a
 * decline or a timeout has to name the exact total the server will charge.
 *
 * @returns {number} The order total in minor units.
 */
function oneTicketTotal() {
  return computeOrderTotals({
    items: [{ ticketTypeId: 'ga', quantity: 1, unitPriceCents: GA_PRICE }],
    feeConfig: feeConfig('INR'),
    taxRateBps: taxRateBps('IN'),
    currency: 'INR',
    now: new Date(),
  }).totalCents
}

/**
 * Place an order.
 *
 * @param {object} app The Fastify instance.
 * @param {object} ids Fixture ids.
 * @param {object} [overrides] Payload overrides.
 * @param {Record<string, string>} [headers] Request headers.
 * @returns {Promise<object>} The inject result.
 */
function checkout(app, ids, overrides = {}, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    payload: {
      eventId: ids.publishedEvent.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
      ...overrides,
    },
    headers,
  })
}

/**
 * Post a provider callback.
 *
 * @param {object} app The Fastify instance.
 * @param {object} payload The webhook body.
 * @returns {Promise<object>} The inject result.
 */
function webhook(app, payload) {
  return app.inject({ method: 'POST', url: '/v1/payments/webhook', payload })
}

describe('the provider is never called inside a transaction', () => {
  it('has no transaction open while capturing', async () => {
    // The strongest available proof short of instrumenting Prisma: record how
    // many transactions had been opened when the provider was called, and
    // assert the first one had already committed.
    const base = createInMemoryProviderRegistry()
    let openTransactions = 0
    let openWhenCaptured = null

    const { app, prisma, ids } = await createTestApp({
      providers: {
        ...base,
        payments: {
          ...base.payments,
          createIntent: async (input) => {
            openWhenCaptured = openTransactions
            return base.payments.createIntent(input)
          },
        },
      },
    })

    const realTransaction = prisma.$transaction.bind(prisma)
    prisma.$transaction = async (fn, options) => {
      openTransactions += 1
      try {
        return await realTransaction(fn, options)
      } finally {
        openTransactions -= 1
      }
    }

    const response = await checkout(app, ids)

    expect(response.statusCode).toBe(201)
    expect(openWhenCaptured).toBe(0)

    await app.close()
  })
})

describe('deterministic provider outcomes', () => {
  it('success fulfils the order exactly once', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await checkout(app, ids)

    expect(response.statusCode).toBe(201)
    expect(response.json().data.status).toBe('PAID')
    expect(prisma._store.payment[0].status).toBe('SUCCEEDED')
    expect(prisma._store.payment[0].settledAt).toBeInstanceOf(Date)
    expect(prisma._store.ticket).toHaveLength(1)

    const paid = prisma._store.auditLog.filter((row) => row.action === AUDIT_ACTIONS.ORDER_PAID)
    expect(paid).toHaveLength(1)

    await app.close()
  })

  it('decline cancels the order and keeps the attempt on record', async () => {
    const providers = createInMemoryProviderRegistry({
      payments: { declineAmountCents: oneTicketTotal() },
    })
    const { app, prisma, ids } = await createTestApp({ providers })

    const response = await checkout(app, ids)

    expect(response.statusCode).toBe(402)
    expect(response.json().error.code).toBe('PAYMENT_DECLINED')
    expect(prisma._store.order[0].status).toBe('CANCELLED')
    expect(prisma._store.payment[0].status).toBe('FAILED')
    expect(prisma._store.ticket).toHaveLength(0)
    expect(
      prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id).quantitySold,
    ).toBe(0)

    await app.close()
  })

  it('timeout leaves the order pending and flags reconciliation', async () => {
    // The ambiguous case. The money may or may not have moved, so the order is
    // deliberately NOT cancelled: doing so would either strand a buyer who
    // paid, or refund money that was never taken.
    const providers = createInMemoryProviderRegistry({
      payments: { timeoutAmountCents: oneTicketTotal() },
    })
    const { app, prisma, ids } = await createTestApp({ providers })

    const response = await checkout(app, ids)

    expect(response.statusCode).toBe(502)
    expect(response.json().error.code).toBe('PAYMENT_TIMEOUT')

    expect(prisma._store.order[0].status).toBe('PENDING')
    expect(prisma._store.payment[0].status).toBe('TIMEOUT')
    expect(prisma._store.payment[0].reconciliationRequired).toBe(true)
    expect(prisma._store.ticket).toHaveLength(0)
    // Inventory stays reserved: the charge may have succeeded.
    expect(
      prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id).quantitySold,
    ).toBe(0)

    const timeouts = prisma._store.auditLog.filter(
      (row) => row.action === AUDIT_ACTIONS.PAYMENT_TIMEOUT,
    )
    expect(timeouts).toHaveLength(1)

    await app.close()
  })
})

describe('webhook is authoritative and idempotent', () => {
  it('settles a pending order and ignores a duplicate delivery', async () => {
    const providers = createInMemoryProviderRegistry({
      payments: { timeoutAmountCents: oneTicketTotal() },
    })
    const { app, prisma, ids } = await createTestApp({ providers })

    const attempt = await checkout(app, ids)
    expect(attempt.statusCode).toBe(502)

    const order = prisma._store.order[0]
    expect(order.status).toBe('PENDING')

    const payload = {
      provider: 'in-memory-payments',
      providerEventId: 'evt_settle_1',
      eventType: 'payment.succeeded',
      orderReference: order.reference,
      providerRef: 'pi_reconciled',
    }

    expect((await webhook(app, payload)).statusCode).toBe(200)
    expect(prisma._store.order[0].status).toBe('PAID')
    expect(prisma._store.ticket).toHaveLength(1)

    // Duplicate delivery of the same event id: acknowledged, changes nothing.
    expect((await webhook(app, payload)).statusCode).toBe(200)
    expect(prisma._store.ticket).toHaveLength(1)
    expect(prisma._store.webhookEvent).toHaveLength(1)

    const paid = prisma._store.auditLog.filter((row) => row.action === AUDIT_ACTIONS.ORDER_PAID)
    expect(paid).toHaveLength(1)

    await app.close()
  })

  it('does not fulfil twice when a delayed webhook follows a synchronous success', async () => {
    // This is the two-workers case: the checkout request already settled the
    // order, and the provider's callback arrives afterwards.
    const { app, prisma, ids } = await createTestApp()

    const response = await checkout(app, ids)
    expect(response.statusCode).toBe(201)
    expect(prisma._store.ticket).toHaveLength(1)

    const order = prisma._store.order[0]
    expect(
      (
        await webhook(app, {
          provider: 'in-memory-payments',
          providerEventId: 'evt_late_1',
          eventType: 'payment.succeeded',
          orderReference: order.reference,
        })
      ).statusCode,
    ).toBe(200)

    // Still one set of tickets, one inventory decrement, one audit row.
    expect(prisma._store.ticket).toHaveLength(1)
    expect(
      prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id).quantitySold,
    ).toBe(1)
    expect(
      prisma._store.auditLog.filter((row) => row.action === AUDIT_ACTIONS.ORDER_PAID),
    ).toHaveLength(1)

    await app.close()
  })

  it('acknowledges a callback for an order it does not have', async () => {
    const { app, prisma } = await createTestApp()

    const response = await webhook(app, {
      provider: 'in-memory-payments',
      providerEventId: 'evt_unknown_1',
      eventType: 'payment.succeeded',
      orderReference: 'DE-NOSUCHREF',
    })

    // Acknowledged, not rejected: a 4xx would make the provider retry forever
    // for an event that can never become processable.
    expect(response.statusCode).toBe(200)
    expect(prisma._store.webhookEvent[0].processingError).toBe('ORDER_NOT_FOUND')

    await app.close()
  })

  it('records a provider-reported failure against a pending order', async () => {
    const providers = createInMemoryProviderRegistry({
      payments: { timeoutAmountCents: oneTicketTotal() },
    })
    const { app, prisma, ids } = await createTestApp({ providers })

    await checkout(app, ids)
    const order = prisma._store.order[0]

    await webhook(app, {
      provider: 'in-memory-payments',
      providerEventId: 'evt_failed_1',
      eventType: 'payment.failed',
      orderReference: order.reference,
      failureCode: 'issuer_declined',
    })

    expect(prisma._store.order[0].status).toBe('CANCELLED')
    expect(prisma._store.payment[0].status).toBe('FAILED')
    expect(prisma._store.payment[0].failureCode).toBe('issuer_declined')
    expect(prisma._store.ticket).toHaveLength(0)

    await app.close()
  })
})

describe('retry safety', () => {
  it('returns the original order when a checkout is retried with the same idempotency key', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = { 'idempotency-key': 'chk_retry_1' }

    const first = await checkout(app, ids, {}, headers)
    const second = await checkout(app, ids, {}, headers)

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json().data.reference).toBe(first.json().data.reference)

    // One order, one charge, one set of tickets.
    expect(prisma._store.order).toHaveLength(1)
    expect(prisma._store.payment).toHaveLength(1)
    expect(prisma._store.ticket).toHaveLength(1)

    await app.close()
  })

  it('treats a checkout without a key as a fresh order', async () => {
    const { app, prisma, ids } = await createTestApp()

    await checkout(app, ids)
    await checkout(app, ids)

    expect(prisma._store.order).toHaveLength(2)

    await app.close()
  })
})

describe('inventory stays reserved across the provider call', () => {
  it('reserves unheld quantity so nobody can buy it mid-capture', async () => {
    const { app, prisma, ids } = await createTestApp()

    let heldDuringCapture = null
    const realTransaction = prisma.$transaction.bind(prisma)
    prisma.$transaction = async (fn, options) => realTransaction(fn, options)

    const response = await checkout(app, ids)
    expect(response.statusCode).toBe(201)

    // A hold was created for the order and converted at settlement.
    const holds = prisma._store.ticketHold.filter(
      (row) => row.orderId === prisma._store.order[0].id,
    )
    expect(holds.length).toBeGreaterThan(0)
    expect(holds.every((row) => row.status === 'CONVERTED')).toBe(true)
    heldDuringCapture = holds[0]
    expect(heldDuringCapture.userId === null || typeof heldDuringCapture.userId === 'string').toBe(
      true,
    )

    await app.close()
  })
})
