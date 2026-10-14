/**
 * What ticket holders are shown changed about their event (SPEC2-XI X-14).
 *
 * One `EventChangeNotice` row per change, written in the same transaction as
 * the change, and read back on the holder's order and ticket pages. The outbox
 * rows stay one per order (that is what would be sent); this is what is shown,
 * and it is written once per change rather than once per order.
 *
 * Exactly one writer per kind (X-C), so no change is recorded twice:
 *
 * | Kind | Writer |
 * |---|---|
 * | MATERIAL_CHANGE, SESSION_CHANGE, RESCHEDULED | `materialChangeWork` |
 * | POSTPONED, CANCELLED | `cancellationWork` |
 * | SESSION_CANCELLED | `cancelSession` |
 * | DELETED | `deleteEvent` |
 *
 * A notice holds no personal data: field names, the sentences describing them
 * (frozen when written, so a later relabelling does not rewrite history), the
 * values before and after, the reason the organiser or the team at The Desi
 * Events gave, the night when it was one night, and whether the team at The
 * Desi Events made it — never who.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/api/lib/event-change-notices
 */

/** The most notices one order or ticket page lists. */
export const CHANGE_NOTICE_LIMIT = 50

/** The database's bounds (`event_change_notice_shape`). */
const LIMITS = Object.freeze({ fields: 20, changed: 40, reason: 2000 })

/**
 * A JSON object, or null: the CHECK refuses any other JSON at the top.
 *
 * @param {unknown} value A before or after value.
 * @returns {object|null} The value when it is a plain object.
 */
function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

/**
 * Fields whose values a notice never carries, only their names.
 *
 * An online event's joining link lets whoever reads it into the event, so it
 * is the paying holder's alone (`joinUrlFor`). A notice is read by everyone
 * the order was ever for, a refunded buyer and an `order:view` reader
 * included, so it says that the link changed (`fields`, `changed`) and never
 * what it now is: the holder reads the link itself where it is gated.
 */
export const WITHHELD_NOTICE_FIELDS = Object.freeze(['onlineUrl'])

/**
 * A before or after value without the fields a notice never carries.
 *
 * @param {unknown} values A before or after value, keyed by field.
 * @returns {object|null} The value without {@link WITHHELD_NOTICE_FIELDS}, or
 *   null when nothing else is left (or it was not an object).
 */
export function withholdNoticeValues(values) {
  const object = objectOrNull(values)

  if (!object) return null

  const kept = Object.fromEntries(
    Object.entries(object).filter(([field]) => !WITHHELD_NOTICE_FIELDS.includes(field)),
  )

  return Object.keys(kept).length > 0 ? kept : null
}

/**
 * Record one change for the event's ticket holders.
 *
 * @param {object} tx A Prisma transaction client: the change's own.
 * @param {object} options What changed.
 * @param {object} options.event The event, with `id`.
 * @param {'MATERIAL_CHANGE'|'SESSION_CHANGE'|'RESCHEDULED'|'POSTPONED'|'CANCELLED'|'SESSION_CANCELLED'|'DELETED'} options.kind The kind.
 * @param {string[]} [options.fields] The field names that changed.
 * @param {string[]} [options.changed] How they read in a sentence.
 * @param {object|null} [options.before] Values before, keyed by field.
 * @param {object|null} [options.after] Values after, keyed by field.
 * @param {string|null} [options.reason] The reason given.
 * @param {object|null} [options.session] The night, when the change was to one.
 * @param {boolean} [options.byPlatform] Whether the team at The Desi Events made it.
 * @param {number|null} [options.revision] The event revision it was written as.
 * @returns {Promise<object>} The notice row.
 */
export async function recordChangeNotice(tx, options) {
  const {
    event,
    kind,
    fields = [],
    changed = [],
    before = null,
    after = null,
    reason = null,
    session = null,
    byPlatform = false,
    revision = null,
  } = options

  const shown = { before: withholdNoticeValues(before), after: withholdNoticeValues(after) }

  return tx.eventChangeNotice.create({
    data: {
      eventId: event.id,
      eventSessionId: session?.id ?? null,
      kind,
      fields: [...new Set(fields)].slice(0, LIMITS.fields),
      changed: changed.map(String).slice(0, LIMITS.changed),
      // Left out rather than written null when there is nothing to show:
      // Prisma writes a JSON `null` for a null Json value, which is not an
      // object and which the shape CHECK refuses; left out, the column is SQL
      // NULL.
      ...(shown.before ? { before: shown.before } : {}),
      ...(shown.after ? { after: shown.after } : {}),
      reason: typeof reason === 'string' ? reason.slice(0, LIMITS.reason) : null,
      byPlatform: Boolean(byPlatform),
      revision: Number.isInteger(revision) ? revision : null,
    },
  })
}

/**
 * A notice as a ticket holder reads it.
 *
 * @param {object} row An `EventChangeNotice` row.
 * @returns {object} A payload satisfying `eventChangeNoticeSchema`.
 */
export function toEventChangeNotice(row) {
  return {
    id: row.id,
    kind: row.kind,
    at: new Date(row.createdAt).toISOString(),
    changed: [...(row.changed ?? [])],
    // Withheld again on the way out, so a row written before the rule (or by
    // a hand repair) still never shows a joining link.
    before: withholdNoticeValues(row.before),
    after: withholdNoticeValues(row.after),
    reason: row.reason ?? null,
    sessionId: row.eventSessionId ?? null,
    by: row.byPlatform ? 'DESI_EVENT' : 'ORGANIZER',
  }
}

/**
 * The nights an order is for, or null when it is for every night.
 *
 * The order's own night, and the nights of its lines' ticket types; a line
 * whose ticket type names no night is good for every night, and then every
 * night's notice touches the order.
 *
 * @param {object} order The order, with `eventSessionId` and `items[].ticketType.eventSessionId`.
 * @returns {Set<string>|null} Night ids, or null for every night.
 */
export function nightsOfOrder(order) {
  const nights = new Set()

  if (order.eventSessionId) nights.add(order.eventSessionId)

  for (const item of order.items ?? []) {
    const night = item.ticketType?.eventSessionId ?? null

    if (night === null && !order.eventSessionId) return null
    if (night) nights.add(night)
  }

  return nights
}

/**
 * What changed about the event since the order was placed and touches it,
 * newest first: event-wide notices, its own nights', and every night's when a
 * line is good for every night.
 *
 * @param {object} db A Prisma client.
 * @param {object} order The order, with `id`, `eventId`, `createdAt`, `eventSessionId` and `items[].ticketType`.
 * @returns {Promise<object[]>} `eventChangeNoticeSchema` payloads, at most {@link CHANGE_NOTICE_LIMIT}.
 */
export async function changesForOrder(db, order) {
  if (!order?.eventId) return []

  let items = order.items

  if (!Array.isArray(items) || items.some((item) => item.ticketType === undefined)) {
    items = await db.orderItem.findMany({
      where: { orderId: order.id },
      select: { ticketType: { select: { eventSessionId: true } } },
    })
  }

  const nights = nightsOfOrder({ ...order, items })

  const rows = await db.eventChangeNotice.findMany({
    where: {
      eventId: order.eventId,
      createdAt: { gte: new Date(order.createdAt) },
      ...(nights === null
        ? {}
        : { OR: [{ eventSessionId: null }, { eventSessionId: { in: [...nights] } }] }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CHANGE_NOTICE_LIMIT,
  })

  return rows.map(toEventChangeNotice)
}
