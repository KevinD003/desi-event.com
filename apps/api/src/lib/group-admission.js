/**
 * Admission through a group pass: look the group up, then admit the people who
 * are actually at the door, each exactly once.
 *
 * Everything `./admission.js` says about a single ticket holds here, and this
 * module reuses its pieces rather than restating them: resolve first, authorise
 * against the order's own event, tell an outsider the same 404 as for a pass
 * that does not exist, never trust a preview, derive the method from what was
 * presented, and never record the presented pass, code or reference.
 *
 * ## The group
 *
 * Computed live at every read (`./group-passes.js`): the tickets on the order
 * that its buyer still holds, minus rows a later row replaced. Each ticket gets
 * the same outcome and closed refusal reason a single lookup would give it —
 * on the night the door names, as for a single ticket (`nightFor` in
 * `./admission.js`): a ticket for another night is refused `WRONG_NIGHT`, and a
 * ticket good for every night is "already in" only when it was let in tonight.
 * Each ticket carries its own night, so a steward sees it.
 *
 * ## Partial admission, stated
 *
 * The confirmation names the tickets being admitted now (`ticketIds`), which
 * must all have been admissible in the preview. Inside one transaction:
 *
 * - a named ticket already admitted is reported, not refused, so a retry after
 *   a lost answer is safe;
 * - a named ticket that stopped admitting for any other reason — refunded,
 *   withdrawn, handed on — admits **nobody**, and the answer is 409
 *   `GROUP_CHANGED`: look the group up again;
 * - otherwise each is admitted through the same `admit()` a single ticket
 *   uses — exactly once per ticket, or once per night for a ticket good for
 *   every night, by the unique `CheckIn(ticketId, eventSessionId)` — with
 *   `CheckIn.groupPassId` set. A database trigger refuses a group
 *   admission of a ticket on another order, or one its buyer no longer holds.
 *
 * ## Locks, in one order
 *
 * The order `FOR SHARE` (a refund settling it updates the order before it
 * touches tickets, so the two take turns), the group pass `FOR SHARE` (a
 * replacement updates it), the named tickets `FOR UPDATE` sorted by id (every
 * single-ticket writer locks its one ticket), then the membership and scope
 * `FOR SHARE`, as a single admission does. No path takes these in another
 * order, so none can deadlock against this one.
 *
 * @module @desi-event/api/lib/group-admission
 */

import { Prisma } from '@desi-event/db'
import { GROUP_PASS_MAX_TICKETS } from '@desi-event/schemas'

import {
  PREVIEW_TTL_MS,
  UNIFORM_NOT_FOUND,
  ADMISSION_INCLUDE,
  admissionConflict,
  admissionOn,
  alreadyIn,
  assertDoorAuthority,
  doorName,
  eventNights,
  nightFor,
  readAdmissionAuthority,
  readGroupPreviewReference,
  recordPlatformAuthorityUse,
  signGroupPreviewReference,
  toAdmissionEvent,
  toAdmissionSeat,
  toAdmissionSession,
} from './admission.js'
import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { databaseErrorCode, forbidden, notFound } from './errors.js'
import { groupCodeDigest, groupCredentialDigest } from './group-pass-credentials.js'
import { GROUP_ORDER_SELECT, groupMembers, orderTicketRows } from './group-passes.js'
import { admissionRefusalCode, admit } from './tickets.js'

/**
 * How long one group confirmation may hold its locks.
 *
 * Fifty tickets is about 150 statements. A timeout rolls everything back and
 * the door is told the answer is uncertain; a retry is safe, because each
 * ticket is admitted at most once.
 *
 * @type {Readonly<{timeout: number, maxWait: number}>}
 */
export const GROUP_TRANSACTION_OPTIONS = Object.freeze({ timeout: 15_000, maxWait: 5_000 })

/**
 * Which secret was presented for a group, and the method that follows.
 *
 * @param {{credential?: string, code?: string}} body A parsed request body.
 * @returns {{credential: string|null, code: string|null, method: 'QR_SCAN'|'MANUAL_CODE'}} The presentation.
 */
export function groupPresentationOf(body) {
  if (body.credential) return { credential: body.credential, code: null, method: 'QR_SCAN' }

  return { credential: null, code: body.code, method: 'MANUAL_CODE' }
}

/**
 * Resolve a group presentation to its pass, with the order and event.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {{credential: string|null, code: string|null}} presentation What was presented.
 * @returns {Promise<object|null>} The pass, or null.
 */
export async function resolveGroup(db, presentation) {
  const where = presentation.credential
    ? { credentialHash: groupCredentialDigest(presentation.credential) }
    : { codeHash: groupCodeDigest(presentation.code) }

  return db.groupPass.findUnique({
    where,
    select: {
      id: true,
      orderId: true,
      credentialVersion: true,
      order: { select: GROUP_ORDER_SELECT },
    },
  })
}

/**
 * One ticket's door outcome, as a single lookup would give it.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @param {object} order Its order.
 * @param {object} event Its event.
 * @param {{night: string|null, everyNight: boolean, refusal: string|null}} context Its night, from `nightFor`.
 * @returns {{outcome: string, refusal: string|null}} The outcome.
 */
function ticketOutcome(ticket, order, event, context) {
  if (context.refusal) return { outcome: 'REFUSED', refusal: context.refusal }

  if (alreadyIn(ticket, context)) {
    return { outcome: 'ALREADY_CHECKED_IN', refusal: null }
  }

  const refusal = admissionRefusalCode(ticket, order, event)

  return refusal ? { outcome: 'REFUSED', refusal } : { outcome: 'ADMISSIBLE', refusal: null }
}

/**
 * When a ticket was let in on the night in question, or null.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @param {{night: string|null, everyNight: boolean}|null} context Its night.
 * @returns {Date|null} The instant.
 */
function admittedAt(ticket, context) {
  const admission = admissionOn(ticket, context)

  if (context?.everyNight) return admission?.scannedAt ?? null

  return admission?.scannedAt ?? ticket.checkedInAt ?? null
}

/**
 * One ticket of a group, as the door is told about it. Named, not spread.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @param {{outcome: string, refusal: string|null}} verdict Its outcome.
 * @param {{night: string|null, everyNight: boolean}|null} context Its night.
 * @returns {object} A payload satisfying `groupAdmissionTicketSchema`.
 */
function toGroupTicket(ticket, verdict, context) {
  return {
    ticketId: ticket.id,
    outcome: verdict.outcome,
    refusal: verdict.refusal,
    tier: ticket.orderItem?.ticketType ? { name: ticket.orderItem.ticketType.name } : null,
    seat: toAdmissionSeat(ticket),
    // Which night the ticket is for, so a steward sees a Night 2 ticket on
    // Night 1. Null for a ticket good for every night.
    session: toAdmissionSession(ticket),
    attendeeName: doorName(ticket.attendeeName),
    checkedInAt: admittedAt(ticket, context),
  }
}

/**
 * The group's own outcome, from its tickets'.
 *
 * Admissible when anybody is; already in when nobody is admissible and
 * somebody is in; refused otherwise, with the tickets' shared reason when they
 * share one.
 *
 * @param {Array<{outcome: string, refusal: string|null}>} tickets The per-ticket outcomes.
 * @returns {{outcome: string, refusal: string|null}} The group outcome.
 */
function groupOutcome(tickets) {
  if (tickets.some((ticket) => ticket.outcome === 'ADMISSIBLE')) {
    return { outcome: 'ADMISSIBLE', refusal: null }
  }

  if (tickets.some((ticket) => ticket.outcome === 'ALREADY_CHECKED_IN')) {
    return { outcome: 'ALREADY_CHECKED_IN', refusal: null }
  }

  const reasons = new Set(tickets.map((ticket) => ticket.refusal).filter(Boolean))

  return { outcome: 'REFUSED', refusal: reasons.size === 1 ? [...reasons][0] : 'NOT_ADMISSIBLE' }
}

/**
 * Look a group pass up at the door without admitting anybody.
 *
 * Writes an audit row and nothing else.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {object} options.env The API environment, for `AUTH_SECRET`.
 * @param {object} options.actor The request actor.
 * @param {object} options.body The parsed `groupAdmissionPreviewRequestSchema` body.
 * @param {object} [options.log] A request logger.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} A payload satisfying `groupAdmissionPreviewResponseSchema`'s `data`.
 * @throws {Error} A 403 for a caller with no door authority; the uniform 404 otherwise.
 */
export async function previewGroupAdmission({ prisma, env, actor, body, log, now = new Date() }) {
  await assertDoorAuthority(prisma, actor, 'group_preview')

  const presentation = groupPresentationOf(body)
  const pass = await resolveGroup(prisma, presentation)
  const order = pass?.order ?? null
  const event = order?.event ?? null

  if (!pass || !order || !event) {
    log?.info(
      { actorId: actor.id, presented: presentation.method },
      'group admission preview: nothing resolved',
    )
    throw notFound(UNIFORM_NOT_FOUND)
  }

  const authority = await readAdmissionAuthority(prisma, {
    actorId: actor.id,
    platformRole: actor.role ?? null,
    organizationId: event.organizationId,
    eventId: event.id,
  })

  if (!authority) {
    await recordAudit(prisma, {
      action: AUDIT_ACTIONS.TICKET_ADMISSION_REFUSED,
      entityType: 'GroupPass',
      entityId: pass.id,
      actorId: actor.id,
      metadata: {
        operation: 'group_preview',
        reason: 'NOT_AUTHORISED_FOR_EVENT',
        method: presentation.method,
      },
    })

    throw notFound(UNIFORM_NOT_FOUND)
  }

  const rows = await orderTicketRows(prisma, order.id)
  const { tickets, handedOn } = groupMembers(order, rows)
  const named = body.eventSessionId ?? null
  const nights = await eventNights(prisma, event.id)

  let listed = []
  let outcome
  let refusal

  if (tickets.length > GROUP_PASS_MAX_TICKETS) {
    // Cannot come from a pass the buyer was given (retrieval refuses more
    // than fifty), and a door is not the place to page through a list.
    outcome = 'REFUSED'
    refusal = 'NOT_ADMISSIBLE'
  } else if (body.expectedEventId && body.expectedEventId !== event.id) {
    listed = tickets.map((ticket) =>
      toGroupTicket(ticket, { outcome: 'REFUSED', refusal: 'WRONG_EVENT' }, null),
    )
    outcome = 'REFUSED'
    refusal = 'WRONG_EVENT'
  } else {
    listed = tickets.map((ticket) => {
      const context = nightFor(ticket, nights, named)

      return toGroupTicket(ticket, ticketOutcome(ticket, order, event, context), context)
    })
    ;({ outcome, refusal } = groupOutcome(listed))
  }

  const counts = {
    admissible: listed.filter((ticket) => ticket.outcome === 'ADMISSIBLE').length,
    alreadyIn: listed.filter((ticket) => ticket.outcome === 'ALREADY_CHECKED_IN').length,
    refused: listed.filter((ticket) => ticket.outcome === 'REFUSED').length,
  }

  const admissibleIds = listed
    .filter((ticket) => ticket.outcome === 'ADMISSIBLE')
    .map((ticket) => ticket.ticketId)
  const previewExpiresAt =
    admissibleIds.length > 0 ? new Date(now.getTime() + PREVIEW_TTL_MS) : null
  const previewReference = previewExpiresAt
    ? signGroupPreviewReference({
        secret: env.AUTH_SECRET,
        groupPassId: pass.id,
        groupPassVersion: pass.credentialVersion,
        eventId: event.id,
        organizationId: event.organizationId,
        actorId: actor.id,
        method: presentation.method,
        ticketIds: admissibleIds,
        night: named,
        expiresAt: previewExpiresAt,
      })
    : null

  await recordAudit(prisma, {
    action: AUDIT_ACTIONS.TICKET_GROUP_ADMISSION_PREVIEWED,
    entityType: 'GroupPass',
    entityId: pass.id,
    actorId: actor.id,
    metadata: {
      outcome,
      refusal,
      method: presentation.method,
      authority: authority.authority,
      role: authority.role,
      eventId: event.id,
      organizationId: event.organizationId,
      orderId: order.id,
      credentialVersion: pass.credentialVersion,
      eventSessionId: named,
      counts,
      handedOn,
    },
  })

  if (authority.authority === 'PLATFORM_ROLE') {
    await recordPlatformAuthorityUse(prisma, {
      actorId: actor.id,
      eventId: event.id,
      organizationId: event.organizationId,
      operation: 'group_preview',
      subject: { groupPassId: pass.id },
      outcome,
    })
  }

  return {
    outcome,
    refusal,
    method: presentation.method,
    event: toAdmissionEvent(event),
    tickets: listed,
    counts,
    handedOn,
    previewReference,
    previewExpiresAt,
  }
}

/**
 * Admit the named tickets of a previewed group, in one transaction.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {object} options.env The API environment, for `AUTH_SECRET`.
 * @param {object} options.actor The request actor.
 * @param {object} options.body The parsed `groupCheckInRequestSchema` body.
 * @param {object} [options.log] A request logger.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} A payload satisfying `groupCheckInResponseSchema`'s `data`.
 * @throws {Error} 403 without authority, the uniform 404, or a 409 carrying a refusal reason.
 */
export async function confirmGroupAdmission({ prisma, env, actor, body, log, now = new Date() }) {
  await assertDoorAuthority(prisma, actor, 'group_check_in')

  const presentation = groupPresentationOf(body)
  const reference = readGroupPreviewReference({
    secret: env.AUTH_SECRET,
    reference: body.previewReference,
    now,
  })

  if (!reference.ok) throw admissionConflict(reference.reason)

  const claims = reference.claims

  if (claims.a !== actor.id) throw admissionConflict('PREVIEW_INVALID')
  if (claims.m !== presentation.method) throw admissionConflict('PREVIEW_MISMATCH')
  if ((body.eventSessionId ?? null) !== claims.n) throw admissionConflict('PREVIEW_MISMATCH')

  // Only tickets the preview found admissible. A steward cannot widen a
  // lookup by naming a ticket it did not show them.
  const previewed = new Set(claims.ts)

  if (!body.ticketIds.every((id) => previewed.has(id))) {
    throw admissionConflict('PREVIEW_MISMATCH')
  }

  let verdict

  try {
    verdict = await prisma.$transaction(
      (tx) => decideGroup(tx, { actor, body, presentation, claims, now }),
      GROUP_TRANSACTION_OPTIONS,
    )
  } catch (error) {
    // A writer outside this module that did not take the ticket locks, or the
    // group-pass trigger. Either way the group changed under the confirmation,
    // nothing was admitted, and looking it up again shows what it is now.
    const code = databaseErrorCode(error)

    if (code !== 'P2002' && code !== 'P0001' && error?.details?.reason !== 'NOT_ADMISSIBLE') {
      throw error
    }

    verdict = { kind: 'refused', reason: 'GROUP_CHANGED' }
  }

  if (verdict.kind === 'done') {
    log?.info(
      {
        groupPassId: claims.g,
        eventId: claims.e,
        admitted: verdict.result.admitted,
        method: presentation.method,
      },
      'group admitted',
    )

    return verdict.result
  }

  await recordAudit(prisma, {
    action: AUDIT_ACTIONS.TICKET_ADMISSION_REFUSED,
    entityType: 'GroupPass',
    entityId: claims.g,
    actorId: actor.id,
    metadata: {
      operation: 'group_check_in',
      reason: verdict.reason ?? null,
      method: presentation.method,
      ticketIds: body.ticketIds,
    },
  })

  if (verdict.kind === 'forbidden') {
    throw forbidden('You are no longer authorised to admit to this event.')
  }

  if (verdict.kind === 'hidden') throw notFound(UNIFORM_NOT_FOUND)

  throw admissionConflict(verdict.reason)
}

/**
 * The decision, inside the transaction that acts on it.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.actor The request actor.
 * @param {object} options.body The request body.
 * @param {object} options.presentation From {@link groupPresentationOf}.
 * @param {object} options.claims The verified group preview reference.
 * @param {Date} options.now The instant.
 * @returns {Promise<object>} A verdict: done, refused, forbidden or hidden.
 */
async function decideGroup(tx, { actor, body, presentation, claims, now }) {
  // The pass's order is fixed for the life of the row, so it is read without a
  // lock to find what to lock first.
  const anchor = await tx.groupPass.findUnique({
    where: { id: claims.g },
    select: { orderId: true },
  })

  if (!anchor) return { kind: 'hidden', reason: 'NOT_ADMISSIBLE' }

  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${anchor.orderId} FOR SHARE`
  await tx.$queryRaw`SELECT "id" FROM "GroupPass" WHERE "id" = ${claims.g} FOR SHARE`

  const ticketIds = [...new Set(body.ticketIds)].sort()

  await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" IN (${Prisma.join(ticketIds)}) ORDER BY "id" FOR UPDATE`

  const user = await tx.user.findUnique({
    where: { id: actor.id },
    select: { role: true, suspendedAt: true },
  })
  const platformRole = user && !user.suspendedAt ? user.role : null

  const pass = await tx.groupPass.findUnique({
    where: { id: claims.g },
    select: {
      id: true,
      orderId: true,
      credentialVersion: true,
      order: { select: GROUP_ORDER_SELECT },
    },
  })
  const order = pass?.order ?? null
  const event = order?.event ?? null

  if (!pass || !order || !event) return { kind: 'hidden', reason: 'NOT_ADMISSIBLE' }

  const authority =
    user && !user.suspendedAt
      ? await readAdmissionAuthority(tx, {
          actorId: actor.id,
          platformRole,
          organizationId: event.organizationId,
          eventId: event.id,
          lock: true,
        })
      : null

  if (!authority) return { kind: 'forbidden', reason: 'NOT_AUTHORISED_FOR_EVENT' }

  // What was presented must still be this pass at the version looked up: a
  // pass replaced since the preview confirms nothing.
  const presented = await resolveGroup(tx, presentation)

  if (
    !presented ||
    presented.id !== claims.g ||
    pass.credentialVersion !== claims.gv ||
    event.id !== claims.e ||
    event.organizationId !== claims.o
  ) {
    return { kind: 'refused', reason: 'PREVIEW_MISMATCH' }
  }

  if (body.expectedEventId && body.expectedEventId !== event.id) {
    return { kind: 'refused', reason: 'WRONG_EVENT' }
  }

  const rows = await orderTicketRows(tx, order.id)
  const { tickets } = groupMembers(order, rows)
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const nights = await eventNights(tx, event.id)
  const contexts = new Map()

  const toAdmit = []
  const already = []

  for (const id of ticketIds) {
    const ticket = byId.get(id)

    // Handed on, superseded, or never the buyer's: the group changed.
    if (!ticket) return { kind: 'refused', reason: 'GROUP_CHANGED' }

    const context = nightFor(ticket, nights, claims.n)

    contexts.set(ticket.id, context)

    // The preview found it admissible on this night; a night that stopped
    // applying to it (the organiser moved its tier, say) changed the group.
    if (context.refusal) return { kind: 'refused', reason: 'GROUP_CHANGED' }

    if (alreadyIn(ticket, context)) {
      already.push(ticket)
      continue
    }

    if (admissionRefusalCode(ticket, order, event)) {
      return { kind: 'refused', reason: 'GROUP_CHANGED' }
    }

    toAdmit.push(ticket)
  }

  for (const ticket of toAdmit) {
    const context = contexts.get(ticket.id)

    await admit(tx, {
      ticket,
      eventSessionId: context.night,
      everyNight: context.everyNight,
      scannedByUserId: actor.id,
      scannerId: body.deviceId ?? null,
      gate: body.gate ?? null,
      method: presentation.method,
      authority: authority.authority,
      role: authority.role,
      organizationId: event.organizationId,
      groupPassId: pass.id,
      now,
    })
  }

  if (toAdmit.length > 0) {
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.TICKET_GROUP_ADMITTED,
      entityType: 'GroupPass',
      entityId: pass.id,
      actorId: actor.id,
      metadata: {
        at: now.toISOString(),
        orderId: order.id,
        eventId: event.id,
        organizationId: event.organizationId,
        admittedTicketIds: toAdmit.map((ticket) => ticket.id),
        alreadyIn: already.length,
        eventSessionId: claims.n,
        method: presentation.method,
        authority: authority.authority,
        role: authority.role,
        gate: body.gate ?? null,
        credentialVersion: pass.credentialVersion,
      },
    })

    if (authority.authority === 'PLATFORM_ROLE') {
      await recordPlatformAuthorityUse(tx, {
        actorId: actor.id,
        eventId: event.id,
        organizationId: event.organizationId,
        operation: 'group_check_in',
        subject: { groupPassId: pass.id, ticketIds: toAdmit.map((ticket) => ticket.id) },
        outcome: 'ADMITTED',
      })
    }
  }

  const admittedIds = new Set(toAdmit.map((ticket) => ticket.id))
  const after = await tx.ticket.findMany({
    where: { id: { in: ticketIds } },
    include: ADMISSION_INCLUDE,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  return {
    kind: 'done',
    result: {
      outcome: toAdmit.length > 0 ? 'ADMITTED' : 'ALREADY_CHECKED_IN',
      admitted: toAdmit.length,
      alreadyIn: already.length,
      method: presentation.method,
      event: toAdmissionEvent(event),
      tickets: after.map((ticket) => {
        const context = contexts.get(ticket.id) ?? null
        const admission = admissionOn(ticket, context)

        return {
          ticketId: ticket.id,
          outcome: admittedIds.has(ticket.id) ? 'ADMITTED' : 'ALREADY_CHECKED_IN',
          checkedInAt: admittedAt(ticket, context),
          checkedInByYou:
            Boolean(admission?.scannedByUserId) && admission.scannedByUserId === actor.id,
          tier: ticket.orderItem?.ticketType ? { name: ticket.orderItem.ticketType.name } : null,
          seat: toAdmissionSeat(ticket),
          session: toAdmissionSession(ticket),
          attendeeName: doorName(ticket.attendeeName),
        }
      }),
    },
  }
}
