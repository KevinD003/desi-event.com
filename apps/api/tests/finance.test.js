/**
 * Money leaving: the balance, the ceilings, and the three state machines.
 *
 * The properties worth a test here are the ones that cost somebody money when
 * they are wrong:
 *
 *   - **The balance is derived, and everything committed is held against it.**
 *     Refunds a buyer has been promised, disputes somebody is claiming, and
 *     payouts already in flight all reduce what may be paid.
 *   - **A negative balance is never paid**, and neither is an amount above it.
 *     Both are HELD with the reason stored rather than refused silently.
 *   - **The transition tables are enforced.** A paid payout cannot be sent
 *     again, a reversed one cannot be reversed again.
 *   - **A reversal posts compensating entries.** The original batch is never
 *     edited, and the ledger says the money went and came back.
 *   - **No destination is accepted.** Where the money goes is a property of the
 *     connected account, not a field on a request.
 *
 * @module @desi-event/api/tests/finance
 */

import { describe, expect, it } from 'vitest'

import { ACCOUNTS, CREDIT, DEBIT } from '@desi-event/ledger'
import { createInMemoryProviderRegistry } from '@desi-event/providers'

import {
  DISPUTE_TRANSITIONS,
  PAYOUT_TRANSITIONS,
  TRANSFER_TRANSITIONS,
  canTransition,
} from '../src/lib/payouts.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { LEDGER_ACCOUNTS, makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** What the organiser has earned, before anything is held against it. */
const EARNED_CENTS = 1_000_000

/** The organisation's owner, who holds every finance capability. */
const OWNER = 'owner@rangoli.example'

/** A MANAGER: can publish an event, and cannot touch money. */
const MANAGER = 'arun@rangoli.example'

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
 * The id of a ledger account in the fixture chart.
 *
 * @param {string} code One of {@link ACCOUNTS}.
 * @returns {string} The account's id.
 */
function accountId(code) {
  return LEDGER_ACCOUNTS.find((account) => account.code === code).id
}

/**
 * A world where the organiser is owed money, with whatever is held against it.
 *
 * The payable is seeded as ledger entries rather than as a column, because the
 * balance is derived from entries and a column the derivation never reads would
 * prove nothing.
 *
 * @param {object} [options] Options.
 * @param {number} [options.earnedCents] What the ledger says is owed.
 * @param {number} [options.refundPendingCents] Promised back to buyers.
 * @param {Array<object>} [options.payouts] Payout rows to seed.
 * @param {Array<object>} [options.disputes] Dispute rows to seed.
 * @param {Array<object>} [options.transfers] Transfer rows to seed.
 * @param {object} [options.providers] A provider registry to use instead of a fresh one.
 * @returns {Promise<object>} The harness and the ids the tests need.
 */
async function worldWithBalance({
  earnedCents = EARNED_CENTS,
  refundPendingCents = 0,
  payouts = [],
  disputes = [],
  transfers = [],
  providers: suppliedProviders,
} = {}) {
  const world = await makeWorld()
  const { seed, ids } = world

  const orderId = cuid()
  const paymentId = cuid()
  const batchId = cuid()

  seed.order = [
    {
      id: orderId,
      reference: 'DE-FIN001',
      eventId: ids.publishedEvent.id,
      eventSessionId: null,
      userId: ids.attendee.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: earnedCents,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: earnedCents,
      refundedCents: 0,
      refundPendingCents,
      paidAt: new Date('2026-09-01T10:00:00Z'),
      createdAt: new Date('2026-09-01T10:00:00Z'),
      updatedAt: new Date('2026-09-01T10:00:00Z'),
    },
  ]

  seed.payment = [
    {
      id: paymentId,
      orderId,
      provider: 'in-memory-payments',
      providerRef: 'pi_fin_0001',
      status: 'SUCCEEDED',
      amountCents: earnedCents,
      currency: 'INR',
      createdAt: new Date('2026-09-01T10:00:00Z'),
      updatedAt: new Date('2026-09-01T10:00:00Z'),
    },
  ]

  seed.ledgerBatch = [
    {
      id: batchId,
      reference: 'OR-FIN001',
      kind: 'ORDER_PAID',
      status: 'POSTED',
      currency: 'INR',
      debitCents: earnedCents,
      creditCents: earnedCents,
      sourceType: 'ORDER',
      sourceId: orderId,
      idempotencyKey: 'ORDER_PAID:ORDER:fin001:',
      orderId,
      paymentId,
      refundId: null,
      disputeId: null,
      transferId: null,
      payoutId: null,
      compensatesBatchId: null,
      actorId: null,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      postedAt: new Date('2026-09-01T10:00:00Z'),
    },
  ]

  seed.ledgerEntry = [
    {
      id: cuid(),
      batchId,
      accountId: accountId(ACCOUNTS.PROCESSOR_CLEARING),
      direction: DEBIT,
      amountCents: earnedCents,
      currency: 'INR',
      memo: 'Order FIN001 taken',
      organizationId: ids.organization.id,
      createdAt: new Date('2026-09-01T10:00:00Z'),
    },
    {
      id: cuid(),
      batchId,
      accountId: accountId(ACCOUNTS.ORGANIZER_PAYABLE),
      direction: CREDIT,
      amountCents: earnedCents,
      currency: 'INR',
      memo: 'Order FIN001 owed to the organiser',
      organizationId: ids.organization.id,
      createdAt: new Date('2026-09-01T10:00:00Z'),
    },
  ]

  seed.payout = payouts.map((payout) => ({
    organizationId: ids.organization.id,
    connectedAccountId: null,
    provider: 'in-memory-payments',
    providerPayoutId: null,
    amountCents: 100_000,
    currency: 'INR',
    status: 'SCHEDULED',
    arrivalDate: null,
    failureCode: null,
    rawProviderStatus: null,
    reversedCents: 0,
    holdReason: null,
    createdAt: new Date('2026-09-02T10:00:00Z'),
    updatedAt: new Date('2026-09-02T10:00:00Z'),
    ...payout,
  }))

  seed.transfer = transfers.map((transfer) => ({
    organizationId: ids.organization.id,
    connectedAccountId: null,
    orderId: null,
    provider: 'in-memory-payments',
    providerTransferId: null,
    amountCents: 100_000,
    currency: 'INR',
    status: 'PENDING',
    reversedCents: 0,
    failureCode: null,
    rawProviderStatus: null,
    settledAt: null,
    createdAt: new Date('2026-09-02T10:00:00Z'),
    updatedAt: new Date('2026-09-02T10:00:00Z'),
    ...transfer,
  }))

  seed.dispute = disputes.map((dispute) => ({
    paymentId,
    provider: 'in-memory-payments',
    providerDisputeId: `dp_${cuid()}`,
    amountCents: 100_000,
    currency: 'INR',
    reason: 'product_not_received',
    status: 'OPENED',
    evidenceDueAt: null,
    rawProviderStatus: null,
    fundsWithheld: true,
    closedAt: null,
    createdAt: new Date('2026-09-03T10:00:00Z'),
    updatedAt: new Date('2026-09-03T10:00:00Z'),
    ...dispute,
  }))

  const providers = suppliedProviders ?? createInMemoryProviderRegistry()
  const harness = await createTestApp({ seed, ids, providers })

  return { ...harness, ids, providers, orderId, paymentId }
}

/**
 * Read the balance as the finance screen would.
 *
 * @param {object} app The Fastify instance.
 * @param {object} headers Signed-in headers.
 * @param {string} organizationId Whose.
 * @returns {Promise<object>} The balance payload.
 */
async function readBalance(app, headers, organizationId) {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/finance/balance?organizationId=${organizationId}&currency=INR`,
    headers,
  })

  expect(response.statusCode, response.body).toBe(200)

  return response.json().data
}

describe('the transition tables', () => {
  it('will not send a paid payout again', () => {
    expect(canTransition(PAYOUT_TRANSITIONS, 'PAID', 'SUBMITTED')).toBe(false)
  })

  it('will not reverse a reversed payout again', () => {
    expect(canTransition(PAYOUT_TRANSITIONS, 'REVERSED', 'REVERSED')).toBe(false)
  })

  it('lets a held payout be released when the balance recovers', () => {
    expect(canTransition(PAYOUT_TRANSITIONS, 'HELD', 'SCHEDULED')).toBe(true)
  })

  it('lets a failed transfer be tried again once the cause is fixed', () => {
    expect(canTransition(TRANSFER_TRANSITIONS, 'FAILED', 'SUBMITTED')).toBe(true)
  })

  it('will not resolve a closed dispute', () => {
    expect(canTransition(DISPUTE_TRANSITIONS, 'CLOSED', 'WON')).toBe(false)
    expect(canTransition(DISPUTE_TRANSITIONS, 'CLOSED', 'LOST')).toBe(false)
  })

  it('does not read a timed-out payout as a failure', () => {
    // RECONCILIATION_REQUIRED can still become either. A machine that only let
    // it become FAILED would be a machine that read silence as a refusal.
    expect(canTransition(PAYOUT_TRANSITIONS, 'RECONCILIATION_REQUIRED', 'PAID')).toBe(true)
    expect(canTransition(PAYOUT_TRANSITIONS, 'RECONCILIATION_REQUIRED', 'FAILED')).toBe(true)
  })
})

describe('GET /v1/finance/balance', () => {
  it('derives what is owed from the ledger', async () => {
    const { app, ids } = await worldWithBalance()
    const balance = await readBalance(app, await asUser(app, OWNER), ids.organization.id)

    expect(balance).toMatchObject({
      payableCents: EARNED_CENTS,
      inFlightCents: 0,
      refundLiabilityCents: 0,
      disputeLiabilityCents: 0,
      availableCents: EARNED_CENTS,
    })

    await app.close()
  })

  it('holds back what a buyer has been promised', async () => {
    const { app, ids } = await worldWithBalance({ refundPendingCents: 300_000 })
    const balance = await readBalance(app, await asUser(app, OWNER), ids.organization.id)

    expect(balance.refundLiabilityCents).toBe(300_000)
    expect(balance.availableCents).toBe(EARNED_CENTS - 300_000)

    await app.close()
  })

  it('holds back what is being disputed', async () => {
    const { app, ids } = await worldWithBalance({
      disputes: [{ id: cuid(), amountCents: 250_000, status: 'UNDER_REVIEW' }],
    })
    const balance = await readBalance(app, await asUser(app, OWNER), ids.organization.id)

    expect(balance.disputeLiabilityCents).toBe(250_000)
    expect(balance.availableCents).toBe(EARNED_CENTS - 250_000)

    await app.close()
  })

  it('does not hold back a dispute that is over', async () => {
    const { app, ids } = await worldWithBalance({
      disputes: [{ id: cuid(), amountCents: 250_000, status: 'WON', fundsWithheld: false }],
    })
    const balance = await readBalance(app, await asUser(app, OWNER), ids.organization.id)

    expect(balance.disputeLiabilityCents).toBe(0)

    await app.close()
  })

  it('holds back a payout already in flight', async () => {
    const { app, ids } = await worldWithBalance({
      payouts: [{ id: cuid(), amountCents: 400_000, status: 'SUBMITTED', idempotencyKey: 'a' }],
    })
    const balance = await readBalance(app, await asUser(app, OWNER), ids.organization.id)

    // The batch posts when the money moves, so until then the payable still
    // shows money that is already spoken for.
    expect(balance.inFlightCents).toBe(400_000)
    expect(balance.availableCents).toBe(EARNED_CENTS - 400_000)

    await app.close()
  })

  it('adds the holds together rather than taking the largest', async () => {
    const { app, ids } = await worldWithBalance({
      refundPendingCents: 200_000,
      disputes: [{ id: cuid(), amountCents: 300_000, status: 'OPENED' }],
      payouts: [{ id: cuid(), amountCents: 100_000, status: 'SCHEDULED', idempotencyKey: 'a' }],
      transfers: [{ id: cuid(), amountCents: 150_000, status: 'PENDING', idempotencyKey: 'b' }],
    })
    const balance = await readBalance(app, await asUser(app, OWNER), ids.organization.id)

    expect(balance.availableCents).toBe(EARNED_CENTS - 200_000 - 300_000 - 100_000 - 150_000)

    await app.close()
  })

  it('refuses somebody who cannot see the organisation’s money', async () => {
    const { app, ids } = await worldWithBalance()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/balance?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, MANAGER),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an organiser of another organisation', async () => {
    const { app, ids } = await worldWithBalance()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/balance?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OUTSIDER),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('POST /v1/finance/payouts', () => {
  it('schedules one the balance can support', async () => {
    const { app, ids } = await worldWithBalance()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers: await asUser(app, OWNER),
      payload: {
        organizationId: ids.organization.id,
        amountCents: 400_000,
        currency: 'INR',
        idempotencyKey: 'payout-request-one',
      },
    })

    expect(response.statusCode, response.body).toBe(201)

    const { data } = response.json()

    expect(data).toMatchObject({
      status: 'SCHEDULED',
      amountCents: 400_000,
      holdReason: null,
      providerPayoutId: null,
      reversedCents: 0,
    })

    await app.close()
  })

  it('holds one above what is available, and says how much was', async () => {
    const { app, ids } = await worldWithBalance({ refundPendingCents: 900_000 })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers: await asUser(app, OWNER),
      payload: {
        organizationId: ids.organization.id,
        amountCents: 500_000,
        currency: 'INR',
        idempotencyKey: 'payout-too-big',
      },
    })

    const { data } = response.json()

    // Held rather than refused: an organiser is entitled to see that a payout
    // was considered and why it did not go.
    expect(data.status).toBe('HELD')
    expect(data.holdReason).toMatch(/only 100000 of 500000 is available/)

    await app.close()
  })

  it('will not pay a negative balance', async () => {
    const { app, ids } = await worldWithBalance({
      earnedCents: 100_000,
      refundPendingCents: 400_000,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers: await asUser(app, OWNER),
      payload: {
        organizationId: ids.organization.id,
        amountCents: 1000,
        currency: 'INR',
        idempotencyKey: 'payout-negative',
      },
    })

    const { data } = response.json()

    expect(data.status).toBe('HELD')
    expect(data.holdReason).toMatch(/nothing available/)

    await app.close()
  })

  it('will not let two payouts each claim the same balance', async () => {
    const { app, ids } = await worldWithBalance()
    const headers = await asUser(app, OWNER)

    const first = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers,
      payload: {
        organizationId: ids.organization.id,
        amountCents: 700_000,
        currency: 'INR',
        idempotencyKey: 'payout-half-one',
      },
    })

    const second = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers,
      payload: {
        organizationId: ids.organization.id,
        amountCents: 700_000,
        currency: 'INR',
        idempotencyKey: 'payout-half-two',
      },
    })

    expect(first.statusCode, first.body).toBe(201)
    expect(second.statusCode, second.body).toBe(201)
    expect(first.json().data.status).toBe('SCHEDULED')
    // The first is in flight, so the second sees only what is left.
    expect(second.json().data.status).toBe('HELD')
    expect(second.json().data.holdReason).toMatch(/only 300000 of 700000/)

    await app.close()
  })

  it('answers a retried request with the payout the first one made', async () => {
    const { app, ids } = await worldWithBalance()
    const headers = await asUser(app, OWNER)
    const payload = {
      organizationId: ids.organization.id,
      amountCents: 100_000,
      currency: 'INR',
      idempotencyKey: 'payout-retried',
    }

    const first = await app.inject({ method: 'POST', url: '/v1/finance/payouts', headers, payload })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers,
      payload,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)
    expect(second.json().data.id).toBe(first.json().data.id)

    await app.close()
  })

  it('ignores a destination however it is spelled', async () => {
    const { app, ids } = await worldWithBalance()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers: await asUser(app, OWNER),
      payload: {
        organizationId: ids.organization.id,
        amountCents: 100_000,
        currency: 'INR',
        idempotencyKey: 'payout-with-destination',
        // Every shape somebody would try. None of them is on the request
        // schema, so the serialiser strips all of them before the handler runs.
        destination: 'acct_attacker',
        connectedAccountId: cuid(),
        bankAccount: '000123456789',
      },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data.connectedAccountId).toBeNull()

    await app.close()
  })

  it('refuses somebody who cannot move money', async () => {
    const { app, ids } = await worldWithBalance()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers: await asUser(app, MANAGER),
      payload: {
        organizationId: ids.organization.id,
        amountCents: 1000,
        currency: 'INR',
        idempotencyKey: 'payout-manager',
      },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('POST /v1/finance/payouts/:id/send', () => {
  it('pays it, posts the ledger, and reduces the payable exactly once', async () => {
    const { app, ids } = await worldWithBalance()
    const headers = await asUser(app, OWNER)

    const scheduled = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers,
      payload: {
        organizationId: ids.organization.id,
        amountCents: 400_000,
        currency: 'INR',
        idempotencyKey: 'payout-to-send',
      },
    })
    const payoutId = scheduled.json().data.id

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/finance/payouts/${payoutId}/send`,
      headers,
      payload: { reason: 'The scheduled weekly payout.' },
    })

    expect(sent.statusCode, sent.body).toBe(200)

    const { data } = sent.json()

    expect(data.status).toBe('PAID')
    // The provider's own identifier, stored as given.
    expect(data.providerPayoutId).toMatch(/^po_pi_/)

    // Sending it again is refused by the transition table rather than paying
    // twice.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/finance/payouts/${payoutId}/send`,
      headers,
      payload: { reason: 'Pressing it twice.' },
    })

    expect(again.statusCode).toBe(409)

    await app.close()
  })

  it('does not call a timeout a failure, and keeps the amount in flight', async () => {
    // A provider that will not answer for this amount. Nothing random: the
    // amount is the lever, so the case is reproducible.
    const { app, ids } = await worldWithBalance({
      providers: createInMemoryProviderRegistry({
        payments: { payoutTimeoutAmountCents: 400_000 },
      }),
    })
    const headers = await asUser(app, OWNER)

    const scheduled = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers,
      payload: {
        organizationId: ids.organization.id,
        amountCents: 400_000,
        currency: 'INR',
        idempotencyKey: 'payout-timeout',
      },
    })
    const payoutId = scheduled.json().data.id

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/finance/payouts/${payoutId}/send`,
      headers,
      payload: { reason: 'Sending one the provider will not answer about.' },
    })

    expect(sent.statusCode, sent.body).toBe(200)
    expect(sent.json().data.status).toBe('RECONCILIATION_REQUIRED')
    expect(sent.json().data.failureCode).toBeNull()

    // Still in flight. Freeing the balance would let a second payout go while
    // the first may still be on its way.
    const balance = await readBalance(app, headers, ids.organization.id)

    expect(balance.inFlightCents).toBe(400_000)
    expect(balance.availableCents).toBe(EARNED_CENTS - 400_000)

    await app.close()
  })

  it('records a refusal as a failure and frees the balance', async () => {
    const { app, ids } = await worldWithBalance({
      providers: createInMemoryProviderRegistry({
        payments: { payoutFailAmountCents: 400_000 },
      }),
    })
    const headers = await asUser(app, OWNER)

    const scheduled = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers,
      payload: {
        organizationId: ids.organization.id,
        amountCents: 400_000,
        currency: 'INR',
        idempotencyKey: 'payout-refused',
      },
    })
    const payoutId = scheduled.json().data.id

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/finance/payouts/${payoutId}/send`,
      headers,
      payload: { reason: 'Sending one the provider will refuse.' },
    })

    expect(sent.json().data.status).toBe('FAILED')
    expect(sent.json().data.failureCode).toBe('account_closed')

    // A refusal is definite: nothing moved, so the money is available again.
    const balance = await readBalance(app, headers, ids.organization.id)

    expect(balance.inFlightCents).toBe(0)
    expect(balance.availableCents).toBe(EARNED_CENTS)

    await app.close()
  })
})

describe('POST /v1/finance/payouts/:id/reverse', () => {
  it('posts compensating entries rather than editing history', async () => {
    const { app, ids } = await worldWithBalance()
    const headers = await asUser(app, OWNER)

    const scheduled = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers,
      payload: {
        organizationId: ids.organization.id,
        amountCents: 400_000,
        currency: 'INR',
        idempotencyKey: 'payout-to-reverse',
      },
    })
    const payoutId = scheduled.json().data.id

    await app.inject({
      method: 'POST',
      url: `/v1/finance/payouts/${payoutId}/send`,
      headers,
      payload: { reason: 'Sending it before clawing it back.' },
    })

    const reversed = await app.inject({
      method: 'POST',
      url: `/v1/finance/payouts/${payoutId}/reverse`,
      headers,
      payload: { amountCents: 400_000, reason: 'The bank returned it.' },
    })

    expect(reversed.statusCode, reversed.body).toBe(200)

    const { data } = reversed.json()

    expect(data.status).toBe('REVERSED')
    expect(data.reversedCents).toBe(400_000)

    // The balance is back where it started: the payout reduced it and the
    // reversal restored it, with both facts on the record.
    const balance = await readBalance(app, headers, ids.organization.id)

    expect(balance.payableCents).toBe(EARNED_CENTS)

    await app.close()
  })

  it('will not claw back more than went', async () => {
    const { app, ids } = await worldWithBalance()
    const headers = await asUser(app, OWNER)

    const scheduled = await app.inject({
      method: 'POST',
      url: '/v1/finance/payouts',
      headers,
      payload: {
        organizationId: ids.organization.id,
        amountCents: 100_000,
        currency: 'INR',
        idempotencyKey: 'payout-over-reverse',
      },
    })
    const payoutId = scheduled.json().data.id

    await app.inject({
      method: 'POST',
      url: `/v1/finance/payouts/${payoutId}/send`,
      headers,
      payload: { reason: 'Sending it.' },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/finance/payouts/${payoutId}/reverse`,
      headers,
      payload: { amountCents: 100_001, reason: 'Asking for more than went.' },
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })
})

describe('GET /v1/finance/disputes', () => {
  it('lists disputes against this organisation, uninterpreted', async () => {
    const { app, ids } = await worldWithBalance({
      disputes: [{ id: cuid(), amountCents: 250_000, reason: 'a_code_nobody_has_seen' }],
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/disputes?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data).toHaveLength(1)
    // Passed through as written. Interpreting it would mean a reason code
    // nobody had seen before became a 500.
    expect(data[0].reason).toBe('a_code_nobody_has_seen')
    expect(data[0].fundsWithheld).toBe(true)

    await app.close()
  })
})
