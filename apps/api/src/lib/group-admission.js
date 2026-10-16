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
 * The nights the admissions are written on `FOR KEY SHARE`, sorted (the lock a
 * `CheckIn` insert's foreign key takes anyway, taken first as a single
 * admission takes its night, SPEC3 §9.5), the order `FOR SHARE` (a refund
 * settling it updates the order before it touches tickets, so the two take
 * turns), the group pass `FOR SHARE` (a replacement updates it), the named
 * tickets' order lines `FOR KEY SHARE` sorted by id (the lock a ticket's
 * foreign key takes when an admission updates it twice; a transfer
 * acceptance holds a line `FOR UPDATE` before it locks its ticket), the named
 * tickets `FOR UPDATE` sorted by id (every single-ticket writer locks its one
 * ticket), then the membership and scope `FOR SHARE`, as a single admission
 * does. No path takes these in another order, so none can deadlock against
 * this one.
 *
 * ## Paying at the door for several tickets at once (SPEC3 §9.5)
 *
 * Each ticket says what it owes at the door and whether it was paid there,
 * and the lookup sums what the admissible tickets still owe; the reference
 * carries each one's share. The confirmation's `paymentCents` must equal the
 * named tickets' shares together (else 422 `PAYMENT_AMOUNT_MISMATCH`), and,
 * under the locks, the named tickets still unpaid must be exactly those the
 * lookup found unpaid (else 409 `GROUP_CHANGED`). One payment (`DOOR_GROUP`)
 * is recorded for exactly those tickets, then each is admitted. The group pass
 * covers only the buyer's own tickets: one passed on is paid for at the door
 * by whoever holds it, with their own ticket.
 *
 * @module @desi-event/api/lib/group-admission
 */

import { Prisma } from '@desi-event/db'
import { GROUP_PASS_MAX_TICKETS } from '@desi-event/schemas'

import {
  PREVIEW_TTL_MS,
  UNIFORM_NOT_FOUND,
  ADMISSION_INCLUDE,
  DOOR_LOCK_WAIT,
  admissionConflict,
  admissionNightOf,
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
import {
  databaseErrorCode,
  databaseRefusal,
  forbidden,
  notFound,
  paymentTermsRefusal,
} from './errors.js'
import { groupCodeDigest, groupCredentialDigest } from './group-pass-credentials.js'
import { boundLockWait, outOfTimeRefusal } from './transaction-budget.js'
import { GROUP_ORDER_SELECT, groupMembers, orderTicketRows, supersededIds } from './group-passes.js'
import { admissionRefusalCode, admit } from './tickets.js'
import { isUnpaidVenueTicket } from './venue-payment-filters.js'
import { VENUE_PAYMENT_VIA, doorAmount, recordVenuePayment } from './venue-payments.js'

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
 * What a steward is told when a group's confirmation waited too long behind
 * another change: a 503 with `Retry-After`. The transaction was rolled back
 * whole.
 */
export const GROUP_DOOR_BUSY_SENTENCE =
  'Another change to this group’s booking or night was being saved at the same moment, so nobody in the group was let in and no payment was recorded. Look the group up again in a moment.'

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
    // What it owes at the door (0 when nothing) and whether it was paid there.
    dueCents: ticket.venueDueCents ?? 0,
    paid: Boolean(ticket.venuePaymentId),
  }
}

/**
 * What a ticket still owes at the door: its share when it has no payment, else 0.
 *
 * @param {{venueDueCents?: number, venuePaymentId?: string|null}} ticket A ticket row.
 * @returns {number} Cents.
 */
function unpaidShare(ticket) {
  return (ticket.venueDueCents ?? 0) > 0 && !ticket.venuePaymentId ? ticket.venueDueCents : 0
}

/**
 * The tickets of an order now held by other accounts than its buyer that
 * still owe at the door: they pay with their own tickets (SPEC3-XI §9.5).
 *
 * @param {object} order The order, with `userId`.
 * @param {Array<object>} rows Every ticket row on the order.
 * @returns {number} How many.
 */
function handedOnUnpaid(order, rows) {
  const superseded = supersededIds(rows)

  return rows.filter(
    (row) =>
      !superseded.has(row.id) &&
      (row.ownerUserId ?? null) !== (order.userId ?? null) &&
      isUnpaidVenueTicket(row),
  ).length
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
  // What the admissible tickets still owe at the door, each, and together;
  // and how many of the booking's tickets other people hold that still owe.
  const byTicket = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const admissibleDues = admissibleIds.map((id) => unpaidShare(byTicket.get(id)))
  const owedCents = admissibleDues.reduce((sum, due) => sum + due, 0)
  const handedOnUnpaidTickets = handedOnUnpaid(order, rows)
  const currency = rows[0]?.orderItem?.order?.currency ?? null
  const payment =
    owedCents > 0 || handedOnUnpaidTickets > 0
      ? { dueCents: owedCents, currency: currency ?? 'USD', handedOnUnpaidTickets }
      : null
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
        ticketDues: admissibleDues,
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
      role: authority.role,
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
    payment,
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
 * @throws {Error} 403 without authority, the uniform 404, a 409 carrying a refusal reason, or a 503 when it waited too long behind another change.
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
    // Waited too long behind another change to the night or the order:
    // rolled back whole, nobody let in and nothing recorded.
    const busy = outOfTimeRefusal(error, GROUP_DOOR_BUSY_SENTENCE)

    if (busy !== error) throw busy

    // A writer outside this module that did not take the ticket locks, the
    // group-pass trigger, or the database refusing a ticket whose payment at
    // the door is not recorded (`check_in_payment_due`). Either way the group
    // changed under the confirmation, nothing was admitted or recorded, and
    // looking it up again shows what it is now. Any other refusal SPEC3 names
    // (a payment that could not be recorded) goes to the error mapper.
    const refused = databaseRefusal(error)

    if (refused && refused.code !== 'PAYMENT_DUE') throw error

    const code = databaseErrorCode(error)

    if (
      !refused &&
      code !== 'P2002' &&
      code !== 'P0001' &&
      error?.details?.reason !== 'NOT_ADMISSIBLE'
    ) {
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
        paymentRecorded: Boolean(verdict.result.payment?.byThisRequest),
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

  // The amount sent is not what the named tickets owe together, as the
  // lookup said (SPEC3 §9.5): the steward's mistake, not a change.
  if (verdict.kind === 'payment_mismatch') {
    throw paymentTermsRefusal('PAYMENT_AMOUNT_MISMATCH', {
      values: { amount: doorAmount(verdict.dueCents, verdict.currency) },
    })
  }

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
  // Every wait below is bounded before the first lock is asked for.
  await boundLockWait(tx, DOOR_LOCK_WAIT)

  // The pass's order, its event and the named tickets' own nights are fixed
  // for the life of the rows, so they are read without a lock to find what to
  // lock first.
  const anchor = await tx.groupPass.findUnique({
    where: { id: claims.g },
    select: { orderId: true, order: { select: { eventId: true } } },
  })

  if (!anchor) return { kind: 'hidden', reason: 'NOT_ADMISSIBLE' }

  const ticketIds = [...new Set(body.ticketIds)].sort()
  const named = await tx.ticket.findMany({
    where: { id: { in: ticketIds } },
    select: {
      id: true,
      orderItemId: true,
      orderItem: { select: { ticketType: { select: { eventSessionId: true } } } },
      eventSeat: { select: { eventSessionId: true } },
    },
  })
  const doorNights = anchor.order ? await eventNights(tx, anchor.order.eventId) : []
  const nightIds = [
    ...new Set(
      named.map((ticket) => admissionNightOf(ticket, doorNights, claims.n)).filter(Boolean),
    ),
  ].sort()

  // The nights the admissions will be written on, then the order, as a single
  // admission takes them (SPEC3 §9.3, SPEC3-XI §2.1).
  for (const night of nightIds) {
    await tx.$queryRaw`SELECT "id" FROM "EventSession" WHERE "id" = ${night} FOR KEY SHARE`
  }

  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${anchor.orderId} FOR SHARE`
  await tx.$queryRaw`SELECT "id" FROM "GroupPass" WHERE "id" = ${claims.g} FOR SHARE`

  // The named tickets' order lines, `FOR KEY SHARE` and sorted: the lock each
  // ticket's foreign key takes when an admission updates it twice in one
  // transaction, taken in its place (order, pass, line, ticket — SPEC3-XI
  // §2.1) so a transfer acceptance holding a line `FOR UPDATE` and waiting
  // for its ticket never waits on this door the other way round.
  const lineIds = [...new Set(named.map((ticket) => ticket.orderItemId).filter(Boolean))].sort()

  if (lineIds.length > 0) {
    await tx.$queryRaw`SELECT "id" FROM "OrderItem" WHERE "id" IN (${Prisma.join(lineIds)}) ORDER BY "id" FOR KEY SHARE`
  }

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
  const currency = rows[0]?.orderItem?.order?.currency ?? 'USD'

  // What the lookup said each named ticket owed at the door, and the amount
  // taken for them together: a different amount is the steward's mistake.
  const claimedDues = new Map(claims.ts.map((id, index) => [id, claims.td?.[index] ?? 0]))
  const claimedCents = ticketIds.reduce((sum, id) => sum + (claimedDues.get(id) ?? 0), 0)

  if ((body.paymentCents ?? 0) !== claimedCents) {
    return {
      kind: 'payment_mismatch',
      reason: 'PAYMENT_AMOUNT_MISMATCH',
      dueCents: claimedCents,
      currency,
    }
  }

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

  let payment = null

  if (toAdmit.length > 0) {
    // The named tickets still unpaid must be exactly those the lookup found
    // unpaid, owing what it said: a ticket paid and let in at the single door
    // meanwhile changed the group, and nothing is recorded or admitted.
    const unpaid = toAdmit.filter((ticket) => unpaidShare(ticket) > 0)
    const claimedUnpaid = ticketIds.filter((id) => (claimedDues.get(id) ?? 0) > 0)
    const same =
      claimedUnpaid.length === unpaid.length &&
      unpaid.every((ticket) => claimedDues.get(ticket.id) === unpaidShare(ticket))

    if (!same) return { kind: 'refused', reason: 'GROUP_CHANGED' }

    if (unpaid.length > 0) {
      const recorded = await recordVenuePayment(tx, {
        order: { id: order.id, currency },
        event,
        tickets: unpaid,
        amountCents: claimedCents,
        actorId: actor.id,
        authority: authority.authority,
        role: authority.role,
        eventSessionId: contexts.get(unpaid[0].id)?.night ?? claims.n ?? null,
        via: VENUE_PAYMENT_VIA.DOOR_GROUP,
        gate: body.gate ?? null,
        now,
      })

      payment = { recordedCents: claimedCents, venuePaymentId: recorded.id, byThisRequest: true }
    }
  } else {
    // A retry after a lost answer: everything named is in already. Its
    // payment, if the named tickets owed one, is the one recorded for them.
    const owing = already.filter((ticket) => (ticket.venueDueCents ?? 0) > 0)
    const recordedIds = new Set(owing.map((ticket) => ticket.venuePaymentId ?? null))

    if (owing.length > 0 && recordedIds.size === 1 && !recordedIds.has(null)) {
      payment = {
        recordedCents: owing.reduce((sum, ticket) => sum + ticket.venueDueCents, 0),
        venuePaymentId: [...recordedIds][0],
        byThisRequest: false,
      }
    }
  }

  const paidNow = new Set(
    payment?.byThisRequest ? toAdmit.filter((t) => unpaidShare(t) > 0).map((t) => t.id) : [],
  )

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
      venuePaymentId: paidNow.has(ticket.id) ? payment.venuePaymentId : null,
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
        role: authority.role,
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
      payment,
    },
  }
}
