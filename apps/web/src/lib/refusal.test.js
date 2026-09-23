import { describe, expect, it } from 'vitest'

import {
  describeApiRefusal,
  describeWait,
  parseRetryAfter,
  refusalFromResponse,
  refusalSentence,
} from './refusal.js'

describe('describeApiRefusal', () => {
  it.each([
    [{ status: 401, code: 'UNAUTHORIZED' }, 'auth-required', true],
    [{ status: 403, code: 'MFA_ENROLMENT_REQUIRED' }, 'mfa-enrolment', true],
    [{ status: 403, code: 'STEP_UP_REQUIRED' }, 'step-up', true],
    [{ status: 403, code: 'FORBIDDEN' }, 'permission-denied', false],
    [{ status: 403, code: 'CAPABILITY_SCOPE_MISSING' }, 'permission-denied', false],
    [{ status: 404, code: 'NOT_FOUND' }, 'not-found', false],
    [{ status: 409, code: 'CONFLICT' }, 'stale', true],
    [{ status: 410, code: 'HOLD_EXPIRED' }, 'expired', false],
    [{ status: 410, code: 'TRANSFER_EXPIRED' }, 'expired', false],
    [{ status: 400, code: 'VALIDATION_ERROR' }, 'validation', true],
    [{ status: 422, code: 'UNPROCESSABLE' }, 'validation', true],
    [{ status: 429, code: 'RATE_LIMITED' }, 'rate-limited', true],
    [{ status: 503, code: 'API_UNREACHABLE' }, 'network', true],
    [{}, 'network', true],
    [{ status: 500 }, 'server-error', true],
    [{ status: 502, code: 'PAYMENT_TIMEOUT' }, 'server-error', true],
  ])('reads %j as %s', (error, state, recoverable) => {
    const refusal = describeApiRefusal(error)

    expect(refusal.state).toBe(state)
    expect(refusal.recoverable).toBe(recoverable)
    expect(refusal.title.length).toBeGreaterThan(0)
    expect(refusal.detail.length).toBeGreaterThan(0)
  })

  it('tells a lapsed step-up apart from a refusal nothing can fix', () => {
    // The whole point: before this, both read "could not be loaded".
    expect(describeApiRefusal({ status: 403, code: 'STEP_UP_REQUIRED' }).state).not.toBe(
      describeApiRefusal({ status: 403, code: 'FORBIDDEN' }).state,
    )
  })

  it('carries the API’s own message where it is the more specific one', () => {
    const refusal = describeApiRefusal({
      status: 409,
      message: 'The refund was approved by somebody else a moment ago.',
    })

    expect(refusal.detail).toBe('The refund was approved by somebody else a moment ago.')
  })

  it('does not show a generic status line as if it were an explanation', () => {
    expect(
      describeApiRefusal({ status: 409, message: 'The API answered 409.' }).detail,
    ).not.toMatch(/answered 409/)
  })

  it('says how long to wait when the API said', () => {
    expect(describeApiRefusal({ status: 429, retryAfterSeconds: 120 }).detail).toMatch(
      /about 2 minutes/,
    )
    expect(describeApiRefusal({ status: 429 }).retryAfterSeconds).toBeNull()
  })

  it('never names an endpoint, an address or a phone number', () => {
    const everything = [
      {},
      { status: 401 },
      { status: 403, code: 'MFA_ENROLMENT_REQUIRED' },
      { status: 403, code: 'STEP_UP_REQUIRED' },
      { status: 403 },
      { status: 404 },
      { status: 409 },
      { status: 410 },
      { status: 422 },
      { status: 429 },
      { status: 500 },
    ].map((error) => {
      const { title, detail } = describeApiRefusal(error)

      return `${title} ${detail}`
    })

    for (const words of everything) {
      expect(words).not.toMatch(/\/v1\/|@|\+?\d{3}[\s-]?\d{3}[\s-]?\d{4}/)
    }
  })
})

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30)
  })

  it('reads an HTTP date relative to now', () => {
    const now = Date.parse('2026-09-23T10:00:00Z')

    expect(parseRetryAfter('Wed, 23 Sep 2026 10:01:30 GMT', now)).toBe(90)
  })

  it('is null for a date in the past, garbage, or nothing', () => {
    const now = Date.parse('2026-09-23T10:00:00Z')

    expect(parseRetryAfter('Wed, 23 Sep 2026 09:00:00 GMT', now)).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
  })
})

describe('describeWait', () => {
  it.each([
    [5, 'a few seconds'],
    [45, 'about a minute'],
    [180, 'about 3 minutes'],
    [7200, 'about 2 hours'],
  ])('says %i seconds as %s', (seconds, words) => {
    expect(describeWait(seconds)).toBe(words)
  })
})

describe('refusalFromResponse', () => {
  it('reads the code, the message and Retry-After from a refused response', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Slow down.' } }),
      { status: 429, headers: { 'retry-after': '12', 'content-type': 'application/json' } },
    )

    expect(await refusalFromResponse(response)).toEqual({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Slow down.',
      retryAfterSeconds: 12,
    })
  })

  it('copes with a body that is not JSON', async () => {
    const response = new Response('Bad gateway', { status: 502 })

    expect(await refusalFromResponse(response)).toMatchObject({ status: 502, code: null })
  })
})

describe('refusalSentence', () => {
  it('passes a specific conflict or validation message through', () => {
    expect(
      refusalSentence(409, { error: { code: 'CONFLICT', message: 'That slug is taken.' } }, 'x'),
    ).toBe('That slug is taken.')
    expect(
      refusalSentence(422, { error: { code: 'UNPROCESSABLE', message: 'Add a date.' } }, 'x'),
    ).toBe('Add a date.')
  })

  it.each([
    [403, 'STEP_UP_REQUIRED', 'Authenticate at /v1/auth/step-up and retry.'],
    [403, 'MFA_ENROLMENT_REQUIRED', 'Enrol one at /v1/auth/mfa/totp, then try again.'],
    [401, 'UNAUTHORIZED', 'Authentication required at /v1/auth/login.'],
    [500, 'INTERNAL', 'relation "event" does not exist'],
  ])('replaces what the API said for %i %s, which is not for a person', (status, code, message) => {
    const sentence = refusalSentence(status, { error: { code, message } }, 'fallback')

    expect(sentence).not.toContain(message)
    expect(sentence).not.toMatch(/\/v1\//)
    expect(sentence.length).toBeGreaterThan(0)
  })

  it('falls back when the API said nothing', () => {
    expect(refusalSentence(409, null, 'The draft moved on.')).toBe('The draft moved on.')
  })

  it('says how long to wait when it is given the Retry-After', () => {
    const body = { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }

    expect(refusalSentence(429, body, 'x', 120)).toMatch(/2 minutes/)
    expect(refusalSentence(429, body, 'x')).not.toMatch(/minute/)
  })
})
