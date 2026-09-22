/**
 * Admission at the door: look a ticket up, show it, and only then let it in.
 *
 * ## The workflow
 *
 *     credential or printed code → preview → explicit confirmation → one CheckIn
 *
 * A preview writes nothing that changes a ticket. It resolves what was
 * presented, decides whether the caller may see it, and says what a door needs
 * to know. A confirmation presents the same pass again, with the reference the
 * preview returned, and re-derives every fact inside the transaction that
 * writes the admission. Nothing the preview decided is trusted by the
 * confirmation: a successful preview is not an authorisation token.
 *
 * ## Resolve first, authorise second, and tell an outsider nothing
 *
 * The ticket is resolved from the credential's digest or the printed code, and
 * its event and organisation are read from the database. Only then is the
 * caller's authority checked — against *that* event, never against an event id
 * the browser sent. A caller who is not authorised for the ticket's event gets
 * the same 404, byte for byte, as a caller who presented nothing real. Before
 * this work the lookup ran first and the capability check second, so an
 * unknown pass answered 404 and a real one 403 — naming the owning organisation
 * in the message.
 *
 * A caller with no door authority anywhere is refused with a 403 before any
 * lookup happens, which tells them nothing about tickets and saves a query.
 *
 * ## Authority, re-read every time
 *
 * `admissionAuthorityFor` in `@desi-event/permissions` holds the policy: OWNER
 * and ADMIN admit to any event of their organisation; MANAGER, STAFF and
 * SCANNER only to events a `ScannerScope` names; platform roles to none. This
 * module supplies it with the membership and scope read from the database on
 * every preview and inside every confirmation, where the rows are locked
 * `FOR SHARE` until the admission commits — so a scope revoked after a preview
 * refuses the confirmation, and a revocation racing the confirmation waits for
 * it rather than slipping underneath.
 *
 * Locks are taken in one order everywhere: the ticket, then the membership, then
 * the scope. The team routes lock the membership before touching its scopes, so
 * a confirmation and a role change cannot deadlock on each other.
 *
 * ## The method is derived, not declared
 *
 * `QR_SCAN` when the secure credential was presented, `MANUAL_CODE` when the
 * printed reference was. The request schemas are strict, so a client that sends
 * a `method` is refused rather than ignored. The server cannot observe whether
 * a camera or a keyboard produced a credential; what it records is which secret
 * was presented, and the scanner's manual mode sends only the printed code.
 *
 * ## What is never recorded
 *
 * The presented credential, the presented code, and the preview reference. Not
 * in an audit row, not in a log line. `@desi-event/logger` redacts
 * `credential` and `previewReference` by key in case a handler slips.
 *
 * @module @desi-event/api/lib/admission
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import { deriveSealingKey } from '@desi-event/auth'
import {
  CAPABILITIES,
  ORG_ROLE_CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  admissionAuthorityFor,
  requiresAdmissionScope,
} from '@desi-event/permissions'
import { ADMISSION_REFUSAL_REASONS } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { conflict, databaseErrorCode, forbidden, notFound } from './errors.js'
import { credentialDigest } from './ticket-credentials.js'
import {
  ADMISSION_REFUSAL_SENTENCES,
  TICKET_STATES,
  admissionRefusalCode,
  admit,
} from './tickets.js'

/**
 * The HKDF purpose for preview references. Distinct from the pass key, so a
 * value minted for one can never be produced by code minting the other.
 *
 * @type {string}
 */
export const PREVIEW_REFERENCE_PURPOSE = 'admission-preview-v1'

/**
 * How long a preview may be confirmed for.
 *
 * Long enough to check a face against a name; short enough that a preview left
 * open on a screen while the queue moves on cannot be confirmed later.
 *
 * @type {number}
 */
export const PREVIEW_TTL_MS = 120_000

/**
 * The one answer an outsider gets, whatever the reason.
 *
 * @type {string}
 */
const UNIFORM_NOT_FOUND = 'No ticket with that pass.'

/**
 * Everything a door needs from a ticket, and nothing it does not.
 *
 * Deliberately not `include: { order: true }`: the order carries the buyer's
 * email and totals, and a query that never fetches them cannot leak them.
 */
export const ADMISSION_INCLUDE = Object.freeze({
  orderItem: {
    select: {
      ticketType: { select: { name: true } },
      order: {
        select: {
          id: true,
          status: true,
          eventSessionId: true,
          event: {
            select: {
              id: true,
              title: true,
              startsAt: true,
              endsAt: true,
              timezone: true,
              status: true,
              cancelledAt: true,
              organizationId: true,
            },
          },
        },
      },
    },
  },
  eventSeat: {
    select: {
      seat: {
        select: {
          label: true,
          section: { select: { name: true } },
          row: { select: { label: true } },
        },
      },
    },
  },
  checkIn: { select: { scannedAt: true, method: true, scannedByUserId: true } },
})

/**
 * Which secret was presented, and the method that follows from it.
 *
 * @param {{credential?: string, code?: string}} body A parsed request body.
 * @returns {{credential: string|null, code: string|null, method: 'QR_SCAN'|'MANUAL_CODE'}} The presentation.
 */
export function presentationOf(body) {
  if (body.credential) return { credential: body.credential, code: null, method: 'QR_SCAN' }

  return { credential: null, code: body.code, method: 'MANUAL_CODE' }
}

/**
 * Resolve a presentation to a ticket.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {{credential: string|null, code: string|null}} presentation What was presented.
 * @returns {Promise<object|null>} The ticket with `ADMISSION_INCLUDE`, or null.
 */
async function resolve(db, presentation) {
  if (presentation.credential) {
    return db.ticket.findUnique({
      where: { credentialHash: credentialDigest(presentation.credential) },
      include: ADMISSION_INCLUDE,
    })
  }

  return db.ticket.findUnique({ where: { code: presentation.code }, include: ADMISSION_INCLUDE })
}

/**
 * Whether an actor holds door authority in any organisation at all.
 *
 * The cheapest refusal, and one that reveals nothing about any ticket: it is a
 * statement about the caller. A platform role never counts — see the policy.
 *
 * @param {object} actor The request actor.
 * @returns {boolean} True when some membership carries `ticket:check_in`.
 */
export function holdsDoorAuthority(actor) {
  return (actor?.memberships ?? []).some((membership) =>
    (ORG_ROLE_CAPABILITIES[membership.role] ?? []).includes(CAPABILITIES.TICKET_CHECK_IN),
  )
}

/**
 * Refuse, before any lookup, a caller who could not admit anybody.
 *
 * A platform role that would hold the capability everywhere is refused like
 * anybody else — and, because that is a policy decision somebody may one day
 * question, the refusal is written to the audit log against the account.
 *
 * @param {object} db A Prisma client.
 * @param {object} actor The request actor.
 * @param {string} operation `preview` or `check_in`.
 * @returns {Promise<void>} Resolves when the caller may proceed.
 * @throws {Error} A 403 when they may not.
 */
export async function assertDoorAuthority(db, actor, operation) {
  if (holdsDoorAuthority(actor)) return

  const platformWouldGrant = (PLATFORM_ROLE_CAPABILITIES[actor?.role] ?? []).includes(
    CAPABILITIES.TICKET_CHECK_IN,
  )

  if (platformWouldGrant) {
    await recordAudit(db, {
      action: AUDIT_ACTIONS.TICKET_ADMISSION_REFUSED,
      entityType: 'User',
      entityId: actor.id,
      actorId: actor.id,
      metadata: {
        operation,
        reason: 'PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY',
        platformRole: actor.role,
      },
    })
  }

  throw forbidden('Admitting people needs door authority in the organisation running the event.')
}

/**
 * The caller's authority for one event, read from the database.
 *
 * With `lock`, the membership and scope rows are locked `FOR SHARE` before they
 * are read, and stay locked until the transaction ends: a revocation that
 * starts now waits for this admission, and one that committed before now is
 * seen. Locks first, then reads — reading first would leave a window in which a
 * row seen as present was deleted before it was locked.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} options Options.
 * @param {string} options.actorId Who is asking.
 * @param {string} options.organizationId The event's organisation, from the database.
 * @param {string} options.eventId The ticket's event, from the database.
 * @param {boolean} [options.lock] Take `FOR SHARE` locks first. Only inside a transaction.
 * @returns {Promise<{authority: string, role: string}|null>} The authority, or null.
 */
export async function readAdmissionAuthority(
  db,
  { actorId, organizationId, eventId, lock = false },
) {
  if (lock) {
    await db.$queryRaw`
      SELECT m."id" FROM "Membership" m
      WHERE m."userId" = ${actorId} AND m."organizationId" = ${organizationId}
      FOR SHARE`
    await db.$queryRaw`
      SELECT s."id" FROM "ScannerScope" s
      JOIN "Membership" m ON m."id" = s."membershipId"
      WHERE m."userId" = ${actorId} AND m."organizationId" = ${organizationId}
        AND s."eventId" = ${eventId}
      FOR SHARE OF s`
  }

  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId: actorId, organizationId } },
    select: { role: true, scannerScopes: { where: { eventId }, select: { eventId: true } } },
  })

  return admissionAuthorityFor(membership, eventId)
}

/**
 * The event summary a door sees.
 *
 * @param {object} event An event row from `ADMISSION_INCLUDE`.
 * @returns {object} A payload satisfying `admissionEventSchema`.
 */
function toAdmissionEvent(event) {
  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt ?? null,
    timezone: event.timezone,
  }
}

/**
 * The seat, for reserved seating.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @returns {{section: string|null, row: string|null, label: string}|null} The seat, or null.
 */
function toAdmissionSeat(ticket) {
  const seat = ticket.eventSeat?.seat

  if (!seat) return null

  return { section: seat.section?.name ?? null, row: seat.row?.label ?? null, label: seat.label }
}

/**
 * What a door is told about a ticket, named and explicit.
 *
 * Every field is listed rather than spread, so a column added to `Ticket`
 * tomorrow does not reach a scanner by default.
 *
 * @param {object} options Options.
 * @param {object} options.ticket A ticket with `ADMISSION_INCLUDE`.
 * @param {string} options.outcome `ADMISSIBLE`, `ALREADY_CHECKED_IN` or `REFUSED`.
 * @param {string|null} options.refusal A refusal code, or null.
 * @param {string} options.method The method this presentation would record.
 * @param {string|null} options.previewReference The reference, when admissible.
 * @param {Date|null} options.previewExpiresAt When it lapses.
 * @returns {object} A payload satisfying `admissionPreviewResponseSchema`'s `data`.
 */
export function toAdmissionPreview({
  ticket,
  outcome,
  refusal,
  method,
  previewReference,
  previewExpiresAt,
}) {
  return {
    outcome,
    refusal,
    method,
    event: toAdmissionEvent(ticket.orderItem.order.event),
    tier: ticket.orderItem.ticketType ? { name: ticket.orderItem.ticketType.name } : null,
    seat: toAdmissionSeat(ticket),
    attendeeName: ticket.attendeeName ?? null,
    checkedInAt: ticket.checkedInAt ?? null,
    previewReference,
    previewExpiresAt,
  }
}

/**
 * What a confirmation did, named and explicit.
 *
 * @param {object} options Options.
 * @param {object} options.ticket A ticket with `ADMISSION_INCLUDE`, re-read after the write.
 * @param {string} options.outcome `ADMITTED` or `ALREADY_CHECKED_IN`.
 * @param {string} options.actorId Who confirmed.
 * @returns {object} A payload satisfying `checkInResponseSchema`'s `data`.
 */
export function toAdmissionResult({ ticket, outcome, actorId }) {
  return {
    outcome,
    checkedInAt: ticket.checkIn?.scannedAt ?? ticket.checkedInAt,
    method:
      ticket.checkIn?.method === 'QR_SCAN' || ticket.checkIn?.method === 'MANUAL_CODE'
        ? ticket.checkIn.method
        : null,
    checkedInByYou:
      Boolean(ticket.checkIn?.scannedByUserId) && ticket.checkIn.scannedByUserId === actorId,
    event: toAdmissionEvent(ticket.orderItem.order.event),
    tier: ticket.orderItem.ticketType ? { name: ticket.orderItem.ticketType.name } : null,
    seat: toAdmissionSeat(ticket),
    attendeeName: ticket.attendeeName ?? null,
  }
}

/**
 * A 409 carrying a refusal from the closed vocabulary, and nothing else.
 *
 * Refuses to build one from any other string, so the vocabulary a scanner
 * branches on cannot grow by accident in a handler.
 *
 * @param {string} reason One of `ADMISSION_REFUSAL_REASONS`.
 * @returns {Error} The conflict.
 * @throws {TypeError} When the reason is not in the vocabulary.
 */
export function admissionConflict(reason) {
  if (!ADMISSION_REFUSAL_REASONS.includes(reason)) {
    throw new TypeError(`"${reason}" is not an admission refusal reason.`)
  }

  return conflict(ADMISSION_REFUSAL_SENTENCES[reason], { reason })
}

/**
 * Sign a preview reference.
 *
 * `base64url(json).base64url(hmac)`. The body names the ticket, event,
 * organisation, scanner, method and expiry — all things this scanner was just
 * shown or already is — so it is not secret, only unforgeable. It grants
 * nothing: a confirmation still needs the pass itself and re-checks everything.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.ticketId The previewed ticket.
 * @param {string} options.eventId Its event.
 * @param {string} options.organizationId Its organisation.
 * @param {string} options.actorId Who previewed it.
 * @param {string} options.method How it was presented.
 * @param {Date} options.expiresAt When the reference lapses.
 * @returns {string} The reference.
 */
export function signPreviewReference({
  secret,
  ticketId,
  eventId,
  organizationId,
  actorId,
  method,
  expiresAt,
}) {
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      t: ticketId,
      e: eventId,
      o: organizationId,
      a: actorId,
      m: method,
      x: expiresAt.getTime(),
    }),
  ).toString('base64url')

  const mac = createHmac('sha256', deriveSealingKey(secret, PREVIEW_REFERENCE_PURPOSE))
    .update(body)
    .digest('base64url')

  return `${body}.${mac}`
}

/**
 * Read and verify a preview reference.
 *
 * The MAC is compared in constant time before the body is trusted for anything.
 * An expired reference is distinguished from a forged one only after its MAC
 * verifies — a forger learns nothing from the difference.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.reference What the scanner sent back.
 * @param {Date} options.now The instant.
 * @returns {{ok: true, claims: object}|{ok: false, reason: 'PREVIEW_INVALID'|'PREVIEW_EXPIRED'}} The result.
 */
export function readPreviewReference({ secret, reference, now }) {
  const parts = typeof reference === 'string' ? reference.split('.') : []

  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return { ok: false, reason: 'PREVIEW_INVALID' }
  }

  const [body, presented] = parts
  const expected = createHmac('sha256', deriveSealingKey(secret, PREVIEW_REFERENCE_PURPOSE))
    .update(body)
    .digest()

  let presentedBytes

  try {
    presentedBytes = Buffer.from(presented, 'base64url')
  } catch {
    return { ok: false, reason: 'PREVIEW_INVALID' }
  }

  if (presentedBytes.length !== expected.length || !timingSafeEqual(presentedBytes, expected)) {
    return { ok: false, reason: 'PREVIEW_INVALID' }
  }

  let claims

  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'PREVIEW_INVALID' }
  }

  const wellFormed =
    claims?.v === 1 &&
    ['t', 'e', 'o', 'a', 'm'].every(
      (key) => typeof claims[key] === 'string' && claims[key] !== '',
    ) &&
    Number.isFinite(claims.x)

  if (!wellFormed) return { ok: false, reason: 'PREVIEW_INVALID' }

  if (now.getTime() > claims.x) return { ok: false, reason: 'PREVIEW_EXPIRED' }

  return { ok: true, claims }
}

/**
 * Look a ticket up at the door without admitting it.
 *
 * Writes an audit row and nothing else: no `CheckIn`, no status change, no
 * credential rotation.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {object} options.env The API environment, for `AUTH_SECRET`.
 * @param {object} options.actor The request actor.
 * @param {object} options.body The parsed `admissionPreviewRequestSchema` body.
 * @param {object} [options.log] A request logger.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} A payload satisfying `admissionPreviewResponseSchema`'s `data`.
 * @throws {Error} A 403 for a caller with no door authority; the uniform 404 otherwise.
 */
export async function previewAdmission({ prisma, env, actor, body, log, now = new Date() }) {
  await assertDoorAuthority(prisma, actor, 'preview')

  const presentation = presentationOf(body)
  const ticket = await resolve(prisma, presentation)
  const event = ticket?.orderItem?.order?.event ?? null

  if (!ticket || !event) {
    // Which kind of thing was presented, never the thing itself.
    log?.info(
      { actorId: actor.id, presented: presentation.method },
      'admission preview: nothing resolved',
    )
    throw notFound(UNIFORM_NOT_FOUND)
  }

  const authority = await readAdmissionAuthority(prisma, {
    actorId: actor.id,
    organizationId: event.organizationId,
    eventId: event.id,
  })

  if (!authority) {
    // On the ticket's record, where an organiser reviewing it will see that
    // somebody out of scope held its pass. The caller is told nothing.
    await recordAudit(prisma, {
      action: AUDIT_ACTIONS.TICKET_ADMISSION_REFUSED,
      entityType: 'Ticket',
      entityId: ticket.id,
      actorId: actor.id,
      metadata: {
        operation: 'preview',
        reason: 'NOT_AUTHORISED_FOR_EVENT',
        method: presentation.method,
      },
    })

    throw notFound(UNIFORM_NOT_FOUND)
  }

  const order = ticket.orderItem.order
  let outcome = 'ADMISSIBLE'
  let refusal = null

  if (body.expectedEventId && body.expectedEventId !== event.id) {
    outcome = 'REFUSED'
    refusal = 'WRONG_EVENT'
  } else if (ticket.status === TICKET_STATES.CHECKED_IN) {
    outcome = 'ALREADY_CHECKED_IN'
  } else {
    refusal = admissionRefusalCode(ticket, order, event)

    if (refusal) outcome = 'REFUSED'
  }

  const previewExpiresAt =
    outcome === 'ADMISSIBLE' ? new Date(now.getTime() + PREVIEW_TTL_MS) : null
  const previewReference =
    outcome === 'ADMISSIBLE'
      ? signPreviewReference({
          secret: env.AUTH_SECRET,
          ticketId: ticket.id,
          eventId: event.id,
          organizationId: event.organizationId,
          actorId: actor.id,
          method: presentation.method,
          expiresAt: previewExpiresAt,
        })
      : null

  await recordAudit(prisma, {
    action: AUDIT_ACTIONS.TICKET_ADMISSION_PREVIEWED,
    entityType: 'Ticket',
    entityId: ticket.id,
    actorId: actor.id,
    metadata: {
      outcome,
      refusal,
      method: presentation.method,
      authority: authority.authority,
      role: authority.role,
      eventId: event.id,
    },
  })

  return toAdmissionPreview({
    ticket,
    outcome,
    refusal,
    method: presentation.method,
    previewReference,
    previewExpiresAt,
  })
}

/**
 * Admit a previewed ticket, exactly once.
 *
 * The transaction returns a verdict rather than throwing, so that a refusal can
 * be audited *after* it rolls back — an audit row written inside a transaction
 * that then throws would be rolled back with it.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {object} options.env The API environment, for `AUTH_SECRET`.
 * @param {object} options.actor The request actor.
 * @param {object} options.body The parsed `checkInRequestSchema` body.
 * @param {object} [options.log] A request logger.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} A payload satisfying `checkInResponseSchema`'s `data`.
 * @throws {Error} 403 without authority, the uniform 404, or a 409 carrying a refusal reason.
 */
export async function confirmAdmission({ prisma, env, actor, body, log, now = new Date() }) {
  await assertDoorAuthority(prisma, actor, 'check_in')

  const presentation = presentationOf(body)
  const reference = readPreviewReference({
    secret: env.AUTH_SECRET,
    reference: body.previewReference,
    now,
  })

  if (!reference.ok) throw admissionConflict(reference.reason)

  const claims = reference.claims

  // Bound to the scanner that previewed, and to how it was presented. A
  // reference lifted from another scanner's screen is worth nothing here, and a
  // code preview cannot be confirmed as a QR scan.
  if (claims.a !== actor.id) throw admissionConflict('PREVIEW_INVALID')
  if (claims.m !== presentation.method) throw admissionConflict('PREVIEW_MISMATCH')

  let verdict

  try {
    verdict = await prisma.$transaction((tx) =>
      decide(tx, { actor, body, presentation, claims, now }),
    )
  } catch (error) {
    // Two ways the database refuses a racing admission that did not take the
    // row lock first — a writer outside this module, or a test inserting a row
    // directly. P2002 is the unique `CheckIn.ticketId`; P0001 is
    // `desi_check_in_ticket_admissible`. Neither is a 500 at a door: what the
    // answer is depends on what the ticket now is, re-read rather than assumed.
    const code = databaseErrorCode(error)

    if (code !== 'P2002' && code !== 'P0001') throw error

    const current = await prisma.ticket.findUnique({
      where: { id: claims.t },
      include: ADMISSION_INCLUDE,
    })

    verdict =
      current?.status === TICKET_STATES.CHECKED_IN
        ? { kind: 'already', ticket: current }
        : {
            kind: 'refused',
            reason: current
              ? (admissionRefusalCode(
                  current,
                  current.orderItem.order,
                  current.orderItem.order.event,
                ) ?? 'NOT_ADMISSIBLE')
              : 'NOT_ADMISSIBLE',
            ticketId: claims.t,
          }
  }

  if (verdict.kind === 'admitted') {
    log?.info(
      { ticketId: verdict.ticket.id, eventId: claims.e, method: presentation.method },
      'ticket admitted',
    )

    return toAdmissionResult({ ticket: verdict.ticket, outcome: 'ADMITTED', actorId: actor.id })
  }

  if (verdict.kind === 'already') {
    await recordAudit(prisma, {
      action: AUDIT_ACTIONS.TICKET_ADMISSION_REFUSED,
      entityType: 'Ticket',
      entityId: verdict.ticket.id,
      actorId: actor.id,
      metadata: {
        operation: 'check_in',
        outcome: 'ALREADY_CHECKED_IN',
        method: presentation.method,
      },
    })

    return toAdmissionResult({
      ticket: verdict.ticket,
      outcome: 'ALREADY_CHECKED_IN',
      actorId: actor.id,
    })
  }

  await recordAudit(prisma, {
    action: AUDIT_ACTIONS.TICKET_ADMISSION_REFUSED,
    entityType: 'Ticket',
    entityId: verdict.ticketId,
    actorId: actor.id,
    metadata: { operation: 'check_in', reason: verdict.reason, method: presentation.method },
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
 * @param {object} options.presentation From {@link presentationOf}.
 * @param {object} options.claims The verified preview reference.
 * @param {Date} options.now The instant.
 * @returns {Promise<object>} A verdict: admitted, already, refused, forbidden or hidden.
 */
async function decide(tx, { actor, body, presentation, claims, now }) {
  // The previewed ticket's row, first. Every writer that changes whether a
  // ticket admits — refund, revocation, transfer — updates this row, so holding
  // it serialises them against this admission: whichever commits first, the
  // other sees what it did.
  await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${claims.t} FOR UPDATE`

  const ticket = await resolve(tx, presentation)

  if (!ticket || ticket.id !== claims.t) {
    // The pass no longer resolves to what was previewed. Accepting a transfer,
    // a refund and a revocation all clear the digest, so a credential previewed
    // a minute ago can stop resolving. The previewed ticket is read by its id —
    // from the verified reference, never from the request — so the door can be
    // told the truth about what happened to it rather than "not found".
    const previewed = await tx.ticket.findUnique({
      where: { id: claims.t },
      include: ADMISSION_INCLUDE,
    })
    const previewedEvent = previewed?.orderItem?.order?.event

    if (!previewed || !previewedEvent)
      return { kind: 'hidden', ticketId: claims.t, reason: 'NOT_ADMISSIBLE' }

    const stillAuthorised = await readAdmissionAuthority(tx, {
      actorId: actor.id,
      organizationId: previewedEvent.organizationId,
      eventId: previewedEvent.id,
      lock: true,
    })

    if (!stillAuthorised)
      return { kind: 'forbidden', ticketId: previewed.id, reason: 'NOT_AUTHORISED_FOR_EVENT' }

    const reason = ticket
      ? 'PREVIEW_MISMATCH'
      : (admissionRefusalCode(previewed, previewed.orderItem.order, previewedEvent) ??
        'PREVIEW_MISMATCH')

    return { kind: 'refused', ticketId: previewed.id, reason }
  }

  const order = ticket.orderItem.order
  const event = order.event

  // A ticket cannot move between events, and a reference cannot be rebound to
  // another; checked anyway, because the cost is a comparison.
  if (event.id !== claims.e || event.organizationId !== claims.o) {
    return { kind: 'refused', ticketId: ticket.id, reason: 'PREVIEW_MISMATCH' }
  }

  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { suspendedAt: true } })

  const authority =
    user && !user.suspendedAt
      ? await readAdmissionAuthority(tx, {
          actorId: actor.id,
          organizationId: event.organizationId,
          eventId: event.id,
          lock: true,
        })
      : null

  if (!authority)
    return { kind: 'forbidden', ticketId: ticket.id, reason: 'NOT_AUTHORISED_FOR_EVENT' }

  if (body.expectedEventId && body.expectedEventId !== event.id) {
    return { kind: 'refused', ticketId: ticket.id, reason: 'WRONG_EVENT' }
  }

  if (ticket.status === TICKET_STATES.CHECKED_IN) return { kind: 'already', ticket }

  const refusal = admissionRefusalCode(ticket, order, event)

  if (refusal) return { kind: 'refused', ticketId: ticket.id, reason: refusal }

  await admit(tx, {
    ticket,
    eventSessionId: order.eventSessionId ?? null,
    scannedByUserId: actor.id,
    scannerId: body.deviceId ?? null,
    gate: body.gate ?? null,
    method: presentation.method,
    authority: authority.authority,
    now,
  })

  const admitted = await tx.ticket.findUnique({
    where: { id: ticket.id },
    include: ADMISSION_INCLUDE,
  })

  return { kind: 'admitted', ticket: admitted }
}

/**
 * The statuses under which an event appears on a door screen.
 *
 * Events that could have somebody at the door tonight. A draft has sold
 * nothing; a cancelled event admits nobody; an archived one is over.
 *
 * @type {ReadonlyArray<string>}
 */
export const DOOR_EVENT_STATUSES = Object.freeze([
  'PUBLISHED',
  'ON_SALE',
  'SALES_PAUSED',
  'SOLD_OUT',
  'POSTPONED',
])

/**
 * How long after an event ends it still appears on a door screen.
 *
 * @type {number}
 */
const DOOR_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * The events this caller may admit to, and on what authority.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {object} options.actor The request actor.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<Array<object>>} Entries satisfying `admissionEventsResponseSchema`'s items.
 */
export async function listAdmissionEvents({ prisma, actor, now = new Date() }) {
  const since = new Date(now.getTime() - DOOR_GRACE_MS)

  const memberships = await prisma.membership.findMany({
    where: { userId: actor.id },
    select: {
      role: true,
      organization: { select: { id: true, name: true } },
      scannerScopes: { select: { eventId: true } },
    },
  })

  const entries = []

  for (const membership of memberships) {
    const doorRole = (ORG_ROLE_CAPABILITIES[membership.role] ?? []).includes(
      CAPABILITIES.TICKET_CHECK_IN,
    )

    if (!doorRole) continue

    // Candidates: the scoped events for a scoped role, otherwise the whole
    // organisation. Either way each is passed through the same policy function
    // the door uses, so this list and the door cannot disagree. Asking for the
    // scoped ids directly matters: an organisation with more current events
    // than the cap below would otherwise hide a scoped one past the cut.
    const scopedIds = requiresAdmissionScope(membership.role)
      ? membership.scannerScopes.map((scope) => scope.eventId)
      : null

    if (scopedIds && scopedIds.length === 0) continue

    const events = await prisma.event.findMany({
      where: {
        organizationId: membership.organization.id,
        ...(scopedIds ? { id: { in: scopedIds } } : {}),
        status: { in: [...DOOR_EVENT_STATUSES] },
        cancelledAt: null,
        endsAt: { gte: since },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        status: true,
      },
    })

    for (const event of events) {
      const authority = admissionAuthorityFor(membership, event.id)

      if (!authority) continue

      entries.push({
        event: { ...toAdmissionEvent(event), status: event.status },
        organization: membership.organization,
        authority: authority.authority,
        role: authority.role,
      })
    }
  }

  return entries
}
