/**
 * Transfers settling and coming back, and disputes opening and closing.
 *
 * `finance.test.js` drives these through their routes, which is where the
 * authorization and the step-up live. This file drives the four domain
 * functions the **webhook path** reaches — `settleTransfer`, `reverseTransfer`,
 * `openDispute` and `resolveDispute` — which no route calls and which therefore
 * had no test of their own.
 *
 * That gap was found by a coverage threshold rather than by reading the code,
 * which is the argument for having the threshold.
 *
 * The properties are the ones that cost somebody money:
 *
 *   - **A reversal posts a compensating batch.** The original is never edited,
 *     so the ledger says the money went and then came back.
 *   - **A partial reversal is still a transfer that happened.** It stays PAID
 *     with `reversedCents` set; calling it REVERSED would say the whole amount
 *     came back.
 *   - **Two reversals cannot together take back more than was sent**, and the
 *     update is conditional on the counter rather than only on the status.
 *   - **Opening a dispute twice holds the money once.** A dispute webhook is
 *     redelivered as a matter of routine.
 *   - **Nothing invents a provider identifier** to make a row look finished.
 *
 * @module @desi-event/api/tests/transfers-disputes
 */

import { describe, expect, it } from 'vitest'

import { ACCOUNTS, CREDIT, DEBIT } from '@desi-event/ledger'

import { openDispute, resolveDispute, reverseTransfer, settleTransfer } from '../src/lib/payouts.js'
import { createTestApp } from './helpers/app.js'
import { LEDGER_ACCOUNTS, makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** The instant every case uses, so nothing depends on when it ran. */
const NOW = new Date('2026-09-10T12:00:00Z')

/** What a transfer in these cases is worth. */
const TRANSFER_CENTS = 400_000

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
 * A world with a payment, and whatever transfer or dispute rows a case needs.
 *
 * @param {object} [options] Options.
 * @param {Array<object>} [options.transfers] Transfer rows to seed.
 * @param {Array<object>} [options.disputes] Dispute rows to seed.
 * @returns {Promise<object>} The prisma stub, the ids, and the seeded rows.
 */
async function world({ transfers = [], disputes = [] } = {}) {
  const base = await makeWorld()
  const { seed, ids } = base
  const paymentId = cuid()
  const orderId = cuid()

  seed.order = [
    {
      id: orderId,
      reference: 'DE-TRF001',
      eventId: ids.publishedEvent.id,
      eventSessionId: null,
      userId: ids.attendee.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: TRANSFER_CENTS,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: TRANSFER_CENTS,
      refundedCents: 0,
      refundPendingCents: 0,
      paidAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]

  seed.payment = [
    {
      id: paymentId,
      orderId,
      provider: 'in-memory-payments',
      providerRef: 'pi_trf_0001',
      status: 'SUCCEEDED',
      amountCents: TRANSFER_CENTS,
      currency: 'INR',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]

  seed.transfer = transfers.map((transfer) => ({
    id: cuid(),
    organizationId: ids.organization.id,
    connectedAccountId: null,
    orderId,
    provider: 'in-memory-payments',
    providerTransferId: null,
    amountCents: TRANSFER_CENTS,
    currency: 'INR',
    status: 'SUBMITTED',
    reversedCents: 0,
    failureCode: null,
    rawProviderStatus: null,
    settledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...transfer,
  }))

  seed.dispute = disputes.map((dispute) => ({
    id: cuid(),
    paymentId,
    provider: 'in-memory-payments',
    providerDisputeId: `dp_${cuid()}`,
    amountCents: 150_000,
    currency: 'INR',
    reason: 'product_not_received',
    status: 'OPENED',
    evidenceDueAt: null,
    rawProviderStatus: null,
    fundsWithheld: true,
    closedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...dispute,
  }))

  const harness = await createTestApp({ seed, ids })

  return {
    ...harness,
    ids,
    paymentId,
    orderId,
    transfer: seed.transfer[0] ?? null,
    dispute: seed.dispute[0] ?? null,
  }
}

/**
 * Every posted batch for one source row, newest last.
 *
 * @param {object} prisma The stub.
 * @param {string} sourceType `TRANSFER` or `DISPUTE`.
 * @param {string} sourceId Which row.
 * @returns {Promise<Array<object>>} The batches.
 */
async function batchesFor(prisma, sourceType, sourceId) {
  return prisma.ledgerBatch.findMany({ where: { sourceType, sourceId } })
}

/**
 * The entries of a batch, so a test can name the accounts rather than a total.
 *
 * @param {object} prisma The stub.
 * @param {string} batchId Which batch.
 * @returns {Promise<Array<object>>} The entries.
 */
async function entriesFor(prisma, batchId) {
  return prisma.ledgerEntry.findMany({ where: { batchId } })
}

describe('settleTransfer', () => {
  it('moves a submitted transfer to paid and posts a balanced batch', async () => {
    const { prisma, transfer } = await world({ transfers: [{}] })

    const result = await settleTransfer(prisma, {
      transfer,
      result: { providerTransferId: 'tr_abc123', rawStatus: 'paid' },
      now: NOW,
    })

    expect(result).toEqual({ settled: true })

    const after = await prisma.transfer.findUnique({ where: { id: transfer.id } })

    expect(after.status).toBe('PAID')
    expect(after.providerTransferId).toBe('tr_abc123')
    expect(after.settledAt).toEqual(NOW)

    const [batch] = await batchesFor(prisma, 'TRANSFER', transfer.id)

    expect(batch.kind).toBe('TRANSFER')
    expect(batch.status).toBe('POSTED')
    expect(batch.debitCents).toBe(batch.creditCents)
    expect(batch.debitCents).toBe(TRANSFER_CENTS)

    const entries = await entriesFor(prisma, batch.id)
    const debit = entries.find((entry) => entry.direction === DEBIT)
    const credit = entries.find((entry) => entry.direction === CREDIT)

    // What a transfer *is*: the organiser stops being owed it, and it is in
    // flight to their account.
    expect(debit.accountId).toBe(accountId(ACCOUNTS.ORGANIZER_PAYABLE))
    expect(credit.accountId).toBe(accountId(ACCOUNTS.TRANSFER_CLEARING))
  })

  it('records no provider identifier rather than inventing one', async () => {
    const { prisma, transfer } = await world({ transfers: [{}] })

    await settleTransfer(prisma, {
      transfer,
      result: { rawStatus: 'paid' },
      now: NOW,
    })

    const after = await prisma.transfer.findUnique({ where: { id: transfer.id } })

    expect(after.providerTransferId).toBeNull()
  })

  it('settles once when two callers race the same submitted transfer', async () => {
    const { prisma, transfer } = await world({ transfers: [{}] })

    // Both hold the row as they read it, which is what a redelivered webhook
    // and an operator pressing send look like from here.
    const [first, second] = await Promise.all([
      settleTransfer(prisma, { transfer, result: { rawStatus: 'paid' }, now: NOW }),
      settleTransfer(prisma, { transfer, result: { rawStatus: 'paid' }, now: NOW }),
    ])

    expect([first.settled, second.settled].filter(Boolean)).toHaveLength(1)
    expect(await batchesFor(prisma, 'TRANSFER', transfer.id)).toHaveLength(1)
  })
})

describe('reverseTransfer', () => {
  it('marks a whole reversal REVERSED and posts a compensating batch', async () => {
    const { prisma, transfer } = await world({ transfers: [{ status: 'PAID' }] })

    const result = await reverseTransfer(prisma, {
      transfer,
      amountCents: TRANSFER_CENTS,
      reason: 'the buyer was refunded after payout',
      now: NOW,
    })

    expect(result).toEqual({ reversed: true, whole: true })

    const after = await prisma.transfer.findUnique({ where: { id: transfer.id } })

    expect(after.status).toBe('REVERSED')
    expect(after.reversedCents).toBe(TRANSFER_CENTS)

    const [batch] = await batchesFor(prisma, 'TRANSFER', transfer.id)
    const entries = await entriesFor(prisma, batch.id)

    expect(batch.kind).toBe('TRANSFER_REVERSAL')
    expect(entries.find((entry) => entry.direction === DEBIT).accountId).toBe(
      accountId(ACCOUNTS.TRANSFER_CLEARING),
    )
    expect(entries.find((entry) => entry.direction === CREDIT).accountId).toBe(
      accountId(ACCOUNTS.ORGANIZER_PAYABLE),
    )
  })

  it('leaves a partly reversed transfer PAID, because it did happen', async () => {
    const { prisma, transfer } = await world({ transfers: [{ status: 'PAID' }] })

    const result = await reverseTransfer(prisma, {
      transfer,
      amountCents: 100_000,
      reason: 'partial refund',
      now: NOW,
    })

    expect(result).toEqual({ reversed: true, whole: false })

    const after = await prisma.transfer.findUnique({ where: { id: transfer.id } })

    expect(after.status).toBe('PAID')
    expect(after.reversedCents).toBe(100_000)
  })

  it('refuses more than is left, naming what is left', async () => {
    const { prisma, transfer } = await world({
      transfers: [{ status: 'PAID', reversedCents: 300_000 }],
    })

    await expect(
      reverseTransfer(prisma, {
        transfer,
        amountCents: 200_000,
        reason: 'too much',
        now: NOW,
      }),
    ).rejects.toMatchObject({ statusCode: 422 })

    const after = await prisma.transfer.findUnique({ where: { id: transfer.id } })

    expect(after.reversedCents).toBe(300_000)
    expect(await batchesFor(prisma, 'TRANSFER', transfer.id)).toHaveLength(0)
  })

  it.each([
    ['zero', 0],
    ['a negative amount', -1],
    ['a fraction of a cent', 1.5],
  ])('refuses %s', async (_name, amountCents) => {
    const { prisma, transfer } = await world({ transfers: [{ status: 'PAID' }] })

    await expect(
      reverseTransfer(prisma, { transfer, amountCents, reason: 'no', now: NOW }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('reverses nothing when the counter moved under the read', async () => {
    const { prisma, transfer } = await world({ transfers: [{ status: 'PAID' }] })

    // Somebody else reversed half while this caller held the row as it was.
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: { reversedCents: 200_000 },
    })

    const result = await reverseTransfer(prisma, {
      transfer,
      amountCents: 100_000,
      reason: 'stale',
      now: NOW,
    })

    expect(result).toEqual({ reversed: false, whole: false })

    const after = await prisma.transfer.findUnique({ where: { id: transfer.id } })

    // The other caller's reversal stands, and this one added nothing to it.
    expect(after.reversedCents).toBe(200_000)
  })

  it('keeps both facts when a transfer is paid and then clawed back', async () => {
    const { prisma, transfer } = await world({ transfers: [{}] })

    await settleTransfer(prisma, { transfer, result: { rawStatus: 'paid' }, now: NOW })

    const paid = await prisma.transfer.findUnique({ where: { id: transfer.id } })

    await reverseTransfer(prisma, {
      transfer: paid,
      amountCents: TRANSFER_CENTS,
      reason: 'clawed back',
      now: NOW,
    })

    const batches = await batchesFor(prisma, 'TRANSFER', transfer.id)

    // Two batches, not one edited. An organiser paid and then clawed back has a
    // right to see both events.
    expect(batches.map((batch) => batch.kind).sort()).toEqual(['TRANSFER', 'TRANSFER_REVERSAL'])
  })
})

describe('openDispute', () => {
  it('opens one, holds the funds, and posts the money out of payable', async () => {
    const { prisma, ids, paymentId } = await world()
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })

    const { dispute, created } = await openDispute(prisma, {
      payment,
      organizationId: ids.organization.id,
      providerDisputeId: 'dp_live_0001',
      amountCents: 150_000,
      currency: 'INR',
      reason: 'fraudulent',
      now: NOW,
    })

    expect(created).toBe(true)
    expect(dispute.status).toBe('OPENED')
    expect(dispute.fundsWithheld).toBe(true)

    const [batch] = await batchesFor(prisma, 'DISPUTE', dispute.id)
    const entries = await entriesFor(prisma, batch.id)

    expect(batch.kind).toBe('DISPUTE_OPENED')
    expect(entries.find((entry) => entry.direction === DEBIT).accountId).toBe(
      accountId(ACCOUNTS.ORGANIZER_PAYABLE),
    )
    expect(entries.find((entry) => entry.direction === CREDIT).accountId).toBe(
      accountId(ACCOUNTS.DISPUTE_CLEARING),
    )
  })

  it('holds the money once when the same chargeback is delivered twice', async () => {
    const { prisma, ids, paymentId } = await world()
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    const params = {
      payment,
      organizationId: ids.organization.id,
      providerDisputeId: 'dp_redelivered',
      amountCents: 150_000,
      currency: 'INR',
      now: NOW,
    }

    const first = await openDispute(prisma, params)
    const second = await openDispute(prisma, params)

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.dispute.id).toBe(first.dispute.id)
    expect(await batchesFor(prisma, 'DISPUTE', first.dispute.id)).toHaveLength(1)
  })
})

describe('resolveDispute', () => {
  it('returns the money to the organiser on a win', async () => {
    const { prisma, ids, dispute } = await world({ disputes: [{}] })

    const result = await resolveDispute(prisma, {
      dispute,
      organizationId: ids.organization.id,
      won: true,
      now: NOW,
    })

    expect(result).toEqual({ resolved: true })

    const after = await prisma.dispute.findUnique({ where: { id: dispute.id } })

    expect(after.status).toBe('WON')
    expect(after.fundsWithheld).toBe(false)
    expect(after.closedAt).toEqual(NOW)

    const [batch] = await batchesFor(prisma, 'DISPUTE', dispute.id)
    const entries = await entriesFor(prisma, batch.id)

    expect(batch.kind).toBe('DISPUTE_RESOLVED')
    expect(entries.find((entry) => entry.direction === CREDIT).accountId).toBe(
      accountId(ACCOUNTS.ORGANIZER_PAYABLE),
    )
  })

  it('sends the money out on a loss, and it does not return to payable', async () => {
    const { prisma, ids, dispute } = await world({ disputes: [{}] })

    await resolveDispute(prisma, {
      dispute,
      organizationId: ids.organization.id,
      won: false,
      now: NOW,
    })

    const after = await prisma.dispute.findUnique({ where: { id: dispute.id } })

    expect(after.status).toBe('LOST')
    expect(after.fundsWithheld).toBe(false)

    const [batch] = await batchesFor(prisma, 'DISPUTE', dispute.id)
    const entries = await entriesFor(prisma, batch.id)

    expect(
      entries.some((entry) => entry.accountId === accountId(ACCOUNTS.ORGANIZER_PAYABLE)),
      'a lost dispute credited the organiser',
    ).toBe(false)
  })

  it('resolves once when the same outcome arrives twice', async () => {
    const { prisma, ids, dispute } = await world({ disputes: [{}] })
    const params = { dispute, organizationId: ids.organization.id, won: true, now: NOW }

    const [first, second] = await Promise.all([
      resolveDispute(prisma, params),
      resolveDispute(prisma, params),
    ])

    expect([first.resolved, second.resolved].filter(Boolean)).toHaveLength(1)
    expect(await batchesFor(prisma, 'DISPUTE', dispute.id)).toHaveLength(1)
  })

  it('refuses an outcome the table does not allow', async () => {
    const { prisma, ids, dispute } = await world({ disputes: [{ status: 'CLOSED' }] })

    await expect(
      resolveDispute(prisma, {
        dispute,
        organizationId: ids.organization.id,
        won: true,
        now: NOW,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})
