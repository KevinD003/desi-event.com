/**
 * An in-memory payment provider that models a real authorise/capture/refund
 * lifecycle.
 *
 * The point is not to imitate any particular PSP, it is to make the *wrong*
 * paths reachable from a test: capturing twice, capturing something that was
 * never created, refunding money that was never taken, and a card that simply
 * declines. Each of those raises a {@link ProviderError} with its own `code`,
 * so the checkout code that handles them can be tested without a network.
 *
 * Money stays in integer cents throughout; nothing here does float arithmetic.
 *
 * @module @desi-event/providers/payments
 */

import { centsSchema, currencySchema } from '@desi-event/schemas'
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'
import {
  createClock,
  createIdFactory,
  freezeRecord,
  isPlainObject,
  normaliseMetadata,
  requireText,
} from './internal.js'

/**
 * The intent lifecycle. `REQUIRES_CAPTURE` is the state a freshly authorised
 * intent sits in; the other three are terminal.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PAYMENT_INTENT_STATUS = Object.freeze({
  REQUIRES_CAPTURE: 'REQUIRES_CAPTURE',
  SUCCEEDED: 'SUCCEEDED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
})

/**
 * Intent status to the Prisma `PaymentStatus` enum.
 *
 * An authorised-but-uncaptured intent is `INITIATED` in our schema: the money
 * has not moved yet.
 *
 * @type {Readonly<Record<string, string>>}
 */
const PAYMENT_STATUS_BY_INTENT_STATUS = Object.freeze({
  [PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE]: 'INITIATED',
  [PAYMENT_INTENT_STATUS.SUCCEEDED]: 'SUCCEEDED',
  [PAYMENT_INTENT_STATUS.REFUNDED]: 'REFUNDED',
  [PAYMENT_INTENT_STATUS.FAILED]: 'FAILED',
})

/**
 * The magic amount that always declines.
 *
 * A deterministic trigger beats a mock when the failure has to travel through
 * layers of real code — a worker job, an API route — that never sees the
 * provider object itself. 999999 cents is far above any plausible ticket
 * price, so no honest fixture hits it by accident.
 *
 * @type {number}
 */
export const PAYMENT_DECLINE_AMOUNT_CENTS = 999_999

/**
 * Amount that always times out, modelling a provider that takes the request
 * and never answers. The money may or may not have moved: that ambiguity is
 * the point, and it is what the reconciliation path exists for.
 */
export const PAYMENT_TIMEOUT_AMOUNT_CENTS = 999_998

/** Decline code reported when no explicit `failureCode` was supplied. */
export const DEFAULT_DECLINE_CODE = 'card_declined'

/** Largest amount the fake will authorise, matching `centsSchema`'s ceiling. */
const MAX_AMOUNT_CENTS = 1_000_000_000

/**
 * Validate an amount as positive integer cents.
 *
 * @param {unknown} amountCents Candidate amount.
 * @param {string} provider Provider name, attached to any error raised.
 * @param {string} [field] Field name used in the message.
 * @returns {number} The validated amount.
 * @throws {ProviderError} `INVALID_AMOUNT` when the amount is not a positive integer under the ceiling.
 */
function parseAmount(amountCents, provider, field = 'amountCents') {
  const result = centsSchema.safeParse(amountCents)
  if (!result.success || result.data < 1) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_AMOUNT,
      `Expected \`${field}\` to be an integer number of cents between 1 and ${MAX_AMOUNT_CENTS}`,
      { provider, details: { field, received: amountCents } },
    )
  }
  return result.data
}

/**
 * Validate and upper-case an ISO-4217 currency code.
 *
 * @param {unknown} currency Candidate currency code.
 * @param {string} provider Provider name, attached to any error raised.
 * @returns {string} The upper-cased code.
 * @throws {ProviderError} `INVALID_CURRENCY` when the code is not three letters.
 */
function parseCurrency(currency, provider) {
  const result = currencySchema.safeParse(currency)
  if (!result.success) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_CURRENCY,
      'Expected `currency` to be a three-letter ISO-4217 code',
      { provider, details: { received: currency } },
    )
  }
  return /** @type {string} */ (result.data)
}

/**
 * Accept either an intent id or an object carrying one.
 *
 * Callers hold different things at different points — the id from
 * `Payment.providerRef`, or the whole intent they just created — and making
 * both work removes a class of trivial wiring bugs.
 *
 * @param {unknown} reference An id string, or an object with `id`/`intentId`/`providerRef`.
 * @param {string} provider Provider name, attached to any error raised.
 * @returns {string} The resolved intent id.
 * @throws {ProviderError} `INVALID_INTENT_REFERENCE` when no id can be read.
 */
function resolveIntentId(reference, provider) {
  if (typeof reference === 'string' && reference.trim() !== '') return reference.trim()

  if (isPlainObject(reference)) {
    const candidate = reference.id ?? reference.intentId ?? reference.providerRef
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }

  throw new ProviderError(
    PROVIDER_ERROR_CODES.INVALID_INTENT_REFERENCE,
    'Expected a payment intent id, or an object carrying `id`, `intentId` or `providerRef`',
    { provider, details: { received: reference === null ? 'null' : typeof reference } },
  )
}

/**
 * Merge the options bag with an object-form reference, so
 * `capture(intent)` and `capture(intent.id, { amountCents })` both work.
 *
 * @param {unknown} reference The first argument passed by the caller.
 * @param {unknown} options The second argument passed by the caller.
 * @returns {Record<string, unknown>} The effective options.
 */
function mergeOptions(reference, options) {
  const fromReference = isPlainObject(reference) ? reference : {}
  const explicit = isPlainObject(options) ? options : {}
  return { ...fromReference, ...explicit }
}

/**
 * Project the mutable stored record into the frozen public intent shape.
 *
 * @param {Record<string, unknown>} record Internal intent record.
 * @returns {PaymentIntent} A frozen snapshot safe to hand to a caller.
 */
function toIntent(record) {
  return /** @type {PaymentIntent} */ (
    freezeRecord({
      id: record.id,
      status: record.status,
      amountCents: record.amountCents,
      currency: record.currency,
      orderId: record.orderId,
      failureCode: record.failureCode,
      createdAt: record.createdAt,
      capturedAt: record.capturedAt,
      refundedAt: record.refundedAt,
      capturedAmountCents: record.capturedAmountCents,
      refundedAmountCents: record.refundedAmountCents,
      refundReason: record.refundReason,
      metadata: record.metadata,
      paymentStatus: PAYMENT_STATUS_BY_INTENT_STATUS[/** @type {string} */ (record.status)],
    })
  )
}

/**
 * Map an intent status onto the Prisma `PaymentStatus` enum.
 *
 * @param {string} intentStatus One of {@link PAYMENT_INTENT_STATUS}.
 * @returns {string} A `PaymentStatus` value.
 * @throws {ProviderError} `INVALID_OPTIONS` when `intentStatus` is not a known status.
 */
export function toPaymentStatus(intentStatus) {
  const mapped = PAYMENT_STATUS_BY_INTENT_STATUS[intentStatus]
  if (!mapped) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      `Unknown payment intent status "${intentStatus}"`,
      { details: { intentStatus } },
    )
  }
  return mapped
}

/**
 * Decide whether an intent should decline, and with which code.
 *
 * @param {object} input Parsed creation input.
 * @param {number} input.amountCents The authorised amount.
 * @param {(boolean|string|undefined)} input.forceFailure The caller's failure trigger.
 * @param {number} declineAmountCents The provider's magic decline amount.
 * @returns {{atCreate: boolean, atCapture: boolean}} Which lifecycle step should fail.
 */
function resolveFailureTrigger(input, declineAmountCents, timeoutAmountCents) {
  const { amountCents, forceFailure } = input
  const timeout = forceFailure === 'timeout' || amountCents === timeoutAmountCents
  const atCapture = !timeout && forceFailure === 'capture'
  const atCreate =
    !timeout &&
    !atCapture &&
    (forceFailure === true || forceFailure === 'create' || amountCents === declineAmountCents)

  return { atCreate, atCapture, timeout }
}

/**
 * @typedef {object} InMemoryPaymentProviderOptions
 * @property {string} [name] Adapter name recorded on `Payment.provider`.
 * @property {string} [idPrefix] Prefix for generated intent ids.
 * @property {number} [declineAmountCents] Amount that always declines; defaults to {@link PAYMENT_DECLINE_AMOUNT_CENTS}.
 * @property {number} [timeoutAmountCents] Amount that always times out; defaults to {@link PAYMENT_TIMEOUT_AMOUNT_CENTS}.
 * @property {(Date|number|string|function(): (Date|number|string))} [now] Fixed instant or clock function, for deterministic timestamps.
 */

/**
 * Create an in-memory {@link PaymentProvider}.
 *
 * State lives in a closure, so two providers never share intents and a suite
 * can create one per test instead of cleaning up after itself.
 *
 * @param {InMemoryPaymentProviderOptions} [options] Construction options.
 * @returns {PaymentProvider} A provider with `createIntent`, `capture`, `refund`, `getStatus`, plus `listIntents()` and `reset()` for tests.
 * @throws {ProviderError} `INVALID_OPTIONS` when `now` is not a usable instant, or `declineAmountCents` is not a positive integer.
 */
export function createInMemoryPaymentProvider(options = {}) {
  const {
    name = 'in-memory-payments',
    idPrefix = 'pi',
    declineAmountCents = PAYMENT_DECLINE_AMOUNT_CENTS,
    timeoutAmountCents = PAYMENT_TIMEOUT_AMOUNT_CENTS,
    now,
  } = options

  if (!Number.isInteger(declineAmountCents) || declineAmountCents < 1) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      'Expected `declineAmountCents` to be a positive integer',
      { provider: name, details: { received: declineAmountCents } },
    )
  }

  const clock = createClock(now)
  const nextId = createIdFactory(idPrefix)
  /** @type {Map<string, Record<string, unknown>>} */
  const intents = new Map()

  /**
   * Fetch a stored intent or fail with a 404-shaped error.
   *
   * @param {unknown} reference Intent id or an object carrying one.
   * @returns {Record<string, unknown>} The mutable stored record.
   * @throws {ProviderError} `INTENT_NOT_FOUND` when nothing is stored under that id.
   */
  function requireRecord(reference) {
    const id = resolveIntentId(reference, name)
    const record = intents.get(id)
    if (!record) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.INTENT_NOT_FOUND,
        `No payment intent with id "${id}"`,
        { provider: name, details: { intentId: id } },
      )
    }
    return record
  }

  /**
   * Reject an amount or currency that contradicts the stored intent.
   *
   * @param {Record<string, unknown>} record The stored intent.
   * @param {Record<string, unknown>} settings Caller-supplied `amountCents`/`currency`.
   * @param {string} operation `capture` or `refund`, used in the message.
   * @returns {void}
   * @throws {ProviderError} `AMOUNT_MISMATCH` or `CURRENCY_MISMATCH`.
   */
  function assertMatchesIntent(record, settings, operation) {
    if (settings.amountCents !== undefined) {
      const amountCents = parseAmount(settings.amountCents, name)
      if (amountCents !== record.amountCents) {
        throw new ProviderError(
          PROVIDER_ERROR_CODES.AMOUNT_MISMATCH,
          `Cannot ${operation} ${amountCents} cents against an intent for ${record.amountCents} cents`,
          {
            provider: name,
            details: {
              intentId: record.id,
              expectedAmountCents: record.amountCents,
              receivedAmountCents: amountCents,
            },
          },
        )
      }
    }

    if (settings.currency !== undefined) {
      const currency = parseCurrency(settings.currency, name)
      if (currency !== record.currency) {
        throw new ProviderError(
          PROVIDER_ERROR_CODES.CURRENCY_MISMATCH,
          `Cannot ${operation} in ${currency} against an intent in ${record.currency}`,
          {
            provider: name,
            details: {
              intentId: record.id,
              expectedCurrency: record.currency,
              receivedCurrency: currency,
            },
          },
        )
      }
    }
  }

  /**
   * Authorise an amount and return the resulting intent.
   *
   * A declined intent is still stored, with status `FAILED`, so that a caller
   * holding the id from the thrown error can read the failure back through
   * `getStatus` exactly as it would with a real PSP.
   *
   * @param {CreateIntentInput} input Amount, currency and optional metadata.
   * @returns {PaymentIntent} The new intent, status `REQUIRES_CAPTURE`.
   * @throws {ProviderError} `INVALID_OPTIONS` when `input` is not an object; `INVALID_AMOUNT`; `INVALID_CURRENCY`; `PAYMENT_DECLINED` when the failure trigger fires.
   */
  function createIntent(input) {
    if (!isPlainObject(input)) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.INVALID_OPTIONS,
        'createIntent expects an object with `amountCents` and `currency`',
        { provider: name, details: { received: input === null ? 'null' : typeof input } },
      )
    }

    const amountCents = parseAmount(input.amountCents, name)
    const currency = parseCurrency(input.currency, name)
    const metadata = normaliseMetadata(input.metadata, PROVIDER_ERROR_CODES.INVALID_OPTIONS, name)
    const orderId =
      input.orderId === undefined || input.orderId === null
        ? undefined
        : requireText(input.orderId, 'orderId', {
            code: PROVIDER_ERROR_CODES.INVALID_OPTIONS,
            provider: name,
            maxLength: 64,
          })
    const failureCode =
      typeof input.failureCode === 'string' && input.failureCode.trim() !== ''
        ? input.failureCode.trim()
        : DEFAULT_DECLINE_CODE

    const trigger = resolveFailureTrigger(
      { amountCents, forceFailure: input.forceFailure },
      declineAmountCents,
      timeoutAmountCents,
    )

    const id = nextId()
    const createdAt = clock().toISOString()
    /** @type {Record<string, unknown>} */
    const record = {
      id,
      status: trigger.atCreate
        ? PAYMENT_INTENT_STATUS.FAILED
        : PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE,
      amountCents,
      currency,
      orderId,
      failureCode: trigger.atCreate ? failureCode : undefined,
      createdAt,
      capturedAt: null,
      refundedAt: null,
      capturedAmountCents: null,
      refundedAmountCents: null,
      refundReason: null,
      metadata,
      failAtCapture: trigger.atCapture,
      timeoutAtCapture: trigger.timeout,
      captureFailureCode: failureCode,
    }
    intents.set(id, record)

    if (trigger.atCreate) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.PAYMENT_DECLINED,
        `Payment intent ${id} was declined (${failureCode})`,
        {
          provider: name,
          details: { intentId: id, failureCode, amountCents, currency, orderId },
        },
      )
    }

    return toIntent(record)
  }

  /**
   * Capture a previously authorised intent.
   *
   * @param {(string|object)} reference Intent id, or an object carrying one.
   * @param {object} [settings] Optional `amountCents`/`currency` to cross-check against the intent.
   * @returns {PaymentIntent} The intent, now `SUCCEEDED`.
   * @throws {ProviderError} `INTENT_NOT_FOUND`, `ALREADY_CAPTURED`, `ALREADY_REFUNDED`, `INTENT_FAILED`, `AMOUNT_MISMATCH`, `CURRENCY_MISMATCH`, or `PAYMENT_DECLINED` when the intent was created with `forceFailure: 'capture'`.
   */
  function capture(reference, settings) {
    const record = requireRecord(reference)
    const effective = mergeOptions(reference, settings)

    if (record.status === PAYMENT_INTENT_STATUS.SUCCEEDED) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.ALREADY_CAPTURED,
        `Payment intent ${record.id} has already been captured`,
        { provider: name, details: { intentId: record.id, capturedAt: record.capturedAt } },
      )
    }
    if (record.status === PAYMENT_INTENT_STATUS.REFUNDED) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.ALREADY_REFUNDED,
        `Payment intent ${record.id} has already been refunded and cannot be captured`,
        { provider: name, details: { intentId: record.id, refundedAt: record.refundedAt } },
      )
    }
    if (record.status === PAYMENT_INTENT_STATUS.FAILED) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.INTENT_FAILED,
        `Payment intent ${record.id} failed and cannot be captured`,
        { provider: name, details: { intentId: record.id, failureCode: record.failureCode } },
      )
    }

    assertMatchesIntent(record, effective, 'capture')

    // A timeout is not a decline. The intent stays REQUIRES_CAPTURE and the
    // caller is told nothing definite: whether the money moved is exactly what
    // reconciliation has to establish against the provider afterwards.
    if (record.timeoutAtCapture) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.PAYMENT_TIMEOUT,
        `Capture of payment intent ${record.id} timed out`,
        { provider: name, details: { intentId: record.id, amountCents: record.amountCents } },
      )
    }

    if (record.failAtCapture) {
      record.status = PAYMENT_INTENT_STATUS.FAILED
      record.failureCode = record.captureFailureCode
      throw new ProviderError(
        PROVIDER_ERROR_CODES.PAYMENT_DECLINED,
        `Capture of payment intent ${record.id} was declined (${record.failureCode})`,
        {
          provider: name,
          details: { intentId: record.id, failureCode: record.failureCode },
        },
      )
    }

    record.status = PAYMENT_INTENT_STATUS.SUCCEEDED
    record.capturedAt = clock().toISOString()
    record.capturedAmountCents = record.amountCents
    return toIntent(record)
  }

  /**
   * Refund a captured intent in full.
   *
   * Partial refunds are deliberately not modelled: orders are refunded whole in
   * this system, and a half-implemented partial refund would invite callers to
   * depend on behaviour a real adapter may not share.
   *
   * @param {(string|object)} reference Intent id, or an object carrying one.
   * @param {object} [settings] Optional `amountCents` (must equal the captured amount) and `reason`.
   * @returns {PaymentIntent} The intent, now `REFUNDED`.
   * @throws {ProviderError} `INTENT_NOT_FOUND`, `NOT_CAPTURED` when the intent was never captured, `ALREADY_REFUNDED`, `INTENT_FAILED`, `AMOUNT_MISMATCH`, or `CURRENCY_MISMATCH`.
   */
  function refund(reference, settings) {
    const record = requireRecord(reference)
    const effective = mergeOptions(reference, settings)

    if (record.status === PAYMENT_INTENT_STATUS.REFUNDED) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.ALREADY_REFUNDED,
        `Payment intent ${record.id} has already been refunded`,
        { provider: name, details: { intentId: record.id, refundedAt: record.refundedAt } },
      )
    }
    if (record.status === PAYMENT_INTENT_STATUS.FAILED) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.INTENT_FAILED,
        `Payment intent ${record.id} failed and cannot be refunded`,
        { provider: name, details: { intentId: record.id, failureCode: record.failureCode } },
      )
    }
    if (record.status !== PAYMENT_INTENT_STATUS.SUCCEEDED) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.NOT_CAPTURED,
        `Payment intent ${record.id} has not been captured, so there is nothing to refund`,
        { provider: name, details: { intentId: record.id, status: record.status } },
      )
    }

    assertMatchesIntent(record, effective, 'refund')

    const reason =
      effective.reason === undefined || effective.reason === null
        ? null
        : requireText(effective.reason, 'reason', {
            code: PROVIDER_ERROR_CODES.INVALID_OPTIONS,
            provider: name,
            maxLength: 500,
          })

    record.status = PAYMENT_INTENT_STATUS.REFUNDED
    record.refundedAt = clock().toISOString()
    record.refundedAmountCents = record.amountCents
    record.refundReason = reason
    return toIntent(record)
  }

  /**
   * Read an intent back.
   *
   * @param {(string|object)} reference Intent id, or an object carrying one.
   * @returns {PaymentIntent} A frozen snapshot of the intent.
   * @throws {ProviderError} `INTENT_NOT_FOUND` or `INVALID_INTENT_REFERENCE`.
   */
  function getStatus(reference) {
    return toIntent(requireRecord(reference))
  }

  /**
   * Every intent this provider has seen, oldest first.
   *
   * @returns {PaymentIntent[]} Frozen snapshots, including failed intents.
   */
  function listIntents() {
    return [...intents.values()].map(toIntent)
  }

  /**
   * Forget every intent. Ids continue from where they left off, so a reset
   * cannot resurrect an id a previous test already handed out.
   *
   * @returns {void}
   */
  function reset() {
    intents.clear()
  }

  return /** @type {PaymentProvider} */ ({
    name,
    declineAmountCents,
    createIntent,
    capture,
    refund,
    getStatus,
    listIntents,
    reset,
  })
}
