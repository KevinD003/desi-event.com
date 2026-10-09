/**
 * Refunds of orders that carry a fee, tax and a promo code, on real PostgreSQL.
 *
 * Every paid USD order carries the 99¢ flat fee, so a refund path proven only on
 * fee-free orders is not proven. Before this repair a full refund in the amount
 * form spread fee and tax onto the order lines, past the CHECK
 * `order_item_refund_within_line`, and failed in settlement after the provider
 * had paid; on a discounted order it withdrew too few tickets; a declined or
 * failed refund approved again settled into a negative `refundPendingCents`;
 * event cancellation wrote refunds that reserved nothing and could never
 * settle; a payment captured on a closed order was lost; and a disputed payment
 * could be refunded on top of its chargeback. Each case below is one of those,
 * driven through the routes (`refunds.request` → `approve` → `submit`, MOCK
 * payments) against orders priced by `computeOrderTotals` in
 * `helpers/fee-orders.js`: 2 × $50 and 1 × $20, 50 % off, the 99¢ fee per
 * ticket and 825 basis points of tax — $72.00.
 *
 * Cases 14 onwards are the review of that repair: a line given more than the
 * tickets it withdrew, requests decided on a copy of the order read before the
 * lock, a refund worked out before the repair and sent after it, the ledger of
 * a late payment's refund and of a discounted order's, a dispute opened after
 * the request, a withdrawal racing a repair, and two settlements finishing an
 * order from one stale read.
 *
 * Runs against `TEST_DATABASE_URL`; `REQUIRE_DATABASE=1` turns an unreachable
 * database into a failure. Nothing is cleaned up: the ledger and the audit
 * trail are append-only, and every row carries this run's tag.
 *
 * @module @desi-event/api/tests/refund-fees-integration
 */

import {
  PROVIDER_ERROR_CODES,
  ProviderError,
  createInMemoryProviderRegistry,
  createProviderRegistry,
} from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { availableBalance, openDispute } from '../src/lib/payouts.js'
import { VERDICTS, applyVerdict, loadTaskContext } from '../src/lib/reconciliation.js'
import {
  allocateAcrossLines,
  cancelRefund,
  markSubmitted,
  orderParts,
  refundPartsFor,
  requestRefund,
  settleRefund,
  splitRefund,
} from '../src/lib/refunds.js'
import { startSession } from '../src/lib/sessions.js'
import { dispatchDelivery, lateCaptureLedgerKey } from '../src/lib/webhook-handlers.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'
import {
  FEE_ORDER_CURRENCY,
  FEE_ORDER_LINES,
  createFeeEvent,
  createFeeOrder,
  priceFeeOrder,
} from './helpers/fee-orders.js'
import { holdRow, untilWaiting } from './helpers/row-locks.js'

const { prisma, reachable, when } = await connectTestDatabase('the refund fees suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the pass deriver, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

/**
 * The in-memory provider, with a one-shot lever on its refunds.
 *
 * Every fee order costs the same, so the provider's own amount levers would
 * refuse every refund of a whole order at once. This lever refuses the next
 * refund only, with the same `ProviderError` the in-memory provider throws, and
 * then gets out of the way: a refund that is refused once and settles on the
 * retry is the case under test.
 */
const base = createInMemoryProviderRegistry({ payments: { idPrefix: `pifee${RUN}` } })
const lever = { next: null }
const payments = Object.freeze({
  ...base.payments,
  refund: (reference, options) => {
    const outcome = lever.next

    lever.next = null

    if (outcome === 'DECLINE') {
      throw new ProviderError(PROVIDER_ERROR_CODES.PAYMENT_DECLINED, 'Refused by the suite', {
        provider: base.payments.name,
        details: { failureCode: 'refund_declined' },
      })
    }

    if (outcome === 'TIMEOUT') {
      throw new ProviderError(PROVIDER_ERROR_CODES.PAYMENT_TIMEOUT, 'Not answered by the suite', {
        provider: base.payments.name,
      })
    }

    if (outcome === 'FAIL') {
      throw new ProviderError(PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE, 'Down for the suite', {
        provider: base.payments.name,
      })
    }

    return base.payments.refund(reference, options)
  },
})
const providers = createProviderRegistry({ ...base, payments })

let app
let owner
let headers
let tagSequence = 0

/**
 * A tag unique to this run and this call, for slugs and references.
 *
 * @param {string} label What it is for.
 * @returns {string} Lower-case letters and digits.
 */
function tag(label) {
  tagSequence += 1

  return `${label}${RUN}${tagSequence.toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '')
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers,
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  })
  await app.ready()

  owner = await prisma.user.create({
    data: {
      email: `owner-${RUN}@fee-refunds.example`,
      displayName: 'Fee Owner',
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role: 'ORGANIZER',
      emailVerified: true,
    },
  })

  await prisma.mfaFactor.create({
    data: {
      userId: owner.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

/**
 * A fee event owned by an organisation the suite's owner runs, with a fresh
 * session whose second factor is confirmed now (every refund route asks for a
 * `FINANCE_ACTION` step-up, and the event cancel for `EVENT_CANCEL`).
 *
 * @param {string} label Distinguishes the event.
 * @returns {Promise<object>} The world from `createFeeEvent`.
 */
async function feeWorld(label) {
  const world = await createFeeEvent(prisma, { tag: tag(label) })

  await prisma.membership.create({
    data: { userId: owner.id, organizationId: world.organization.id, role: 'OWNER' },
  })

  const memberships = await prisma.membership.findMany({ where: { userId: owner.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: owner.id, role: owner.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'refund-fees-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  headers = { authorization: `Bearer ${secret}` }

  return world
}

/**
 * A paid fee order in a world.
 *
 * @param {object} world From {@link feeWorld}.
 * @param {object} [options] Passed to `createFeeOrder`.
 * @returns {Promise<object>} `{ order, payment, totals, tickets }`.
 */
function feeOrder(world, options = {}) {
  return createFeeOrder(prisma, world, {
    tag: tag('order'),
    payments,
    credentialSecret: SECRET,
    ...options,
  })
}

/**
 * Call a route as the owner.
 *
 * @param {string} method The HTTP method.
 * @param {string} url The path.
 * @param {object} [payload] The body.
 * @returns {Promise<object>} The response.
 */
function call(method, url, payload) {
  return app.inject({ method, url, headers, ...(payload ? { payload } : {}) })
}

/**
 * Ask for a refund through `refunds.request`.
 *
 * @param {object} order The order.
 * @param {object} body `amountCents` or `lines`.
 * @returns {Promise<object>} The response.
 */
function ask(order, body) {
  return call('POST', `/v1/orders/${order.reference}/refunds`, {
    reason: 'CUSTOMER_REQUEST',
    idempotencyKey: `fee-refund-${tag('key')}`,
    ...body,
  })
}

/**
 * Approve a refund through `refunds.approve`.
 *
 * @param {string} id The refund.
 * @returns {Promise<object>} The response.
 */
function approve(id) {
  return call('POST', `/v1/refunds/${id}/approve`, { reason: 'Policy allows it.' })
}

/**
 * Send a refund through `refunds.submit`.
 *
 * @param {string} id The refund.
 * @returns {Promise<object>} The response.
 */
function submit(id) {
  return call('POST', `/v1/refunds/${id}/submit`, { reason: 'Approved and sent.' })
}

/**
 * Ask, approve and send; each step must succeed.
 *
 * @param {object} order The order.
 * @param {object} body `amountCents` or `lines`.
 * @returns {Promise<object>} The refund row as it ends.
 */
async function refundThrough(order, body) {
  const requested = await ask(order, body)

  expect(requested.statusCode, requested.body).toBe(201)

  const id = requested.json().data.id
  const approved = await approve(id)

  expect(approved.statusCode, approved.body).toBe(200)
  await expectSane(order.id)

  const submitted = await submit(id)

  expect(submitted.statusCode, submitted.body).toBe(200)
  expect(submitted.json().data.status).toBe('SUCCEEDED')

  return prisma.refund.findUnique({ where: { id }, include: { items: true } })
}

/**
 * The order and its lines, checked against every counter rule.
 *
 * The CHECK constraints would already have refused a write that broke these;
 * asserting them after every step says the path never tried.
 *
 * @param {string} orderId Which order.
 * @returns {Promise<object>} The order with its items.
 */
async function expectSane(orderId) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } })

  expect(order.refundedCents).toBeGreaterThanOrEqual(0)
  expect(order.refundPendingCents).toBeGreaterThanOrEqual(0)
  expect(order.refundedCents + order.refundPendingCents).toBeLessThanOrEqual(order.totalCents)

  for (const item of order.items) {
    expect(item.refundedCents).toBeGreaterThanOrEqual(0)
    expect(item.refundedCents).toBeLessThanOrEqual(item.subtotalCents)
    expect(item.refundedQuantity).toBeLessThanOrEqual(item.quantity)
  }

  return order
}

/**
 * The parts a settled refund's ledger batch posted.
 *
 * The organiser was credited the subtotal at checkout, with the discount
 * carried in `promotional_discount`; a refund takes back the face value it
 * returns plus the discount that face value carried, and credits the discount
 * account with the latter. `faceValueCents` is what the organiser gave back
 * net of that discount; `discountCents` is the discount reversed.
 *
 * @param {string} refundId Which refund.
 * @returns {Promise<{faceValueCents: number, discountCents: number, feeCents: number, taxCents: number, refundedCents: number}>} By account.
 */
async function ledgerParts(refundId) {
  const batch = await prisma.ledgerBatch.findFirst({
    where: { reference: `RF-${refundId}` },
    include: { entries: { include: { account: true } } },
  })

  expect(batch, 'the refund posted no ledger batch').toBeTruthy()

  const sum = (code, direction) =>
    batch.entries
      .filter((line) => line.account.code === code && line.direction === direction)
      .reduce((total, line) => total + line.amountCents, 0)

  return {
    faceValueCents: sum('organizer_payable', 'DEBIT') - sum('promotional_discount', 'CREDIT'),
    discountCents: sum('promotional_discount', 'CREDIT'),
    feeCents: sum('platform_fee_revenue', 'DEBIT'),
    taxCents: sum('tax_payable', 'DEBIT'),
    refundedCents: sum('refund_clearing', 'CREDIT'),
  }
}

/**
 * Add up the parts of several refunds' allocations.
 *
 * @param {Array<object>} refunds Refund rows.
 * @returns {{faceValueCents: number, feeCents: number, taxCents: number}} The sums.
 */
function sumAllocations(refunds) {
  return refunds.reduce(
    (total, refund) => ({
      faceValueCents: total.faceValueCents + refund.allocation.faceValueCents,
      feeCents: total.feeCents + refund.allocation.feeCents,
      taxCents: total.taxCents + refund.allocation.taxCents,
    }),
    { faceValueCents: 0, feeCents: 0, taxCents: 0 },
  )
}

/**
 * Every ticket on an order.
 *
 * @param {object} order The order, with items.
 * @returns {Promise<Array<object>>} The tickets.
 */
function ticketsOf(order) {
  return prisma.ticket.findMany({
    where: { orderItemId: { in: order.items.map((item) => item.id) } },
  })
}

/**
 * Write an unreserved cancellation refund the way event cancellation used to.
 *
 * `createMany` of a REQUESTED row for the order's whole total: no reservation,
 * no lines, no allocation.
 *
 * @param {object} world The fee world.
 * @param {object} paid From {@link feeOrder}.
 * @param {string} status `REQUESTED` or `APPROVED`.
 * @returns {Promise<object>} The row.
 */
function legacyRefund(world, paid, status) {
  return prisma.refund.create({
    data: {
      orderId: paid.order.id,
      paymentId: paid.payment.id,
      provider: paid.payment.provider,
      amountCents: paid.order.totalCents,
      currency: paid.order.currency,
      reason: 'EVENT_CANCELLED',
      reasonNote: 'The hall flooded.',
      status,
      requestedById: owner.id,
      idempotencyKey: `event-cancelled:${world.event.id}:${paid.order.id}`,
    },
  })
}

when()('the fee order the suite refunds', () => {
  it('is priced by computeOrderTotals with the fee, the tax and the promo code', async () => {
    const world = await feeWorld('pricing')
    const { order, totals } = await feeOrder(world)

    // $120.00 of tickets, half off: $60.00 of face value, a fee of 5.9 % plus
    // 99¢ a ticket, and 8.25 % tax on face value and fee.
    expect(totals).toMatchObject({
      currency: FEE_ORDER_CURRENCY,
      subtotalCents: 12_000,
      discountCents: 6_000,
      feesCents: 354 + 3 * 99,
      taxCents: 549,
      totalCents: 7_200,
    })
    expect(orderParts(order)).toEqual({ faceValueCents: 6_000, feeCents: 651, taxCents: 549 })
    expect(order.items.map((item) => item.quantity).sort()).toEqual(
      FEE_ORDER_LINES.map((line) => line.quantity).sort(),
    )
  })
})

when()('1. a whole refund in the amount form', () => {
  it('settles, gives back every part and withdraws every ticket', async () => {
    const world = await feeWorld('whole')
    const paid = await feeOrder(world)
    const parts = orderParts(paid.order)

    const refund = await refundThrough(paid.order, { amountCents: paid.order.totalCents })
    const after = await expectSane(paid.order.id)

    expect(after.status).toBe('REFUNDED')
    expect(after.refundedCents).toBe(after.totalCents)
    expect(after.refundPendingCents).toBe(0)

    // Each line gives back its face value net of its share of the discount,
    // and not a cent of fee or tax: those are the order's, in the allocation.
    const shares = { [world.tiers.floor.id]: 5_000, [world.tiers.balcony.id]: 1_000 }

    for (const item of after.items) {
      expect(item.refundedCents).toBe(item.subtotalCents - shares[item.ticketTypeId])
      expect(item.refundedCents).toBeLessThanOrEqual(item.subtotalCents)
      expect(item.refundedQuantity).toBe(item.quantity)
    }

    expect(refund.allocation).toEqual({ ...parts, form: 'whole', whole: true })

    // Every ticket, the discounted line's two included, is refunded and its
    // pass is dead.
    const tickets = await ticketsOf(after)

    expect(tickets).toHaveLength(3)
    expect(tickets.every((ticket) => ticket.status === 'REFUNDED')).toBe(true)
    expect(tickets.every((ticket) => ticket.credentialHash === null)).toBe(true)

    // The organiser gives back the whole subtotal they were credited — the
    // face value and the discount it carried — and the discount is reversed.
    expect(await ledgerParts(refund.id)).toEqual({
      ...parts,
      discountCents: paid.order.discountCents,
      refundedCents: after.totalCents,
    })
  })

  it('settles an order with a fee and no discount, whose fee would not fit on its lines', async () => {
    const world = await feeWorld('nopromo')
    const paid = await feeOrder(world, { withPromo: false })

    // $120.00 face value, $10.05 fee, $10.73 tax. Spread over the lines, the
    // fee and tax put the $100.00 line past its subtotal.
    expect(paid.order.discountCents).toBe(0)
    expect(paid.order.feesCents).toBeGreaterThan(0)

    const refund = await refundThrough(paid.order, { amountCents: paid.order.totalCents })
    const after = await expectSane(paid.order.id)

    expect(after.status).toBe('REFUNDED')

    for (const item of after.items) expect(item.refundedCents).toBe(item.subtotalCents)

    expect(await ledgerParts(refund.id)).toEqual({
      ...orderParts(paid.order),
      discountCents: 0,
      refundedCents: paid.order.totalCents,
    })
  })
})

when()('2. a partial amount, then the whole remainder', () => {
  it('adds up to exactly the order, never taking a counter below zero', async () => {
    const world = await feeWorld('partial')
    const paid = await feeOrder(world)

    const first = await refundThrough(paid.order, { amountCents: 3_000 })
    const middle = await expectSane(paid.order.id)

    expect(middle.refundedCents).toBe(3_000)
    expect(first.allocation.form).toBe('amount')

    const second = await refundThrough(paid.order, {
      amountCents: middle.totalCents - middle.refundedCents,
    })
    const after = await expectSane(paid.order.id)

    expect(second.allocation.form).toBe('whole')
    expect(after.status).toBe('REFUNDED')
    expect(after.refundedCents).toBe(after.totalCents)
    expect(sumAllocations([first, second])).toEqual(orderParts(paid.order))

    const tickets = await ticketsOf(after)

    expect(tickets.every((ticket) => ticket.status === 'REFUNDED')).toBe(true)
  })
})

when()('3. a partial amount worth less than one ticket', () => {
  it('withdraws no ticket and records the money on the order', async () => {
    const world = await feeWorld('moneyonly')
    const paid = await feeOrder(world)

    // $1.00. The cheapest ticket was paid $10.00 after the discount.
    const refund = await refundThrough(paid.order, { amountCents: 100 })

    expect(refund.items).toEqual([])

    const after = await expectSane(paid.order.id)
    const tickets = await ticketsOf(after)

    expect(tickets.every((ticket) => ticket.status === 'VALID')).toBe(true)
    expect(after.refundedCents).toBe(100)
    expect(after.items.every((item) => item.refundedCents === 0)).toBe(true)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'refund.requested', entityId: refund.id },
    })

    expect(audit.metadata.moneyOnlyCents).toBe(refund.allocation.faceValueCents)
    expect(audit.metadata.moneyOnlyCents).toBeGreaterThan(0)
  })
})

when()('4. refunds by ticket line', () => {
  it('return the tickets’ share of the fee and the tax, and add up to the order', async () => {
    const world = await feeWorld('lines')
    const paid = await feeOrder(world)
    const parts = orderParts(paid.order)
    const line = (tierId) => paid.order.items.find((item) => item.ticketTypeId === tierId)
    const balcony = line(world.tiers.balcony.id)
    const floor = line(world.tiers.floor.id)

    // The balcony ticket: $10.00 paid after the discount, and its share of
    // the fee and tax, floored — 1,000 of 6,000 of face value.
    const one = await refundThrough(paid.order, {
      lines: [{ orderItemId: balcony.id, quantity: 1 }],
    })

    expect(one.allocation).toMatchObject({
      faceValueCents: 1_000,
      feeCents: Math.floor((651 * 1_000) / 6_000),
      taxCents: Math.floor((549 * 1_000) / 6_000),
      form: 'lines',
    })
    expect(one.amountCents).toBe(
      one.allocation.faceValueCents + one.allocation.feeCents + one.allocation.taxCents,
    )

    const two = await refundThrough(paid.order, {
      lines: [{ orderItemId: floor.id, quantity: 1 }],
    })
    const remainder = await expectSane(paid.order.id)
    const three = await refundThrough(paid.order, {
      amountCents: remainder.totalCents - remainder.refundedCents,
    })
    const after = await expectSane(paid.order.id)

    expect(sumAllocations([one, two, three])).toEqual(parts)
    expect(after.status).toBe('REFUNDED')
    expect((await ticketsOf(after)).every((ticket) => ticket.status === 'REFUNDED')).toBe(true)
  })
})

when()('5. a declined refund approved again', () => {
  it('reserves again, and settles on the retry', async () => {
    const world = await feeWorld('declined')
    const paid = await feeOrder(world)
    const requested = await ask(paid.order, { amountCents: paid.order.totalCents })
    const id = requested.json().data.id

    expect((await approve(id)).statusCode).toBe(200)

    lever.next = 'DECLINE'

    const declined = await submit(id)

    expect(declined.statusCode, declined.body).toBe(200)
    expect(declined.json().data.status).toBe('DECLINED')
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(0)

    const again = await approve(id)

    expect(again.statusCode, again.body).toBe(200)
    expect(again.json().data.status).toBe('APPROVED')
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(paid.order.totalCents)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'refund.approved', entityId: id },
      orderBy: { createdAt: 'desc' },
    })

    expect(audit.metadata.reReserved).toBe(true)

    const settled = await submit(id)

    expect(settled.statusCode, settled.body).toBe(200)
    expect(settled.json().data.status).toBe('SUCCEEDED')

    const after = await expectSane(paid.order.id)

    expect(after.refundedCents).toBe(after.totalCents)
    expect(after.refundPendingCents).toBe(0)
  })
})

when()('6. a failed refund whose balance another refund took', () => {
  it('is refused REFUND_BALANCE_GONE and changes nothing', async () => {
    const world = await feeWorld('gone')
    const paid = await feeOrder(world)
    const requested = await ask(paid.order, { amountCents: paid.order.totalCents })
    const id = requested.json().data.id

    expect((await approve(id)).statusCode).toBe(200)

    lever.next = 'FAIL'

    const failed = await submit(id)

    expect(failed.json().data.status).toBe('FAILED')

    // Finance asks for part of it in the meantime.
    expect((await ask(paid.order, { amountCents: 500 })).statusCode).toBe(201)

    const before = await expectSane(paid.order.id)
    const refused = await approve(id)

    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json().error.code).toBe('REFUND_BALANCE_GONE')

    const after = await expectSane(paid.order.id)

    expect(after.refundPendingCents).toBe(before.refundPendingCents)
    expect(after.refundedCents).toBe(before.refundedCents)
    expect((await prisma.refund.findUnique({ where: { id } })).status).toBe('FAILED')
  })
})

when()('7. a timeout released by reconciliation, then approved again', () => {
  it('reserves again and settles', async () => {
    const world = await feeWorld('timeout')
    const paid = await feeOrder(world)
    const requested = await ask(paid.order, { amountCents: paid.order.totalCents })
    const id = requested.json().data.id

    expect((await approve(id)).statusCode).toBe(200)

    lever.next = 'TIMEOUT'

    const timedOut = await submit(id)

    expect(timedOut.json().data.status).toBe('TIMEOUT')
    // A timeout keeps the reservation: nobody knows whether the money moved.
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(paid.order.totalCents)

    const task = await prisma.reconciliationTask.findFirst({
      where: { refundId: id, kind: 'REFUND_UNKNOWN' },
    })

    // The provider is asked and says it never happened: RELEASE.
    await prisma.$transaction(async (tx) =>
      applyVerdict(tx, {
        context: await loadTaskContext(tx, task.id),
        verdict: VERDICTS.RELEASE,
        observed: { status: 'not_found' },
        actorId: owner.id,
        now: new Date(),
        organizationId: world.organization.id,
      }),
    )

    expect((await prisma.refund.findUnique({ where: { id } })).status).toBe('FAILED')
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(0)

    const again = await approve(id)

    expect(again.statusCode, again.body).toBe(200)
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(paid.order.totalCents)

    const settled = await submit(id)

    expect(settled.json().data.status).toBe('SUCCEEDED')
    expect((await expectSane(paid.order.id)).refundedCents).toBe(paid.order.totalCents)
  })
})

when()('8. cancelling an event on sale', () => {
  it('reserves every paid order’s refund, and approve and submit settle them', async () => {
    const world = await feeWorld('cancel')
    const first = await feeOrder(world)
    const second = await feeOrder(world)
    const disputed = await feeOrder(world)

    await prisma.dispute.create({
      data: {
        paymentId: disputed.payment.id,
        provider: disputed.payment.provider,
        providerDisputeId: `dp_${tag('cancel')}`,
        amountCents: disputed.order.totalCents,
        currency: FEE_ORDER_CURRENCY,
        status: 'NEEDS_RESPONSE',
      },
    })

    const cancelled = await call('POST', `/v1/events/${world.event.id}/cancel`, {
      reasonCode: 'VENUE_UNAVAILABLE',
      reason: 'The hall flooded.',
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    for (const paid of [first, second]) {
      const [refund] = await prisma.refund.findMany({
        where: { orderId: paid.order.id },
        include: { items: true },
      })

      // Reserved, with its lines and its split: a refund that can settle.
      expect(refund.status).toBe('REQUESTED')
      expect(refund.reason).toBe('EVENT_CANCELLED')
      expect(refund.allocation).toEqual({ ...orderParts(paid.order), form: 'whole', whole: true })
      expect(refund.items.map((item) => item.quantity).sort()).toEqual([1, 2])
      expect((await expectSane(paid.order.id)).refundPendingCents).toBe(paid.order.totalCents)
    }

    // The disputed order is left to the dispute.
    expect(await prisma.refund.count({ where: { orderId: disputed.order.id } })).toBe(0)

    // The organisation's balance holds the promised refunds back.
    const balance = await availableBalance(prisma, {
      organizationId: world.organization.id,
      currency: FEE_ORDER_CURRENCY,
    })

    expect(balance.refundLiabilityCents).toBe(first.order.totalCents + second.order.totalCents)

    for (const paid of [first, second]) {
      const refund = await prisma.refund.findFirst({ where: { orderId: paid.order.id } })

      expect((await approve(refund.id)).statusCode).toBe(200)

      const settled = await submit(refund.id)

      expect(settled.statusCode, settled.body).toBe(200)
      expect(settled.json().data.status).toBe('SUCCEEDED')

      const after = await expectSane(paid.order.id)

      expect(after.status).toBe('REFUNDED')
      expect((await ticketsOf(after)).every((ticket) => ticket.status === 'REFUNDED')).toBe(true)
    }
  })
})

when()('9. cancellation refunds written before refunds reserved', () => {
  it('are reserved in place by approve, and then settle', async () => {
    const world = await feeWorld('legacyapprove')
    const paid = await feeOrder(world)
    const legacy = await legacyRefund(world, paid, 'REQUESTED')

    const approved = await approve(legacy.id)

    expect(approved.statusCode, approved.body).toBe(200)
    expect(approved.json().data.id).toBe(legacy.id)

    const repaired = await prisma.refund.findUnique({
      where: { id: legacy.id },
      include: { items: true },
    })

    expect(repaired.status).toBe('APPROVED')
    expect(repaired.allocation).toEqual({ ...orderParts(paid.order), form: 'whole', whole: true })
    expect(repaired.items).toHaveLength(2)
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(paid.order.totalCents)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'refund.reservation_repaired', entityId: legacy.id },
    })

    expect(audit.metadata.mode).toBe('RESERVED')

    expect((await submit(legacy.id)).json().data.status).toBe('SUCCEEDED')
    expect((await expectSane(paid.order.id)).status).toBe('REFUNDED')
  })

  it('are reserved by submit: an approved one settles, a requested one is repaired and refused', async () => {
    const world = await feeWorld('legacysubmit')
    const approvedOne = await feeOrder(world)
    const requestedOne = await feeOrder(world)
    const legacyApproved = await legacyRefund(world, approvedOne, 'APPROVED')
    const legacyRequested = await legacyRefund(world, requestedOne, 'REQUESTED')

    const settled = await submit(legacyApproved.id)

    expect(settled.statusCode, settled.body).toBe(200)
    expect(settled.json().data.status).toBe('SUCCEEDED')

    const after = await expectSane(approvedOne.order.id)

    expect(after.status).toBe('REFUNDED')
    expect(after.refundPendingCents).toBe(0)
    expect((await ticketsOf(after)).every((ticket) => ticket.status === 'REFUNDED')).toBe(true)

    // Not approved, so not sendable — but the repair is kept.
    const refused = await submit(legacyRequested.id)

    expect(refused.statusCode).toBe(409)
    expect(
      (await prisma.refund.findUnique({ where: { id: legacyRequested.id } })).allocation,
    ).toMatchObject({ whole: true })
    expect((await expectSane(requestedOne.order.id)).refundPendingCents).toBe(
      requestedOne.order.totalCents,
    )
  })

  it('are replaced when the order has less left than they name', async () => {
    const world = await feeWorld('legacyshort')
    const paid = await feeOrder(world)

    // Finance refunded $5.00 of it after the event was cancelled.
    await refundThrough(paid.order, { amountCents: 500 })

    const legacy = await legacyRefund(world, paid, 'REQUESTED')
    const approved = await approve(legacy.id)

    expect(approved.statusCode, approved.body).toBe(200)

    const replacement = approved.json().data

    expect(replacement.id).not.toBe(legacy.id)
    expect(replacement.status).toBe('APPROVED')
    expect(replacement.amountCents).toBe(paid.order.totalCents - 500)

    const old = await prisma.refund.findUnique({ where: { id: legacy.id } })

    expect(old.status).toBe('CANCELLED')
    expect(old.reasonNote).toMatch(/^Replaced: the order had less left to refund/)
    expect((await prisma.refund.findUnique({ where: { id: replacement.id } })).idempotencyKey).toBe(
      `${legacy.idempotencyKey}:repaired`,
    )

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'refund.reservation_repaired', entityId: legacy.id },
    })

    expect(audit.metadata).toMatchObject({
      mode: 'REPLACED',
      legacyAmountCents: paid.order.totalCents,
      remainingCents: paid.order.totalCents - 500,
      replacementRefundId: replacement.id,
    })
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(paid.order.totalCents - 500)

    expect((await submit(replacement.id)).json().data.status).toBe('SUCCEEDED')

    const after = await expectSane(paid.order.id)

    expect(after.status).toBe('REFUNDED')
    expect(after.refundedCents).toBe(after.totalCents)
  })
})

when()('10. withdrawing a cancellation refund that reserved nothing', () => {
  it('leaves the order’s counters untouched', async () => {
    const world = await feeWorld('legacycancel')
    const paid = await feeOrder(world)

    // Another refund holds part of the order, so a wrong release shows.
    expect((await ask(paid.order, { amountCents: 700 })).statusCode).toBe(201)

    const legacy = await legacyRefund(world, paid, 'REQUESTED')
    const before = await expectSane(paid.order.id)
    const withdrawn = await call('POST', `/v1/refunds/${legacy.id}/cancel`, {
      reason: 'Asked for twice.',
    })

    expect(withdrawn.statusCode, withdrawn.body).toBe(200)
    expect(withdrawn.json().data.status).toBe('CANCELLED')

    const after = await expectSane(paid.order.id)

    expect(after.refundPendingCents).toBe(before.refundPendingCents)
    expect(after.refundedCents).toBe(before.refundedCents)
  })
})

when()('11. a payment that succeeds after its order was cancelled', () => {
  it('opens a PROVIDER_MISMATCH task, records no order.paid, and can be refunded', async () => {
    const world = await feeWorld('late')
    const items = FEE_ORDER_LINES.map((line) => ({
      ticketTypeId: world.tiers[line.key].id,
      quantity: line.quantity,
      unitPriceCents: line.priceCents,
    }))
    const totals = priceFeeOrder({ items, promoCode: world.promoCode })
    const intent = payments.createIntent({
      amountCents: totals.totalCents,
      currency: FEE_ORDER_CURRENCY,
    })

    payments.capture(intent.id)

    const order = await prisma.order.create({
      data: {
        reference: `DE-LATE${tag('r')}`.toUpperCase().slice(0, 32),
        eventId: world.event.id,
        buyerEmail: `late-${RUN}@fee-refunds.example`,
        buyerName: 'Late Buyer',
        // Cancelled while the payment was in flight.
        status: 'CANCELLED',
        cancelledAt: new Date(),
        currency: FEE_ORDER_CURRENCY,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        feesCents: totals.feesCents,
        feeGrossCents: totals.feeGrossCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        items: {
          create: totals.lineItems.map((line) => ({
            ticketTypeId: line.ticketTypeId,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            subtotalCents: line.subtotalCents,
          })),
        },
      },
    })
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: payments.name,
        providerRef: intent.id,
        status: 'PENDING',
        amountCents: totals.totalCents,
        currency: FEE_ORDER_CURRENCY,
      },
    })

    const result = await dispatchDelivery(prisma, {
      id: null,
      eventType: 'payment_intent.succeeded',
      accountContext: null,
      payload: {
        data: {
          object: {
            id: intent.id,
            amount: totals.totalCents,
            currency: 'usd',
            status: 'succeeded',
          },
        },
      },
    })

    expect(result.outcome).toBe('processed')
    expect((await prisma.payment.findUnique({ where: { id: payment.id } })).status).toBe(
      'SUCCEEDED',
    )
    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('CANCELLED')

    const task = await prisma.reconciliationTask.findFirst({
      where: { paymentId: payment.id, kind: 'PROVIDER_MISMATCH', state: 'OPEN' },
    })

    expect(task).toBeTruthy()
    expect(task.organizationId).toBe(world.organization.id)
    expect(task.localState).toMatchObject({ orderStatus: 'CANCELLED', paymentStatus: 'SUCCEEDED' })

    expect(
      await prisma.auditLog.count({ where: { action: 'order.paid', entityId: payment.id } }),
    ).toBe(0)
    expect(
      await prisma.auditLog.count({
        where: { action: 'payment.succeeded_after_close', entityId: payment.id },
      }),
    ).toBe(1)

    // The refund goes through the ordinary route, against the whole total.
    const refund = await ask(order, { amountCents: order.totalCents })

    expect(refund.statusCode, refund.body).toBe(201)
    expect(refund.json().data.amountCents).toBe(order.totalCents)
  })
})

when()('12. a disputed payment', () => {
  it('is not refunded while its dispute blocks, and is once the dispute was won', async () => {
    const world = await feeWorld('dispute')
    const open = await feeOrder(world)
    const won = await feeOrder(world)

    for (const [paid, status] of [
      [open, 'UNDER_REVIEW'],
      [won, 'WON'],
    ]) {
      await prisma.dispute.create({
        data: {
          paymentId: paid.payment.id,
          provider: paid.payment.provider,
          providerDisputeId: `dp_${tag('dispute')}`,
          amountCents: paid.order.totalCents,
          currency: FEE_ORDER_CURRENCY,
          status,
        },
      })
    }

    const refused = await ask(open.order, { amountCents: open.order.totalCents })

    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json().error.code).toBe('PAYMENT_DISPUTED')
    expect((await expectSane(open.order.id)).refundPendingCents).toBe(0)
    expect(await prisma.refund.count({ where: { orderId: open.order.id } })).toBe(0)

    expect((await ask(won.order, { amountCents: won.order.totalCents })).statusCode).toBe(201)
  })
})

when()('13. a request decided on counters read before another refund was asked for', () => {
  it('is reserved against the counters as they stand under the order’s lock', async () => {
    const world = await feeWorld('stale')
    const paid = await feeOrder(world)

    // Read before the other request: its counters say nothing is held.
    const stale = paid.order

    expect((await ask(paid.order, { amountCents: 1_000 })).statusCode).toBe(201)

    const { refund, created } = await prisma.$transaction((tx) =>
      requestRefund(tx, {
        order: stale,
        payment: paid.payment,
        whole: true,
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: `fee-refund-${tag('stale')}`,
        actorId: owner.id,
        now: new Date(),
      }),
    )

    expect(created).toBe(true)
    // Everything left, not everything the stale read thought was left.
    expect(refund.amountCents).toBe(paid.order.totalCents - 1_000)

    const after = await expectSane(paid.order.id)

    expect(after.refundPendingCents).toBe(paid.order.totalCents)
    expect(
      sumAllocations(await prisma.refund.findMany({ where: { orderId: paid.order.id } })),
    ).toEqual(orderParts(paid.order))
  })
})

/**
 * Every ledger entry posted against an order, summed by account and direction.
 *
 * @param {string} orderId Which order.
 * @returns {Promise<Record<string, number>>} `account:DIRECTION` to cents.
 */
async function ledgerOfOrder(orderId) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { batch: { orderId } },
    include: { account: true },
  })
  const sums = {}

  for (const line of entries) {
    const key = `${line.account.code}:${line.direction}`

    sums[key] = (sums[key] ?? 0) + line.amountCents
  }

  return sums
}

/**
 * What the provider has given back on a payment so far.
 *
 * @param {object} payment The payment row.
 * @returns {number} Cents.
 */
function providerRefunded(payment) {
  return payments.getStatus(payment.providerRef)?.refundedAmountCents ?? 0
}

when()('14. a partial amount, then the rest of one of its lines by ticket (no promo)', () => {
  it('puts only the withdrawn tickets’ cost on the line, so the ticket refund settles', async () => {
    const world = await feeWorld('lineroom')
    const paid = await feeOrder(world, { withPromo: false })
    const order = paid.order
    const floor = order.items.find((item) => item.ticketTypeId === world.tiers.floor.id)
    const parts = orderParts(order)

    // An amount whose share of the $50.00 line pays for one ticket and a
    // little more: the little more is money, not part of the second ticket.
    let amountCents = null

    for (let candidate = 6_000; candidate < 12_000 && amountCents === null; candidate += 1) {
      const split = refundPartsFor({ parts, left: parts, form: 'amount', amountCents: candidate })
      const onFloor = allocateAcrossLines({
        items: order.items,
        amountCents: split.faceValueCents,
      }).find((line) => line.orderItemId === floor.id)

      if (onFloor?.quantity === 1 && onFloor.amountCents > floor.unitPriceCents) {
        amountCents = candidate
      }
    }

    expect(amountCents).not.toBeNull()

    const first = await refundThrough(order, { amountCents })

    expect(first.items.find((item) => item.orderItemId === floor.id)).toMatchObject({
      quantity: 1,
      amountCents: floor.unitPriceCents,
    })

    // The other floor ticket by name: its whole price is still on the line.
    const second = await refundThrough(order, {
      lines: [{ orderItemId: floor.id, quantity: 1 }],
    })

    expect(second.allocation.faceValueCents).toBe(floor.unitPriceCents)

    const middle = await expectSane(order.id)

    expect(middle.items.find((item) => item.id === floor.id)).toMatchObject({
      refundedQuantity: 2,
      refundedCents: floor.subtotalCents,
    })

    const third = await refundThrough(order, {
      amountCents: middle.totalCents - middle.refundedCents,
    })
    const after = await expectSane(order.id)

    expect(after.status).toBe('REFUNDED')
    expect(sumAllocations([first, second, third])).toEqual(parts)
    expect((await ticketsOf(after)).every((ticket) => ticket.status === 'REFUNDED')).toBe(true)
  })
})

when()('15. a ticket refund on a line an older refund gave more than its tickets cost', () => {
  it('asks the line only for what it has left, and settles', async () => {
    const world = await feeWorld('legacyline')
    const paid = await feeOrder(world, { withPromo: false })
    const order = paid.order
    const floor = order.items.find((item) => item.ticketTypeId === world.tiers.floor.id)

    // As a refund worked out before 2026-09-30 left the line: one $50.00
    // ticket withdrawn, with $5.00 of fee and tax put on the line beside it.
    const onLine = floor.unitPriceCents + 500
    const legacy = await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: paid.payment.id,
        provider: paid.payment.provider,
        amountCents: onLine,
        currency: order.currency,
        reason: 'CUSTOMER_REQUEST',
        status: 'SUCCEEDED',
        allocation: splitRefund(order, onLine),
        idempotencyKey: `fee-refund-${tag('legacyline')}`,
        settledAt: new Date(),
        items: { create: [{ orderItemId: floor.id, quantity: 1, amountCents: onLine }] },
      },
    })
    const [withdrawn] = await prisma.ticket.findMany({
      where: { orderItemId: floor.id },
      orderBy: { createdAt: 'asc' },
      take: 1,
    })

    await prisma.ticket.update({
      where: { id: withdrawn.id },
      data: {
        status: 'REFUNDED',
        revokedAt: new Date(),
        revokedReason: `refund:${legacy.id}`,
        credentialHash: null,
      },
    })
    await prisma.orderItem.update({
      where: { id: floor.id },
      data: { refundedQuantity: 1, refundedCents: onLine },
    })
    await prisma.order.update({ where: { id: order.id }, data: { refundedCents: onLine } })

    const requested = await ask(order, { lines: [{ orderItemId: floor.id, quantity: 1 }] })

    expect(requested.statusCode, requested.body).toBe(201)
    expect(requested.json().data.items).toEqual([
      { orderItemId: floor.id, quantity: 1, amountCents: floor.subtotalCents - onLine },
    ])

    const id = requested.json().data.id

    expect((await approve(id)).statusCode).toBe(200)

    const sent = await submit(id)

    expect(sent.statusCode, sent.body).toBe(200)
    expect(sent.json().data.status).toBe('SUCCEEDED')

    const middle = await expectSane(order.id)

    expect(middle.items.find((item) => item.id === floor.id).refundedCents).toBe(
      floor.subtotalCents,
    )

    await refundThrough(order, { amountCents: middle.totalCents - middle.refundedCents })

    const after = await expectSane(order.id)

    expect(after.status).toBe('REFUNDED')
    expect((await ticketsOf(after)).every((ticket) => ticket.status === 'REFUNDED')).toBe(true)
  })
})

when()('16. two ticket refunds of the last ticket on a line', () => {
  it('reserve one and refuse the other when they race', async () => {
    const world = await feeWorld('lastticket')
    const paid = await feeOrder(world)
    const balcony = paid.order.items.find((item) => item.ticketTypeId === world.tiers.balcony.id)
    const lines = [{ orderItemId: balcony.id, quantity: 1 }]

    // Both requests read the order, then queue behind this lock.
    const lock = await holdRow(prisma, 'Order', paid.order.id)
    const first = ask(paid.order, { lines })
    const second = ask(paid.order, { lines })

    // PostgreSQL queues the second behind the first rather than behind the
    // holder, so both are looked for among the holder's and the first's waiters.
    const queued = await untilWaiting(prisma, () => [lock.pid], 1, 'the first ticket refund')

    await untilWaiting(prisma, () => [lock.pid, ...queued], 2, 'both ticket refunds')
    lock.release()
    await lock.done

    const answers = await Promise.all([first, second])

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([201, 422])

    const refunds = await prisma.refund.findMany({ where: { orderId: paid.order.id } })

    expect(refunds).toHaveLength(1)
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(refunds[0].amountCents)
  })

  it('refuse the second even when its caller counted the line before the first', async () => {
    const world = await feeWorld('stalecount')
    const paid = await feeOrder(world)
    const balcony = paid.order.items.find((item) => item.ticketTypeId === world.tiers.balcony.id)
    const lines = [{ orderItemId: balcony.id, quantity: 1 }]

    expect((await ask(paid.order, { lines })).statusCode).toBe(201)

    // The caller's count of the line, taken before the first request.
    await expect(
      prisma.$transaction((tx) =>
        requestRefund(tx, {
          order: paid.order,
          payment: paid.payment,
          lines,
          pendingByLine: new Map(),
          reason: 'CUSTOMER_REQUEST',
          idempotencyKey: `fee-refund-${tag('stalecount')}`,
          actorId: owner.id,
          now: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(await prisma.refund.count({ where: { orderId: paid.order.id } })).toBe(1)
  })

  it('refuse a ticket an older refund still holds for less than its price', async () => {
    const world = await feeWorld('heldcheap')
    const paid = await feeOrder(world)
    const balcony = paid.order.items.find((item) => item.ticketTypeId === world.tiers.balcony.id)

    // As `requestRefund` wrote an amount refund before 2026-09-30: $5.00,
    // reserved, with the balcony ticket on its lines for less than it cost.
    await prisma.refund.create({
      data: {
        orderId: paid.order.id,
        paymentId: paid.payment.id,
        provider: paid.payment.provider,
        amountCents: 500,
        currency: paid.order.currency,
        reason: 'CUSTOMER_REQUEST',
        status: 'REQUESTED',
        allocation: splitRefund(paid.order, 500),
        requestedById: owner.id,
        idempotencyKey: `fee-refund-${tag('heldcheap')}`,
        items: { create: [{ orderItemId: balcony.id, quantity: 1, amountCents: 417 }] },
      },
    })
    await prisma.order.update({
      where: { id: paid.order.id },
      data: { refundPendingCents: 500 },
    })

    // A caller whose count of the line predates that refund.
    await expect(
      prisma.$transaction((tx) =>
        requestRefund(tx, {
          order: paid.order,
          payment: paid.payment,
          lines: [{ orderItemId: balcony.id, quantity: 1 }],
          pendingByLine: new Map(),
          reason: 'CUSTOMER_REQUEST',
          idempotencyKey: `fee-refund-${tag('heldcheap2')}`,
          actorId: owner.id,
          now: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(500)
  })
})

when()('17. a whole refund asked for on a copy of the order read before a refund settled', () => {
  it('puts nothing on the line that refund emptied, and settles (no promo)', async () => {
    const world = await feeWorld('staleitems')
    const paid = await feeOrder(world, { withPromo: false })
    const balcony = paid.order.items.find((item) => item.ticketTypeId === world.tiers.balcony.id)

    // Read before the balcony ticket was refunded.
    const stale = await prisma.order.findUnique({
      where: { id: paid.order.id },
      include: { items: true },
    })

    const one = await refundThrough(paid.order, {
      lines: [{ orderItemId: balcony.id, quantity: 1 }],
    })
    const { refund } = await prisma.$transaction((tx) =>
      requestRefund(tx, {
        order: stale,
        payment: paid.payment,
        whole: true,
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: `fee-refund-${tag('staleitems')}`,
        actorId: owner.id,
        now: new Date(),
      }),
    )
    const items = await prisma.refundItem.findMany({ where: { refundId: refund.id } })

    expect(items.some((item) => item.orderItemId === balcony.id)).toBe(false)
    expect((await approve(refund.id)).statusCode).toBe(200)

    const sent = await submit(refund.id)

    expect(sent.statusCode, sent.body).toBe(200)
    expect(sent.json().data.status).toBe('SUCCEEDED')

    const after = await expectSane(paid.order.id)
    const two = await prisma.refund.findUnique({ where: { id: refund.id } })

    expect(after.status).toBe('REFUNDED')
    expect(sumAllocations([one, two])).toEqual(orderParts(paid.order))
    expect((await ticketsOf(after)).every((ticket) => ticket.status === 'REFUNDED')).toBe(true)
  })
})

when()('18. a refund that cannot settle as it stands', () => {
  it('is refused before anything is sent when it was worked out before 2026-09-30', async () => {
    const world = await feeWorld('oldrow')
    const paid = await feeOrder(world, { withPromo: false })
    const order = paid.order
    const floor = order.items.find((item) => item.ticketTypeId === world.tiers.floor.id)
    const balcony = order.items.find((item) => item.ticketTypeId === world.tiers.balcony.id)

    // As `requestRefund` wrote a whole refund before: reserved, the split in
    // its allocation, and the whole amount — fee and tax included — spread
    // over the lines by subtotal.
    const onFloor = Math.floor((order.totalCents * floor.subtotalCents) / order.subtotalCents)
    const old = await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: paid.payment.id,
        provider: paid.payment.provider,
        amountCents: order.totalCents,
        currency: order.currency,
        reason: 'CUSTOMER_REQUEST',
        status: 'REQUESTED',
        allocation: splitRefund(order, order.totalCents),
        requestedById: owner.id,
        idempotencyKey: `fee-refund-${tag('oldrow')}`,
        items: {
          create: [
            { orderItemId: floor.id, quantity: floor.quantity, amountCents: onFloor },
            {
              orderItemId: balcony.id,
              quantity: balcony.quantity,
              amountCents: order.totalCents - onFloor,
            },
          ],
        },
      },
    })

    await prisma.order.update({
      where: { id: order.id },
      data: { refundPendingCents: order.totalCents },
    })

    expect((await approve(old.id)).statusCode).toBe(200)

    const refused = await submit(old.id)

    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json().error.code).toBe('REFUND_LINES_INVALID')
    expect(providerRefunded(paid.payment)).toBe(0)
    expect((await prisma.refund.findUnique({ where: { id: old.id } })).status).toBe('APPROVED')
    expect((await expectSane(order.id)).refundPendingCents).toBe(order.totalCents)

    // Withdrawn and asked for again, it settles.
    const withdrawn = await call('POST', `/v1/refunds/${old.id}/cancel`, {
      reason: 'Worked out before the repair.',
    })

    expect(withdrawn.statusCode, withdrawn.body).toBe(200)
    expect((await expectSane(order.id)).refundPendingCents).toBe(0)

    await refundThrough(order, { amountCents: order.totalCents })

    const after = await expectSane(order.id)

    expect(after.status).toBe('REFUNDED')
    expect(providerRefunded(paid.payment)).toBe(order.totalCents)
  })

  it('is refused before anything is sent when it holds no reservation', async () => {
    const world = await feeWorld('unreserved')
    const paid = await feeOrder(world)
    const unreserved = await prisma.refund.create({
      data: {
        orderId: paid.order.id,
        paymentId: paid.payment.id,
        provider: paid.payment.provider,
        amountCents: 1_000,
        currency: paid.order.currency,
        reason: 'CUSTOMER_REQUEST',
        status: 'APPROVED',
        allocation: splitRefund(paid.order, 1_000),
        requestedById: owner.id,
        idempotencyKey: `fee-refund-${tag('unreserved')}`,
      },
    })

    const refused = await submit(unreserved.id)

    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json().error.code).toBe('REFUND_NOT_RESERVED')
    expect(providerRefunded(paid.payment)).toBe(0)
    expect((await prisma.refund.findUnique({ where: { id: unreserved.id } })).status).toBe(
      'APPROVED',
    )
    expect((await expectSane(paid.order.id)).refundedCents).toBe(0)
  })
})

when()('19. a refund of money taken on an order that had already closed', () => {
  it('pays back what the capture recorded, and debits nobody’s payable', async () => {
    const world = await feeWorld('lateledger')
    const items = FEE_ORDER_LINES.map((line) => ({
      ticketTypeId: world.tiers[line.key].id,
      quantity: line.quantity,
      unitPriceCents: line.priceCents,
    }))
    const totals = priceFeeOrder({ items, promoCode: world.promoCode })
    const intent = payments.createIntent({
      amountCents: totals.totalCents,
      currency: FEE_ORDER_CURRENCY,
    })

    payments.capture(intent.id)

    const order = await prisma.order.create({
      data: {
        reference: `DE-LATE${tag('l')}`.toUpperCase().slice(0, 32),
        eventId: world.event.id,
        buyerEmail: `late-ledger-${RUN}@fee-refunds.example`,
        buyerName: 'Late Buyer',
        status: 'CANCELLED',
        cancelledAt: new Date(),
        currency: FEE_ORDER_CURRENCY,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        feesCents: totals.feesCents,
        feeGrossCents: totals.feeGrossCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        items: {
          create: totals.lineItems.map((line) => ({
            ticketTypeId: line.ticketTypeId,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            subtotalCents: line.subtotalCents,
          })),
        },
      },
    })
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: payments.name,
        providerRef: intent.id,
        status: 'PENDING',
        amountCents: totals.totalCents,
        currency: FEE_ORDER_CURRENCY,
      },
    })
    const balance = () =>
      availableBalance(prisma, {
        organizationId: world.organization.id,
        currency: FEE_ORDER_CURRENCY,
      })
    const before = await balance()

    await dispatchDelivery(prisma, {
      id: null,
      eventType: 'payment_intent.succeeded',
      accountContext: null,
      payload: {
        data: {
          object: {
            id: intent.id,
            amount: totals.totalCents,
            currency: 'usd',
            status: 'succeeded',
          },
        },
      },
    })

    // Taken, and owed back to the buyer: nobody was credited.
    expect(
      await prisma.ledgerBatch.findUnique({
        where: { idempotencyKey: lateCaptureLedgerKey(payment.id) },
      }),
    ).toBeTruthy()
    expect(await ledgerOfOrder(order.id)).toEqual({
      'processor_clearing:DEBIT': totals.totalCents,
      'refund_clearing:CREDIT': totals.totalCents,
    })

    const refund = await refundThrough(order, { amountCents: order.totalCents })

    expect(refund.status).toBe('SUCCEEDED')

    // The debt is paid: both clearing accounts are back to nothing for this
    // order, and the organiser's payable never moved.
    expect(await ledgerOfOrder(order.id)).toEqual({
      'processor_clearing:DEBIT': totals.totalCents,
      'processor_clearing:CREDIT': totals.totalCents,
      'refund_clearing:CREDIT': totals.totalCents,
      'refund_clearing:DEBIT': totals.totalCents,
    })
    expect((await balance()).payableCents).toBe(before.payableCents)
  })
})

when()('20. a dispute opened after the refund was asked for', () => {
  it('stops the approval and the sending, and nothing is paid', async () => {
    const world = await feeWorld('latedispute')
    const asked = await feeOrder(world)
    const approved = await feeOrder(world)
    const first = await ask(asked.order, { amountCents: asked.order.totalCents })
    const second = await ask(approved.order, { amountCents: approved.order.totalCents })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect((await approve(second.json().data.id)).statusCode).toBe(200)

    for (const paid of [asked, approved]) {
      await prisma.$transaction((tx) =>
        openDispute(tx, {
          payment: paid.payment,
          organizationId: world.organization.id,
          providerDisputeId: `dp_${tag('late')}`,
          amountCents: paid.order.totalCents,
          currency: FEE_ORDER_CURRENCY,
          reason: 'fraudulent',
          now: new Date(),
        }),
      )
    }

    const notApproved = await approve(first.json().data.id)

    expect(notApproved.statusCode, notApproved.body).toBe(409)
    expect(notApproved.json().error.code).toBe('PAYMENT_DISPUTED')
    expect((await prisma.refund.findUnique({ where: { id: first.json().data.id } })).status).toBe(
      'REQUESTED',
    )

    const notSent = await submit(second.json().data.id)

    expect(notSent.statusCode, notSent.body).toBe(409)
    expect(notSent.json().error.code).toBe('PAYMENT_DISPUTED')
    expect(providerRefunded(approved.payment)).toBe(0)
    expect((await prisma.refund.findUnique({ where: { id: second.json().data.id } })).status).toBe(
      'APPROVED',
    )

    // Each keeps its reservation until the dispute is decided or it is cancelled.
    for (const paid of [asked, approved]) {
      const after = await expectSane(paid.order.id)

      expect(after.refundPendingCents).toBe(paid.order.totalCents)
      expect(after.refundedCents).toBe(0)
    }
  })
})

when()('21. the organiser’s balance after refunds of a discounted order', () => {
  it('is back to nothing once the order is refunded in full, in one refund or in several', async () => {
    for (const shape of ['whole', 'parts']) {
      const world = await feeWorld(`payable${shape}`)
      const paid = await feeOrder(world)
      const order = paid.order
      const balcony = order.items.find((item) => item.ticketTypeId === world.tiers.balcony.id)
      const balance = () =>
        availableBalance(prisma, {
          organizationId: world.organization.id,
          currency: FEE_ORDER_CURRENCY,
        })

      // Checkout credits the organiser the subtotal and carries the discount.
      expect((await balance()).payableCents).toBe(order.subtotalCents)

      if (shape === 'whole') {
        await refundThrough(order, { amountCents: order.totalCents })
      } else {
        await refundThrough(order, { amountCents: 2_345 })
        await refundThrough(order, { lines: [{ orderItemId: balcony.id, quantity: 1 }] })

        const middle = await expectSane(order.id)

        await refundThrough(order, { amountCents: middle.totalCents - middle.refundedCents })
      }

      const after = await balance()
      const ledger = await ledgerOfOrder(order.id)

      expect((await expectSane(order.id)).status).toBe('REFUNDED')
      expect(after.payableCents).toBe(0)
      expect(after.availableCents).toBe(0)
      expect(ledger['promotional_discount:CREDIT']).toBe(order.discountCents)
      expect(ledger['organizer_payable:DEBIT']).toBe(ledger['organizer_payable:CREDIT'])
    }
  })
})

when()('22. withdrawing a cancellation refund while a submit repairs it', () => {
  it('leaves no reservation behind a withdrawn refund', async () => {
    const world = await feeWorld('cancelrace')
    const paid = await feeOrder(world)
    const legacy = await legacyRefund(world, paid, 'REQUESTED')

    let backend = null
    let reachedCount
    const reached = new Promise((resolve) => {
      reachedCount = resolve
    })
    let letGo
    const gate = new Promise((resolve) => {
      letGo = resolve
    })

    // The withdrawal pauses once it has counted the row's lines — the moment
    // it decides whether anything was reserved.
    const withdrawing = prisma.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

        backend = Number(pid)

        const paused = new Proxy(tx, {
          get(target, property) {
            if (property !== 'refundItem') return target[property]

            return new Proxy(target.refundItem, {
              get(inner, key) {
                if (key !== 'count') return inner[key]

                return async (args) => {
                  const counted = await inner.count(args)

                  reachedCount()
                  await gate

                  return counted
                }
              },
            })
          },
        })

        return cancelRefund(paused, {
          refund: legacy,
          order: paid.order,
          reason: 'Withdrawn by finance.',
          actorId: owner.id,
          now: new Date(),
        })
      },
      { timeout: 20_000, maxWait: 10_000 },
    )

    await reached

    // Somebody presses submit on the same row: its repair either waits for
    // the withdrawal or, if nothing makes it wait, reserves the row first.
    const pressed = submit(legacy.id)

    await Promise.race([
      pressed,
      untilWaiting(prisma, () => [backend], 1, 'the repair').catch(() => null),
    ])
    letGo()

    const applied = await withdrawing
    const answer = await pressed

    expect(applied).toBe(true)
    expect(answer.statusCode).toBe(409)
    expect((await prisma.refund.findUnique({ where: { id: legacy.id } })).status).toBe('CANCELLED')

    const after = await expectSane(paid.order.id)

    expect(after.refundPendingCents).toBe(0)
    expect(after.refundedCents).toBe(0)
    expect((await ask(paid.order, { amountCents: paid.order.totalCents })).statusCode).toBe(201)
  })
})

when()(
  '22b. withdrawing a cancellation refund that holds its row while a submit repairs it',
  () => {
    it('takes the two locks in the same order as the repair, so neither is aborted', async () => {
      const world = await feeWorld('lockorder')
      const paid = await feeOrder(world)
      const legacy = await legacyRefund(world, paid, 'REQUESTED')

      let backend = null
      let heldRefund
      const holding = new Promise((resolve) => {
        heldRefund = resolve
      })
      let letGo
      const gate = new Promise((resolve) => {
        letGo = resolve
      })

      // The withdrawal pauses between its two row locks: the refund's is held,
      // the order's not yet asked for.
      const withdrawing = prisma.$transaction(
        async (tx) => {
          const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`
          let locks = 0

          backend = Number(pid)

          const paused = new Proxy(tx, {
            get(target, property) {
              if (property !== '$queryRaw') return target[property]

              return async (strings, ...values) => {
                locks += 1

                if (locks === 2) {
                  heldRefund()
                  await gate
                }

                return target.$queryRaw(strings, ...values)
              }
            },
          })

          return cancelRefund(paused, {
            refund: legacy,
            order: paid.order,
            reason: 'Withdrawn by finance.',
            actorId: owner.id,
            now: new Date(),
          })
        },
        { timeout: 20_000, maxWait: 10_000 },
      )

      await holding

      const pressed = submit(legacy.id)

      await untilWaiting(prisma, () => [backend], 1, 'the repair')
      letGo()

      const applied = await withdrawing
      const answer = await pressed

      expect(applied).toBe(true)
      expect(answer.statusCode, answer.body).toBe(409)
      expect((await prisma.refund.findUnique({ where: { id: legacy.id } })).status).toBe(
        'CANCELLED',
      )

      const after = await expectSane(paid.order.id)

      expect(after.refundPendingCents).toBe(0)
      expect(after.refundedCents).toBe(0)
    })
  },
)

when()('23. two partial refunds that together cover the order', () => {
  it('mark it REFUNDED even when both settle from a copy read before either', async () => {
    const world = await feeWorld('bothhalves')
    const paid = await feeOrder(world)
    const half = paid.order.totalCents / 2
    const ids = []

    for (const amountCents of [half, paid.order.totalCents - half]) {
      const requested = await ask(paid.order, { amountCents })

      expect(requested.statusCode).toBe(201)
      ids.push(requested.json().data.id)
      expect((await approve(requested.json().data.id)).statusCode).toBe(200)
    }

    const stale = await prisma.order.findUnique({ where: { id: paid.order.id } })

    for (const id of ids) {
      const refund = await prisma.refund.findUnique({ where: { id } })

      await prisma.$transaction((tx) => markSubmitted(tx, { refund, now: new Date() }))
    }

    for (const id of ids) {
      const refund = await prisma.refund.findUnique({ where: { id } })

      await prisma.$transaction((tx) =>
        settleRefund(tx, {
          refund,
          order: stale,
          result: { providerRefundId: null, rawStatus: 'succeeded' },
          organizationId: world.organization.id,
          now: new Date(),
        }),
      )
    }

    const after = await expectSane(paid.order.id)

    expect(after.refundedCents).toBe(after.totalCents)
    expect(after.refundPendingCents).toBe(0)
    expect(after.status).toBe('REFUNDED')
  })
})

when()('24. two copies of one refund request at once', () => {
  it('make one refund: the first is created and the second is answered with it', async () => {
    const world = await feeWorld('doublesubmit')
    const paid = await feeOrder(world)
    const payload = {
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: `fee-refund-${tag('double')}`,
      amountCents: 1_000,
    }

    // Both copies miss the key before the lock, then queue behind it.
    const lock = await holdRow(prisma, 'Order', paid.order.id)
    const first = call('POST', `/v1/orders/${paid.order.reference}/refunds`, payload)
    const second = call('POST', `/v1/orders/${paid.order.reference}/refunds`, payload)
    const queued = await untilWaiting(prisma, () => [lock.pid], 1, 'the first copy')

    await untilWaiting(prisma, () => [lock.pid, ...queued], 2, 'both copies')
    lock.release()
    await lock.done

    const answers = await Promise.all([first, second])

    expect(answers.map((answer) => answer.statusCode).sort(), answers[1].body).toEqual([200, 201])
    expect(answers[0].json().data.id).toBe(answers[1].json().data.id)
    expect(await prisma.refund.count({ where: { orderId: paid.order.id } })).toBe(1)
    // Reserved once.
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(1_000)
  })

  it('are told apart under the order’s lock, before the key’s unique index has to', async () => {
    const world = await feeWorld('doublelib')
    const paid = await feeOrder(world)
    const idempotencyKey = `fee-refund-${tag('doublelib')}`
    const requestOnce = () =>
      prisma.$transaction((tx) =>
        requestRefund(tx, {
          order: paid.order,
          payment: paid.payment,
          amountCents: 1_000,
          reason: 'CUSTOMER_REQUEST',
          idempotencyKey,
          actorId: owner.id,
          now: new Date(),
        }),
      )

    const lock = await holdRow(prisma, 'Order', paid.order.id)
    const first = requestOnce()
    const second = requestOnce()
    const queued = await untilWaiting(prisma, () => [lock.pid], 1, 'the first copy')

    await untilWaiting(prisma, () => [lock.pid, ...queued], 2, 'both copies')
    lock.release()
    await lock.done

    // Neither is a unique-index error: the second finds the first's refund.
    const outcomes = await Promise.all([first, second])

    expect(outcomes.map((outcome) => outcome.created).sort()).toEqual([false, true])
    expect(outcomes[0].refund.id).toBe(outcomes[1].refund.id)
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(1_000)
  })

  it('refuses a key another order’s refund took while this one was being decided', async () => {
    const world = await feeWorld('keyclash')
    const mine = await feeOrder(world)
    const theirs = await feeOrder(world)
    const payload = {
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: `fee-refund-${tag('keyclash')}`,
      amountCents: 1_000,
    }

    // The first request writes its refund, then waits on one of its lines, so
    // its row exists uncommitted; the second, for another order, then meets it
    // on the key's unique index and waits for it to commit.
    const line = await holdRow(prisma, 'OrderItem', theirs.order.items[0].id)
    const first = call('POST', `/v1/orders/${theirs.order.reference}/refunds`, {
      ...payload,
      amountCents: theirs.order.totalCents,
    })
    const [writer] = await untilWaiting(prisma, () => [line.pid], 1, 'the first request')
    const second = call('POST', `/v1/orders/${mine.order.reference}/refunds`, payload)

    await untilWaiting(prisma, () => [writer], 1, 'the second request')
    line.release()
    await line.done

    const [created, refused] = await Promise.all([first, second])

    expect(created.statusCode, created.body).toBe(201)
    // A precise refusal, not a 500 carrying the database's words.
    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json().error.message).toMatch(/another order/)
    expect(refused.body).not.toMatch(/P2002|Unique constraint/)
    expect((await expectSane(mine.order.id)).refundPendingCents).toBe(0)
    expect(await prisma.refund.count({ where: { orderId: mine.order.id } })).toBe(0)

    // Sent again once the other order's refund is there, it is refused the
    // same way, rather than answered with that order's refund.
    const again = await call('POST', `/v1/orders/${mine.order.reference}/refunds`, payload)

    expect(again.statusCode, again.body).toBe(409)
    expect(again.json().error.message).toMatch(/another order/)
  })
})

when()('25. a ticket refund that takes everything the order has left', () => {
  it('is a whole refund, and withdraws the free tickets beside the paid ones', async () => {
    const world = await feeWorld('freeline')
    const free = await prisma.ticketType.create({
      data: {
        eventId: world.event.id,
        eventSessionId: world.session.id,
        name: `Free ${tag('free')}`,
        priceCents: 0,
        currency: FEE_ORDER_CURRENCY,
        quantityTotal: 200,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })
    const paid = await feeOrder(world, {
      lines: [
        { ticketTypeId: world.tiers.floor.id, quantity: 2, unitPriceCents: 5_000 },
        { ticketTypeId: free.id, quantity: 2, unitPriceCents: 0 },
      ],
    })
    const floor = paid.order.items.find((item) => item.ticketTypeId === world.tiers.floor.id)

    // The free tickets carry the 99¢ fee each, so the paid tickets' share of
    // the fee and the tax is all of it: this refund is for the whole order.
    const refund = await refundThrough(paid.order, {
      lines: [{ orderItemId: floor.id, quantity: 2 }],
    })

    expect(refund.amountCents).toBe(paid.order.totalCents)
    expect(refund.allocation).toEqual({ ...orderParts(paid.order), form: 'whole', whole: true })

    const after = await expectSane(paid.order.id)
    const tickets = await ticketsOf(after)

    expect(after.status).toBe('REFUNDED')
    expect(after.refundedCents).toBe(after.totalCents)
    expect(tickets).toHaveLength(4)
    // Every ticket, the free ones included, is withdrawn with its credential.
    expect(tickets.every((ticket) => ticket.status === 'REFUNDED')).toBe(true)
    expect(tickets.every((ticket) => !ticket.credentialHash)).toBe(true)
  })
})

when()('26. a timed-out refund that never reached the provider, after one that settled', () => {
  it('is released by reconciliation, then approved again and settled', async () => {
    const world = await feeWorld('partialtimeout')
    const paid = await feeOrder(world)

    await refundThrough(paid.order, { amountCents: 4_000 })

    const requested = await ask(paid.order, { amountCents: 2_000 })
    const id = requested.json().data.id

    expect((await approve(id)).statusCode).toBe(200)

    // The provider is never called for this one.
    lever.next = 'TIMEOUT'
    expect((await submit(id)).json().data.status).toBe('TIMEOUT')

    const finance = await prisma.user.create({
      data: {
        email: `finance-${tag('fin')}@fee-refunds.example`,
        displayName: 'Platform Finance',
        passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
        role: 'FINANCE_ADMIN',
        emailVerified: true,
      },
    })

    await prisma.mfaFactor.create({
      data: {
        userId: finance.id,
        type: 'TOTP',
        secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
        confirmedAt: new Date(),
      },
    })

    const { secret } = await startSession(prisma, {
      actor: { id: finance.id, role: finance.role, memberships: [] },
      request: { headers: {}, ip: '127.0.0.1' },
      key: 'refund-fees-suite-pseudonymisation-key',
      mfaSatisfied: true,
    })
    const task = await prisma.reconciliationTask.findFirst({
      where: { refundId: id, kind: 'REFUND_UNKNOWN' },
    })
    const resolve = (resolution) =>
      app.inject({
        method: 'POST',
        url: `/v1/operations/reconciliation/${task.id}/resolve`,
        headers: { authorization: `Bearer ${secret}` },
        payload: { resolution, note: 'Checked with the provider.' },
      })

    // The provider has given back only the settled 4000: settling this one
    // would say the buyer got 2000 they never received.
    const settled = await resolve('SETTLED_FROM_PROVIDER')

    expect(settled.statusCode, settled.body).toBe(422)

    const released = await resolve('RELEASED_FROM_PROVIDER')

    expect(released.statusCode, released.body).toBe(200)
    expect((await prisma.refund.findUnique({ where: { id } })).status).toBe('FAILED')
    expect((await expectSane(paid.order.id)).refundPendingCents).toBe(0)

    expect((await approve(id)).statusCode).toBe(200)
    expect((await submit(id)).json().data.status).toBe('SUCCEEDED')

    const after = await expectSane(paid.order.id)

    expect(after.refundedCents).toBe(6_000)
    // The books and the provider agree.
    expect(payments.getStatus(paid.payment.providerRef).refundedAmountCents).toBe(6_000)
  })
})

when()('27. cancelling an event with a free order and a disputed one', () => {
  it('records both in the cancellation’s audit and puts the disputed one in front of finance', async () => {
    const world = await feeWorld('cancelskips')
    const free = await prisma.ticketType.create({
      data: {
        eventId: world.event.id,
        eventSessionId: world.session.id,
        name: `Free ${tag('free')}`,
        priceCents: 0,
        currency: FEE_ORDER_CURRENCY,
        quantityTotal: 200,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })
    const refunded = await feeOrder(world)
    const disputed = await feeOrder(world)
    const nothing = await feeOrder(world, {
      withPromo: false,
      lines: [{ ticketTypeId: free.id, quantity: 1, unitPriceCents: 0 }],
    })

    expect(nothing.order.totalCents).toBe(0)
    expect(nothing.order.status).toBe('PAID')

    await prisma.dispute.create({
      data: {
        paymentId: disputed.payment.id,
        provider: disputed.payment.provider,
        providerDisputeId: `dp_${tag('skips')}`,
        amountCents: disputed.order.totalCents,
        currency: FEE_ORDER_CURRENCY,
        status: 'UNDER_REVIEW',
      },
    })

    const cancelled = await call('POST', `/v1/events/${world.event.id}/cancel`, {
      reasonCode: 'VENUE_UNAVAILABLE',
      reason: 'The hall flooded.',
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: world.event.id, action: 'event.cancelled' },
    })

    expect(audit.metadata).toMatchObject({
      from: 'ON_SALE',
      to: 'CANCELLED',
      refundWork: {
        orders: 3,
        refunds: 1,
        skippedZeroValue: 1,
        skippedDisputed: 1,
        disputedOrderIds: [disputed.order.id],
      },
    })

    // Nothing is refunded beside the dispute, and finance has it in front of
    // them: if the dispute is won, this buyer is still owed their money.
    expect(await prisma.refund.count({ where: { orderId: disputed.order.id } })).toBe(0)

    const task = await prisma.reconciliationTask.findFirst({
      where: { orderId: disputed.order.id },
    })

    expect(task).toMatchObject({
      kind: 'PROVIDER_MISMATCH',
      state: 'OPEN',
      paymentId: disputed.payment.id,
      organizationId: world.organization.id,
    })
    expect(task.localState).toMatchObject({ disputeStatus: 'UNDER_REVIEW', orderStatus: 'PAID' })
    expect(task.lastError).toMatch(/dispute/)

    // The refund it did ask for names the request that asked.
    const [refund] = await prisma.refund.findMany({ where: { orderId: refunded.order.id } })
    const requestedAudit = await prisma.auditLog.findFirst({
      where: { entityId: refund.id, action: 'refund.requested' },
    })

    expect(requestedAudit.metadata.requestId).toBeTruthy()
  })
})

when()('28. cancelling an event with 500 paid fee orders', () => {
  it('reserves every refund inside one transaction sized to the work', async () => {
    const world = await feeWorld('manyorders')
    const tier = (name, priceCents) =>
      prisma.ticketType.create({
        data: {
          eventId: world.event.id,
          eventSessionId: world.session.id,
          name: `${name} ${tag('many')}`,
          priceCents,
          currency: FEE_ORDER_CURRENCY,
          quantityTotal: 5_000,
          maxPerOrder: 10,
          status: 'ON_SALE',
        },
      })
    const floor = await tier('Floor', 5_000)
    const balcony = await tier('Balcony', 2_000)
    const lines = [
      { ticketTypeId: floor.id, quantity: 2, unitPriceCents: 5_000 },
      { ticketTypeId: balcony.id, quantity: 1, unitPriceCents: 2_000 },
    ]
    const count = 500

    for (let made = 0; made < count; made += 10) {
      await Promise.all(Array.from({ length: 10 }, () => feeOrder(world, { lines })))
    }

    // Prisma's default of five seconds holds a few hundred of these; this
    // event has more.
    const cancelled = await call('POST', `/v1/events/${world.event.id}/cancel`, {
      reasonCode: 'VENUE_UNAVAILABLE',
      reason: 'The hall flooded.',
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)
    expect((await prisma.event.findUnique({ where: { id: world.event.id } })).status).toBe(
      'CANCELLED',
    )

    const orders = await prisma.order.findMany({ where: { eventId: world.event.id } })
    const refunds = await prisma.refund.findMany({
      where: { orderId: { in: orders.map((order) => order.id) } },
    })

    expect(orders).toHaveLength(count)
    expect(refunds).toHaveLength(count)
    expect(new Set(refunds.map((refund) => refund.orderId)).size).toBe(count)
    expect(refunds.every((refund) => refund.status === 'REQUESTED')).toBe(true)
    expect(refunds.every((refund) => refund.allocation?.whole === true)).toBe(true)
    expect(orders.every((order) => order.refundPendingCents === order.totalCents)).toBe(true)
  }, 240_000)
})
