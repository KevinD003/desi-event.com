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
import { bindReservedSeatsAudited } from './event-authoring.js'
import { authorityAuditMetadata, byPlatform, lifecycleAuthority } from './event-authority.js'
import {
  OUT_OF_TIME_RETRY_AFTER_SECONDS,
  conflict,
  databaseRefusal,
  exposedServerError,
  forbidden,
  httpError,
  isOutOfTime,
  notFound,
  unprocessable,
} from './errors.js'
import { assertIndependentReviewer, reviewIndependence } from './review-independence.js'
import { boundLockWait } from './transaction-budget.js'

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

  // Presence is not content. An editor that always sends the policies object,
  // with every field empty, satisfies `!event.policies` while the buyer has
  // still agreed to nothing — which is precisely what this gate exists to stop.
  const policies = event.policies ?? {}
  const written = Object.values(policies).filter(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )

  if (written.length === 0) {
    problems.push('The event needs entry, refund and conduct policies.')
  } else if (typeof policies.refund !== 'string' || !policies.refund.trim()) {
    // Named separately because it is the one a person goes looking for when
    // something has gone wrong, and "see the entry policy" is not an answer.
    problems.push('The event needs a refund policy.')
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
 * How many seats each on-sale reserved ticket type has behind it.
 *
 * A reserved tier sells the seats whose `EventSeat.ticketTypeId` names it, and
 * nothing else; one with none is a price with nothing to buy.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} event The event, with its ticket types.
 * @returns {Promise<Map<string, number>>} Bound seat count per reserved on-sale tier id.
 */
export async function boundSeatCounts(prisma, event) {
  const tiers = (event.ticketTypes ?? []).filter(
    (tier) => tier.reserved && tier.status === 'ON_SALE',
  )
  const entries = await Promise.all(
    tiers.map(async (tier) => [
      tier.id,
      await prisma.eventSeat.count({ where: { ticketTypeId: tier.id } }),
    ]),
  )

  return new Map(/** @type {Array<Array<*>>} */ (entries))
}

/**
 * Why an event has nothing to sell.
 *
 * @param {object} event The event, loaded by {@link loadForTransition}.
 * @param {object} [options] Options.
 * @param {Map<string, number>} [options.boundSeats] From {@link boundSeatCounts}; without it the seat check is skipped.
 * @returns {string[]} Human-readable reasons. Empty means sellable.
 */
export function sellabilityProblems(event, { boundSeats = null } = {}) {
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
    } else if (tier.reserved && boundSeats && (boundSeats.get(tier.id) ?? 0) === 0) {
      problems.push(
        `Reserved ticket type "${tier.name}" has no seats. Prepare its session's inventory, and check its price zone has seats on the map.`,
      )
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
  if (gate === GATES.SELLABLE) {
    return sellabilityProblems(event, { boundSeats: await boundSeatCounts(prisma, event) })
  }
  if (gate === GATES.INVENTORY_PREPARED) return inventoryProblems(prisma, event)

  // An unknown gate is a programming error, and failing closed is the only safe
  // way to be wrong about it.
  return [`Unknown precondition "${gate}".`]
}

/**
 * Why a set of gates is shut for an event, every reason from every gate.
 *
 * The same checks {@link transitionEvent} runs, for a move another module
 * makes itself: an import's own moves into review and into PUBLISHED
 * (`lib/event-import.js`, SPEC2-XI I-C), which the table's actor would refuse
 * the team at The Desi Events.
 *
 * @param {object} prisma The Prisma client or a transaction client.
 * @param {object} event The event, loaded as {@link loadForTransition} loads it.
 * @param {ReadonlyArray<string>} gates The gates, from the move.
 * @returns {Promise<string[]>} Reasons. Empty means every gate is open.
 */
export async function gateProblems(prisma, event, gates) {
  /** @type {string[]} */
  const blockers = []

  for (const gate of gates) blockers.push(...(await checkGate(gate, prisma, event)))

  return blockers
}

/**
 * Why an event in the organisation that holds imported events cannot be sent
 * back for changes (SPEC2-XI O16): nobody runs it on The Desi Events, so nobody
 * could make them.
 *
 * Word for word the web's `IMPORTED_EVENT_NO_EDITOR_NOTICE`
 * (`apps/web/src/lib/review-independence.js`). The spec's first wording said
 * "yet", which the honest-copy rule forbids; both now say what is true today.
 */
export const IMPORTED_EVENT_NO_EDITOR_SENTENCE =
  'Nobody runs this event on The Desi Events, so nobody could make changes you ask for. Approve it and correct it once it is published, reject it, or delete it.'

/**
 * Whether an event belongs to an organisation that holds imported events.
 *
 * @param {object} event The event, with `organization` loaded.
 * @returns {boolean} True when it is platform-held.
 */
export function isPlatformHeld(event) {
  return Boolean(event?.organization?.platformHeldSource)
}

/**
 * The organiser's sales moves the team at The Desi Events makes for an event
 * the platform-held organisation holds, which has no organiser here to make
 * them: opening sales and pausing them. Since 2026-10-15 imported events are
 * sold on The Desi Events, so an administrator with an open editing sitting
 * (`resolveEventAuthority`) may make these two, and only these two, on such
 * an event; publishing, postponing and cancelling stay as Rule L has them.
 */
export const PLATFORM_HELD_SALES_MOVES = Object.freeze(new Set(['ON_SALE', 'SALES_PAUSED']))

/**
 * Assert the actor is entitled to make this kind of move, and say whose
 * authority it is made under.
 *
 * An organiser's move follows Rule L (SPEC2-XI X-A): the actor's membership,
 * or a SUPER_ADMIN's platform role, recorded as the doing of the team at The
 * Desi Events; a platform ADMIN is refused with `ORGANIZER_ONLY`, except for
 * {@link PLATFORM_HELD_SALES_MOVES} on a platform-held event, made under the
 * sitting the caller resolved (`sitting`).
 *
 * @param {object} move The transition from the table.
 * @param {object} actor The request actor.
 * @param {object} event The event.
 * @param {object|null} [sitting] A sitting's authority (`resolveEventAuthority`), for a platform-held event's sales.
 * @returns {object|null} The authority for an organiser's move; null for a moderator's.
 * @throws {Error} A 403 when the actor is not entitled.
 */
function assertEntitled(move, actor, event, sitting = null) {
  if (move.actor === ACTORS.SYSTEM) {
    // No route reaches a system transition. If one ever does, this is the line
    // that says so rather than a comment claiming it.
    throw forbidden('This transition is made by the platform, not by a caller.')
  }

  if (isOwnCommand(move)) {
    // Deletion and restore are in the table so it names every move, but each
    // is a command of its own with its own preview, confirmation and audit
    // (`lib/event-deletion.js`). `transitionEvent` never makes either.
    throw conflict(
      'Deletion and restore are commands of their own: delete an event with POST /v1/events/:id/delete; only the team at The Desi Events restores one.',
      { from: event.status, to: move.to, code: 'ILLEGAL_TRANSITION' },
    )
  }

  if (move.actor === ACTORS.MODERATOR) {
    assertCan(actor, MODERATION_CAPABILITY)
    return null
  }

  // An organiser move. The capability depends on the destination, because
  // publishing and cancelling are not the same authority as submitting.
  try {
    return lifecycleAuthority(actor, event, capabilityFor(move.to))
  } catch (error) {
    if (
      error?.code === 'ORGANIZER_ONLY' &&
      sitting?.kind === 'PLATFORM' &&
      sitting.via === 'SITTING' &&
      isPlatformHeld(event) &&
      PLATFORM_HELD_SALES_MOVES.has(move.to)
    ) {
      return sitting
    }

    throw error
  }
}

/**
 * Whether a move is deletion or restore, which are commands of their own and
 * never offered or made here.
 *
 * @param {object} move The transition from the table.
 * @returns {boolean} True for a DELETION or RESTORE move.
 */
function isOwnCommand(move) {
  return move.actor === ACTORS.DELETION || move.actor === ACTORS.RESTORE
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
    if (move.actor === ACTORS.SYSTEM || isOwnCommand(move)) continue
    // Nobody could make the changes to a platform-held import (O16).
    if (move.to === 'CHANGES_REQUIRED' && isPlatformHeld(event)) continue

    let entitled =
      move.actor === ACTORS.MODERATOR
        ? can(actor, MODERATION_CAPABILITY)
        : can(actor, capabilityFor(move.to), { organizationId: event.organizationId }) ||
          // The team's sales moves on a platform-held event, made in an
          // editing sitting (checked when the move is asked for).
          (isPlatformHeld(event) &&
            PLATFORM_HELD_SALES_MOVES.has(move.to) &&
            can(actor, CAPABILITIES.EVENT_PLATFORM_EDIT))

    /** @type {string[]} */
    const blockers = []

    // A reviewer who belongs to the organisation, or who sent the event for
    // review, holds the capability and still may not decide: the move is shown
    // as not theirs, with the reason.
    if (entitled && move.actor === ACTORS.MODERATOR) {
      const { independent, reason } = await reviewIndependence(prisma, {
        actor,
        organizationId: event.organizationId,
        eventId: event.id,
      })

      if (!independent) {
        entitled = false
        blockers.push(reason)
      }
    }

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
 * @param {Function} [options.onCommit] Extra work inside the transaction, given `(tx, event, { authority, byPlatform })`. It may return `{ auditMetadata }`, which the transition's audit record carries beside `from`, `to` and `reason`.
 * @param {{timeout: number, maxWait: number}} [options.transactionOptions] The transaction's budget, when `onCommit` does work that grows with the event (a cancellation reserves a refund per paid order). Prisma's default of five seconds otherwise.
 * @param {number} [options.lockWaitMs] When set, the longest any statement of the transaction waits for one lock another transaction holds (`lock_timeout`), and no statement outlives `transactionOptions.timeout` (`statement_timeout`): `lib/transaction-budget.js`, for a caller whose budget counts on it.
 * @param {object|null} [options.sitting] An administrator's open sitting (`resolveEventAuthority`), under which {@link PLATFORM_HELD_SALES_MOVES} are made on a platform-held event; the caller re-checks it inside `onCommit`.
 * @returns {Promise<object>} The updated event.
 * @throws {Error} 403, 404, 409 or 422, each meaning something different; 503 when the transaction outran its budget and nothing was changed.
 */
export async function transitionEvent(prisma, options) {
  const {
    event,
    to,
    actor,
    reason = null,
    requestedChanges = null,
    onCommit = null,
    transactionOptions = undefined,
    lockWaitMs = null,
    sitting = null,
  } = options
  const from = event.status

  // 1. Is the move in the table at all?
  const move = findTransition(from, to)

  if (!move) {
    // Name the ways out as well as the way that is shut. A refusal that says
    // only "no" makes the caller guess, and the guesses are what produce the
    // next three support tickets.
    const ways = transitionsFrom(from)
      .filter((candidate) => candidate.actor !== ACTORS.SYSTEM && !isOwnCommand(candidate))
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

  // 2. Is this actor entitled to it? A moderator decision also needs a
  // reviewer independent of the event: not a member of its organisation, and
  // not the person who sent it for review.
  const authority = assertEntitled(move, actor, event, sitting)

  // A platform-held import has nobody to make changes: approve, reject or
  // delete it instead (SPEC2-XI O16).
  if (to === 'CHANGES_REQUIRED' && isPlatformHeld(event)) {
    throw httpError(409, 'IMPORTED_EVENT_NO_EDITOR', IMPORTED_EVENT_NO_EDITOR_SENTENCE, {
      from,
      to,
    })
  }

  /** @type {{exemption: string, importedById: string|null, approvedById: string|null}|null} */
  let exempted = null

  if (move.actor === ACTORS.MODERATOR) {
    const { exemption } = await assertIndependentReviewer(prisma, {
      actor,
      organizationId: event.organizationId,
      eventId: event.id,
    })

    // The administrator who imported a platform-held event approving it
    // (SPEC2-XI O5): recorded on the moderation action and in the audit, with
    // who imported and who approved. The exemption holds only when the
    // importer of record sent this version for review themselves, so the
    // record's importer is the submission it waived.
    if (exemption) {
      const item = await prisma.eventImportItem.findUnique({
        where: { eventId: event.id },
        select: { importedById: true },
      })

      exempted = {
        exemption,
        importedById: item?.importedById ?? null,
        approvedById: actor?.id ?? null,
      }
    }
  }

  // Opening sales binds every seated session's free seats to the reserved tier
  // pricing their zone first, so the sellable gate below counts seats that can
  // actually be sold. Idempotent, and only after the entitlement check: a caller
  // who may not open sales changes nothing.
  if (to === 'ON_SALE') {
    const seated = (event.sessions ?? []).filter((session) => session.venueMapVersionId)

    for (const session of seated) {
      await prisma.$transaction((tx) =>
        bindReservedSeatsAudited(tx, { eventId: event.id, eventSessionId: session.id, actor }),
      )
    }
  }

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
  return prisma
    .$transaction(async (tx) => {
      if (lockWaitMs) {
        await boundLockWait(tx, {
          lockMs: lockWaitMs,
          statementMs: transactionOptions?.timeout ?? lockWaitMs,
        })
      }

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
          reason: exempted ? exemptionNote(exempted, reason) : reason,
          requestedChanges,
        },
      })

      const updated = await tx.event.findUnique({ where: { id: event.id } })

      // The work first, then the record of the move, so the record can say what
      // the work did — a cancellation's refunds, and the orders it left to the
      // finance team — rather than only that it happened. Both are in this
      // transaction, so neither is written without the other.
      const work = onCommit
        ? await onCommit(tx, updated, { authority, byPlatform: byPlatform(authority) })
        : null

      // A SUPER_ADMIN's move on an organisation it is not a member of is
      // recorded as the doing of the team at The Desi Events (Rule L).
      await recordAudit(tx, {
        action: `event.${to.toLowerCase()}`,
        entityType: 'Event',
        entityId: event.id,
        actorId: actor?.id ?? null,
        metadata: {
          ...(work?.auditMetadata ?? {}),
          ...authorityAuditMetadata(authority),
          ...(exempted ?? {}),
          from,
          to,
          reason,
        },
      })

      return updated
    }, transactionOptions)
    .catch((error) => {
      // The review gate in the database (`desi_event_status_requires_review`)
      // refusing a move the table above should never have offered: a 409
      // `REVIEW_REQUIRED`, not a 500.
      throw databaseRefusal(error) ?? outranBudget(error, { from, to })
    })
}

/**
 * The note an approval under the import exemption carries on its moderation
 * action: the exemption, who imported and who approved (SPEC2-XI O5), after
 * the reviewer's own reason when there is one.
 *
 * @param {{exemption: string, importedById: string|null, approvedById: string|null}} exempted The exemption.
 * @param {string|null} reason The reviewer's reason.
 * @returns {string} The note.
 */
export function exemptionNote({ exemption, importedById, approvedById }, reason = null) {
  const note = `Approved under the ${exemption} exemption: imported by ${importedById ?? 'an account since removed'}, approved by ${approvedById ?? 'an account since removed'}.`

  return reason ? `${reason} ${note}` : note
}

/**
 * The refusal for a transition whose transaction ran out of time.
 *
 * Prisma rolls an interactive transaction back once it outlives its timeout
 * (`P2028`), and PostgreSQL ends one whose statement waited past its
 * `lock_timeout` (`55P03`) or `statement_timeout` (`57014`), so nothing of the
 * move was kept: the event is still what it was, and no work it would have
 * raised exists. Said so, as a 503 the caller can retry (with `Retry-After`),
 * rather than as a 500 carrying the driver's message. Anything else is passed
 * through untouched.
 *
 * @param {unknown} error Whatever the transaction threw.
 * @param {object} move The move.
 * @param {string} move.from The status the event still has.
 * @param {string} move.to The status it did not reach.
 * @returns {unknown} The error to throw.
 */
function outranBudget(error, { from, to }) {
  if (!isOutOfTime(error)) return error

  return Object.assign(
    exposedServerError(
      503,
      'SERVICE_UNAVAILABLE',
      `This event could not become ${to} in time, so nothing was changed: it is still ${from}. Try again in a moment.`,
      { from, to },
    ),
    { retryAfterSeconds: OUT_OF_TIME_RETRY_AFTER_SECONDS },
  )
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

/**
 * The columns a move to `to` writes, as {@link transitionEvent} writes them:
 * for a deletion that cancels an event before taking it off (SPEC2-XI X-D),
 * which writes CANCELLED itself because `assertEntitled` would refuse the
 * team at The Desi Events, and must stamp it exactly as a cancellation does.
 *
 * @param {object} options Options.
 * @param {string} options.to The destination.
 * @param {string|null} options.reason The reason.
 * @param {object} options.event The event as it was.
 * @returns {object} The Prisma `data` payload.
 */
export function lifecycleStamps(options) {
  return stampsFor(options)
}
