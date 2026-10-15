/**
 * Changing an event after somebody has bought a ticket to it.
 *
 * `materialChanges()` has existed in `@desi-event/schemas/lifecycle` since the
 * lifecycle work and nothing called it, which meant the classification was
 * correct and inert: an organiser could move a published event's date through
 * the generic `PATCH /v1/events/:id` and nobody was told. This is the workflow
 * that connects it.
 *
 * ## What "material" means
 *
 * A buyer agreed to something. The description they read is context; the date,
 * the venue, the time zone, the age limit, whether it is online, and the
 * policies are *the deal*. Changing the first is housekeeping. Changing the
 * second is changing what somebody paid for, and doing it silently is the
 * behaviour this module exists to make impossible.
 *
 * So a material change to a live event needs three things a housekeeping edit
 * does not:
 *
 *   1. **An explicit confirmation.** `confirmMaterialChange: true` in the body.
 *      Not a default, not inferred from the fields: the caller has to say they
 *      know. Without it the write is refused and the refusal names every field
 *      that made it material.
 *   2. **A reason.** Recorded with who, when, and the value on each side.
 *   3. **Notification work.** One queued message per order, keyed so that a
 *      retry writes nothing.
 *
 * ## What it does not do
 *
 * **It does not send anything.** The rows are `QUEUED` in
 * `NotificationOutbox`. The worker's outbox drain hands them to the email
 * provider this build has, which is the in-memory one, so nothing reaches a
 * ticket holder and nothing here claims otherwise — the count returned is of
 * work *created*, not of people told.
 *
 * **It does not touch a snapshot.** An order carries the policies as they stood
 * when it was placed, precisely so a later edit cannot change what a buyer
 * agreed to. Rewriting those to match the new terms would defeat the whole
 * mechanism, so this never writes to an order.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/lib/event-material-change
 */

import {
  MATERIAL_FIELDS,
  SESSION_MATERIAL_FIELDS,
  materialChanges,
} from '@desi-event/schemas/lifecycle'
import { isSuppressible } from '@desi-event/notifications'

import { recordChangeNotice, withholdNoticeValues } from './event-change-notices.js'
import { unprocessable } from './errors.js'

/**
 * Statuses in which an edit can reach somebody who has already committed.
 *
 * Defined once in `@desi-event/schemas/lifecycle`, which the web reads too, and
 * re-exported here so existing importers keep working.
 */
export { LIVE_STATUSES } from '@desi-event/schemas/lifecycle'

/** How each material field reads in a refusal or a notice. */
const FIELD_LABELS = Object.freeze({
  startsAt: 'the start time',
  endsAt: 'the end time',
  timezone: 'the time zone',
  venueId: 'the venue',
  policies: 'the policies',
  ageRestriction: 'the age restriction',
  isOnline: 'whether it is online',
  onlineUrl: 'the online address',
  doorsOpenAt: 'the door time',
})

/**
 * Compare two values the way a person would.
 *
 * `Date` against an ISO string, and an object against an equivalent object,
 * both have to read as unchanged — otherwise a form that round-trips the
 * current values would report every material field as edited and demand a
 * confirmation for a change nobody made.
 *
 * @param {unknown} before The stored value.
 * @param {unknown} after The proposed value.
 * @returns {boolean} True when they mean the same thing.
 */
export function sameValue(before, after) {
  if (before === after) return true
  if (before == null || after == null) return before == null && after == null

  if (before instanceof Date || after instanceof Date) {
    const left = before instanceof Date ? before.getTime() : new Date(before).getTime()
    const right = after instanceof Date ? after.getTime() : new Date(after).getTime()

    return Number.isFinite(left) && Number.isFinite(right) && left === right
  }

  if (typeof before === 'object' && typeof after === 'object') {
    return JSON.stringify(before) === JSON.stringify(after)
  }

  return false
}

/**
 * Which of a patch's fields actually change something, split by weight.
 *
 * A field present in the patch but equal to what is stored is in neither list.
 * That matters: an editor that PATCHes the whole form on every autosave would
 * otherwise trip the confirmation on a change to the summary.
 *
 * @param {object} event The event as stored.
 * @param {object} patch The proposed change.
 * @returns {{material: string[], nonmaterial: string[], before: object, after: object}} The classification and both sides of it.
 */
export function classifyChanges(event, patch) {
  /** @type {Record<string, unknown>} */
  const before = {}
  /** @type {Record<string, unknown>} */
  const after = {}
  const changed = {}

  for (const [field, value] of Object.entries(patch ?? {})) {
    if (sameValue(event[field], value)) continue

    changed[field] = value
    before[field] =
      event[field] instanceof Date ? event[field].toISOString() : (event[field] ?? null)
    after[field] = value instanceof Date ? value.toISOString() : value
  }

  // The classification itself is the schema package's, not a second list kept
  // in step by hand. `materialChanges` is what `MATERIAL_FIELDS` is for.
  const material = materialChanges(changed)
  const nonmaterial = Object.keys(changed).filter((field) => !material.includes(field))

  return { material, nonmaterial, before, after }
}

/**
 * How a set of material fields reads in a sentence.
 *
 * @param {string[]} fields Field names.
 * @returns {string[]} One phrase per field, in the order `MATERIAL_FIELDS` lists them.
 */
export function describeFields(fields) {
  return MATERIAL_FIELDS.filter((field) => fields.includes(field)).map(
    (field) => FIELD_LABELS[field] ?? field,
  )
}

/**
 * How a set of a session's material fields reads in a sentence.
 *
 * @param {string[]} fields Field names.
 * @returns {string[]} One phrase per field, in the order `SESSION_MATERIAL_FIELDS` lists them.
 */
export function describeSessionFields(fields) {
  return SESSION_MATERIAL_FIELDS.filter((field) => fields.includes(field)).map(
    (field) => FIELD_LABELS[field] ?? field,
  )
}

/**
 * How the nights that moved with a reschedule read in a notice.
 *
 * A reschedule can leave the event's own start and end where they were and
 * move only its nights; the notice must still say what changed, not arrive
 * with an empty list. One phrase per session field that moved on any night,
 * with how many nights it moved on.
 *
 * @param {object[]|null} sessions `{id, fields}` summaries of the nights that moved.
 * @returns {string[]} Phrases such as "the start time of 2 nights".
 */
export function describeMovedSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return []

  return SESSION_MATERIAL_FIELDS.flatMap((field) => {
    const count = sessions.filter((moved) => (moved.fields ?? []).includes(field)).length

    if (count === 0) return []

    return [`${FIELD_LABELS[field] ?? field} of ${count === 1 ? 'one night' : `${count} nights`}`]
  })
}

/**
 * Refuse a change to a live session's date or time that nobody confirmed.
 *
 * @param {string[]} material The session's material fields being changed.
 * @param {string} status The event's status.
 * @returns {void}
 * @throws {Error} A 422 naming the fields.
 */
export function refuseUnconfirmedSession(material, status) {
  const described = describeSessionFields(material)

  throw unprocessable(
    `This event is ${status}, and this change alters ${described.join(', ')} of a night people may have bought tickets for. ` +
      'Confirm the change explicitly and give a reason that can be sent to them.',
    {
      problems: described.map(
        (phrase) =>
          `Changing ${phrase} of this session after publication needs an explicit confirmation.`,
      ),
      fields: material,
      status,
    },
  )
}

/**
 * Refuse a material change that nobody confirmed.
 *
 * A 422 rather than a 403: the caller is allowed to do this, they just have not
 * said they mean to. The message names every field, so the confirmation an
 * organiser is asked for is a specific one rather than a shrug.
 *
 * @param {string[]} material The material fields being changed.
 * @param {string} status The event's status.
 * @returns {void}
 * @throws {Error} A 422 naming the fields.
 */
export function refuseUnconfirmed(material, status) {
  const described = describeFields(material)

  throw unprocessable(
    `This event is ${status}, and this change alters ${described.join(', ')}. ` +
      'Somebody may have bought a ticket on those terms, so confirm the change explicitly ' +
      'and give a reason that can be sent to them.',
    {
      problems: described.map(
        (phrase) => `Changing ${phrase} after publication needs an explicit confirmation.`,
      ),
      fields: material,
      status,
    },
  )
}

/**
 * Record a confirmed material change and queue the work of telling people.
 *
 * Runs inside the same transaction as the write, so an event whose date moved
 * and whose ticket holders were never queued to be told cannot exist.
 *
 * @param {object} tx A Prisma transaction client. Never the bare client.
 * @param {object} options Options.
 * @param {object} options.event The event as it stood before the change.
 * @param {number} options.revision The revision the change is being written as.
 * @param {string[]} options.material The material fields that changed.
 * @param {object} options.before The stored values, keyed by field.
 * @param {object} options.after The new values, keyed by field.
 * @param {string} options.reason The prose a ticket holder reads.
 * @param {object} [options.session] A session whose own dates changed. Narrows
 *   the notice to the orders for that night — placed for it, or holding a
 *   ticket type on it or on every night — and says which night it was.
 * @param {object[]} [options.sessions] Sessions that moved with the event, as
 *   `{id, before, after}` summaries, carried in the notice so one message
 *   covers the whole reschedule.
 * @param {'MATERIAL_CHANGE'|'SESSION_CHANGE'|'RESCHEDULED'} [options.kind] What ticket holders are
 *   shown it as; a night's own change by default when `session` is given, the
 *   event's otherwise.
 * @param {boolean} [options.byPlatform] Whether the team at The Desi Events made it, in
 *   an editing sitting or as a SUPER_ADMIN under Rule L. Carried in every
 *   notice so the message says who, never which person.
 * @returns {Promise<{orders: number, notifications: number}>} What was created.
 */
export async function materialChangeWork(tx, options) {
  // No `actorId`: an outbox row is what a ticket holder receives, and who
  // pressed the button is not their business. The audit record carries it.
  const {
    event,
    revision,
    material,
    before,
    after,
    reason,
    session = null,
    sessions = null,
    kind = session ? 'SESSION_CHANGE' : 'MATERIAL_CHANGE',
    byPlatform = false,
  } = options

  const orders = await tx.order.findMany({
    where: {
      eventId: event.id,
      status: { in: ['PENDING', 'PAID'] },
      ...(session
        ? {
            OR: [
              { eventSessionId: session.id },
              {
                items: {
                  some: {
                    ticketType: {
                      OR: [{ eventSessionId: session.id }, { eventSessionId: null }],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    },
  })

  let notifications = 0

  for (const order of orders) {
    if (!order.buyerEmail) continue

    // Keyed by the revision as well as the event and the order. Two separate
    // material changes are two different things to be told, so they must not
    // collide; a retry of *this* change carries the same revision and is
    // skipped. That is what makes the work exactly-once rather than
    // at-most-once-per-event.
    const dedupeKey = `event.changed:${event.id}:${order.id}:${revision}`

    const created = await tx.notificationOutbox.createMany({
      data: [
        {
          template: 'event.changed',
          channel: 'EMAIL',
          recipient: order.buyerEmail,
          userId: order.userId ?? null,
          // Stamped so a privacy redaction can find this row. The column has
          // existed since the Phase 2 commerce migration and no writer ever set
          // it, so every outbox row carried `organizationId: null` and an
          // organisation-scoped scrub of delivery evidence matched nothing at
          // all. Delivery is unaffected: the dispatcher never reads it.
          organizationId: event.organizationId,
          // Ids, field names and prose. No token, no payment detail: an outbox
          // row is read by a worker and by whoever is debugging it.
          payload: {
            eventId: event.id,
            eventTitle: event.title,
            orderId: order.id,
            orderReference: order.reference ?? null,
            changedFields: material,
            changed: session
              ? describeSessionFields(material)
              : [...describeFields(material), ...describeMovedSessions(sessions)],
            // Without the joining link: an outbox row is read by a worker and
            // by whoever is debugging it, and the message only names what
            // changed. The holder reads the link where it is gated.
            before: withholdNoticeValues(before) ?? {},
            after: withholdNoticeValues(after) ?? {},
            reason,
            byPlatform: Boolean(byPlatform),
            ...(session
              ? {
                  sessionId: session.id,
                  sessionStartsAt:
                    session.startsAt instanceof Date
                      ? session.startsAt.toISOString()
                      : (session.startsAt ?? null),
                }
              : {}),
            ...(sessions ? { sessions } : {}),
          },
          dedupeKey,
          // A change to what somebody bought is not marketing, and a
          // notification preference must not suppress it. Asked of the one
          // list rather than answered here.
          suppressible: isSuppressible('event.changed'),
        },
      ],
      skipDuplicates: true,
    })

    notifications += created.count
  }

  // What holders are shown on their order and ticket pages: one notice for the
  // change, whoever holds a ticket, written here and nowhere else for these
  // three kinds (SPEC2-XI X-C).
  await recordChangeNotice(tx, {
    event,
    kind,
    fields: [...material, ...(sessions ?? []).flatMap((moved) => moved.fields ?? [])],
    changed: session
      ? describeSessionFields(material)
      : [...describeFields(material), ...describeMovedSessions(sessions)],
    before,
    after,
    reason,
    session,
    byPlatform,
    revision,
  })

  return { orders: orders.length, notifications }
}
