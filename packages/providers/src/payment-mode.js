/**
 * The production-payment kill switch.
 *
 * Desi-Event has no payment integration. There is one payment adapter, it runs
 * entirely in memory, and no code anywhere opens a socket to a payment service
 * provider. Real card processing is a Phase 2 prerequisite, not a defect: it
 * needs a merchant account, signed webhooks, reconciliation, refunds, payouts
 * and a tax policy somebody has determined rather than illustrated.
 *
 * What *is* a defect is a deployment that believes otherwise. So this module
 * exists to make the absence explicit and un-bypassable:
 *
 *   - Nothing configures a provider. {@link resolvePaymentMode} always answers
 *     {@link PAYMENT_MODES.MOCK}, and there is no value of any environment
 *     variable that makes it answer anything else.
 *   - A deployment that *asks* for production payments is refused at boot with
 *     {@link PRODUCTION_PAYMENTS_DISABLED_MESSAGE}, rather than being quietly
 *     downgraded to the mock. Somebody who thinks they have enabled card
 *     payments must be told they have not, loudly, before a buyer finds out.
 *   - A live-looking credential in the environment is likewise refused, because
 *     its presence means somebody expected it to be used.
 *   - A test-looking credential is not an error — it is a leftover — so it is
 *     reported as a notice and ignored.
 *
 * Credential *values* never leave this module. Everything it reports names the
 * variable and nothing else.
 *
 * @module @desi-event/providers/payment-mode
 */

import {
  DEMO_LABEL,
  DEMO_PAYMENT_NOTICE,
  DEMO_TICKET_NOTICE,
  PAYMENT_MODES,
  PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
} from '@desi-event/schemas'

import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'

// Re-exported so a caller that already imports the kill switch does not have to
// reach into two packages to describe what it found.
export { DEMO_LABEL, DEMO_PAYMENT_NOTICE, DEMO_TICKET_NOTICE, PAYMENT_MODES }
export { PRODUCTION_PAYMENTS_DISABLED_MESSAGE }

/**
 * Environment variables that ask for a payment provider or a payment mode.
 *
 * Any of them, set to anything at all, is a request for behaviour that does not
 * exist — except for the handful of values that name the mock itself.
 *
 * @type {string[]}
 */
export const PAYMENT_MODE_REQUEST_KEYS = Object.freeze([
  'PAYMENT_PROVIDER',
  'PAYMENTS_PROVIDER',
  'PAYMENT_MODE',
  'PAYMENTS_MODE',
  'ENABLE_PRODUCTION_PAYMENTS',
  'ENABLE_LIVE_PAYMENTS',
  'STRIPE_LIVE_MODE',
  'PAYMENTS_LIVE',
])

/** Values of a mode request that mean "the thing we already do". */
const MOCK_MODE_VALUES = Object.freeze(['mock', 'demo', 'in-memory', 'inmemory', 'fake', 'none'])

/** Values of a boolean-shaped mode request that mean "no". */
const NEGATIVE_VALUES = Object.freeze(['0', 'false', 'no', 'off', ''])

/**
 * Environment variables that would carry a payment-provider credential.
 *
 * The list is broad on purpose: it is looking for evidence that somebody
 * expected card processing, not trying to be a complete catalogue of PSPs.
 *
 * @type {RegExp[]}
 */
export const PAYMENT_CREDENTIAL_KEY_PATTERNS = Object.freeze([
  /^STRIPE_/,
  /^RAZORPAY_/,
  /^ADYEN_/,
  /^BRAINTREE_/,
  /^PAYPAL_/,
  /^SQUARE_/,
  /^PAYU_/,
  /^CASHFREE_/,
  /^PAYMENT(S)?_(SECRET|API|PUBLISHABLE|WEBHOOK|SIGNING)_?KEY$/,
])

/**
 * Credential shapes that only exist in a real, money-moving account.
 *
 * @type {RegExp[]}
 */
export const LIVE_CREDENTIAL_PATTERNS = Object.freeze([
  /\bsk_live_[0-9a-zA-Z]/,
  /\bpk_live_[0-9a-zA-Z]/,
  /\brk_live_[0-9a-zA-Z]/,
  /\bwhsec_[0-9a-zA-Z]/,
  /\brzp_live_[0-9a-zA-Z]/,
  /\bAQE[A-Za-z0-9+/]{20}/,
])

/**
 * Credential shapes that belong to a provider's sandbox.
 *
 * @type {RegExp[]}
 */
export const TEST_CREDENTIAL_PATTERNS = Object.freeze([
  /\bsk_test_[0-9a-zA-Z]/,
  /\bpk_test_[0-9a-zA-Z]/,
  /\brk_test_[0-9a-zA-Z]/,
  /\brzp_test_[0-9a-zA-Z]/,
])

/**
 * Classify one credential value without ever repeating it.
 *
 * @param {unknown} value The raw environment value.
 * @returns {'live'|'test'|'unknown'|'absent'} What the value looks like.
 */
export function classifyPaymentCredential(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'absent'
  if (LIVE_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value))) return 'live'
  if (TEST_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value))) return 'test'

  return 'unknown'
}

/**
 * Find payment-provider credentials in an environment, by variable name only.
 *
 * @param {Record<string, string|undefined>} env The environment to inspect.
 * @returns {{live: string[], test: string[], unknown: string[]}} Variable names, grouped by what they look like.
 */
export function findPaymentCredentials(env) {
  const found = { live: [], test: [], unknown: [] }

  for (const [key, value] of Object.entries(env ?? {})) {
    const named = PAYMENT_CREDENTIAL_KEY_PATTERNS.some((pattern) => pattern.test(key))
    const classification = classifyPaymentCredential(value)

    if (classification === 'live') {
      found.live.push(key)
      continue
    }

    if (!named) continue
    if (classification === 'absent') continue
    if (classification === 'test') found.test.push(key)
    else found.unknown.push(key)
  }

  for (const list of Object.values(found)) list.sort()

  return found
}

/**
 * Mode requests in an environment that ask for something other than the mock.
 *
 * @param {Record<string, string|undefined>} env The environment to inspect.
 * @returns {Array<{key: string, value: string}>} The offending requests, with their values.
 */
export function findProductionModeRequests(env) {
  const requests = []

  for (const key of PAYMENT_MODE_REQUEST_KEYS) {
    const raw = (env ?? {})[key]
    if (raw === undefined || raw === null) continue

    const value = String(raw).trim().toLowerCase()
    if (NEGATIVE_VALUES.includes(value)) continue
    if (MOCK_MODE_VALUES.includes(value)) continue

    requests.push({ key, value: String(raw).trim() })
  }

  return requests
}

/**
 * Refuse a deployment that expects production payments, and confirm the mode.
 *
 * @param {Record<string, string|undefined>} [env] The environment to inspect. Defaults to `process.env`.
 * @returns {{mode: string, demo: true, message: string, notices: string[]}} The resolved mode, always the mock.
 * @throws {ProviderError} `PRODUCTION_PAYMENTS_DISABLED` when the environment asks for card processing.
 */
export function resolvePaymentMode(env = process.env) {
  const requests = findProductionModeRequests(env)
  const credentials = findPaymentCredentials(env)
  const refusals = []

  for (const request of requests) {
    refusals.push(`${request.key} is set to "${request.value}"`)
  }

  for (const key of credentials.live) {
    // The value is never repeated: a live key is a secret even when it is in
    // the wrong place.
    refusals.push(`${key} holds what looks like a live payment credential`)
  }

  if (refusals.length > 0) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PRODUCTION_PAYMENTS_DISABLED,
      `${PRODUCTION_PAYMENTS_DISABLED_MESSAGE} ${refusals.join('; ')}. ` +
        'There is no payment integration to enable: remove these variables, or ' +
        'complete the Phase 2 payment work before setting them.',
      {
        provider: 'payments',
        details: {
          mode: PAYMENT_MODES.MOCK,
          modeRequests: requests.map((request) => request.key),
          liveCredentials: credentials.live,
        },
      },
    )
  }

  const notices = []

  for (const key of [...credentials.test, ...credentials.unknown]) {
    notices.push(
      `${key} is set but unused: there is no payment integration for it to configure. ` +
        'Payments run in the in-memory mock.',
    )
  }

  return Object.freeze({
    mode: PAYMENT_MODES.MOCK,
    demo: true,
    message: PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    notices: Object.freeze(notices),
  })
}

/**
 * Resolve the payment mode at boot, logging any notices.
 *
 * @param {object} [options] Options.
 * @param {Record<string, string|undefined>} [options.env] The environment to inspect.
 * @param {{warn: Function}} [options.logger] Logger for the notices.
 * @returns {{mode: string, demo: true, message: string, notices: string[]}} The resolved mode.
 * @throws {ProviderError} `PRODUCTION_PAYMENTS_DISABLED` when the environment asks for card processing.
 */
export function assertMockPaymentsOnly(options = {}) {
  const { env = process.env, logger } = options
  const resolution = resolvePaymentMode(env)

  if (logger && typeof logger.warn === 'function') {
    for (const notice of resolution.notices) logger.warn({ payments: resolution.mode }, notice)
  }

  return resolution
}
