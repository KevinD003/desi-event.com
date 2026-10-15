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
    [{ status: 413, code: 'PAYLOAD_TOO_LARGE' }, 'validation', true],
    [{ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' }, 'validation', true],
    [{ status: 429, code: 'RATE_LIMITED' }, 'rate-limited', true],
    [{ status: 503, code: 'API_UNREACHABLE' }, 'network', true],
    [{}, 'network', true],
    [{ status: 500 }, 'server-error', true],
    [{ status: 502 }, 'server-error', true],
    // An order was placed and whether it was paid is being checked: pressing
    // the button again is exactly what must not happen, so none of these is
    // recoverable, whatever its status says.
    [{ status: 502, code: 'PAYMENT_TIMEOUT' }, 'payment-unsettled', false],
    [{ status: 500, code: 'ORDER_NOT_COMPLETED' }, 'payment-unsettled', false],
    [{ status: 409, code: 'ORDER_PENDING' }, 'payment-unsettled', false],
    [{ status: 402, code: 'PAYMENT_DECLINED' }, 'payment-declined', true],
    [{ status: 503, code: 'DELIVERY_FAILED' }, 'delivery-failed', true],
    [{ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Nothing was saved.' }, 'busy', true],
    // The busy refusal is the code the API sends for it, SERVICE_UNAVAILABLE.
    // No busy path sends a 503 TRY_AGAIN (the one that does, a run of
    // clashing generated referral codes, is read by its own form), so one
    // reads as any other 503.
    [{ status: 503, code: 'TRY_AGAIN', message: 'Nothing was saved.' }, 'server-error', true],
    // Without the API's sentence a 503 is still a server error.
    [{ status: 503, code: 'SERVICE_UNAVAILABLE' }, 'server-error', true],
    [{ status: 429, code: 'RECIPIENT_DAILY_LIMIT' }, 'recipient-limit', false],
  ])('reads %j as %s', (error, state, recoverable) => {
    const refusal = describeApiRefusal(error)

    expect(refusal.state).toBe(state)
    expect(refusal.recoverable).toBe(recoverable)
    expect(refusal.title.length).toBeGreaterThan(0)
    expect(refusal.detail.length).toBeGreaterThan(0)
  })

  it('keeps the API’s own sentence and the order for a payment that is being checked', () => {
    const refusal = describeApiRefusal({
      status: 502,
      code: 'PAYMENT_TIMEOUT',
      message: 'Whether you were charged is being checked; please do not pay again.',
      orderReference: 'DE-7K2M9Q',
    })

    expect(refusal).toMatchObject({
      state: 'payment-unsettled',
      detail: 'Whether you were charged is being checked; please do not pay again.',
      orderReference: 'DE-7K2M9Q',
      recoverable: false,
    })
    expect(refusal.detail).not.toMatch(/try again/)
  })

  it('keeps the API’s sentence when an email could not be sent, rather than a server error', () => {
    const sentence =
      'The email could not be sent, so the invitation was withdrawn and nothing reached them. Try again in a few minutes.'

    expect(
      refusalSentence(503, { error: { code: 'DELIVERY_FAILED', message: sentence } }, 'x'),
    ).toBe(sentence)
    expect(describeApiRefusal({ status: 503, code: 'DELIVERY_FAILED' }).detail).toMatch(
      /could not be sent.*withdrawn/u,
    )
  })

  it('keeps the API’s sentence for a change that waited too long behind another, and its wait', () => {
    // What `budgetedTransaction` answers: 503 SERVICE_UNAVAILABLE, a sentence
    // saying what was not done, and Retry-After.
    const sentence =
      'Another change to this event was being saved at the same moment, so the booking fee was not changed. Try again in a moment.'

    expect(
      refusalSentence(503, { error: { code: 'SERVICE_UNAVAILABLE', message: sentence } }, 'x', 5),
    ).toBe(sentence)
    // Only the code the API sends keeps the sentence.
    expect(refusalSentence(503, { error: { code: 'TRY_AGAIN', message: sentence } }, 'x')).toMatch(
      /could not finish this/u,
    )
    expect(
      describeApiRefusal({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: sentence,
        retryAfterSeconds: 5,
      }),
    ).toMatchObject({ state: 'busy', detail: sentence, recoverable: true, retryAfterSeconds: 5 })
    // The proxy's own 503 is still "nothing reached The Desi Events", and a 503
    // without a sentence still a server error, whose wording is replaced.
    expect(refusalSentence(503, { error: { code: 'API_UNREACHABLE', message: 'x' } }, 'y')).toMatch(
      /Nothing reached The Desi Events/u,
    )
    expect(refusalSentence(503, { error: { code: 'SERVICE_UNAVAILABLE' } }, 'y')).toMatch(
      /could not finish this/u,
    )
  })

  it('keeps the API’s sentence for an address that has had its codes for the day', () => {
    const sentence =
      'This address has already been sent three codes from The Desi Events today. Try again tomorrow.'

    expect(
      refusalSentence(429, { error: { code: 'RECIPIENT_DAILY_LIMIT', message: sentence } }, 'x'),
    ).toBe(sentence)
    // A plain rate limit is still "wait a little".
    expect(refusalSentence(429, { error: { code: 'RATE_LIMITED', message: 'x' } }, 'y')).toMatch(
      /Wait a little/u,
    )
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

  it('carries the order a checkout refusal names, and only a bare reference', async () => {
    const named = new Response(
      JSON.stringify({
        error: {
          code: 'PAYMENT_TIMEOUT',
          message: 'Do not pay again.',
          orderReference: 'DE-7K2M9Q',
        },
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )
    const prose = new Response(
      JSON.stringify({
        error: { code: 'PAYMENT_TIMEOUT', message: 'Do not pay again.', orderReference: '<b>' },
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )

    expect(await refusalFromResponse(named)).toMatchObject({ orderReference: 'DE-7K2M9Q' })
    expect(await refusalFromResponse(prose)).not.toHaveProperty('orderReference')
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

  it('keeps the API’s sentence about a refused file, and replaces a bare status line', () => {
    expect(
      refusalSentence(
        415,
        {
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'This file is an SVG drawing, not a JPEG, PNG or WebP picture.',
          },
        },
        'x',
      ),
    ).toBe('This file is an SVG drawing, not a JPEG, PNG or WebP picture.')
    expect(
      refusalSentence(
        415,
        { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported Media Type' } },
        'x',
      ),
    ).toMatch(/JPEG, PNG or WebP/)
    expect(
      refusalSentence(
        413,
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } },
        'x',
      ),
    ).toMatch(/larger than this accepts/)
    expect(refusalSentence(413, null, 'x')).toMatch(/Choose a smaller one/)
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

describe('fieldIssues', () => {
  it('keys each validation issue by its field, first message first', async () => {
    const { fieldIssues } = await import('./refusal.js')

    expect(
      fieldIssues({
        error: {
          code: 'VALIDATION_ERROR',
          issues: [
            { path: 'maxPerOrder', message: 'Too big' },
            { path: '/body/priceCents', message: 'Too small' },
            { path: 'sessions.0.endsAt', message: 'Ends too soon' },
            { path: 'maxPerOrder', message: 'A second message' },
            { path: '', message: 'About the whole body' },
          ],
        },
      }),
    ).toEqual({ maxPerOrder: 'Too big', priceCents: 'Too small', sessions: 'Ends too soon' })
  })

  it('answers nothing for a body without issues', async () => {
    const { fieldIssues } = await import('./refusal.js')

    expect(fieldIssues(null)).toEqual({})
    expect(fieldIssues({ error: { code: 'CONFLICT' } })).toEqual({})
  })
})
