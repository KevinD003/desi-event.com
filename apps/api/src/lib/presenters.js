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
 * The full event payload returned by the detail endpoint.
 *
 * @param {object} event An `Event` row including `venue`, `organization` and `ticketTypes`.
 * @returns {object} A payload satisfying `eventWithRelationsSchema`.
 */
export function toEventDetail(event) {
  const { venue = null, organization = null, ticketTypes = [], ...rest } = event

  return {
    ...rest,
    venue,
    organization,
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
