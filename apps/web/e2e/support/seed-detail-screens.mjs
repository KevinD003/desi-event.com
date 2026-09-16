/**
 * The commerce rows the four detail screens need in order to be real screens.
 *
 * A dashboard rendered from a static array proves nothing: it proves the markup
 * compiles. What the sweep has to scan is the page an operator actually gets,
 * with a ticket that exists, a refund with lines, a reconciliation item with
 * both sides of its evidence, and analytics figures derived from a ledger that
 * balances. So this seeds all four, against the same disposable database the
 * rest of the browser suites use, and removes what it can afterwards.
 *
 * What it cannot remove is a posted ledger batch. Those rows are refused by a
 * trigger on purpose — an append-only ledger that a cleanup script could undo
 * would not be one — so the entries stay behind, invisible because every run
 * seeds its own organisation.
 *
 * Every figure here is small and obviously fictional. No real card, no real
 * provider reference, no real person.
 *
 * @module e2e/support/seed-detail-screens
 */

import { createPrismaClient } from '@desi-event/db'

import { CONNECTION } from './seed-refusals.mjs'

/** What the fictional order was for, in minor units. */
const UNIT_CENTS = 100_000

/** How many tickets it bought. */
const QUANTITY = 2

/** What the fictional refund gives back. */
const REFUND_CENTS = UNIT_CENTS

/**
 * The ledger account ids the migration creates.
 *
 * Literal, because they are literal in the migration: a fixture that invented
 * its own would be posting to accounts no deployment has.
 *
 * @type {Readonly<Record<string, string>>}
 */
const ACCOUNTS = Object.freeze({
  PROCESSOR_CLEARING: 'ledacc0000000processorclear',
  ORGANIZER_PAYABLE: 'ledacc0000000organizerpaybl',
  PLATFORM_FEE_REVENUE: 'ledacc0000000platformfeerev',
})

/**
 * Seed one paid order, its tickets, a refund, a reconciliation item and a
 * balanced ledger batch.
 *
 * @param {object} options Options.
 * @param {string} options.tag The run suffix.
 * @param {string} options.organizationId Whose commerce this is.
 * @param {string} options.eventId Which event was sold.
 * @param {string} options.ownerUserId Who ends up holding the tickets.
 * @returns {Promise<object>} The ids the specs navigate to.
 */
export async function seedDetailScreens({ tag, organizationId, eventId, ownerUserId }) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  const ticketType = await prisma.ticketType.findFirst({ where: { eventId } })

  const order = await prisma.order.create({
    data: {
      reference: `DE-SWP${tag.slice(-4).toUpperCase()}`,
      eventId,
      userId: ownerUserId,
      buyerEmail: `holder-${tag}@attendee.test`,
      buyerName: 'Ticket Holder',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: UNIT_CENTS * QUANTITY,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: UNIT_CENTS * QUANTITY,
      refundedCents: 0,
      refundPendingCents: REFUND_CENTS,
      paidAt: new Date(),
    },
  })

  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity: QUANTITY,
      unitPriceCents: UNIT_CENTS,
      subtotalCents: UNIT_CENTS * QUANTITY,
      refundedQuantity: 0,
      refundedCents: 0,
    },
  })

  const tickets = []

  for (let index = 0; index < QUANTITY; index += 1) {
    tickets.push(
      await prisma.ticket.create({
        data: {
          orderItemId: orderItem.id,
          code: `DE-SWP-${tag}-${index}`,
          ownerUserId,
          attendeeName: 'Ticket Holder',
          status: 'VALID',
        },
      }),
    )
  }

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: 'in-memory-payments',
      providerRef: `mock_${tag}`,
      status: 'SUCCEEDED',
      amountCents: UNIT_CENTS * QUANTITY,
      currency: 'INR',
    },
  })

  const refund = await prisma.refund.create({
    data: {
      orderId: order.id,
      paymentId: payment.id,
      provider: 'in-memory-payments',
      amountCents: REFUND_CENTS,
      currency: 'INR',
      reason: 'CUSTOMER_REQUEST',
      reasonNote: 'They cannot come.',
      status: 'REQUESTED',
      idempotencyKey: `sweep-refund-${tag}`,
      allocation: { faceValueCents: REFUND_CENTS, feeCents: 0, taxCents: 0 },
      attempts: 0,
      items: {
        create: [{ orderItemId: orderItem.id, quantity: 1, amountCents: REFUND_CENTS }],
      },
    },
  })

  // Both sides of the evidence, each already inside the display allow list —
  // which is the point: the screen shows what a real item would carry, and the
  // presenter would drop anything else.
  const task = await prisma.reconciliationTask.create({
    data: {
      kind: 'PAYMENT_TIMEOUT',
      state: 'OPEN',
      paymentId: payment.id,
      orderId: order.id,
      organizationId,
      providerRef: `mock_${tag}`,
      localState: { orderStatus: 'PAID', paymentStatus: 'SUCCEEDED', currency: 'INR' },
      providerState: { found: true, status: 'succeeded', amountCents: UNIT_CENTS * QUANTITY },
      attempts: 1,
      lastError: 'the provider did not answer in time; this is a fixture, not an incident',
      notes: [{ at: new Date().toISOString(), actorId: null, note: 'Seeded for the sweep.' }],
      // Old enough to be shown as overdue, so the aging band renders rather
      // than being the one branch nothing exercises.
      createdAt: new Date(Date.now() - 96 * 3_600_000),
    },
  })

  // Composed as a draft and then posted, because the ledger refuses a batch
  // posted with no entries. Same dance the service does.
  const batch = await prisma.ledgerBatch.create({
    data: {
      reference: `OR-SWP-${tag}`,
      kind: 'ORDER_PAID',
      status: 'DRAFT',
      currency: 'INR',
      debitCents: UNIT_CENTS * QUANTITY,
      creditCents: UNIT_CENTS * QUANTITY,
      sourceType: 'ORDER',
      sourceId: order.id,
      idempotencyKey: `ORDER_PAID:ORDER:${order.id}:`,
      orderId: order.id,
    },
  })

  for (const [accountId, direction, amountCents, memo] of [
    [ACCOUNTS.PROCESSOR_CLEARING, 'DEBIT', UNIT_CENTS * QUANTITY, 'Taken from the buyer'],
    [ACCOUNTS.ORGANIZER_PAYABLE, 'CREDIT', UNIT_CENTS * QUANTITY - 20_000, 'Owed to the organiser'],
    [ACCOUNTS.PLATFORM_FEE_REVENUE, 'CREDIT', 20_000, 'Platform fee'],
  ]) {
    await prisma.ledgerEntry.create({
      data: {
        batchId: batch.id,
        accountId,
        direction,
        amountCents,
        currency: 'INR',
        memo,
        organizationId,
      },
    })
  }

  await prisma.ledgerBatch.update({
    where: { id: batch.id },
    data: { status: 'POSTED', postedAt: new Date() },
  })

  await prisma.$disconnect()

  return {
    orderId: order.id,
    orderReference: order.reference,
    orderItemId: orderItem.id,
    paymentId: payment.id,
    refundId: refund.id,
    reconciliationTaskId: task.id,
    ticketIds: tickets.map((ticket) => ticket.id),
  }
}

/**
 * Remove what can be removed, and say plainly what cannot.
 *
 * Runs before the refusals cleanup, because that one deletes the events these
 * rows hang from.
 *
 * **An order a posted ledger batch names is not deletable, and that is the
 * design working.** Two triggers refuse any delete or update of a posted batch
 * or its entries, so the batch survives, its foreign key pins the order, the
 * order pins the event and the event pins the organisation. A cleanup that
 * could unwind that chain would be a cleanup that could rewrite an append-only
 * ledger, which is the one thing the ledger exists to make impossible.
 *
 * So the chain is left standing rather than attempted and swallowed: attempting
 * it logs a foreign-key error that reads like a failure and is not one. Every
 * row carries this run's tag, and the database they are in is disposable by
 * construction.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<{pinnedOrderIds: string[]}>} Which orders the ledger kept.
 */
export async function cleanupDetailScreens(tag) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  const orders = await prisma.order.findMany({
    where: { buyerEmail: { contains: tag } },
    include: { items: true },
  })

  const pinnedOrderIds = []

  for (const order of orders) {
    await prisma.reconciliationTask.deleteMany({ where: { orderId: order.id } }).catch(() => {})
    await prisma.refundItem.deleteMany({ where: { refund: { orderId: order.id } } }).catch(() => {})
    await prisma.refund.deleteMany({ where: { orderId: order.id } }).catch(() => {})

    for (const item of order.items) {
      await prisma.ticketTransfer
        .deleteMany({ where: { ticket: { orderItemId: item.id } } })
        .catch(() => {})
      await prisma.checkIn
        .deleteMany({ where: { ticket: { orderItemId: item.id } } })
        .catch(() => {})
      await prisma.ticket.deleteMany({ where: { orderItemId: item.id } }).catch(() => {})
    }

    const posted = await prisma.ledgerBatch.count({
      where: { orderId: order.id, status: 'POSTED' },
    })

    if (posted > 0) {
      pinnedOrderIds.push(order.id)
      continue
    }

    await prisma.orderItem.deleteMany({ where: { orderId: order.id } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { orderId: order.id } }).catch(() => {})
    await prisma.order.delete({ where: { id: order.id } }).catch(() => {})
  }

  await prisma.$disconnect()

  return { pinnedOrderIds }
}
