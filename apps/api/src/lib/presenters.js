/**
 * Projections from database rows to response payloads.
 *
 * Handlers never hand a Prisma row straight to `reply.send`. Every response
 * goes through a presenter here first, so the denormalised fields a card needs
 * (venue city, cheapest price) are computed in one place, and so that widening
 * a `select` cannot accidentally widen the API surface.
 *
 * @module @desi-event/api/lib/presenters
 */

import { salesWindowState } from '@desi-event/inventory'
import { computeOrderTotals, resolveTaxPolicy } from '@desi-event/pricing'
import { BOOKABLE_STATUSES } from '@desi-event/schemas/lifecycle'
import {
  HIDDEN_EMAIL,
  RECONCILIATION_EVIDENCE_KEYS,
  domainOnlyAddress,
  withoutAddresses,
} from '@desi-event/schemas'

import { agingBand } from './reconciliation.js'
import { admissionRefusal } from './tickets.js'
import { BADGED_STATES } from './verification.js'

/** `TicketTypeStatus.ON_SALE`, inlined to avoid importing the database client. */
const ON_SALE = 'ON_SALE'

/** `TicketStatus.TRANSFERRED`, inlined for the same reason. */
const TRANSFERRED = 'TRANSFERRED'

/**
 * Whether a tier is inside its sales window now, as the hold route judges it.
 *
 * A tier the window helper cannot read — an unknown status, a window that ends
 * before it starts — counts as not on sale. A listing that failed because one
 * tier was malformed would hide every other event on the page.
 *
 * @param {object} ticketType A `TicketType` row.
 * @param {Date} now The moment in question.
 * @returns {boolean} True when a hold would pass the window check.
 */
function inSalesWindow(ticketType, now) {
  try {
    return (
      salesWindowState({
        status: ticketType.status,
        salesStartAt: ticketType.salesStartAt ?? null,
        salesEndAt: ticketType.salesEndAt ?? null,
        now,
      }) === 'ON_SALE'
    )
  } catch {
    return false
  }
}

/**
 * The lean event shape used by listings and cards.
 *
 * With `feeConfigFor`, the summary also carries `minTotalCents`: one ticket of
 * the cheapest tier priced exactly as `orders.create` prices it — the same
 * `computeOrderTotals`, the deployment's fee terms, and the tax rule of the
 * venue's jurisdiction at `now`. A seat's `priceCentsOverride` is not
 * consulted; no route writes one, and checkout reads it only at the seat.
 *
 * @param {object} event An `Event` row including `venue`, `organization` and `ticketTypes`.
 * @param {object} [options] Options.
 * @param {function(string): object} [options.feeConfigFor] The fee terms for a currency, as checkout uses them.
 * @param {Date} [options.now] When the price is being quoted.
 * @returns {object} A payload satisfying `eventSummarySchema`.
 */
export function toEventSummary(event, { feeConfigFor = null, now = new Date() } = {}) {
  const ticketTypes = event.ticketTypes ?? []
  const onSale = ticketTypes.filter((ticketType) => ticketType.status === ON_SALE)
  const priced = onSale.length > 0 ? onSale : ticketTypes

  const minPriceCents =
    priced.length > 0 ? Math.min(...priced.map((ticketType) => ticketType.priceCents)) : null

  const summary = {
    id: event.id,
    organizationId: event.organizationId,
    title: event.title,
    slug: event.slug,
    summary: event.summary,
    category: event.category,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    coverImageUrl: event.coverImageUrl ?? null,
    isOnline: event.isOnline,
    city: event.venue?.city ?? null,
    venueName: event.venue?.name ?? null,
    organizationName: event.organization?.name ?? null,
    organizationSlug: event.organization?.slug ?? null,
    venueSlug: event.venue?.slug ?? null,
    minPriceCents,
    currency: priced[0]?.currency ?? null,
  }

  if (typeof feeConfigFor === 'function' && minPriceCents !== null && summary.currency) {
    const cheapest = priced.find((ticketType) => ticketType.priceCents === minPriceCents)
    const taxPolicy = resolveTaxPolicy({
      country: event.venue?.country ?? null,
      region: event.venue?.region ?? null,
      at: now,
    })

    summary.minTotalCents = computeOrderTotals({
      items: [{ ticketTypeId: cheapest.id, quantity: 1, unitPriceCents: minPriceCents }],
      feeConfig: feeConfigFor(summary.currency),
      taxRateBps: taxPolicy.rateBps,
      currency: summary.currency,
      now,
    }).totalCents
  }

  // Omitted rather than guessed when the event has no tiers at all: `false`
  // would claim stock exists and `true` would claim it is gone.
  if (ticketTypes.length > 0) {
    summary.soldOut = ticketTypes.every(
      (ticketType) => ticketType.quantityTotal - ticketType.quantitySold <= 0,
    )
    summary.salesOpen =
      BOOKABLE_STATUSES.has(event.status) &&
      ticketTypes.some(
        (ticketType) =>
          ticketType.quantityTotal - ticketType.quantitySold > 0 && inSalesWindow(ticketType, now),
      )
  }

  return summary
}

/**
 * An organisation, reduced to what an anonymous caller may see.
 *
 * Finding NF-14: this endpoint used to return the row, which carried
 * `contactEmail` and `payoutCurrency` to anybody who loaded a public event
 * page. Built by naming each field rather than by deleting the two that were
 * wrong, so the next column added to `Organization` is absent here until
 * somebody decides it should be public.
 *
 * `verified` is derived from the verification state, not copied from the
 * denormalised column, so this page cannot show a badge the organiser page
 * would not — and cannot show one at all if the two ever disagree.
 *
 * @param {object|null} organization An `Organization` row, or null.
 * @returns {object|null} A payload satisfying `publicOrganizerSummarySchema`.
 */
export function toPublicOrganizer(organization) {
  if (!organization) return null

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    description: organization.description ?? null,
    websiteUrl: organization.websiteUrl ?? null,
    verified: BADGED_STATES.has(organization.verificationStatus),
  }
}

/**
 * The full event payload returned by the detail endpoint.
 *
 * Every field is named. This used to spread the row — `...rest` — and rely on
 * the response schema to strip what should not be public, which works right up
 * until somebody adds a response field for the organiser's own screens and
 * quietly widens the anonymous payload with it. `Event` carries `contactEmail`,
 * `moderationNote`, `reviewSubmittedAt`, `cancellationReason` and
 * `salesOpenedAt`; a stranger gets none of them, and the way to change that is
 * to write a line here and argue for it in review.
 *
 * So there are two allow lists, deliberately: this one, and
 * `eventWithRelationsSchema`. Either alone would hold. Both have to be widened
 * for a leak to ship.
 *
 * `venue` is the row, and that is safe because `venueSchema` is itself an
 * allow list that stops at the address: `provenance`, `organizationId` and
 * `mergedIntoVenueId` are not in it.
 *
 * ## Draft ticket types
 *
 * A tier is `DRAFT` until the organiser puts it on sale, and a draft tier is
 * the organiser holding something back — an early-bird price not announced yet,
 * a tier being built. Advertising it on the public page would announce it for
 * them. So drafts are dropped unless the caller is somebody who may see the
 * event's drafts at all, which is the same question the route already answers
 * to decide whether the page resolves.
 *
 * The flag is a parameter rather than a lookup here on purpose: a presenter
 * that decided authorisation for itself would be a second place authorisation
 * lives, and the two would disagree eventually.
 *
 * @param {object} event An `Event` row including `venue`, `organization` and `ticketTypes`.
 * @param {object} [options] Options.
 * @param {boolean} [options.includeDraftTiers] Whether the caller may see tiers not on sale.
 * @param {function(string): object} [options.feeConfigFor] The fee terms for a currency, as checkout uses them; when given, the detail carries `feeTerms`.
 * @returns {object} A payload satisfying `eventWithRelationsSchema`.
 */
export function toEventDetail(event, { includeDraftTiers = false, feeConfigFor = null } = {}) {
  const { venue = null, organization = null, ticketTypes = [] } = event
  const visibleTiers = includeDraftTiers
    ? ticketTypes
    : ticketTypes.filter((tier) => tier.status !== 'DRAFT')

  const detail = {
    id: event.id,
    organizationId: event.organizationId,
    venueId: event.venueId ?? null,
    title: event.title,
    slug: event.slug,
    summary: event.summary,
    description: event.description,
    category: event.category,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    coverImageUrl: event.coverImageUrl ?? null,
    isOnline: event.isOnline,
    onlineUrl: event.onlineUrl ?? null,
    languages: event.languages ?? [],
    publishedAt: event.publishedAt ?? null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    revision: event.revision ?? 0,
    ageRestriction: event.ageRestriction ?? null,
    accessibility: event.accessibility ?? null,
    artists: event.artists ?? [],
    policies: event.policies ?? null,
    // Only meaningful once something has moved, and then it is the whole point:
    // "postponed" alone does not tell somebody the date in their calendar is
    // dead.
    previousStartsAt: event.previousStartsAt ?? null,
    venue,
    organization: toPublicOrganizer(organization),
    ticketTypes: [...visibleTiers].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.priceCents - right.priceCents,
    ),
  }

  if (typeof feeConfigFor === 'function') {
    const currencies = [...new Set(visibleTiers.map((tier) => tier.currency ?? 'INR'))].sort()

    detail.feeTerms = currencies.map((currency) => {
      const terms = feeConfigFor(currency)

      return { currency, percentageBps: terms.percentageBps, flatCents: terms.flatCents }
    })
  }

  return detail
}

/**
 * A ticket type with its live availability folded in.
 *
 * @param {object} ticketType A `TicketType` row.
 * @param {{availableQuantity: number, isSoldOut: boolean}} [availability] The availability snapshot.
 * @returns {object} A payload satisfying the ticket type list response schema.
 */
export function toTicketType(ticketType, availability) {
  if (!availability) return { ...ticketType }

  return {
    ...ticketType,
    availableQuantity: availability.availableQuantity,
    isSoldOut: availability.isSoldOut,
  }
}

/**
 * An order with its line items, its tickets and a summary of its event.
 *
 * @param {object} order An `Order` row including `items` (each with `tickets`) and optionally `event`.
 * @param {object} [options] Options.
 * @param {boolean} [options.buyerAddress] Whether the reader may see the buyer's address: true for the buyer.
 * @returns {object} A payload satisfying `orderWithItemsSchema`.
 */
export function toOrder(order, { buyerAddress = true } = {}) {
  const { items = [], event = null, buyerEmail, ...rest } = order

  const lineItems = items.map(({ tickets: _tickets, ticketType: _ticketType, ...item }) => item)

  // Only the buyer's own. Accepting a transfer mints the recipient's ticket
  // onto this same order item — `acceptTransfer` reuses `ticket.orderItemId` —
  // so flattening `item.tickets` handed whoever read this order a stranger's
  // ticket: their code, their name, the name printed on it. The buyer saw it in
  // their own order history; an organiser reading the order saw it attributed
  // to the wrong person.
  //
  // The buyer's own transferred-away ticket stays. It is their purchase
  // history, and dropping it would replace one untruth with another —
  // `transferredAway` says what happened instead.
  const onThisOrder = items.flatMap((item) => item.tickets ?? [])

  // Which rows a later ticket replaced. Every accepted transfer mints a new row
  // on the same order item pointing back at the one it replaced, so a ticket
  // handed out and handed back leaves three rows against a quantity of one.
  // Read from the rows already loaded rather than queried for.
  const superseded = new Set(onThisOrder.map((ticket) => ticket.supersedesTicketId).filter(Boolean))

  const tickets = onThisOrder
    .filter((ticket) => heldByTheBuyer(ticket, order))
    .map((ticket) => toOrderTicket(ticket, superseded))

  return {
    ...rest,
    // The buyer's own reads carry their address. An organisation reading the
    // order does not get it: seeing what was bought, refunding it and admitting
    // it need no address, and the platform, not the organiser, writes to buyers.
    ...(buyerAddress ? { buyerEmail } : {}),
    items: lineItems,
    tickets,
    event: event ? toEventSummary(event) : null,
  }
}

/**
 * Everything {@link toWalletTicket} needs in order to be worth showing.
 *
 * Four relations deep, because that is how far a ticket is from the event it
 * admits to: ticket → order item → order → event → venue. The tier hangs off
 * the order line and the seat off the ticket. None of this is a new column and
 * none of it needs a migration; it was all reachable and simply never read.
 *
 * `transfers` is narrowed to the outstanding invitation. Fetching the whole
 * history for a list would be a query per row for information a list cannot
 * show, and the masked recipient of a *resolved* transfer is not something a
 * list needs to carry.
 *
 * It lives here rather than in the route because it is half of the presenter's
 * contract: `toWalletTicket` reads exactly these relations, and a join declared
 * somewhere else drifts from the projection that depends on it. The tests read
 * this constant too, so what they exercise is the join the route actually makes.
 *
 * @type {object}
 */
export const WALLET_INCLUDE = Object.freeze({
  orderItem: {
    include: {
      ticketType: { select: { id: true, name: true } },
      order: {
        select: {
          userId: true,
          reference: true,
          status: true,
          event: {
            select: {
              id: true,
              slug: true,
              title: true,
              startsAt: true,
              endsAt: true,
              timezone: true,
              status: true,
              cancelledAt: true,
              isOnline: true,
              venue: {
                select: { name: true, city: true, region: true, country: true },
              },
            },
          },
        },
      },
    },
  },
  eventSeat: {
    select: {
      seat: {
        select: {
          label: true,
          accessible: true,
          section: { select: { name: true } },
          row: { select: { label: true } },
        },
      },
    },
  },
  transfers: {
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, status: true, toEmail: true, expiresAt: true },
  },
})

/**
 * One row of somebody's ticket wallet.
 *
 * ## Why a ticket row is not enough
 *
 * A `Ticket` knows its code, its status and the order line it came from. It
 * does not know which event it admits to, when, where, or at what tier — all of
 * that is two or three relations away. `GET /tickets` returned bare rows, so
 * the wallet screen could say "VALID — ABC-123" and nothing a person could act
 * on. This presenter is the join, projected.
 *
 * ## Holder relationship, and why the order reference is conditional
 *
 * Accepting a transfer mints the recipient's ticket onto the *buyer's* order
 * item. The recipient therefore reaches a `Order` they never placed. So the
 * reference is returned only when this account is that buyer; for a received
 * ticket it is null, because nothing about somebody else's order is the
 * recipient's to see.
 *
 * ## What is not here
 *
 * The admission credential, its digest, its version and its issue time. The
 * buyer's email. Payment identifiers. Anybody else's ticket on the same order.
 * The transfer token. `walletTicketSchema` declares none of them, so Zod would
 * strip them even if this function were wrong — but this function is not wrong
 * on purpose rather than by accident.
 *
 * @param {object} ticket A `Ticket` row with `orderItem.order.event.venue`, `orderItem.ticketType`, `eventSeat.seat` and any pending `transfers`.
 * @param {object} options Options.
 * @param {string} options.viewerUserId The signed-in account the wallet belongs to.
 * @returns {object} A payload satisfying `walletTicketSchema`.
 */
export function toWalletTicket(ticket, { viewerUserId }) {
  const {
    credentialHash: _credentialHash,
    credentialVersion: _credentialVersion,
    credentialIssuedAt: _credentialIssuedAt,
    ownerUserId: _ownerUserId,
    supersedesTicketId: _supersedesTicketId,
    orderItem = null,
    eventSeat = null,
    transfers = [],
    ...rest
  } = ticket

  const order = orderItem?.order ?? null
  const event = order?.event ?? null
  const venue = event?.venue ?? null
  // The same comparison the order presenter makes, from the other side. The
  // wallet query already scoped every row to this account, so "the buyer is
  // this account" and "the holder bought it" are one question here.
  const purchased = Boolean(order?.userId) && order.userId === viewerUserId

  // The same function the door uses, so a wallet saying "ready to use" and a
  // scanner saying "refunded" cannot both be running. The event is passed,
  // because a ticket for a cancelled event admits nobody at the door either.
  const refusal = admissionRefusal(ticket, order, event)

  // Only one, and only an outstanding one. The token is not in the row and
  // never was — the database holds its digest.
  const pending = transfers.find((transfer) => transfer.status === 'PENDING') ?? null

  return {
    ...rest,
    holderRelationship: purchased ? 'PURCHASED' : 'RECEIVED',
    admits: refusal === null,
    admissionRefusal: refusal,
    orderReference: purchased ? order.reference : null,
    event: {
      id: event.id,
      slug: event.slug,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      status: event.status,
      cancelledAt: event.cancelledAt ?? null,
    },
    venue: venue
      ? {
          name: venue.name,
          city: venue.city,
          region: venue.region,
          country: venue.country,
        }
      : null,
    isOnline: Boolean(event.isOnline),
    tier: orderItem?.ticketType
      ? { id: orderItem.ticketType.id, name: orderItem.ticketType.name }
      : null,
    seat: eventSeat?.seat
      ? {
          section: eventSeat.seat.section?.name ?? 'Unnamed section',
          row: eventSeat.seat.row?.label ?? null,
          label: eventSeat.seat.label,
          accessible: Boolean(eventSeat.seat.accessible),
        }
      : null,
    pendingTransfer: pending
      ? {
          id: pending.id,
          toEmailMasked: transferRecipient(pending.toEmail),
          expiresAt: pending.expiresAt,
        }
      : null,
    revokedAt: ticket.revokedAt ?? null,
    revokedReason: ticket.revokedReason ?? null,
  }
}

/**
 * Whether a ticket on an order item is held by the person who bought the order.
 *
 * One comparison, exported to everything that needs it, because the order
 * presenter and the wallet presenter ask the same question from opposite sides
 * and two spellings of it would eventually disagree.
 *
 * A looser form — "both owners are known and they differ" — was tried first and
 * is wrong. It treats an order with no buyer account as matching anybody, so a
 * ticket transferred to somebody else stays visible on a guest order. That is
 * the leak, still open, in the one case nobody would think to test.
 *
 * Checkout keeps the two columns in step: `ownerUserId: order.userId ?? null`.
 * Anything that later gives an unclaimed guest purchase an owner has to set the
 * order's buyer too, or the order genuinely has no buyer for the ticket to
 * belong to.
 *
 * @param {object} ticket A `Ticket` row.
 * @param {object|null} order The `Order` the item belongs to.
 * @returns {boolean} True when the ticket is the buyer's own.
 */
export function heldByTheBuyer(ticket, order) {
  // Both columns must have been *selected*, not merely be absent. The
  // comparison normalises `undefined` to `null` on both sides, so a row fetched
  // with a `select` that omitted `ownerUserId` would read as a guest's and sail
  // through the filter — reopening the exact leak the strict form closes, and
  // silently, because the function takes plain objects and could assert nothing
  // about them. `WALLET_INCLUDE` already selects a narrow order, so this is a
  // pattern the codebase has rather than a hypothetical.
  if (!('ownerUserId' in ticket)) {
    throw new TypeError('heldByTheBuyer needs a ticket whose ownerUserId was selected.')
  }

  if (!order || !('userId' in order)) {
    throw new TypeError('heldByTheBuyer needs an order whose userId was selected.')
  }

  return (ticket.ownerUserId ?? null) === (order.userId ?? null)
}

/**
 * One of the buyer's tickets, as it appears on their order.
 *
 * @param {object} ticket A `Ticket` row belonging to the order's buyer.
 * @param {Set<string>} superseded Ids that a later ticket on the same order replaced.
 * @returns {object} A payload satisfying `orderTicketSchema`.
 */
function toOrderTicket(ticket, superseded) {
  const {
    // Never outbound. The response schema would strip them anyway; naming them
    // here means a reader of this function can see that it was deliberate
    // rather than lucky.
    credentialHash: _credentialHash,
    credentialVersion: _credentialVersion,
    credentialIssuedAt: _credentialIssuedAt,
    ownerUserId: _ownerUserId,
    supersedesTicketId: _supersedesTicketId,
    ...rest
  } = ticket

  return {
    ...rest,
    // From the status, and deliberately not from `ownerUserId !== order.userId`.
    // `acceptTransfer` never rewrites the old row's owner, so the owner columns
    // are *equal* on a ticket the buyer has given away — the predicate that
    // correctly answers "whose row is this" answers "has this been handed on"
    // wrongly, in exactly the states where it matters.
    purchaserHolding: ticket.status === TRANSFERRED ? 'TRANSFERRED_AWAY' : 'HELD',
    supersededByLaterTicket: superseded.has(ticket.id),
  }
}

/**
 * The response body for a successful inventory hold.
 *
 * @param {object} hold A `TicketHold` row.
 * @param {object} [ticketType] The `TicketType` the hold is against, for the unit price.
 * @returns {object} A payload satisfying `holdResponseSchema`'s `data`.
 */
export function toHold(hold, ticketType) {
  const data = {
    id: hold.id,
    ticketTypeId: hold.ticketTypeId,
    quantity: hold.quantity,
    expiresAt: hold.expiresAt,
  }

  if (ticketType) data.unitPriceCents = ticketType.priceCents

  return data
}

/**
 * A transfer's recipient, as the ticket's side of the transfer sees it.
 *
 * `••••@example.com`: the domain, and nothing of the local part. The sender
 * typed the address, so this tells them nothing new. It is enough to tell two
 * offers apart and to notice a mistyped domain, and not enough to reconstruct
 * the address for anybody else who opens the page. Falls back to
 * `Hidden email` for a stored value with no usable domain.
 *
 * This replaced `maskRecipient`, which kept the first and last characters of
 * the local part and one star for each of the rest.
 *
 * @param {string|null|undefined} address The stored recipient.
 * @returns {string} The stand-in.
 */
export function transferRecipient(address) {
  return domainOnlyAddress(address) ?? HIDDEN_EMAIL
}

/**
 * One outbox row, as an operator sees it.
 *
 * The payload is not here, and neither is the recipient, in any form. That is
 * the point: the response schema is an allow list, and this is the function
 * that decides what is on it. Retrying or cancelling a message does not need
 * to know who it was for, and an operations queue is read on shared screens.
 *
 * `lastError` was redacted when the worker wrote it. It is redacted again
 * here, because a row written by anything other than that worker would
 * otherwise reach the screen as it was stored.
 *
 * @param {object} row A `NotificationOutbox` row.
 * @returns {object} A payload satisfying `notificationSummarySchema`.
 */
export function toOperatorNotification(row) {
  return {
    id: row.id,
    template: row.template,
    channel: row.channel,
    status: row.status,
    businessEvent: row.businessEvent ?? null,
    templateVersion: row.templateVersion ?? 1,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    scheduledFor: row.scheduledFor,
    sentAt: row.sentAt ?? null,
    lastAttemptAt: row.lastAttemptAt ?? null,
    failureCategory: row.failureCategory ?? null,
    lastError: withoutAddresses(row.lastError) ?? null,
    leaseExpiresAt: row.leaseExpiresAt ?? null,
    suppressible: row.suppressible,
    createdAt: row.createdAt,
  }
}

/**
 * One refund, as finance sees it.
 *
 * The buyer is not here. Neither is their email, their name, or anything about
 * the card: a refund screen answers "should this money go back, and has it",
 * and none of those is needed to answer it. The response schema is an allow
 * list and this function is what decides what is on it.
 *
 * `providerRefundId` passes through exactly as the provider gave it, or stays
 * null. Nothing in this path manufactures one.
 *
 * @param {object} row A `Refund` row, optionally with `items` and its order.
 * @returns {object} A payload satisfying `refundSchema`.
 */
export function toRefund(row) {
  return {
    id: row.id,
    orderId: row.orderId,
    orderReference: row.order?.reference ?? null,
    organizationId: row.order?.event?.organizationId ?? null,
    paymentId: row.paymentId,
    provider: row.provider,
    providerRefundId: row.providerRefundId ?? null,
    amountCents: row.amountCents,
    currency: row.currency,
    reason: row.reason,
    reasonNote: row.reasonNote ?? null,
    status: row.status,
    allocation: row.allocation ?? null,
    items: (row.items ?? []).map((item) => ({
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      amountCents: item.amountCents,
    })),
    requestedById: row.requestedById ?? null,
    approvedById: row.approvedById ?? null,
    ticketsRevoked: row.ticketsRevoked,
    inventoryReturned: row.inventoryReturned,
    failureCode: row.failureCode ?? null,
    attempts: row.attempts ?? 0,
    submittedAt: row.submittedAt ?? null,
    settledAt: row.settledAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * One side of a reconciliation item's evidence, projected onto its allow list.
 *
 * Two rules, and the second is the one that is easy to forget. Keys not on
 * {@link RECONCILIATION_EVIDENCE_KEYS} are dropped; and an allowed key whose
 * value is an object or an array is dropped as well, because an allow list of
 * key *names* is no protection at all when `status` can hold a whole Stripe
 * charge. What survives is primitives.
 *
 * `null` in, `null` out. An object that survives with nothing in it is returned
 * as an empty object rather than as `null`, because "evidence was recorded and
 * none of it was showable" and "no evidence was ever recorded" are different
 * facts and an operator deciding about somebody's money should be told which
 * one this is.
 *
 * @param {unknown} value Whatever the row held.
 * @returns {object|null} A payload satisfying `reconciliationEvidenceSchema`.
 */
export function toEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const projected = {}

  for (const key of RECONCILIATION_EVIDENCE_KEYS) {
    const held = value[key]

    if (held === undefined) continue
    if (held !== null && typeof held === 'object') continue

    projected[key] = held
  }

  return projected
}

/**
 * One reconciliation task, as an operator sees it.
 *
 * Both sides of the evidence, because the decision is made by comparing them.
 * `localState` was written when the problem happened and is never edited;
 * `providerState` is the small summary a re-query records, never the provider's
 * raw object — an operations screen is not a place to print one. Both go
 * through {@link toEvidence}, so that holds whatever a future writer stores.
 *
 * The aging band is derived here rather than computed on the client, so a
 * queue screen and a detail screen cannot disagree about whether something is
 * late.
 *
 * @param {object} row A `ReconciliationTask` row.
 * @param {object} options Options.
 * @param {Date} options.now For the aging band.
 * @param {string|null} [options.orderReference] The order's customer-facing reference.
 * @returns {object} A payload satisfying `reconciliationTaskSchema`.
 */
export function toReconciliationTask(row, { now, orderReference = null }) {
  const ageHours = Math.floor((now.getTime() - new Date(row.createdAt).getTime()) / 3_600_000)

  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    paymentId: row.paymentId ?? null,
    orderId: row.orderId ?? null,
    orderReference,
    refundId: row.refundId ?? null,
    organizationId: row.organizationId ?? null,
    providerRef: row.providerRef ?? null,
    localState: toEvidence(row.localState),
    providerState: toEvidence(row.providerState),
    attempts: row.attempts,
    lastError: row.lastError ?? null,
    assignedToId: row.assignedToId ?? null,
    resolution: row.resolution ?? null,
    resolutionNote: row.resolutionNote ?? null,
    resolvedAt: row.resolvedAt ?? null,
    resolvedById: row.resolvedById ?? null,
    escalatedAt: row.escalatedAt ?? null,
    escalationReason: row.escalationReason ?? null,
    notes: Array.isArray(row.notes) ? row.notes : null,
    aging: agingBand(row, now),
    ageHours,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * One payout, as finance sees it.
 *
 * `holdReason` is prose rather than a code, and it is on the allow list on
 * purpose: a payout that did not go and cannot say why is the complaint the
 * whole surface exists to prevent.
 *
 * @param {object} row A `Payout` row.
 * @returns {object} A payload satisfying `payoutSchema`.
 */
export function toPayout(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    connectedAccountId: row.connectedAccountId ?? null,
    provider: row.provider,
    providerPayoutId: row.providerPayoutId ?? null,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status,
    reversedCents: row.reversedCents ?? 0,
    holdReason: row.holdReason ?? null,
    failureCode: row.failureCode ?? null,
    arrivalDate: row.arrivalDate ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * One transfer to a connected account.
 *
 * @param {object} row A `Transfer` row.
 * @returns {object} A payload satisfying `transferSchema`.
 */
export function toTransfer(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    connectedAccountId: row.connectedAccountId ?? null,
    orderId: row.orderId ?? null,
    provider: row.provider,
    providerTransferId: row.providerTransferId ?? null,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status,
    reversedCents: row.reversedCents ?? 0,
    failureCode: row.failureCode ?? null,
    settledAt: row.settledAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * One dispute.
 *
 * The provider's reason code passes through as written. Interpreting it here
 * would mean a reason code nobody had seen before became a 500, and the
 * vocabulary belongs to the provider rather than to this system.
 *
 * @param {object} row A `Dispute` row.
 * @returns {object} A payload satisfying `disputeSchema`.
 */
export function toDispute(row) {
  return {
    id: row.id,
    paymentId: row.paymentId,
    provider: row.provider,
    providerDisputeId: row.providerDisputeId,
    amountCents: row.amountCents,
    currency: row.currency,
    reason: row.reason ?? null,
    status: row.status,
    fundsWithheld: row.fundsWithheld,
    evidenceDueAt: row.evidenceDueAt ?? null,
    closedAt: row.closedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
