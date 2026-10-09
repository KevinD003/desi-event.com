import { describe, expect, it } from 'vitest'

import { InventoryError } from '@desi-event/inventory'
import { PermissionError } from '@desi-event/permissions'
import { PricingError } from '@desi-event/pricing'
import { ProviderError } from '@desi-event/providers'
import { ValidationError, errorResponseSchema } from '@desi-event/schemas'

import {
  DATABASE_REFUSALS,
  FEE_KEPT_SENTENCE,
  ORDER_CHANGED_SENTENCE,
  ORDER_PRICE_RACE_SENTENCE,
  PAYMENT_DUE_SENTENCE,
  PAYMENT_NOT_RECORDED_SENTENCE,
  PAYMENT_TERMS_RACE_SENTENCE,
  PAYMENT_TERMS_REFUSALS,
  PAYMENT_TERMS_SENTENCES,
  REFERRAL_CODE_RACE_SENTENCE,
  REFERRAL_NOT_ACCEPTED_SENTENCE,
  TICKET_CHANGED_ON_ACCEPT_SENTENCE,
  UNPAID_CANCELLED_SENTENCE,
  VENUE_BOOKING_CHANGED_SENTENCE,
  OUT_OF_TIME_RETRY_AFTER_SECONDS,
  OUT_OF_TIME_SENTENCE,
  POSTING_ROLE_SENTENCE,
  REVIEW_REQUIRED_SENTENCE,
  OUT_OF_RANGE_MESSAGE,
  UNSTORABLE_CHARACTER_MESSAGE,
  databaseRefusal,
  exposedServerError,
  httpError,
  isOutOfTime,
  normaliseError,
  paymentTermsRefusal,
  toErrorBody,
} from '../src/lib/errors.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'

/**
 * What Prisma 7 with the pg adapter throws when a transaction runs out of
 * time, as each was observed against PostgreSQL 16: the interactive
 * transaction past its timeout (`P2028`), a statement past its
 * `lock_timeout` (`55P03`), from a raw query (`P2010`) and from a delegate
 * (`P2039`), and one past its `statement_timeout` (`57014`), the SQLSTATE
 * nested where the adapter puts it.
 *
 * @returns {Array<Array<*>>} Pairs of a label and the error.
 */
function outOfTimeErrors() {
  const lockTimeout = (code, kind, sqlState = '55P03') =>
    Object.assign(
      new Error(`${kind} failed. Code: \`${sqlState}\`. canceling statement due to lock timeout`),
      {
        name: 'PrismaClientKnownRequestError',
        code,
        meta: {
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              originalCode: sqlState,
              originalMessage: 'canceling statement due to lock timeout',
              kind: 'postgres',
              code: sqlState,
            },
          },
        },
      },
    )

  return [
    [
      'an expired transaction',
      Object.assign(
        new Error(
          'Transaction API error: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 12991 ms passed since the start of the transaction.',
        ),
        { name: 'PrismaClientKnownRequestError', code: 'P2028' },
      ),
    ],
    ['a raw query past its lock wait', lockTimeout('P2010', 'Raw query')],
    ['a write past its lock wait', lockTimeout('P2039', 'Database error')],
    ['a statement past its budget', lockTimeout('P2039', 'Database error', '57014')],
  ]
}

describe('normaliseError', () => {
  it('keeps the status and code each domain package chose', () => {
    const cases = [
      [
        new ValidationError('bad', [{ path: 'email', code: 'invalid', message: 'nope' }]),
        400,
        'VALIDATION_ERROR',
      ],
      [new PermissionError('denied', { capability: 'event:create' }), 403, 'FORBIDDEN'],
      [new InventoryError('INSUFFICIENT_INVENTORY', 'sold out'), 409, 'INSUFFICIENT_INVENTORY'],
      [new InventoryError('ABOVE_MAXIMUM', 'too many'), 422, 'ABOVE_MAXIMUM'],
      [new PricingError('bad money', { code: 'INVALID_ITEM' }), 422, 'INVALID_ITEM'],
      [new ProviderError('PAYMENT_DECLINED', 'declined'), 402, 'PAYMENT_DECLINED'],
    ]

    for (const [error, statusCode, code] of cases) {
      expect(normaliseError(error)).toMatchObject({ statusCode, code, expected: true })
    }
  })

  it('carries validation issues through, and only for validation failures', () => {
    const issues = [{ path: 'items[0].quantity', code: 'too_small', message: 'at least 1' }]

    expect(normaliseError(new ValidationError('bad', issues)).issues).toEqual(issues)
    expect(normaliseError(new PermissionError('denied'))).not.toHaveProperty('issues')
  })

  it('hides an unexpected failure in production and reveals it elsewhere', () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'secret')")

    const production = normaliseError(bug, { exposeInternals: false })
    const development = normaliseError(bug, { exposeInternals: true })

    expect(production).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      expected: false,
    })
    expect(development.message).toContain('secret')
  })

  it('hides a provider wiring failure too, since a 500 is never the caller fault', () => {
    const wiring = new ProviderError('INVALID_PROVIDER', 'payments adapter is missing capture()')

    expect(normaliseError(wiring, { exposeInternals: false })).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
    })
    expect(normaliseError(wiring, { exposeInternals: true }).message).toContain('capture()')
  })

  it('normalises every JWT failure to a single 401', () => {
    for (const code of [
      'FST_JWT_NO_AUTHORIZATION_IN_HEADER',
      'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED',
      'FAST_JWT_MALFORMED',
    ]) {
      const error = Object.assign(new Error('jwt'), { code, statusCode: 500 })
      expect(normaliseError(error)).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' })
    }
  })

  it('maps a bare status to a conventional code and never leaks a Fastify code', () => {
    expect(normaliseError(Object.assign(new Error('gone'), { statusCode: 410 })).code).toBe(
      'HOLD_EXPIRED',
    )
    expect(
      normaliseError(
        Object.assign(new Error('nope'), { statusCode: 400, code: 'FST_ERR_VALIDATION' }),
      ).code,
    ).toBe('VALIDATION_ERROR')
  })

  it('answers 400, not 500, for a number or a date outside its column', () => {
    // A revision past an integer column, as Prisma refused it: P2020 over 22003.
    const integer = Object.assign(
      new Error('Value out of range for the type: value "2147483648" is out of range'),
      {
        name: 'PrismaClientKnownRequestError',
        code: 'P2020',
        meta: {
          modelName: 'Event',
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              originalCode: '22003',
              originalMessage: 'value "2147483648" is out of range for type integer',
              kind: 'ValueOutOfRange',
            },
          },
        },
      },
    )
    // A date in year 0, as PostgreSQL refused it: P2039 over 22008.
    const date = Object.assign(new Error('Database error. Code: `22008`.'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2039',
      meta: {
        modelName: 'Refund',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '22008',
            originalMessage: 'date/time field value out of range: "0000-06-01 00:00:00"',
            kind: 'postgres',
          },
        },
      },
    })

    for (const error of [integer, date]) {
      for (const exposeInternals of [true, false]) {
        expect(normaliseError(error, { exposeInternals })).toEqual({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: OUT_OF_RANGE_MESSAGE,
          expected: true,
        })
      }
    }
  })

  it('answers 400, not 500, for a character PostgreSQL cannot store', () => {
    // The shape the Prisma driver adapter throws for a NUL in a text value,
    // copied from a real query against PostgreSQL.
    const nul = Object.assign(new Error('Database error. Code: `22021`.'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2039',
      meta: {
        modelName: 'Event',
        driverAdapterError: {
          cause: {
            originalCode: '22021',
            originalMessage: 'invalid byte sequence for encoding "UTF8": 0x00',
            kind: 'postgres',
          },
        },
      },
    })

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(nul, { exposeInternals })).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: UNSTORABLE_CHARACTER_MESSAGE,
        expected: true,
      })
    }

    // And the NUL a JSON column refuses: `\u0000` in a jsonb value is 22P05,
    // "unsupported Unicode escape sequence", again copied from a real query.
    const jsonNul = {
      ...nul,
      meta: {
        modelName: 'AuditLog',
        driverAdapterError: {
          cause: {
            originalCode: '22P05',
            originalMessage: 'unsupported Unicode escape sequence',
            kind: 'postgres',
          },
        },
      },
    }

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(jsonNul, { exposeInternals })).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: UNSTORABLE_CHARACTER_MESSAGE,
        expected: true,
      })
    }

    // And a lone surrogate a JSON column refuses: 22P02, "invalid input
    // syntax for type json", which Prisma reports as P2007. Copied from a real
    // audit write.
    const loneSurrogate = Object.assign(
      new Error('Invalid input value: invalid input syntax for type json'),
      {
        name: 'PrismaClientKnownRequestError',
        code: 'P2007',
        meta: {
          modelName: 'AuditLog',
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              originalCode: '22P02',
              originalMessage: 'invalid input syntax for type json',
              kind: 'InvalidInputValue',
              message: 'invalid input syntax for type json',
            },
          },
        },
      },
    )

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(loneSurrogate, { exposeInternals })).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: UNSTORABLE_CHARACTER_MESSAGE,
        expected: true,
      })
    }

    // 22P02 is any malformed literal: one that is not about JSON is a fault.
    const notJson = {
      ...nul,
      code: 'P2007',
      message: 'Invalid input value: invalid input syntax for type integer: "abc"',
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '22P02',
            originalMessage: 'invalid input syntax for type integer: "abc"',
            kind: 'InvalidInputValue',
          },
        },
      },
    }

    expect(normaliseError(notJson, { exposeInternals: false })).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
    })

    // Only those SQLSTATEs: any other database failure under the same Prisma
    // code is still a fault, and still hidden in production.
    const check = {
      ...nul,
      meta: { driverAdapterError: { cause: { originalCode: '23514', kind: 'postgres' } } },
    }

    expect(normaliseError(check, { exposeInternals: false })).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
    })
  })

  it('keeps the words of a 5xx the API raised for the caller to read, in production too', () => {
    // A checkout whose capture timed out: "do not pay again" is the sentence
    // the buyer needs, and masking it is how somebody comes to pay twice.
    const timeout = exposedServerError(
      502,
      'PAYMENT_TIMEOUT',
      'Whether you were charged is being checked; please do not pay again.',
      { orderReference: 'DE-7K2M9Q' },
    )

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(timeout, { exposeInternals })).toEqual({
        statusCode: 502,
        code: 'PAYMENT_TIMEOUT',
        message: 'Whether you were charged is being checked; please do not pay again.',
        orderReference: 'DE-7K2M9Q',
        expected: false,
      })
    }

    // The same status raised the ordinary way is still masked.
    expect(
      normaliseError(httpError(502, 'PAYMENT_TIMEOUT', 'upstream said: 10.0.0.4 refused'), {
        exposeInternals: false,
      }),
    ).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' })
  })

  it('forwards the order a refusal is about, and only a bare reference', () => {
    const pending = httpError(409, 'ORDER_PENDING', 'Still being checked.', {
      orderReference: 'DE-7K2M9Q',
    })
    const prose = httpError(409, 'ORDER_PENDING', 'Still being checked.', {
      orderReference: 'the order you placed a moment ago',
    })

    expect(normaliseError(pending).orderReference).toBe('DE-7K2M9Q')
    expect(toErrorBody(normaliseError(pending)).error.orderReference).toBe('DE-7K2M9Q')
    expect(normaliseError(prose)).not.toHaveProperty('orderReference')
    expect(toErrorBody(normaliseError(prose)).error).not.toHaveProperty('orderReference')
  })

  it('forwards details only for the website refusals that name them, and only their keys', () => {
    const changed = httpError(409, 'WEBSITE_CHANGED', 'The address changed.', {
      currentWebsiteUrl: 'https://rangoli.example/',
      problems: ['ignored here'],
      internal: 'never sent',
    })
    const removed = httpError(409, 'WEBSITE_CHANGED', 'The address changed.', {
      currentWebsiteUrl: null,
    })
    const unchanged = httpError(409, 'WEBSITE_REDIRECT_UNCHANGED', 'Already on.', {
      enabled: true,
      currentWebsiteUrl: 'https://rangoli.example/',
    })

    expect(errorResponseSchema.parse(toErrorBody(normaliseError(changed))).error.details).toEqual({
      currentWebsiteUrl: 'https://rangoli.example/',
    })
    expect(toErrorBody(normaliseError(removed)).error.details).toEqual({ currentWebsiteUrl: null })
    expect(errorResponseSchema.parse(toErrorBody(normaliseError(unchanged))).error.details).toEqual(
      { enabled: true },
    )

    // Any other code, a wrong type, or a 5xx carries none.
    const others = [
      httpError(409, 'CONFLICT', 'No.', { currentWebsiteUrl: 'https://rangoli.example/' }),
      httpError(409, 'WEBSITE_REDIRECT_UNCHANGED', 'Already on.', { enabled: 'yes' }),
      httpError(409, 'WEBSITE_CHANGED', 'Changed.', { currentWebsiteUrl: 42 }),
      httpError(409, 'WEBSITE_CHANGED', 'Changed.'),
      httpError(500, 'WEBSITE_CHANGED', 'Changed.', { currentWebsiteUrl: 'https://x.example/' }),
    ]

    for (const error of others) {
      expect(toErrorBody(normaliseError(error)).error).not.toHaveProperty('details')
    }
  })

  it('answers a transaction that ran out of time, by budget or by lock wait, with a 503 to try again', () => {
    for (const [label, error] of outOfTimeErrors()) {
      expect(isOutOfTime(error), label).toBe(true)

      for (const exposeInternals of [true, false]) {
        const normalised = normaliseError(error, { exposeInternals })

        expect(normalised, label).toEqual({
          statusCode: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: OUT_OF_TIME_SENTENCE,
          expected: true,
          retryAfterSeconds: OUT_OF_TIME_RETRY_AFTER_SECONDS,
        })

        const body = toErrorBody(normalised, 'DE-REQ')

        expect(errorResponseSchema.parse(body).error.statusCode).toBe(503)
        expect(JSON.stringify(body), label).not.toMatch(
          /P2028|P2039|P2010|55P03|57014|expired|lock timeout/,
        )
      }
    }

    // A lost deadlock is still TRY_AGAIN, and anything else of the database's
    // is still a fault: only these two codes are out of time.
    expect(isOutOfTime(Object.assign(new Error('deadlock'), { code: '40P01' }))).toBe(false)
    expect(isOutOfTime(Object.assign(new Error('unique'), { code: 'P2002' }))).toBe(false)
    expect(isOutOfTime(null)).toBe(false)
    expect(normaliseError(Object.assign(new Error('x'), { code: 'P2025' })).statusCode).toBe(500)
  })

  it('treats a nonsensical status as a server error', () => {
    expect(normaliseError(Object.assign(new Error('x'), { statusCode: 999 })).statusCode).toBe(500)
    expect(normaliseError(Object.assign(new Error('x'), { statusCode: 200 })).statusCode).toBe(500)
    expect(normaliseError('a string, thrown by something careless').statusCode).toBe(500)
  })
})

describe('databaseRefusal', () => {
  /**
   * A refusal shaped the way Prisma's driver adapter reports a raised
   * exception: a known request error whose cause carries the SQLSTATE and the
   * database's own message.
   *
   * @param {string} message The database's message.
   * @param {string} [code] The SQLSTATE.
   * @returns {Error} The error.
   */
  function adapterError(message, code = '23514') {
    return Object.assign(new Error('Invalid `prisma.event.update()` invocation'), {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: code, originalMessage: message } } },
    })
  }

  it('answers 409 REVIEW_REQUIRED when the review gate refuses a status', () => {
    const refusal = databaseRefusal(
      adapterError('event_public_requires_review: an event becomes public only after review'),
    )

    expect(refusal).toMatchObject({
      statusCode: 409,
      code: 'REVIEW_REQUIRED',
      message: REVIEW_REQUIRED_SENTENCE,
    })
  })

  it('answers 403 POSTING_ROLE_NEEDS_PLATFORM when a team invitation offers a posting role', () => {
    const refusal = databaseRefusal(
      Object.assign(new Error('violates check constraint'), {
        code: 'P2004',
        meta: { constraint: 'invitation_pending_role_is_owner_grantable' },
      }),
    )

    expect(refusal).toMatchObject({
      statusCode: 403,
      code: 'POSTING_ROLE_NEEDS_PLATFORM',
      message: POSTING_ROLE_SENTENCE,
    })
  })

  it('reads a raw driver error too: a SQLSTATE and the constraint in its message', () => {
    const raw = Object.assign(new Error('new row violates event_public_requires_review'), {
      code: '23514',
    })

    expect(databaseRefusal(raw)?.code).toBe('REVIEW_REQUIRED')
  })

  it('needs both the check SQLSTATE and a known name: anything else stays a fault', () => {
    // A known name with another SQLSTATE.
    expect(databaseRefusal(adapterError('event_public_requires_review', '23505'))).toBeNull()
    // A check violation nobody has a sentence for.
    expect(databaseRefusal(adapterError('ticket_quantity_positive'))).toBeNull()
    expect(databaseRefusal(null)).toBeNull()
    expect(databaseRefusal('event_public_requires_review')).toBeNull()
    expect(databaseRefusal(new Error('event_public_requires_review'))).toBeNull()
  })

  it('is applied by normaliseError, so a refusal is never a 500 and carries no SQL', () => {
    const normalised = normaliseError(
      adapterError(
        'ERROR: event_public_requires_review (status PUBLISHED) on relation "Event" row 42',
      ),
      { exposeInternals: false },
    )

    expect(normalised).toMatchObject({ statusCode: 409, code: 'REVIEW_REQUIRED' })
    expect(JSON.stringify(toErrorBody(normalised))).not.toMatch(/relation|row 42|ERROR:/u)
  })

  it('names each refusal once, with a 4xx', () => {
    const names = DATABASE_REFUSALS.map((refusal) => refusal.constraint)

    expect(new Set(names).size).toBe(names.length)

    for (const refusal of DATABASE_REFUSALS) {
      expect(refusal.statusCode).toBeGreaterThanOrEqual(400)
      expect(refusal.statusCode).toBeLessThan(500)
    }
  })
})

describe('SPEC3 database refusals (§5.5)', () => {
  /**
   * A refusal as the pg adapter reports a CHECK or a trigger raising 23514:
   * the constraint named in the message, the failing row in `detail`.
   *
   * @param {string} constraint The constraint or trigger name.
   * @returns {Error} The error.
   */
  function refused(constraint) {
    return Object.assign(new Error('Invalid `prisma.order.create()` invocation'), {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '23514',
            originalMessage: `new row for relation violates check constraint "${constraint}"`,
            detail: 'Failing row contains (WAIVE-12345, Asha Buyer, asha@example.test).',
          },
        },
      },
    })
  }

  /** Every constraint and trigger name SPEC3 adds, and the answer each must get. */
  const EXPECTED = {
    event_fee_shape: ['PAYMENT_TERMS_CHANGED', PAYMENT_TERMS_RACE_SENTENCE],
    event_fee_setting_shape: ['PAYMENT_TERMS_CHANGED', PAYMENT_TERMS_RACE_SENTENCE],
    event_venue_payment_shape: ['PAYMENT_TERMS_CHANGED', PAYMENT_TERMS_RACE_SENTENCE],
    event_venue_payment_change_shape: ['PAYMENT_TERMS_CHANGED', PAYMENT_TERMS_RACE_SENTENCE],
    event_fee_setting_append_only: ['PAYMENT_TERMS_CHANGED', PAYMENT_TERMS_RACE_SENTENCE],
    referral_code_shape: ['REFERRAL_CODE_CHANGED', REFERRAL_CODE_RACE_SENTENCE],
    referral_code_use_within_limit: ['REFERRAL_NOT_ACCEPTED', REFERRAL_NOT_ACCEPTED_SENTENCE],
    order_fee_parts: ['PRICE_CHANGED', ORDER_PRICE_RACE_SENTENCE],
    order_fee_waiver_whole: ['PRICE_CHANGED', ORDER_PRICE_RACE_SENTENCE],
    order_fee_terms_shape: ['PRICE_CHANGED', ORDER_PRICE_RACE_SENTENCE],
    order_venue_payment_shape: ['PRICE_CHANGED', ORDER_PRICE_RACE_SENTENCE],
    order_item_venue_due_shape: ['PRICE_CHANGED', ORDER_PRICE_RACE_SENTENCE],
    check_in_payment_due: ['PAYMENT_DUE', PAYMENT_DUE_SENTENCE],
    ticket_venue_due_shape: ['PAYMENT_NOT_RECORDED', PAYMENT_NOT_RECORDED_SENTENCE],
    venue_payment_shape: ['PAYMENT_NOT_RECORDED', PAYMENT_NOT_RECORDED_SENTENCE],
    ticket_venue_payment_fixed: ['PAYMENT_NOT_RECORDED', PAYMENT_NOT_RECORDED_SENTENCE],
    venue_payment_order: ['PAYMENT_NOT_RECORDED', PAYMENT_NOT_RECORDED_SENTENCE],
    venue_payment_append_only: ['PAYMENT_NOT_RECORDED', PAYMENT_NOT_RECORDED_SENTENCE],
    venue_payment_sum: ['PAYMENT_NOT_RECORDED', PAYMENT_NOT_RECORDED_SENTENCE],
  }

  it.each(Object.entries(EXPECTED))('answers %s with 409 %s', (constraint, [code, message]) => {
    expect(databaseRefusal(refused(constraint))).toMatchObject({ statusCode: 409, code, message })
  })

  it('takes the longest name, so a name inside another one never answers for it', () => {
    // `event_venue_payment_shape` and `order_venue_payment_shape` both contain
    // `venue_payment_shape`, whose answer is the door's, not the fee's or the
    // order's.
    expect(databaseRefusal(refused('event_venue_payment_shape'))?.code).toBe(
      'PAYMENT_TERMS_CHANGED',
    )
    expect(databaseRefusal(refused('order_venue_payment_shape'))?.code).toBe('PRICE_CHANGED')
    expect(databaseRefusal(refused('venue_payment_shape'))?.code).toBe('PAYMENT_NOT_RECORDED')
  })

  it("maps no refusal the owner's answers removed: no per-account limit, and handing on is allowed", () => {
    expect(DATABASE_REFUSALS.map((refusal) => refusal.constraint)).not.toContain(
      'ticket_paid_at_venue_not_transferable',
    )
    expect(Object.keys(PAYMENT_TERMS_REFUSALS)).not.toContain('PAID_AT_VENUE_NOT_TRANSFERABLE')
    expect(Object.keys(PAYMENT_TERMS_REFUSALS)).not.toContain('VENUE_PAYMENT_LIMIT')
  })

  it('sends the sentence and never the failing row', () => {
    const body = JSON.stringify(
      toErrorBody(normaliseError(refused('referral_code_use_within_limit')), 'req-1'),
    )

    expect(body).toContain('REFERRAL_NOT_ACCEPTED')
    expect(body).not.toMatch(/WAIVE-12345|Asha|Failing row|asha@example/u)
  })
})

describe('SPEC3 refusals (§4.5)', () => {
  it('holds every new code with its status, and 409 unless marked', () => {
    const statuses = Object.fromEntries(
      Object.entries(PAYMENT_TERMS_REFUSALS).map(([code, refusal]) => [code, refusal.statusCode]),
    )

    expect(statuses).toEqual({
      SIGN_IN_REQUIRED: 401,
      VENUE_PAYMENT_OFF: 409,
      VENUE_PAYMENT_UNAVAILABLE: 409,
      NOTHING_TO_PAY_AT_VENUE: 422,
      VENUE_PAYMENT_FULL: 409,
      VENUE_PAYMENT_ONLINE_EVENT: 422,
      VENUE_PAYMENT_UNCHANGED: 409,
      VENUE_LIMIT_REQUIRED: 422,
      PAYMENT_TERMS_CHANGED: 409,
      PLATFORM_FEE_UNCHANGED: 409,
      FEE_TERMS_CURRENCY: 409,
      REFERRAL_NOT_ACCEPTED: 409,
      REFERRAL_CODE_TAKEN: 409,
      REFERRAL_CODE_EXPIRED: 409,
      REFERRAL_LIMIT_BELOW_USES: 422,
      REFERRAL_EVENT_NOT_ELIGIBLE: 422,
      REFERRAL_CODE_CHANGED: 409,
      PAYMENT_DUE: 409,
      PAYMENT_AMOUNT_MISMATCH: 422,
      PAYMENT_NOT_RECORDED: 409,
      NO_FEE_TO_REFUND: 409,
      AMOUNT_REFUND_NOT_FOR_VENUE_ORDERS: 422,
      // Cancelling unpaid tickets and giving referral uses back (SPEC3-XI §4.5).
      NOT_A_VENUE_BOOKING: 409,
      TICKET_NOT_IN_BOOKING: 422,
      VENUE_CANCEL_NOT_LIVE: 409,
      VENUE_NIGHT_OVER: 409,
      VENUE_BOOKING_CHANGED: 409,
      REFUND_IN_PROGRESS: 409,
      VENUE_CANCEL_TAXED: 409,
      FEE_KEPT: 409,
      ORDER_CHANGED: 409,
    })
  })

  it('carries the spec’s sentences word for word', () => {
    expect(PAYMENT_TERMS_REFUSALS.VENUE_PAYMENT_FULL.message).toBe(
      'Paying at the venue is full for this event. You can still pay by card.',
    )
    expect(PAYMENT_TERMS_REFUSALS.PLATFORM_FEE_UNCHANGED.message).toBe(
      'The booking fee is already set to that. Nothing was changed.',
    )
    expect(PAYMENT_TERMS_REFUSALS.REFERRAL_CODE_TAKEN.message).toBe(
      'That code is already in use. Choose another, or generate one.',
    )
    expect(PAYMENT_TERMS_SENTENCES.conflictOfInterest).toBe(
      "You belong to this event's organisation, so another administrator has to make this change.",
    )
    expect(PAYMENT_TERMS_SENTENCES.referralRateLimited).toBe(
      'Too many referral codes were tried. Wait a few minutes, then try again.',
    )
  })

  it('tells a buyer whose referral code was not accepted the sentence of §6.5, which §5.5 names for the database too', () => {
    const sentence =
      'Your referral code can no longer be used for this booking, so the booking fee is back. Nothing has been charged. Check the new total, then pay.'

    expect(REFERRAL_NOT_ACCEPTED_SENTENCE).toBe(sentence)
    // The database's refusal answers with the same constant (the §5.5 table above).
    expect(PAYMENT_TERMS_REFUSALS.REFERRAL_NOT_ACCEPTED.message).toBe(sentence)
  })

  it('says a booking with nothing to pay at the door was not booked, and nothing was charged', () => {
    expect(PAYMENT_TERMS_REFUSALS.NOTHING_TO_PAY_AT_VENUE.message).toBe(
      'These tickets have no ticket price to pay at the door, so there is nothing to pay at the venue. Book them without choosing to pay at the venue. Nothing has been charged.',
    )
  })

  it('never claims that a refused request booked anything', () => {
    for (const message of [
      ...Object.values(PAYMENT_TERMS_REFUSALS).map((refusal) => refusal.message),
      ...Object.values(PAYMENT_TERMS_SENTENCES),
    ]) {
      expect(message).not.toMatch(/\b(?:is|are|was|were|been) booked\b/iu)
    }
  })

  it('never says "soon", "yet" or "planned", and never names a code', () => {
    for (const message of [
      ...Object.values(PAYMENT_TERMS_REFUSALS).map((refusal) => refusal.message),
      ...Object.values(PAYMENT_TERMS_SENTENCES),
    ]) {
      expect(message).not.toMatch(/\b(soon|yet|planned)\b/iu)
      expect(message).not.toMatch(/\bcash\b/iu)
    }
  })

  it('completes a sentence from the values the service knows, and refuses a missing one', () => {
    const error = paymentTermsRefusal('FEE_TERMS_CURRENCY', { values: { currency: 'USD' } })

    expect(error).toMatchObject({ statusCode: 409, code: 'FEE_TERMS_CURRENCY' })
    expect(error.message).toBe(
      "The Desi-Event team set this event's booking fee in USD. Ask them to change it before pricing tickets in another currency.",
    )
    expect(() => paymentTermsRefusal('FEE_TERMS_CURRENCY')).toThrow(TypeError)
    expect(() => paymentTermsRefusal('MADE_UP')).toThrow(TypeError)
  })

  it('tells the caller the details a refusal names, and nothing else', () => {
    const due = normaliseError(
      paymentTermsRefusal('PAYMENT_DUE', {
        values: { amount: '$40.00' },
        details: {
          dueCents: 4000,
          booking: { otherUnpaidTickets: 1, otherUnpaidCents: 4000 },
          ticketId: 'secret-ish',
        },
      }),
    )

    expect(due.details).toEqual({
      dueCents: 4000,
      booking: { otherUnpaidTickets: 1, otherUnpaidCents: 4000 },
    })
    expect(errorResponseSchema.safeParse(toErrorBody(due, 'r')).success).toBe(true)

    const moved = normaliseError(
      httpError(409, 'PRICE_CHANGED', 'The total changed since it was shown.', {
        totalCents: 8578,
        venueDueCents: 8000,
        feesCents: 578,
        discountCents: 0,
      }),
    )

    expect(moved.details).toEqual({ totalCents: 8578, venueDueCents: 8000, feesCents: 578 })

    const stale = normaliseError(
      paymentTermsRefusal('PAYMENT_TERMS_CHANGED', { details: { currentSequence: -1 } }),
    )

    expect(stale.details).toBeUndefined()
  })
})

describe('SPEC3-XI database refusals (§5.5)', () => {
  /**
   * A refusal as the pg adapter reports a CHECK or a trigger raising 23514.
   *
   * @param {string} constraint The constraint or trigger name.
   * @returns {Error} The error.
   */
  function refused(constraint) {
    return Object.assign(new Error('Invalid `prisma.ticket.update()` invocation'), {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '23514',
            originalMessage: `new row for relation violates check constraint "${constraint}"`,
            detail:
              'Failing row contains (cl0000000000000000000001, Asha Buyer, asha@example.test).',
          },
        },
      },
    })
  }

  /** Every constraint and trigger name SPEC3-XI adds, and the answer each must get. */
  const EXPECTED = {
    venue_booking_cancellation_shape: ['VENUE_BOOKING_CHANGED', VENUE_BOOKING_CHANGED_SENTENCE],
    venue_booking_cancellation_sum: ['VENUE_BOOKING_CHANGED', VENUE_BOOKING_CHANGED_SENTENCE],
    venue_booking_cancellation_append_only: [
      'VENUE_BOOKING_CHANGED',
      VENUE_BOOKING_CHANGED_SENTENCE,
    ],
    ticket_venue_cancellation_fixed: ['VENUE_BOOKING_CHANGED', VENUE_BOOKING_CHANGED_SENTENCE],
    venue_cancellation_ticket: ['VENUE_BOOKING_CHANGED', VENUE_BOOKING_CHANGED_SENTENCE],
    ticket_venue_cancellation_shape: ['VENUE_BOOKING_CHANGED', VENUE_BOOKING_CHANGED_SENTENCE],
    order_venue_cancel_shape: ['VENUE_BOOKING_CHANGED', VENUE_BOOKING_CHANGED_SENTENCE],
    order_item_venue_cancelled_within_line: [
      'VENUE_BOOKING_CHANGED',
      VENUE_BOOKING_CHANGED_SENTENCE,
    ],
    ticket_type_sold_not_negative: ['VENUE_BOOKING_CHANGED', VENUE_BOOKING_CHANGED_SENTENCE],
    order_venue_kept_within_total: ['FEE_KEPT', FEE_KEPT_SENTENCE],
    order_referral_return_shape: ['ORDER_CHANGED', ORDER_CHANGED_SENTENCE],
    order_referral_return_once: ['ORDER_CHANGED', ORDER_CHANGED_SENTENCE],
    order_referral_code_fixed: ['ORDER_CHANGED', ORDER_CHANGED_SENTENCE],
  }

  it.each(Object.entries(EXPECTED))('answers %s with 409 %s', (constraint, [code, message]) => {
    expect(databaseRefusal(refused(constraint))).toMatchObject({ statusCode: 409, code, message })
    expect(normaliseError(refused(constraint)).reason).toBeUndefined()
  })

  it.each(['ticket_venue_due_fixed', 'ticket_venue_due_successor', 'ticket_venue_insert_unpaid'])(
    'answers %s as a transfer acceptance that raced a change: 409 CONFLICT, reason TICKET_CHANGED',
    (constraint) => {
      expect(databaseRefusal(refused(constraint))).toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        message: TICKET_CHANGED_ON_ACCEPT_SENTENCE,
      })

      const normalised = normaliseError(refused(constraint))

      expect(normalised).toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        reason: 'TICKET_CHANGED',
      })

      const body = toErrorBody(normalised, 'req-1')

      expect(body.error.reason).toBe('TICKET_CHANGED')
      expect(errorResponseSchema.safeParse(body).success).toBe(true)
    },
  )

  it('never lets a shorter name answer for a longer one', () => {
    // `ticket_venue_due_shape` (F3-A) and the guard names differ; the longest
    // match wins, so each keeps its own answer.
    expect(databaseRefusal(refused('ticket_venue_due_shape'))?.code).toBe('PAYMENT_NOT_RECORDED')
    expect(databaseRefusal(refused('ticket_venue_cancellation_shape'))?.code).toBe(
      'VENUE_BOOKING_CHANGED',
    )
    expect(databaseRefusal(refused('venue_booking_cancellation_sum'))?.code).toBe(
      'VENUE_BOOKING_CHANGED',
    )
  })

  it('maps no tax-kept name: only the booking fee is ever kept (XU6)', () => {
    const names = DATABASE_REFUSALS.map((refusal) => refusal.constraint)

    for (const name of names) expect(name).not.toMatch(/tax_kept|taxkept/iu)
  })

  it('sends the sentence and never the failing row', () => {
    const body = JSON.stringify(
      toErrorBody(normaliseError(refused('venue_booking_cancellation_sum')), 'req-1'),
    )

    expect(body).toContain('VENUE_BOOKING_CHANGED')
    expect(body).not.toMatch(/cl0000000000000000000001|Asha|Failing row|asha@example/u)
  })
})

describe('SPEC3-XI refusals (§4.5)', () => {
  it('carries the sentences word for word, honestly', () => {
    expect(UNPAID_CANCELLED_SENTENCE).toBe('This ticket was cancelled because it was not paid for.')
    expect(PAYMENT_TERMS_REFUSALS.VENUE_BOOKING_CHANGED.message).toBe(
      VENUE_BOOKING_CHANGED_SENTENCE,
    )
    expect(VENUE_BOOKING_CHANGED_SENTENCE).toMatch(/Nothing was cancelled\./u)
    expect(PAYMENT_TERMS_REFUSALS.FEE_KEPT.message).toBe(FEE_KEPT_SENTENCE)
    expect(PAYMENT_TERMS_REFUSALS.ORDER_CHANGED.message).toBe(ORDER_CHANGED_SENTENCE)
    expect(PAYMENT_TERMS_REFUSALS.VENUE_NIGHT_OVER.message).toBe(
      'That night is over. Tickets not paid by then stay as they are, and the booking fee is kept.',
    )
    expect(PAYMENT_TERMS_SENTENCES.venueCancelTryAgain).toMatch(/nothing was cancelled/u)
  })

  it('keeps VENUE_CANCEL_TAXED although nothing reaches it in this build', () => {
    // The online booking fee of a pay-at-the-venue booking carries no tax
    // (open question 9), so no booking can be taxed; the refusal stands ready
    // for the day it can (open question F).
    expect(paymentTermsRefusal('VENUE_CANCEL_TAXED')).toMatchObject({
      statusCode: 409,
      code: 'VENUE_CANCEL_TAXED',
      message: 'This booking carries tax on its booking fee. Refund its tickets instead.',
    })
  })

  it('names the chosen tickets that changed, and nothing else', () => {
    const ticketIds = ['cl00000000000000000000a1', 'cl00000000000000000000a2']
    const changed = normaliseError(
      paymentTermsRefusal('VENUE_BOOKING_CHANGED', {
        details: { ticketIds, buyerEmail: 'asha@example.test' },
      }),
    )

    expect(changed.details).toEqual({ ticketIds })
    expect(errorResponseSchema.safeParse(toErrorBody(changed, 'r')).success).toBe(true)

    for (const bad of [[], ['Not An Id'], Array.from({ length: 101 }, () => ticketIds[0])]) {
      expect(
        normaliseError(
          paymentTermsRefusal('VENUE_BOOKING_CHANGED', { details: { ticketIds: bad } }),
        ).details,
      ).toBeUndefined()
    }
  })

  it('tells the door whether the group pass covers the holder’s other unpaid tickets', () => {
    const due = normaliseError(
      paymentTermsRefusal('PAYMENT_DUE', {
        values: { amount: '$40.00' },
        details: {
          dueCents: 4000,
          booking: { otherUnpaidTickets: 2, otherUnpaidCents: 8000, groupPass: true },
        },
      }),
    )

    expect(due.details).toEqual({
      dueCents: 4000,
      booking: { otherUnpaidTickets: 2, otherUnpaidCents: 8000, groupPass: true },
    })
    expect(errorResponseSchema.safeParse(toErrorBody(due, 'r')).success).toBe(true)

    const odd = normaliseError(
      paymentTermsRefusal('PAYMENT_DUE', {
        values: { amount: '$40.00' },
        details: {
          dueCents: 4000,
          booking: { otherUnpaidTickets: 2, otherUnpaidCents: 8000, groupPass: 'yes' },
        },
      }),
    )

    expect(odd.details).toEqual({ dueCents: 4000 })
  })
})

describe('toErrorBody', () => {
  it('builds the envelope and truncates a runaway request id', () => {
    const body = toErrorBody(normaliseError(httpError(409, 'CONFLICT', 'nope')), 'x'.repeat(200))

    expect(body.error).toMatchObject({ code: 'CONFLICT', message: 'nope', statusCode: 409 })
    expect(body.error.requestId).toHaveLength(64)
  })

  it('omits the request id when there is none', () => {
    expect(toErrorBody(normaliseError(httpError(404, 'NOT_FOUND', 'gone')))).toEqual({
      error: { code: 'NOT_FOUND', message: 'gone', statusCode: 404 },
    })
  })
})

describe('the error handler over HTTP', () => {
  it('answers an unknown route with the same envelope', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.json().error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
    expect(response.json().error.requestId).toEqual(expect.any(String))

    await app.close()
  })

  it('answers 400 for a body that is not JSON at all', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.statusCode).toBe(400)

    await app.close()
  })

  it('never leaks an internal message in production', async () => {
    const { app, prisma } = await createTestApp({ env: { NODE_ENV: 'production' } })

    prisma.event.findMany = async () => {
      throw new Error('relation "Event" does not exist at 10.0.0.4:5432')
    }

    const response = await app.inject({ method: 'GET', url: '/v1/events' })

    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('10.0.0.4')
    expect(response.json().error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    })

    await app.close()
  })

  it('answers a read that ran out of time with 503 and Retry-After, never the driver’s words', async () => {
    for (const [label, error] of outOfTimeErrors()) {
      const { app, prisma } = await createTestApp({ env: { NODE_ENV: 'production' } })

      prisma.event.findMany = async () => {
        throw error
      }

      const response = await app.inject({ method: 'GET', url: '/v1/events' })

      expect(response.statusCode, label).toBe(503)
      expect(response.headers['retry-after'], label).toBe(String(OUT_OF_TIME_RETRY_AFTER_SECONDS))
      expect(response.json().error).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: OUT_OF_TIME_SENTENCE,
      })
      expect(response.body, label).not.toMatch(/P2028|P2039|P2010|55P03|57014|expired|lock timeout/)

      await app.close()
    }

    // A fault carries no Retry-After: there is no point at which it gets better.
    const { app, prisma } = await createTestApp()

    prisma.event.findMany = async () => {
      throw new Error('a bug')
    }

    const fault = await app.inject({ method: 'GET', url: '/v1/events' })

    expect(fault.statusCode).toBe(500)
    expect(fault.headers['retry-after']).toBeUndefined()

    await app.close()
  })

  it('turns a response that breaks its own contract into a 500, not a bad payload', async () => {
    const { app, prisma } = await createTestApp()

    // A row that a widened select might produce: the schema refuses it rather
    // than letting a malformed event reach a client.
    prisma.event.findMany = async () => [{ id: 'not-a-cuid', title: 42 }]

    const response = await app.inject({ method: 'GET', url: '/v1/events' })

    expect(response.statusCode).toBe(500)
    expect(response.json().error.code).toBe('RESPONSE_SERIALIZATION_ERROR')

    await app.close()
  })

  it('sets the standard security headers and answers a CORS preflight', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-security-policy']).toContain("default-src 'self'")

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/events',
      headers: { origin: 'https://desievent.example', 'access-control-request-method': 'GET' },
    })
    expect(preflight.statusCode).toBe(204)
    // `CORS_ORIGIN=*` reflects whatever origin asked, which is what a public
    // read-mostly API wants.
    expect(preflight.headers['access-control-allow-origin']).toBe('https://desievent.example')

    await app.close()
  })

  it('honours an explicit CORS allow-list', async () => {
    const { app } = await createTestApp({ env: { CORS_ORIGIN: 'https://desievent.example' } })

    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://desievent.example' },
    })
    const refused = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil-desievent.example' },
    })

    expect(allowed.headers['access-control-allow-origin']).toBe('https://desievent.example')
    expect(refused.headers['access-control-allow-origin']).toBeUndefined()

    await app.close()
  })

  it('logs a 5xx through the injected logger with the request id', async () => {
    /** @type {object[]} */
    const lines = []
    const sink = {
      level: 'error',
      /**
       * @param {object} details Structured log details.
       * @returns {void} Nothing.
       */
      error: (details) => lines.push(details),
      info: () => {},
      warn: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      silent: () => {},
      /**
       * @returns {object} A child logger.
       */
      child: () => sink,
    }

    const { app, prisma } = await createTestApp({ logger: sink })
    prisma.event.findMany = async () => {
      throw new Error('boom')
    }

    const response = await app.inject({ method: 'GET', url: '/v1/events' })

    expect(response.statusCode).toBe(500)
    const logged = lines.find((line) => line && line.requestId)
    expect(logged).toMatchObject({ requestId: response.json().error.requestId, url: '/v1/events' })

    await app.close()
  })

  it('refuses a payload larger than the body limit', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: { description: 'x'.repeat(1_100_000) },
    })

    expect(response.statusCode).toBe(413)

    await app.close()
  })
})
