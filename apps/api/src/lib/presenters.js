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
 * @param {object} event An `Event` row including `venue`, `organization` and `ticketTypes`.
 * @returns {object} A payload satisfying `eventWithRelationsSchema`.
 */
export function toEventDetail(event) {
  const { venue = null, organization = null, ticketTypes = [] } = event

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
    ticketTypes: [...ticketTypes].sort(
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
