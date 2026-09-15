/**
 * A paid order posts a balanced ledger batch, in the same transaction.
 *
 * Before this, a successful checkout issued tickets, decremented inventory and
 * recorded a payment — and the ledger, which the schema has enforced since the
 * Phase 2 migration, stayed empty. A payment with no ledger entry is money the
 * business cannot see.
 *
 * The assertions are about the *shape* of the split as much as its arithmetic.
 * A marketplace that credits the ticket price to its own revenue balances
 * perfectly and overstates itself by the whole of every ticket sold, so the
 * account each amount lands in is the thing worth pinning down.
 */

import { describe, expect, it } from 'vitest'

import { computeOrderTotals } from '@desi-event/pricing'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { ACCOUNTS } from '@desi-event/ledger'

import { createTestApp, feeConfig, holdHeaders, taxRateBps } from './helpers/app.js'

/** Face value of the General Admission tier in the fixtures. */
const GA_PRICE = 150_000

/**
 * What a one-ticket order comes to.
 *
 * Derived from the same functions the route uses, so the decline trigger below
 * cannot silently stop declining when the fee or tax configuration moves — which
 * is exactly what happened to this suite's neighbour once already.
 *
 * @returns {number} The total in minor units.
 */
function oneTicketTotal() {
  return computeOrderTotals({
    items: [{ ticketTypeId: 'ga', quantity: 1, unitPriceCents: GA_PRICE, name: 'General' }],
    promoCode: null,
    feeConfig: feeConfig('INR'),
    taxRateBps: taxRateBps('IN'),
    currency: 'INR',
    now: new Date(),
  }).totalCents
}

/**
 * Take a hold.
 *
 * @param {object} app The Fastify instance.
 * @param {string} ticketTypeId The tier.
 * @param {number} quantity How many.
 * @returns {Promise<object>} The hold.
 */
async function takeHold(app, ticketTypeId, quantity) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/holds',
    payload: { ticketTypeId, quantity },
  })

  expect(response.statusCode).toBe(201)

  return response.json().data
}

/**
 * Buy tickets and return the order.
 *
 * @param {object} app The Fastify instance.
 * @param {object} ids Fixture ids.
 * @param {number} [quantity] How many.
 * @returns {Promise<object>} The created order.
 */
async function buy(app, ids, quantity = 1) {
  const hold = await takeHold(app, ids.generalAdmission.id, quantity)

  const response = await app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: holdHeaders(hold),
    payload: {
      eventId: ids.publishedEvent.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity }],
      holdIds: [hold.id],
    },
  })

  expect(response.statusCode).toBe(201)

  return response.json().data
}

/**
 * The batch posted for an order, with its entries resolved to account codes.
 *
 * @param {object} prisma The stub client.
 * @param {string} orderId The order.
 * @returns {Promise<{batch: object, byAccount: Map<string, object>}|null>} The batch.
 */
async function ledgerFor(prisma, orderId) {
  const batch = await prisma.ledgerBatch.findFirst({
    where: { sourceType: 'ORDER', sourceId: orderId },
    include: { entries: true },
  })

  if (!batch) return null

  const accounts = await prisma.ledgerAccount.findMany({})
  const codeById = new Map(accounts.map((row) => [row.id, row.code]))
  const byAccount = new Map(batch.entries.map((line) => [codeById.get(line.accountId), line]))

  return { batch, byAccount }
}

describe('a paid order', () => {
  it('posts one balanced batch', async () => {
    const { app, prisma, ids } = await createTestApp()
    const placed = await buy(app, ids)

    const { batch } = await ledgerFor(prisma, placed.id)

    expect(batch).toBeTruthy()
    expect(batch.status).toBe('POSTED')
    expect(batch.kind).toBe('ORDER_PAID')
    expect(batch.debitCents).toBe(batch.creditCents)

    await app.close()
  })

  it('debits what the buyer paid, and nothing else', async () => {
    const { app, prisma, ids } = await createTestApp()
    const placed = await buy(app, ids)

    const { byAccount } = await ledgerFor(prisma, placed.id)
    const clearing = byAccount.get(ACCOUNTS.PROCESSOR_CLEARING)

    expect(clearing.direction).toBe('DEBIT')
    expect(clearing.amountCents).toBe(placed.totalCents)

    await app.close()
  })

  it('credits the organiser a liability and the platform only its fee', async () => {
    const { app, prisma, ids } = await createTestApp()
    const placed = await buy(app, ids)

    const { byAccount } = await ledgerFor(prisma, placed.id)

    expect(byAccount.get(ACCOUNTS.ORGANIZER_PAYABLE)).toMatchObject({
      direction: 'CREDIT',
      amountCents: placed.subtotalCents,
    })
    expect(byAccount.get(ACCOUNTS.PLATFORM_FEE_REVENUE)).toMatchObject({
      direction: 'CREDIT',
      amountCents: placed.feesCents,
    })

    // The whole point, stated as an assertion: what the buyer paid is not the
    // platform's revenue. Only the fee is.
    expect(byAccount.get(ACCOUNTS.PLATFORM_FEE_REVENUE).amountCents).toBeLessThan(placed.totalCents)

    await app.close()
  })

  it('credits tax to a liability rather than to revenue', async () => {
    const { app, prisma, ids } = await createTestApp()
    const placed = await buy(app, ids)

    const { byAccount } = await ledgerFor(prisma, placed.id)

    expect(byAccount.get(ACCOUNTS.TAX_PAYABLE)).toMatchObject({
      direction: 'CREDIT',
      amountCents: placed.taxCents,
    })

    await app.close()
  })

  it('links the batch to the order and the payment', async () => {
    const { app, prisma, ids } = await createTestApp()
    const placed = await buy(app, ids)

    const { batch } = await ledgerFor(prisma, placed.id)
    const payments = await prisma.payment.findMany({ where: { orderId: placed.id } })

    expect(batch.orderId).toBe(placed.id)
    expect(batch.paymentId).toBe(payments[0]?.id ?? null)

    await app.close()
  })

  it('tags every line with the organisation, so settlement needs no join', async () => {
    const { app, prisma, ids } = await createTestApp()
    const placed = await buy(app, ids)

    const { batch } = await ledgerFor(prisma, placed.id)

    for (const line of batch.entries) {
      expect(line.organizationId).toBe(ids.organization.id)
    }

    await app.close()
  })

  it('posts exactly one batch however many tickets are on the order', async () => {
    const { app, prisma, ids } = await createTestApp()
    const placed = await buy(app, ids, 3)

    const batches = await prisma.ledgerBatch.findMany({
      where: { sourceType: 'ORDER', sourceId: placed.id },
    })

    expect(batches).toHaveLength(1)

    await app.close()
  })

  it('the entries add up to what the order says it charged', async () => {
    const { app, prisma, ids } = await createTestApp()
    const placed = await buy(app, ids, 2)

    const { batch } = await ledgerFor(prisma, placed.id)
    const debits = batch.entries
      .filter((line) => line.direction === 'DEBIT')
      .reduce((total, line) => total + line.amountCents, 0)

    // Not a tautology against the batch's own stored totals: this recomputes
    // from the entries and compares against the *order*, which is the number the
    // buyer was actually charged.
    expect(debits).toBe(placed.totalCents)

    await app.close()
  })
})

describe('a declined order', () => {
  it('posts nothing, because no money moved', async () => {
    // The mock provider declines a magic amount, so the decline is triggered by
    // configuring that amount to be exactly what this order comes to.
    const providers = createInMemoryProviderRegistry({
      payments: { declineAmountCents: oneTicketTotal() },
    })
    const { app, prisma, ids } = await createTestApp({ providers })
    const hold = await takeHold(app, ids.generalAdmission.id, 1)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: holdHeaders(hold),
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
        holdIds: [hold.id],
      },
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)

    // Nothing at all — not a draft, not a void batch. A decline means the money
    // never moved, so there is nothing for the ledger to record.
    const batches = await prisma.ledgerBatch.findMany({})

    expect(batches).toHaveLength(0)

    await app.close()
  })
})
