/**
 * One pricing function for the quote and the charge.
 *
 * `POST /v1/orders/quote` tells a buyer what they will pay; `POST /v1/orders`
 * charges them. If those were two pieces of code they would drift, and a buyer
 * would be shown one figure and billed another. So both call
 * {@link priceCheckout}, which does every check and every sum the charge does:
 * the event and its tiers, hidden tiers, the night's window and capacity, the
 * holds and their seats, the tax rule, the promo code and the totals. The
 * charge calls it with `lock: true` inside the checkout transaction; the quote
 * with `lock: false` inside a transaction that writes nothing.
 *
 * ## Locks, in order
 *
 * With `lock: true` the rows are locked in the one order every checkout path
 * uses (see `session-inventory.js`): every tier, sorted; every night, sorted;
 * then the promo code. The promo row is re-read under its lock and evaluated
 * then, so a code with one use left gives one discount however many buyers race
 * for it. A `CHECK` on the table is the backstop.
 *
 * Nothing here trusts the request for a price, a seat's state or which tier a
 * seat belongs to. All three come from the database.
 *
 * @module @desi-event/api/lib/checkout-pricing
 */

import {
  authorizeHoldRelease,
  salesWindowState,
  validateQuantityRequest,
} from '@desi-event/inventory'
import {
  assertTaxPolicyUsable,
  computeOrderTotals,
  evaluatePromoCode,
  feeConfigForCurrency,
  resolveTaxPolicy,
} from '@desi-event/pricing'
import { BOOKABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { conflict, httpError, notFound, unprocessable } from './errors.js'
import { lockTicketHolds, lockTicketTypes, readAvailability } from './inventory.js'
import { pendingOrdersOf } from './seating.js'
import {
  assertSessionCapacity,
  assertSessionOnSale,
  lockEventSessions,
  mayBookHiddenTier,
} from './session-inventory.js'
import { assertSeatsCoherent, loadSeatedHoldItems, priceLines } from './seated-checkout.js'

/** `TicketTypeVisibility.HIDDEN`, inlined to avoid importing the database client. */
const HIDDEN = 'HIDDEN'

/**
 * Build the platform fee configuration for one order.
 *
 * The terms come from `@desi-event/pricing` so that the total quoted on the
 * checkout page and the total charged here are computed from the same table.
 *
 * @param {object} env The parsed API environment.
 * @param {string} currency The order currency.
 * @returns {{percentageBps: number, flatCents: number, currency: string}} A fee configuration.
 */
export function feeConfigFor(env, currency) {
  return feeConfigForCurrency(currency, {
    percentageBps: env.PLATFORM_FEE_BPS,
    flatCents: env.PLATFORM_FEE_FLAT_CENTS,
  })
}

/**
 * Take the row lock on a promo code, after the tier and night locks.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string} promoCodeId The code's id.
 * @returns {Promise<void>} Resolves once the row is locked.
 */
export async function lockPromoCode(tx, promoCodeId) {
  await tx.$queryRaw`SELECT id FROM "PromoCode" WHERE id = ${promoCodeId} FOR UPDATE`
}

/**
 * Find the promo code a checkout names, if any.
 *
 * Looked up in the event's organisation, scoped to this event or to all of the
 * organisation's events. With `lock`, the row is locked and read again, so the
 * redemption count evaluated is the committed one.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string|undefined} code The normalised code from the request.
 * @param {object} event The event being bought into.
 * @param {object} [options] Options.
 * @param {boolean} [options.lock] Whether to lock and re-read the row.
 * @returns {Promise<object|null>} The `PromoCode` row, or null when none matches.
 */
export async function findPromoCode(tx, code, event, { lock = false } = {}) {
  if (!code) return null

  const found = await tx.promoCode.findFirst({
    where: {
      code,
      organizationId: event.organizationId,
      OR: [{ eventId: event.id }, { eventId: null }],
    },
  })

  if (!found || !lock) return found

  await lockPromoCode(tx, found.id)

  // Read again under the lock: another checkout may have used it meanwhile.
  return tx.promoCode.findUnique({ where: { id: found.id } })
}

/**
 * Validate the holds a checkout request claims, and group them by ticket type.
 *
 * Ownership is checked here for the same reason it is checked on release:
 * spending a hold consumes somebody's reservation. An unowned hold answers 404
 * exactly as a non-existent one does, so this cannot be used to discover which
 * ids are real.
 *
 * A seat hold spanning two tiers is grouped under its first seat's tier (the
 * one `TicketHold.ticketTypeId` names); which tier each seat is sold under is
 * the hold item's, checked separately.
 *
 * A hold an order is waiting on belongs to that order until its payment is
 * confirmed or refused, here as in `holds.release`, the expiry sweep and the
 * seat reclaim. Spending it again — a double-submitted checkout, or a retry
 * after a capture timed out — would sell its stock twice and charge the buyer
 * twice, so it answers 409 before anything is written. With `lock`, each hold
 * row is locked first (after the tiers and the nights, before the promo code),
 * so two checkouts naming one hold take turns and the second reads the order
 * the first attached.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string[]|undefined} holdIds Hold ids from the request.
 * @param {Set<string>} ticketTypeIds Ticket type ids the order is for.
 * @param {Date} now The instant the request is being evaluated at.
 * @param {object} owner Caller identity.
 * @param {{id: string}|null} [owner.actor] The verified server actor.
 * @param {string|null} [owner.guestToken] The one-time token for a guest hold.
 * @param {object} [options] Options.
 * @param {boolean} [options.lock] Whether to lock each hold row before reading it (the charge).
 * @returns {Promise<Map<string, object[]>>} Live holds grouped by ticket type id.
 * @throws {Error} A 404 for an unknown or unowned hold, 410 for a lapsed one, 409 for one already spent or awaiting another order's payment.
 */
export async function resolveHolds(
  tx,
  holdIds,
  ticketTypeIds,
  now,
  owner = {},
  { lock = false } = {},
) {
  /** @type {Map<string, object[]>} */
  const byTicketType = new Map()

  if (!holdIds || holdIds.length === 0) return byTicketType

  if (lock) await lockTicketHolds(tx, holdIds)

  const holds = await tx.ticketHold.findMany({ where: { id: { in: holdIds } } })
  const awaitingPayment = await pendingOrdersOf(tx, holds)
  const found = new Set(holds.map((hold) => hold.id))

  for (const id of holdIds) {
    if (!found.has(id)) throw notFound(`No such hold: ${id}.`)
  }

  for (const hold of holds) {
    const { allowed } = authorizeHoldRelease({
      hold,
      actor: owner.actor,
      guestToken: owner.guestToken,
    })

    if (!allowed) throw notFound(`No such hold: ${hold.id}.`)

    if (hold.status === 'CONVERTED') {
      throw conflict(`Hold ${hold.id} has already been used for another order.`)
    }
    if (hold.status !== 'ACTIVE') {
      throw httpError(410, 'HOLD_EXPIRED', `Hold ${hold.id} is no longer active.`)
    }
    if (hold.orderId && awaitingPayment.has(hold.orderId)) {
      throw conflict(
        `Hold ${hold.id} belongs to an order whose payment is still being confirmed. It stays with that order until the payment is settled or refused; nothing has been charged for this attempt.`,
        { holdId: hold.id },
      )
    }
    if (new Date(hold.expiresAt).getTime() <= now.getTime()) {
      throw httpError(410, 'HOLD_EXPIRED', `Hold ${hold.id} expired; please try again.`)
    }
    if (!ticketTypeIds.has(hold.ticketTypeId)) {
      throw conflict(`Hold ${hold.id} is for a ticket type that is not in this order.`)
    }

    const bucket = byTicketType.get(hold.ticketTypeId) ?? []
    bucket.push(hold)
    byTicketType.set(hold.ticketTypeId, bucket)
  }

  return byTicketType
}

/**
 * Match the guests' names to the tickets they are for.
 *
 * A seat's name travels with the seat (`eventSeatId`), and must name a seat
 * this order holds, sold under the tier the name says. A general-admission name
 * names only its tier; the names for one tier go on its tickets in the order
 * they were sent. A seated tier's names must name their seats, and a general
 * one's must not.
 *
 * @param {Array<{ticketTypeId: string, eventSeatId?: string, name: string}>|undefined} attendees From the request.
 * @param {object} context What the order holds.
 * @param {Array<{ticketTypeId: string, quantity: number}>} context.items The requested lines.
 * @param {object[]} context.seatedItems Seated hold items, each with `eventSeatId` and `ticketTypeId`.
 * @param {Set<string>} context.seatedTiers Tiers sold by seat on this order.
 * @returns {{gaNamesByTicketType: Map<string, string[]>, namesByEventSeatId: Map<string, string>}} Names, staged.
 * @throws {Error} A 422 listing every problem.
 */
export function validateAttendees(attendees, { items, seatedItems, seatedTiers }) {
  /** @type {Map<string, string[]>} */
  const gaNamesByTicketType = new Map()
  /** @type {Map<string, string>} */
  const namesByEventSeatId = new Map()

  if (!attendees || attendees.length === 0) return { gaNamesByTicketType, namesByEventSeatId }

  const quantities = new Map(items.map((item) => [item.ticketTypeId, item.quantity]))
  const seatTier = new Map(seatedItems.map((item) => [item.eventSeatId, item.ticketTypeId]))
  const problems = []

  attendees.forEach((attendee, index) => {
    if (!quantities.has(attendee.ticketTypeId)) {
      problems.push(`Name ${index + 1}: that ticket type is not in this order.`)
      return
    }

    if (attendee.eventSeatId) {
      if (!seatTier.has(attendee.eventSeatId)) {
        problems.push(`Name ${index + 1}: that seat is not one this order holds.`)
        return
      }
      if (seatTier.get(attendee.eventSeatId) !== attendee.ticketTypeId) {
        problems.push(`Name ${index + 1}: that seat is sold under another ticket type.`)
        return
      }
      if (namesByEventSeatId.has(attendee.eventSeatId)) {
        problems.push(`Name ${index + 1}: that seat already has a name.`)
        return
      }

      namesByEventSeatId.set(attendee.eventSeatId, attendee.name)
      return
    }

    if (seatedTiers.has(attendee.ticketTypeId)) {
      problems.push(`Name ${index + 1}: a reserved seat is named by its seat.`)
      return
    }

    const names = gaNamesByTicketType.get(attendee.ticketTypeId) ?? []

    if (names.length >= quantities.get(attendee.ticketTypeId)) {
      problems.push(`Name ${index + 1}: more names than tickets for this ticket type.`)
      return
    }

    names.push(attendee.name)
    gaNamesByTicketType.set(attendee.ticketTypeId, names)
  })

  if (problems.length > 0) {
    // Positions only ("Name 2: …"): the names themselves are personal data
    // and do not go back into an error body that a proxy or a log may keep.
    throw unprocessable('Some of the names do not match the tickets in this order.', {
      problems,
    })
  }

  return { gaNamesByTicketType, namesByEventSeatId }
}

/**
 * The one night an order is for, when it is for one.
 *
 * A line's night is its seats' session, else its tier's; a tier good for every
 * night has none. The order names a night only when every line has the same
 * one.
 *
 * @param {Array<{ticketTypeId: string, sessionId: string|null}>} lines Priced lines with their nights.
 * @returns {string|null} The session id, or null.
 */
export function sessionOfOrder(lines) {
  const sessions = new Set(lines.map((line) => line.sessionId ?? null))

  if (sessions.size !== 1) return null

  return [...sessions][0]
}

/**
 * Why a promo code gave no discount, in the quote's vocabulary.
 *
 * @param {object|null} promoCode The row, or null for a code this organiser does not have.
 * @param {object} context Evaluation context.
 * @param {Date} context.now The moment.
 * @param {string} context.currency The order currency.
 * @returns {string|null} A `PROMO_QUOTE_REASONS` member, or null when the code applies.
 */
export function promoReason(promoCode, { now, currency }) {
  if (!promoCode) return 'UNKNOWN'

  try {
    return evaluatePromoCode({ promoCode, now, currency }).reason
  } catch {
    // A row the pricing package cannot read gives no discount; call it what a
    // buyer can act on.
    return 'INACTIVE'
  }
}

/**
 * Price a checkout: every check and every sum the charge makes.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.body The request: `eventId`, `items`, optional `holdIds`, `promoCode` and `attendees`.
 * @param {object|null} options.actor The request actor.
 * @param {string|null} [options.guestToken] A guest hold token, from `X-Hold-Token`.
 * @param {Date} options.now The moment the order is priced at.
 * @param {object} options.env The parsed API environment.
 * @param {boolean} options.lock Whether to take the checkout locks (the charge) or not (the quote).
 * @param {boolean} [options.unknownPromoIsError] Whether a code this organiser does not have is refused (the charge) or reported (the quote).
 * @returns {Promise<object>} Everything the order write, or the quote, needs.
 * @throws {Error} The same refusals the charge gives.
 */
export async function priceCheckout(
  tx,
  { body, actor, guestToken = null, now, env, lock, unknownPromoIsError = true },
) {
  const requestedIds = body.items.map((item) => item.ticketTypeId)

  // Same discipline as holds.create: lock every tier involved, in sorted
  // order so two concurrent multi-tier orders cannot deadlock, and only then
  // read anything.
  if (lock) await lockTicketTypes(tx, requestedIds)

  const event = await tx.event.findUnique({ where: { id: body.eventId } })
  if (!event) throw notFound('No such event.')
  if (!BOOKABLE_STATUSES.has(event.status)) {
    throw unprocessable('This event is not on sale.')
  }

  const ticketTypes = await tx.ticketType.findMany({ where: { id: { in: requestedIds } } })
  const byId = new Map(ticketTypes.map((ticketType) => [ticketType.id, ticketType]))
  const hiddenAllowed = mayBookHiddenTier(actor, event)

  for (const id of requestedIds) {
    const ticketType = byId.get(id)

    // A hidden tier is answered exactly as a missing one, so the endpoint does
    // not tell a stranger which tier ids exist.
    if (
      !ticketType ||
      ticketType.eventId !== event.id ||
      (ticketType.visibility === HIDDEN && !hiddenAllowed)
    ) {
      throw notFound(`No such ticket type for this event: ${id}.`)
    }
  }

  const currencies = new Set(ticketTypes.map((ticketType) => ticketType.currency))
  if (currencies.size > 1) {
    throw unprocessable('Every ticket type in an order must share one currency.')
  }
  const currency = ticketTypes[0].currency

  // The nights, locked after the tiers and before anything is read from them.
  const sessionIds = [...new Set(ticketTypes.map((tier) => tier.eventSessionId).filter(Boolean))]
  if (lock) await lockEventSessions(tx, sessionIds)

  const sessions =
    sessionIds.length === 0
      ? []
      : await tx.eventSession.findMany({ where: { id: { in: sessionIds } } })
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))

  // The holds, locked after the nights and before the promo code.
  const holdsByType = await resolveHolds(
    tx,
    body.holdIds,
    new Set(requestedIds),
    now,
    { actor, guestToken },
    { lock },
  )

  // Reserved seating, if any. Read after the row locks are held, so the seat
  // states below cannot move under the order being built, and checked before
  // anything is priced: a seat that is not this hold's to sell must not reach
  // the pricing step at all.
  const holdsById = new Map()
  for (const bucket of holdsByType.values()) {
    for (const hold of bucket) holdsById.set(hold.id, hold)
  }

  const seatedItems = await loadSeatedHoldItems(tx, [...holdsById.keys()])
  assertSeatsCoherent(seatedItems, holdsById, null)

  for (const seated of seatedItems) {
    // A hold may span tiers — a companion seat in another zone is sold under
    // its own — so every seat's tier must be a line of this order, or it would
    // be held against the order and paid for by nobody.
    if (!byId.has(seated.ticketTypeId)) {
      throw conflict(
        `Hold ${seated.holdId} has a seat for a ticket type that is not in this order.`,
        { holdId: seated.holdId, ticketTypeId: seated.ticketTypeId },
      )
    }

    const seatSession = await tx.eventSession.findUnique({
      where: { id: seated.eventSeat.eventSessionId },
      select: { eventId: true },
    })

    // A hold whose seats belong to another event's session. The trigger that
    // keeps an order's lines to one event cannot see this, because the line
    // is for a tier of the right event; only the seat is wrong.
    if (seatSession?.eventId !== event.id) {
      throw unprocessable('Those seats are not on sale at this event.', {
        seatSession: seated.eventSeat.eventSessionId,
      })
    }
  }

  /** @type {Map<string, number>} */
  const seatsHeldByTier = new Map()
  for (const seated of seatedItems) {
    seatsHeldByTier.set(seated.ticketTypeId, (seatsHeldByTier.get(seated.ticketTypeId) ?? 0) + 1)
  }
  const seatedTiers = new Set(seatsHeldByTier.keys())

  // Each night's window, once per night.
  for (const session of sessions) assertSessionOnSale(session, now)

  /** @type {Map<string, number>} */
  const generalQuantityBySession = new Map()

  for (const item of body.items) {
    const ticketType = byId.get(item.ticketTypeId)

    const windowState = salesWindowState({
      status: ticketType.status,
      salesStartAt: ticketType.salesStartAt,
      salesEndAt: ticketType.salesEndAt,
      now,
    })
    if (windowState !== 'ON_SALE') {
      throw unprocessable(`"${ticketType.name}" is not on sale.`, { windowState })
    }

    const seatsHeld = seatsHeldByTier.get(ticketType.id) ?? 0

    if (ticketType.reserved || seatsHeld > 0) {
      // A reserved tier's stock is its seats. Its quantity columns say nothing
      // (an organiser-authored one has none), so the held seats are the
      // inventory and the per-order limits apply to them.
      if (seatsHeld === 0) {
        throw unprocessable(`Choose seats for "${ticketType.name}" on the seat map.`, {
          ticketTypeId: ticketType.id,
        })
      }

      if (item.quantity !== seatsHeld) {
        throw unprocessable(
          `"${ticketType.name}" is reserved seating: you hold ${seatsHeld} seat(s), so the order must be for ${seatsHeld}.`,
          { ticketTypeId: ticketType.id, held: seatsHeld, requested: item.quantity },
        )
      }

      validateQuantityRequest({
        quantity: item.quantity,
        minPerOrder: ticketType.minPerOrder,
        maxPerOrder: ticketType.maxPerOrder,
        availableQuantity: seatsHeld,
      })
      continue
    }

    // The buyer's own holds already reserve stock for them, so they are
    // excluded from the held total rather than counted against the very
    // request they exist to protect.
    const ownHolds = holdsByType.get(ticketType.id) ?? []
    const { availableQuantity } = await readAvailability(tx, ticketType, {
      now,
      ignoreHoldIds: ownHolds.map((hold) => hold.id),
    })

    validateQuantityRequest({
      quantity: item.quantity,
      minPerOrder: ticketType.minPerOrder,
      maxPerOrder: ticketType.maxPerOrder,
      availableQuantity,
    })

    if (ticketType.eventSessionId) {
      generalQuantityBySession.set(
        ticketType.eventSessionId,
        (generalQuantityBySession.get(ticketType.eventSessionId) ?? 0) + item.quantity,
      )
    }
  }

  // A night's capacity is shared by every general-admission tier sold for it,
  // so it is checked once per night over all of this order's lines.
  const ownHoldIds = [...holdsById.keys()]
  for (const [sessionId, requested] of generalQuantityBySession) {
    await assertSessionCapacity(tx, {
      session: sessionsById.get(sessionId),
      requested,
      now,
      ignoreHoldIds: ownHoldIds,
    })
  }

  // Tax follows the jurisdiction of the supply — where the event is held —
  // not the currency it is priced in.
  const venue = event.venueId
    ? await tx.venue.findUnique({
        where: { id: event.venueId },
        select: { country: true, region: true },
      })
    : null

  const taxPolicy = resolveTaxPolicy({
    country: venue?.country ?? null,
    region: venue?.region ?? null,
    at: now,
  })

  // Fails closed in production: charging a buyer an unverified rate, and
  // telling an organiser they owe it, is worse than refusing the sale.
  assertTaxPolicyUsable(taxPolicy, {
    environment: env.NODE_ENV,
    allowDemo: env.ALLOW_DEMO_TAX_IN_PRODUCTION === true,
  })

  const promoCode = await findPromoCode(tx, body.promoCode, event, { lock })

  if (body.promoCode && !promoCode && unknownPromoIsError) {
    throw unprocessable(`Promo code "${body.promoCode}" is not valid for this event.`)
  }

  // A seated tier is priced seat by seat: a selection spanning two zones is
  // two lines of one ticket type, because an order line carries one unit
  // price and those seats did not cost the same.
  const { lines: pricedLines, seatsByLineKey } = priceLines({
    items: body.items,
    ticketTypesById: byId,
    seatedItems,
  })

  const totals = computeOrderTotals({
    items: pricedLines,
    promoCode,
    feeConfig: feeConfigFor(env, currency),
    taxRateBps: taxPolicy.rateBps,
    currency,
    now,
  })

  // A promo that exists but is inactive, out of window or exhausted yields a
  // zero discount. It must not consume a redemption or be stamped on the
  // order: doing so burns a campaign for buyers who never received the
  // discount, and misattributes full-price revenue to it.
  const promoApplied = Boolean(promoCode) && totals.discountCents > 0

  // Which night each priced line is for: its seats', else its tier's.
  const seatSessionByLineKey = new Map(
    [...seatsByLineKey.entries()].map(([key, seats]) => [
      key,
      seats[0]?.eventSeat?.eventSessionId ?? null,
    ]),
  )
  const lineSessions = totals.lineItems.map((line) => ({
    ticketTypeId: line.ticketTypeId,
    sessionId:
      seatSessionByLineKey.get(`${line.ticketTypeId}:${line.unitPriceCents}`) ??
      byId.get(line.ticketTypeId)?.eventSessionId ??
      null,
  }))

  const attendees = validateAttendees(body.attendees, {
    items: body.items,
    seatedItems,
    seatedTiers,
  })

  return {
    event,
    currency,
    ticketTypesById: byId,
    holdsByType,
    holdsById,
    seatedItems,
    seatedTiers,
    seatsByLineKey,
    taxPolicy,
    promoCode,
    promoApplied,
    promo: body.promoCode
      ? {
          code: body.promoCode,
          applied: promoApplied,
          reason: promoApplied ? null : promoReason(promoCode, { now, currency }),
          type: promoApplied ? promoCode.type : null,
          percentBps: promoApplied && promoCode.type === 'PERCENTAGE' ? promoCode.value : null,
          amountCents: promoApplied && promoCode.type === 'FIXED_AMOUNT' ? promoCode.value : null,
        }
      : null,
    totals,
    lineSessions,
    eventSessionId: sessionOfOrder(lineSessions),
    attendees,
  }
}

/**
 * The quote a buyer is shown: the same totals the charge would compute.
 *
 * @param {object} priced What {@link priceCheckout} returned.
 * @param {Date} now When it was priced.
 * @returns {object} A payload satisfying `orderQuoteResponseSchema`'s `data`.
 */
export function toOrderQuote(priced, now) {
  const { totals, lineSessions, ticketTypesById, promo } = priced

  return {
    currency: totals.currency,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    feesCents: totals.feesCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    lines: totals.lineItems.map((line, index) => ({
      ticketTypeId: line.ticketTypeId,
      name: line.name ?? ticketTypesById.get(line.ticketTypeId)?.name ?? 'Ticket',
      sessionId: lineSessions[index]?.sessionId ?? null,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      subtotalCents: line.subtotalCents,
      discountCents: line.discountCents ?? 0,
    })),
    promo,
    pricedAt: now.toISOString(),
  }
}
