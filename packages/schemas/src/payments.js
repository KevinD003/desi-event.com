/**
 * What this system can do with money, stated once.
 *
 * Desi-Event has no payment integration. There is a single in-memory adapter,
 * no code anywhere opens a socket to a payment service provider, and real card
 * processing is a Phase 2 prerequisite — it needs a merchant account, signed
 * webhooks, reconciliation, refunds, payouts and a tax policy somebody has
 * determined rather than illustrated.
 *
 * These constants live in the shared vocabulary rather than in the provider
 * package because three different processes have to agree on them: the API
 * reports the mode on its liveness probe, the worker stamps it on receipts and
 * passes, and the web app says it to the buyer before they reach a quantity
 * stepper. One string, so the three cannot drift into disagreeing about
 * whether money moves.
 *
 * @module @desi-event/schemas/payments
 */

/**
 * The payment modes that exist.
 *
 * There is exactly one. `LIVE` is deliberately absent rather than present and
 * disabled: there is no code path that reaches it, so naming it would be a lie.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PAYMENT_MODES = Object.freeze({ MOCK: 'MOCK' })

/** Stamped on everything the mock produces, so no artefact reads as real. */
export const DEMO_LABEL = 'DEMO'

/** What a deployment, an operator and a buyer are all told. */
export const PRODUCTION_PAYMENTS_DISABLED_MESSAGE =
  'Production payments disabled — Phase 2 integration required.'

/** Shown wherever a mock payment produces something shaped like a record. */
export const DEMO_PAYMENT_NOTICE =
  'DEMO — no money moved, no card was charged, and this is not a valid receipt.'

/** Shown on a pass the mock issued, which admits nobody. */
export const DEMO_TICKET_NOTICE =
  'DEMO — this pass was issued by a demonstration system and admits nobody.'
