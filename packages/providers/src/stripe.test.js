/**
 * The Stripe adapter, against a fake SDK.
 *
 * **Nothing here has touched Stripe.** No test credentials were available, so
 * every call goes to a recording double with the real method shapes, and what is
 * being tested is the shape of the request this system *would* send: the amounts,
 * the idempotency keys, the Connect fields, and — most of all — what is absent.
 *
 * That is a real limit and it is worth naming rather than implying. These tests
 * cannot prove Stripe accepts these calls. They can prove that the amount comes
 * from the caller and never from a request, that a retried checkout reuses its
 * idempotency key, that a decline and a timeout are not confused, and that no
 * secret and no card detail leaves this module. The sandbox execution is marked
 * EXTERNAL VERIFICATION PENDING everywhere it is mentioned.
 *
 * @module @desi-event/providers/stripe.test
 */

import { describe, expect, it } from 'vitest'

import { PAYMENT_MODES, STRIPE_API_VERSION } from '@desi-event/schemas'

import { PROVIDER_ERROR_CODES, ProviderError } from './errors.js'
import {
  DECLINE_TYPES,
  STRIPE_STATUS_MAP,
  UNKNOWN_OUTCOME_TYPES,
  createStripePaymentProvider,
  idempotencyKey,
  mapStripeError,
  safeCardMetadata,
  toAccountState,
} from './stripe.js'

/** A fabricated test key. Self-identifying; nothing Stripe ever issued. */
const SECRET_KEY = 'sk_test_NOT_A_REAL_KEY_FIXTURE_4xQp7Lm2'

/**
 * A resolution as `resolvePaymentMode` produces one, with credentials attached
 * non-enumerably.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The resolution.
 */
function resolution(overrides = {}) {
  const value = { mode: PAYMENT_MODES.STRIPE_TEST, demo: true, live: false, ...overrides }

  Object.defineProperty(value, 'credentials', {
    value: Object.freeze({ secretKey: SECRET_KEY }),
    enumerable: false,
  })

  return value
}

/**
 * A recording double with the shapes the adapter calls.
 *
 * @param {object} [responses] What each method should resolve with.
 * @returns {object} The double, with a `calls` log.
 */
function fakeStripe(responses = {}) {
  const calls = []

  /**
   * Record a call and answer.
   *
   * @param {string} method Dotted method name.
   * @param {object} [fallback] The default answer.
   * @returns {Function} The recorded method.
   */
  const record =
    (method, fallback = {}) =>
    (...args) => {
      calls.push({ method, args })

      const answer = responses[method]

      if (typeof answer === 'function') return answer(...args)
      if (answer instanceof Error) return Promise.reject(answer)

      return Promise.resolve(answer ?? fallback)
    }

  return {
    calls,
    client: {
      paymentIntents: {
        create: record('paymentIntents.create', {
          id: 'pi_fake',
          client_secret: 'pi_fake_secret_fixture',
          status: 'requires_payment_method',
          amount: 250_000,
          currency: 'inr',
        }),
        retrieve: record('paymentIntents.retrieve', {
          id: 'pi_fake',
          status: 'succeeded',
          amount: 250_000,
          amount_received: 250_000,
          currency: 'inr',
          latest_charge: {
            id: 'ch_fake',
            payment_method_details: {
              card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
            },
          },
        }),
        capture: record('paymentIntents.capture', {
          id: 'pi_fake',
          status: 'succeeded',
          amount: 250_000,
          currency: 'inr',
        }),
      },
      refunds: {
        create: record('refunds.create', {
          id: 're_fake',
          status: 'succeeded',
          amount: 100_000,
          currency: 'inr',
        }),
      },
      accounts: {
        create: record('accounts.create', {
          id: 'acct_fake',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          country: 'IN',
          requirements: {
            currently_due: ['external_account'],
            past_due: [],
            disabled_reason: null,
          },
        }),
        retrieve: record('accounts.retrieve', {
          id: 'acct_fake',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          country: 'IN',
          default_currency: 'inr',
          requirements: { currently_due: [], past_due: [], disabled_reason: null },
        }),
      },
      accountLinks: {
        create: record('accountLinks.create', {
          url: 'https://connect.stripe.test/setup/fake',
          expires_at: Math.floor(Date.now() / 1000) + 300,
        }),
      },
      transfers: {
        createReversal: record('transfers.createReversal', { id: 'trr_fake', amount: 50_000 }),
      },
    },
  }
}

/**
 * Build the adapter against a double.
 *
 * @param {object} [responses] Overrides for the double's answers.
 * @returns {object} The adapter plus the double.
 */
function adapterWith(responses) {
  const fake = fakeStripe(responses)
  const adapter = createStripePaymentProvider({
    resolution: resolution(),
    createClient: () => fake.client,
  })

  return { adapter, fake }
}

describe('createStripePaymentProvider', () => {
  it('refuses to build in mock mode', () => {
    expect(() => createStripePaymentProvider({ resolution: { mode: PAYMENT_MODES.MOCK } })).toThrow(
      ProviderError,
    )
  })

  it.each([
    ['no resolution', undefined],
    ['a resolution with no mode', {}],
    ['a resolution naming a mode that does not exist', { mode: 'LIVE' }],
  ])('refuses to build from %s', (_label, value) => {
    expect(() => createStripePaymentProvider({ resolution: value })).toThrow(ProviderError)
  })

  it('refuses to build without a secret key', () => {
    // Defence in depth: the mode resolver should have refused this
    // configuration, and the adapter does not assume it did.
    expect(() =>
      createStripePaymentProvider({ resolution: { mode: PAYMENT_MODES.STRIPE_TEST } }),
    ).toThrow(ProviderError)
  })

  it('reports the sandbox mode and the pinned API version', () => {
    const { adapter } = adapterWith()

    expect(adapter.mode).toBe(PAYMENT_MODES.STRIPE_TEST)
    expect(adapter.apiVersion).toBe(STRIPE_API_VERSION)
  })

  it('never exposes the secret key', () => {
    const { adapter } = adapterWith()

    expect(JSON.stringify(adapter)).not.toContain(SECRET_KEY)
    expect(Object.values(adapter).join(' ')).not.toContain(SECRET_KEY)
  })

  it('is frozen, so nothing can swap a method for one that logs', () => {
    const { adapter } = adapterWith()

    expect(Object.isFrozen(adapter)).toBe(true)
  })
})

describe('createIntent', () => {
  it('sends the amount the caller computed, in minor units', async () => {
    const { adapter, fake } = adapterWith()

    await adapter.createIntent({ amountCents: 250_000, currency: 'INR', orderId: 'order-1' })

    const [payload] = fake.calls[0].args
    expect(payload.amount).toBe(250_000)
    expect(payload.currency).toBe('inr')
  })

  it('carries a stable idempotency key, so a retried checkout is one intent', async () => {
    const { adapter, fake } = adapterWith()

    await adapter.createIntent({ amountCents: 1000, currency: 'INR', orderId: 'order-1' })
    await adapter.createIntent({ amountCents: 1000, currency: 'INR', orderId: 'order-1' })

    const [first, second] = fake.calls.map((call) => call.args[1].idempotencyKey)
    expect(first).toBe(second)
    expect(first).toBe('desi:payment-intent:order-1:1')
  })

  it('gives a deliberate second attempt a different key', async () => {
    // A retry after a decline is a new request, not a replay of the declined one.
    const { adapter, fake } = adapterWith()

    await adapter.createIntent({ amountCents: 1000, currency: 'INR', orderId: 'order-1' })
    await adapter.createIntent({
      amountCents: 1000,
      currency: 'INR',
      orderId: 'order-1',
      attempt: 2,
    })

    const [first, second] = fake.calls.map((call) => call.args[1].idempotencyKey)
    expect(first).not.toBe(second)
  })

  it('sends the Connect fields ADR 0003 chose', async () => {
    const { adapter, fake } = adapterWith()

    await adapter.createIntent({
      amountCents: 250_000,
      currency: 'INR',
      orderId: 'order-1',
      connectedAccountId: 'acct_organiser',
      applicationFeeCents: 14_849,
    })

    const [payload] = fake.calls[0].args
    expect(payload.on_behalf_of).toBe('acct_organiser')
    expect(payload.transfer_data).toEqual({ destination: 'acct_organiser' })
    expect(payload.application_fee_amount).toBe(14_849)
  })

  it('omits the Connect fields when there is no connected account', async () => {
    const { adapter, fake } = adapterWith()

    await adapter.createIntent({ amountCents: 1000, currency: 'INR', orderId: 'order-1' })

    const [payload] = fake.calls[0].args
    expect(payload).not.toHaveProperty('on_behalf_of')
    expect(payload).not.toHaveProperty('transfer_data')
    expect(payload).not.toHaveProperty('application_fee_amount')
  })

  it('omits the application fee when none was computed', async () => {
    // Sending `application_fee_amount: 0` and omitting it are different things to
    // Stripe, and only one of them means "no platform fee".
    const { adapter, fake } = adapterWith()

    await adapter.createIntent({
      amountCents: 1000,
      currency: 'INR',
      orderId: 'order-1',
      connectedAccountId: 'acct_organiser',
    })

    expect(fake.calls[0].args[0]).not.toHaveProperty('application_fee_amount')
  })

  it('puts only identifiers in metadata', async () => {
    const { adapter, fake } = adapterWith()

    await adapter.createIntent({
      amountCents: 1000,
      currency: 'INR',
      orderId: 'order-1',
      metadata: { eventId: 'event-1' },
    })

    const { metadata } = fake.calls[0].args[0]

    // Metadata is readable by anybody with dashboard access and is echoed into
    // stored webhook payloads, so a name or an address here is a name or an
    // address in two more places.
    expect(metadata).toEqual({ eventId: 'event-1', orderId: 'order-1', attempt: '1' })
  })

  it('returns the client secret, which is the one secret meant for the browser', async () => {
    const { adapter } = adapterWith()

    const intent = await adapter.createIntent({
      amountCents: 1000,
      currency: 'INR',
      orderId: 'order-1',
    })

    expect(intent.clientSecret).toBe('pi_fake_secret_fixture')
    expect(intent.id).toBe('pi_fake')
  })

  it('lets Stripe decide which payment methods to offer', async () => {
    // Which is what makes 3-D Secure work without this code knowing about it.
    const { adapter, fake } = adapterWith()

    await adapter.createIntent({ amountCents: 1000, currency: 'INR', orderId: 'order-1' })

    expect(fake.calls[0].args[0].automatic_payment_methods).toEqual({ enabled: true })
  })
})

describe('status mapping', () => {
  it.each([
    ['succeeded', 'PAID'],
    ['requires_capture', 'AUTHORIZED'],
    ['canceled', 'CANCELLED'],
  ])('maps %s to %s', (stripeStatus, expected) => {
    expect(STRIPE_STATUS_MAP[stripeStatus]).toBe(expected)
  })

  it('does not treat requires_action as a failure', () => {
    // It is 3-D Secure. Treating it as a decline loses every authenticated
    // payment in Europe and India.
    expect(STRIPE_STATUS_MAP.requires_action).toBe('REQUIRES_ACTION')
    expect(STRIPE_STATUS_MAP.requires_action).not.toBe('FAILED')
  })

  it('does not treat processing as a success', () => {
    // An asynchronous method that has not settled. Treating it as paid issues
    // tickets for money that may never arrive.
    expect(STRIPE_STATUS_MAP.processing).toBe('PROCESSING')
    expect(STRIPE_STATUS_MAP.processing).not.toBe('PAID')
  })

  it('falls back to PENDING for a status it has never seen', async () => {
    const { adapter } = adapterWith({
      'paymentIntents.create': {
        id: 'pi_fake',
        client_secret: 's',
        status: 'some_future_status',
        amount: 1,
        currency: 'inr',
      },
    })

    const intent = await adapter.createIntent({
      amountCents: 1,
      currency: 'INR',
      orderId: 'order-1',
    })

    // Pending, not paid: an unknown status must never be optimistic.
    expect(intent.status).toBe('PENDING')
    expect(intent.providerStatus).toBe('some_future_status')
  })
})

describe('getStatus', () => {
  it('reads the provider rather than a local record', async () => {
    const { adapter, fake } = adapterWith()

    const status = await adapter.getStatus('pi_fake')

    expect(fake.calls[0].method).toBe('paymentIntents.retrieve')
    expect(status.status).toBe('PAID')
    expect(status.amountReceivedCents).toBe(250_000)
    expect(status.chargeId).toBe('ch_fake')
  })

  it('returns only the four safe card fields', async () => {
    const { adapter } = adapterWith()

    const status = await adapter.getStatus('pi_fake')

    expect(status.card).toEqual({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 })
  })
})

describe('safeCardMetadata', () => {
  it('keeps brand, last four and expiry', () => {
    expect(
      safeCardMetadata({ card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2031 } }),
    ).toEqual({ brand: 'visa', last4: '4242', expMonth: 1, expYear: 2031 })
  })

  it('drops everything else, including a fingerprint and a network token', () => {
    const view = safeCardMetadata({
      card: {
        brand: 'visa',
        last4: '4242',
        exp_month: 1,
        exp_year: 2031,
        fingerprint: 'fp_fixture',
        network_token: { used: true },
        three_d_secure: { result: 'authenticated' },
        iin: '424242',
      },
    })

    expect(Object.keys(view).sort()).toEqual(['brand', 'expMonth', 'expYear', 'last4'])
    expect(JSON.stringify(view)).not.toContain('fp_fixture')
    expect(JSON.stringify(view)).not.toContain('424242')
  })

  it.each([
    ['no payment method', null],
    ['undefined', undefined],
    ['a non-card method', { type: 'upi' }],
  ])('returns null for %s', (_label, value) => {
    expect(safeCardMetadata(value)).toBeNull()
  })
})

describe('refund', () => {
  it('states the transfer reversal and the fee refund explicitly', async () => {
    const { adapter, fake } = adapterWith()

    await adapter.refund({
      paymentIntentId: 'pi_fake',
      amountCents: 100_000,
      refundId: 'refund-1',
      reverseTransfer: true,
      refundApplicationFee: false,
    })

    const [payload] = fake.calls[0].args

    // Who bears the cost of a refund is policy, not plumbing, so the caller says.
    expect(payload.reverse_transfer).toBe(true)
    expect(payload.refund_application_fee).toBe(false)
    expect(payload.amount).toBe(100_000)
  })

  it('keys on our own refund row, so a retry is not a second refund', async () => {
    const { adapter, fake } = adapterWith()

    await adapter.refund({ paymentIntentId: 'pi_fake', amountCents: 1, refundId: 'refund-1' })
    await adapter.refund({ paymentIntentId: 'pi_fake', amountCents: 1, refundId: 'refund-1' })

    const keys = fake.calls.map((call) => call.args[1].idempotencyKey)
    expect(keys[0]).toBe(keys[1])
  })

  it('reverses the transfer by default', async () => {
    const { adapter, fake } = adapterWith()

    await adapter.refund({ paymentIntentId: 'pi_fake', amountCents: 1, refundId: 'refund-1' })

    expect(fake.calls[0].args[0].reverse_transfer).toBe(true)
  })
})

describe('Connect', () => {
  it('creates an Express account so Stripe hosts the identity documents', async () => {
    const { adapter, fake } = adapterWith()

    const account = await adapter.createConnectedAccount({
      organizationId: 'org-1',
      email: 'organiser@example.com',
      country: 'IN',
    })

    const [payload] = fake.calls[0].args
    expect(payload.type).toBe('express')
    expect(payload.capabilities).toEqual({
      card_payments: { requested: true },
      transfers: { requested: true },
    })
    expect(account.id).toBe('acct_fake')
    expect(account.chargesEnabled).toBe(false)
  })

  it('stores counts of outstanding requirements, not their contents', async () => {
    const state = toAccountState({
      id: 'acct_fake',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: {
        currently_due: ['individual.id_number', 'external_account'],
        past_due: ['individual.verification.document'],
        disabled_reason: 'requirements.past_due',
      },
    })

    // "Three things outstanding" is what an organiser console needs; which three
    // is Stripe's hosted page to say, and this system has no business holding a
    // list of somebody's missing identity documents.
    expect(state.currentlyDueCount).toBe(2)
    expect(state.pastDueCount).toBe(1)
    expect(JSON.stringify(state)).not.toContain('id_number')
    expect(JSON.stringify(state)).not.toContain('verification.document')
  })

  it('keeps the disabled reason, which an organiser needs to act on', () => {
    const state = toAccountState({
      id: 'acct_fake',
      requirements: { disabled_reason: 'requirements.past_due' },
    })

    expect(state.disabledReason).toBe('requirements.past_due')
  })

  it('creates a single-use onboarding link rather than storing one', async () => {
    const { adapter, fake } = adapterWith()

    const link = await adapter.createOnboardingLink({
      accountId: 'acct_fake',
      refreshUrl: 'https://desi-event.test/connect/refresh',
      returnUrl: 'https://desi-event.test/connect/return',
    })

    expect(fake.calls[0].args[0].type).toBe('account_onboarding')
    expect(link.url).toBe('https://connect.stripe.test/setup/fake')
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('reads the account from Stripe rather than believing a redirect', async () => {
    const { adapter, fake } = adapterWith()

    const state = await adapter.getConnectedAccount('acct_fake')

    expect(fake.calls[0].method).toBe('accounts.retrieve')
    expect(state).toMatchObject({ chargesEnabled: true, payoutsEnabled: true })
  })

  it('reverses a transfer with a key of our own', async () => {
    const { adapter, fake } = adapterWith()

    await adapter.reverseTransfer({
      transferId: 'tr_fake',
      amountCents: 50_000,
      reversalId: 'reversal-1',
    })

    expect(fake.calls[0].args[2].idempotencyKey).toBe('desi:transfer-reversal:reversal-1:1')
  })
})

describe('mapStripeError', () => {
  /**
   * An error shaped the way the Stripe SDK throws them.
   *
   * @param {string} type The Stripe error type.
   * @param {object} [extra] Extra fields.
   * @returns {Error} The error.
   */
  const stripeError = (type, extra = {}) =>
    Object.assign(new Error('from stripe'), { type, ...extra })

  it('maps a card error to a decline', () => {
    const mapped = mapStripeError(
      stripeError('StripeCardError', { code: 'card_declined', decline_code: 'insufficient_funds' }),
    )

    expect(mapped.code).toBe(PROVIDER_ERROR_CODES.PAYMENT_DECLINED)
    expect(mapped.details.declineCode).toBe('insufficient_funds')
  })

  it.each([...UNKNOWN_OUTCOME_TYPES])('maps %s to a timeout, not a decline', (type) => {
    // The distinction that matters most in this file. A decline means no money
    // moved; a connection error means nobody knows yet, and the order must go to
    // reconciliation with its inventory still held.
    const mapped = mapStripeError(stripeError(type))

    expect(mapped.code).toBe(PROVIDER_ERROR_CODES.PAYMENT_TIMEOUT)
    expect(mapped.code).not.toBe(PROVIDER_ERROR_CODES.PAYMENT_DECLINED)
  })

  it('maps anything else to provider-unavailable', () => {
    expect(mapStripeError(stripeError('StripeInvalidRequestError')).code).toBe(
      PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
    )
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a plain string', 'something broke'],
    ['a plain object', {}],
  ])('maps %s without throwing', (_label, value) => {
    expect(mapStripeError(value)).toBeInstanceOf(ProviderError)
  })

  it('carries four named fields and nothing else', () => {
    const mapped = mapStripeError(
      stripeError('StripeCardError', {
        code: 'card_declined',
        requestId: 'req_fixture',
        raw: { amount: 250_000, payment_method: { card: { number: 'never-stored' } } },
        headers: { authorization: `Bearer ${SECRET_KEY}` },
      }),
    )

    // A serialised Stripe error carries `raw`, which carries the request. A log
    // line is not a place for that.
    expect(Object.keys(mapped.details).sort()).toEqual(['code', 'declineCode', 'requestId', 'type'])
    expect(JSON.stringify(mapped.details)).not.toContain('never-stored')
    expect(JSON.stringify(mapped.details)).not.toContain(SECRET_KEY)
  })

  it('keeps the request id, which is what Stripe support asks for', () => {
    expect(
      mapStripeError(stripeError('StripeAPIError', { requestId: 'req_x' })).details.requestId,
    ).toBe('req_x')
  })

  it('surfaces a mapped error from a call', async () => {
    const { adapter } = adapterWith({
      'paymentIntents.create': Object.assign(new Error('declined'), { type: 'StripeCardError' }),
    })

    await expect(
      adapter.createIntent({ amountCents: 1, currency: 'INR', orderId: 'order-1' }),
    ).rejects.toMatchObject({ code: PROVIDER_ERROR_CODES.PAYMENT_DECLINED })
  })
})

describe('idempotencyKey', () => {
  it('scopes by operation, so a charge and a refund cannot collide', () => {
    expect(idempotencyKey('payment-intent', 'x')).not.toBe(idempotencyKey('refund', 'x'))
  })

  it('scopes by subject', () => {
    expect(idempotencyKey('refund', 'a')).not.toBe(idempotencyKey('refund', 'b'))
  })

  it('scopes by attempt', () => {
    expect(idempotencyKey('payment-intent', 'x', 1)).not.toBe(
      idempotencyKey('payment-intent', 'x', 2),
    )
  })

  it('is stable for the same three', () => {
    expect(idempotencyKey('payment-intent', 'x', 3)).toBe(idempotencyKey('payment-intent', 'x', 3))
  })

  it('is namespaced, so it cannot collide with another system on the same account', () => {
    expect(idempotencyKey('refund', 'x')).toMatch(/^desi:/)
  })
})

describe('DECLINE_TYPES', () => {
  it('contains only the type that means the card was refused', () => {
    expect([...DECLINE_TYPES]).toEqual(['StripeCardError'])
  })

  it('does not overlap with the unknown-outcome types', () => {
    for (const type of DECLINE_TYPES) expect(UNKNOWN_OUTCOME_TYPES.has(type)).toBe(false)
  })
})
