/**
 * The ten things worth putting under load, and what each one is really asking.
 *
 * ## Why contention scenarios count refusals as successes
 *
 * Five buyers reaching for one seat should produce one hold and four refusals.
 * A scenario that counted those four as errors would be a scenario that passes
 * only when the product oversells. So each scenario says for itself what an
 * expected answer is, and only a 5xx or a transport failure is an error.
 *
 * ## What a scenario does not do
 *
 * Assert. The invariants in `./invariants.js` are what decide whether the run
 * was correct, and they ask the database rather than the responses — a response
 * that says "created" is the application's opinion of what it did.
 *
 * @module scripts/load/scenarios
 */

/**
 * @typedef {object} Scenario
 * @property {string} key Its threshold key in `./config.js`.
 * @property {string} title What a reader should understand it to be doing.
 * @property {string} asks The question it exists to answer.
 * @property {function(object): Promise<object>} [setUp] Builds whatever it needs.
 * @property {function(object): Promise<{ok: boolean, reason?: string}>} run One call.
 * @property {function(object): object} [scope] What the invariants should narrow to.
 */

/** Which HTTP statuses are the product working rather than the product failing. */
const EXPECTED = Object.freeze({
  /** A refusal a contention scenario is trying to provoke. */
  contention: new Set([200, 201, 409, 410, 422]),
  /** An ordinary read. */
  read: new Set([200]),
  /** A write that may legitimately be refused. */
  write: new Set([200, 201, 202, 409, 422]),
})

/**
 * One call, timed and classified.
 *
 * @param {object} context The run context, carrying `call`.
 * @param {object} request What to send.
 * @param {Set<number>} expected Which statuses are not errors.
 * @returns {Promise<{ok: boolean, reason?: string, body: object|null, status: number}>} What happened.
 */
async function attempt(context, request, expected) {
  try {
    const { status, body } = await context.call(request)

    return expected.has(status)
      ? { ok: true, status, body }
      : { ok: false, reason: `HTTP ${status}`, status, body }
  } catch (error) {
    // A transport failure is always an error: the product did not answer at
    // all, which is the failure mode a load test is most likely to find.
    return {
      ok: false,
      reason: String(error?.code ?? error?.message ?? error).slice(0, 60),
      status: 0,
      body: null,
    }
  }
}

/**
 * Every scenario, in the order the brief names them.
 *
 * @type {ReadonlyArray<Scenario>}
 */
export const SCENARIOS = Object.freeze([
  {
    key: 'public-browse',
    title: 'Public event browsing',
    asks: 'Does the catalogue stay fast when everybody arrives at once?',
    async run(context) {
      const page = 1 + (context.iteration % 3)

      return attempt(
        context,
        { method: 'GET', path: `/v1/events?page=${page}&perPage=20` },
        EXPECTED.read,
      )
    },
  },
  {
    key: 'public-search',
    title: 'Public search',
    asks: 'Does a text search over the whole catalogue stay within budget?',
    async run(context) {
      const terms = ['garba', 'qawwali', 'comedy', 'mela', 'night']
      const term = terms[context.iteration % terms.length]

      return attempt(
        context,
        { method: 'GET', path: `/v1/events?q=${term}&sort=startsAt:asc` },
        EXPECTED.read,
      )
    },
  },
  {
    key: 'inventory-read',
    title: 'Hot-event inventory reads',
    asks: 'Does one event everybody is watching serve its availability without queueing?',
    async run(context) {
      return attempt(
        context,
        { method: 'GET', path: `/v1/events/${context.world.eventSlug}` },
        EXPECTED.read,
      )
    },
  },
  {
    key: 'ga-hold-contention',
    title: 'General-admission hold contention',
    asks: 'Do concurrent buyers take at most the tickets that exist?',
    scope: (world) => ({ eventId: world.eventId }),
    async run(context) {
      return attempt(
        context,
        {
          method: 'POST',
          path: '/v1/holds',
          body: { ticketTypeId: context.world.scarceTicketTypeId, quantity: 1 },
        },
        EXPECTED.contention,
      )
    },
  },
  {
    key: 'seat-hold-contention',
    title: 'Reserved-seat hold contention',
    asks: 'Do concurrent buyers reaching for the same seats take each seat once?',
    scope: (world) => ({ eventId: world.seatedEventId }),
    async run(context) {
      // Everybody reaches for the same small pool on purpose. Spreading the
      // selection would measure throughput and prove nothing about contention.
      const seats = context.world.seatIds.slice(0, 3)

      return attempt(
        context,
        {
          method: 'POST',
          path: `/v1/sessions/${context.world.seatedSessionId}/holds`,
          body: { seatIds: [seats[context.iteration % seats.length]] },
        },
        EXPECTED.contention,
      )
    },
  },
  {
    key: 'checkout-create',
    title: 'Checkout creation',
    asks: 'Does creating an order stay within budget while inventory is contended?',
    scope: (world) => ({ eventId: world.eventId }),
    async run(context) {
      return attempt(
        context,
        {
          method: 'POST',
          path: '/v1/orders',
          body: {
            eventId: context.world.eventId,
            buyerEmail: `load-${context.worker}-${context.iteration}@desi-event.example`,
            buyerName: 'Load Buyer',
            items: [{ ticketTypeId: context.world.roomyTicketTypeId, quantity: 1 }],
          },
        },
        EXPECTED.write,
      )
    },
  },
  {
    key: 'webhook-duplicates',
    title: 'Duplicate webhook processing',
    asks: 'Does the same delivery arriving many times change anything after the first?',
    async run(context) {
      return attempt(
        context,
        {
          method: 'POST',
          path: '/v1/payments/webhook',
          body: {
            provider: 'in-memory-payments',
            // The same delivery every time, which is the case a provider
            // actually produces: a webhook retried because the acknowledgement
            // was lost. The second and hundredth must change nothing.
            providerEventId: context.world.webhookEventId,
            eventType: 'payment.succeeded',
            orderReference: context.world.refundableReference,
            providerRef: context.world.intentId,
            amountCents: 5_000,
            currency: 'INR',
          },
        },
        EXPECTED.write,
      )
    },
  },
  {
    key: 'check-in-concurrency',
    title: 'Check-in concurrency',
    asks: 'Do two scanners on one pass produce one admission?',
    async run(context) {
      const codes = context.world.ticketCodes

      return attempt(
        context,
        {
          method: 'POST',
          path: '/v1/tickets/check-in',
          body: { code: codes[context.iteration % codes.length] },
          headers: context.world.doorHeaders,
        },
        EXPECTED.contention,
      )
    },
  },
  {
    key: 'notification-throughput',
    title: 'Notification worker throughput',
    asks: 'Does the outbox drain faster than it fills?',
    async run(context) {
      return attempt(
        context,
        {
          method: 'GET',
          path: '/v1/operations/notifications?perPage=50',
          headers: context.world.operatorHeaders,
        },
        EXPECTED.read,
      )
    },
  },
  {
    key: 'refund-contention',
    title: 'Refund request contention',
    asks: 'Do concurrent refund requests together stay inside what was paid?',
    async run(context) {
      return attempt(
        context,
        {
          method: 'POST',
          path: `/v1/orders/${context.world.refundableReference}/refunds`,
          body: {
            amountCents: 100,
            reason: 'CUSTOMER_REQUEST',
            idempotencyKey: `load-${context.worker}-${context.iteration}-${context.world.tag}`,
          },
          headers: context.world.financeHeaders,
        },
        EXPECTED.contention,
      )
    },
  },
  {
    key: 'reconciliation-queue',
    title: 'Reconciliation queue processing',
    asks: 'Does the operations queue stay readable while everything else is busy?',
    async run(context) {
      return attempt(
        context,
        {
          method: 'GET',
          path: '/v1/operations/reconciliation',
          headers: context.world.operatorHeaders,
        },
        EXPECTED.read,
      )
    },
  },
])

/**
 * One scenario by its key.
 *
 * @param {string} key The threshold key.
 * @returns {Scenario|undefined} The scenario.
 */
export function scenarioByKey(key) {
  return SCENARIOS.find((scenario) => scenario.key === key)
}
