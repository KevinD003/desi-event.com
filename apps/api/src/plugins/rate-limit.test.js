/**
 * The shared budgets SPEC3 adds (§4.4): wrong referral codes, per account and
 * per address, counting only refusals; a budget shared by several routes, per
 * account; and the booking-fee refund's own limit.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLIENT_ADDRESS_HEADER } from '../lib/traffic.js'
import {
  DEFAULT_FEE_REFUND_LIMIT,
  DEFAULT_PAYMENT_TERMS_LIMIT,
  DEFAULT_REFERRAL_ADMIN_LIMIT,
  DEFAULT_REFERRAL_ATTEMPT_LIMIT,
  REFERRAL_ATTEMPTS_SENTENCE,
  actorBudget,
  feeRefundRateLimit,
  referralAttemptBuckets,
  referralAttemptBudget,
} from './rate-limit.js'

/** The header a trusted web server forwards a visitor's address in. */
const FORWARDED = CLIENT_ADDRESS_HEADER

/**
 * A request as the budget sees it after the guards have run.
 *
 * @param {object} [options] Options.
 * @param {string|null} [options.actorId] The signed-in account, or null.
 * @param {string} [options.ip] The peer's address.
 * @param {Record<string, string>} [options.headers] Headers.
 * @param {object} [options.body] The validated body.
 * @returns {object} A request-shaped object.
 */
function request({ actorId = 'acct-1', ip = '198.51.100.7', headers = {}, body = {} } = {}) {
  return {
    actor: actorId ? { id: actorId } : null,
    ip,
    headers,
    body,
    server: { env: { TRAFFIC_TRUSTED_FORWARDERS: ['127.0.0.1'] } },
  }
}

/** A body that names a referral code. */
const NAMED = { referralCode: 'ANY-CODE' }

afterEach(() => {
  vi.useRealTimers()
})

describe('the wrong referral codes budget', () => {
  it('has the limits SPEC3 §4.4 names', () => {
    expect(DEFAULT_REFERRAL_ATTEMPT_LIMIT).toEqual({
      actorMax: 10,
      addressMax: 30,
      sharedMax: 300,
      timeWindow: '10 minutes',
    })
  })

  it('counts only refusals: a request that is never recorded never spends anything', async () => {
    const budget = referralAttemptBudget()

    // Twelve quotes applying a valid code: the handler records none of them.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await expect(budget.hook(request({ body: NAMED }))).resolves.toBeUndefined()
    }
  })

  it('refuses the eleventh wrong code of one account with 429 and the buyer’s sentence', async () => {
    const budget = referralAttemptBudget()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await budget.hook(request({ body: NAMED }))
      budget.recordRefusal(request({ body: NAMED }))
    }

    const refused = await budget.hook(request({ body: NAMED })).catch((error) => error)

    expect(refused).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: REFERRAL_ATTEMPTS_SENTENCE,
    })
    expect(refused.retryAfterSeconds).toBeGreaterThan(0)
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(600)
  })

  it('lets a request that names no code through even when the bucket is full', async () => {
    const budget = referralAttemptBudget({ actorMax: 1 })

    budget.recordRefusal(request({ body: NAMED }))

    await expect(budget.hook(request({ body: {} }))).resolves.toBeUndefined()
    await expect(budget.hook(request({ body: NAMED }))).rejects.toMatchObject({ statusCode: 429 })
  })

  it('keys the address bucket on the address alone, so a rotating browser shares it', async () => {
    const budget = referralAttemptBudget({ actorMax: 1_000, addressMax: 3 })
    const fromProxy = (actorId, agent) =>
      request({
        actorId,
        ip: '127.0.0.1',
        headers: { [FORWARDED]: '203.0.113.9', 'user-agent': agent },
        body: NAMED,
      })

    // Three accounts, three browsers, one address.
    budget.recordRefusal(fromProxy('acct-a', 'Browser A'))
    budget.recordRefusal(fromProxy('acct-b', 'Browser B'))
    budget.recordRefusal(fromProxy('acct-c', 'Browser C'))

    await expect(budget.hook(fromProxy('acct-d', 'Browser D'))).rejects.toMatchObject({
      statusCode: 429,
    })
    // Another address forwarded by the same proxy has its own bucket.
    await expect(
      budget.hook(
        request({
          actorId: 'acct-e',
          ip: '127.0.0.1',
          headers: { [FORWARDED]: '203.0.113.10' },
          body: NAMED,
        }),
      ),
    ).resolves.toBeUndefined()
  })

  it('never puts the address itself, or the browser, in a key', () => {
    const buckets = referralAttemptBuckets(
      request({
        ip: '127.0.0.1',
        headers: { [FORWARDED]: '203.0.113.9', 'user-agent': 'Browser A' },
      }),
    )
    const sameAddressOtherBrowser = referralAttemptBuckets(
      request({
        ip: '127.0.0.1',
        headers: { [FORWARDED]: '203.0.113.9', 'user-agent': 'Browser B' },
      }),
    )

    expect(buckets.map((bucket) => bucket.key)).toEqual([
      'referral:actor:acct-1',
      expect.stringMatching(/^referral:addr:[0-9a-f]{32}$/u),
    ])
    expect(JSON.stringify(buckets)).not.toContain('203.0.113.9')
    expect(sameAddressOtherBrowser[1].key).toBe(buckets[1].key)
  })

  it('uses the shared bucket when no address can be believed, and never skips it', async () => {
    const budget = referralAttemptBudget({ actorMax: 1_000, sharedMax: 2 })
    // A trusted forwarder that sent no address: nothing to believe.
    const unaddressed = (actorId) => request({ actorId, ip: '127.0.0.1', body: NAMED })

    expect(referralAttemptBuckets(unaddressed('acct-x')).map((bucket) => bucket.key)).toEqual([
      'referral:actor:acct-x',
      'referral:shared',
    ])

    budget.recordRefusal(unaddressed('acct-x'))
    budget.recordRefusal(unaddressed('acct-y'))

    await expect(budget.hook(unaddressed('acct-z'))).rejects.toMatchObject({ statusCode: 429 })
  })

  it('forgets a window once it has passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))

    const budget = referralAttemptBudget({ actorMax: 1 })

    budget.recordRefusal(request({ body: NAMED }))
    await expect(budget.hook(request({ body: NAMED }))).rejects.toMatchObject({ statusCode: 429 })

    vi.setSystemTime(new Date('2026-10-09T10:10:01Z'))

    await expect(budget.hook(request({ body: NAMED }))).resolves.toBeUndefined()
  })
})

describe('a budget shared by several routes', () => {
  it('has sixty an hour for the booking fee and for referral codes', () => {
    expect(DEFAULT_PAYMENT_TERMS_LIMIT).toEqual({ max: 60, timeWindow: '1 hour' })
    expect(DEFAULT_REFERRAL_ADMIN_LIMIT).toEqual({ max: 60, timeWindow: '1 hour' })
  })

  it('is one bucket per account across every route it is given to', async () => {
    const budget = actorBudget({ name: 'payment-terms', max: 3, timeWindow: '1 hour' })
    const setFee = budget
    const setVenuePayment = budget

    await setFee(request())
    await setVenuePayment(request())
    await setFee(request())

    const refused = await setVenuePayment(request()).catch((error) => error)

    expect(refused).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' })
    expect(refused.retryAfterSeconds).toBeGreaterThan(0)
    // Another administrator has a bucket of their own.
    await expect(setFee(request({ actorId: 'acct-2' }))).resolves.toBeUndefined()
  })

  it('refuses a budget with no lower-case name', () => {
    expect(() => actorBudget({ name: '', max: 1, timeWindow: '1 hour' })).toThrow(TypeError)
    expect(() => actorBudget({ name: 'Payment Terms', max: 1, timeWindow: '1 hour' })).toThrow(
      TypeError,
    )
  })
})

describe('the booking-fee refund limit', () => {
  it('is thirty an hour per administrator, keyed on the account', () => {
    const limit = feeRefundRateLimit()

    expect(DEFAULT_FEE_REFUND_LIMIT).toEqual({ max: 30, timeWindow: '1 hour' })
    expect(limit).toMatchObject({ max: 30, timeWindow: '1 hour', hook: 'preHandler' })
    expect(limit.keyGenerator(request({ actorId: 'admin-1' }))).toBe('fee-refund:actor:admin-1')
    expect(feeRefundRateLimit({ max: 2 }).max).toBe(2)
  })
})
