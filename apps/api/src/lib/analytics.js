/**
 * Organiser analytics: what an organisation sold, holds, owes and let in.
 *
 * ## Two kinds of number, and they come from different places
 *
 * **Money comes from the ledger.** Not from `Order.totalCents`, which is written
 * once at checkout and never corrected, and not from `OrderItem.subtotalCents`.
 * Summing either gives a figure that looks like revenue and is not one, because
 * neither knows about a refund, a chargeback or a waived fee. Every monetary
 * total here is {@link module:@desi-event/api/lib/finance-reporting}'s, which
 * derives it from `LedgerEntry`.
 *
 * **Counts come from the rows that are the fact.** How many tickets exist, how
 * many seats are free, how many people came through the door — those are not
 * accounting questions and the ledger does not answer them. `Ticket`,
 * `EventSeat`, `CheckIn` and `TicketType.quantitySold` are the fact, and a
 * ledger-derived proxy for them would be a worse answer, not a purer one.
 *
 * Mixing the two is the mistake this split exists to prevent: "tickets sold ×
 * face value" is not revenue, and a screen that prints it next to a
 * ledger-derived total invites somebody to reconcile two numbers that were
 * never the same measurement.
 *
 * ## Currency
 *
 * Every monetary figure is scoped to one currency, and the caller names it.
 * There is no "all currencies" total here and there will not be one: adding
 * 100 INR to 100 GBP produces 200 of nothing. Sales broken down by ticket type
 * carry their own currency and are grouped by it, so a mixed-currency
 * organisation reads two groups rather than one wrong number.
 *
 * ## Time
 *
 * Every window and every date bucket is **UTC**, and the payload says so in
 * `timeZone`. Bucketing by a venue's local day would be more useful and would
 * need the venue's zone per row; doing it in UTC and *saying* UTC is honest,
 * and doing it in local time silently would not be.
 *
 * ## What is not here
 *
 * A view-to-purchase conversion funnel. Nothing in this repository records a
 * page view or an anonymous session, so the top of that funnel does not exist
 * and cannot be inferred. What {@link conversionFunnel} reports instead is the
 * part that *is* recorded — holds taken, orders created, orders paid — and it
 * is labelled as that rather than as a funnel with a missing first step.
 *
 * @module @desi-event/api/lib/analytics
 */

import { financeSummary } from './finance-reporting.js'

/**
 * Ticket states that mean a ticket exists and has not been given up.
 *
 * `CHECKED_IN` is included: somebody who came through the door is holding a
 * ticket that was sold, and excluding them would make "tickets sold" fall
 * during an event.
 *
 * @type {ReadonlyArray<string>}
 */
export const LIVE_TICKET_STATES = Object.freeze([
  'VALID',
  'TRANSFER_PENDING',
  'CHECKED_IN',
  'TRANSFERRED',
])

/**
 * Ticket states that mean the ticket is gone and why.
 *
 * Reported separately rather than netted off, because "sold 400, revoked 3" and
 * "sold 397" are different facts and an organiser chasing a complaint needs the
 * first.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const LOST_TICKET_STATES = Object.freeze({
  REVOKED: 'Withdrawn by an organiser',
  REFUNDED: 'Given back to the buyer',
  CANCELLED: 'Cancelled with the event',
  VOID: 'Voided',
  SUPERSEDED: 'Replaced by a reissue',
})

/** Refund states that are asked for and not yet resolved. */
export const REFUND_PENDING_STATES = Object.freeze([
  'REQUESTED',
  'APPROVED',
  'SUBMITTED',
  'PROCESSING',
  'TIMEOUT',
  'RECONCILIATION_REQUIRED',
])

/** Dispute states in which the money is still being argued over. */
export const DISPUTE_OPEN_STATES = Object.freeze([
  'OPENED',
  'NEEDS_RESPONSE',
  'UNDER_REVIEW',
  'WARNING_NEEDS_RESPONSE',
])

/** The largest number of grouped rows any one breakdown returns. */
export const BREAKDOWN_LIMIT = 200

/**
 * The window a request asked for, as two instants or nulls.
 *
 * @param {object} params Inputs.
 * @param {Date|null} [params.from] Inclusive lower bound.
 * @param {Date|null} [params.to] Exclusive upper bound.
 * @returns {object} A Prisma filter fragment, possibly empty.
 */
function createdWithin({ from, to }) {
  if (!from && !to) return {}

  return { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
}

/**
 * The events this query covers.
 *
 * Always organisation-scoped. `eventId` and `eventSessionId` narrow it further;
 * neither widens it, and neither is trusted to carry the organisation — a
 * caller who could name an event id and have it override the organisation
 * would be a caller who could read another organisation's sales.
 *
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose events.
 * @param {string|null} [params.eventId] One event.
 * @returns {object} A Prisma `Event` filter.
 */
function eventScope({ organizationId, eventId = null }) {
  return { organizationId, ...(eventId ? { id: eventId } : {}) }
}

/**
 * Money, as the ledger has it.
 *
 * A thin pass-through so that every monetary figure on the analytics screen and
 * every monetary figure on the finance screen are the same function's output.
 * Two derivations of "what is this organisation owed" would eventually
 * disagree, and the disagreement would surface as a support ticket rather than
 * as a test failure.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose money.
 * @param {string} params.currency Which currency.
 * @param {Date|null} [params.from] Window start.
 * @param {Date|null} [params.to] Window end.
 * @returns {Promise<object>} The finance summary for this organisation.
 */
export async function moneyTotals(prisma, { organizationId, currency, from = null, to = null }) {
  return financeSummary(prisma, { organizationId, currency, from, to })
}

/**
 * How many tickets exist, and how many have stopped existing.
 *
 * Counted from `Ticket`, which is the fact. `TicketType.quantitySold` is a
 * denormalised counter kept in step inside the selling transaction, and it is
 * the right source for *availability* — but it counts what was sold, not what
 * survived, so it cannot answer "how many were revoked".
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs, as {@link eventScope} plus a window.
 * @returns {Promise<{live: number, byLostState: Array<{state: string, label: string, count: number}>, lost: number}>} The counts.
 */
export async function ticketCounts(prisma, params) {
  const where = {
    orderItem: { order: { event: eventScope(params) } },
    ...createdWithin(params),
  }

  const grouped = await prisma.ticket.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  })

  const countFor = (status) => grouped.find((row) => row.status === status)?._count?._all ?? 0

  const live = LIVE_TICKET_STATES.reduce((sum, status) => sum + countFor(status), 0)
  const byLostState = Object.entries(LOST_TICKET_STATES).map(([state, label]) => ({
    state,
    label,
    count: countFor(state),
  }))

  return {
    live,
    byLostState,
    lost: byLostState.reduce((sum, row) => sum + row.count, 0),
  }
}

/**
 * General-admission inventory, per ticket type.
 *
 * `quantityTotal` less `quantitySold` is the remaining figure the selling path
 * itself uses, so this screen and the checkout agree about what is left. A
 * screen that recomputed it from `Ticket` rows would drift from the counter the
 * conditional `UPDATE` actually guards, and the drift would appear as an
 * oversell that never happened.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs, as {@link eventScope}.
 * @returns {Promise<Array<object>>} One row per non-reserved ticket type.
 */
export async function generalAdmissionInventory(prisma, params) {
  const types = await prisma.ticketType.findMany({
    where: { reserved: false, event: eventScope(params) },
    select: {
      id: true,
      name: true,
      currency: true,
      priceCents: true,
      quantityTotal: true,
      quantitySold: true,
      status: true,
      eventId: true,
      eventSessionId: true,
    },
    orderBy: [{ eventId: 'asc' }, { sortOrder: 'asc' }],
    take: BREAKDOWN_LIMIT,
  })

  return types.map((type) => ({
    ticketTypeId: type.id,
    name: type.name,
    currency: type.currency,
    priceCents: type.priceCents,
    status: type.status,
    eventId: type.eventId,
    eventSessionId: type.eventSessionId,
    quantityTotal: type.quantityTotal,
    quantitySold: type.quantitySold,
    // Never negative on screen. A negative remainder would mean the counter and
    // the total disagree, which is a defect to investigate rather than a number
    // to print as "-3 left".
    quantityRemaining: Math.max(0, type.quantityTotal - type.quantitySold),
    oversold: type.quantitySold > type.quantityTotal,
  }))
}

/**
 * Reserved-seat inventory, grouped by section and by price zone.
 *
 * Two groupings of the same seats rather than one nested structure: an
 * organiser asks "how is the stalls doing" and "how is the £40 tier doing", and
 * those are different questions over the same rows. A seat with no price zone
 * is reported under `null` rather than dropped — an unzoned seat is a real
 * seat somebody can sit in, and hiding it would understate capacity.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs, as {@link eventScope}.
 * @returns {Promise<{bySection: Array<object>, byPriceZone: Array<object>, statuses: Array<string>}>} The groupings.
 */
export async function reservedSeatInventory(prisma, params) {
  const seats = await prisma.eventSeat.findMany({
    where: { eventSession: { event: eventScope(params) } },
    select: {
      status: true,
      seat: {
        select: {
          section: { select: { id: true, name: true } },
          priceZone: { select: { id: true, name: true } },
        },
      },
    },
  })

  /**
   * Fold seats into one grouping.
   *
   * @param {Function} keyOf Pulls the group key and label off a seat.
   * @returns {Array<object>} One row per group, with a count per status.
   */
  const group = (keyOf) => {
    const groups = new Map()

    for (const seat of seats) {
      const { id, name } = keyOf(seat)
      const key = id ?? ' unzoned'

      if (!groups.has(key)) {
        groups.set(key, { id: id ?? null, name: name ?? 'No zone', total: 0, byStatus: {} })
      }

      const entry = groups.get(key)

      entry.total += 1
      entry.byStatus[seat.status] = (entry.byStatus[seat.status] ?? 0) + 1
    }

    return [...groups.values()]
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      .slice(0, BREAKDOWN_LIMIT)
      .map((entry) => ({
        ...entry,
        available: entry.byStatus.AVAILABLE ?? 0,
        held: entry.byStatus.HELD ?? 0,
        sold: entry.byStatus.SOLD ?? 0,
        blocked: entry.byStatus.BLOCKED ?? 0,
      }))
  }

  return {
    bySection: group((seat) => seat.seat?.section ?? { id: null, name: 'No section' }),
    byPriceZone: group((seat) => seat.seat?.priceZone ?? { id: null, name: 'No zone' }),
    statuses: ['AVAILABLE', 'HELD', 'SOLD', 'BLOCKED', 'COMPLIMENTARY', 'KILLED'],
  }
}

/**
 * What was sold, grouped four ways.
 *
 * Quantities and order-line values, **not** revenue — and the distinction is
 * the reason the field is called `lineValueCents` rather than `revenueCents`.
 * An order line's value is what it was priced at; what the organisation
 * actually keeps is in {@link moneyTotals}, after fees, tax and everything
 * given back. Naming this one "revenue" is how a screen ends up with two
 * numbers that should agree and do not.
 *
 * Only `PAID` orders are counted. A pending order is a basket, and a cancelled
 * or expired one never happened.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs, as {@link eventScope} plus a window and currency.
 * @returns {Promise<object>} Four breakdowns, each bounded.
 */
export async function salesBreakdowns(prisma, params) {
  const { currency } = params
  const orderWhere = {
    status: 'PAID',
    ...(currency ? { currency } : {}),
    event: eventScope(params),
    ...(params.eventSessionId ? { eventSessionId: params.eventSessionId } : {}),
    ...createdWithin(params),
  }

  const items = await prisma.orderItem.findMany({
    where: { order: orderWhere },
    select: {
      quantity: true,
      subtotalCents: true,
      refundedQuantity: true,
      refundedCents: true,
      ticketType: { select: { id: true, name: true, currency: true } },
      order: {
        select: {
          id: true,
          currency: true,
          paidAt: true,
          createdAt: true,
          eventId: true,
          eventSessionId: true,
          event: { select: { id: true, title: true } },
          eventSession: { select: { id: true, startsAt: true } },
        },
      },
    },
  })

  /**
   * Fold order lines into one grouping.
   *
   * @param {Function} keyOf Returns `{key, label, currency, extra}` for a line.
   * @returns {Array<object>} Bounded, sorted rows.
   */
  const fold = (keyOf) => {
    const groups = new Map()

    for (const item of items) {
      const shape = keyOf(item)

      if (!shape) continue

      const key = `${shape.key} ${shape.currency}`

      if (!groups.has(key)) {
        groups.set(key, {
          id: shape.key,
          label: shape.label,
          currency: shape.currency,
          quantity: 0,
          lineValueCents: 0,
          refundedQuantity: 0,
          refundedCents: 0,
          ...(shape.extra ?? {}),
        })
      }

      const entry = groups.get(key)

      entry.quantity += item.quantity
      entry.lineValueCents += item.subtotalCents
      entry.refundedQuantity += item.refundedQuantity
      entry.refundedCents += item.refundedCents
    }

    return [...groups.values()]
      .sort((a, b) => b.lineValueCents - a.lineValueCents || a.label.localeCompare(b.label))
      .slice(0, BREAKDOWN_LIMIT)
  }

  const byDate = new Map()

  for (const item of items) {
    // The instant the money was taken, not the instant the basket was made. An
    // order created on Tuesday and paid on Wednesday is a Wednesday sale.
    const at = item.order.paidAt ?? item.order.createdAt
    const day = at.toISOString().slice(0, 10)
    const key = `${day} ${item.order.currency}`

    if (!byDate.has(key)) {
      byDate.set(key, {
        id: day,
        label: day,
        currency: item.order.currency,
        quantity: 0,
        lineValueCents: 0,
        refundedQuantity: 0,
        refundedCents: 0,
      })
    }

    const entry = byDate.get(key)

    entry.quantity += item.quantity
    entry.lineValueCents += item.subtotalCents
    entry.refundedQuantity += item.refundedQuantity
    entry.refundedCents += item.refundedCents
  }

  return {
    byEvent: fold((item) => ({
      key: item.order.event.id,
      label: item.order.event.title,
      currency: item.order.currency,
    })),
    bySession: fold((item) =>
      item.order.eventSession
        ? {
            key: item.order.eventSession.id,
            // A session has no name in this schema, so it is labelled by when it
            // starts. Inventing "Session 1" would be inventing a field.
            label: item.order.eventSession.startsAt.toISOString(),
            currency: item.order.currency,
            extra: { startsAt: item.order.eventSession.startsAt },
          }
        : null,
    ),
    byTicketType: fold((item) => ({
      key: item.ticketType.id,
      label: item.ticketType.name,
      currency: item.ticketType.currency,
    })),
    byDate: [...byDate.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, BREAKDOWN_LIMIT),
  }
}

/**
 * How many of the tickets that exist have come through a door.
 *
 * `CheckIn` rows rather than `Ticket.status === 'CHECKED_IN'`, because the
 * attendance row is the one the unique index protects and the one an organiser
 * would be shown if somebody disputed being let in.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs, as {@link eventScope}.
 * @returns {Promise<{admitted: number, live: number, percent: number|null}>} The progress.
 */
export async function checkInProgress(prisma, params) {
  const scope = { orderItem: { order: { event: eventScope(params) } } }

  const [admitted, live] = await Promise.all([
    prisma.checkIn.count({ where: { ticket: scope } }),
    prisma.ticket.count({ where: { ...scope, status: { in: [...LIVE_TICKET_STATES] } } }),
  ])

  return {
    admitted,
    live,
    // Null rather than zero when there is nothing to admit. "0% checked in"
    // reads as a problem; "no tickets yet" is the truth.
    percent: live === 0 ? null : Math.round((admitted / live) * 1000) / 10,
  }
}

/**
 * Transfers and revocations, counted by what happened to them.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs, as {@link eventScope} plus a window.
 * @returns {Promise<{transfers: Array<{status: string, count: number}>, revoked: number}>} The counts.
 */
export async function ticketMovement(prisma, params) {
  const scope = { ticket: { orderItem: { order: { event: eventScope(params) } } } }

  const [transfers, revoked] = await Promise.all([
    prisma.ticketTransfer.groupBy({
      by: ['status'],
      where: { ...scope, ...createdWithin(params) },
      _count: { _all: true },
    }),
    prisma.ticket.count({
      where: {
        orderItem: { order: { event: eventScope(params) } },
        status: 'REVOKED',
      },
    }),
  ])

  return {
    transfers: ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'].map((status) => ({
      status,
      count: transfers.find((row) => row.status === status)?._count?._all ?? 0,
    })),
    revoked,
  }
}

/**
 * What the outbox did with this organisation's messages.
 *
 * Counts only. Recipients and payloads are not analytics — an organiser needs
 * to know that eleven cancellation notices failed, not who they were to.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose messages.
 * @param {Date|null} [params.from] Window start.
 * @param {Date|null} [params.to] Window end.
 * @returns {Promise<Array<{status: string, count: number}>>} One row per status.
 */
export async function notificationDelivery(prisma, params) {
  const grouped = await prisma.notificationOutbox.groupBy({
    by: ['status'],
    where: { organizationId: params.organizationId, ...createdWithin(params) },
    _count: { _all: true },
  })

  return ['QUEUED', 'CLAIMED', 'SENDING', 'SENT', 'RETRY_SCHEDULED', 'FAILED', 'DEAD_LETTER']
    .map((status) => ({
      status,
      count: grouped.find((row) => row.status === status)?._count?._all ?? 0,
    }))
    .filter((row, index, rows) => row.count > 0 || index < 4 || rows.some((r) => r.count > 0))
}

/**
 * Reconciliation items that touch this organisation's money.
 *
 * Counts and ages, never the provider payload. An organiser is entitled to know
 * that two of their payments are in an unknown state; the evidence behind them
 * is an operations matter and lives on the operations detail screen, behind a
 * platform capability.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose.
 * @param {Date} params.now For ageing.
 * @returns {Promise<{open: number, escalated: number, oldestOpenedAt: Date|null}>} The exceptions.
 */
export async function reconciliationExceptions(prisma, { organizationId, now }) {
  const [open, escalated, oldest] = await Promise.all([
    prisma.reconciliationTask.count({
      where: { organizationId, state: { in: ['OPEN', 'IN_PROGRESS'] } },
    }),
    prisma.reconciliationTask.count({ where: { organizationId, state: 'ESCALATED' } }),
    prisma.reconciliationTask.findFirst({
      where: { organizationId, state: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ])

  return {
    open,
    escalated,
    oldestOpenedAt: oldest?.createdAt ?? null,
    oldestAgeHours: oldest
      ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / 3_600_000)
      : null,
  }
}

/**
 * The part of the funnel this repository actually records.
 *
 * **There is no view-to-purchase funnel here, and there cannot be one.** Nothing
 * records a page view or an anonymous browsing session, so the step everybody
 * means by "conversion" — people who looked — does not exist as data. Inventing
 * it from order counts would be inventing a metric.
 *
 * What is recorded is what somebody did once they committed to something: a
 * hold taken, an order created against it, and an order paid. Three real
 * counts over three real tables, labelled as what they are.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs, as {@link eventScope} plus a window.
 * @returns {Promise<{steps: Array<{key: string, label: string, count: number}>, missing: Array<string>}>} The funnel and what it cannot show.
 */
export async function conversionFunnel(prisma, params) {
  const scope = eventScope(params)
  const window = createdWithin(params)

  const [holds, ordersCreated, ordersPaid] = await Promise.all([
    prisma.ticketHold.count({ where: { ticketType: { event: scope }, ...window } }),
    prisma.order.count({ where: { event: scope, ...window } }),
    prisma.order.count({ where: { event: scope, status: 'PAID', ...window } }),
  ])

  return {
    steps: [
      { key: 'holds', label: 'Tickets held', count: holds },
      { key: 'ordersCreated', label: 'Orders started', count: ordersCreated },
      { key: 'ordersPaid', label: 'Orders paid', count: ordersPaid },
    ],
    // Named rather than omitted. A funnel with a silently missing first step is
    // a funnel somebody will read as complete.
    missing: [
      'Page views and browsing sessions are not recorded anywhere in this system, so the step before a hold cannot be counted and is not estimated.',
    ],
  }
}

/**
 * The whole analytics payload, in one call.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose analytics. Required, always.
 * @param {string} params.currency Which currency the money figures are in.
 * @param {string|null} [params.eventId] Narrow to one event.
 * @param {string|null} [params.eventSessionId] Narrow sales to one session.
 * @param {Date|null} [params.from] Window start, UTC.
 * @param {Date|null} [params.to] Window end, UTC.
 * @param {Date} params.now For ageing.
 * @returns {Promise<object>} Money, inventory, attendance and operations.
 */
export async function organizerAnalytics(prisma, params) {
  if (!params.organizationId) {
    // Defensive, and deliberately not a soft fallback to "everything". An
    // unscoped analytics query is the NF-05 inversion in a different costume.
    throw new TypeError('Organiser analytics is always scoped to one organisation.')
  }

  const [
    money,
    tickets,
    ga,
    reserved,
    sales,
    checkIns,
    movement,
    notifications,
    exceptions,
    funnel,
  ] = await Promise.all([
    moneyTotals(prisma, params),
    ticketCounts(prisma, params),
    generalAdmissionInventory(prisma, params),
    reservedSeatInventory(prisma, params),
    salesBreakdowns(prisma, params),
    checkInProgress(prisma, params),
    ticketMovement(prisma, params),
    notificationDelivery(prisma, params),
    reconciliationExceptions(prisma, params),
    conversionFunnel(prisma, params),
  ])

  return {
    money,
    tickets,
    inventory: { generalAdmission: ga, reserved },
    sales,
    checkIns,
    movement,
    notifications,
    exceptions,
    funnel,
    // Said in the payload rather than assumed by the screen, so an export and a
    // page cannot disagree about which day a sale fell on.
    timeZone: 'UTC',
    limits: { breakdownRows: BREAKDOWN_LIMIT },
  }
}
