/**
 * Authoring an event: the parts an organiser edits before anybody sees it.
 *
 * The lifecycle module owns *what state an event is in*. This one owns *what is
 * in it* — sessions, ticket types, inventory — and the rules are different in
 * kind. A lifecycle rule is about entitlement; an authoring rule is mostly
 * about coherence, and coherence is checked in two places on purpose:
 *
 *   - Here, so the organiser gets a sentence they can act on.
 *   - In the database, so the sentence is not the only thing standing between a
 *     backfill and an incoherent row.
 *
 * ## Editing is confined to the states where editing means something
 *
 * Two modes, and a refusal for everything else:
 *
 *   - **Draft** (`DRAFT`, `CHANGES_REQUIRED`): the organiser's to change freely.
 *   - **Live** (`PUBLISHED`, `ON_SALE`, `SALES_PAUSED`, `SOLD_OUT`,
 *     `POSTPONED`): somebody may have bought a ticket on the strength of what it
 *     says, so edits are allowed where they cannot take anything away from a
 *     buyer — a new tier or night, a raised quantity, a renamed tier — and a
 *     change to what a buyer bought needs a confirmation and a reason.
 *   - Anything else is refused. A review-pending event is being read by a
 *     moderator; an approved one is the version the moderator said yes to; a
 *     rejected one is reworked as a draft first; a cancelled, archived or
 *     finished one is final.
 *
 * ## Optimistic concurrency
 *
 * Every write that changes the draft takes a `revision` and bumps it. Two tabs
 * open on one event is the ordinary case, not the exotic one, and last-write-
 * wins loses an organiser's work silently. The conditional `UPDATE` with an
 * affected-row count is the same primitive the seat, venue-map and lifecycle
 * code use.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath, so a path segment spelled exactly that fails `jsdoc/valid-types`.
 *
 * @file @desi-event/api/lib/event-authoring
 */

import { activeHeldQuantity } from '@desi-event/inventory'
import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { EDITABLE_STATUSES, LIVE_STATUSES } from '@desi-event/schemas/lifecycle'
import { EVENT_CONTENT_LIMITS } from '@desi-event/schemas/event-content'
import { computeOrderTotals } from '@desi-event/pricing'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { databaseErrorCode, httpError, notFound, unprocessable } from './errors.js'

/** The two ways an event's content may be edited. */
export const AUTHORING_MODES = Object.freeze({ DRAFT: 'draft', LIVE: 'live' })

/** `HoldStatus.ACTIVE`, inlined to keep this module free of a database import. */
const ACTIVE = 'ACTIVE'

/**
 * Load an event for authoring, with everything the coherence rules read.
 *
 * @param {object} prisma The Prisma client.
 * @param {string} eventId The event.
 * @returns {Promise<object>} The event.
 * @throws {Error} A 404 when there is no such event.
 */
export async function loadForAuthoring(prisma, eventId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      organization: true,
      venue: true,
      sessions: { include: { venueMapVersion: true }, orderBy: { startsAt: 'asc' } },
      ticketTypes: { orderBy: { sortOrder: 'asc' } },
    },
  })

  if (!event) throw notFound('No such event.')

  event.zonesByVersion = await loadZonesByVersion(
    prisma,
    event.sessions.map((session) => session.venueMapVersionId),
  )

  return event
}

/**
 * The price zones of each map version, keyed by version id.
 *
 * A separate query rather than a nested include, so a reserved tier's zone can
 * be checked against the session's own version without a second round trip
 * per tier.
 *
 * @param {object} prisma The Prisma client.
 * @param {Array<string|null>} versionIds Map versions; nulls are ignored.
 * @returns {Promise<Map<string, object[]>>} Zones per version, in their order.
 */
export async function loadZonesByVersion(prisma, versionIds) {
  const ids = [...new Set(versionIds.filter(Boolean))]
  /** @type {Map<string, object[]>} */
  const byVersion = new Map(ids.map((id) => [id, []]))

  if (ids.length === 0) return byVersion

  const zones = await prisma.priceZone.findMany({
    where: { venueMapVersionId: { in: ids } },
    orderBy: { sortOrder: 'asc' },
  })

  for (const zone of zones) byVersion.get(zone.venueMapVersionId)?.push(zone)

  return byVersion
}

/**
 * Why an event in this status cannot be edited, in words an organiser can act on.
 *
 * @param {string} status The event's status.
 * @returns {string} The sentence.
 */
function notEditableMessage(status) {
  if (status === 'REVIEW_PENDING') {
    return 'This event is waiting for a moderator, so its content cannot be edited. Withdraw it from review first.'
  }

  if (status === 'APPROVED') {
    return 'A moderator holds this version: they approved it. Publish it, or ask for it back before changing it.'
  }

  if (status === 'REJECTED') {
    return 'A moderator rejected this event. Rework it as a draft to change it and send it for review again.'
  }

  // Not final: the Desi-Event team can restore a deleted event (SPEC2-XI X-12).
  if (status === 'DELETED') {
    return 'This event was deleted. Ask the Desi-Event team to restore it before changing it.'
  }

  return `This event is ${String(status).toLowerCase().replace(/_/g, ' ')}, which is final, so its content cannot be edited.`
}

/**
 * Which editing mode an event's status allows.
 *
 * @param {object} event The event.
 * @returns {'draft'|'live'} The mode.
 * @throws {Error} A 409 `NOT_EDITABLE` for every other status.
 */
export function authoringMode(event) {
  if (EDITABLE_STATUSES.has(event.status)) return AUTHORING_MODES.DRAFT
  if (LIVE_STATUSES.has(event.status)) return AUTHORING_MODES.LIVE

  throw httpError(409, 'NOT_EDITABLE', notEditableMessage(event.status), {
    status: event.status,
  })
}

/**
 * Assert this actor may change this event's content right now.
 *
 * Two questions, and they fail differently on purpose: "you may not" is a 403,
 * "not in this state" is a 409. A screen that conflates them tells an organiser
 * to ask for a permission they already hold.
 *
 * The capability is `event:update` in both modes; what a live event may take is
 * decided by the rules each write applies, not by a second permission.
 *
 * @param {object} event The event.
 * @param {object} actor The request actor.
 * @returns {'draft'|'live'} The editing mode.
 * @throws {Error} A 403 or a 409.
 */
export function assertAuthorable(event, actor) {
  assertCan(actor, CAPABILITIES.EVENT_UPDATE, { organizationId: event.organizationId })

  return authoringMode(event)
}

/**
 * Apply a change to the draft under a revision precondition.
 *
 * Every authoring write goes through here, so there is one place the revision
 * is checked and one place it is bumped. A caller that forgets would produce a
 * write nobody can detect as stale.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event as loaded.
 * @param {number} options.revision The revision the caller read.
 * @param {object} options.actor The request actor.
 * @param {string} options.action What to call this in the audit log.
 * @param {Function} options.write Given `(tx, event)`, does the work.
 * @param {object|Function} [options.metadata] Extra audit metadata: an object, or a function given what `write` returned, called after it. Merged under the revision, which it cannot replace.
 * @returns {Promise<object>} The event after the write.
 * @throws {Error} A 409 when the revision has moved.
 */
export async function authorChange(prisma, options) {
  const { event, revision, actor, action, write, metadata = null } = options

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.event.updateMany({
      where: { id: event.id, revision, status: event.status },
      data: { revision: revision + 1 },
    })

    if (count !== 1) {
      const current = await tx.event.findUnique({
        where: { id: event.id },
        select: { revision: true, status: true },
      })

      // `STALE_REVISION` rather than a bare `CONFLICT`, and it is the `code`
      // rather than a detail: an editor recovering from this has to be able to
      // tell "somebody saved over you, re-read and merge" apart from "that slug
      // is taken", and it cannot do that by matching on prose.
      throw httpError(
        409,
        'STALE_REVISION',
        current?.status !== event.status
          ? `This event is no longer ${event.status}; it is ${current?.status ?? 'gone'}. Reload before editing.`
          : 'Somebody else saved a change to this event while you were editing. Reload to take their version, or copy your changes somewhere before you do.',
        {
          expectedRevision: revision,
          currentRevision: current?.revision ?? null,
          currentStatus: current?.status ?? null,
        },
      )
    }

    const written = await write(tx, event)
    const extra = typeof metadata === 'function' ? await metadata(written) : metadata

    await recordAudit(tx, {
      action,
      entityType: 'Event',
      entityId: event.id,
      actorId: actor?.id ?? null,
      metadata: { ...(extra ?? {}), revision: revision + 1 },
    })

    return tx.event.findUnique({ where: { id: event.id } })
  })
}

/**
 * Why a proposed session is not coherent.
 *
 * Returned as a list rather than thrown one at a time, so an organiser fixing a
 * form sees everything wrong with it at once.
 *
 * @param {object} session The proposed session.
 * @param {object} event The event it belongs to.
 * @param {object} [options] Options.
 * @param {boolean} [options.mustBeFuture] True for a night added to a live event, which must start later than now.
 * @param {Date} [options.now] The moment in question.
 * @returns {string[]} Reasons. Empty means coherent.
 */
export function sessionProblems(session, event, { mustBeFuture = false, now = new Date() } = {}) {
  const problems = []
  const startsAt = session.startsAt ? new Date(session.startsAt) : null
  const endsAt = session.endsAt ? new Date(session.endsAt) : null

  if (!startsAt || Number.isNaN(startsAt.getTime()))
    problems.push('The session needs a start time.')
  if (!endsAt || Number.isNaN(endsAt.getTime())) problems.push('The session needs an end time.')

  if (startsAt && endsAt && endsAt <= startsAt) {
    problems.push('The session must end after it starts.')
  }

  const doorsOpenAt = session.doorsOpenAt ? new Date(session.doorsOpenAt) : null

  if (doorsOpenAt && startsAt && doorsOpenAt > startsAt) {
    problems.push('Doors cannot open after the session starts.')
  }

  if (mustBeFuture && startsAt && startsAt <= now) {
    problems.push('A night added to a published event has to start in the future.')
  }

  // A local time without a zone is not a time. "Seven o'clock" in a listing
  // read from three time zones is three different moments.
  if (!session.timezone) {
    problems.push('The session needs an IANA time zone.')
  } else if (!isKnownTimeZone(session.timezone)) {
    problems.push(`"${session.timezone}" is not an IANA time zone this platform recognises.`)
  }

  const salesStartAt = session.salesStartAt ? new Date(session.salesStartAt) : null
  const salesEndAt = session.salesEndAt ? new Date(session.salesEndAt) : null

  if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) {
    problems.push('The sales window closes before it opens.')
  }

  if (salesEndAt && startsAt && salesEndAt > endsAt) {
    problems.push('Sales cannot close after the session has finished.')
  }

  if (session.venueMapVersionId && session.capacity != null) {
    problems.push(
      'A reserved session sells named seats, so it takes its capacity from the map rather than from a number.',
    )
  }

  if (!session.venueMapVersionId && (session.capacity ?? 0) <= 0) {
    problems.push('A general-admission session needs a capacity above zero.')
  }

  if (event?.isOnline === false && !event?.venueId) {
    problems.push('An in-person event needs a venue before it can have sessions.')
  }

  return problems
}

/**
 * Whether a string names a time zone this runtime knows.
 *
 * `Intl` is the authority rather than a hand-kept list: a list would be wrong
 * the first time a government moved a boundary, and being wrong here means an
 * event says the wrong hour to everybody who reads it.
 *
 * @param {string} timezone The candidate.
 * @returns {boolean} True when it resolves.
 */
export function isKnownTimeZone(timezone) {
  if (typeof timezone !== 'string' || timezone.length === 0) return false

  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/**
 * The currency a new tier is priced in when its author names none.
 *
 * The one the event's other tiers are priced in, because an order is paid in
 * one currency and a tier in another could never share a basket with them;
 * for an event's first tier, the organisation's own. Never a fixed code: a
 * literal default is how a tier on a dollar event came to be priced in rupees.
 *
 * @param {object} event The event, as {@link loadForAuthoring} loads it.
 * @returns {string} An ISO 4217 code.
 */
export function defaultTierCurrency(event) {
  return (
    (event?.ticketTypes ?? []).find((tier) => tier.currency)?.currency ??
    event?.organization?.payoutCurrency ??
    'USD'
  )
}

/**
 * Why a tier's currency does not fit the event's other tiers.
 *
 * Checkout refuses a basket that mixes currencies, so a tier priced apart from
 * the rest is one no buyer can add to theirs. Asked when a tier is added, and
 * when an edit changes a tier's currency.
 *
 * @param {object} tier The proposed tier, with its currency.
 * @param {object[]} siblings The event's ticket types.
 * @returns {string[]} Reasons. Empty means it fits.
 */
export function tierCurrencyProblems(tier, siblings) {
  const other = siblings.find(
    (sibling) => sibling.id !== tier.id && sibling.currency && sibling.currency !== tier.currency,
  )

  if (!other) return []

  return [
    `The other ticket types on this event are priced in ${other.currency}, and an order is paid in one currency, so price this one in ${other.currency} too.`,
  ]
}

/**
 * Why a proposed ticket type is not coherent.
 *
 * Run against the row as it would be stored — the stored row merged with the
 * change — so a patch that touches one field is still refused when the row as a
 * whole is not something the database or the public page can hold. A row
 * written before a limit tightened gets a sentence that says what to shorten,
 * rather than a constraint name.
 *
 * Three rules are checked here before the database is asked, because the
 * database's answer to each is an error, not a sentence: two tiers on one
 * event do not share a name (`TicketType_eventId_name_key`), the price zone
 * must be on the session's own map version
 * (`desi_ticket_type_zone_matches_session`), and one reserved tier prices a zone
 * at a session (`TicketType_reserved_session_zone_key`).
 *
 * @param {object} tier The proposed tier.
 * @param {object} event The event it belongs to.
 * @param {object[]} sessions The event's sessions.
 * @param {object} [options] Options.
 * @param {Map<string, object[]>} [options.zonesByVersion] Price zones per map version, from {@link loadZonesByVersion}.
 * @param {object[]} [options.siblings] The event's other ticket types, for the one-name and one-tier-per-zone rules.
 * @returns {string[]} Reasons. Empty means coherent.
 */
export function ticketTypeProblems(tier, event, sessions, options = {}) {
  const { zonesByVersion = event?.zonesByVersion ?? new Map(), siblings = [] } = options
  const problems = []
  const limits = EVENT_CONTENT_LIMITS

  if (!tier.name?.trim()) problems.push('The ticket type needs a name.')
  if (typeof tier.name === 'string' && tier.name.trim().length > limits.tierName) {
    problems.push(
      `Shorten the name (${tier.name.trim().length} of ${limits.tierName} characters) to save this ticket type.`,
    )
  }

  // The same comparison `TicketType_eventId_name_key` makes — exact, after the
  // request schema's trim — so this refuses exactly what the index would, with
  // a sentence instead of a 500.
  if (typeof tier.name === 'string' && tier.name.trim()) {
    const name = tier.name.trim()
    const namesake = siblings.find((other) => other.id !== tier.id && other.name === name)

    if (namesake) {
      problems.push(
        `Another ticket type on this event is already called "${name}". Give this one a different name.`,
      )
    }
  }

  if (typeof tier.description === 'string' && tier.description.length > limits.tierDescription) {
    problems.push(
      `Shorten the description (${tier.description.length} of ${limits.tierDescription} characters) to save this ticket type.`,
    )
  }

  if (!Number.isInteger(tier.priceCents) || tier.priceCents < 0) {
    problems.push('The price must be a whole number of minor units, and not negative.')
  }

  for (const [field, label] of [
    ['minPerOrder', 'least'],
    ['maxPerOrder', 'most'],
  ]) {
    const value = tier[field]

    if (value != null && (!Number.isInteger(value) || value < 1 || value > limits.perOrderMax)) {
      problems.push(
        `The ${label} per order is ${value}; it has to be between 1 and ${limits.perOrderMax}. Change it to save this ticket type.`,
      )
    }
  }

  const salesStartAt = tier.salesStartAt ? new Date(tier.salesStartAt) : null
  const salesEndAt = tier.salesEndAt ? new Date(tier.salesEndAt) : null

  if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) {
    problems.push('The sales window closes before it opens.')
  }

  /** @type {object|undefined} */
  let session

  if (tier.eventSessionId) {
    session = sessions.find((candidate) => candidate.id === tier.eventSessionId)

    // The database refuses this too — finding NF-20 — and this is the sentence
    // that says why rather than a constraint name.
    if (!session) {
      problems.push('That session belongs to a different event.')
    } else {
      if (tier.reserved && !session.venueMapVersionId) {
        problems.push('A reserved ticket type needs a session that has a seating map.')
      }

      if (salesEndAt && session.endsAt && salesEndAt > new Date(session.endsAt)) {
        problems.push('Sales for this ticket type cannot close after its session has finished.')
      }

      if (tier.priceZoneId && session.venueMapVersionId) {
        const zones = zonesByVersion.get(session.venueMapVersionId) ?? []

        if (!zones.some((zone) => zone.id === tier.priceZoneId)) {
          problems.push("That price zone is not on this session's seating map.")
        }
      } else if (tier.priceZoneId && !session.venueMapVersionId) {
        problems.push('This session has no seating map, so it has no price zones.')
      }
    }
  }

  if (tier.reserved) {
    if (!tier.priceZoneId) problems.push('A reserved ticket type needs a price zone.')
    if (!tier.eventSessionId) {
      problems.push('A reserved ticket type needs a session, because seats belong to one.')
    }

    if (tier.eventSessionId && tier.priceZoneId) {
      const taken = siblings.find(
        (other) =>
          other.id !== tier.id &&
          other.reserved &&
          other.eventSessionId === tier.eventSessionId &&
          other.priceZoneId === tier.priceZoneId,
      )

      if (taken) {
        problems.push(
          `Another reserved ticket type ("${taken.name}") already prices that zone at this session.`,
        )
      }
    }
  } else {
    if (!Number.isInteger(tier.quantityTotal) || tier.quantityTotal <= 0) {
      problems.push('A general-admission ticket type needs a quantity above zero.')
    } else if (Number.isInteger(tier.minPerOrder) && tier.minPerOrder > tier.quantityTotal) {
      problems.push('The least per order is more than the quantity on sale.')
    }

    if (tier.priceZoneId) {
      problems.push('Only a reserved ticket type prices a zone. Tick reserved seating or clear it.')
    }
  }

  if (tier.minPerOrder != null && tier.maxPerOrder != null && tier.minPerOrder > tier.maxPerOrder) {
    problems.push('The minimum per order is above the maximum.')
  }

  if (tier.complimentary && (tier.priceCents ?? 0) !== 0) {
    problems.push('A complimentary ticket type cannot have a price.')
  }

  if (tier.complimentary && tier.visibility && tier.visibility !== 'HIDDEN') {
    problems.push(
      'A complimentary ticket type is a guest list, so it is hidden from the public page.',
    )
  }

  return problems
}

/**
 * Turn a unique violation from a tier write into the conflict it means.
 *
 * `ticketTypeProblems` refuses a taken name or zone with a 422 before the
 * transaction opens, against the tiers the handler loaded. A write that lands
 * between that read and this one can still take the name or the zone first;
 * this is the net under the check, so the loser reads a 409 it can act on
 * rather than a 500. TicketType has two unique indexes besides its key — the
 * name per event and the reserved zone per session — and the violated one is
 * told apart by name wherever Prisma put it.
 *
 * @param {any} error Whatever was thrown.
 * @param {string} name The name the write asked for.
 * @returns {never} Always throws.
 * @throws {Error} The conflict, or the original error.
 */
export function rethrowTierTaken(error, name) {
  const database = databaseErrorCode(error)

  if (database !== 'P2002' && database !== '23505') throw error

  const meta = error?.meta
  const where = JSON.stringify([
    meta?.target ?? null,
    meta?.driverAdapterError?.cause?.constraint ?? null,
  ]).toLowerCase()

  if (where.includes('zone')) {
    throw httpError(
      409,
      'TIER_ZONE_TAKEN',
      'Another reserved ticket type was just set to price that zone at this session. Reload to see it, then choose a different zone.',
    )
  }

  if (where.includes('name')) {
    throw httpError(
      409,
      'TIER_NAME_TAKEN',
      `Another ticket type on this event was just called "${name}". Reload to see it, then choose a different name.`,
    )
  }

  throw error
}

/**
 * What is using each ticket type right now.
 *
 * `sold` is what has been paid for. `held` is what live holds are keeping off
 * sale: quantity for general admission, held seats for reserved. The two line
 * counts are what the database would refuse a delete over — an order line or a
 * hold line points at the tier with `onDelete: Restrict` — so a tier with
 * either is not removable, however old the line.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object[]} tiers The ticket type rows.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The moment in question.
 * @returns {Promise<Map<string, {sold: number, held: number, orderItems: number, holdItems: number, activeHolds: number}>>} Usage per tier id.
 */
export async function tierUsage(db, tiers, { now = new Date() } = {}) {
  const ids = tiers.map((tier) => tier.id)
  /** @type {Map<string, object>} */
  const usage = new Map()

  if (ids.length === 0) return usage

  const holds = await db.ticketHold.findMany({
    where: { ticketTypeId: { in: ids }, status: ACTIVE },
  })

  await Promise.all(
    tiers.map(async (tier) => {
      const [orderItems, holdItems, seatsSold, seatsHeld] = await Promise.all([
        db.orderItem.count({ where: { ticketTypeId: tier.id } }),
        db.holdItem.count({ where: { ticketTypeId: tier.id } }),
        tier.reserved
          ? db.eventSeat.count({
              where: { ticketTypeId: tier.id, status: { in: ['SOLD', 'COMPLIMENTARY'] } },
            })
          : 0,
        tier.reserved
          ? db.eventSeat.count({ where: { ticketTypeId: tier.id, status: 'HELD' } })
          : 0,
      ])
      const own = holds.filter((hold) => hold.ticketTypeId === tier.id)
      const live = own.filter((hold) => new Date(hold.expiresAt).getTime() > now.getTime())

      usage.set(tier.id, {
        sold: Math.max(tier.quantitySold ?? 0, seatsSold),
        held: tier.reserved ? seatsHeld : activeHeldQuantity(own, now),
        orderItems,
        holdItems,
        activeHolds: live.length,
      })
    }),
  )

  return usage
}

/**
 * Whether nothing depends on a ticket type, so removing it loses nothing.
 *
 * @param {{sold: number, held: number, orderItems: number, holdItems: number, activeHolds: number}} usage The tier's usage.
 * @returns {boolean} True when it can go.
 */
export function tierRemovable(usage) {
  return (
    usage.sold === 0 &&
    usage.held === 0 &&
    usage.orderItems === 0 &&
    usage.holdItems === 0 &&
    usage.activeHolds === 0
  )
}

/**
 * What is using each session right now.
 *
 * `sold` and `held` are what a general-admission capacity cut must leave room
 * for: the paid and live-held quantity of the tiers bound to the session, plus
 * its sold and held seats. The rest are what makes a session unremovable —
 * orders placed for it (by the order's own session, or by a line whose tier is
 * on it), hold lines, holds, seats in use and people already admitted.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object[]} sessions The session rows.
 * @param {object[]} tiers The event's ticket types.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The moment in question.
 * @returns {Promise<Map<string, {sold: number, held: number, orders: number, holdItems: number, holds: number, seats: number, checkIns: number}>>} Usage per session id.
 */
export async function sessionUsage(db, sessions, tiers, { now = new Date() } = {}) {
  /** @type {Map<string, object>} */
  const usage = new Map()

  if (sessions.length === 0) return usage

  const bound = tiers.filter((tier) => tier.eventSessionId)
  const perTier = await tierUsage(db, bound, { now })

  await Promise.all(
    sessions.map(async (session) => {
      const own = bound.filter((tier) => tier.eventSessionId === session.id)
      const ownIds = own.map((tier) => tier.id)
      const general = own.filter((tier) => !tier.reserved)

      const [orders, holds, seatsSold, seatsHeld, checkIns] = await Promise.all([
        db.order.count({
          where: {
            OR: [
              { eventSessionId: session.id },
              ...(ownIds.length > 0 ? [{ items: { some: { ticketTypeId: { in: ownIds } } } }] : []),
            ],
          },
        }),
        db.ticketHold.count({ where: { eventSessionId: session.id } }),
        db.eventSeat.count({
          where: { eventSessionId: session.id, status: { in: ['SOLD', 'COMPLIMENTARY'] } },
        }),
        db.eventSeat.count({ where: { eventSessionId: session.id, status: 'HELD' } }),
        db.checkIn.count({ where: { eventSessionId: session.id } }),
      ])

      const sum = (list, key) =>
        list.reduce((total, tier) => total + (perTier.get(tier.id)?.[key] ?? 0), 0)

      usage.set(session.id, {
        sold: sum(general, 'sold') + seatsSold,
        held: sum(general, 'held') + seatsHeld,
        orders,
        holdItems: sum(own, 'holdItems'),
        holds: holds + sum(own, 'activeHolds'),
        seats: seatsSold + seatsHeld,
        checkIns,
      })
    }),
  )

  return usage
}

/**
 * Whether nothing depends on a session, so removing it loses nothing.
 *
 * @param {{sold: number, held: number, orders: number, holdItems: number, holds: number, seats: number, checkIns: number}} usage The session's usage.
 * @returns {boolean} True when it can go.
 */
export function sessionRemovable(usage) {
  return Object.values(usage).every((count) => count === 0)
}

/**
 * Compare two values the way an edit form means them.
 *
 * @param {unknown} before The stored value.
 * @param {unknown} after The proposed value.
 * @returns {boolean} True when they mean the same thing.
 */
function unchanged(before, after) {
  if (before === after) return true
  if (before == null || after == null) return before == null && after == null
  if (before instanceof Date || after instanceof Date) {
    return new Date(before).getTime() === new Date(after).getTime()
  }

  return false
}

/**
 * The fields of a patch that actually change the stored row.
 *
 * @param {object} existing The stored row.
 * @param {object} patch The proposed change.
 * @returns {string[]} Field names whose value differs.
 */
export function changedFields(existing, patch) {
  return Object.keys(patch).filter(
    (field) => patch[field] !== undefined && !unchanged(existing[field], patch[field]),
  )
}

/**
 * Why a change to a ticket type would take something away from a buyer.
 *
 * A conflict, not an incoherence: the change is well formed, but the tier's
 * history says no. The rules are the same in both modes — a draft has nothing
 * sold, so they only ever bite on a live event — except that a live tier in use
 * cannot be put back to DRAFT, which would pull it off a page people bought from.
 *
 * @param {object} existing The stored tier.
 * @param {object} patch The proposed change.
 * @param {{sold: number, held: number, orderItems: number}} usage What is using it.
 * @param {'draft'|'live'} mode The editing mode.
 * @returns {{code: string, message: string, details: object}|null} The conflict, or null.
 */
export function tierChangeProblems(existing, patch, usage, mode) {
  const changed = changedFields(existing, patch)
  const details = { tierId: existing.id, sold: usage.sold, held: usage.held }

  if (changed.includes('priceCents') || changed.includes('currency')) {
    if (usage.sold > 0) {
      return {
        code: 'TIER_SOLD',
        message: `"${existing.name}" has already sold ${usage.sold}. Changing its price would change what those buyers agreed to pay.`,
        details,
      }
    }

    if (usage.held > 0) {
      return {
        code: 'TIER_IN_USE',
        message: `${usage.held} of "${existing.name}" are in somebody's basket right now, at the current price. Try again once they are bought or released.`,
        details,
      }
    }
  }

  const structural = ['reserved', 'eventSessionId', 'priceZoneId', 'complimentary'].filter(
    (field) => changed.includes(field),
  )
  const used = usage.sold > 0 || usage.held > 0 || (usage.orderItems ?? 0) > 0

  if (structural.length > 0 && used) {
    return {
      code: 'TIER_IN_USE',
      message: `"${existing.name}" has already been sold or held, so its night, its seating and whether it is complimentary stay as they are. Add a new ticket type instead.`,
      details: { ...details, fields: structural },
    }
  }

  if (
    mode === AUTHORING_MODES.LIVE &&
    changed.includes('status') &&
    patch.status === 'DRAFT' &&
    used
  ) {
    return {
      code: 'TIER_IN_USE',
      message: `"${existing.name}" has already been sold or held, so it cannot go back to being a draft. Pause it or hide it instead.`,
      details,
    }
  }

  if (changed.includes('quantityTotal') && !existing.reserved) {
    const floor = usage.sold + usage.held

    if (patch.quantityTotal < floor) {
      return {
        code: 'TIER_QUANTITY_BELOW_SOLD',
        message: `"${existing.name}" has ${usage.sold} sold and ${usage.held} held, so its quantity cannot go below ${floor}.`,
        details: { ...details, minimum: floor },
      }
    }
  }

  return null
}

/**
 * Why a change to a session would take something away from a buyer.
 *
 * @param {object} existing The stored session.
 * @param {object} patch The proposed change.
 * @param {{sold: number, held: number}} usage What is using it.
 * @param {'draft'|'live'} mode The editing mode.
 * @returns {{code: string, message: string, details: object}|null} The conflict, or null.
 */
export function sessionChangeProblems(existing, patch, usage, mode) {
  const changed = changedFields(existing, patch)

  if (mode === AUTHORING_MODES.LIVE && changed.includes('venueMapVersionId')) {
    return {
      code: 'SESSION_LAYOUT_LOCKED',
      message:
        'This event is public, so the seating layout of its sessions stays as it is. Add a new session with the other layout instead.',
      details: { sessionId: existing.id },
    }
  }

  if (changed.includes('capacity') && patch.capacity != null) {
    const floor = usage.sold + usage.held

    if (patch.capacity < floor) {
      return {
        code: 'SESSION_CAPACITY_BELOW_SOLD',
        message: `This session has ${usage.sold} sold and ${usage.held} held, so its capacity cannot go below ${floor}.`,
        details: { sessionId: existing.id, sold: usage.sold, held: usage.held, minimum: floor },
      }
    }
  }

  return null
}

/**
 * Throw a conflict built by {@link tierChangeProblems} or {@link sessionChangeProblems}.
 *
 * @param {{code: string, message: string, details: object}|null} problem The conflict.
 * @returns {void}
 * @throws {Error} A 409 carrying the conflict's own code.
 */
export function refuseConflict(problem) {
  if (!problem) return

  throw httpError(409, problem.code, problem.message, problem.details)
}

/**
 * Take a row lock on a session, for a capacity change that must see every hold.
 *
 * The same primitive as `lockTicketTypes`: the lock is taken before usage is
 * read, so a hold landing between the read and the write is either counted or
 * made to wait.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string} sessionId The session.
 * @returns {Promise<void>} Resolves once the row is locked.
 */
export async function lockSessionRow(tx, sessionId) {
  await tx.$queryRaw`SELECT id FROM "EventSession" WHERE id = ${sessionId} FOR UPDATE`
}

/**
 * Point every available, unheld seat of a session at the reserved ticket type
 * pricing its zone.
 *
 * `sessions.hold` sells a seat as the tier its `EventSeat.ticketTypeId` names,
 * so a seat with no tier cannot be sold, and nothing used to set one: an
 * organiser-authored reserved tier sold nothing. Two steps, for each reserved
 * tier of the session:
 *
 *   1. **Unbind** the seats a tier holds outside its zone — left behind when
 *      its zone changed, or when it stopped being reserved or left the
 *      session — so they are free for the tier that now prices them.
 *   2. **Bind** the free seats whose `Seat.priceZoneId` is the tier's zone.
 *
 * Only `AVAILABLE` seats with no hold are touched: a seat somebody holds or has
 * bought keeps the tier it was sold as. Idempotent — a second run changes
 * nothing — and plain `findMany`/`updateMany`, so it runs on the test double as
 * well as on PostgreSQL. Called on a reserved tier's create and update, when
 * inventory is prepared, and when sales open.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {object} options Options.
 * @param {string} options.eventSessionId The session.
 * @returns {Promise<{bound: number, unbound: number}>} How many seats changed.
 */
export async function bindReservedSeats(tx, { eventSessionId }) {
  const session = await tx.eventSession.findUnique({
    where: { id: eventSessionId },
    select: { id: true, venueMapVersionId: true },
  })

  if (!session?.venueMapVersionId) return { bound: 0, unbound: 0 }

  const tiers = await tx.ticketType.findMany({
    where: { eventSessionId, reserved: true },
    select: { id: true, priceZoneId: true },
  })
  const pricing = tiers.filter((tier) => tier.priceZoneId)
  const free = { eventSessionId, status: 'AVAILABLE', holdId: null }

  let unbound = 0
  let bound = 0

  // Seats bound to a tier that no longer prices any zone here: it stopped being
  // reserved, moved to another session, or was never this session's.
  const released = await tx.eventSeat.updateMany({
    where: {
      ...free,
      AND: [
        { ticketTypeId: { not: null } },
        { ticketTypeId: { notIn: pricing.map((tier) => tier.id) } },
      ],
    },
    data: { ticketTypeId: null },
  })

  unbound += released.count

  /** @type {Map<string, string[]>} */
  const seatsByZone = new Map()

  for (const tier of pricing) {
    if (!seatsByZone.has(tier.priceZoneId)) {
      const seats = await tx.seat.findMany({
        where: { venueMapVersionId: session.venueMapVersionId, priceZoneId: tier.priceZoneId },
        select: { id: true },
      })

      seatsByZone.set(
        tier.priceZoneId,
        seats.map((seat) => seat.id),
      )
    }

    const inZone = seatsByZone.get(tier.priceZoneId)

    const outside = await tx.eventSeat.updateMany({
      where: { ...free, ticketTypeId: tier.id, seatId: { notIn: inZone } },
      data: { ticketTypeId: null },
    })

    unbound += outside.count
  }

  for (const tier of pricing) {
    const inZone = seatsByZone.get(tier.priceZoneId)

    if (inZone.length === 0) continue

    const assigned = await tx.eventSeat.updateMany({
      where: { ...free, ticketTypeId: null, seatId: { in: inZone } },
      data: { ticketTypeId: tier.id },
    })

    bound += assigned.count
  }

  return { bound, unbound }
}

/**
 * Bind a session's seats and record it, when anything changed.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {string} options.eventId The event, for the audit row.
 * @param {string} options.eventSessionId The session.
 * @param {object|null} options.actor The request actor, or null for none.
 * @returns {Promise<{bound: number, unbound: number}>} How many seats changed.
 */
export async function bindReservedSeatsAudited(tx, { eventId, eventSessionId, actor }) {
  const result = await bindReservedSeats(tx, { eventSessionId })

  if (result.bound > 0 || result.unbound > 0) {
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.SEATS_BOUND,
      entityType: 'EventSession',
      entityId: eventSessionId,
      actorId: actor?.id ?? null,
      metadata: { eventId, bound: result.bound, unbound: result.unbound },
    })
  }

  return result
}

/**
 * Refuse a list of problems as one 422.
 *
 * @param {string[]} problems The reasons.
 * @param {string} summary What was refused.
 * @returns {void}
 * @throws {Error} A 422 when there is anything to refuse.
 */
export function refuseProblems(problems, summary) {
  if (problems.length === 0) return

  throw unprocessable(summary, { problems })
}

/**
 * Prepare the seat inventory for a session, idempotently.
 *
 * A reserved session sells rows in `EventSeat`, one per seat in the frozen map.
 * They have to exist before the session goes on sale, or the first buyer meets
 * a seating plan with nothing behind it.
 *
 * **Idempotent by construction, not by checking first.** The unique index on
 * `(eventSessionId, seatId)` is what makes a second run a no-op, so two
 * simultaneous preparations produce one set of rows rather than two or a
 * duplicate-key error surfaced to the organiser. `skipDuplicates` is doing the
 * work that a read-then-write would get wrong under concurrency.
 *
 * Seats already sold or held are never touched: the insert only adds what is
 * missing. Then every available, unheld seat is pointed at the reserved ticket
 * type pricing its zone ({@link bindReservedSeats}), in the same transaction as
 * the audit row, because a seat with no tier behind it cannot be sold.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event.
 * @param {string} options.sessionId The session to prepare.
 * @param {object} options.actor The request actor.
 * @returns {Promise<object>} What it found and what it created.
 */
export async function prepareInventory(prisma, { event, sessionId, actor }) {
  const session = (event.sessions ?? []).find((candidate) => candidate.id === sessionId)

  if (!session) throw notFound('No such session on this event.')

  if (!session.venueMapVersionId) {
    // A general-admission session counts a quantity; there are no seat rows to
    // prepare and pretending otherwise would create rows nothing reads.
    return {
      sessionId,
      kind: 'general_admission',
      expected: 0,
      prepared: 0,
      created: 0,
      assigned: 0,
    }
  }

  const seats = await prisma.seat.findMany({
    where: { venueMapVersionId: session.venueMapVersionId },
    select: { id: true },
  })

  if (seats.length === 0) {
    throw unprocessable('That seating map version has no seats in it.', {
      sessionId,
      venueMapVersionId: session.venueMapVersionId,
    })
  }

  const { count } = await prisma.eventSeat.createMany({
    data: seats.map((seat) => ({
      eventSessionId: session.id,
      seatId: seat.id,
      status: 'AVAILABLE',
    })),
    skipDuplicates: true,
  })

  return prisma.$transaction(async (tx) => {
    const binding = await bindReservedSeats(tx, { eventSessionId: session.id })
    const prepared = await tx.eventSeat.count({ where: { eventSessionId: session.id } })

    await recordAudit(tx, {
      action: 'event.inventory_prepared',
      entityType: 'EventSession',
      entityId: session.id,
      actorId: actor?.id ?? null,
      metadata: {
        eventId: event.id,
        expected: seats.length,
        created: count,
        prepared,
        bound: binding.bound,
        unbound: binding.unbound,
      },
    })

    if (binding.bound > 0 || binding.unbound > 0) {
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.SEATS_BOUND,
        entityType: 'EventSession',
        entityId: session.id,
        actorId: actor?.id ?? null,
        metadata: { eventId: event.id, bound: binding.bound, unbound: binding.unbound },
      })
    }

    return {
      sessionId,
      kind: 'reserved',
      expected: seats.length,
      prepared,
      created: count,
      assigned: binding.bound,
    }
  })
}

/**
 * The all-in price of one ticket of a tier, as a buyer will be charged it.
 *
 * "All-in" is the point. A face value that becomes something else at the last
 * step of checkout is the practice this preview exists to make impossible to
 * ship by accident: the organiser sees what the buyer sees, on the screen where
 * they set the number.
 *
 * Computed with the same `computeOrderTotals` the checkout uses, not a second
 * implementation that would drift — and with the same inputs: the deployment's
 * fee terms and the tax rule of the venue's jurisdiction. It used to be called
 * with neither, so an organiser setting a price saw the pricing package's
 * default fee and no tax, which was not what a buyer would be charged.
 *
 * @param {object} tier The ticket type.
 * @param {object} [options] Options.
 * @param {number} [options.quantity] How many. Defaults to one.
 * @param {object} [options.feeConfig] The fee terms checkout uses for the tier's currency.
 * @param {number} [options.taxRateBps] The tax rate checkout applies at the venue.
 * @returns {object} The breakdown.
 */
export function allInPreview(tier, { quantity = 1, feeConfig, taxRateBps = 0 } = {}) {
  const totals = computeOrderTotals({
    items: [
      {
        ticketTypeId: tier.id ?? 'preview',
        quantity,
        unitPriceCents: tier.priceCents ?? 0,
      },
    ],
    ...(feeConfig ? { feeConfig } : {}),
    taxRateBps,
    currency: tier.currency ?? 'INR',
  })

  return {
    currency: totals.currency,
    quantity,
    faceValueCents: totals.subtotalCents,
    feesCents: totals.feesCents,
    taxCents: totals.taxCents,
    allInCents: totals.totalCents,
  }
}
