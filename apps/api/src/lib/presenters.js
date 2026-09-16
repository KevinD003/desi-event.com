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

import { RECONCILIATION_EVIDENCE_KEYS } from '@desi-event/schemas'

import { agingBand } from './reconciliation.js'
import { BADGED_STATES } from './verification.js'

/** `TicketTypeStatus.ON_SALE`, inlined to avoid importing the database client. */
const ON_SALE = 'ON_SALE'

/**
 * The lean event shape used by listings and cards.
 *
 * @param {object} event An `Event` row including `venue`, `organization` and `ticketTypes`.
 * @returns {object} A payload satisfying `eventSummarySchema`.
 */
export function toEventSummary(event) {
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

  // Omitted rather than guessed when the event has no tiers at all: `false`
  // would claim stock exists and `true` would claim it is gone.
  if (ticketTypes.length > 0) {
    summary.soldOut = ticketTypes.every(
      (ticketType) => ticketType.quantityTotal - ticketType.quantitySold <= 0,
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
 * @returns {object} A payload satisfying `eventWithRelationsSchema`.
 */
export function toEventDetail(event, { includeDraftTiers = false } = {}) {
  const { venue = null, organization = null, ticketTypes = [] } = event
  const visibleTiers = includeDraftTiers
    ? ticketTypes
    : ticketTypes.filter((tier) => tier.status !== 'DRAFT')

  return {
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
 * @returns {object} A payload satisfying `orderWithItemsSchema`.
 */
export function toOrder(order) {
  const { items = [], event = null, ...rest } = order

  const lineItems = items.map(({ tickets: _tickets, ticketType: _ticketType, ...item }) => item)
  const tickets = items.flatMap((item) => item.tickets ?? [])

  return {
    ...rest,
    items: lineItems,
    tickets,
    event: event ? toEventSummary(event) : null,
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
 * Mask an address so it can be recognised but not used.
 *
 * `priya.sharma@example.com` becomes `p**********a@example.com`. Enough for an
 * operator to match a support ticket against a queue row, not enough to
 * contact anybody — which is the line an operations tool has to stay on the
 * right side of, because it is read on shared screens by whoever is on shift.
 *
 * @param {string|null|undefined} address The stored recipient.
 * @returns {string} The masked form, or `'(none)'` when there is nothing to mask.
 */
export function maskRecipient(address) {
  if (typeof address !== 'string' || address.trim() === '') return '(none)'

  const at = address.lastIndexOf('@')

  // A phone number, or anything else with no domain part: keep the last two
  // characters, which is what an operator reads off a support ticket.
  if (at < 1) {
    const tail = address.slice(-2)
    return `${'*'.repeat(Math.max(1, address.length - 2))}${tail}`
  }

  const local = address.slice(0, at)
  const domain = address.slice(at)

  if (local.length <= 2) return `${'*'.repeat(local.length)}${domain}`

  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}${domain}`
}

/**
 * One outbox row, as an operator sees it.
 *
 * The payload is not here, and neither is the full recipient. That is the
 * point: the response schema is an allow list, and this is the function that
 * decides what is on it.
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
    recipientMasked: maskRecipient(row.recipient),
    businessEvent: row.businessEvent ?? null,
    templateVersion: row.templateVersion ?? 1,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    scheduledFor: row.scheduledFor,
    sentAt: row.sentAt ?? null,
    lastAttemptAt: row.lastAttemptAt ?? null,
    failureCategory: row.failureCategory ?? null,
    lastError: row.lastError ?? null,
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
