/**
 * The webhook endpoint, and what a verified event does.
 *
 * The properties worth a request rather than a unit test are all about what
 * happens *twice*: a duplicate delivery, a replay, an out-of-order pair. Those
 * cannot be seen in a pure function, because the whole question is what the second
 * write does to the state the first one left.
 *
 * Every delivery here is signed locally with a known secret, which is the only
 * honest way to test signature verification without credentials: sign, check the
 * verifier agrees, mutate one byte, check it does not.
 *
 * @module @desi-event/api/tests/webhooks
 */

import { describe, expect, it } from 'vitest'

import { PAYMENT_MODES, signPayload } from '@desi-event/providers'

import { makeWorld } from './helpers/fixtures.js'
import { createTestApp } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

/** The account endpoint's signing secret. Fabricated for these tests. */
const SECRET = 'whsec_fake_account_secret_for_api_tests'

/** The Connect endpoint's. Deliberately different. */
const CONNECT_SECRET = 'whsec_fake_connect_secret_for_api_tests'

/**
 * A payment mode resolution in sandbox mode, with signing secrets attached the
 * way `resolvePaymentMode` attaches them.
 *
 * @returns {object} The resolution.
 */
function sandboxPayments() {
  const value = { mode: PAYMENT_MODES.STRIPE_TEST, demo: true, live: false, label: 'SANDBOX' }

  Object.defineProperty(value, 'credentials', {
    value: Object.freeze({
      secretKey: 'sk_test_NOT_A_REAL_KEY_FIXTURE_api',
      webhookSecret: SECRET,
      connectWebhookSecret: CONNECT_SECRET,
    }),
    enumerable: false,
  })

  return value
}

/**
 * A harness with a pending payment waiting on a webhook.
 *
 * @param {object} [options] Options.
 * @param {object} [options.payment] Fields to change on the payment.
 * @param {object} [options.order] Fields to change on the order.
 * @returns {Promise<object>} The harness plus the ids.
 */
async function createWebhookApp({ payment = {}, order = {} } = {}) {
  const world = await makeWorld()
  const { seed, ids } = world

  const orderId = cuid()
  const paymentId = cuid()
  const providerRef = 'pi_test_fixture_1'

  seed.order = [
    ...(seed.order ?? []),
    {
      id: orderId,
      eventId: ids.publishedEvent.id,
      reference: 'WEBHOOK-1',
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      status: 'PENDING',
      currency: 'INR',
      subtotalCents: 250_000,
      totalCents: 250_000,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...order,
    },
  ]
  seed.payment = [
    ...(seed.payment ?? []),
    {
      id: paymentId,
      orderId,
      provider: 'stripe',
      providerRef,
      status: 'PENDING',
      amountCents: 250_000,
      currency: 'INR',
      attemptNumber: 1,
      reconciliationRequired: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...payment,
    },
  ]

  const harness = await createTestApp({
    seed,
    ids,
    payments: sandboxPayments(),
    processInline: true,
  })

  return { ...harness, orderId, paymentId, providerRef }
}

/**
 * Post a signed delivery.
 *
 * @param {object} app The Fastify instance.
 * @param {object} event The Stripe event.
 * @param {object} [options] Options.
 * @param {string} [options.secret] The secret to sign with.
 * @param {string} [options.url] Which endpoint.
 * @param {Buffer} [options.rawBody] Override the bytes that are sent.
 * @returns {Promise<object>} The response.
 */
function deliver(app, event, { secret = SECRET, url = '/v1/webhooks/stripe', rawBody } = {}) {
  const signed = Buffer.from(JSON.stringify(event))
  const body = rawBody ?? signed

  return app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signPayload(signed, secret),
    },
    payload: body,
  })
}

/**
 * A `payment_intent` event.
 *
 * @param {string} type The event type.
 * @param {object} [object] Fields for the intent.
 * @param {object} [extra] Fields for the event.
 * @returns {object} The event.
 */
function intentEvent(type, object = {}, extra = {}) {
  return {
    id: `evt_${type}_${Math.random().toString(36).slice(2, 10)}`,
    type,
    created: Math.floor(Date.now() / 1000),
    api_version: '2025-08-27.basil',
    data: {
      object: {
        id: 'pi_test_fixture_1',
        object: 'payment_intent',
        amount: 250_000,
        currency: 'inr',
        status: type === 'payment_intent.succeeded' ? 'succeeded' : 'requires_payment_method',
        ...object,
      },
    },
    ...extra,
  }
}

describe('POST /v1/webhooks/stripe', () => {
  it('stores a verified delivery and acknowledges it', async () => {
    const { app, prisma } = await createWebhookApp()

    const response = await deliver(app, intentEvent('payment_intent.succeeded'))

    expect(response.statusCode).toBe(200)
    expect(prisma._store.webhookEvent).toHaveLength(1)
    expect(prisma._store.webhookEvent[0].state).toBe('PROCESSED')

    await app.close()
  })

  it('marks the payment and the order paid', async () => {
    const { app, prisma, paymentId, orderId } = await createWebhookApp()

    await deliver(app, intentEvent('payment_intent.succeeded'))

    expect(prisma._store.payment.find((row) => row.id === paymentId).status).toBe('SUCCEEDED')
    expect(prisma._store.order.find((row) => row.id === orderId).status).toBe('PAID')

    await app.close()
  })

  it.each([
    ['no signature at all', {}],
    ['a signature from the wrong secret', { secret: CONNECT_SECRET }],
  ])('refuses a delivery with %s', async (_label, options) => {
    const { app, prisma } = await createWebhookApp()

    const response =
      Object.keys(options).length === 0
        ? await app.inject({
            method: 'POST',
            url: '/v1/webhooks/stripe',
            headers: { 'content-type': 'application/json' },
            payload: Buffer.from(JSON.stringify(intentEvent('payment_intent.succeeded'))),
          })
        : await deliver(app, intentEvent('payment_intent.succeeded'), options)

    expect(response.statusCode).toBe(400)
    expect(prisma._store.webhookEvent).toHaveLength(0)

    await app.close()
  })

  it('refuses a body that changed after it was signed', async () => {
    const { app, prisma } = await createWebhookApp()
    const event = intentEvent('payment_intent.succeeded')
    const tampered = Buffer.from(JSON.stringify(event).replace('250000', '1'))

    const response = await deliver(app, event, { rawBody: tampered })

    // The amount was edited in flight. Nothing is stored and nothing is paid.
    expect(response.statusCode).toBe(400)
    expect(prisma._store.webhookEvent).toHaveLength(0)
    expect(prisma._store.payment.at(-1).status).toBe('PENDING')

    await app.close()
  })

  it('tells a failed sender nothing about why', async () => {
    const { app } = await createWebhookApp()

    const response = await deliver(app, intentEvent('payment_intent.succeeded'), {
      secret: CONNECT_SECRET,
    })

    const body = response.json()
    expect(body.error.message).toBe('This delivery could not be verified.')
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(JSON.stringify(body)).not.toContain('timestamp')

    await app.close()
  })

  it('refuses every delivery when no Stripe credentials are configured', async () => {
    // Mock mode. A deployment with no Stripe integration must not accept Stripe
    // webhooks, and there is deliberately no "accept anything in mock mode" path.
    const world = await makeWorld()
    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })

    const response = await deliver(app, intentEvent('payment_intent.succeeded'))

    expect(response.statusCode).toBe(400)
    expect(prisma._store.webhookEvent ?? []).toHaveLength(0)

    await app.close()
  })
})

describe('duplicates and replay', () => {
  it('stores one row for two deliveries of the same event', async () => {
    const { app, prisma } = await createWebhookApp()
    const event = intentEvent('payment_intent.succeeded')

    const first = await deliver(app, event)
    const second = await deliver(app, event)

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.json().duplicate).toBe(true)
    expect(prisma._store.webhookEvent).toHaveLength(1)

    await app.close()
  })

  it('pays the order once, however many times the event arrives', async () => {
    const { app, prisma, paymentId } = await createWebhookApp()
    const event = intentEvent('payment_intent.succeeded')

    for (let attempt = 0; attempt < 4; attempt += 1) await deliver(app, event)

    const paid = prisma._store.auditLog.filter((row) => row.action === 'order.paid')

    // One settlement, one audit entry. The second delivery's conditional update
    // matches nothing, which is what makes acknowledging a delivery safe.
    expect(paid).toHaveLength(1)
    expect(prisma._store.payment.find((row) => row.id === paymentId).status).toBe('SUCCEEDED')

    await app.close()
  })

  it('treats two distinct events for the same payment as two deliveries', async () => {
    const { app, prisma } = await createWebhookApp()

    await deliver(app, intentEvent('payment_intent.succeeded'))
    await deliver(app, intentEvent('payment_intent.succeeded'))

    // Different event ids, so two rows — and still one settlement.
    expect(prisma._store.webhookEvent).toHaveLength(2)
    expect(prisma._store.auditLog.filter((row) => row.action === 'order.paid')).toHaveLength(1)

    await app.close()
  })

  it('stores the same event id separately for two connected accounts', async () => {
    const { app, prisma } = await createWebhookApp()
    const id = 'evt_shared_across_accounts'

    await deliver(
      app,
      { ...intentEvent('payment_intent.succeeded'), id, account: 'acct_one' },
      { secret: CONNECT_SECRET, url: '/v1/webhooks/stripe/connect' },
    )
    await deliver(
      app,
      { ...intentEvent('payment_intent.succeeded'), id, account: 'acct_two' },
      { secret: CONNECT_SECRET, url: '/v1/webhooks/stripe/connect' },
    )

    // The same provider event id in two account contexts is two facts, not a
    // duplicate — which is why the unique index carries the account.
    expect(prisma._store.webhookEvent).toHaveLength(2)

    await app.close()
  })
})

describe('out-of-order arrivals', () => {
  it('does not un-pay a paid order when a failure arrives afterwards', async () => {
    const { app, prisma, paymentId, orderId } = await createWebhookApp()

    await deliver(app, intentEvent('payment_intent.succeeded'))
    await deliver(
      app,
      intentEvent('payment_intent.payment_failed', {
        status: 'requires_payment_method',
        last_payment_error: { code: 'card_declined' },
      }),
    )

    // Stripe does not guarantee order, and a failure for an earlier attempt can
    // arrive after a success for a later one. Writing unconditionally here would
    // un-pay a paid order.
    expect(prisma._store.payment.find((row) => row.id === paymentId).status).toBe('SUCCEEDED')
    expect(prisma._store.order.find((row) => row.id === orderId).status).toBe('PAID')

    await app.close()
  })

  it('records the late failure rather than discarding it', async () => {
    const { app, prisma } = await createWebhookApp()

    await deliver(app, intentEvent('payment_intent.succeeded'))
    await deliver(app, intentEvent('payment_intent.payment_failed'))

    const rows = prisma._store.webhookEvent
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.state === 'PROCESSED')).toBe(true)

    await app.close()
  })

  it('does not pay an order that was cancelled while the payment was in flight', async () => {
    const { app, prisma, orderId, paymentId } = await createWebhookApp({
      order: { status: 'CANCELLED' },
    })

    await deliver(app, intentEvent('payment_intent.succeeded'))

    // The payment is recorded — money did move — but the cancelled order is not
    // resurrected. That divergence is what reconciliation exists to resolve, and
    // silently re-opening the order would hide it.
    expect(prisma._store.payment.find((row) => row.id === paymentId).status).toBe('SUCCEEDED')
    expect(prisma._store.order.find((row) => row.id === orderId).status).toBe('CANCELLED')

    await app.close()
  })
})

describe('drift', () => {
  it.each([
    ['a different amount', { amount: 1 }],
    ['a different currency', { currency: 'usd' }],
  ])('refuses an event with %s and opens a reconciliation task', async (_label, object) => {
    const { app, prisma, paymentId } = await createWebhookApp()

    const response = await deliver(app, intentEvent('payment_intent.succeeded', object))

    // 200: the delivery was genuine and is stored. But nothing is applied.
    expect(response.statusCode).toBe(200)
    expect(prisma._store.payment.find((row) => row.id === paymentId).status).toBe('PENDING')

    const tasks = prisma._store.reconciliationTask
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ kind: 'PROVIDER_MISMATCH', state: 'OPEN' })

    await app.close()
  })

  it('records both sides of the disagreement, so an operator can see it', async () => {
    const { app, prisma } = await createWebhookApp()

    await deliver(app, intentEvent('payment_intent.succeeded', { amount: 1 }))

    const [task] = prisma._store.reconciliationTask
    expect(task.localState).toMatchObject({ amountCents: 250_000, currency: 'INR' })
    expect(task.providerState).toMatchObject({ amount: 1 })

    await app.close()
  })

  it('opens one task for repeated drift, not one per delivery', async () => {
    const { app, prisma } = await createWebhookApp()

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await deliver(app, intentEvent('payment_intent.succeeded', { amount: 1 }))
    }

    expect(prisma._store.reconciliationTask).toHaveLength(1)
    expect(prisma._store.reconciliationTask[0].attempts).toBe(3)

    await app.close()
  })

  it('opens a task for an event naming a payment this system has never seen', async () => {
    const { app, prisma } = await createWebhookApp()

    await deliver(app, intentEvent('payment_intent.succeeded', { id: 'pi_never_heard_of' }))

    const [task] = prisma._store.reconciliationTask
    expect(task).toMatchObject({ kind: 'PROVIDER_MISMATCH', providerRef: 'pi_never_heard_of' })

    await app.close()
  })
})

describe('unhandled event types', () => {
  it('records and ignores a type with no handler', async () => {
    const { app, prisma } = await createWebhookApp()

    const response = await deliver(app, {
      id: 'evt_invoice',
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_test' } },
    })

    // Acknowledged, so Stripe stops retrying; stored and marked IGNORED, so
    // somebody asking why nothing happened has an answer.
    expect(response.statusCode).toBe(200)
    expect(prisma._store.webhookEvent[0].state).toBe('IGNORED')

    await app.close()
  })

  it('does not open a reconciliation task for a type it simply does not handle', async () => {
    const { app, prisma } = await createWebhookApp()

    await deliver(app, {
      id: 'evt_sub',
      type: 'customer.subscription.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'sub_test' } },
    })

    expect(prisma._store.reconciliationTask ?? []).toHaveLength(0)

    await app.close()
  })
})

describe('what a stored payload carries', () => {
  it('keeps the identifiers and the amount', async () => {
    const { app, prisma } = await createWebhookApp()

    await deliver(app, intentEvent('payment_intent.succeeded'))

    const [row] = prisma._store.webhookEvent
    expect(row.payload.data.object.id).toBe('pi_test_fixture_1')
    expect(row.payload.data.object.amount).toBe(250_000)
    expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/)

    await app.close()
  })

  it('drops the buyer personal fields Stripe echoes', async () => {
    const { app, prisma } = await createWebhookApp()

    await deliver(
      app,
      intentEvent('payment_intent.succeeded', {
        receipt_email: 'priya@example.com',
        shipping: { name: 'Priya Sharma', address: { line1: '12 Example Road' } },
        charges: {
          data: [
            {
              billing_details: { email: 'priya@example.com', name: 'Priya Sharma' },
              payment_method_details: { card: { last4: '4242' } },
            },
          ],
        },
      }),
    )

    const serialised = JSON.stringify(prisma._store.webhookEvent[0].payload)

    // A webhook payload is stored indefinitely and read by support. It should
    // carry identifiers and amounts.
    expect(serialised).not.toContain('priya@example.com')
    expect(serialised).not.toContain('Priya Sharma')
    expect(serialised).not.toContain('12 Example Road')
    expect(serialised).not.toContain('4242')

    await app.close()
  })

  it('records the API version the payload was produced against', async () => {
    const { app, prisma } = await createWebhookApp()

    await deliver(app, intentEvent('payment_intent.succeeded'))

    // A payload is only interpretable against the version that produced it.
    expect(prisma._store.webhookEvent[0].apiVersion).toBe('2025-08-27.basil')

    await app.close()
  })
})

describe('the Connect endpoint', () => {
  it('verifies against its own secret and not the account secret', async () => {
    const { app } = await createWebhookApp()
    const event = {
      id: 'evt_account_updated',
      type: 'account.updated',
      account: 'acct_organiser',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'acct_organiser', charges_enabled: true, payouts_enabled: true } },
    }

    const wrong = await deliver(app, event, {
      secret: SECRET,
      url: '/v1/webhooks/stripe/connect',
    })
    const right = await deliver(app, event, {
      secret: CONNECT_SECRET,
      url: '/v1/webhooks/stripe/connect',
    })

    expect(wrong.statusCode).toBe(400)
    expect(right.statusCode).toBe(200)

    await app.close()
  })

  it('updates a connected account from a signed account.updated', async () => {
    const world = await makeWorld()
    const { seed, ids } = world

    seed.connectedAccount = [
      {
        id: cuid(),
        organizationId: ids.organization.id,
        provider: 'stripe',
        providerAccountId: 'acct_organiser',
        providerMode: 'test',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        onboardingStatus: 'IN_PROGRESS',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const { app, prisma } = await createTestApp({
      seed,
      ids,
      payments: sandboxPayments(),
      processInline: true,
    })

    await deliver(
      app,
      {
        id: 'evt_account_updated_2',
        type: 'account.updated',
        account: 'acct_organiser',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'acct_organiser',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            requirements: {
              currently_due: ['individual.id_number'],
              past_due: [],
              disabled_reason: null,
            },
          },
        },
      },
      { secret: CONNECT_SECRET, url: '/v1/webhooks/stripe/connect' },
    )

    const account = prisma._store.connectedAccount[0]
    expect(account).toMatchObject({ chargesEnabled: true, payoutsEnabled: true })
    // Counts, not contents: which document Stripe is waiting for is its own page
    // to say, and is not something to keep in a row here.
    expect(account.requirementsDue).toEqual({ currentlyDue: 1, pastDue: 0 })
    expect(JSON.stringify(account)).not.toContain('id_number')

    await app.close()
  })
})
