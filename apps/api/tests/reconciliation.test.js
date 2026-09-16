/**
 * Reconciliation: what the evidence supports, and what an operator may do.
 *
 * Two halves. {@link compareEvidence} is pure and is tested exhaustively,
 * because what a verdict *is* should be readable without a database and it is
 * the decision everything else follows from. The routes are tested through
 * requests, because the properties that matter there are about authorisation
 * and about what the server refuses to accept.
 *
 * The property this file exists for: **an operator cannot set a state.** There
 * is no body field that names one, a resolution that contradicts the provider
 * is refused, and a conflicting or unknown answer closes nothing.
 *
 * @module @desi-event/api/tests/reconciliation
 */

import { describe, expect, it } from 'vitest'

import { PAYMENT_INTENT_STATUS, createInMemoryProviderRegistry } from '@desi-event/providers'

import {
  RESOLUTIONS,
  TASK_STATES,
  VERDICTS,
  agingBand,
  canTransition,
  compareEvidence,
} from '../src/lib/reconciliation.js'
import { toEvidence } from '../src/lib/presenters.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** What the order cost. */
const TOTAL_CENTS = 240_000

/** A payment row shaped the way the comparison reads one. */
const PAYMENT = Object.freeze({
  id: 'pay_1',
  amountCents: TOTAL_CENTS,
  currency: 'INR',
  providerRef: 'pi_000001',
  status: 'TIMEOUT',
})

/**
 * What a re-query would have returned.
 *
 * @param {object} [overrides] Fields to override.
 * @returns {object} An observation.
 */
function observation(overrides = {}) {
  return {
    found: true,
    status: PAYMENT_INTENT_STATUS.SUCCEEDED,
    amountCents: TOTAL_CENTS,
    currency: 'INR',
    refundedAmountCents: 0,
    error: null,
    ...overrides,
  }
}

describe('comparing provider evidence against local evidence', () => {
  it('settles a timed-out payment the provider says succeeded', () => {
    const { verdict } = compareEvidence({
      kind: 'PAYMENT_TIMEOUT',
      observed: observation(),
      payment: PAYMENT,
      order: { status: 'PENDING' },
    })

    expect(verdict).toBe(VERDICTS.SETTLE)
  })

  it('releases one the provider says failed', () => {
    const { verdict } = compareEvidence({
      kind: 'PAYMENT_TIMEOUT',
      observed: observation({ status: PAYMENT_INTENT_STATUS.FAILED }),
      payment: PAYMENT,
      order: { status: 'PENDING' },
    })

    expect(verdict).toBe(VERDICTS.RELEASE)
  })

  it('never reads an unrecognised reference as a failure', () => {
    const { verdict, why } = compareEvidence({
      kind: 'PAYMENT_TIMEOUT',
      observed: observation({ found: false, status: null, error: 'No payment intent pi_000001' }),
      payment: PAYMENT,
      order: { status: 'PENDING' },
    })

    // The single most expensive mistake this module could make: a provider that
    // cannot find an intent has not said the charge failed, and cancelling on
    // that answer strands a buyer who paid.
    expect(verdict).toBe(VERDICTS.UNKNOWN)
    expect(why).toMatch(/No payment intent/)
  })

  it('never reads an authorised-but-uncaptured intent as either', () => {
    const { verdict } = compareEvidence({
      kind: 'PAYMENT_TIMEOUT',
      observed: observation({ status: PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE }),
      payment: PAYMENT,
      order: { status: 'PENDING' },
    })

    expect(verdict).toBe(VERDICTS.UNKNOWN)
  })

  it('calls a mismatched amount a conflict rather than a settlement', () => {
    const { verdict, why } = compareEvidence({
      kind: 'PAYMENT_TIMEOUT',
      observed: observation({ amountCents: 1 }),
      payment: PAYMENT,
      order: { status: 'PENDING' },
    })

    // The amount is checked before the status on purpose. An answer for the
    // right reference but the wrong amount is the strongest sign the reference
    // is wrong, and settling on it would charge the buyer for something else.
    expect(verdict).toBe(VERDICTS.CONFLICT)
    expect(why).toMatch(/1 INR against a payment of 240000 INR/)
  })

  it('calls a mismatched currency a conflict', () => {
    const { verdict } = compareEvidence({
      kind: 'PAYMENT_TIMEOUT',
      observed: observation({ currency: 'USD' }),
      payment: PAYMENT,
      order: { status: 'PENDING' },
    })

    expect(verdict).toBe(VERDICTS.CONFLICT)
  })

  it('reports an order somebody else already finished', () => {
    const { verdict } = compareEvidence({
      kind: 'PAYMENT_TIMEOUT',
      observed: observation(),
      payment: PAYMENT,
      order: { status: 'PAID' },
    })

    expect(verdict).toBe(VERDICTS.ALREADY_DONE)
  })

  it('calls a refunded intent against an unpaid order a conflict', () => {
    const { verdict } = compareEvidence({
      kind: 'PAYMENT_TIMEOUT',
      observed: observation({ status: PAYMENT_INTENT_STATUS.REFUNDED }),
      payment: PAYMENT,
      order: { status: 'PENDING' },
    })

    expect(verdict).toBe(VERDICTS.CONFLICT)
  })

  it('settles a refund the provider has covered', () => {
    const { verdict } = compareEvidence({
      kind: 'REFUND_UNKNOWN',
      observed: observation({ refundedAmountCents: 120_000 }),
      payment: PAYMENT,
      order: { status: 'PAID' },
      refund: { status: 'TIMEOUT', amountCents: 120_000 },
    })

    expect(verdict).toBe(VERDICTS.SETTLE)
  })

  it('releases a refund the provider says never happened', () => {
    const { verdict } = compareEvidence({
      kind: 'REFUND_UNKNOWN',
      observed: observation({ refundedAmountCents: 0 }),
      payment: PAYMENT,
      order: { status: 'PAID' },
      refund: { status: 'TIMEOUT', amountCents: 120_000 },
    })

    expect(verdict).toBe(VERDICTS.RELEASE)
  })

  it('calls a partial amount neither this refund nor nothing', () => {
    const { verdict, why } = compareEvidence({
      kind: 'REFUND_UNKNOWN',
      observed: observation({ refundedAmountCents: 50_000 }),
      payment: PAYMENT,
      order: { status: 'PAID' },
      refund: { status: 'TIMEOUT', amountCents: 120_000 },
    })

    expect(verdict).toBe(VERDICTS.CONFLICT)
    expect(why).toMatch(/neither this refund nor nothing/)
  })

  it('reports a refund that has already settled', () => {
    const { verdict } = compareEvidence({
      kind: 'REFUND_UNKNOWN',
      observed: observation({ refundedAmountCents: 120_000 }),
      payment: PAYMENT,
      order: { status: 'PAID' },
      refund: { status: 'SUCCEEDED', amountCents: 120_000 },
    })

    expect(verdict).toBe(VERDICTS.ALREADY_DONE)
  })
})

describe('the task state machine', () => {
  it('lets an escalated item come back to somebody working it', () => {
    expect(canTransition(TASK_STATES.ESCALATED, TASK_STATES.IN_PROGRESS)).toBe(true)
  })

  it('will not reopen a resolved item', () => {
    expect(canTransition(TASK_STATES.RESOLVED, TASK_STATES.OPEN)).toBe(false)
    expect(canTransition(TASK_STATES.RESOLVED, TASK_STATES.IN_PROGRESS)).toBe(false)
  })
})

describe('aging', () => {
  const now = new Date('2026-09-16T12:00:00Z')

  it.each([
    ['2026-09-16T11:00:00Z', 'FRESH'],
    ['2026-09-15T11:00:00Z', 'AGING'],
    ['2026-09-13T11:00:00Z', 'OVERDUE'],
  ])('puts one opened at %s in the %s band', (createdAt, band) => {
    expect(agingBand({ createdAt: new Date(createdAt) }, now)).toBe(band)
  })
})

/** The platform operations account. */
const OPERATOR = 'ops@desi-event.example'

/** The organisation's owner, who holds `finance:view` and no platform power. */
const OWNER = 'owner@rangoli.example'

/** An organiser of a different organisation. */
const OUTSIDER = 'rival@dhol.example'

/**
 * Sign somebody in and step them up.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email Which account.
 * @returns {Promise<object>} Bearer headers with a fresh step-up.
 */
async function asUser(app, email) {
  const token = await signIn(app, email)
  const headers = bearer(token)

  await stepUp(app, email, headers)

  return headers
}

/**
 * A world holding one timed-out payment and the task it opened.
 *
 * The provider is a real in-memory registry with a real intent on it, so a
 * re-query is a re-query rather than a stub answering itself.
 *
 * @param {object} [options] Options.
 * @param {string} [options.captured] `capture` to make the provider say it
 *   succeeded, `fail` to make it say it failed, `none` to leave it authorised.
 * @param {object} [options.task] Columns to override on the task.
 * @returns {Promise<object>} The harness and the ids the tests need.
 */
async function worldWithTimeout({ captured = 'capture', task: taskOverrides = {} } = {}) {
  const world = await makeWorld()
  const { seed, ids } = world

  // Relative to now, not a literal date: the aging band is computed against the
  // real clock, so a fixed timestamp would put the task in a different band
  // depending on the day the suite ran.
  const openedAt = new Date(Date.now() - 96 * 3_600_000)

  const providers = createInMemoryProviderRegistry()
  const intent = providers.payments.createIntent({
    amountCents: TOTAL_CENTS,
    currency: 'INR',
  })

  if (captured === 'capture') providers.payments.capture(intent.id)

  const orderId = cuid()
  const paymentId = cuid()
  const taskId = cuid()

  seed.order = [
    {
      id: orderId,
      reference: 'DE-RECON1',
      eventId: ids.publishedEvent.id,
      eventSessionId: null,
      userId: ids.attendee.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      status: 'PENDING',
      currency: 'INR',
      subtotalCents: TOTAL_CENTS,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: TOTAL_CENTS,
      refundedCents: 0,
      refundPendingCents: 0,
      paidAt: null,
      createdAt: openedAt,
      updatedAt: openedAt,
    },
  ]

  seed.orderItem = [
    {
      id: cuid(),
      orderId,
      ticketTypeId: ids.generalAdmission.id,
      quantity: 2,
      unitPriceCents: TOTAL_CENTS / 2,
      subtotalCents: TOTAL_CENTS,
      refundedQuantity: 0,
      refundedCents: 0,
    },
  ]

  seed.payment = [
    {
      id: paymentId,
      orderId,
      provider: 'in-memory-payments',
      providerRef: intent.id,
      status: 'TIMEOUT',
      amountCents: TOTAL_CENTS,
      currency: 'INR',
      reconciliationRequired: true,
      createdAt: openedAt,
      updatedAt: openedAt,
    },
  ]

  seed.reconciliationTask = [
    {
      id: taskId,
      kind: 'PAYMENT_TIMEOUT',
      state: 'OPEN',
      paymentId,
      orderId,
      refundId: null,
      webhookEventId: null,
      providerRef: intent.id,
      localState: { orderStatus: 'PENDING', paymentStatus: 'TIMEOUT' },
      providerState: null,
      attempts: 1,
      lastError: 'the provider did not answer',
      assignedToId: null,
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedById: null,
      escalatedAt: null,
      escalationReason: null,
      organizationId: ids.organization.id,
      notes: null,
      transferId: null,
      payoutId: null,
      disputeId: null,
      createdAt: openedAt,
      updatedAt: openedAt,
      ...taskOverrides,
    },
  ]

  const harness = await createTestApp({ seed, ids, providers })

  return { ...harness, ids, providers, intent, orderId, paymentId, taskId }
}

describe('the evidence allow list', () => {
  it('keeps the keys an operator decides on', () => {
    expect(
      toEvidence({
        found: true,
        status: 'succeeded',
        amountCents: 240_000,
        currency: 'INR',
        refundedAmountCents: 0,
        error: null,
      }),
    ).toEqual({
      found: true,
      status: 'succeeded',
      amountCents: 240_000,
      currency: 'INR',
      refundedAmountCents: 0,
      error: null,
    })
  })

  it('drops a provider object a future writer might store whole', () => {
    // Shaped like the real thing, because the real thing is what would arrive
    // if somebody replaced the six-key summary with `await stripe.retrieve(id)`.
    const projected = toEvidence({
      id: 'pi_3PfakeFakeFake',
      status: 'succeeded',
      amount: 240_000,
      currency: 'inr',
      receipt_email: 'priya@example.com',
      charges: {
        data: [
          {
            billing_details: { email: 'priya@example.com', name: 'Priya Sharma' },
            payment_method_details: { card: { last4: '4242', brand: 'visa', exp_year: 2030 } },
          },
        ],
      },
    })

    expect(projected).toEqual({ status: 'succeeded', amount: 240_000, currency: 'inr' })
    expect(JSON.stringify(projected)).not.toMatch(/4242|priya|visa|pi_3/iu)
  })

  it('drops an object hiding under an allowed key', () => {
    // An allow list of key *names* is no protection when `status` can hold a
    // whole charge, which on more than one provider it can.
    expect(
      toEvidence({ status: { code: 'succeeded', card: { last4: '4242' } }, found: true }),
    ).toEqual({ found: true })
  })

  it('tells "recorded but unshowable" from "never recorded"', () => {
    expect(toEvidence(null)).toBeNull()
    expect(toEvidence({ receipt_email: 'priya@example.com' })).toEqual({})
  })

  it('refuses an array, which is not evidence', () => {
    expect(toEvidence([{ status: 'succeeded' }])).toBeNull()
  })
})

describe('GET /v1/operations/reconciliation', () => {
  it('shows no provider payload even when the row holds one', async () => {
    const { app } = await worldWithTimeout({
      task: {
        providerState: {
          status: 'succeeded',
          receipt_email: 'priya@example.com',
          charges: { data: [{ payment_method_details: { card: { last4: '4242' } } }] },
        },
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/operations/reconciliation',
      headers: await asUser(app, OPERATOR),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data[0].providerState).toEqual({ status: 'succeeded' })
    expect(response.body).not.toMatch(/4242|receipt_email/u)
  })

  it('shows the platform everything', async () => {
    const { app, taskId } = await worldWithTimeout()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/operations/reconciliation',
      headers: await asUser(app, OPERATOR),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ id: taskId, kind: 'PAYMENT_TIMEOUT', state: 'OPEN' })
    // Both sides of the evidence, because the decision is made by comparing
    // them and one side alone is half of it.
    expect(data[0].localState).toEqual({ orderStatus: 'PENDING', paymentStatus: 'TIMEOUT' })
    expect(data[0].aging).toBe('OVERDUE')

    await app.close()
  })

  it('shows an organisation only its own, without platform power', async () => {
    const { app, ids, taskId } = await worldWithTimeout()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/operations/reconciliation?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data[0].id).toBe(taskId)

    await app.close()
  })

  it('refuses an organiser asking for the whole platform', async () => {
    const { app } = await worldWithTimeout()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/operations/reconciliation',
      headers: await asUser(app, OWNER),
    })

    // The unscoped view is every organisation's money. Reaching it needs a
    // platform capability rather than a generous reading of an organisation one.
    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an organiser asking about somebody else', async () => {
    const { app, ids } = await worldWithTimeout()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/operations/reconciliation?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OUTSIDER),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('finds an item by the reference an operator arrived holding', async () => {
    const { app, intent } = await worldWithTimeout()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/operations/reconciliation?reference=${intent.id}`,
      headers: await asUser(app, OPERATOR),
    })

    expect(response.json().data).toHaveLength(1)

    await app.close()
  })
})

describe('POST /v1/operations/reconciliation/:id/requery', () => {
  it('asks the provider and returns a verdict without changing anything', async () => {
    const { app, taskId } = await worldWithTimeout()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/requery`,
      headers: await asUser(app, OPERATOR),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.verdict).toBe(VERDICTS.SETTLE)
    expect(data.observed.status).toBe(PAYMENT_INTENT_STATUS.SUCCEEDED)
    // A re-query is a question. The item is still open and the order is still
    // pending: applying the answer is a separate decision.
    expect(data.task.state).toBe('OPEN')

    await app.close()
  })

  it('reports an uncaptured intent as unknown', async () => {
    const { app, taskId } = await worldWithTimeout({ captured: 'none' })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/requery`,
      headers: await asUser(app, OPERATOR),
    })

    expect(response.json().data.verdict).toBe(VERDICTS.UNKNOWN)

    await app.close()
  })

  it('refuses an organiser, however senior', async () => {
    const { app, taskId } = await worldWithTimeout()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/requery`,
      headers: await asUser(app, OWNER),
    })

    // Applying a verdict completes an order, posts a ledger batch and mints
    // tickets. An organiser resolving their own ambiguous charges is a conflict
    // of interest whatever their capability says.
    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('POST /v1/operations/reconciliation/:id/resolve', () => {
  it('completes the order through the ordinary settlement, exactly once', async () => {
    const { app, taskId, orderId } = await worldWithTimeout()
    const headers = await asUser(app, OPERATOR)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/resolve`,
      headers,
      payload: {
        resolution: RESOLUTIONS.SETTLED_FROM_PROVIDER,
        note: 'The provider confirms the charge went through.',
      },
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.state).toBe('RESOLVED')
    expect(data.resolution).toBe(RESOLUTIONS.SETTLED_FROM_PROVIDER)
    // The note is kept as written and appended to the history rather than
    // replacing it.
    expect(data.notes.at(-1).note).toMatch(/confirms the charge/)

    const order = await app.inject({
      method: 'GET',
      url: '/v1/orders/DE-RECON1',
      headers,
    })

    expect(order.json().data.status).toBe('PAID')

    // Trying again is refused rather than settling twice.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/resolve`,
      headers,
      payload: {
        resolution: RESOLUTIONS.SETTLED_FROM_PROVIDER,
        note: 'Pressing it a second time.',
      },
    })

    expect(again.statusCode).toBe(409)
    expect(orderId).toBeTruthy()

    await app.close()
  })

  it('releases an order the provider says was never charged', async () => {
    const { app, taskId } = await worldWithTimeout({ captured: 'none' })
    const headers = await asUser(app, OPERATOR)

    // An authorised-but-uncaptured intent is UNKNOWN, so this cannot be closed
    // at all — which is the point. Failing it at the provider first gives the
    // definite answer a release needs.
    const refused = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/resolve`,
      headers,
      payload: {
        resolution: RESOLUTIONS.RELEASED_FROM_PROVIDER,
        note: 'Assuming it failed because it has been a while.',
      },
    })

    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.message).toMatch(/unknown state is not a failure/i)

    await app.close()
  })

  it('refuses a resolution the provider does not support', async () => {
    const { app, taskId } = await worldWithTimeout()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/resolve`,
      headers: await asUser(app, OPERATOR),
      payload: {
        // The provider says the charge succeeded. Closing it as "released"
        // would be an operator overriding the evidence, which is exactly the
        // failure this queue exists to prevent.
        resolution: RESOLUTIONS.RELEASED_FROM_PROVIDER,
        note: 'Marking it released because the buyer complained.',
      },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/does not support closing this/i)

    await app.close()
  })

  it('accepts no status, however it is spelled', async () => {
    const { app, taskId } = await worldWithTimeout()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/resolve`,
      headers: await asUser(app, OPERATOR),
      payload: {
        resolution: RESOLUTIONS.SETTLED_FROM_PROVIDER,
        note: 'With a status smuggled alongside it.',
        orderStatus: 'PAID',
        paymentStatus: 'SUCCEEDED',
        status: 'PAID',
      },
    })

    // Not a 400: the response schema strips unknown keys, so the extra fields
    // never reach the handler. What matters is that they changed nothing, which
    // the settlement below would have done anyway.
    expect(response.statusCode, response.body).toBe(200)

    await app.close()
  })
})

describe('POST /v1/operations/reconciliation/:id/escalate', () => {
  it('keeps the item open and records why', async () => {
    const { app, taskId } = await worldWithTimeout()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/escalate`,
      headers: await asUser(app, OPERATOR),
      payload: { note: 'The provider and our records disagree on the amount.' },
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.state).toBe('ESCALATED')
    expect(data.escalationReason).toMatch(/disagree on the amount/)
    expect(data.escalatedAt).not.toBeNull()

    await app.close()
  })
})

describe('POST /v1/operations/reconciliation/:id/notes', () => {
  it('appends rather than replaces', async () => {
    const { app, taskId } = await worldWithTimeout()
    const headers = await asUser(app, OPERATOR)

    await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/notes`,
      headers,
      payload: { note: 'Asked the provider support desk.' },
    })

    const second = await app.inject({
      method: 'POST',
      url: `/v1/operations/reconciliation/${taskId}/notes`,
      headers,
      payload: { note: 'They are looking into it.' },
    })

    const { data } = second.json()

    expect(data.notes).toHaveLength(2)
    expect(data.notes[0].note).toMatch(/support desk/)
    expect(data.notes[1].note).toMatch(/looking into it/)

    await app.close()
  })
})
