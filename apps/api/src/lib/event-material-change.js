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
 * `NotificationOutbox`. No outbox worker exists in this repository yet, so
 * nothing is delivered and nothing here claims otherwise — the count returned
 * is of work *created*, not of people told.
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

import { MATERIAL_FIELDS, materialChanges } from '@desi-event/schemas/lifecycle'

import { unprocessable } from './errors.js'

/**
 * Statuses in which an edit can reach somebody who has already committed.
 *
 * `PUBLISHED` is on the list although nothing may have sold yet: the page is
 * public, somebody has it in their calendar, and a date that moves without a
 * word is the same betrayal whether or not money changed hands.
 *
 * `APPROVED` is not, and neither is `REVIEW_PENDING`: those are refused
 * outright elsewhere, because editing a version a moderator is holding — or has
 * just said yes to — invalidates the decision rather than amending a deal.
 *
 * @type {ReadonlySet<string>}
 */
export const LIVE_STATUSES = Object.freeze(
  new Set(['PUBLISHED', 'ON_SALE', 'SALES_PAUSED', 'SOLD_OUT', 'POSTPONED']),
)

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
 * @returns {Promise<{orders: number, notifications: number}>} What was created.
 */
export async function materialChangeWork(tx, options) {
  // No `actorId`: an outbox row is what a ticket holder receives, and who
  // pressed the button is not their business. The audit record carries it.
  const { event, revision, material, before, after, reason } = options

  const orders = await tx.order.findMany({
    where: { eventId: event.id, status: { in: ['PENDING', 'PAID'] } },
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
          // Ids, field names and prose. No token, no payment detail: an outbox
          // row is read by a worker and by whoever is debugging it.
          payload: {
            eventId: event.id,
            eventTitle: event.title,
            orderId: order.id,
            orderReference: order.reference ?? null,
            changedFields: material,
            changed: describeFields(material),
            before,
            after,
            reason,
          },
          dedupeKey,
          // A change to what somebody bought is not marketing, and a
          // notification preference must not suppress it.
          suppressible: false,
        },
      ],
      skipDuplicates: true,
    })

    notifications += created.count
  }

  return { orders: orders.length, notifications }
}
