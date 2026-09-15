/**
 * The payment-mode gate.
 *
 * Two claims are being tested, and the second is the important one.
 *
 * First: the right mode is chosen. Nothing configured means the in-memory mock;
 * a complete set of Stripe *test* credentials, asked for on purpose, means the
 * sandbox.
 *
 * Second, and absolutely: there is no environment, no credential and no
 * configuration value that makes this system charge a real card. A deployment
 * that believes otherwise is stopped before it listens, because somebody who
 * thinks they have enabled card payments has to find out from the boot log
 * rather than from a buyer.
 *
 * Every credential in this file is a self-identifying fabrication. None is a
 * real key, and the secret scanner is meant to leave them alone.
 */

import { describe, expect, it } from 'vitest'

import {
  assertMockPaymentsOnly,
  assertPaymentModeAllowed,
  classifyPaymentCredential,
  DEMO_LABEL,
  findClientExposedViolations,
  findModeRequests,
  findPaymentCredentials,
  PAYMENT_MODES,
  PAYMENT_MODE_KEY,
  PAYMENT_MODE_REQUEST_KEYS,
  PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
  readStripeCredentials,
  resolvePaymentMode,
  SANDBOX_LABEL,
  STRIPE_API_VERSION,
  stripeEnabled,
} from './payment-mode.js'
import { PROVIDER_ERROR_CODES } from './errors.js'

/** Live-looking, obviously fabricated, and never a real key. */
const FAKE_LIVE_SECRET = 'sk_live_NOT_A_REAL_KEY_FIXTURE_9fJk2LmQ'

/** Sandbox-looking, equally fabricated. */
const FAKE_TEST_SECRET = 'sk_test_NOT_A_REAL_KEY_FIXTURE_9fJk2LmQ'
const FAKE_TEST_PUBLISHABLE = 'pk_test_NOT_A_REAL_KEY_FIXTURE_9fJk2LmQ'
const FAKE_WEBHOOK_SECRET = 'whsec_NOT_A_REAL_SECRET_FIXTURE_9fJk2L'
const FAKE_CONNECT_WEBHOOK_SECRET = 'whsec_NOT_A_REAL_CONNECT_FIXTURE_7dHp3R'

/**
 * A complete, coherent Stripe test environment.
 *
 * @param {Record<string, string>} [overrides] Variables to add or replace.
 * @returns {Record<string, string>} An environment `stripe_test` accepts.
 */
function sandboxEnv(overrides = {}) {
  return {
    PAYMENT_MODE: 'stripe_test',
    STRIPE_SECRET_KEY: FAKE_TEST_SECRET,
    STRIPE_PUBLISHABLE_KEY: FAKE_TEST_PUBLISHABLE,
    STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
    ...overrides,
  }
}

describe('the modes that exist', () => {
  it('has exactly two, and neither moves real money', () => {
    expect(Object.values(PAYMENT_MODES).sort()).toEqual(['MOCK', 'STRIPE_TEST'])
  })

  it('does not name a live mode even to disable it', () => {
    expect(Object.keys(PAYMENT_MODES)).not.toContain('LIVE')
    expect(Object.keys(PAYMENT_MODES)).not.toContain('PRODUCTION')
  })

  it('reports itself as not live in both modes', () => {
    expect(resolvePaymentMode({}).live).toBe(false)
    expect(resolvePaymentMode(sandboxEnv()).live).toBe(false)
  })

  it('pins the Stripe API version rather than taking the SDK default', () => {
    // A webhook payload is only interpretable against the version that produced
    // it, so an SDK upgrade must not silently change what arrives.
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })
})

describe('an environment with nothing configured', () => {
  it('runs the mock', () => {
    const resolution = resolvePaymentMode({})

    expect(resolution.mode).toBe(PAYMENT_MODES.MOCK)
    expect(resolution.demo).toBe(true)
    expect(resolution.stripe).toBe(null)
    expect(resolution.notices).toEqual([])
  })

  it('says so in the words the buyer and the operator both see', () => {
    expect(resolvePaymentMode({}).message).toBe(PRODUCTION_PAYMENTS_DISABLED_MESSAGE)
    expect(resolvePaymentMode({}).label).toBe(DEMO_LABEL)
  })

  it('cannot reach Stripe', () => {
    expect(stripeEnabled(resolvePaymentMode({}))).toBe(false)
  })

  it('is unaffected by variables that have nothing to do with payments', () => {
    const resolution = resolvePaymentMode({
      DATABASE_URL: 'postgresql://desi:desi@127.0.0.1:5432/desi_event',
      JWT_SECRET: 'a-genuinely-random-secret-value-of-length',
      NODE_ENV: 'production',
    })

    expect(resolution.mode).toBe(PAYMENT_MODES.MOCK)
  })
})

describe('sandbox credentials left behind in mock mode', () => {
  it('do not activate anything', () => {
    const resolution = resolvePaymentMode({
      STRIPE_SECRET_KEY: FAKE_TEST_SECRET,
      STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
    })

    expect(resolution.mode).toBe(PAYMENT_MODES.MOCK)
    expect(stripeEnabled(resolution)).toBe(false)
  })

  it('are reported as unused rather than ignored silently', () => {
    const resolution = resolvePaymentMode({ STRIPE_SECRET_KEY: FAKE_TEST_SECRET })

    expect(resolution.notices).toHaveLength(1)
    expect(resolution.notices[0]).toContain('STRIPE_SECRET_KEY')
    expect(resolution.notices[0]).toMatch(/unused|in-memory/)
  })

  it('never have their value repeated back', () => {
    const resolution = resolvePaymentMode({ STRIPE_SECRET_KEY: FAKE_TEST_SECRET })

    expect(resolution.notices.join(' ')).not.toContain(FAKE_TEST_SECRET)
  })

  it('reach the logger when one is supplied', () => {
    const warnings = []
    const resolution = assertPaymentModeAllowed({
      env: { STRIPE_SECRET_KEY: FAKE_TEST_SECRET },
      logger: { warn: (_context, message) => warnings.push(message) },
    })

    expect(resolution.mode).toBe(PAYMENT_MODES.MOCK)
    expect(warnings).toHaveLength(1)
  })

  it('include a webhook secret, which is no longer mistaken for a live key', () => {
    // Phase 1 classified any `whsec_` as proof of a live account. Stripe's test
    // webhook secrets have the same shape, so that rule would refuse the very
    // configuration the sandbox needs.
    expect(classifyPaymentCredential(FAKE_WEBHOOK_SECRET)).toBe('webhook')
    expect(resolvePaymentMode({ STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET }).mode).toBe(
      PAYMENT_MODES.MOCK,
    )
  })
})

describe('a live-looking credential', () => {
  it.each([
    ['STRIPE_SECRET_KEY', FAKE_LIVE_SECRET],
    ['STRIPE_PUBLISHABLE_KEY', 'pk_live_NOT_A_REAL_KEY_FIXTURE_9fJk2L'],
    ['STRIPE_RESTRICTED_KEY', 'rk_live_NOT_A_REAL_KEY_FIXTURE_9fJk2L'],
    ['RAZORPAY_KEY_ID', 'rzp_live_NotRealFixture9f'],
  ])('refuses the boot when %s is set', (key, value) => {
    expect(() => resolvePaymentMode({ [key]: value })).toThrow(PRODUCTION_PAYMENTS_DISABLED_MESSAGE)
  })

  it('is refused wherever it is hiding, not only under a known variable name', () => {
    expect(() => resolvePaymentMode({ SOME_UNRELATED_VARIABLE: FAKE_LIVE_SECRET })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it('is refused even when the mode asks for the sandbox', () => {
    // Mixed test and live credentials: somebody mid-migration. Guessing which
    // they meant is the wrong move.
    expect(() => resolvePaymentMode(sandboxEnv({ STRIPE_SECRET_KEY: FAKE_LIVE_SECRET }))).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
    expect(() => resolvePaymentMode(sandboxEnv({ OLD_STRIPE_KEY: FAKE_LIVE_SECRET }))).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it('raises a failure a caller can branch on', () => {
    expect.assertions(2)

    try {
      resolvePaymentMode({ STRIPE_SECRET_KEY: FAKE_LIVE_SECRET })
    } catch (error) {
      expect(error.code).toBe(PROVIDER_ERROR_CODES.PRODUCTION_PAYMENTS_DISABLED)
      expect(error.details.liveCredentials).toEqual(['STRIPE_SECRET_KEY'])
    }
  })

  it('is never printed, not even in the refusal that names it', () => {
    expect.assertions(2)

    try {
      resolvePaymentMode({ STRIPE_SECRET_KEY: FAKE_LIVE_SECRET })
    } catch (error) {
      expect(error.message).toContain('STRIPE_SECRET_KEY')
      expect(JSON.stringify(error.message) + JSON.stringify(error.details)).not.toContain(
        FAKE_LIVE_SECRET,
      )
    }
  })
})

describe('an environment that asks for production', () => {
  it.each(['live', 'production', 'prod', 'real', 'stripe', 'stripe_live'])(
    'refuses PAYMENT_MODE=%s',
    (value) => {
      expect(() => resolvePaymentMode({ PAYMENT_MODE: value })).toThrow(
        PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
      )
    },
  )

  it('refuses a value it does not recognise rather than guessing', () => {
    expect(() => resolvePaymentMode({ PAYMENT_MODE: 'somethingelse' })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it.each(PAYMENT_MODE_REQUEST_KEYS.filter((key) => key !== PAYMENT_MODE_KEY))(
    'refuses %s, which is not the variable that decides',
    (key) => {
      expect(() => resolvePaymentMode({ [key]: 'stripe' })).toThrow(
        PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
      )
    },
  )

  it.each(['true', '1', 'yes', 'on'])('refuses ENABLE_PRODUCTION_PAYMENTS=%s', (value) => {
    expect(() => resolvePaymentMode({ ENABLE_PRODUCTION_PAYMENTS: value })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it('is not fooled by a non-string value', () => {
    expect(() => resolvePaymentMode({ ENABLE_PRODUCTION_PAYMENTS: true })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it.each(['false', '0', 'off', ''])('ignores a negative %s', (value) => {
    expect(resolvePaymentMode({ ENABLE_PRODUCTION_PAYMENTS: value }).mode).toBe(PAYMENT_MODES.MOCK)
  })

  it.each(['mock', 'demo', 'in-memory', 'none'])(
    'accepts PAYMENT_MODE=%s, which asks for what already happens',
    (value) => {
      expect(resolvePaymentMode({ PAYMENT_MODE: value }).mode).toBe(PAYMENT_MODES.MOCK)
    },
  )

  it('notices, rather than refuses, an unread variable that asks for the mock', () => {
    // Refusing to boot over `PAYMENT_PROVIDER=mock` would be pedantry: it
    // describes what happens anyway.
    const resolution = resolvePaymentMode({ PAYMENT_PROVIDER: 'mock' })

    expect(resolution.mode).toBe(PAYMENT_MODES.MOCK)
    expect(resolution.notices.join(' ')).toContain('PAYMENT_PROVIDER')
  })
})

describe('a placeholder somebody forgot to replace', () => {
  it.each([
    'sk_test_xxxxxxxx',
    'sk_test_AAAAAAAAAAAAAAAA',
    'your-secret-key-here',
    'change-me',
    'REPLACE_ME',
  ])('refuses the boot for %s', (value) => {
    expect(classifyPaymentCredential(value)).toBe('placeholder')
    expect(() => resolvePaymentMode({ STRIPE_SECRET_KEY: value })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it('names the variable without echoing the placeholder', () => {
    expect.assertions(2)

    try {
      resolvePaymentMode({ STRIPE_SECRET_KEY: 'sk_test_xxxxxxxx' })
    } catch (error) {
      expect(error.message).toContain('STRIPE_SECRET_KEY')
      expect(error.details.placeholderCredentials).toEqual(['STRIPE_SECRET_KEY'])
    }
  })
})

describe('a secret in a browser-readable variable', () => {
  it('refuses the boot', () => {
    // NEXT_PUBLIC_* reaches every browser. A secret key there is a leak.
    expect(() => resolvePaymentMode({ NEXT_PUBLIC_STRIPE_SECRET: FAKE_TEST_SECRET })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
    expect(() =>
      resolvePaymentMode({ NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET }),
    ).toThrow(PRODUCTION_PAYMENTS_DISABLED_MESSAGE)
  })

  it('refuses a mode set from a browser-readable variable', () => {
    // Not authority, however it is spelled.
    expect(() => resolvePaymentMode({ NEXT_PUBLIC_PAYMENT_MODE: 'stripe_test' })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it('allows the publishable key there, which is what it is for', () => {
    const resolution = resolvePaymentMode({
      PAYMENT_MODE: 'stripe_test',
      STRIPE_SECRET_KEY: FAKE_TEST_SECRET,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_TEST_PUBLISHABLE,
      STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
    })

    expect(resolution.mode).toBe(PAYMENT_MODES.STRIPE_TEST)
    expect(resolution.stripe.publishableKey).toBe(FAKE_TEST_PUBLISHABLE)
  })

  it('reports the offenders by name', () => {
    expect(findClientExposedViolations({ NEXT_PUBLIC_STRIPE_SECRET: FAKE_TEST_SECRET })).toEqual([
      'NEXT_PUBLIC_STRIPE_SECRET',
    ])
    expect(findClientExposedViolations({ NEXT_PUBLIC_SITE_URL: 'https://example.com' })).toEqual([])
  })
})

describe('the sandbox, asked for properly', () => {
  it('starts with a complete credential set', () => {
    const resolution = resolvePaymentMode(sandboxEnv())

    expect(resolution.mode).toBe(PAYMENT_MODES.STRIPE_TEST)
    expect(resolution.label).toBe(SANDBOX_LABEL)
    expect(resolution.live).toBe(false)
    expect(stripeEnabled(resolution)).toBe(true)
  })

  it('still says production payments are disabled', () => {
    // The sandbox is not production. The message a buyer sees does not change.
    expect(resolvePaymentMode(sandboxEnv()).message).toBe(PRODUCTION_PAYMENTS_DISABLED_MESSAGE)
  })

  it('marks its artefacts as a sandbox rather than as a demo', () => {
    const resolution = resolvePaymentMode(sandboxEnv())

    expect(resolution.paymentNotice).toMatch(/SANDBOX/)
    expect(resolution.paymentNotice).toMatch(/not a valid receipt/i)
    expect(resolution.ticketNotice).toMatch(/admits nobody/i)
  })

  it.each([
    ['STRIPE_SECRET_KEY', { STRIPE_SECRET_KEY: undefined }],
    ['STRIPE_PUBLISHABLE_KEY', { STRIPE_PUBLISHABLE_KEY: undefined }],
    ['STRIPE_WEBHOOK_SECRET', { STRIPE_WEBHOOK_SECRET: undefined }],
  ])('refuses to half-start when %s is missing', (name, overrides) => {
    // A secret key with no webhook secret is a deployment that will take money
    // and never hear that it did.
    const env = sandboxEnv()
    delete env[Object.keys(overrides)[0]]

    expect(() => resolvePaymentMode(env)).toThrow(/needs a complete credential set/)
    expect(() => resolvePaymentMode(env)).toThrow(new RegExp(name))
  })

  it('treats a blank value as absent rather than as a credential', () => {
    expect(() => resolvePaymentMode(sandboxEnv({ STRIPE_WEBHOOK_SECRET: '   ' }))).toThrow(
      /needs a complete credential set/,
    )
  })

  it('refuses a credential that is not shaped like a test credential', () => {
    expect(() =>
      resolvePaymentMode(sandboxEnv({ STRIPE_SECRET_KEY: 'not-a-stripe-key-at-all' })),
    ).toThrow(/not shaped like a Stripe test credential/)
  })

  it('refuses one webhook secret shared between two endpoints', () => {
    // Sharing one means a platform event and a connected-account event verify
    // against the same key, and the account-context check stops being a check.
    expect(() =>
      resolvePaymentMode(sandboxEnv({ STRIPE_CONNECT_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET })),
    ).toThrow(/each endpoint needs its own/)
  })

  it('accepts two distinct webhook secrets', () => {
    const resolution = resolvePaymentMode(
      sandboxEnv({ STRIPE_CONNECT_WEBHOOK_SECRET: FAKE_CONNECT_WEBHOOK_SECRET }),
    )

    expect(resolution.stripe.connectWebhookSecretPresent).toBe(true)
  })

  it('never serialises a secret, however the resolution is logged', () => {
    const resolution = resolvePaymentMode(sandboxEnv())

    const serialised = JSON.stringify(resolution)
    expect(serialised).not.toContain(FAKE_TEST_SECRET)
    expect(serialised).not.toContain(FAKE_WEBHOOK_SECRET)
    expect(Object.keys(resolution)).not.toContain('credentials')

    // The adapter can still read them by name.
    expect(resolution.credentials.secretKey).toBe(FAKE_TEST_SECRET)
  })

  it('exposes the publishable key, which is meant to be public', () => {
    const resolution = resolvePaymentMode(sandboxEnv())

    expect(JSON.stringify(resolution)).toContain(FAKE_TEST_PUBLISHABLE)
  })

  it('pins the API version, and lets a deployment override it deliberately', () => {
    expect(resolvePaymentMode(sandboxEnv()).stripe.apiVersion).toBe(STRIPE_API_VERSION)
    expect(
      resolvePaymentMode(sandboxEnv({ STRIPE_API_VERSION: '2030-01-01.future' })).stripe.apiVersion,
    ).toBe('2030-01-01.future')
  })
})

describe('the stricter guard, for contexts that must reach nothing', () => {
  it('allows the mock', () => {
    expect(assertMockPaymentsOnly({ env: {} }).mode).toBe(PAYMENT_MODES.MOCK)
  })

  it('refuses the sandbox, which the ordinary guard allows', () => {
    expect(assertPaymentModeAllowed({ env: sandboxEnv() }).mode).toBe(PAYMENT_MODES.STRIPE_TEST)
    expect(() => assertMockPaymentsOnly({ env: sandboxEnv() })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })
})

describe('classifying one value', () => {
  it.each([
    [FAKE_LIVE_SECRET, 'live'],
    [FAKE_TEST_SECRET, 'test'],
    [FAKE_WEBHOOK_SECRET, 'webhook'],
    ['sk_test_xxxxxxxx', 'placeholder'],
    ['some-other-value', 'unknown'],
    ['', 'absent'],
    ['   ', 'absent'],
    [undefined, 'absent'],
    [null, 'absent'],
    [42, 'absent'],
  ])('reads %s as %s', (value, expected) => {
    expect(classifyPaymentCredential(value)).toBe(expected)
  })
})

describe('reporting what was found', () => {
  it('groups by what each value looks like, naming variables only', () => {
    const found = findPaymentCredentials({
      STRIPE_SECRET_KEY: FAKE_LIVE_SECRET,
      STRIPE_PUBLISHABLE_KEY: FAKE_TEST_PUBLISHABLE,
      STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
      RAZORPAY_KEY_SECRET: 'something-opaque',
      PAYPAL_SECRET: 'sk_test_xxxxxxxx',
      DATABASE_URL: 'postgresql://desi:desi@127.0.0.1:5432/desi_event',
    })

    expect(found).toEqual({
      live: ['STRIPE_SECRET_KEY'],
      test: ['STRIPE_PUBLISHABLE_KEY'],
      webhook: ['STRIPE_WEBHOOK_SECRET'],
      placeholder: ['PAYPAL_SECRET'],
      unknown: ['RAZORPAY_KEY_SECRET'],
    })
  })

  it('finds no mode request in an empty environment', () => {
    expect(findModeRequests({})).toEqual([])
  })

  it('reads the Stripe set, treating blank as absent', () => {
    expect(readStripeCredentials({ STRIPE_SECRET_KEY: '  ' }).secretKey).toBe(null)
    expect(readStripeCredentials({}).apiVersion).toBe(STRIPE_API_VERSION)
    expect(readStripeCredentials({ STRIPE_SECRET_KEY: ` ${FAKE_TEST_SECRET} ` }).secretKey).toBe(
      FAKE_TEST_SECRET,
    )
  })
})
