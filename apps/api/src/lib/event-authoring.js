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
 * A draft or a changes-required event is the organiser's to change freely. A
 * review-pending one is not — editing under a moderator's nose changes what
 * they are reviewing. A published one is not either, except through the
 * material-change workflow, because somebody has bought a ticket on the
 * strength of what it said.
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

import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { EDITABLE_STATUSES } from '@desi-event/schemas/lifecycle'
import { computeOrderTotals } from '@desi-event/pricing'

import { recordAudit } from './audit.js'
import { conflict, notFound, unprocessable } from './errors.js'

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

  return event
}

/**
 * Assert this actor may change this event's content right now.
 *
 * Two questions, and they fail differently on purpose: "you may not" is a 403,
 * "not in this state" is a 409. A screen that conflates them tells an organiser
 * to ask for a permission they already hold.
 *
 * @param {object} event The event.
 * @param {object} actor The request actor.
 * @returns {void}
 * @throws {Error} A 403 or a 409.
 */
export function assertAuthorable(event, actor) {
  assertCan(actor, CAPABILITIES.EVENT_UPDATE, { organizationId: event.organizationId })

  if (!EDITABLE_STATUSES.has(event.status)) {
    throw conflict(
      `This event is ${event.status} and its content cannot be edited. ` +
        (event.status === 'REVIEW_PENDING'
          ? 'Withdraw it from review first.'
          : 'Published events change through an explicit material-change confirmation.'),
      { status: event.status, code: 'NOT_EDITABLE' },
    )
  }
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
 * @returns {Promise<object>} The event after the write.
 * @throws {Error} A 409 when the revision has moved.
 */
export async function authorChange(prisma, options) {
  const { event, revision, actor, action, write } = options

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

      throw conflict(
        current?.status !== event.status
          ? `This event is no longer ${event.status}; it is ${current?.status ?? 'gone'}. Reload before editing.`
          : 'Somebody else saved a change to this event while you were editing. Reload to take their version, or copy your changes somewhere before you do.',
        {
          expectedRevision: revision,
          currentRevision: current?.revision ?? null,
          currentStatus: current?.status ?? null,
          code: 'STALE_REVISION',
        },
      )
    }

    await write(tx, event)

    await recordAudit(tx, {
      action,
      entityType: 'Event',
      entityId: event.id,
      actorId: actor?.id ?? null,
      metadata: { revision: revision + 1 },
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
 * @returns {string[]} Reasons. Empty means coherent.
 */
export function sessionProblems(session, event) {
  const problems = []
  const startsAt = session.startsAt ? new Date(session.startsAt) : null
  const endsAt = session.endsAt ? new Date(session.endsAt) : null

  if (!startsAt || Number.isNaN(startsAt.getTime()))
    problems.push('The session needs a start time.')
  if (!endsAt || Number.isNaN(endsAt.getTime())) problems.push('The session needs an end time.')

  if (startsAt && endsAt && endsAt <= startsAt) {
    problems.push('The session must end after it starts.')
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
 * Why a proposed ticket type is not coherent.
 *
 * @param {object} tier The proposed tier.
 * @param {object} event The event it belongs to.
 * @param {object[]} sessions The event's sessions.
 * @returns {string[]} Reasons. Empty means coherent.
 */
export function ticketTypeProblems(tier, event, sessions) {
  const problems = []

  if (!tier.name?.trim()) problems.push('The ticket type needs a name.')
  if (!Number.isInteger(tier.priceCents) || tier.priceCents < 0) {
    problems.push('The price must be a whole number of minor units, and not negative.')
  }

  const salesStartAt = tier.salesStartAt ? new Date(tier.salesStartAt) : null
  const salesEndAt = tier.salesEndAt ? new Date(tier.salesEndAt) : null

  if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) {
    problems.push('The sales window closes before it opens.')
  }

  if (tier.eventSessionId) {
    const session = sessions.find((candidate) => candidate.id === tier.eventSessionId)

    // The database refuses this too — finding NF-20 — and this is the sentence
    // that says why rather than a constraint name.
    if (!session) {
      problems.push('That session belongs to a different event.')
    } else if (tier.reserved && !session.venueMapVersionId) {
      problems.push('A reserved ticket type needs a session that has a seating map.')
    }
  }

  if (tier.reserved) {
    if (!tier.priceZoneId) problems.push('A reserved ticket type needs a price zone.')
    if (!tier.eventSessionId) {
      problems.push('A reserved ticket type needs a session, because seats belong to one.')
    }
  } else if (!Number.isInteger(tier.quantityTotal) || tier.quantityTotal <= 0) {
    problems.push('A general-admission ticket type needs a quantity above zero.')
  }

  if (tier.minPerOrder != null && tier.maxPerOrder != null && tier.minPerOrder > tier.maxPerOrder) {
    problems.push('The minimum per order is above the maximum.')
  }

  if (tier.complimentary && (tier.priceCents ?? 0) !== 0) {
    problems.push('A complimentary ticket type cannot have a price.')
  }

  return problems
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
 * missing.
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
    return { sessionId, kind: 'general_admission', expected: 0, prepared: 0, created: 0 }
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

  const prepared = await prisma.eventSeat.count({ where: { eventSessionId: session.id } })

  await recordAudit(prisma, {
    action: 'event.inventory_prepared',
    entityType: 'EventSession',
    entityId: session.id,
    actorId: actor?.id ?? null,
    metadata: { eventId: event.id, expected: seats.length, created: count, prepared },
  })

  return { sessionId, kind: 'reserved', expected: seats.length, prepared, created: count }
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
 * implementation that would drift.
 *
 * @param {object} tier The ticket type.
 * @param {object} [options] Options.
 * @param {number} [options.quantity] How many. Defaults to one.
 * @returns {object} The breakdown.
 */
export function allInPreview(tier, { quantity = 1 } = {}) {
  const totals = computeOrderTotals({
    items: [
      {
        ticketTypeId: tier.id ?? 'preview',
        quantity,
        unitPriceCents: tier.priceCents ?? 0,
      },
    ],
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
