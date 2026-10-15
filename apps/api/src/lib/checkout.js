/**
 * Two-phase checkout.
 *
 * The rule this module exists to enforce: **no call to a payment provider ever
 * happens while a database transaction is open.**
 *
 * Holding locks across a network call to a third party couples the database's
 * availability to theirs. A gateway that is merely slow exhausts the
 * transaction timeout, the surrounding transaction rolls back, and the money
 * has still moved — a charge with no order and no tickets against it. That is
 * the worst failure a ticketing system has, because the buyer has paid and the
 * system has no record of it.
 *
 * So checkout is three steps, and the boundaries are the point:
 *
 *   1. {@link beginCheckout} — validate, price, reserve inventory, and write a
 *      PENDING order with an INITIATED payment attempt. Commits. After this
 *      returns, durable evidence exists that a charge is about to be attempted.
 *   2. {@link captureOutsideTransaction} — call the provider with nothing open.
 *      However long it takes, no locks are held and nothing can time out
 *      underneath it.
 *   3. {@link settleCheckout} or {@link compensateCheckout} — a short
 *      transaction that records the outcome. Settlement is conditional on the
 *      order still being PENDING, so two workers racing the same payment
 *      produce exactly one fulfilment.
 *
 * ## Locks
 *
 * Settlement follows the one lock order every path keeps (SPEC3-XI §2.1): its
 * tiers first, sorted, then its order, its seats, its new tickets, its holds,
 * and a referral code last. It reads its lines' tiers (fixed for the life of
 * the lines) and locks them **before** its conditional PENDING→PAID update: an
 * order that moves no money has no payment, so a deletion or a night's
 * cancellation holding those tiers would otherwise wait on this order while
 * this settlement waited on their tiers (SPEC3-XI §2.3.3).
 *
 * A PENDING order ended instead (a declined card, a free booking that could
 * not be completed) takes the same tiers and then its own night
 * `FOR KEY SHARE` before its order: giving a referral use back writes the
 * order a second time, and PostgreSQL's foreign-key check of that second
 * write takes the night after the order otherwise (`lockAheadOfOrder`).
 *
 * ## Referral uses (SPEC3-XI XR4)
 *
 * A declined card, a free booking that could not be completed, and a booking
 * whose event was cancelled while it was being completed each end the order
 * without it being used, so each gives its referral code's use back, once,
 * through `settleReferralUsesIfEnded` — after the transaction's last write to
 * the order, its lines, tickets and seats, so the code is its last row lock.
 *
 * A timeout is not a decline. A decline means no money moved; a timeout means
 * nobody knows. Those take different paths: a decline compensates immediately,
 * a timeout leaves the order PENDING and flags the payment for reconciliation,
 * because cancelling an order whose charge may have succeeded is how you
 * refund-by-accident or strand a buyer who was in fact charged.
 *
 * @module @desi-event/api/lib/checkout
 */

import { orderPaidBatch } from '@desi-event/ledger'
import { splitAcrossTickets } from '@desi-event/pricing'
import { PROVIDER_ERROR_CODES } from '@desi-event/providers'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { lockTicketTypes } from './inventory.js'
import { postBatch } from './ledger.js'
import { settleReferralUsesIfEnded } from './referral-uses.js'
import { lockOrderNight } from './refunds.js'
import { sellSeats } from './seating.js'
import { issueTicketCredential } from './ticket-credentials.js'
import { openReconciliation } from './webhook-handlers.js'

/** What the provider told us, once we are out of the transaction. */
export const CAPTURE_OUTCOMES = Object.freeze({
  SUCCEEDED: 'SUCCEEDED',
  DECLINED: 'DECLINED',
  /** No definite answer. The money may or may not have moved. */
  TIMEOUT: 'TIMEOUT',
})

/**
 * Order two order lines by their tier's id, as `lockTicketTypes` sorts ids.
 *
 * @param {{ticketTypeId: string}} left One line.
 * @param {{ticketTypeId: string}} right Another.
 * @returns {number} Negative, zero or positive, for `Array.prototype.sort`.
 */
function byTicketTypeId(left, right) {
  if (left.ticketTypeId < right.ticketTypeId) return -1
  if (left.ticketTypeId > right.ticketTypeId) return 1

  return 0
}

/**
 * Take, before a PENDING order is ended, what SPEC3-XI §2.1 puts in front of
 * the order: its lines' tiers, sorted, `FOR UPDATE` (as settlement takes them,
 * §2.3.3), then the order's own night `FOR KEY SHARE`.
 *
 * Ending an order that named a referral code writes the order twice: its
 * status, then the use's return marker. PostgreSQL checks a row's foreign keys
 * again when one transaction updates it a second time, and that check takes
 * `KEY SHARE` on the order's night after the order. A deletion or a night's
 * cancellation holds the tiers and the night `FOR UPDATE` and then waits for
 * this order in `cancelUnpaidOrders`, so taken there the two waited on each
 * other (40P01, `referral-returns-integration` R12). Taken first, whichever
 * comes second waits for the other to commit. The lines' tiers and the
 * order's night never change, so reading them unlocked is enough.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {{id: string, eventSessionId?: string|null}} order The order.
 * @returns {Promise<void>} Resolves once the locks are held.
 */
async function lockAheadOfOrder(tx, order) {
  const lines = await tx.orderItem.findMany({
    where: { orderId: order.id },
    select: { ticketTypeId: true },
  })

  await lockTicketTypes(
    tx,
    lines.map((line) => line.ticketTypeId),
  )
  await lockOrderNight(tx, order)
}

/**
 * Call the payment provider. No transaction may be open when this runs.
 *
 * Never throws for a payment outcome — a decline and a timeout are results, not
 * exceptions, and the caller has to record both. It still throws for a
 * programming error, which is not a payment outcome.
 *
 * @param {object} payments The payment provider.
 * @param {object} order The committed PENDING order.
 * @returns {Promise<{outcome: string, intent: object|null, failureCode: string|null, rawStatus: string|null}>} What happened.
 */
export async function captureOutsideTransaction(payments, order) {
  try {
    const intent = await payments.createIntent({
      amountCents: order.totalCents,
      currency: order.currency,
      orderId: order.id,
      // Identifiers only, as the provider adapters require. The buyer's address
      // was here, and a real provider would have stored it on its side.
      metadata: { reference: order.reference },
    })

    const captured = await payments.capture(intent.id, {
      amountCents: order.totalCents,
      currency: order.currency,
    })

    return {
      outcome: CAPTURE_OUTCOMES.SUCCEEDED,
      intent: captured,
      failureCode: null,
      rawStatus: captured.status ?? null,
    }
  } catch (error) {
    if (error?.code === PROVIDER_ERROR_CODES.PAYMENT_TIMEOUT) {
      return {
        outcome: CAPTURE_OUTCOMES.TIMEOUT,
        intent: null,
        failureCode: null,
        rawStatus: 'TIMEOUT',
        providerRef: error.details?.intentId ?? null,
      }
    }

    if (error?.code === PROVIDER_ERROR_CODES.PAYMENT_DECLINED) {
      return {
        outcome: CAPTURE_OUTCOMES.DECLINED,
        intent: null,
        failureCode: error.details?.failureCode ?? 'card_declined',
        rawStatus: 'FAILED',
        providerRef: error.details?.intentId ?? null,
      }
    }

    throw error
  }
}

/**
 * Move an order's reserved seats from HELD to SOLD.
 *
 * Reserved seating is an extra step on top of quantity: a general-admission
 * order only decrements a counter, but a seated order has named rows that have
 * to stop being holdable and start belonging to an order line. It happens in the
 * settlement transaction rather than after it, because a seat that is paid for
 * and still HELD is a seat the expiry sweep may release out from under a ticket.
 *
 * Which line pays for which seat was decided at checkout and written onto the
 * hold item, so this reads a column rather than reconstructing the answer. It
 * used to match a held seat to the order line of the same ticket type, which is
 * wrong as soon as one selection spans two price zones: that is two lines of
 * one tier, and the map had room for only one of them. The seat that lost the
 * collision was sold against the wrong line at the wrong price.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {string} params.orderId The order being settled.
 * @returns {Promise<number>} How many seats were sold.
 * @throws {Error} When a held seat was never stamped with the line that pays for it.
 */
export async function sellHeldSeats(tx, { orderId }) {
  const holds = await tx.ticketHold.findMany({
    where: { orderId, status: 'ACTIVE' },
    select: { id: true },
  })

  if (holds.length === 0) return 0

  let sold = 0

  for (const hold of holds) {
    const heldSeats = await tx.holdItem.findMany({
      where: { holdId: hold.id, eventSeatId: { not: null } },
      select: { eventSeatId: true, orderItemId: true, ticketTypeId: true },
    })

    if (heldSeats.length === 0) continue

    const orderItemBySeat = {}

    for (const heldSeat of heldSeats) {
      if (!heldSeat.orderItemId) {
        // A seat reserved for this order that no line claims. Selling the rest
        // and skipping this one would leave a seat held against a paid order,
        // which the expiry sweep would eventually release out from under a
        // ticket. Refusing rolls the settlement back instead.
        throw Object.assign(
          new Error(
            `Hold ${hold.id} reserves seat ${heldSeat.eventSeatId} for order ${orderId}, but no line on that order pays for it`,
          ),
          { code: 'SEAT_UNCLAIMED' },
        )
      }

      orderItemBySeat[heldSeat.eventSeatId] = heldSeat.orderItemId
    }

    sold += await sellSeats(tx, { holdId: hold.id, orderItemBySeat })
  }

  return sold
}

/**
 * Post the ledger batch for a paid order.
 *
 * The split comes from the order's own stored totals, which were computed from
 * the versioned pricing snapshot at checkout — not from the live fee tables,
 * which may have moved since. The organiser is credited the **subtotal** and the
 * discount is debited as contra-revenue, so the money given away stays visible
 * rather than disappearing into a smaller payable.
 *
 * A pay-at-the-venue order puts only the booking fee, and any tax on it,
 * online (SPEC3 §10.1): the batch has no organiser share and no discount (the
 * promo lowered the door price, which is not platform money), so it is a
 * fee-only batch — `processor_clearing` against `platform_fee_revenue`, and
 * `tax_payable` for any tax. A total of 0 posts nothing.
 *
 * The arithmetic is checked by `orderPaidBatch`, which refuses a split that does
 * not add up to what was captured. That matters more than it looks: a wrong
 * split that happened to balance would post and never be questioned.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.order The order, with its totals.
 * @param {object|null} params.payment The payment attempt, when there was one.
 * @param {Date} params.now The posting instant.
 * @param {string|null} [params.actorId] Who settled it. Null means a system job.
 * @returns {Promise<object|null>} The posted batch, or null for a zero-total order.
 */
export async function postOrderLedger(tx, { order, payment, now, actorId = null }) {
  // A free order moves no money, so there is nothing to record. Posting a
  // zero-value batch would satisfy the balance rule and mean nothing.
  if (!order.totalCents) return null

  const event = await tx.event.findUnique({
    where: { id: order.eventId },
    select: { organizationId: true },
  })

  const atVenue = order.paymentMethod === 'AT_VENUE'
  const batch = orderPaidBatch({
    capturedCents: order.totalCents,
    organizerNetCents: atVenue ? 0 : order.subtotalCents,
    platformFeeCents: order.feesCents ?? 0,
    taxCents: order.taxCents ?? 0,
    discountCents: atVenue ? 0 : (order.discountCents ?? 0),
    currency: order.currency,
    organizationId: event?.organizationId ?? null,
    reference: order.reference,
  })

  const { batch: posted } = await postBatch(tx, batch, {
    sourceType: 'ORDER',
    sourceId: order.id,
    reference: `LB-${order.reference}`,
    orderId: order.id,
    paymentId: payment?.id ?? null,
    actorId,
    now,
  })

  return posted
}

/**
 * Issue one ticket, with the pass that opens the door.
 *
 * Two writes rather than one, because the credential is derived from the
 * ticket's own id and that id does not exist until the row does. The plaintext
 * is computed, hashed, and thrown away here; only the digest is stored. Nothing
 * returns it, because at issuance nobody is watching — the buyer reads their
 * pass later, through a route that re-derives it for them.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {string} params.orderItemId The line this ticket is on.
 * @param {string|null} params.eventSeatId The seat it admits to, for reserved seating.
 * @param {string|null} params.attendeeName Whose name is printed on it.
 * @param {string|null} params.ownerUserId Who holds it, when the buyer was signed in.
 * @param {function(): string} params.generateTicketCode Ticket code factory.
 * @param {string} params.credentialSecret The deployment's `AUTH_SECRET`.
 * @param {Date} params.now Issuance instant.
 * @param {number} [params.venueDueCents] Its share of its line's ticket price, to be paid at the door; 0 unless the order is paid at the venue. Never changes.
 * @returns {Promise<object>} The created ticket, without its credential.
 */
export async function issueTicket(
  tx,
  {
    orderItemId,
    eventSeatId,
    attendeeName,
    ownerUserId,
    generateTicketCode,
    credentialSecret,
    now,
    venueDueCents = 0,
  },
) {
  const ticket = await tx.ticket.create({
    data: {
      orderItemId,
      code: generateTicketCode(),
      attendeeName,
      ownerUserId,
      eventSeatId,
      status: 'VALID',
      venueDueCents,
    },
  })

  const { credentialHash } = issueTicketCredential({
    secret: credentialSecret,
    ticketId: ticket.id,
    version: ticket.credentialVersion ?? 1,
  })

  return tx.ticket.update({
    where: { id: ticket.id },
    data: { credentialHash, credentialIssuedAt: now },
  })
}

/**
 * Record a successful capture and fulfil the order.
 *
 * The update is conditional on the order still being PENDING. That single
 * condition is what stops two workers — a webhook and a redirect, or two
 * retries — from issuing two sets of tickets for one payment. The order's
 * tiers are locked before it (see the module's "Locks").
 *
 * A pay-at-the-venue order's tickets each carry their share of their line's
 * door price (`venueDueCents`); its ledger batch is fee-only.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Settlement inputs.
 * @param {object} params.order The PENDING order.
 * @param {object} params.payment The payment attempt row.
 * @param {object} params.result The capture result.
 * @param {Date} params.now Settlement instant.
 * @param {function(): string} params.generateTicketCode Ticket code factory.
 * @param {string} params.credentialSecret The deployment's `AUTH_SECRET`, for minting passes.
 * @param {string|null} [params.actorId] Actor for the audit trail.
 * @param {string|null} [params.requestId] Request id for the audit trail.
 * @returns {Promise<{settled: boolean}>} Whether this call performed the transition.
 */
export async function settleCheckout(
  tx,
  {
    order: given,
    payment,
    result,
    now,
    generateTicketCode,
    credentialSecret,
    actorId = null,
    requestId = null,
  },
) {
  // The tiers first, sorted, before the order (SPEC3-XI §2.3.3). The lines'
  // tiers never change, so reading them unlocked is enough; every increment
  // below is then a write under a lock already held.
  const lines = await tx.orderItem.findMany({
    where: { orderId: given.id },
    select: { ticketTypeId: true },
  })

  await lockTicketTypes(
    tx,
    lines.map((line) => line.ticketTypeId),
  )

  const { count } = await tx.order.updateMany({
    where: { id: given.id, status: 'PENDING' },
    data: { status: 'PAID', paidAt: now },
  })

  // Somebody else already settled this order. Do nothing: not a second set of
  // tickets, not a second audit row, not a second inventory decrement.
  if (count === 0) return { settled: false }

  // The order as it stands, for how it is paid: a caller may hold a narrower
  // copy (the webhook's, the reconciliation's).
  const order = await tx.order.findUnique({ where: { id: given.id } })
  const atVenue = order.paymentMethod === 'AT_VENUE'
  const items = await tx.orderItem.findMany({ where: { orderId: order.id } })

  // The seats first, so a ticket can be minted against the seat it admits to.
  // A ticket issued before the seat was sold would have to be updated
  // afterwards, and an update is a second chance to get it wrong.
  const soldSeats = await sellHeldSeats(tx, { orderId: order.id })

  // Every seat checkout reserved for this order is sold to it now, or nothing
  // is. A seat hold that stopped being ACTIVE before settlement sells nothing,
  // and issuing the tickets anyway would mint seatless tickets for a paid
  // seated order while its seats went back on sale. The expiry sweep, the
  // reclaim and `holds.release` all leave a PENDING order's holds alone, so
  // this is the backstop: refusing rolls the settlement back, as the
  // unclaimed-seat check in `sellHeldSeats` does, and the order stays PENDING
  // with a reconciliation task opened for it (`recordUnsettledCapture`).
  const reservedSeats = await tx.holdItem.count({
    where: { orderItemId: { in: items.map((item) => item.id) }, eventSeatId: { not: null } },
  })

  if (soldSeats < reservedSeats) {
    throw Object.assign(
      new Error(
        `Order ${order.id} reserved ${reservedSeats} seat(s), but only ${soldSeats} were still held for it; refusing to issue tickets without their seats`,
      ),
      { code: 'SEATS_NOT_HELD' },
    )
  }

  for (const item of items) {
    const seats = soldSeats
      ? await tx.eventSeat.findMany({
          where: { orderItemId: item.id },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      : []

    // The names typed at checkout: a seat's travels on its hold item, a
    // general-admission line's on the line, in the order they were given. A
    // ticket nobody named carries the buyer's name, as every ticket did before
    // names could be given.
    const seatNames = seats.length
      ? new Map(
          (
            await tx.holdItem.findMany({
              where: { orderItemId: item.id, eventSeatId: { not: null } },
              select: { eventSeatId: true, attendeeName: true },
            })
          )
            .filter((held) => held.attendeeName)
            .map((held) => [held.eventSeatId, held.attendeeName]),
        )
      : new Map()
    const lineNames = Array.isArray(item.attendeeNames) ? item.attendeeNames : []
    // Each ticket's share of its line's door price, in issue order, the first
    // tickets taking the extra cent (SPEC3 §6.1): the tickets sum to the line.
    const shares = atVenue
      ? splitAcrossTickets(item.venueDueCents ?? 0, item.quantity)
      : Array.from({ length: item.quantity }, () => 0)

    for (let index = 0; index < item.quantity; index += 1) {
      const eventSeatId = seats[index]?.id ?? null

      await issueTicket(tx, {
        orderItemId: item.id,
        eventSeatId,
        attendeeName:
          (eventSeatId ? seatNames.get(eventSeatId) : null) ?? lineNames[index] ?? order.buyerName,
        ownerUserId: order.userId ?? null,
        generateTicketCode,
        credentialSecret,
        now,
        venueDueCents: shares[index],
      })
    }
  }

  // The sold counts, one tier at a time in id order, under the tier locks
  // taken first. The lines come back in whatever order the database finds
  // them; the locks are already held, in `lockTicketTypes`' order, so this is
  // a write and no longer a lock taken out of order.
  for (const item of [...items].sort(byTicketTypeId)) {
    await tx.ticketType.update({
      where: { id: item.ticketTypeId },
      data: { quantitySold: { increment: item.quantity } },
    })
  }

  // The names are on the tickets now, which is where they are kept (and where
  // a redaction finds them). The staging copies go in the same commit.
  await clearAttendeeStaging(tx, { orderId: order.id, itemIds: items.map((item) => item.id) })

  await tx.ticketHold.updateMany({
    where: { orderId: order.id, status: 'ACTIVE' },
    data: { status: 'CONVERTED' },
  })

  // The ledger, last, and inside the same transaction. A payment recorded with
  // no ledger entry is money the business cannot see; a ledger entry with no
  // payment is money it imagines. Both are avoided by making them one commit.
  //
  // Idempotency is the batch's, not this function's: `postBatch` keys on the
  // order, so a settlement that somehow ran twice would post once. The
  // conditional update above already makes that unreachable, which is the point
  // — two independent reasons, so a change to one does not silently remove the
  // protection.
  await postOrderLedger(tx, { order, payment, now, actorId })

  // A zero-total order has no payment attempt to settle.
  if (payment) {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        providerRef: result.intent?.id ?? result.providerRef ?? payment.providerRef,
        rawProviderStatus: result.rawStatus,
        settledAt: now,
        reconciliationRequired: false,
      },
    })
  }

  // A booking that used a referral code and whose event was cancelled while it
  // was being completed (a zero-online booking settling behind, or after, the
  // cancellation that found it still PENDING) ended without being used: its
  // use goes back now (SPEC3-XI XR4). The evaluation reads the event's
  // committed status; any other booking stands and keeps its use. After the
  // last write to the order, its lines, seats and tickets, so the code is the
  // last row lock.
  if (order.referralCodeId) {
    await settleReferralUsesIfEnded(tx, {
      entries: [{ orderId: order.id, cause: 'EVENT_CANCELLED' }],
      actorId,
      requestId,
      now,
    })
  }

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.ORDER_PAID,
    entityType: 'Order',
    entityId: order.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      previousStatus: 'PENDING',
      newStatus: 'PAID',
      paymentId: payment?.id ?? null,
      totalCents: order.totalCents,
      currency: order.currency,
      // How it was paid and what its booking fee came to (SPEC3 §4.3): the
      // code's id, never its text.
      paymentMethod: order.paymentMethod ?? 'CARD',
      feeSource: order.feeSource ?? 'SITE_DEFAULT',
      feeGrossCents: order.feeGrossCents ?? order.feesCents ?? 0,
      feeWaivedCents: order.feeWaivedCents ?? 0,
      referralCodeId: order.referralCodeId ?? null,
      venueDueCents: order.venueDueCents ?? 0,
    },
  })

  return { settled: true }
}

/**
 * Clear the names staged for an order's tickets.
 *
 * Names typed at checkout wait on the order line (general admission) and on
 * the hold item (a seat) until the tickets are issued, and not a moment
 * longer: after settlement they are on the tickets, and after a cancellation
 * there are no tickets to put them on.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {string} options.orderId The order.
 * @param {string[]} [options.itemIds] Its line ids, when already loaded.
 * @returns {Promise<void>} Nothing.
 */
export async function clearAttendeeStaging(tx, { orderId, itemIds }) {
  const ids =
    itemIds ??
    (await tx.orderItem.findMany({ where: { orderId }, select: { id: true } })).map(
      (item) => item.id,
    )

  await tx.orderItem.updateMany({
    where: { orderId, attendeeNames: { isEmpty: false } },
    data: { attendeeNames: [] },
  })

  if (ids.length > 0) {
    await tx.holdItem.updateMany({
      where: { orderItemId: { in: ids }, attendeeName: { not: null } },
      data: { attendeeName: null },
    })
  }
}

/**
 * Undo a checkout whose payment did not succeed.
 *
 * The order is cancelled and the attempt recorded as failed. Holds are left
 * ACTIVE on purpose: the buyer's reservation survives so they can retry with
 * another card instead of losing their seats to the person behind them.
 *
 * A promo code the order used is given its use back, conditionally so a count
 * can never go below zero: a declined card must not burn a limited code. A
 * referral code's use goes back too, once (`PAYMENT_FAILED`). The names staged
 * for the tickets are cleared, since there will be no tickets.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Compensation inputs.
 * @param {object} params.order The PENDING order.
 * @param {object} params.payment The payment attempt row.
 * @param {string|null} params.failureCode The provider's decline code.
 * @param {Date} params.now Compensation instant.
 * @param {string|null} [params.actorId] Actor for the audit trail.
 * @param {string|null} [params.requestId] Request id for the audit trail.
 * @returns {Promise<{compensated: boolean}>} Whether this call performed the transition.
 */
export async function compensateCheckout(
  tx,
  { order, payment, failureCode, now, actorId = null, requestId = null },
) {
  // The tiers and the night ahead of the order (SPEC3-XI §2.1): the order is
  // written twice when its referral use goes back.
  await lockAheadOfOrder(tx, order)

  const { count } = await tx.order.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'CANCELLED', cancelledAt: now },
  })

  if (count === 0) return { compensated: false }

  await tx.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED', failureCode, rawProviderStatus: 'FAILED', settledAt: now },
  })

  const promoCodeId = order.promoCodeId ?? null
  const returned = promoCodeId
    ? await tx.promoCode.updateMany({
        where: { id: promoCodeId, redemptionCount: { gt: 0 } },
        data: { redemptionCount: { decrement: 1 } },
      })
    : { count: 0 }

  await clearAttendeeStaging(tx, { orderId: order.id })

  // A declined card must not burn a referral code's use either: the order
  // ended without being used, so its use goes back, once (SPEC3-XI XR4),
  // after the transaction's last write to the order and its lines.
  await settleReferralUsesIfEnded(tx, {
    entries: [{ orderId: order.id, cause: 'PAYMENT_FAILED' }],
    actorId,
    requestId,
    now,
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.ORDER_CANCELLED,
    entityType: 'Order',
    entityId: order.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      previousStatus: 'PENDING',
      newStatus: 'CANCELLED',
      paymentId: payment.id,
      failureCode,
      reason: 'PAYMENT_DECLINED',
      promoRedemptionReturned: returned.count > 0,
    },
  })

  return { compensated: true }
}

/**
 * Record a capture the order could not be completed for.
 *
 * Settlement runs after the provider has taken the money, and it can still
 * refuse: its seat backstop, or a database fault. Rolling it back leaves the
 * order PENDING and the attempt INITIATED — a charge nothing would ever look
 * at, since nothing sweeps INITIATED payments. So, in a fresh transaction, the
 * attempt is marked for reconciliation with the provider's reference and a
 * task is opened for somebody to settle or refund it; the order stays PENDING,
 * which keeps its holds its own (see `resolveHolds` and `holds.release`) until
 * that is decided. Nothing here calls the provider or guesses the outcome.
 *
 * A zero-total order has no payment and nothing was taken, so there is
 * nothing to reconcile: it is cancelled instead, which gives its holds back to
 * the buyer, its promo use back to the code and its referral use back
 * (`NOT_COMPLETED`).
 *
 * Conditional on the order still being PENDING and the attempt still
 * INITIATED, so a settlement that did land (a webhook, say) is never undone.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.order The PENDING order.
 * @param {object|null} params.payment The payment attempt row, or null for a zero-total order.
 * @param {object} params.result The capture result.
 * @param {string} params.reason Why settlement refused, for the task. Never shown to the buyer.
 * @param {Date} params.now Instant.
 * @param {string|null} [params.actorId] Actor for the audit trail.
 * @param {string|null} [params.requestId] Request id for the audit trail.
 * @returns {Promise<{recorded: boolean}>} Whether this call wrote anything.
 */
export async function recordUnsettledCapture(
  tx,
  { order, payment, result, reason, now, actorId = null, requestId = null },
) {
  const current = await tx.order.findUnique({
    where: { id: order.id },
    select: { status: true },
  })

  if (current?.status !== 'PENDING') return { recorded: false }

  if (!payment) {
    // The tiers and the night ahead of the order (SPEC3-XI §2.1): a deletion
    // or a night's cancellation cancels this same PENDING order while holding
    // both, and the order is written twice when its referral use goes back.
    await lockAheadOfOrder(tx, order)

    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: now },
    })

    if (count === 0) return { recorded: false }

    const promoCodeId = order.promoCodeId ?? null
    const returned = promoCodeId
      ? await tx.promoCode.updateMany({
          where: { id: promoCodeId, redemptionCount: { gt: 0 } },
          data: { redemptionCount: { decrement: 1 } },
        })
      : { count: 0 }

    await clearAttendeeStaging(tx, { orderId: order.id })

    // A booking that could not be completed gives its referral use back, once
    // (SPEC3-XI XR4): it had no payment, and nothing was taken.
    await settleReferralUsesIfEnded(tx, {
      entries: [{ orderId: order.id, cause: 'NOT_COMPLETED' }],
      actorId,
      requestId,
      now,
    })

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.ORDER_CANCELLED,
      entityType: 'Order',
      entityId: order.id,
      actorId,
      metadata: {
        requestId,
        at: now.toISOString(),
        previousStatus: 'PENDING',
        newStatus: 'CANCELLED',
        paymentId: null,
        reason: 'SETTLEMENT_FAILED',
        promoRedemptionReturned: returned.count > 0,
      },
    })

    return { recorded: true }
  }

  const providerRef = result.intent?.id ?? result.providerRef ?? payment.providerRef ?? null

  const { count } = await tx.payment.updateMany({
    where: { id: payment.id, status: 'INITIATED' },
    data: {
      reconciliationRequired: true,
      providerRef,
      rawProviderStatus: result.rawStatus ?? null,
    },
  })

  if (count === 0) return { recorded: false }

  const event = await tx.event.findUnique({
    where: { id: order.eventId },
    select: { organizationId: true },
  })

  const task = await openReconciliation(tx, {
    kind: 'PROVIDER_MISMATCH',
    paymentId: payment.id,
    orderId: order.id,
    providerRef,
    organizationId: event?.organizationId ?? null,
    localState: {
      orderStatus: 'PENDING',
      paymentStatus: 'INITIATED',
      totalCents: order.totalCents,
      currency: order.currency,
      at: now.toISOString(),
    },
    providerState: { status: result.rawStatus ?? null, captured: true },
    lastError: `the provider captured the charge but the order could not be completed: ${reason}`,
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.RECONCILIATION_OPENED,
    entityType: 'Payment',
    entityId: payment.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: order.id,
      taskId: task.id,
      kind: 'PROVIDER_MISMATCH',
      orderStatus: 'PENDING',
      totalCents: order.totalCents,
      currency: order.currency,
      reason: 'CAPTURED_NOT_SETTLED',
    },
  })

  return { recorded: true }
}

/**
 * Record an ambiguous provider timeout.
 *
 * The order stays PENDING and the payment is flagged for reconciliation. It is
 * deliberately *not* cancelled: the charge may have succeeded, and cancelling
 * would either strand a buyer who paid or trigger a refund for money that was
 * never taken. A human or a reconciliation job resolves it against the provider.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.order The PENDING order.
 * @param {object} params.payment The payment attempt row.
 * @param {object} params.result The capture result.
 * @param {Date} params.now Instant.
 * @param {string|null} [params.actorId] Actor for the audit trail.
 * @param {string|null} [params.requestId] Request id for the audit trail.
 * @returns {Promise<void>} Nothing.
 */
export async function recordCaptureTimeout(
  tx,
  { order, payment, result, now, actorId = null, requestId = null },
) {
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'TIMEOUT',
      reconciliationRequired: true,
      rawProviderStatus: result.rawStatus,
      providerRef: result.providerRef ?? payment.providerRef,
    },
  })

  // A flag nothing reads is not a queue. `reconciliationRequired` marked the
  // payment, and until this line there was no work item for anybody to find, so
  // an ambiguous charge sat in the database waiting to be noticed. The task
  // carries what we believed at the time, verbatim: a later fix should not erase
  // what the problem looked like.
  await openReconciliation(tx, {
    kind: 'PAYMENT_TIMEOUT',
    paymentId: payment.id,
    orderId: order.id,
    providerRef: result.providerRef ?? payment.providerRef ?? null,
    localState: {
      orderStatus: 'PENDING',
      paymentStatus: 'TIMEOUT',
      totalCents: order.totalCents,
      currency: order.currency,
      at: now.toISOString(),
    },
    lastError: 'the provider did not answer; the charge may or may not have succeeded',
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.PAYMENT_TIMEOUT,
    entityType: 'Payment',
    entityId: payment.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: order.id,
      orderStatus: 'PENDING',
      totalCents: order.totalCents,
      currency: order.currency,
      reason: 'PROVIDER_TIMEOUT_REQUIRES_RECONCILIATION',
    },
  })
}
