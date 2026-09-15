/**
 * The Stripe adapter, test mode only.
 *
 * This module can reach Stripe's sandbox and cannot reach anything else. That is
 * not a convention: `resolvePaymentMode` refuses to return `STRIPE_TEST` unless a
 * coherent set of test credentials was supplied on purpose, and this adapter
 * refuses to construct without one. A live key never gets this far — the boot
 * gate in `payment-mode.js` stops the process before a port opens.
 *
 * What this adapter is careful about, and why each one is a specific decision:
 *
 *   - **The amount comes from the caller, never from the browser.** Every
 *     `createIntent` takes minor units computed server-side from a pricing
 *     snapshot. There is no path that reads an amount off a request.
 *   - **The secret key is never exposed and never logged.** The Stripe client is
 *     built inside a closure; nothing returns it, and the error mapper below
 *     copies four named fields off a Stripe error rather than serialising it,
 *     because a serialised Stripe error carries the request payload.
 *   - **Idempotency keys are ours and are scoped.** Stripe deduplicates on the
 *     key for 24 hours, which is what stops a retried checkout creating two
 *     PaymentIntents — so the key is derived from the order and the attempt, not
 *     generated fresh per call.
 *   - **The API version is pinned in code.** A webhook payload is only
 *     interpretable against the version that produced it, and an SDK upgrade must
 *     not silently change the shape of what arrives.
 *   - **Destination charges, per ADR 0003.** `on_behalf_of` and
 *     `transfer_data.destination` name the connected account; the platform fee is
 *     one disclosed `application_fee_amount`.
 *
 * **Nothing in this module has been run against Stripe.** No test credentials
 * were available when it was written, so every test around it uses a fake SDK
 * with the real call shapes. The repository marks the sandbox execution
 * `EXTERNAL VERIFICATION PENDING`, and no claim anywhere says otherwise.
 *
 * @module @desi-event/providers/stripe
 */

import { PAYMENT_MODES, STRIPE_API_VERSION } from '@desi-event/schemas'

import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'

/**
 * Stripe statuses mapped to this system's `PaymentStatus`.
 *
 * Explicit rather than clever, because two of these are the ones that matter and
 * both are easy to get wrong:
 *
 *   - `requires_action` is **not** a failure. It is 3-D Secure, and treating it
 *     as a decline loses every authenticated payment in Europe and India.
 *   - `processing` is **not** a success. It is an asynchronous method that has
 *     not settled, and treating it as paid issues tickets for money that may
 *     never arrive.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STRIPE_STATUS_MAP = Object.freeze({
  requires_payment_method: 'PENDING',
  requires_confirmation: 'PENDING',
  requires_action: 'REQUIRES_ACTION',
  processing: 'PROCESSING',
  requires_capture: 'AUTHORIZED',
  succeeded: 'PAID',
  canceled: 'CANCELLED',
})

/**
 * Stripe error types that mean "the caller's card was refused", as opposed to
 * "something went wrong".
 *
 * The distinction decides whether a buyer is told to try another card or told to
 * try again later, and whether the order goes to reconciliation.
 *
 * @type {Set<string>}
 */
export const DECLINE_TYPES = new Set(['StripeCardError'])

/**
 * Stripe error types that mean the outcome is unknown.
 *
 * A connection error or a timeout is the one case where Stripe may have accepted
 * the payment and this process never found out. Those must never be treated as
 * declines — see the saga: an unknown outcome goes to reconciliation with its
 * inventory still held.
 *
 * @type {Set<string>}
 */
export const UNKNOWN_OUTCOME_TYPES = new Set([
  'StripeConnectionError',
  'StripeAPIError',
  'RateLimitError',
])

/**
 * Turn a Stripe error into one of ours, without carrying anything sensitive.
 *
 * Four named fields are copied. The error object itself is not serialised,
 * because a Stripe error carries `raw`, which carries the request — which
 * carries the amount, the metadata and, on some error shapes, the payment method
 * details. A log line is not a place for any of that.
 *
 * @param {unknown} error Whatever the SDK threw.
 * @returns {ProviderError} The mapped error.
 */
export function mapStripeError(error) {
  const type = /** @type {{type?: string}} */ (error)?.type ?? error?.constructor?.name ?? 'unknown'
  const code = /** @type {{code?: string}} */ (error)?.code ?? null
  const declineCode = /** @type {{decline_code?: string}} */ (error)?.decline_code ?? null
  const requestId = /** @type {{requestId?: string}} */ (error)?.requestId ?? null
  const details = { type, code, declineCode, requestId }

  if (DECLINE_TYPES.has(type)) {
    return new ProviderError(
      PROVIDER_ERROR_CODES.PAYMENT_DECLINED,
      'That card was declined. Try a different payment method.',
      { provider: 'stripe', details },
    )
  }

  if (UNKNOWN_OUTCOME_TYPES.has(type)) {
    return new ProviderError(
      PROVIDER_ERROR_CODES.PAYMENT_TIMEOUT,
      'We could not confirm whether that payment went through. Nothing has been issued; this is being checked.',
      { provider: 'stripe', details },
    )
  }

  return new ProviderError(
    PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
    'The payment service could not complete that request.',
    { provider: 'stripe', details },
  )
}

/**
 * The safe display metadata for a payment method.
 *
 * Four fields, all of which a receipt may show and none of which is a card
 * number. Everything else Stripe returns about a payment method is deliberately
 * dropped here rather than filtered later, so there is no path by which a fuller
 * object reaches a row.
 *
 * @param {object|null|undefined} paymentMethod A Stripe PaymentMethod.
 * @returns {object|null} `{brand, last4, expMonth, expYear}`, or null.
 */
export function safeCardMetadata(paymentMethod) {
  const card = paymentMethod?.card

  if (!card) return null

  return {
    brand: card.brand ?? null,
    last4: card.last4 ?? null,
    expMonth: card.exp_month ?? null,
    expYear: card.exp_year ?? null,
  }
}

/**
 * An idempotency key that is stable for one attempt at one thing.
 *
 * Scoped by operation so that "charge order X" and "refund order X" cannot
 * collide, and by attempt so that a deliberate second attempt after a decline is
 * a new request rather than a replay of the declined one. Stripe deduplicates on
 * this for 24 hours, which is what makes a retried checkout safe.
 *
 * @param {string} scope What is being done, e.g. `payment-intent`.
 * @param {string} subject The thing it is being done to, e.g. an order id.
 * @param {number|string} [attempt] Which attempt.
 * @returns {string} The key.
 */
export function idempotencyKey(scope, subject, attempt = 1) {
  return `desi:${scope}:${subject}:${attempt}`
}

/**
 * Build the Stripe payment adapter.
 *
 * @param {object} options Options.
 * @param {object} options.resolution A resolution from `resolvePaymentMode`, in `STRIPE_TEST` mode.
 * @param {Function} [options.createClient] Constructs the Stripe client. Injected so tests can supply a fake with the real call shapes.
 * @returns {object} A payment provider plus the Stripe-specific operations.
 * @throws {ProviderError} When the mode is not `STRIPE_TEST`, or credentials are absent.
 */
export function createStripePaymentProvider({ resolution, createClient }) {
  if (resolution?.mode !== PAYMENT_MODES.STRIPE_TEST) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PRODUCTION_PAYMENTS_DISABLED,
      'The Stripe adapter is only built in stripe_test mode. In mock mode the in-memory provider is used and nothing reaches a network.',
      { provider: 'stripe', details: { mode: resolution?.mode ?? null } },
    )
  }

  // Read once, into a closure. `credentials` is a non-enumerable property on the
  // resolution precisely so that logging the resolution cannot reveal it, and
  // nothing below puts it anywhere it could escape.
  const secretKey = resolution.credentials?.secretKey

  if (!secretKey) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PRODUCTION_PAYMENTS_DISABLED,
      'No Stripe secret key is available. The payment mode resolver should have refused this configuration.',
      { provider: 'stripe' },
    )
  }

  /**
   * The client, or the promise of it.
   *
   * The *promise* is cached rather than the value, so two concurrent calls share
   * one construction. Caching the value instead leaves a window in which both see
   * `null` and both build a client — harmless here, and the same shape of bug
   * that elsewhere in this repository means two charges.
   *
   * @type {Promise<object>|null}
   */
  let clientPromise = null

  /**
   * The Stripe client, built on first use.
   *
   * Lazily, so that constructing the adapter — which happens at boot — does not
   * itself require the SDK to be loadable. The API version is passed explicitly
   * rather than left to the SDK default.
   *
   * @returns {Promise<object>} The client.
   */
  function stripe() {
    clientPromise ??= (async () => {
      if (createClient) return createClient({ secretKey, apiVersion: STRIPE_API_VERSION })

      const { default: Stripe } = await import('stripe')

      return new Stripe(secretKey, {
        apiVersion: STRIPE_API_VERSION,
        // Named so that a request in Stripe's dashboard logs can be traced back
        // to this application rather than to "unknown Node client".
        appInfo: { name: 'Desi-Event', version: '0.1.0' },
        // Retries are this system's to decide, not the SDK's: a silent retry of
        // a call whose outcome is unknown is exactly what the reconciliation
        // queue exists to avoid.
        maxNetworkRetries: 0,
      })
    })()

    return clientPromise
  }

  /**
   * Run a Stripe call, mapping whatever it throws.
   *
   * @param {Function} call Receives the client.
   * @returns {Promise<unknown>} Whatever the call resolved with.
   */
  async function run(call) {
    try {
      return await call(await stripe())
    } catch (error) {
      throw mapStripeError(error)
    }
  }

  return Object.freeze({
    /** The mode this adapter runs in. Always the sandbox. */
    mode: PAYMENT_MODES.STRIPE_TEST,

    /** The API version every call and every stored payload is interpreted against. */
    apiVersion: STRIPE_API_VERSION,

    /**
     * Create a PaymentIntent for an order.
     *
     * The amount is the caller's, computed server-side from a pricing snapshot.
     * `automatic_payment_methods` lets Stripe decide which methods to offer,
     * which is what makes 3-D Secure work without this code knowing about it.
     *
     * Per ADR 0003 this is a destination charge: `on_behalf_of` makes the
     * connected account the settlement merchant, `transfer_data.destination`
     * sends them the money, and `application_fee_amount` is the platform's
     * disclosed cut.
     *
     * @param {object} input The intent.
     * @param {number} input.amountCents Total to charge, in minor units.
     * @param {string} input.currency ISO-4217.
     * @param {string} input.orderId The order being paid for.
     * @param {number} [input.attempt] Which attempt, for the idempotency key.
     * @param {string} [input.connectedAccountId] The organiser's connected account.
     * @param {number} [input.applicationFeeCents] The platform fee.
     * @param {string} [input.customerId] A Stripe customer, when the buyer has one.
     * @param {Record<string, string>} [input.metadata] Non-sensitive metadata only.
     * @returns {Promise<object>} `{id, clientSecret, status, amountCents, currency}`.
     */
    async createIntent({
      amountCents,
      currency,
      orderId,
      attempt = 1,
      connectedAccountId,
      applicationFeeCents,
      customerId,
      metadata = {},
    }) {
      const intent = await run((sdk) =>
        sdk.paymentIntents.create(
          {
            amount: amountCents,
            currency: String(currency).toLowerCase(),
            automatic_payment_methods: { enabled: true },
            ...(customerId ? { customer: customerId } : {}),
            ...(connectedAccountId
              ? {
                  on_behalf_of: connectedAccountId,
                  transfer_data: { destination: connectedAccountId },
                  ...(applicationFeeCents ? { application_fee_amount: applicationFeeCents } : {}),
                }
              : {}),
            // Identifiers only. Never a name, an address or an email: metadata is
            // readable by anybody with dashboard access and is echoed into
            // webhook payloads that are stored.
            metadata: { ...metadata, orderId, attempt: String(attempt) },
          },
          { idempotencyKey: idempotencyKey('payment-intent', orderId, attempt) },
        ),
      )

      return {
        id: intent.id,
        // The one secret that is *meant* to reach the browser. It authorises
        // confirming this one intent and nothing else, and it is never logged.
        clientSecret: intent.client_secret,
        status: STRIPE_STATUS_MAP[intent.status] ?? 'PENDING',
        providerStatus: intent.status,
        amountCents: intent.amount,
        currency: String(intent.currency).toUpperCase(),
      }
    },

    /**
     * Read an intent's current state from Stripe.
     *
     * The authoritative answer when a local record and a webhook disagree, and
     * the first thing reconciliation does: a browser redirect is not proof of
     * payment, and neither is a local row.
     *
     * @param {string} intentId The PaymentIntent id.
     * @returns {Promise<object>} The current state, with safe card metadata.
     */
    async getStatus(intentId) {
      const intent = await run((sdk) =>
        sdk.paymentIntents.retrieve(intentId, { expand: ['latest_charge.payment_method_details'] }),
      )

      return {
        id: intent.id,
        status: STRIPE_STATUS_MAP[intent.status] ?? 'PENDING',
        providerStatus: intent.status,
        amountCents: intent.amount,
        amountReceivedCents: intent.amount_received ?? 0,
        currency: String(intent.currency).toUpperCase(),
        card: safeCardMetadata(intent.latest_charge?.payment_method_details),
        chargeId: intent.latest_charge?.id ?? intent.latest_charge ?? null,
      }
    },

    /**
     * Capture an authorised intent.
     *
     * Only reached when a deployment configures manual capture. The default is
     * automatic, because holding an authorisation is a promise to the cardholder
     * that this system is not yet equipped to keep.
     *
     * @param {string} intentId The PaymentIntent id.
     * @param {object} [options] Options.
     * @param {number} [options.attempt] Which attempt, for the idempotency key.
     * @returns {Promise<object>} The captured intent.
     */
    async capture(intentId, { attempt = 1 } = {}) {
      const intent = await run((sdk) =>
        sdk.paymentIntents.capture(
          intentId,
          {},
          { idempotencyKey: idempotencyKey('capture', intentId, attempt) },
        ),
      )

      return {
        id: intent.id,
        status: STRIPE_STATUS_MAP[intent.status] ?? 'PENDING',
        providerStatus: intent.status,
        amountCents: intent.amount,
        currency: String(intent.currency).toUpperCase(),
      }
    },

    /**
     * Refund part or all of a payment.
     *
     * `reverse_transfer` and `refund_application_fee` are explicit per refund
     * rather than implied, because they decide who bears the cost: reversing the
     * transfer takes the money back out of the organiser's balance, and refunding
     * the application fee decides whether the platform gives its cut back. Those
     * are policy, not plumbing, so the caller states them.
     *
     * @param {object} input The refund.
     * @param {string} input.paymentIntentId The intent to refund.
     * @param {number} input.amountCents How much, in minor units.
     * @param {string} input.refundId Our own refund row id, for the idempotency key.
     * @param {boolean} [input.reverseTransfer] Claw the organiser's share back.
     * @param {boolean} [input.refundApplicationFee] Give the platform fee back too.
     * @param {string} [input.reason] One of Stripe's reasons.
     * @returns {Promise<object>} The refund.
     */
    async refund({
      paymentIntentId,
      amountCents,
      refundId,
      reverseTransfer = true,
      refundApplicationFee = false,
      reason,
    }) {
      const refund = await run((sdk) =>
        sdk.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount: amountCents,
            reverse_transfer: reverseTransfer,
            refund_application_fee: refundApplicationFee,
            ...(reason ? { reason } : {}),
            metadata: { refundId },
          },
          { idempotencyKey: idempotencyKey('refund', refundId, 1) },
        ),
      )

      return {
        id: refund.id,
        status: refund.status,
        amountCents: refund.amount,
        currency: String(refund.currency).toUpperCase(),
      }
    },

    /**
     * Create a connected account for an organiser.
     *
     * Express, so Stripe hosts the onboarding and the identity documents never
     * touch this system. `capabilities` asks for what a destination charge needs
     * and nothing more.
     *
     * @param {object} input The organiser.
     * @param {string} input.organizationId Our own id, for the idempotency key and metadata.
     * @param {string} input.email Where Stripe writes.
     * @param {string} [input.country] ISO 3166-1 alpha-2.
     * @returns {Promise<object>} The account's id and its current state.
     */
    async createConnectedAccount({ organizationId, email, country = 'IN' }) {
      const account = await run((sdk) =>
        sdk.accounts.create(
          {
            type: 'express',
            country,
            email,
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true },
            },
            metadata: { organizationId },
          },
          { idempotencyKey: idempotencyKey('connect-account', organizationId, 1) },
        ),
      )

      return toAccountState(account)
    },

    /**
     * A single-use link into Stripe's hosted onboarding.
     *
     * Stripe expires these quickly and they are single-use, which is why this is
     * generated per request rather than stored: a stored onboarding link is a
     * stored way into somebody's payout settings.
     *
     * @param {object} input The link.
     * @param {string} input.accountId The connected account.
     * @param {string} input.refreshUrl Where Stripe sends an expired link.
     * @param {string} input.returnUrl Where Stripe sends a finished organiser.
     * @returns {Promise<object>} `{url, expiresAt}`.
     */
    async createOnboardingLink({ accountId, refreshUrl, returnUrl }) {
      const link = await run((sdk) =>
        sdk.accountLinks.create({
          account: accountId,
          refresh_url: refreshUrl,
          return_url: returnUrl,
          type: 'account_onboarding',
        }),
      )

      return { url: link.url, expiresAt: new Date(link.expires_at * 1000).toISOString() }
    },

    /**
     * Read a connected account's state from Stripe.
     *
     * The authoritative answer, and the only one this system stores. A browser
     * returning from hosted onboarding proves that a browser came back, not that
     * onboarding finished — so the return handler reads this rather than
     * believing the redirect.
     *
     * @param {string} accountId The connected account.
     * @returns {Promise<object>} The account's state.
     */
    async getConnectedAccount(accountId) {
      return toAccountState(await run((sdk) => sdk.accounts.retrieve(accountId)))
    },

    /**
     * Reverse part or all of a transfer to a connected account.
     *
     * @param {object} input The reversal.
     * @param {string} input.transferId The Stripe transfer.
     * @param {number} input.amountCents How much to claw back.
     * @param {string} input.reversalId Our own id, for the idempotency key.
     * @returns {Promise<object>} The reversal.
     */
    async reverseTransfer({ transferId, amountCents, reversalId }) {
      const reversal = await run((sdk) =>
        sdk.transfers.createReversal(
          transferId,
          { amount: amountCents, metadata: { reversalId } },
          { idempotencyKey: idempotencyKey('transfer-reversal', reversalId, 1) },
        ),
      )

      return { id: reversal.id, amountCents: reversal.amount }
    },
  })
}

/**
 * The parts of a Stripe account this system stores.
 *
 * Provider identifiers and status flags. Deliberately not the requirements'
 * contents, the representative's details or anything else Stripe holds about the
 * organiser: this system needs to know whether an organiser can be paid, and does
 * not need their identity documents.
 *
 * @param {object} account A Stripe Account.
 * @returns {object} The state worth storing.
 */
export function toAccountState(account) {
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    disabledReason: account.requirements?.disabled_reason ?? null,
    // Counts, not contents. "Three things outstanding" is what an organiser
    // console needs; which three is Stripe's hosted page to say.
    currentlyDueCount: (account.requirements?.currently_due ?? []).length,
    pastDueCount: (account.requirements?.past_due ?? []).length,
    country: account.country ?? null,
    defaultCurrency: account.default_currency
      ? String(account.default_currency).toUpperCase()
      : null,
  }
}
