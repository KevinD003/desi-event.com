/**
 * The payment-mode gate, and the production kill switch.
 *
 * Desi-Event can run in two modes and neither moves real money: an in-memory
 * mock, which is the default, and Stripe's sandbox, which starts only when a
 * coherent set of test credentials is supplied on purpose. This module decides
 * which, and refuses everything else.
 *
 * It is the first thing the API and the worker call, before Fastify is
 * constructed and before any connection is opened, so a deployment that
 * believes it has card payments is stopped rather than allowed to listen. The
 * rules it enforces:
 *
 *   - **Missing credentials mean the mock.** A fresh clone, CI, a preview and a
 *     credential-free demonstration all work, and none of them reaches a
 *     network.
 *   - **A live-looking credential refuses the boot**, in any mode, wherever in
 *     the environment it is hiding. Its presence means somebody expected it to
 *     be used.
 *   - **Asking for production refuses the boot**, rather than being quietly
 *     downgraded. Somebody who set `PAYMENT_MODE=live` believes they have
 *     enabled card payments and has to find out from the boot log rather than
 *     from a buyer.
 *   - **`stripe_test` needs the whole set.** A secret key without a webhook
 *     secret is a deployment that will take money and never hear that it did,
 *     so a partial configuration is refused rather than half-started.
 *   - **Mixed test and live credentials refuse the boot.** That is somebody
 *     mid-migration, and guessing which they meant is the wrong move.
 *   - **A client-exposed variable cannot decide anything.** `NEXT_PUBLIC_*` is
 *     readable by every browser; a secret in one is a leak and a mode in one is
 *     not authority.
 *
 * Credential *values* never leave this module. Everything it reports names the
 * variable and nothing else, and the resolved credentials are attached to the
 * result as a non-enumerable property so that logging or serialising the
 * resolution cannot leak them.
 *
 * ## One correction to the Phase 1 rules
 *
 * Phase 1 classified anything starting `whsec_` as a live credential. That was
 * safe when no mode could use one, and it is wrong now: Stripe's *test* webhook
 * secrets start `whsec_` too, so the old rule would refuse the very
 * configuration `stripe_test` requires. Liveness is decided by the key
 * prefixes that actually distinguish it — `sk_live_`, `pk_live_`, `rk_live_` —
 * and a webhook secret is treated as mode-agnostic, belonging to whichever mode
 * the keys say.
 *
 * @module @desi-event/providers/payment-mode
 */

import {
  DEMO_LABEL,
  DEMO_PAYMENT_NOTICE,
  DEMO_TICKET_NOTICE,
  PAYMENT_MODES,
  PAYMENT_MODE_ENV_VALUES,
  PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
  PROHIBITED_PAYMENT_MODE_VALUES,
  SANDBOX_LABEL,
  STRIPE_API_VERSION,
  labelFor,
  paymentNoticeFor,
  ticketNoticeFor,
} from '@desi-event/schemas'

import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'

// Re-exported so a caller that already imports the gate does not have to reach
// into two packages to describe what it found.
export {
  DEMO_LABEL,
  DEMO_PAYMENT_NOTICE,
  DEMO_TICKET_NOTICE,
  PAYMENT_MODES,
  PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
  SANDBOX_LABEL,
  STRIPE_API_VERSION,
  labelFor,
  paymentNoticeFor,
  ticketNoticeFor,
}

/**
 * Environment variables that ask for a payment provider or a payment mode.
 *
 * `PAYMENT_MODE` is the supported one. The rest are names somebody might reach
 * for, and they are watched so that setting one is an error rather than a
 * no-op: a variable that looks like it should work and silently does not is
 * worse than one that is refused.
 *
 * @type {string[]}
 */
export const PAYMENT_MODE_REQUEST_KEYS = Object.freeze([
  'PAYMENT_MODE',
  'PAYMENTS_MODE',
  'PAYMENT_PROVIDER',
  'PAYMENTS_PROVIDER',
  'ENABLE_PRODUCTION_PAYMENTS',
  'ENABLE_LIVE_PAYMENTS',
  'STRIPE_LIVE_MODE',
  'PAYMENTS_LIVE',
])

/** The one key whose value selects a mode. Everything else in the list above is a trap. */
export const PAYMENT_MODE_KEY = 'PAYMENT_MODE'

/** Values of a boolean-shaped request that mean "no". */
const NEGATIVE_VALUES = Object.freeze(['0', 'false', 'no', 'off', ''])

/**
 * Environment variables that would carry a payment-provider credential.
 *
 * Broad on purpose: it is looking for evidence that somebody expected card
 * processing, not trying to be a complete catalogue of providers.
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
 * Credential shapes that only exist in an account that can move real money.
 *
 * @type {RegExp[]}
 */
export const LIVE_CREDENTIAL_PATTERNS = Object.freeze([
  /\bsk_live_[0-9a-zA-Z]/,
  /\bpk_live_[0-9a-zA-Z]/,
  /\brk_live_[0-9a-zA-Z]/,
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
 * Credential shapes that exist identically in test and live mode.
 *
 * A webhook signing secret is the same shape either way, so it says nothing
 * about which mode a deployment is in — the keys say that. Phase 1 treated one
 * of these as proof of a live account, which was safe then and would now refuse
 * the sandbox configuration outright.
 *
 * @type {RegExp[]}
 */
export const MODE_AGNOSTIC_CREDENTIAL_PATTERNS = Object.freeze([/\bwhsec_[0-9a-zA-Z]/])

/**
 * Values that are obviously a placeholder somebody forgot to replace.
 *
 * Refused rather than treated as a credential, because a placeholder in a
 * secret slot means the deployment was never finished, and starting anyway
 * produces a failure at the worst possible moment instead of at boot.
 *
 * @type {RegExp[]}
 */
export const PLACEHOLDER_PATTERNS = Object.freeze([
  /^(x+|y+|z+|\.+|-+|_+)$/i,
  /change[-_ ]?me/i,
  /your[-_ ]?(key|secret|token)/i,
  /replace[-_ ]?(me|this)/i,
  /^(todo|tbd|fixme|placeholder|example|dummy|sample|insert)/i,
  /_here$/i,
  // A provider key whose body is a run of one character: `sk_test_xxxxxxxx`
  // and friends. This is the shape of `.env.example` copied without editing,
  // which is the most common way a deployment ends up half-configured.
  /^(sk|pk|rk)_(test|live)_(.)\3{3,}$/i,
  // Eight or more identical characters anywhere. A random 24-character key
  // containing such a run is vanishingly unlikely; a hand-typed filler almost
  // always contains one. The cost of being wrong is a refused boot with a
  // message naming the variable, which is recoverable in seconds.
  /(.)\1{7,}/,
])

/**
 * Classify one credential value without ever repeating it.
 *
 * @param {unknown} value The raw environment value.
 * @returns {'live'|'test'|'webhook'|'placeholder'|'unknown'|'absent'} What the value looks like.
 */
export function classifyPaymentCredential(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'absent'

  const trimmed = value.trim()

  if (LIVE_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(trimmed))) return 'live'
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))) return 'placeholder'
  if (TEST_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(trimmed))) return 'test'
  if (MODE_AGNOSTIC_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(trimmed))) return 'webhook'

  return 'unknown'
}

/**
 * Find payment-provider credentials in an environment, by variable name only.
 *
 * @param {Record<string, string|undefined>} env The environment to inspect.
 * @returns {{live: string[], test: string[], webhook: string[], placeholder: string[], unknown: string[]}} Variable names, grouped by what they look like.
 */
export function findPaymentCredentials(env) {
  /** @type {Record<string, string[]>} */
  const found = { live: [], test: [], webhook: [], placeholder: [], unknown: [] }

  for (const [key, value] of Object.entries(env ?? {})) {
    const named = PAYMENT_CREDENTIAL_KEY_PATTERNS.some((pattern) => pattern.test(key))
    const classification = classifyPaymentCredential(value)

    // A live key anywhere is a finding, whatever the variable is called.
    if (classification === 'live') {
      found.live.push(key)
      continue
    }

    if (!named) continue
    if (classification === 'absent') continue

    found[classification].push(key)
  }

  for (const list of Object.values(found)) list.sort()

  return Object.freeze(found)
}

/**
 * Mode requests in an environment, and what each asked for.
 *
 * @param {Record<string, string|undefined>} env The environment to inspect.
 * @returns {Array<{key: string, value: string}>} Every mode-shaped variable that was set to something.
 */
export function findModeRequests(env) {
  const requests = []

  for (const key of PAYMENT_MODE_REQUEST_KEYS) {
    const raw = (env ?? {})[key]
    if (raw === undefined || raw === null) continue

    const value = String(raw).trim()
    if (NEGATIVE_VALUES.includes(value.toLowerCase())) continue

    requests.push({ key, value })
  }

  return requests
}

/**
 * Client-exposed variables that try to carry authority or a secret.
 *
 * `NEXT_PUBLIC_*` reaches every browser. A publishable key there is correct and
 * expected; a secret key is a leak, and a payment mode is not authority no
 * matter how it is spelled.
 *
 * @param {Record<string, string|undefined>} env The environment to inspect.
 * @returns {string[]} The offending variable names.
 */
export function findClientExposedViolations(env) {
  const offenders = []

  for (const [key, value] of Object.entries(env ?? {})) {
    if (!key.startsWith('NEXT_PUBLIC_')) continue

    const bare = key.slice('NEXT_PUBLIC_'.length)
    if (PAYMENT_MODE_REQUEST_KEYS.includes(bare)) {
      offenders.push(key)
      continue
    }

    if (typeof value !== 'string') continue
    if (/\b(sk|rk)_(test|live)_/.test(value) || /\bwhsec_/.test(value)) offenders.push(key)
  }

  return offenders.sort()
}

/**
 * Read the Stripe test credential set out of an environment.
 *
 * @param {Record<string, string|undefined>} env The environment to inspect.
 * @returns {{secretKey: string|null, publishableKey: string|null, webhookSecret: string|null, connectWebhookSecret: string|null, apiVersion: string}} The set, with absent fields null.
 */
export function readStripeCredentials(env) {
  /**
   * Treat blank as absent. A variable left empty in a `.env` file is not a
   * value, and coercing it to one produces a confusing failure later.
   *
   * @param {string} key The variable to read.
   * @returns {string|null} The trimmed value, or null when unset or blank.
   */
  const read = (key) => {
    const raw = (env ?? {})[key]
    if (typeof raw !== 'string') return null
    const trimmed = raw.trim()

    return trimmed === '' ? null : trimmed
  }

  return {
    secretKey: read('STRIPE_SECRET_KEY'),
    publishableKey: read('STRIPE_PUBLISHABLE_KEY') ?? read('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'),
    webhookSecret: read('STRIPE_WEBHOOK_SECRET'),
    connectWebhookSecret: read('STRIPE_CONNECT_WEBHOOK_SECRET'),
    apiVersion: read('STRIPE_API_VERSION') ?? STRIPE_API_VERSION,
  }
}

/**
 * Raise the kill switch.
 *
 * @param {string[]} refusals Why, one clause per problem. Must never contain a credential.
 * @param {object} details Machine-readable detail. Must never contain a credential.
 * @returns {never} Never returns.
 * @throws {ProviderError} Always, with code `PRODUCTION_PAYMENTS_DISABLED`.
 */
function refuse(refusals, details) {
  throw new ProviderError(
    PROVIDER_ERROR_CODES.PRODUCTION_PAYMENTS_DISABLED,
    `${PRODUCTION_PAYMENTS_DISABLED_MESSAGE} ${refusals.join('; ')}. ` +
      'Desi-Event runs in one of two modes, mock or stripe_test, and neither moves real ' +
      'money. Remove these variables, or complete the Phase 2 payment work before setting them.',
    { provider: 'payments', details },
  )
}

/**
 * Decide the payment mode, or refuse to start.
 *
 * @param {Record<string, string|undefined>} [env] The environment to inspect. Defaults to `process.env`.
 * @returns {object} The resolved mode. Carries a non-enumerable `credentials` property in `STRIPE_TEST` mode.
 * @throws {ProviderError} `PRODUCTION_PAYMENTS_DISABLED` when the environment asks for real money, is incoherent, or leaks a secret to the browser.
 */
export function resolvePaymentMode(env = process.env) {
  const source = env ?? {}
  const refusals = []
  const notices = []

  // --- 1. Anything client-exposed that should not be -----------------------
  const exposed = findClientExposedViolations(source)
  for (const key of exposed) {
    refusals.push(`${key} is readable by every browser and must not carry a secret or a mode`)
  }

  // --- 2. Which mode was asked for ----------------------------------------
  const requests = findModeRequests(source)
  /** @type {string|null} */
  let requested = null

  for (const request of requests) {
    const value = request.value.toLowerCase()

    if (request.key !== PAYMENT_MODE_KEY) {
      // Not the supported variable. If it merely describes what already
      // happens, say so and carry on — refusing to boot over
      // `PAYMENT_PROVIDER=mock` would be pedantry. If it asks for anything
      // else, refuse: a variable that looks like it works and silently does
      // not is worse than one that is rejected.
      if (PAYMENT_MODE_ENV_VALUES[value] === PAYMENT_MODES.MOCK) {
        notices.push(
          `${request.key} is not read; the only mode variable is ${PAYMENT_MODE_KEY}. It asks for ` +
            'the in-memory mock, which is what happens by default, so nothing changes.',
        )
      } else {
        refusals.push(
          `${request.key} is set to "${request.value}" but is not read; the only mode variable is ${PAYMENT_MODE_KEY}`,
        )
      }
      continue
    }

    if (PROHIBITED_PAYMENT_MODE_VALUES.includes(value)) {
      refusals.push(`${PAYMENT_MODE_KEY} asks for "${request.value}", which does not exist here`)
      continue
    }

    const mapped = PAYMENT_MODE_ENV_VALUES[value]
    if (!mapped) {
      refusals.push(
        `${PAYMENT_MODE_KEY} is "${request.value}"; the accepted values are ${Object.keys(PAYMENT_MODE_ENV_VALUES).join(', ')}`,
      )
      continue
    }

    requested = mapped
  }

  // --- 3. Credentials -----------------------------------------------------
  const credentials = findPaymentCredentials(source)

  for (const key of credentials.live) {
    // The value is never repeated: a live key is a secret even when it is in
    // the wrong place.
    refusals.push(`${key} holds what looks like a live payment credential`)
  }

  for (const key of credentials.placeholder) {
    refusals.push(`${key} still holds a placeholder rather than a credential`)
  }

  const mode = requested ?? PAYMENT_MODES.MOCK

  // --- 4. Mode-specific coherence -----------------------------------------
  /** @type {object|null} */
  let stripe = null

  if (mode === PAYMENT_MODES.STRIPE_TEST) {
    const set = readStripeCredentials(source)
    const missing = []

    if (!set.secretKey) missing.push('STRIPE_SECRET_KEY')
    if (!set.publishableKey) missing.push('STRIPE_PUBLISHABLE_KEY')
    if (!set.webhookSecret) missing.push('STRIPE_WEBHOOK_SECRET')

    if (missing.length > 0) {
      // A secret key with no webhook secret is a deployment that will take
      // money and never hear that it did.
      refusals.push(
        `${PAYMENT_MODE_KEY}=stripe_test needs a complete credential set; missing ${missing.join(', ')}`,
      )
    }

    const shapes = [
      ['STRIPE_SECRET_KEY', set.secretKey, /^sk_test_[0-9a-zA-Z]/],
      ['STRIPE_PUBLISHABLE_KEY', set.publishableKey, /^pk_test_[0-9a-zA-Z]/],
      ['STRIPE_WEBHOOK_SECRET', set.webhookSecret, /^whsec_[0-9a-zA-Z]/],
      ['STRIPE_CONNECT_WEBHOOK_SECRET', set.connectWebhookSecret, /^whsec_[0-9a-zA-Z]/],
    ]

    for (const [key, value, shape] of shapes) {
      if (value === null) continue
      if (!shape.test(value)) {
        refusals.push(`${key} is not shaped like a Stripe test credential`)
      }
    }

    if (
      set.webhookSecret &&
      set.connectWebhookSecret &&
      set.webhookSecret === set.connectWebhookSecret
    ) {
      // Two endpoints, two secrets. Sharing one means a platform event and a
      // connected-account event verify against the same key, and the
      // account-context check that keeps them apart stops being a check.
      refusals.push(
        'STRIPE_WEBHOOK_SECRET and STRIPE_CONNECT_WEBHOOK_SECRET are the same value; each endpoint needs its own',
      )
    }

    if (refusals.length === 0) {
      stripe = Object.freeze({
        publishableKey: set.publishableKey,
        apiVersion: set.apiVersion,
        secretKeyPresent: true,
        webhookSecretPresent: true,
        connectWebhookSecretPresent: set.connectWebhookSecret !== null,
      })
    }
  } else {
    // Mock mode. Leftover sandbox credentials are a leftover, not an error.
    for (const key of [...credentials.test, ...credentials.webhook, ...credentials.unknown]) {
      notices.push(
        `${key} is set but unused: PAYMENT_MODE is mock, so payments run in the in-memory ` +
          'provider and nothing reaches a network. Set PAYMENT_MODE=stripe_test to use it.',
      )
    }
  }

  if (refusals.length > 0) {
    refuse(refusals, {
      mode: PAYMENT_MODES.MOCK,
      modeRequests: requests.map((request) => request.key),
      liveCredentials: credentials.live,
      placeholderCredentials: credentials.placeholder,
      clientExposed: exposed,
    })
  }

  const resolution = {
    mode,
    /** True in both modes: no configuration of this system moves real money. */
    demo: true,
    live: false,
    label: labelFor(mode),
    message: PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    paymentNotice: paymentNoticeFor(mode),
    ticketNotice: ticketNoticeFor(mode),
    notices: Object.freeze(notices),
    stripe,
  }

  // The secrets themselves are attached non-enumerably, so logging or
  // serialising the resolution cannot leak them. A caller that genuinely needs
  // them — the Stripe adapter — reads the property by name.
  if (mode === PAYMENT_MODES.STRIPE_TEST) {
    const set = readStripeCredentials(source)
    Object.defineProperty(resolution, 'credentials', {
      value: Object.freeze({
        secretKey: set.secretKey,
        webhookSecret: set.webhookSecret,
        connectWebhookSecret: set.connectWebhookSecret,
      }),
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }

  return Object.freeze(resolution)
}

/**
 * Resolve the payment mode at boot, logging any notices.
 *
 * The guard the API and the worker call before they listen or connect.
 *
 * @param {object} [options] Options.
 * @param {Record<string, string|undefined>} [options.env] The environment to inspect.
 * @param {{warn: Function, info?: Function}} [options.logger] Logger for the notices.
 * @returns {object} The resolved mode.
 * @throws {ProviderError} `PRODUCTION_PAYMENTS_DISABLED` when the environment must not be started.
 */
export function assertPaymentModeAllowed(options = {}) {
  const { env = process.env, logger } = options
  const resolution = resolvePaymentMode(env)

  if (logger && typeof logger.warn === 'function') {
    for (const notice of resolution.notices) logger.warn({ payments: resolution.mode }, notice)
  }

  return resolution
}

/**
 * The stricter guard: refuse anything but the in-memory mock.
 *
 * For contexts that must never reach a provider at all — a test run, a preview
 * deployment, a build — where even the sandbox is more than should be possible.
 *
 * @param {object} [options] Options.
 * @param {Record<string, string|undefined>} [options.env] The environment to inspect.
 * @param {{warn: Function}} [options.logger] Logger for the notices.
 * @returns {object} The resolved mode, which is always `MOCK`.
 * @throws {ProviderError} `PRODUCTION_PAYMENTS_DISABLED` when anything but the mock is configured.
 */
export function assertMockPaymentsOnly(options = {}) {
  const resolution = assertPaymentModeAllowed(options)

  if (resolution.mode !== PAYMENT_MODES.MOCK) {
    refuse(
      [`${PAYMENT_MODE_KEY} is "${resolution.mode}" where only the in-memory mock is allowed`],
      {
        mode: resolution.mode,
      },
    )
  }

  return resolution
}

/**
 * Whether a resolution permits calling Stripe at all.
 *
 * The one question the adapter asks. Written as a function rather than left to
 * each caller comparing strings, so "are we allowed to open a socket" has one
 * answer in one place.
 *
 * @param {object} resolution A resolution from {@link resolvePaymentMode}.
 * @returns {boolean} `true` only in `STRIPE_TEST` mode with a complete credential set.
 */
export function stripeEnabled(resolution) {
  return (
    resolution?.mode === PAYMENT_MODES.STRIPE_TEST &&
    resolution?.stripe !== null &&
    typeof resolution?.credentials?.secretKey === 'string'
  )
}
