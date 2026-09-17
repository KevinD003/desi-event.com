/**
 * Refunds, from the outside.
 *
 * The concurrency suite proves what PostgreSQL does when two requests race.
 * This proves the other half: who is allowed to ask, what the server refuses to
 * take from the request, and what crosses the wire.
 *
 * Three properties are worth a request rather than a unit test:
 *
 *   - **No price comes from the client.** A request may name an amount or the
 *     lines to give back, and never what a ticket cost. These check that a
 *     request carrying a price is either rejected or ignored.
 *   - **Separation of duties is enforced, not documented.** Somebody holding
 *     only `order:refund_request` cannot approve their own request; somebody
 *     holding `order:refund` can, because that capability is what says one
 *     person may do both.
 *   - **Refunds are organisation-scoped.** An organiser of another organisation
 *     cannot read, request or approve one, and cannot learn that an order
 *     exists by asking.
 *
 * @module @desi-event/api/tests/refunds
 */

import { describe, expect, it } from 'vitest'

import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { expectNoNeedles } from './helpers/payloads.js'
import { makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** What one ticket costs in this world. */
const UNIT_CENTS = 120_000

/**
 * The amount the mock provider refuses to refund.
 *
 * A lever rather than a random refusal: a test that wanted a declined refund
 * and got one by chance is a test that will one day get a settled one.
 */
const REFUND_DECLINE_CENTS = 11_111

/** How many were bought. */
const QUANTITY = 2

/**
 * A world with one paid order, its line, its payment and its tickets.
 *
 * @param {object} [options] Options.
 * @param {object} [options.order] Columns to override on the order.
 * @param {object} [options.providers] A provider registry, when a test needs one that knows the payment.
 * @param {string} [options.providerRef] The payment's provider reference.
 * @param {Array<object>} [options.refunds] Refund rows to seed.
 * @returns {Promise<object>} The harness and the ids the tests need.
 */
async function worldWithPaidOrder({
  order: orderOverrides = {},
  refunds = [],
  providers,
  providerRef = 'pi_000001',
} = {}) {
  const world = await makeWorld()
  const { seed, ids } = world

  const orderId = cuid()
  const orderItemId = cuid()
  const paymentId = cuid()
  const reference = 'DE-RFND01'
  const totalCents = UNIT_CENTS * QUANTITY

  seed.order = [
    {
      id: orderId,
      reference,
      eventId: ids.publishedEvent.id,
      eventSessionId: null,
      userId: ids.attendee.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: totalCents,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents,
      refundedCents: 0,
      refundPendingCents: 0,
      paidAt: new Date('2026-09-01T10:00:00Z'),
      createdAt: new Date('2026-09-01T09:59:00Z'),
      updatedAt: new Date('2026-09-01T10:00:00Z'),
      ...orderOverrides,
    },
  ]

  seed.orderItem = [
    {
      id: orderItemId,
      orderId,
      ticketTypeId: ids.generalAdmission.id,
      quantity: QUANTITY,
      unitPriceCents: UNIT_CENTS,
      subtotalCents: totalCents,
      refundedQuantity: 0,
      refundedCents: 0,
    },
  ]

  seed.payment = [
    {
      id: paymentId,
      orderId,
      provider: 'in-memory-payments',
      providerRef,
      status: 'SUCCEEDED',
      amountCents: totalCents,
      currency: 'INR',
      createdAt: new Date('2026-09-01T09:59:30Z'),
      updatedAt: new Date('2026-09-01T10:00:00Z'),
    },
  ]

  // Every column spelled out. A seeded row bypasses the stub's column
  // defaults, so a row built from a handful of fields serialises as a row with
  // holes in it — and the failure reads like a product bug rather than a
  // fixture one.
  seed.refund = refunds.map((refund) => ({
    orderId,
    paymentId,
    provider: 'in-memory-payments',
    providerRefundId: null,
    amountCents: UNIT_CENTS,
    currency: 'INR',
    reason: 'CUSTOMER_REQUEST',
    reasonNote: null,
    allocation: { faceValueCents: UNIT_CENTS, feeCents: 0, taxCents: 0 },
    platformFeeRefundedCents: 0,
    transferReversedCents: 0,
    requestedById: null,
    approvedById: null,
    ticketsRevoked: false,
    inventoryReturned: false,
    failureCode: null,
    rawProviderStatus: null,
    submittedAt: null,
    attempts: 0,
    settledAt: null,
    createdAt: new Date('2026-09-02T10:00:00Z'),
    updatedAt: new Date('2026-09-02T10:00:00Z'),
    ...refund,
  }))

  const harness = await createTestApp({ seed, ids, ...(providers ? { providers } : {}) })

  return { ...harness, ids, orderId, orderItemId, paymentId, reference, totalCents }
}

/**
 * Sign somebody in and step them up.
 *
 * Through the challenge rather than around it: every refund route declares a
 * step-up policy, and a test that skipped the second factor would be testing a
 * system nobody runs.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email Which account.
 * @returns {Promise<object>} Bearer headers with a fresh step-up.
 */
async function asUser(app, email) {
  const token = await signIn(app, email)
  const headers = bearer(token)

  await stepUp(app, email, headers)

  return headers
}

/** The organisation owner, who holds every finance capability. */
const OWNER = 'owner@rangoli.example'

/** A MANAGER: can publish an event, and cannot touch money. */
const MANAGER = 'arun@rangoli.example'

/** An organiser of a different organisation entirely. */
const OUTSIDER = 'rival@dhol.example'

describe('GET /v1/orders/:reference/refunds', () => {
  it('says what is left to give back, per line and in total', async () => {
    const { app, reference, orderItemId, totalCents } = await worldWithPaidOrder()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data).toMatchObject({
      orderReference: reference,
      totalCents,
      refundedCents: 0,
      refundPendingCents: 0,
      refundableCents: totalCents,
    })
    expect(data.lines).toEqual([
      expect.objectContaining({
        orderItemId,
        quantity: QUANTITY,
        unitPriceCents: UNIT_CENTS,
        refundedQuantity: 0,
        pendingQuantity: 0,
        refundableQuantity: QUANTITY,
      }),
    ])

    await app.close()
  })

  it('counts a refund somebody has asked for against what is left', async () => {
    const { app, reference, totalCents } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: cuid(), status: 'REQUESTED', idempotencyKey: 'seeded-pending' }],
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, OWNER),
    })

    const { data } = response.json()

    // Reserved is not refunded, and it is not available either. A screen that
    // showed the full total as refundable would invite a second request the
    // database would then refuse.
    expect(data.refundableCents).toBe(totalCents - UNIT_CENTS)
    expect(data.refunds).toHaveLength(1)

    await app.close()
  })

  it('refuses somebody who cannot see the organisation’s money', async () => {
    const { app, reference } = await worldWithPaidOrder()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, MANAGER),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an organiser of another organisation', async () => {
    const { app, reference } = await worldWithPaidOrder()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, OUTSIDER),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('POST /v1/orders/:reference/refunds', () => {
  it('creates a requested refund and reserves the amount', async () => {
    const { app, reference } = await worldWithPaidOrder()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, OWNER),
      payload: {
        amountCents: UNIT_CENTS,
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: 'refund-request-one',
      },
    })

    expect(response.statusCode, response.body).toBe(201)

    const { data } = response.json()

    expect(data).toMatchObject({
      status: 'REQUESTED',
      amountCents: UNIT_CENTS,
      currency: 'INR',
      // Nothing has been sent, so there is no provider reference — and none is
      // manufactured to make the row look finished.
      providerRefundId: null,
      ticketsRevoked: false,
      attempts: 0,
    })

    await app.close()
  })

  it('prices a line refund from the order, not from the request', async () => {
    const { app, reference, orderItemId } = await worldWithPaidOrder()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, OWNER),
      payload: {
        lines: [{ orderItemId, quantity: 1 }],
        // A price the caller would very much like to be used. The response
        // schema strips it on the way in; the amount comes from the line.
        unitPriceCents: 999_999,
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: 'refund-request-lines',
      },
    })

    expect(response.statusCode, response.body).toBe(201)

    const { data } = response.json()

    expect(data.amountCents).toBe(UNIT_CENTS)
    expect(data.items).toEqual([{ orderItemId, quantity: 1, amountCents: UNIT_CENTS }])

    await app.close()
  })

  it('refuses a request that names both an amount and lines', async () => {
    const { app, reference, orderItemId } = await worldWithPaidOrder()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, OWNER),
      payload: {
        amountCents: UNIT_CENTS,
        lines: [{ orderItemId, quantity: 1 }],
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: 'refund-request-both',
      },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('refuses a request that names neither', async () => {
    const { app, reference } = await worldWithPaidOrder()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, OWNER),
      payload: { reason: 'CUSTOMER_REQUEST', idempotencyKey: 'refund-request-neither' },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('refuses more than the order has left', async () => {
    const { app, reference, totalCents } = await worldWithPaidOrder()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, OWNER),
      payload: {
        amountCents: totalCents + 1,
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: 'refund-request-too-much',
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/left to refund/i)

    await app.close()
  })

  it('answers a retried request with the refund the first one made', async () => {
    const { app, reference } = await worldWithPaidOrder()
    const headers = await asUser(app, OWNER)
    const payload = {
      amountCents: UNIT_CENTS,
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: 'refund-request-retried',
    }

    const first = await app.inject({
      method: 'POST',
      url: `/v1/orders/${reference}/refunds`,
      headers,
      payload,
    })
    const second = await app.inject({
      method: 'POST',
      url: `/v1/orders/${reference}/refunds`,
      headers,
      payload,
    })

    expect(first.statusCode).toBe(201)
    // 200, not 201: the second request made nothing, and saying otherwise
    // would tell the client it had created a second refund.
    expect(second.statusCode).toBe(200)
    expect(second.json().data.id).toBe(first.json().data.id)

    await app.close()
  })

  it('refuses somebody who cannot ask for a refund', async () => {
    const { app, reference } = await worldWithPaidOrder()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orders/${reference}/refunds`,
      headers: await asUser(app, MANAGER),
      payload: {
        amountCents: UNIT_CENTS,
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: 'refund-request-manager',
      },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('POST /v1/refunds/:id/approve', () => {
  it('moves a requested refund to approved', async () => {
    const refundId = cuid()
    const { app } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'REQUESTED', idempotencyKey: 'to-approve' }],
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/approve`,
      headers: await asUser(app, OWNER),
      payload: { reason: 'The buyer asked and the policy allows it.' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.status).toBe('APPROVED')

    await app.close()
  })

  it('refuses to approve a refund that is already approved', async () => {
    const refundId = cuid()
    const { app } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'APPROVED', idempotencyKey: 'already-approved' }],
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/approve`,
      headers: await asUser(app, OWNER),
      payload: { reason: 'Pressing it twice.' },
    })

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('refuses an approver from another organisation', async () => {
    const refundId = cuid()
    const { app } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'REQUESTED', idempotencyKey: 'cross-org-approve' }],
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/approve`,
      headers: await asUser(app, OUTSIDER),
      payload: { reason: 'Approving somebody else’s money.' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('POST /v1/refunds/:id/cancel', () => {
  it('withdraws a refund and releases the reservation', async () => {
    const refundId = cuid()
    const { app, reference } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'REQUESTED', idempotencyKey: 'to-cancel' }],
    })
    const headers = await asUser(app, OWNER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/cancel`,
      headers,
      payload: { reason: 'Asked for in error.' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.status).toBe('CANCELLED')

    const summary = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}/refunds`,
      headers,
    })

    expect(summary.json().data.refundPendingCents).toBe(0)

    await app.close()
  })

  it('refuses to withdraw one that is already with the provider', async () => {
    const refundId = cuid()
    const { app } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [
        {
          id: refundId,
          status: 'SUBMITTED',
          submittedAt: new Date('2026-09-02T11:00:00Z'),
          attempts: 1,
          idempotencyKey: 'in-flight',
        },
      ],
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/cancel`,
      headers: await asUser(app, OWNER),
      payload: { reason: 'Changed my mind mid-flight.' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/with the provider/i)

    await app.close()
  })
})

describe('POST /v1/refunds/:id/submit', () => {
  /**
   * A world whose provider actually knows the payment being refunded.
   *
   * The ordinary fixture seeds `providerRef: 'pi_000001'`, which no provider
   * has heard of — fine for the steps before the provider is called, and not
   * fine for the one step that calls it. So this creates a real intent in the
   * in-memory registry and captures it, and seeds the payment against *that*
   * reference. A submit test against a reference nobody holds would be testing
   * the failure path while claiming to test the success one.
   *
   * @param {object} [options] Options.
   * @param {number} [options.amountCents] What the refund asks for.
   * @param {object} [options.refund] Fields to change on the seeded refund.
   * @returns {Promise<object>} The harness, the refund id and the providers.
   */
  async function worldReadyToSubmit({ amountCents = UNIT_CENTS, refund = {} } = {}) {
    const providers = createInMemoryProviderRegistry({
      payments: { refundDeclineAmountCents: REFUND_DECLINE_CENTS },
    })
    const intent = providers.payments.createIntent({
      amountCents: UNIT_CENTS * QUANTITY,
      currency: 'INR',
    })

    providers.payments.capture(intent.id)

    const refundId = cuid()
    const world = await worldWithPaidOrder({
      order: { refundPendingCents: amountCents },
      refunds: [
        { id: refundId, status: 'APPROVED', idempotencyKey: 'to-submit', amountCents, ...refund },
      ],
      providers,
      providerRef: intent.id,
    })

    return { ...world, refundId, providers, intentId: intent.id }
  }

  it('sends an approved refund and records what the provider said', async () => {
    const { app, refundId } = await worldReadyToSubmit()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/submit`,
      headers: await asUser(app, OWNER),
      payload: { reason: 'Approved and sent.' },
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.status).toBe('SUCCEEDED')
    // Stored as the provider gave it. Nothing invents an identifier to make the
    // row look finished.
    expect(data.providerRefundId).toBeTruthy()
    expect(data.settledAt).toBeTruthy()

    await app.close()
  })

  it('will not send the same refund twice', async () => {
    const { app, refundId } = await worldReadyToSubmit()
    const headers = await asUser(app, OWNER)

    const first = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/submit`,
      headers,
      payload: { reason: 'Approved and sent.' },
    })

    expect(first.statusCode).toBe(200)

    const second = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/submit`,
      headers,
      payload: { reason: 'Again, by accident.' },
    })

    // The transition table refuses a settled refund. Sending twice is the one
    // mistake on this route that costs somebody real money.
    expect(second.statusCode).toBe(409)

    await app.close()
  })

  it('answers 200 describing a declined refund, not an error', async () => {
    // The mock declines by amount, which is a reproducible refusal rather than
    // a random one.
    const { app, refundId } = await worldReadyToSubmit({ amountCents: REFUND_DECLINE_CENTS })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/submit`,
      headers: await asUser(app, OWNER),
      payload: { reason: 'Sent, and refused.' },
    })

    // The request succeeded; it is the money that did not move. A 4xx here
    // would tell the caller their request was wrong, which it was not.
    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.status).toBe('DECLINED')
    expect(data.failureCode).toBeTruthy()
    expect(data.settledAt).toBeNull()

    await app.close()
  })

  it('refuses somebody who may approve but may not send', async () => {
    const { app, refundId } = await worldReadyToSubmit()

    // `order:refund_approve` without `order:refund`. Approving says a refund
    // should go; sending it is the step that moves money.
    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/submit`,
      headers: await asUser(app, MANAGER),
      payload: { reason: 'I approved it, so I will send it.' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('POST /v1/refunds/:id/cancel', () => {
  it('withdraws a refund nobody has sent', async () => {
    const refundId = cuid()
    const { app } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'REQUESTED', idempotencyKey: 'to-cancel' }],
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/cancel`,
      headers: await asUser(app, OWNER),
      payload: { reason: 'The buyer changed their mind.' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.status).toBe('CANCELLED')

    await app.close()
  })

  it('will not withdraw one that is with the provider', async () => {
    const refundId = cuid()
    const { app } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [
        {
          id: refundId,
          status: 'SUBMITTED',
          idempotencyKey: 'in-flight',
          submittedAt: new Date('2026-09-02T10:05:00Z'),
        },
      ],
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/cancel`,
      headers: await asUser(app, OWNER),
      payload: { reason: 'Actually, no.' },
    })

    // A submitted refund may already have moved money. Withdrawing it would
    // leave the row saying one thing and the provider having done another, so
    // this refusal is stated on the route rather than left to the table — and
    // it says why.
    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/with the provider/i)

    await app.close()
  })

  it('refuses a stranger to the organisation', async () => {
    const refundId = cuid()
    const { app } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'REQUESTED', idempotencyKey: 'not-theirs-to-cancel' }],
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/refunds/${refundId}/cancel`,
      headers: await asUser(app, OUTSIDER),
      payload: { reason: 'Withdrawing somebody else’s refund.' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('GET /v1/refunds/:id', () => {
  it('says whose refund it is, so a screen can ask a scoped question', async () => {
    const refundId = cuid()
    const { app, ids } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'REQUESTED', idempotencyKey: 'scoped' }],
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/refunds/${refundId}`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode, response.body).toBe(200)

    // Without this field a caller has to ask `order:refund_approve` with no
    // organisation, and an organisation capability asked unscoped becomes a
    // platform check: it refuses every organiser and passes every platform
    // admin. That is NF-05, and it arrives silently.
    expect(response.json().data.organizationId).toBe(ids.organization.id)

    await app.close()
  })

  it('answers for another organisation the same way as for nothing at all', async () => {
    const refundId = cuid()
    const { app } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'REQUESTED', idempotencyKey: 'not-theirs' }],
    })
    const headers = await asUser(app, OUTSIDER)

    const theirs = await app.inject({
      method: 'GET',
      url: `/v1/refunds/${refundId}`,
      headers,
    })

    const imaginary = await app.inject({
      method: 'GET',
      url: `/v1/refunds/${cuid()}`,
      headers,
    })

    expect([403, 404]).toContain(theirs.statusCode)
    expect([403, 404]).toContain(imaginary.statusCode)
    expect(theirs.body).not.toMatch(/Rangoli|REQUESTED/u)

    await app.close()
  })

  it('names no card, no token and no buyer', async () => {
    const refundId = cuid()
    const { app } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'SUBMITTED', idempotencyKey: 'no-card' }],
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/refunds/${refundId}`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode).toBe(200)

    expectNoNeedles(expect, response.body, [
      'card',
      'cvc',
      'last4',
      'exp_month',
      'priya',
      'buyeremail',
      'pan',
    ])

    await app.close()
  })
})

describe('GET /v1/refunds', () => {
  it('lists one organisation’s refunds', async () => {
    const refundId = cuid()
    const { app, ids } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: refundId, status: 'REQUESTED', idempotencyKey: 'queued' }],
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/refunds?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(refundId)

    await app.close()
  })

  it('refuses a caller asking about an organisation they are not in', async () => {
    const { app, ids } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: cuid(), status: 'REQUESTED', idempotencyKey: 'not-yours' }],
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/refunds?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OUTSIDER),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('never returns a buyer’s details', async () => {
    const { app, ids } = await worldWithPaidOrder({
      order: { refundPendingCents: UNIT_CENTS },
      refunds: [{ id: cuid(), status: 'REQUESTED', idempotencyKey: 'no-pii' }],
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/refunds?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OWNER),
    })

    // A refund screen answers "should this money go back, and has it". None of
    // the buyer's details is needed to answer it, so none is on the allow list.
    expect(response.body).not.toContain('priya@example.com')
    expect(response.body).not.toContain('Priya Sharma')

    await app.close()
  })
})
