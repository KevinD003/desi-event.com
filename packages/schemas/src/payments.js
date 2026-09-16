/**
 * What this system can do with money, stated once.
 *
 * Desi-Event can run in exactly two payment modes, and neither of them moves
 * real money:
 *
 *   - `MOCK` — the default. An in-memory adapter that authorises, captures and
 *     refunds nothing, and opens no socket. This is what a fresh clone, CI, a
 *     preview deployment and a credential-free demonstration all run.
 *   - `STRIPE_TEST` — Stripe's sandbox, reached only when a coherent set of
 *     *test* credentials is supplied on purpose. Test keys, test connected
 *     accounts, signed test webhooks. No live money, and no live key will start
 *     it.
 *
 * There is no third mode. `LIVE` is deliberately absent rather than present and
 * disabled: naming a mode no code path reaches would be a lie, and a constant
 * called `LIVE` is a constant somebody eventually tries to use. Production card
 * processing remains a Phase 2 exit criterion — a merchant account,
 * reconciliation operations, real refunds, real payouts and a tax
 * determination, none of which is in this repository.
 *
 * These constants live in the shared vocabulary rather than in the provider
 * package because four different processes have to agree on them: the API
 * reports the mode on its liveness probe, the worker stamps it on receipts and
 * passes, the web app says it to the buyer before they reach a quantity
 * stepper, and the browser needs the publishable key. One set of strings, so
 * none of them can drift into disagreeing about whether money moves.
 *
 * @module @desi-event/schemas/payments
 */

/**
 * The payment modes that exist.
 *
 * The values are the strings reported on the wire and stored on rows, so they
 * are stable. The environment spells them in lower case — see
 * {@link PAYMENT_MODE_ENV_VALUES} — because that is how people write
 * environment variables.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PAYMENT_MODES = Object.freeze({ MOCK: 'MOCK', STRIPE_TEST: 'STRIPE_TEST' })

/**
 * How `PAYMENT_MODE` is spelled in an environment, mapped to the mode it means.
 *
 * Anything absent from this map is refused rather than guessed at. In
 * particular `live`, `production` and `stripe_live` are refused loudly, because
 * somebody who set one of them believes they have enabled card payments and has
 * to be told they have not.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PAYMENT_MODE_ENV_VALUES = Object.freeze({
  mock: PAYMENT_MODES.MOCK,
  demo: PAYMENT_MODES.MOCK,
  'in-memory': PAYMENT_MODES.MOCK,
  none: PAYMENT_MODES.MOCK,
  stripe_test: PAYMENT_MODES.STRIPE_TEST,
  'stripe-test': PAYMENT_MODES.STRIPE_TEST,
  stripe_sandbox: PAYMENT_MODES.STRIPE_TEST,
})

/**
 * Values of `PAYMENT_MODE` that mean "real money", every one of which is
 * refused before the server listens.
 *
 * @type {string[]}
 */
export const PROHIBITED_PAYMENT_MODE_VALUES = Object.freeze([
  'live',
  'production',
  'prod',
  'real',
  'stripe',
  'stripe_live',
  'stripe-live',
])

/**
 * The Stripe API version this repository is written against.
 *
 * Pinned, and pinned here rather than left to the SDK's default, because a
 * webhook payload is only interpretable against the version that produced it
 * and an SDK upgrade must not silently change the shape of what arrives. The
 * adapter passes this to the Stripe constructor and records it on every
 * webhook row.
 *
 * @type {string}
 */
export const STRIPE_API_VERSION = '2025-08-27.basil'

/** Stamped on everything the mock produces, so no artefact reads as real. */
export const DEMO_LABEL = 'DEMO'

/** Stamped on everything Stripe's sandbox produces, for the same reason. */
export const SANDBOX_LABEL = 'SANDBOX'

/** What a deployment, an operator and a buyer are all told. */
export const PRODUCTION_PAYMENTS_DISABLED_MESSAGE =
  'Production payments disabled — Phase 2 integration required.'

/** Shown wherever a mock payment produces something shaped like a record. */
export const DEMO_PAYMENT_NOTICE =
  'DEMO — no money moved, no card was charged, and this is not a valid receipt.'

/** Shown on a pass the mock issued, which admits nobody. */
export const DEMO_TICKET_NOTICE =
  'DEMO — this pass was issued by a demonstration system and admits nobody.'

/** Shown wherever Stripe's sandbox produced something shaped like a record. */
export const SANDBOX_PAYMENT_NOTICE =
  "SANDBOX — settled in Stripe's test mode. No real money moved and this is not a valid receipt."

/** Shown on a pass issued against a sandbox payment. */
export const SANDBOX_TICKET_NOTICE =
  'SANDBOX — this pass was issued against a Stripe test payment and admits nobody.'

/**
 * The notice that belongs on an artefact produced in a given mode.
 *
 * Every mode has one. There is no mode whose artefacts go unmarked, which is
 * the property that stops a demonstration from reading as a real receipt.
 *
 * @param {string} mode One of {@link PAYMENT_MODES}.
 * @returns {string} The notice to show.
 */
export function paymentNoticeFor(mode) {
  return mode === PAYMENT_MODES.STRIPE_TEST ? SANDBOX_PAYMENT_NOTICE : DEMO_PAYMENT_NOTICE
}

/**
 * The notice that belongs on a ticket issued in a given mode.
 *
 * @param {string} mode One of {@link PAYMENT_MODES}.
 * @returns {string} The notice to show.
 */
export function ticketNoticeFor(mode) {
  return mode === PAYMENT_MODES.STRIPE_TEST ? SANDBOX_TICKET_NOTICE : DEMO_TICKET_NOTICE
}

/**
 * The short label that belongs on an artefact produced in a given mode.
 *
 * @param {string} mode One of {@link PAYMENT_MODES}.
 * @returns {string} `DEMO` or `SANDBOX`.
 */
export function labelFor(mode) {
  return mode === PAYMENT_MODES.STRIPE_TEST ? SANDBOX_LABEL : DEMO_LABEL
}
