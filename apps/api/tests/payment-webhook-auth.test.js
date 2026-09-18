/**
 * The payment webhook may not be an anonymous settlement oracle.
 *
 * `POST /v1/payments/webhook` is declared `auth: 'none'`, which installs no
 * guard at all — `register.js` pushes one only for `session`, `bearer` and
 * `optional`. That is correct for a provider callback: a provider has no
 * session. What makes it a hole rather than a design is that nothing else took
 * over the job. The handler accepted a body and believed it.
 *
 * The attacker does not have to guess anything. `orders.create` is
 * `auth: 'optional'`, so an anonymous guest may place an order; the order is
 * created `PENDING` and its `reference` comes back in the response. Post that
 * reference back with `eventType: 'payment.succeeded'` and `settleCheckout`
 * marks the order `PAID` and mints a ticket per unit — it gates only on
 * `status: 'PENDING'` and never asks whether a payment exists or succeeded.
 *
 * The idempotency index on `(provider, providerEventId)` is not a defence here.
 * The caller chooses both values, so a fresh id is a fresh event. It stops
 * provider retries, which is what it was built for.
 *
 * These cases assert **domain state**, not status codes: an order that stayed
 * `PENDING`, a `ticket` table that stayed empty, inventory that did not move,
 * a ledger that posted nothing. A 4xx with a ticket behind it would be a worse
 * bug than a 200.
 *
 * Every one of those facts is paired with a positive control, because an
 * assertion that something did not change is worth exactly as much as the
 * proof that it can. "The trusted mock provider still settles" is that proof:
 * it asserts the same numbers do move, order-linked, when settlement is real.
 *
 * The repository already holds the right answer for this shape of problem.
 * `/v1/webhooks/stripe` refuses every delivery it cannot verify and refuses
 * them all when no secret is configured — "There is no mode that skips
 * verification". This endpoint is brought to the same posture.
 *
 * @module @desi-event/api/tests/payment-webhook-auth.test
 */

import { describe, expect, it } from 'vitest'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { computeOrderTotals } from '@desi-event/pricing'

import { MOCK_SIGNATURE_HEADER, signMockWebhook } from '../src/lib/mock-webhook.js'
import { TEST_JWT_SECRET, createTestApp, feeConfig, taxRateBps } from './helpers/app.js'

/** Face value of the General Admission tier in the fixtures. */
const GA_PRICE = 150_000

/**
 * What a one-ticket General Admission order comes to.
 *
 * The mock provider's triggers are amount-based, so a test that wants the
 * provider to time out — and so leave the order `PENDING` — has to name the
 * exact total the server will charge.
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
 * Place an order as an anonymous guest — no session, no token, no headers.
 *
 * @param {object} app The Fastify instance.
 * @param {object} ids Fixture ids.
 * @returns {Promise<object>} The inject result.
 */
function guestCheckout(app, ids) {
  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    payload: {
      eventId: ids.publishedEvent.id,
      buyerEmail: 'guest@example.test',
      buyerName: 'Guest Buyer',
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
    },
  })
}

/**
 * Post a webhook body with no signature, exactly as an attacker would.
 *
 * @param {object} app The Fastify instance.
 * @param {object} payload The forged body.
 * @param {Record<string, string>} [headers] Extra headers.
 * @returns {Promise<object>} The inject result.
 */
function unsignedWebhook(app, payload, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/payments/webhook',
    payload,
    headers,
  })
}

/**
 * Stand up an app whose checkout leaves the order `PENDING`.
 *
 * The provider times out on this exact amount, so the buyer gets a 502 and the
 * order is left for the callback to settle — which is the state the attack
 * needs and the state a real reconciliation flow also produces.
 *
 * @returns {Promise<object>} `{ app, prisma, ids, order }`.
 */
async function pendingOrderWorld() {
  const providers = createInMemoryProviderRegistry({
    payments: { timeoutAmountCents: oneTicketTotal() },
  })
  const { app, prisma, ids } = await createTestApp({ providers })

  const attempt = await guestCheckout(app, ids)

  expect(attempt.statusCode).toBe(502)

  const order = prisma._store.order[0]

  expect(order.status).toBe('PENDING')

  return { app, prisma, ids, order }
}

/**
 * The domain facts that must not move when a forgery is refused.
 *
 * Every field here is one a legitimate settlement demonstrably *does* move —
 * that is the whole requirement for a snapshot to be worth comparing. The
 * positive control in "the trusted mock provider still settles" is what keeps
 * that true: if settlement ever stopped writing the ledger, that test fails
 * rather than this one silently degrading into a comparison of zero with zero.
 *
 * Notification outbox rows are deliberately **not** here. `settleCheckout`
 * writes no outbox row — the only writers are ticket transfer, event
 * cancellation and material-change — so asserting the outbox is unchanged after
 * a refusal would compare 0 with 0 and prove nothing about a prevented
 * notification. Claiming it as evidence would be claiming a guarantee the
 * product does not implement.
 *
 * @param {object} prisma The stub client.
 * @returns {object} A snapshot.
 */
function domainState(prisma) {
  return {
    orderStatus: prisma._store.order[0]?.status ?? null,
    paidAt: prisma._store.order[0]?.paidAt ?? null,
    tickets: prisma._store.ticket.length,
    quantitySold: prisma._store.ticketType.reduce((sum, row) => sum + (row.quantitySold ?? 0), 0),
    ledgerEntries: prisma._store.ledgerEntry?.length ?? 0,
    ledgerBatches: prisma._store.ledgerBatch?.length ?? 0,
  }
}

/**
 * The ledger this one order caused, counted through its own link.
 *
 * Order-linked rather than global: a global count would pass just as happily if
 * a batch were posted against somebody else's order, which is the failure a
 * settlement test most needs to see.
 *
 * @param {object} prisma The stub client.
 * @param {string} orderId The order to narrow to.
 * @returns {{batches: number, posted: number, entries: number, debitCents: number, creditCents: number}} Its ledger.
 */
function orderLedger(prisma, orderId) {
  const batches = (prisma._store.ledgerBatch ?? []).filter((row) => row.orderId === orderId)
  const batchIds = new Set(batches.map((row) => row.id))
  const entries = (prisma._store.ledgerEntry ?? []).filter((row) => batchIds.has(row.batchId))

  return {
    batches: batches.length,
    posted: batches.filter((row) => row.status === 'POSTED').length,
    entries: entries.length,
    debitCents: batches.reduce((sum, row) => sum + (row.debitCents ?? 0), 0),
    creditCents: batches.reduce((sum, row) => sum + (row.creditCents ?? 0), 0),
  }
}

/**
 * How many entries the paid-order batch should carry for a given order.
 *
 * Derived from the order's own money rather than hard-coded, because
 * `orderPaidBatch` emits the discount, fee and tax lines conditionally. A
 * literal would be right for today's fixture and quietly wrong the moment a
 * fixture gained a discount.
 *
 * @param {object} order The order row.
 * @returns {number} The expected entry count.
 */
function expectedLedgerEntries(order) {
  return (
    1 + // money in, to processor clearing
    (order.discountCents > 0 ? 1 : 0) +
    1 + // owed to the organiser
    (order.feesCents > 0 ? 1 : 0) +
    (order.taxCents > 0 ? 1 : 0)
  )
}

describe('an anonymous caller cannot settle an order', () => {
  it('refuses a forged success and leaves every domain fact untouched', async () => {
    const { app, prisma, order } = await pendingOrderWorld()
    const before = domainState(prisma)

    // Exactly what an attacker sends: their own order's reference, a provider
    // name they chose, an event id they invented, and the success they want.
    const response = await unsignedWebhook(app, {
      provider: 'in-memory-payments',
      providerEventId: 'evt_forged_success_1',
      eventType: 'payment.succeeded',
      orderReference: order.reference,
      // Accepted by the schema and never read by the handler. Claimed here to
      // pin that down: a caller can assert any amount, or none.
      amountCents: 1,
      currency: 'INR',
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(response.statusCode).toBeLessThan(500)

    const after = domainState(prisma)

    expect(after.orderStatus).toBe('PENDING')
    expect(after.paidAt).toBeNull()
    expect(after.tickets).toBe(0)
    expect(after).toEqual(before)

    await app.close()
  })

  it('does not mint a ticket even across many freshly-chosen event ids', async () => {
    // The idempotency index keys on values the caller picks, so a single
    // refusal is not enough: the interesting question is whether the caller can
    // walk around it. They must not be able to.
    const { app, prisma, order } = await pendingOrderWorld()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await unsignedWebhook(app, {
        provider: 'in-memory-payments',
        providerEventId: `evt_forged_walk_${attempt}`,
        eventType: 'payment.succeeded',
        orderReference: order.reference,
      })

      expect(response.statusCode).toBeGreaterThanOrEqual(400)
    }

    expect(prisma._store.order[0].status).toBe('PENDING')
    expect(prisma._store.ticket).toHaveLength(0)

    await app.close()
  })

  it('refuses a forged failure too, so an order cannot be cancelled by a stranger', async () => {
    // `payment.failed` is the other enum member and reaches `compensateCheckout`.
    // An endpoint that lets a stranger cancel somebody's order is a smaller
    // problem than one that mints tickets, and still not one to leave open.
    const { app, prisma, order } = await pendingOrderWorld()

    const response = await unsignedWebhook(app, {
      provider: 'in-memory-payments',
      providerEventId: 'evt_forged_failure_1',
      eventType: 'payment.failed',
      orderReference: order.reference,
      failureCode: 'forged',
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(prisma._store.order[0].status).toBe('PENDING')

    await app.close()
  })

  it('refuses a body carrying a signature header that is not a real signature', async () => {
    const { app, prisma, order } = await pendingOrderWorld()

    const response = await unsignedWebhook(
      app,
      {
        provider: 'in-memory-payments',
        providerEventId: 'evt_forged_garbage_sig',
        eventType: 'payment.succeeded',
        orderReference: order.reference,
      },
      { 'desi-signature': 't=1,v1=not-a-signature' },
    )

    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(prisma._store.order[0].status).toBe('PENDING')
    expect(prisma._store.ticket).toHaveLength(0)

    await app.close()
  })
})

/**
 * Post a correctly signed callback, as the mock provider would.
 *
 * @param {object} app The Fastify instance.
 * @param {object} payload The body.
 * @param {object} [options] Signing options.
 * @param {number} [options.timestamp] Override the signing timestamp.
 * @param {object} [options.tamperedInto] Send this body instead of the signed one.
 * @returns {Promise<object>} The inject result.
 */
function signedWebhook(app, payload, { timestamp, tamperedInto } = {}) {
  const signature = signMockWebhook(payload, TEST_JWT_SECRET, timestamp)

  return app.inject({
    method: 'POST',
    url: '/v1/payments/webhook',
    payload: tamperedInto ?? payload,
    headers: { [MOCK_SIGNATURE_HEADER]: signature },
  })
}

describe('the trusted mock provider still settles', () => {
  it('settles a pending order exactly once, mints one ticket, and posts its ledger', async () => {
    const { app, prisma, order } = await pendingOrderWorld()

    // The positive control for the refusal tests above. Those assert that a
    // forgery moves none of these numbers; this asserts the numbers move at all
    // when settlement is genuine. Without it, "unchanged" would be satisfied by
    // a counter that can never change, which is not evidence of anything.
    const before = orderLedger(prisma, order.id)

    expect(before).toEqual({ batches: 0, posted: 0, entries: 0, debitCents: 0, creditCents: 0 })

    const payload = {
      provider: 'in-memory-payments',
      providerEventId: 'evt_trusted_1',
      eventType: 'payment.succeeded',
      orderReference: order.reference,
      providerRef: 'pi_reconciled',
    }

    expect((await signedWebhook(app, payload)).statusCode).toBe(200)

    expect(prisma._store.order[0].status).toBe('PAID')
    expect(prisma._store.ticket).toHaveLength(1)
    expect(prisma._store.ticketType.reduce((sum, row) => sum + (row.quantitySold ?? 0), 0)).toBe(1)

    const after = orderLedger(prisma, order.id)

    // One batch, posted, linked to this order, balanced, and for exactly what
    // the buyer was charged. A batch that did not balance would not have been
    // allowed to post; asserting it here says the money recorded is the money
    // the order says it took, not merely that some rows appeared.
    expect(after.batches).toBe(1)
    expect(after.posted).toBe(1)
    expect(after.entries).toBe(expectedLedgerEntries(order))
    expect(after.debitCents).toBe(order.totalCents)
    expect(after.creditCents).toBe(order.totalCents)

    await app.close()
  })

  it('is idempotent when the same signed delivery arrives twice', async () => {
    const { app, prisma, order } = await pendingOrderWorld()

    const payload = {
      provider: 'in-memory-payments',
      providerEventId: 'evt_trusted_replay',
      eventType: 'payment.succeeded',
      orderReference: order.reference,
    }

    expect((await signedWebhook(app, payload)).statusCode).toBe(200)

    const afterFirst = orderLedger(prisma, order.id)

    expect(afterFirst.batches).toBe(1)
    expect(afterFirst.entries).toBe(expectedLedgerEntries(order))

    expect((await signedWebhook(app, payload)).statusCode).toBe(200)

    // The second delivery is acknowledged and changes nothing: one ticket, one
    // stored event, one settlement — and, the reason this matters for money,
    // one ledger batch. A replay that posted the order's revenue twice would
    // leave the books saying the buyer paid twice.
    expect(prisma._store.ticket).toHaveLength(1)
    expect(prisma._store.webhookEvent).toHaveLength(1)
    expect(orderLedger(prisma, order.id)).toEqual(afterFirst)

    await app.close()
  })

  it('does not double-issue when a second signed event names the same settled order', async () => {
    const { app, prisma, order } = await pendingOrderWorld()

    for (const providerEventId of ['evt_trusted_a', 'evt_trusted_b']) {
      const response = await signedWebhook(app, {
        provider: 'in-memory-payments',
        providerEventId,
        eventType: 'payment.succeeded',
        orderReference: order.reference,
      })

      expect(response.statusCode).toBe(200)
    }

    // Two genuinely distinct events, both signed. The order is settled once,
    // because `settleCheckout` is conditional on PENDING — signature checking
    // did not replace that guard, it sits in front of it. Inventory moves once
    // and the ledger is posted once, which is the same statement said in the
    // two places it has to be true.
    expect(prisma._store.ticket).toHaveLength(1)
    expect(prisma._store.ticketType.reduce((sum, row) => sum + (row.quantitySold ?? 0), 0)).toBe(1)

    const ledger = orderLedger(prisma, order.id)

    expect(ledger.batches).toBe(1)
    expect(ledger.entries).toBe(expectedLedgerEntries(order))

    await app.close()
  })
})

describe('a signature only covers the body it was made for', () => {
  it('refuses a body tampered with after signing', async () => {
    const { app, prisma, order } = await pendingOrderWorld()

    const signed = {
      provider: 'in-memory-payments',
      providerEventId: 'evt_tamper_1',
      eventType: 'payment.failed',
      orderReference: order.reference,
    }

    // Signed as a failure, sent as a success — the interesting tamper, because
    // it is the one that would mint a ticket.
    const response = await signedWebhook(app, signed, {
      tamperedInto: { ...signed, eventType: 'payment.succeeded' },
    })

    expect(response.statusCode).toBe(400)
    expect(prisma._store.order[0].status).toBe('PENDING')
    expect(prisma._store.ticket).toHaveLength(0)

    await app.close()
  })

  it('refuses a signature swapped onto a different order', async () => {
    const { app, prisma, order } = await pendingOrderWorld()

    const signed = {
      provider: 'in-memory-payments',
      providerEventId: 'evt_tamper_2',
      eventType: 'payment.succeeded',
      orderReference: 'DE-2345678W',
    }

    const response = await signedWebhook(app, signed, {
      tamperedInto: { ...signed, orderReference: order.reference },
    })

    expect(response.statusCode).toBe(400)
    expect(prisma._store.order[0].status).toBe('PENDING')

    await app.close()
  })

  it('refuses a correctly signed callback that is too old', async () => {
    const { app, prisma, order } = await pendingOrderWorld()

    const response = await signedWebhook(
      app,
      {
        provider: 'in-memory-payments',
        providerEventId: 'evt_stale_1',
        eventType: 'payment.succeeded',
        orderReference: order.reference,
      },
      { timestamp: Math.floor(Date.now() / 1000) - 3600 },
    )

    expect(response.statusCode).toBe(400)
    expect(prisma._store.order[0].status).toBe('PENDING')
    expect(prisma._store.ticket).toHaveLength(0)

    await app.close()
  })
})

describe('refusals say nothing they do not have to', () => {
  it('answers an unknown order exactly as it answers a known one', async () => {
    const { app, order } = await pendingOrderWorld()

    const known = await unsignedWebhook(app, {
      provider: 'in-memory-payments',
      providerEventId: 'evt_oracle_known',
      eventType: 'payment.succeeded',
      orderReference: order.reference,
    })

    const unknown = await unsignedWebhook(app, {
      provider: 'in-memory-payments',
      providerEventId: 'evt_oracle_unknown',
      eventType: 'payment.succeeded',
      orderReference: 'DE-3456789X',
    })

    // The unauthenticated caller cannot tell the two apart, so the endpoint is
    // not an oracle for which references exist. Compared on status and error
    // code rather than the whole body, because the body carries a per-request
    // id that differs by design and says nothing about the order.
    expect(unknown.statusCode).toBe(known.statusCode)
    expect(unknown.json().error.code).toBe(known.json().error.code)
    expect(unknown.json().error.message).toBe(known.json().error.message)

    await app.close()
  })
})
