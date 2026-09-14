/**
 * The production-payment kill switch.
 *
 * The claim being tested is narrow and absolute: there is no environment, no
 * credential and no configuration value that makes this system charge a card.
 * A deployment that believes otherwise is stopped rather than quietly
 * downgraded, because somebody who thinks they have enabled payments has to
 * find out from the boot log, not from a buyer.
 */

import { describe, expect, it } from 'vitest'

import {
  assertMockPaymentsOnly,
  classifyPaymentCredential,
  DEMO_LABEL,
  findPaymentCredentials,
  findProductionModeRequests,
  PAYMENT_MODES,
  PAYMENT_MODE_REQUEST_KEYS,
  PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
  resolvePaymentMode,
} from './payment-mode.js'
import { PROVIDER_ERROR_CODES } from './errors.js'

/** A live-looking key that is obviously fabricated, so the secret scanner leaves it alone. */
const FAKE_LIVE_KEY = 'sk_live_NOT_A_REAL_KEY_THIS_IS_A_TEST_FIXTURE_0000'

/** A sandbox-looking key, equally fabricated. */
const FAKE_TEST_KEY = 'sk_test_NOT_A_REAL_KEY_THIS_IS_A_TEST_FIXTURE_0000'

describe('the modes that exist', () => {
  it('has exactly one, and it is the mock', () => {
    expect(Object.values(PAYMENT_MODES)).toEqual(['MOCK'])
  })

  it('does not name a live mode even to disable it', () => {
    expect(Object.keys(PAYMENT_MODES)).not.toContain('LIVE')
    expect(Object.keys(PAYMENT_MODES)).not.toContain('PRODUCTION')
  })
})

describe('an environment with nothing configured', () => {
  it('runs the mock', () => {
    const resolution = resolvePaymentMode({})

    expect(resolution.mode).toBe(PAYMENT_MODES.MOCK)
    expect(resolution.demo).toBe(true)
    expect(resolution.notices).toEqual([])
  })

  it('says so in the words the buyer and the operator both see', () => {
    expect(resolvePaymentMode({}).message).toBe(PRODUCTION_PAYMENTS_DISABLED_MESSAGE)
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

describe('sandbox credentials somebody left behind', () => {
  it('do not activate a Stripe integration that does not exist', () => {
    const resolution = resolvePaymentMode({ STRIPE_SECRET_KEY: FAKE_TEST_KEY })

    expect(resolution.mode).toBe(PAYMENT_MODES.MOCK)
  })

  it('are reported as unused rather than ignored silently', () => {
    const resolution = resolvePaymentMode({ STRIPE_SECRET_KEY: FAKE_TEST_KEY })

    expect(resolution.notices).toHaveLength(1)
    expect(resolution.notices[0]).toContain('STRIPE_SECRET_KEY')
    expect(resolution.notices[0]).toMatch(/unused|in-memory mock/)
  })

  it('never have their value repeated back', () => {
    const resolution = resolvePaymentMode({ STRIPE_SECRET_KEY: FAKE_TEST_KEY })

    expect(resolution.notices.join(' ')).not.toContain(FAKE_TEST_KEY)
  })

  it('reach the logger when one is supplied', () => {
    const warnings = []
    const resolution = assertMockPaymentsOnly({
      env: { STRIPE_SECRET_KEY: FAKE_TEST_KEY },
      logger: { warn: (_context, message) => warnings.push(message) },
    })

    expect(resolution.mode).toBe(PAYMENT_MODES.MOCK)
    expect(warnings).toHaveLength(1)
  })
})

describe('a live-looking credential', () => {
  it.each([
    ['STRIPE_SECRET_KEY', FAKE_LIVE_KEY],
    ['STRIPE_PUBLISHABLE_KEY', 'pk_live_NOT_REAL_TEST_FIXTURE_00000000'],
    ['STRIPE_RESTRICTED_KEY', 'rk_live_NOT_REAL_TEST_FIXTURE_00000000'],
    ['STRIPE_WEBHOOK_SECRET', 'whsec_NOT_REAL_TEST_FIXTURE_00000000'],
    ['RAZORPAY_KEY_ID', 'rzp_live_NOTREALFIXTURE00'],
  ])('fails the boot when %s is set', (key, value) => {
    expect(() => resolvePaymentMode({ [key]: value })).toThrow(PRODUCTION_PAYMENTS_DISABLED_MESSAGE)
  })

  it('is refused wherever it is hiding, not only under a known variable name', () => {
    expect(() => resolvePaymentMode({ SOME_UNRELATED_VARIABLE: FAKE_LIVE_KEY })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it('raises a failure a caller can branch on', () => {
    expect.assertions(2)

    try {
      resolvePaymentMode({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY })
    } catch (error) {
      expect(error.code).toBe(PROVIDER_ERROR_CODES.PRODUCTION_PAYMENTS_DISABLED)
      expect(error.details.liveCredentials).toEqual(['STRIPE_SECRET_KEY'])
    }
  })

  it('is never printed, not even in the refusal that names it', () => {
    expect.assertions(2)

    try {
      resolvePaymentMode({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY })
    } catch (error) {
      expect(error.message).toContain('STRIPE_SECRET_KEY')
      expect(JSON.stringify(error.message) + JSON.stringify(error.details)).not.toContain(
        FAKE_LIVE_KEY,
      )
    }
  })
})

describe('an environment that asks for production payments', () => {
  it.each(PAYMENT_MODE_REQUEST_KEYS)('refuses %s when it asks for something real', (key) => {
    expect(() => resolvePaymentMode({ [key]: 'stripe' })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it.each(['true', '1', 'yes', 'on', 'live', 'production'])(
    'refuses ENABLE_PRODUCTION_PAYMENTS=%s',
    (value) => {
      expect(() => resolvePaymentMode({ ENABLE_PRODUCTION_PAYMENTS: value })).toThrow(
        PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
      )
    },
  )

  it('refuses rather than falling back, so nobody believes it worked', () => {
    expect.assertions(1)

    try {
      resolvePaymentMode({ PAYMENT_PROVIDER: 'stripe' })
    } catch (error) {
      expect(error.details.modeRequests).toEqual(['PAYMENT_PROVIDER'])
    }
  })

  it.each(['mock', 'demo', 'in-memory', 'none', 'false', '0', 'off', ''])(
    'accepts %s, which asks for what already happens',
    (value) => {
      expect(resolvePaymentMode({ PAYMENT_PROVIDER: value }).mode).toBe(PAYMENT_MODES.MOCK)
    },
  )

  it('is not fooled by a non-string value', () => {
    expect(() => resolvePaymentMode({ ENABLE_PRODUCTION_PAYMENTS: true })).toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })
})

describe('classifying one value', () => {
  it.each([
    [FAKE_LIVE_KEY, 'live'],
    [FAKE_TEST_KEY, 'test'],
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
      STRIPE_SECRET_KEY: FAKE_LIVE_KEY,
      STRIPE_PUBLISHABLE_KEY: FAKE_TEST_KEY,
      RAZORPAY_KEY_SECRET: 'something-opaque',
      DATABASE_URL: 'postgresql://desi:desi@127.0.0.1:5432/desi_event',
    })

    expect(found).toEqual({
      live: ['STRIPE_SECRET_KEY'],
      test: ['STRIPE_PUBLISHABLE_KEY'],
      unknown: ['RAZORPAY_KEY_SECRET'],
    })
  })

  it('finds no mode request in an empty environment', () => {
    expect(findProductionModeRequests({})).toEqual([])
  })
})

describe('the demo label', () => {
  it('is the marker every mock artefact carries', () => {
    expect(DEMO_LABEL).toBe('DEMO')
  })
})
