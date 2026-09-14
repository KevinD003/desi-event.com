import { describe, it, expect } from 'vitest'

import {
  createInMemoryPaymentProvider,
  PAYMENT_INTENT_STATUS,
  PAYMENT_DECLINE_AMOUNT_CENTS,
  DEFAULT_DECLINE_CODE,
  toPaymentStatus,
} from './payments.js'
import { assertPaymentProvider } from './interfaces.js'

const NOW = '2026-09-14T10:00:00.000Z'

/**
 * A provider with a frozen clock, so timestamp assertions are exact.
 *
 * @param {object} [options] Extra construction options.
 * @returns {object} A fresh in-memory payment provider.
 */
function makeProvider(options = {}) {
  return createInMemoryPaymentProvider({ now: NOW, ...options })
}

describe('createInMemoryPaymentProvider', () => {
  it('satisfies the payment provider interface', () => {
    const provider = makeProvider()

    expect(() => assertPaymentProvider(provider)).not.toThrow()
    expect(provider.name).toBe('in-memory-payments')
  })

  it('rejects a decline amount that is not a positive integer', () => {
    expect(() => createInMemoryPaymentProvider({ declineAmountCents: 0 })).toThrowError(
      /positive integer/,
    )
    expect(() => createInMemoryPaymentProvider({ declineAmountCents: 1.5 })).toThrowError(
      /positive integer/,
    )
  })

  it('keeps two providers isolated', () => {
    const a = makeProvider()
    const b = makeProvider()
    const intent = a.createIntent({ amountCents: 100, currency: 'INR' })

    expect(() => b.getStatus(intent.id)).toThrowError(/No payment intent/)
    expect(b.createIntent({ amountCents: 100, currency: 'INR' }).id).toBe(intent.id)
  })
})

describe('createIntent', () => {
  it('returns an authorised intent awaiting capture', () => {
    const intent = makeProvider().createIntent({
      amountCents: 250_000,
      currency: 'inr',
      orderId: 'ord_123',
      metadata: { eventId: 'evt_1' },
    })

    expect(intent).toMatchObject({
      id: 'pi_000001',
      status: PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE,
      amountCents: 250_000,
      currency: 'INR',
      orderId: 'ord_123',
      createdAt: NOW,
      capturedAt: null,
      refundedAt: null,
      metadata: { eventId: 'evt_1' },
    })
  })

  it('maps the intent status onto the Prisma PaymentStatus enum', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })

    expect(intent.paymentStatus).toBe('INITIATED')
    expect(provider.capture(intent.id).paymentStatus).toBe('SUCCEEDED')
    expect(provider.refund(intent.id).paymentStatus).toBe('REFUNDED')
  })

  it('hands back a frozen snapshot that cannot rewrite stored state', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })

    expect(Object.isFrozen(intent)).toBe(true)
    expect(() => {
      'use strict'
      intent.amountCents = 1
    }).toThrow()
    expect(provider.getStatus(intent.id).amountCents).toBe(100)
  })

  it('issues sequential ids', () => {
    const provider = makeProvider()

    expect(provider.createIntent({ amountCents: 100, currency: 'INR' }).id).toBe('pi_000001')
    expect(provider.createIntent({ amountCents: 100, currency: 'INR' }).id).toBe('pi_000002')
  })

  it('rejects a non-object input', () => {
    const provider = makeProvider()

    expect(() => provider.createIntent()).toThrowError(/createIntent expects an object/)
    expect(() => provider.createIntent(null)).toThrowError(/createIntent expects an object/)
    expect(() => provider.createIntent('2500')).toThrowError(/createIntent expects an object/)
  })

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['fractional', 12.5],
    ['a numeric string', '2500'],
    ['absent', undefined],
    ['above the ceiling', 1_000_000_001],
  ])('rejects %s amounts with INVALID_AMOUNT', (_label, amountCents) => {
    const provider = makeProvider()

    try {
      provider.createIntent({ amountCents, currency: 'INR' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_AMOUNT')
      expect(error.statusCode).toBe(400)
    }
  })

  it.each([['INR0'], ['rupees'], [''], [null], [42]])(
    'rejects the currency %p with INVALID_CURRENCY',
    (currency) => {
      const provider = makeProvider()

      try {
        provider.createIntent({ amountCents: 100, currency })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error.code).toBe('INVALID_CURRENCY')
      }
    },
  )

  it('rejects non-object metadata and an empty orderId', () => {
    const provider = makeProvider()

    expect(() =>
      provider.createIntent({ amountCents: 100, currency: 'INR', metadata: 'nope' }),
    ).toThrowError(/plain object/)
    expect(() =>
      provider.createIntent({ amountCents: 100, currency: 'INR', orderId: '   ' }),
    ).toThrowError(/non-empty string/)
  })

  it('copies metadata so later mutation cannot reach the intent', () => {
    const provider = makeProvider()
    const metadata = { attempt: 1 }
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR', metadata })
    metadata.attempt = 2

    expect(provider.getStatus(intent.id).metadata).toEqual({ attempt: 1 })
  })
})

describe('the deterministic failure trigger', () => {
  it('declines the magic amount and stores the failed intent', () => {
    const provider = makeProvider()

    try {
      provider.createIntent({ amountCents: PAYMENT_DECLINE_AMOUNT_CENTS, currency: 'INR' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('PAYMENT_DECLINED')
      expect(error.statusCode).toBe(402)
      expect(error.details.failureCode).toBe(DEFAULT_DECLINE_CODE)

      const stored = provider.getStatus(error.details.intentId)
      expect(stored.status).toBe(PAYMENT_INTENT_STATUS.FAILED)
      expect(stored.failureCode).toBe(DEFAULT_DECLINE_CODE)
      expect(stored.paymentStatus).toBe('FAILED')
    }
  })

  it('honours a custom decline amount', () => {
    const provider = makeProvider({ declineAmountCents: 1234 })

    expect(() => provider.createIntent({ amountCents: 1234, currency: 'INR' })).toThrowError(
      /declined/,
    )
    expect(() =>
      provider.createIntent({ amountCents: PAYMENT_DECLINE_AMOUNT_CENTS, currency: 'INR' }),
    ).not.toThrow()
  })

  it('declines at creation for forceFailure true or "create"', () => {
    const provider = makeProvider()

    expect(() =>
      provider.createIntent({ amountCents: 100, currency: 'INR', forceFailure: true }),
    ).toThrowError(/declined/)
    expect(() =>
      provider.createIntent({ amountCents: 100, currency: 'INR', forceFailure: 'create' }),
    ).toThrowError(/declined/)
  })

  it('reports a caller-supplied failure code', () => {
    const provider = makeProvider()

    try {
      provider.createIntent({
        amountCents: 100,
        currency: 'INR',
        forceFailure: true,
        failureCode: 'insufficient_funds',
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.details.failureCode).toBe('insufficient_funds')
      expect(error.message).toContain('insufficient_funds')
    }
  })

  it('defers the failure to capture for forceFailure "capture"', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({
      amountCents: 100,
      currency: 'INR',
      forceFailure: 'capture',
      failureCode: 'do_not_honor',
    })

    expect(intent.status).toBe(PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE)

    try {
      provider.capture(intent.id)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('PAYMENT_DECLINED')
      expect(error.details.failureCode).toBe('do_not_honor')
    }

    expect(provider.getStatus(intent.id).status).toBe(PAYMENT_INTENT_STATUS.FAILED)
  })

  it('does not leak the internal failure flags onto the public intent', () => {
    const intent = makeProvider().createIntent({
      amountCents: 100,
      currency: 'INR',
      forceFailure: 'capture',
    })

    expect(intent).not.toHaveProperty('failAtCapture')
    expect(intent).not.toHaveProperty('captureFailureCode')
  })
})

describe('capture', () => {
  it('moves an authorised intent to SUCCEEDED and stamps the capture', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 4200, currency: 'INR' })
    const captured = provider.capture(intent.id)

    expect(captured).toMatchObject({
      id: intent.id,
      status: PAYMENT_INTENT_STATUS.SUCCEEDED,
      capturedAt: NOW,
      capturedAmountCents: 4200,
    })
  })

  it('accepts the intent object as well as its id', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 4200, currency: 'INR' })

    expect(provider.capture(intent).status).toBe(PAYMENT_INTENT_STATUS.SUCCEEDED)
  })

  it('accepts an object carrying intentId or providerRef', () => {
    const provider = makeProvider()
    const first = provider.createIntent({ amountCents: 100, currency: 'INR' })
    const second = provider.createIntent({ amountCents: 100, currency: 'INR' })

    expect(provider.capture({ intentId: first.id }).id).toBe(first.id)
    expect(provider.capture({ providerRef: second.id }).id).toBe(second.id)
  })

  it('throws ALREADY_CAPTURED when captured twice', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })
    provider.capture(intent.id)

    try {
      provider.capture(intent.id)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('ALREADY_CAPTURED')
      expect(error.statusCode).toBe(409)
      expect(error.details.intentId).toBe(intent.id)
    }
  })

  it('throws INTENT_NOT_FOUND for an unknown intent', () => {
    const provider = makeProvider()

    try {
      provider.capture('pi_999999')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INTENT_NOT_FOUND')
      expect(error.statusCode).toBe(404)
    }
  })

  it('throws INVALID_INTENT_REFERENCE for a reference carrying no id', () => {
    const provider = makeProvider()

    expect(() => provider.capture('')).toThrowError(/payment intent id/)
    expect(() => provider.capture({})).toThrowError(/payment intent id/)
    expect(() => provider.capture(null)).toThrowError(/payment intent id/)

    try {
      provider.capture(42)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_INTENT_REFERENCE')
    }
  })

  it('throws AMOUNT_MISMATCH when the capture amount disagrees', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 5000, currency: 'INR' })

    try {
      provider.capture(intent.id, { amountCents: 4999 })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('AMOUNT_MISMATCH')
      expect(error.statusCode).toBe(422)
      expect(error.details).toMatchObject({ expectedAmountCents: 5000, receivedAmountCents: 4999 })
    }

    expect(provider.getStatus(intent.id).status).toBe(PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE)
  })

  it('accepts a capture amount that matches exactly', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 5000, currency: 'INR' })

    expect(provider.capture(intent.id, { amountCents: 5000 }).status).toBe(
      PAYMENT_INTENT_STATUS.SUCCEEDED,
    )
  })

  it('validates the capture amount before comparing it', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 5000, currency: 'INR' })

    expect(() => provider.capture(intent.id, { amountCents: -1 })).toThrowError(/integer number/)
  })

  it('throws CURRENCY_MISMATCH when the capture currency disagrees', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 5000, currency: 'INR' })

    try {
      provider.capture(intent.id, { currency: 'USD' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('CURRENCY_MISMATCH')
      expect(error.details).toMatchObject({ expectedCurrency: 'INR', receivedCurrency: 'USD' })
    }

    expect(provider.capture(intent.id, { currency: 'inr' }).status).toBe(
      PAYMENT_INTENT_STATUS.SUCCEEDED,
    )
  })

  it('refuses to capture a refunded or failed intent', () => {
    const provider = makeProvider()
    const refunded = provider.createIntent({ amountCents: 100, currency: 'INR' })
    provider.capture(refunded.id)
    provider.refund(refunded.id)

    expect(() => provider.capture(refunded.id)).toThrowError(/already been refunded/)

    const failing = provider.createIntent({
      amountCents: 100,
      currency: 'INR',
      forceFailure: 'capture',
    })
    expect(() => provider.capture(failing.id)).toThrowError(/declined/)

    try {
      provider.capture(failing.id)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INTENT_FAILED')
    }
  })
})

describe('refund', () => {
  it('moves a captured intent to REFUNDED', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 7500, currency: 'INR' })
    provider.capture(intent.id)
    const refunded = provider.refund(intent.id, { reason: 'Event cancelled' })

    expect(refunded).toMatchObject({
      status: PAYMENT_INTENT_STATUS.REFUNDED,
      refundedAt: NOW,
      refundedAmountCents: 7500,
      refundReason: 'Event cancelled',
    })
    expect(refunded.capturedAt).toBe(NOW)
  })

  it('defaults the refund reason to null', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })
    provider.capture(intent.id)

    expect(provider.refund(intent.id).refundReason).toBeNull()
  })

  it('rejects an empty refund reason', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })
    provider.capture(intent.id)

    expect(() => provider.refund(intent.id, { reason: '  ' })).toThrowError(/non-empty string/)
  })

  it('throws NOT_CAPTURED when the intent was never captured', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })

    try {
      provider.refund(intent.id)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('NOT_CAPTURED')
      expect(error.statusCode).toBe(409)
      expect(error.details.status).toBe(PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE)
    }

    expect(provider.getStatus(intent.id).status).toBe(PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE)
  })

  it('throws ALREADY_REFUNDED on a second refund', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })
    provider.capture(intent.id)
    provider.refund(intent.id)

    try {
      provider.refund(intent.id)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('ALREADY_REFUNDED')
    }
  })

  it('throws INTENT_FAILED when refunding a declined intent', () => {
    const provider = makeProvider()

    try {
      provider.createIntent({ amountCents: 100, currency: 'INR', forceFailure: true })
      expect.unreachable('should have thrown')
    } catch (declined) {
      try {
        provider.refund(declined.details.intentId)
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error.code).toBe('INTENT_FAILED')
      }
    }
  })

  it('throws INTENT_NOT_FOUND for an unknown intent', () => {
    expect(() => makeProvider().refund('pi_404')).toThrowError(/No payment intent/)
  })

  it('throws AMOUNT_MISMATCH for a partial refund', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 5000, currency: 'INR' })
    provider.capture(intent.id)

    try {
      provider.refund(intent.id, { amountCents: 2500 })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('AMOUNT_MISMATCH')
      expect(error.message).toMatch(/refund 2500 cents/)
    }

    expect(provider.getStatus(intent.id).status).toBe(PAYMENT_INTENT_STATUS.SUCCEEDED)
  })

  it('accepts a full refund stated explicitly', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 5000, currency: 'INR' })
    provider.capture(intent.id)

    expect(provider.refund(intent.id, { amountCents: 5000, currency: 'INR' }).status).toBe(
      PAYMENT_INTENT_STATUS.REFUNDED,
    )
  })
})

describe('getStatus, listIntents and reset', () => {
  it('reads an intent back at every stage', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })

    expect(provider.getStatus(intent.id).status).toBe(PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE)
    provider.capture(intent.id)
    expect(provider.getStatus(intent).status).toBe(PAYMENT_INTENT_STATUS.SUCCEEDED)
    provider.refund(intent.id)
    expect(provider.getStatus(intent.id).status).toBe(PAYMENT_INTENT_STATUS.REFUNDED)
  })

  it('throws INTENT_NOT_FOUND for an unknown id', () => {
    try {
      makeProvider().getStatus('pi_000404')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INTENT_NOT_FOUND')
      expect(error.details.intentId).toBe('pi_000404')
    }
  })

  it('lists every intent, failures included, oldest first', () => {
    const provider = makeProvider()
    provider.createIntent({ amountCents: 100, currency: 'INR' })
    expect(() =>
      provider.createIntent({ amountCents: 200, currency: 'INR', forceFailure: true }),
    ).toThrow()

    expect(provider.listIntents().map((intent) => [intent.id, intent.status])).toEqual([
      ['pi_000001', PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE],
      ['pi_000002', PAYMENT_INTENT_STATUS.FAILED],
    ])
  })

  it('forgets intents on reset but keeps issuing fresh ids', () => {
    const provider = makeProvider()
    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })
    provider.reset()

    expect(provider.listIntents()).toEqual([])
    expect(() => provider.getStatus(intent.id)).toThrowError(/No payment intent/)
    expect(provider.createIntent({ amountCents: 100, currency: 'INR' }).id).toBe('pi_000002')
  })
})

describe('an advancing clock', () => {
  it('stamps each lifecycle step with its own instant', () => {
    let minute = 0
    const provider = createInMemoryPaymentProvider({
      now: () => new Date(Date.UTC(2026, 8, 14, 10, minute++)),
    })

    const intent = provider.createIntent({ amountCents: 100, currency: 'INR' })
    const captured = provider.capture(intent.id)
    const refunded = provider.refund(intent.id)

    expect(intent.createdAt).toBe('2026-09-14T10:00:00.000Z')
    expect(captured.capturedAt).toBe('2026-09-14T10:01:00.000Z')
    expect(refunded.refundedAt).toBe('2026-09-14T10:02:00.000Z')
  })
})

describe('toPaymentStatus', () => {
  it('maps every intent status onto the Prisma enum', () => {
    expect(toPaymentStatus(PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE)).toBe('INITIATED')
    expect(toPaymentStatus(PAYMENT_INTENT_STATUS.SUCCEEDED)).toBe('SUCCEEDED')
    expect(toPaymentStatus(PAYMENT_INTENT_STATUS.REFUNDED)).toBe('REFUNDED')
    expect(toPaymentStatus(PAYMENT_INTENT_STATUS.FAILED)).toBe('FAILED')
  })

  it('rejects an unknown status', () => {
    try {
      toPaymentStatus('PENDING')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_OPTIONS')
    }
  })
})
