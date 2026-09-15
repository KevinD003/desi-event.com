/**
 * Moving an event from one status to the next.
 *
 * `@desi-event/schemas/lifecycle` says which moves exist. This module says
 * whether *this* caller may make *this* one *now*, and then makes it in a way
 * that survives two people pressing the button at once.
 *
 * ## The shape of every transition
 *
 * Four steps, in this order, and the order is the design:
 *
 *   1. **Is the move in the table?** A status that is not a legal destination
 *      from the current one is refused before anything else is looked up.
 *      Findings NF-17 and NF-18 were both the absence of this step.
 *   2. **Is this actor entitled to it?** The table names an actor kind; the
 *      capability check turns that into a question about this person and this
 *      organisation. A moderator decision demands a platform capability, so an
 *      organiser cannot approve their own event however the request is shaped.
 *   3. **Are the gates satisfied?** Verified organiser, publishable, sellable,
 *      inventory prepared — each is a query, and each runs *before* the write
 *      opens a transaction, so a refusal never leaves a partial write behind.
 *      That is the same ordering `writeLayout` uses in `venue-maps.js`, and for
 *      the same reason.
 *   4. **Write it, conditionally.** The update names the status it expects to
 *      be replacing. If the affected-row count is not one, somebody else moved
 *      first and the caller is told so rather than overwriting them.
 *
 * ## Why the conditional update rather than a lock
 *
 * Two moderators opening the queue at the same moment will both see
 * `REVIEW_PENDING` and both press Approve. A read-then-write loses one decision
 * silently. `updateMany({ where: { id, status: from } })` returns a count, and
 * a count of zero is the second moderator being told the truth. It is the same
 * primitive the seat and venue-map code uses, and using a third mechanism here
 * would mean three things to get right instead of one.
 *
 * ## What is never inside the transaction
 *
 * No provider call, ever. Cancellation creates *work items* — notification and
 * refund rows — inside the transaction, because they must commit with the
 * status change or not at all. Performing the refund is the worker's job, and
 * the worker runs after the commit.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath (it is how JSDoc names an event), so a path segment spelled
 * exactly that fails `jsdoc/valid-types`. The same limitation is why
 * `apps/web/src/app/organizer/venues/new/page.jsx` uses `@file` too.
 *
 * @file @desi-event/api/lib/event-lifecycle
 */

import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'
import { ACTORS, GATES, findTransition, transitionsFrom } from '@desi-event/schemas/lifecycle'

import { recordAudit } from './audit.js'
import { conflict, forbidden, notFound, unprocessable } from './errors.js'

/**
 * Organisation verification states from which an event may be published.
 *
 * `VERIFIED` only. A pending application is not a decision, and a suspended or
 * revoked organisation is a decision in the other direction.
 *
 * @type {ReadonlySet<string>}
 */
const PUBLISHABLE_VERIFICATION_STATES = Object.freeze(new Set(['VERIFIED']))

/**
 * The capability a moderator decision needs.
 *
 * Platform-level, not organisation-level, which is the whole point: an
 * organisation role can never carry it, so no amount of seniority inside an
 * organisation lets somebody approve their own event.
 *
 * @type {string}
 */
const MODERATION_CAPABILITY = CAPABILITIES.MODERATION_REVIEW

/**
 * Everything a transition needs to know about an event, loaded once.
 *
 * @param {object} prisma The Prisma client.
 * @param {string} eventId The event.
 * @returns {Promise<object>} The event with the relations the gates read.
 * @throws {Error} A 404 when there is no such event.
 */
export async function loadForTransition(prisma, eventId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      organization: true,
      sessions: { include: { venueMapVersion: true } },
      ticketTypes: true,
      venue: true,
    },
  })

  if (!event) throw notFound('No such event.')

  return event
}

/**
 * Why an event is not ready to be published.
 *
 * Returns every reason rather than the first, because an organiser fixing one
 * thing at a time and resubmitting is a worse experience than a list — and
 * because a moderator reading the same list knows what to expect.
 *
 * @param {object} event The event, loaded by {@link loadForTransition}.
 * @returns {string[]} Human-readable reasons. Empty means publishable.
 */
export function publishabilityProblems(event) {
  const problems = []

  if (!event.title?.trim()) problems.push('The event needs a title.')
  if (!event.summary?.trim()) problems.push('The event needs a summary.')
  if (!event.description?.trim()) problems.push('The event needs a description.')
  if (!event.category) problems.push('The event needs a category.')
  if (!event.timezone) problems.push('The event needs a time zone.')

  if (!event.isOnline && !event.venueId) {
    problems.push('An in-person event needs a venue.')
  }

  if (event.isOnline && !event.onlineUrl) {
    problems.push('An online event needs a joining link.')
  }

  if (!event.policies) {
    problems.push('The event needs entry, refund and conduct policies.')
  }

  if (event.endsAt && event.startsAt && event.endsAt <= event.startsAt) {
    problems.push('The event must end after it starts.')
  }

  const sessions = event.sessions ?? []

  if (sessions.length === 0) {
    problems.push('The event needs at least one session.')
  }

  for (const session of sessions) {
    const label = session.startsAt ? session.startsAt.toISOString() : session.id

    if (!session.timezone) {
      problems.push(`Session ${label} needs a time zone.`)
    }

    if (session.endsAt && session.startsAt && session.endsAt <= session.startsAt) {
      problems.push(`Session ${label} must end after it starts.`)
    }

    if (session.salesStartAt && session.salesEndAt && session.salesEndAt <= session.salesStartAt) {
      problems.push(`Session ${label} has a sales window that closes before it opens.`)
    }

    // A reserved session sells named seats, so the layout behind it has to be
    // one that can no longer change. A draft map version would let the seats
    // move under an order that has already been placed.
    if (session.venueMapVersionId && !session.venueMapVersion?.publishedAt) {
      problems.push(
        `Session ${label} uses a seating map version that is still a draft. Publish the map version first.`,
      )
    }
  }

  return problems
}

/**
 * Why an event has nothing to sell.
 *
 * @param {object} event The event, loaded by {@link loadForTransition}.
 * @returns {string[]} Human-readable reasons. Empty means sellable.
 */
export function sellabilityProblems(event) {
  const problems = []
  const tiers = (event.ticketTypes ?? []).filter((tier) => tier.status === 'ON_SALE')

  if (tiers.length === 0) {
    problems.push('Put at least one ticket type on sale before opening sales.')
  }

  for (const tier of tiers) {
    if (tier.salesStartAt && tier.salesEndAt && tier.salesEndAt <= tier.salesStartAt) {
      problems.push(`Ticket type "${tier.name}" closes sales before it opens them.`)
    }

    if (!tier.reserved && (tier.quantityTotal ?? 0) <= 0) {
      problems.push(`Ticket type "${tier.name}" has no quantity to sell.`)
    }

    if (tier.reserved && !tier.priceZoneId) {
      problems.push(`Reserved ticket type "${tier.name}" needs a price zone.`)
    }
  }

  return problems
}

/**
 * Why an event's inventory is not ready.
 *
 * A reserved session sells rows in `EventSeat`, one per seat in the frozen map.
 * Publishing before they exist would offer a seating plan with nothing behind
 * it, and the first buyer would find an empty hall.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} event The event, loaded by {@link loadForTransition}.
 * @returns {Promise<string[]>} Human-readable reasons. Empty means prepared.
 */
export async function inventoryProblems(prisma, event) {
  const problems = []

  for (const session of event.sessions ?? []) {
    if (!session.venueMapVersionId) continue

    const [prepared, expected] = await Promise.all([
      prisma.eventSeat.count({ where: { eventSessionId: session.id } }),
      prisma.seat.count({ where: { venueMapVersionId: session.venueMapVersionId } }),
    ])

    if (expected === 0) {
      problems.push(
        `Session ${session.startsAt?.toISOString() ?? session.id} uses a seating map with no seats in it.`,
      )
      continue
    }

    if (prepared !== expected) {
      problems.push(
        `Session ${session.startsAt?.toISOString() ?? session.id} has ${prepared} of ${expected} seats prepared. Prepare its inventory before publishing.`,
      )
    }
  }

  return problems
}

/**
 * Check one gate.
 *
 * @param {string} gate One of `GATES`.
 * @param {object} prisma The Prisma client.
 * @param {object} event The event.
 * @returns {Promise<string[]>} Reasons the gate is shut. Empty means open.
 */
async function checkGate(gate, prisma, event) {
  if (gate === GATES.VERIFIED_ORGANIZER) {
    const status = event.organization?.verificationStatus

    if (!PUBLISHABLE_VERIFICATION_STATES.has(status)) {
      return [
        `This organisation is ${String(status ?? 'unverified').toLowerCase()}. Only a verified organisation may publish or sell.`,
      ]
    }

    return []
  }

  if (gate === GATES.PUBLISHABLE) return publishabilityProblems(event)
  if (gate === GATES.SELLABLE) return sellabilityProblems(event)
  if (gate === GATES.INVENTORY_PREPARED) return inventoryProblems(prisma, event)

  // An unknown gate is a programming error, and failing closed is the only safe
  // way to be wrong about it.
  return [`Unknown precondition "${gate}".`]
}

/**
 * Assert the actor is entitled to make this kind of move.
 *
 * @param {object} move The transition from the table.
 * @param {object} actor The request actor.
 * @param {object} event The event.
 * @returns {void}
 * @throws {Error} A 403 when the actor is not entitled.
 */
function assertEntitled(move, actor, event) {
  if (move.actor === ACTORS.SYSTEM) {
    // No route reaches a system transition. If one ever does, this is the line
    // that says so rather than a comment claiming it.
    throw forbidden('This transition is made by the platform, not by a caller.')
  }

  if (move.actor === ACTORS.MODERATOR) {
    assertCan(actor, MODERATION_CAPABILITY)
    return
  }

  // An organiser move. The capability depends on the destination, because
  // publishing and cancelling are not the same authority as submitting.
  const capability = capabilityFor(move.to)

  assertCan(actor, capability, { organizationId: event.organizationId })
}

/**
 * The organisation capability a destination demands.
 *
 * @param {string} to The destination status.
 * @returns {string} The capability name.
 */
export function capabilityFor(to) {
  if (to === 'REVIEW_PENDING') return CAPABILITIES.EVENT_SUBMIT_REVIEW
  if (to === 'PUBLISHED') return CAPABILITIES.EVENT_PUBLISH
  if (to === 'ON_SALE') return CAPABILITIES.EVENT_PUBLISH
  if (to === 'SALES_PAUSED') return CAPABILITIES.EVENT_PAUSE_SALES
  if (to === 'CANCELLED') return CAPABILITIES.EVENT_CANCEL
  if (to === 'POSTPONED') return CAPABILITIES.EVENT_CANCEL
  if (to === 'ARCHIVED') return CAPABILITIES.EVENT_DELETE

  // Withdrawing a submission or reworking a rejection is ordinary editing.
  return CAPABILITIES.EVENT_UPDATE
}

/**
 * Which moves this actor could make right now, with the reasons for the rest.
 *
 * The organiser's screen uses this to decide what to offer and what to explain.
 * It is a convenience, not a control: {@link transitionEvent} re-derives all of
 * it and never trusts a caller who says they already checked.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} event The event, loaded by {@link loadForTransition}.
 * @param {object} actor The request actor.
 * @returns {Promise<object[]>} One entry per move out of the current status.
 */
export async function availableTransitions(prisma, event, actor) {
  const moves = transitionsFrom(event.status)
  const out = []

  for (const move of moves) {
    if (move.actor === ACTORS.SYSTEM) continue

    const entitled =
      move.actor === ACTORS.MODERATOR
        ? can(actor, MODERATION_CAPABILITY)
        : can(actor, capabilityFor(move.to), { organizationId: event.organizationId })

    /** @type {string[]} */
    const blockers = []

    if (entitled) {
      for (const gate of move.gates) blockers.push(...(await checkGate(gate, prisma, event)))
    }

    out.push({ to: move.to, actor: move.actor, entitled, blockers })
  }

  return out
}

/**
 * Move an event from one status to another.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event, loaded by {@link loadForTransition}.
 * @param {string} options.to The destination status.
 * @param {object} options.actor The request actor.
 * @param {string} [options.reason] Why, for the audit trail and the attendee notice.
 * @param {object} [options.requestedChanges] What a moderator wants changed.
 * @param {Function} [options.onCommit] Extra work inside the transaction, given `(tx, event)`.
 * @returns {Promise<object>} The updated event.
 * @throws {Error} 403, 404, 409 or 422, each meaning something different.
 */
export async function transitionEvent(prisma, options) {
  const { event, to, actor, reason = null, requestedChanges = null, onCommit = null } = options
  const from = event.status

  // 1. Is the move in the table at all?
  const move = findTransition(from, to)

  if (!move) {
    // Name the ways out as well as the way that is shut. A refusal that says
    // only "no" makes the caller guess, and the guesses are what produce the
    // next three support tickets.
    const ways = transitionsFrom(from)
      .filter((candidate) => candidate.actor !== ACTORS.SYSTEM)
      .map((candidate) => candidate.to)

    const next =
      ways.length > 0
        ? ` From ${from} it can become ${ways.join(', ')}.`
        : ` ${from} is a final state.`

    throw conflict(`An event that is ${from} cannot become ${to}.${next}`, {
      from,
      to,
      available: ways,
      code: 'ILLEGAL_TRANSITION',
    })
  }

  // 2. Is this actor entitled to it?
  assertEntitled(move, actor, event)

  // 3. Are the gates open? Every one of them, before any write.
  /** @type {string[]} */
  const blockers = []

  for (const gate of move.gates) blockers.push(...(await checkGate(gate, prisma, event)))

  if (blockers.length > 0) {
    throw unprocessable(`This event is not ready to become ${to}.`, {
      from,
      to,
      problems: blockers,
    })
  }

  // 4. Write it, naming the status we expect to be replacing.
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.event.updateMany({
      where: { id: event.id, status: from },
      data: stampsFor({ to, reason, event }),
    })

    if (count !== 1) {
      // Somebody moved first. Tell the caller what it is now rather than what
      // they thought it was.
      const current = await tx.event.findUnique({
        where: { id: event.id },
        select: { status: true },
      })

      throw conflict(
        `This event is no longer ${from}; it is ${current?.status ?? 'gone'}. Reload and try again.`,
        { from, to, currentStatus: current?.status ?? null, code: 'STALE_STATUS' },
      )
    }

    await tx.eventModerationAction.create({
      data: {
        eventId: event.id,
        actorId: actor?.id ?? null,
        fromStatus: from,
        toStatus: to,
        reason,
        requestedChanges,
      },
    })

    await recordAudit(tx, {
      action: `event.${to.toLowerCase()}`,
      entityType: 'Event',
      entityId: event.id,
      actorId: actor?.id ?? null,
      metadata: { from, to, reason },
    })

    const updated = await tx.event.findUnique({ where: { id: event.id } })

    if (onCommit) await onCommit(tx, updated)

    return updated
  })
}

/**
 * The timestamp columns a destination writes.
 *
 * Kept separate from the transition so the rules are readable as a list rather
 * than as branches inside a transaction.
 *
 * @param {object} options Options.
 * @param {string} options.to The destination.
 * @param {string|null} options.reason The reason, when one was given.
 * @param {object} options.event The event as it was.
 * @returns {object} The Prisma `data` payload.
 */
function stampsFor({ to, reason, event }) {
  /** @type {Record<string, unknown>} */
  const data = { status: to }

  if (to === 'REVIEW_PENDING') {
    data.reviewSubmittedAt = new Date()
    // A resubmission answers the last set of requested changes, so the note
    // stops being current the moment it is acted on.
    data.moderationNote = null
  }

  if (to === 'CHANGES_REQUIRED' || to === 'REJECTED') {
    data.moderationNote = reason
  }

  if (to === 'DRAFT') {
    data.reviewSubmittedAt = null
  }

  if (to === 'PUBLISHED' && !event.publishedAt) {
    data.publishedAt = new Date()
  }

  if (to === 'ON_SALE' && !event.salesOpenedAt) {
    // Once set, the map version behind the sessions is frozen. It is set once
    // and never cleared, because a pause is not an un-sale.
    data.salesOpenedAt = new Date()
  }

  if (to === 'CANCELLED') {
    data.cancelledAt = new Date()
    data.cancellationReason = reason
  }

  if (to === 'POSTPONED') {
    data.postponedAt = new Date()
    data.previousStartsAt = event.startsAt
  }

  return data
}
