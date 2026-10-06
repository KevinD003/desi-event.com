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
 * SCANNER only to events a `ScannerScope` names. This module supplies it with
 * the membership and scope read from the database on every preview and inside
 * every confirmation, where the rows are locked `FOR SHARE` until the admission
 * commits — so a scope revoked after a preview refuses the confirmation, and a
 * revocation racing the confirmation waits for it rather than slipping
 * underneath.
 *
 * A platform super administrator admits at any event on a third authority,
 * `PLATFORM_ROLE` (ADR 0007), and only when no membership gives it one: a
 * super administrator who is also an event's organiser is recorded as that.
 * The platform role is read from the `User` row — per request for a preview,
 * and again inside the confirming transaction together with `suspendedAt` — so
 * a demotion between preview and confirmation refuses the confirmation. Every
 * platform lookup and admission also writes `ticket.admission_platform_authority`
 * on the Event, so the organisation's own record shows it. SUPPORT, MODERATOR,
 * FINANCE_ADMIN and ADMIN (the platform administrator, who reviews events and
 * invites organisers) admit nobody, and a refused attempt is audited.
 *
 * Locks are taken in one order everywhere: the ticket, then the membership, then
 * the scope. The team routes lock the membership before touching its scopes, so
 * a confirmation and a role change cannot deadlock on each other. A group
 * admission (`./group-admission.js`) takes the order, the group pass and its
 * tickets (sorted by id) first, then the same membership and scope.
 *
 * ## The method is derived, not declared
 *
 * `QR_SCAN` when the secure credential was presented, `MANUAL_CODE` when the
 * printed reference was. The request schemas are strict, so a client that sends
 * a `method` is refused rather than ignored. The server cannot observe whether
 * a camera or a keyboard produced a credential; what it records is which secret
 * was presented, and the scanner's manual mode sends only the printed code.
 *
 * ## Nights
 *
 * On an event of more than one night the door says which night it is admitting
 * to (`eventSessionId`), as it says which event, and every lookup and
 * confirmation must. A ticket for one night — its seat's, else its tier's — is
 * refused on another (`WRONG_NIGHT`) and admits once, becoming CHECKED_IN. A
 * ticket good for every night (its tier names none) admits once on each night:
 * the admission row carries the night, the ticket stays VALID, and "already in"
 * means already in tonight. Without a night the lookup is refused
 * (`NIGHT_REQUIRED`) rather than guessed from the clock. The night is part of
 * the preview reference, so a confirmation cannot switch it. The trigger
 * `desi_check_in_ticket_admissible` holds the same rules for any writer.
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
  REFUSED_PLATFORM_ADMISSION_ROLES,
  admissionAuthorityFor,
  platformAdmissionAuthorityFor,
  requiresAdmissionScope,
} from '@desi-event/permissions'
import { ADMISSION_REFUSAL_REASONS, withoutAddresses } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { conflict, databaseErrorCode, forbidden, notFound } from './errors.js'
import { likeLiteral } from './like-pattern.js'
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
 * The HKDF purpose for group preview references. Distinct from the single
 * one, so a reference minted for a ticket can never be read as one for a
 * group, or the other way round.
 *
 * @type {string}
 */
export const GROUP_PREVIEW_REFERENCE_PURPOSE = 'admission-group-preview-v1'

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
 * The one answer an outsider gets, whatever the reason — for a ticket's pass
 * and for a group's alike.
 *
 * @type {string}
 */
export const UNIFORM_NOT_FOUND = 'No ticket with that pass.'

/** The night a ticket is for, as a door shows it: a label and its times. */
const ADMISSION_SESSION_SELECT = Object.freeze({
  label: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
})

/** A night as a door lists it, to choose which one it is admitting to. */
const DOOR_NIGHT_SELECT = Object.freeze({
  id: true,
  label: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  status: true,
  sortOrder: true,
})

/**
 * Everything a door needs from a ticket, and nothing it does not.
 *
 * Deliberately not `include: { order: true }`: the order carries the buyer's
 * email and totals, and a query that never fetches them cannot leak them.
 */
export const ADMISSION_INCLUDE = Object.freeze({
  orderItem: {
    select: {
      ticketType: {
        select: {
          name: true,
          eventSessionId: true,
          eventSession: { select: ADMISSION_SESSION_SELECT },
        },
      },
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
      eventSessionId: true,
      seat: {
        select: {
          label: true,
          section: { select: { name: true } },
          row: { select: { label: true } },
        },
      },
      eventSession: { select: ADMISSION_SESSION_SELECT },
    },
  },
  // Every admission of the ticket: one for a ticket that admits once, one per
  // night for a ticket good for every night. Few, so read whole and chosen
  // from in code (`admissionOn`).
  checkIns: {
    select: { scannedAt: true, method: true, scannedByUserId: true, eventSessionId: true },
    orderBy: [{ scannedAt: 'asc' }, { id: 'asc' }],
  },
})

/**
 * An event's nights, soonest first, as a door reads them.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} eventId The event.
 * @returns {Promise<Array<object>>} Its sessions.
 */
export async function eventNights(db, eventId) {
  const nights = await db.eventSession.findMany({
    where: { eventId },
    select: DOOR_NIGHT_SELECT,
    orderBy: [{ startsAt: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  })

  return sortNights(nights)
}

/**
 * Nights in the order a door lists them: by start, then the organiser's order.
 *
 * @param {Array<object>} nights Sessions.
 * @returns {Array<object>} A sorted copy.
 */
function sortNights(nights) {
  return [...(nights ?? [])].sort(
    (left, right) =>
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime() ||
      (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
      String(left.id).localeCompare(String(right.id)),
  )
}

/**
 * The night a ticket is for: its seat's, else its tier's.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @returns {string|null} The session id, or null for a tier that names no night.
 */
export function ownNight(ticket) {
  return ticket.eventSeat?.eventSessionId ?? ticket.orderItem?.ticketType?.eventSessionId ?? null
}

/**
 * Which night an admission is on, and whether this ticket may be let in on it.
 *
 * - On an event of more than one night the door must name the night:
 *   `NIGHT_REQUIRED` otherwise, rather than a night guessed from the clock.
 * - A named night that is not one of the event's is `WRONG_NIGHT`.
 * - A ticket for one night is `WRONG_NIGHT` on any other, and admits once.
 * - A ticket whose tier names no night, on an event of more than one, is good
 *   for every night (`everyNight`) and admits once on each: the admission is
 *   recorded on the named night.
 * - A cancelled night admits nobody: `SESSION_CANCELLED`.
 * - Once every night but one is cancelled, an unnamed admission is to that
 *   one: the door lists only the nights it may admit to, and names none when
 *   only one is left.
 *
 * Pure, so the preview and the confirmation cannot disagree about it.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @param {Array<{id: string}>} nights The event's nights, from {@link eventNights}.
 * @param {string|null} named The night the door says it is admitting to.
 * @returns {{night: string|null, everyNight: boolean, refusal: string|null}} The night to record, and the refusal if any.
 */
export function nightFor(ticket, nights, named) {
  const own = ownNight(ticket)
  const everyNight = own === null && nights.length > 1
  const cancelled = (id) =>
    nights.some((candidate) => candidate.id === id && candidate.status === 'CANCELLED')

  if (named && !nights.some((night) => night.id === named)) {
    return { night: null, everyNight, refusal: 'WRONG_NIGHT' }
  }

  // A cancelled night admits nobody, whatever the ticket (SPEC2-XI X-S): the
  // night the door named, or the night the ticket is for.
  if ((named && cancelled(named)) || (own && cancelled(own))) {
    return { night: null, everyNight, refusal: 'SESSION_CANCELLED' }
  }

  // The door lists only the nights not cancelled (`toDoorNights`), and names
  // none when one is left. That one is then the night, so the door is not
  // asked for a night it was never offered a choice of.
  const open = nights.filter((night) => night.status !== 'CANCELLED')
  const door = named ?? (nights.length > 1 && open.length === 1 ? open[0].id : null)

  if (!door && nights.length > 1) return { night: null, everyNight, refusal: 'NIGHT_REQUIRED' }

  if (own && door && own !== door) return { night: null, everyNight, refusal: 'WRONG_NIGHT' }

  return { night: everyNight ? door : own, everyNight, refusal: null }
}

/**
 * The admission row that answers "is this ticket already in?".
 *
 * Tonight's, for a ticket good for every night; its only one, for a ticket
 * that admits once.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @param {{night: string|null, everyNight: boolean}|null} context From {@link nightFor}.
 * @returns {object|null} The `CheckIn` row, or null.
 */
export function admissionOn(ticket, context) {
  const rows = [...(ticket.checkIns ?? [])].sort(
    (left, right) => new Date(left.scannedAt).getTime() - new Date(right.scannedAt).getTime(),
  )

  if (context?.everyNight) return rows.find((row) => row.eventSessionId === context.night) ?? null

  return rows[0] ?? null
}

/**
 * Whether this ticket has already been let in, on the night in question.
 *
 * A CHECKED_IN ticket has, whichever night it is: it admitted once. A ticket
 * good for every night has when tonight's admission exists.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @param {{night: string|null, everyNight: boolean}|null} context From {@link nightFor}.
 * @returns {boolean} True when already in.
 */
export function alreadyIn(ticket, context) {
  if (ticket.status === TICKET_STATES.CHECKED_IN) return true

  return Boolean(context?.everyNight && admissionOn(ticket, context))
}

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
 * Whether an actor holds door authority anywhere at all.
 *
 * The cheapest refusal, and one that reveals nothing about any ticket: it is a
 * statement about the caller. A platform super administrator holds it
 * everywhere; every other platform role holds it only through a membership.
 *
 * @param {object} actor The request actor.
 * @returns {boolean} True for a super administrator, or when some membership carries `ticket:check_in`.
 */
export function holdsDoorAuthority(actor) {
  if (platformAdmissionAuthorityFor(actor?.role)) return true

  return (actor?.memberships ?? []).some((membership) =>
    (ORG_ROLE_CAPABILITIES[membership.role] ?? []).includes(CAPABILITIES.TICKET_CHECK_IN),
  )
}

/**
 * Refuse, before any lookup, a caller who could not admit anybody.
 *
 * A platform role that holds capabilities but not door authority — SUPPORT,
 * MODERATOR, FINANCE_ADMIN, ADMIN — is refused like anybody else, and, because
 * somebody with platform powers trying the door is worth knowing about, the
 * refusal is written to the audit log against the account.
 *
 * @param {object} db A Prisma client.
 * @param {object} actor The request actor.
 * @param {string} operation `preview` or `check_in`.
 * @returns {Promise<void>} Resolves when the caller may proceed.
 * @throws {Error} A 403 when they may not.
 */
export async function assertDoorAuthority(db, actor, operation) {
  if (holdsDoorAuthority(actor)) return

  if (REFUSED_PLATFORM_ADMISSION_ROLES.includes(actor?.role)) {
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
 * Membership first; the platform authority only when the membership gives
 * none. The platform role is the caller's, read from the `User` row by the
 * caller of this function — never from anything the browser sent.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} options Options.
 * @param {string} options.actorId Who is asking.
 * @param {string|null} [options.platformRole] Their platform role, from the database.
 * @param {string} options.organizationId The event's organisation, from the database.
 * @param {string} options.eventId The ticket's event, from the database.
 * @param {boolean} [options.lock] Take `FOR SHARE` locks first. Only inside a transaction.
 * @returns {Promise<{authority: string, role: string}|null>} The authority, or null.
 */
export async function readAdmissionAuthority(
  db,
  { actorId, platformRole = null, organizationId, eventId, lock = false },
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

  return admissionAuthorityFor(membership, eventId) ?? platformAdmissionAuthorityFor(platformRole)
}

/**
 * Record, on the event, that a platform super administrator used its own
 * authority at this door.
 *
 * On the Event rather than the ticket, so an organisation reading its event's
 * record sees every platform lookup and admission in one place. Ids, the
 * operation and the outcome — never what was presented.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} options Options.
 * @param {string} options.actorId The super administrator.
 * @param {string} options.eventId The event.
 * @param {string} options.organizationId Its organisation.
 * @param {'preview'|'check_in'|'group_preview'|'group_check_in'} options.operation What they did.
 * @param {{ticketId?: string, groupPassId?: string, ticketIds?: string[]}} options.subject What they did it to.
 * @param {string} options.outcome What came of it.
 * @returns {Promise<void>} Resolves once recorded.
 */
export async function recordPlatformAuthorityUse(
  db,
  { actorId, eventId, organizationId, operation, subject, outcome },
) {
  await recordAudit(db, {
    action: AUDIT_ACTIONS.TICKET_ADMISSION_PLATFORM_AUTHORITY,
    entityType: 'Event',
    entityId: eventId,
    actorId,
    metadata: { operation, ...subject, organizationId, outcome, authority: 'PLATFORM_ROLE' },
  })
}

/**
 * The event summary a door sees.
 *
 * @param {object} event An event row from `ADMISSION_INCLUDE`.
 * @returns {object} A payload satisfying `admissionEventSchema`.
 */
export function toAdmissionEvent(event) {
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
export function toAdmissionSeat(ticket) {
  const seat = ticket.eventSeat?.seat

  if (!seat) return null

  return { section: seat.section?.name ?? null, row: seat.row?.label ?? null, label: seat.label }
}

/**
 * The night a ticket is for, so a steward sees which night it is.
 *
 * The seat's session, else the tier's; null for a ticket good for every night
 * (or on an event of one night whose tier names none). What the door does with
 * it is {@link nightFor}'s.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @returns {{label: string|null, startsAt: Date, endsAt: Date, timezone: string}|null} The night.
 */
export function toAdmissionSession(ticket) {
  const session =
    ticket.eventSeat?.eventSession ?? ticket.orderItem?.ticketType?.eventSession ?? null

  if (!session) return null

  const label = typeof session.label === 'string' ? session.label.trim() : ''

  return {
    label: label.length > 0 ? label : null,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    timezone: session.timezone,
  }
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
 * @param {{night: string|null, everyNight: boolean}|null} [options.context] The night, from {@link nightFor}.
 * @returns {object} A payload satisfying `admissionPreviewResponseSchema`'s `data`.
 */
export function toAdmissionPreview({
  ticket,
  outcome,
  refusal,
  method,
  previewReference,
  previewExpiresAt,
  context = null,
}) {
  // When it was let in on the night in question: tonight's admission for a
  // ticket good for every night, never last night's.
  const admission = admissionOn(ticket, context)

  return {
    outcome,
    refusal,
    method,
    event: toAdmissionEvent(ticket.orderItem.order.event),
    tier: ticket.orderItem.ticketType ? { name: ticket.orderItem.ticketType.name } : null,
    seat: toAdmissionSeat(ticket),
    session: toAdmissionSession(ticket),
    attendeeName: doorName(ticket.attendeeName),
    checkedInAt: context?.everyNight
      ? (admission?.scannedAt ?? null)
      : (admission?.scannedAt ?? ticket.checkedInAt ?? null),
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
 * @param {{night: string|null, everyNight: boolean}|null} [options.context] The night, from {@link nightFor}.
 * @returns {object} A payload satisfying `checkInResponseSchema`'s `data`.
 */
export function toAdmissionResult({ ticket, outcome, actorId, context = null }) {
  // The admission this answer is about: tonight's, for a ticket good for
  // every night.
  const admission = admissionOn(ticket, context)

  return {
    outcome,
    checkedInAt: admission?.scannedAt ?? (context?.everyNight ? null : ticket.checkedInAt),
    method:
      admission?.method === 'QR_SCAN' || admission?.method === 'MANUAL_CODE'
        ? admission.method
        : null,
    checkedInByYou: Boolean(admission?.scannedByUserId) && admission.scannedByUserId === actorId,
    event: toAdmissionEvent(ticket.orderItem.order.event),
    tier: ticket.orderItem.ticketType ? { name: ticket.orderItem.ticketType.name } : null,
    seat: toAdmissionSeat(ticket),
    session: toAdmissionSession(ticket),
    attendeeName: doorName(ticket.attendeeName),
  }
}

/**
 * The name on a ticket, as the door sees it.
 *
 * Free text, copied from what the buyer typed as their name or from the
 * recipient's display name, so it can be an address. A steward matches a face
 * to a name and has no use for an address, so any address in it is replaced
 * with `Hidden email` before it reaches the door.
 *
 * @param {string|null|undefined} name The stored name.
 * @returns {string|null} The name to show.
 */
export function doorName(name) {
  return withoutAddresses(name ?? null)
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
 * Sign a reference: `base64url(json).base64url(hmac)` under one HKDF purpose.
 *
 * The body names only what the scanner was just shown or already is, so it is
 * not secret, only unforgeable. It grants nothing: a confirmation still needs
 * the pass itself and re-checks everything.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.purpose The HKDF purpose, which separates kinds of reference.
 * @param {object} options.claims What the reference says.
 * @returns {string} The reference.
 */
export function signReference({ secret, purpose, claims }) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const mac = createHmac('sha256', deriveSealingKey(secret, purpose))
    .update(body)
    .digest('base64url')

  return `${body}.${mac}`
}

/**
 * Read and verify a reference signed by {@link signReference}.
 *
 * The MAC is compared in constant time before the body is trusted for anything.
 * An expired reference is distinguished from a forged one only after its MAC
 * verifies — a forger learns nothing from the difference. A reference signed
 * under another purpose fails its MAC here, which is what keeps a single
 * ticket's reference from confirming a group and the other way round.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.purpose The HKDF purpose it must have been signed under.
 * @param {string} options.reference What the scanner sent back.
 * @param {Date} options.now The instant.
 * @param {function(object): boolean} options.validate Whether the verified claims are well formed.
 * @returns {{ok: true, claims: object}|{ok: false, reason: 'PREVIEW_INVALID'|'PREVIEW_EXPIRED'}} The result.
 */
export function readReference({ secret, purpose, reference, now, validate }) {
  const parts = typeof reference === 'string' ? reference.split('.') : []

  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return { ok: false, reason: 'PREVIEW_INVALID' }
  }

  const [body, presented] = parts
  const expected = createHmac('sha256', deriveSealingKey(secret, purpose)).update(body).digest()

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

  if (!claims || typeof claims !== 'object' || !validate(claims) || !Number.isFinite(claims.x)) {
    return { ok: false, reason: 'PREVIEW_INVALID' }
  }

  if (now.getTime() > claims.x) return { ok: false, reason: 'PREVIEW_EXPIRED' }

  return { ok: true, claims }
}

/**
 * Whether a reference's night claim is well formed: a session id, or null.
 *
 * @param {unknown} night The claim.
 * @returns {boolean} True when it is.
 */
function nightClaim(night) {
  return night === null || (typeof night === 'string' && night !== '')
}

/**
 * Whether each named claim is a non-empty string.
 *
 * @param {object} claims The claims.
 * @param {string[]} keys The keys.
 * @returns {boolean} True when all are.
 */
function stringClaims(claims, keys) {
  return keys.every((key) => typeof claims[key] === 'string' && claims[key] !== '')
}

/**
 * Sign a preview reference for one ticket.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.ticketId The previewed ticket.
 * @param {string} options.eventId Its event.
 * @param {string} options.organizationId Its organisation.
 * @param {string} options.actorId Who previewed it.
 * @param {string} options.method How it was presented.
 * @param {string|null} [options.night] The night the door said it was admitting to.
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
  night = null,
  expiresAt,
}) {
  return signReference({
    secret,
    purpose: PREVIEW_REFERENCE_PURPOSE,
    claims: {
      v: 1,
      t: ticketId,
      e: eventId,
      o: organizationId,
      a: actorId,
      m: method,
      n: night,
      x: expiresAt.getTime(),
    },
  })
}

/**
 * Read and verify a single ticket's preview reference.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.reference What the scanner sent back.
 * @param {Date} options.now The instant.
 * @returns {{ok: true, claims: object}|{ok: false, reason: 'PREVIEW_INVALID'|'PREVIEW_EXPIRED'}} The result.
 */
export function readPreviewReference({ secret, reference, now }) {
  return readReference({
    secret,
    purpose: PREVIEW_REFERENCE_PURPOSE,
    reference,
    now,
    validate: (claims) =>
      claims.v === 1 && stringClaims(claims, ['t', 'e', 'o', 'a', 'm']) && nightClaim(claims.n),
  })
}

/**
 * Sign a preview reference for a group.
 *
 * It names the group pass and the version it was looked up at — so a pass
 * replaced since cannot be confirmed — and the tickets that were admissible,
 * which bounds what a confirmation may admit.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.groupPassId The group pass.
 * @param {number} options.groupPassVersion Its credential version when looked up.
 * @param {string} options.eventId The order's event.
 * @param {string} options.organizationId Its organisation.
 * @param {string} options.actorId Who looked it up.
 * @param {string} options.method How it was presented.
 * @param {string[]} options.ticketIds The tickets that were admissible.
 * @param {string|null} [options.night] The night the door said it was admitting to.
 * @param {Date} options.expiresAt When the reference lapses.
 * @returns {string} The reference.
 */
export function signGroupPreviewReference({
  secret,
  groupPassId,
  groupPassVersion,
  eventId,
  organizationId,
  actorId,
  method,
  ticketIds,
  night = null,
  expiresAt,
}) {
  return signReference({
    secret,
    purpose: GROUP_PREVIEW_REFERENCE_PURPOSE,
    claims: {
      v: 1,
      g: groupPassId,
      gv: groupPassVersion,
      e: eventId,
      o: organizationId,
      a: actorId,
      m: method,
      ts: ticketIds,
      n: night,
      x: expiresAt.getTime(),
    },
  })
}

/**
 * Read and verify a group's preview reference.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.reference What the scanner sent back.
 * @param {Date} options.now The instant.
 * @returns {{ok: true, claims: object}|{ok: false, reason: 'PREVIEW_INVALID'|'PREVIEW_EXPIRED'}} The result.
 */
export function readGroupPreviewReference({ secret, reference, now }) {
  return readReference({
    secret,
    purpose: GROUP_PREVIEW_REFERENCE_PURPOSE,
    reference,
    now,
    validate: (claims) =>
      claims.v === 1 &&
      stringClaims(claims, ['g', 'e', 'o', 'a', 'm']) &&
      Number.isInteger(claims.gv) &&
      claims.gv >= 1 &&
      Array.isArray(claims.ts) &&
      claims.ts.length >= 1 &&
      claims.ts.length <= 50 &&
      claims.ts.every((id) => typeof id === 'string' && id !== '') &&
      nightClaim(claims.n),
  })
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
    platformRole: actor.role ?? null,
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
  const named = body.eventSessionId ?? null
  const context = nightFor(ticket, await eventNights(prisma, event.id), named)
  let outcome = 'ADMISSIBLE'
  let refusal = null

  if (body.expectedEventId && body.expectedEventId !== event.id) {
    outcome = 'REFUSED'
    refusal = 'WRONG_EVENT'
  } else if (context.refusal) {
    outcome = 'REFUSED'
    refusal = context.refusal
  } else if (alreadyIn(ticket, context)) {
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
          night: named,
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
      organizationId: event.organizationId,
      eventSessionId: named,
    },
  })

  if (authority.authority === 'PLATFORM_ROLE') {
    await recordPlatformAuthorityUse(prisma, {
      actorId: actor.id,
      eventId: event.id,
      organizationId: event.organizationId,
      operation: 'preview',
      subject: { ticketId: ticket.id },
      outcome,
    })
  }

  return toAdmissionPreview({
    ticket,
    outcome,
    refusal,
    method: presentation.method,
    previewReference,
    previewExpiresAt,
    context,
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
  // And to the night the door said it was admitting to: switching nights
  // between the lookup and the admission is a different question.
  if ((body.eventSessionId ?? null) !== claims.n) throw admissionConflict('PREVIEW_MISMATCH')

  let verdict

  try {
    verdict = await prisma.$transaction((tx) =>
      decide(tx, { actor, body, presentation, claims, now }),
    )
  } catch (error) {
    // Two ways the database refuses a racing admission that did not take the
    // row lock first — a writer outside this module, or a test inserting a row
    // directly. P2002 is the unique `CheckIn(ticketId, eventSessionId)`; P0001
    // is `desi_check_in_ticket_admissible`. Neither is a 500 at a door: what
    // the answer is depends on what the ticket now is, re-read rather than
    // assumed.
    const code = databaseErrorCode(error)

    if (code !== 'P2002' && code !== 'P0001') throw error

    const current = await prisma.ticket.findUnique({
      where: { id: claims.t },
      include: ADMISSION_INCLUDE,
    })
    const currentEvent = current?.orderItem?.order?.event ?? null
    const context = currentEvent
      ? nightFor(current, await eventNights(prisma, currentEvent.id), claims.n)
      : null

    verdict =
      current && !context?.refusal && alreadyIn(current, context)
        ? { kind: 'already', ticket: current, context }
        : {
            kind: 'refused',
            reason: current
              ? (context?.refusal ??
                admissionRefusalCode(current, current.orderItem.order, currentEvent) ??
                'NOT_ADMISSIBLE')
              : 'NOT_ADMISSIBLE',
            ticketId: claims.t,
          }
  }

  if (verdict.kind === 'admitted') {
    log?.info(
      {
        ticketId: verdict.ticket.id,
        eventId: claims.e,
        eventSessionId: verdict.context.night,
        method: presentation.method,
      },
      'ticket admitted',
    )

    return toAdmissionResult({
      ticket: verdict.ticket,
      outcome: 'ADMITTED',
      actorId: actor.id,
      context: verdict.context,
    })
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
        eventSessionId: verdict.context?.night ?? null,
      },
    })

    return toAdmissionResult({
      ticket: verdict.ticket,
      outcome: 'ALREADY_CHECKED_IN',
      actorId: actor.id,
      context: verdict.context,
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
  const named = claims.n

  // The previewed ticket's row, first. Every writer that changes whether a
  // ticket admits — refund, revocation, transfer — updates this row, so holding
  // it serialises them against this admission: whichever commits first, the
  // other sees what it did.
  await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${claims.t} FOR UPDATE`

  // The caller's platform role and suspension, read now rather than trusted
  // from the request: a super administrator demoted, or anybody suspended,
  // since the preview is refused here. Not locked — nothing changes a platform
  // role inside a transaction that also touches tickets, and a FOR SHARE here
  // would wait on privacy redaction's own update of the row.
  const user = await tx.user.findUnique({
    where: { id: actor.id },
    select: { role: true, suspendedAt: true },
  })
  const platformRole = user && !user.suspendedAt ? user.role : null

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
      platformRole,
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

  if (!authority)
    return { kind: 'forbidden', ticketId: ticket.id, reason: 'NOT_AUTHORISED_FOR_EVENT' }

  if (body.expectedEventId && body.expectedEventId !== event.id) {
    return { kind: 'refused', ticketId: ticket.id, reason: 'WRONG_EVENT' }
  }

  // The nights read now, inside the transaction: the rule is the one in force
  // as this admission is written, not the one the preview saw.
  const context = nightFor(ticket, await eventNights(tx, event.id), named)

  if (context.refusal) return { kind: 'refused', ticketId: ticket.id, reason: context.refusal }

  if (alreadyIn(ticket, context)) return { kind: 'already', ticket, context }

  const refusal = admissionRefusalCode(ticket, order, event)

  if (refusal) return { kind: 'refused', ticketId: ticket.id, reason: refusal }

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
    now,
  })

  // In the admitting transaction, so the event's record and the admission
  // commit or roll back together.
  if (authority.authority === 'PLATFORM_ROLE') {
    await recordPlatformAuthorityUse(tx, {
      actorId: actor.id,
      eventId: event.id,
      organizationId: event.organizationId,
      operation: 'check_in',
      subject: { ticketId: ticket.id },
      outcome: 'ADMITTED',
    })
  }

  const admitted = await tx.ticket.findUnique({
    where: { id: ticket.id },
    include: ADMISSION_INCLUDE,
  })

  return { kind: 'admitted', ticket: admitted, context }
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
 * The most events a platform door list names at once.
 *
 * @type {number}
 */
export const PLATFORM_DOOR_LIST_LIMIT = 100

/**
 * The most organisations the platform door filter offers.
 *
 * @type {number}
 */
const PLATFORM_DOOR_ORGANIZATION_LIMIT = 500

/**
 * The events a door list may show, before any authority is considered.
 *
 * @param {Date} since The earliest `endsAt` still shown.
 * @param {{organizationId?: string, q?: string}} filters The caller's filter.
 * @returns {object} A Prisma `where` for `Event`.
 */
function doorEventWhere(since, filters) {
  return {
    status: { in: [...DOOR_EVENT_STATUSES] },
    cancelledAt: null,
    endsAt: { gte: since },
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    ...(filters.q
      ? {
          OR: [
            // As typed: an `_` or a `%` in the search is a character, not a wildcard.
            { title: { contains: likeLiteral(filters.q), mode: 'insensitive' } },
            { organization: { name: { contains: likeLiteral(filters.q), mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
}

/** The columns a door list reads from an event, with its nights. */
const DOOR_EVENT_SELECT = Object.freeze({
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  status: true,
  sessions: {
    select: DOOR_NIGHT_SELECT,
    orderBy: [{ startsAt: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  },
})

/**
 * An event's nights, as a door picks among them.
 *
 * @param {Array<object>|undefined} sessions The event's sessions.
 * @returns {Array<object>} Each night, soonest first.
 */
function toDoorNights(sessions) {
  // A cancelled night is not one a door admits to, so it is not offered.
  return sortNights((sessions ?? []).filter((night) => night.status !== 'CANCELLED')).map(
    (night) => ({
      id: night.id,
      label:
        typeof night.label === 'string' && night.label.trim() !== '' ? night.label.trim() : null,
      startsAt: night.startsAt,
      endsAt: night.endsAt,
      timezone: night.timezone,
      status: night.status,
    }),
  )
}

/**
 * The events this caller may admit to, and on what authority.
 *
 * Two kinds of list. A member's is built from their memberships, each passed
 * through the same policy function the door uses, so this list and the door
 * cannot disagree. A platform super administrator's is every organisation's
 * door-eligible events, soonest first and cut at
 * {@link PLATFORM_DOOR_LIST_LIMIT}; an event its memberships cover is labelled
 * with the membership's authority, every other with `PLATFORM_ROLE`.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {object} options.actor The request actor.
 * @param {{organizationId?: string, q?: string}} [options.filters] Narrow by organisation and by title or organisation name.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<{entries: Array<object>, meta: {scope: string, organizations: Array<{id: string, name: string}>, truncated: boolean}}>} The list.
 */
export async function listAdmissionEvents({ prisma, actor, filters = {}, now = new Date() }) {
  const since = new Date(now.getTime() - DOOR_GRACE_MS)

  const memberships = await prisma.membership.findMany({
    where: { userId: actor.id },
    select: {
      role: true,
      organization: { select: { id: true, name: true } },
      scannerScopes: { select: { eventId: true } },
    },
  })

  if (platformAdmissionAuthorityFor(actor.role)) {
    return platformDoorList({ prisma, memberships, filters, since })
  }

  const entries = []
  let truncated = false

  for (const membership of memberships) {
    const doorRole = (ORG_ROLE_CAPABILITIES[membership.role] ?? []).includes(
      CAPABILITIES.TICKET_CHECK_IN,
    )

    if (!doorRole) continue

    if (filters.organizationId && filters.organizationId !== membership.organization.id) continue

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
        ...doorEventWhere(since, filters),
        organizationId: membership.organization.id,
        ...(scopedIds ? { id: { in: scopedIds } } : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: PLATFORM_DOOR_LIST_LIMIT + 1,
      select: DOOR_EVENT_SELECT,
    })

    if (events.length > PLATFORM_DOOR_LIST_LIMIT) truncated = true

    for (const event of events.slice(0, PLATFORM_DOOR_LIST_LIMIT)) {
      const authority = admissionAuthorityFor(membership, event.id)

      if (!authority) continue

      entries.push({
        event: { ...toAdmissionEvent(event), status: event.status },
        sessions: toDoorNights(event.sessions),
        organization: membership.organization,
        authority: authority.authority,
        role: authority.role,
      })
    }
  }

  const organizations = [
    ...new Map(entries.map((entry) => [entry.organization.id, entry.organization])).values(),
  ].sort((left, right) => left.name.localeCompare(right.name))

  return { entries, meta: { scope: 'MEMBERSHIPS', organizations, truncated } }
}

/**
 * A platform super administrator's door list.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {Array<object>} options.memberships The caller's memberships, with scopes.
 * @param {{organizationId?: string, q?: string}} options.filters The caller's filter.
 * @param {Date} options.since The earliest `endsAt` still shown.
 * @returns {Promise<{entries: Array<object>, meta: object}>} The list.
 */
async function platformDoorList({ prisma, memberships, filters, since }) {
  const [events, organizations] = await Promise.all([
    prisma.event.findMany({
      where: doorEventWhere(since, filters),
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: PLATFORM_DOOR_LIST_LIMIT + 1,
      select: { ...DOOR_EVENT_SELECT, organization: { select: { id: true, name: true } } },
    }),
    // Every organisation with a door open now, for the filter — not narrowed
    // by the filter itself, so choosing one does not empty the list of others.
    prisma.organization.findMany({
      where: { events: { some: doorEventWhere(since, {}) } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: PLATFORM_DOOR_ORGANIZATION_LIMIT,
      select: { id: true, name: true },
    }),
  ])

  const byOrganization = new Map(
    memberships.map((membership) => [membership.organization.id, membership]),
  )

  const entries = events.slice(0, PLATFORM_DOOR_LIST_LIMIT).map((event) => {
    // Membership wins, exactly as at the door: a super administrator who
    // organises this event is recorded on that authority, not the platform's.
    const authority =
      admissionAuthorityFor(byOrganization.get(event.organization.id) ?? null, event.id) ??
      platformAdmissionAuthorityFor('SUPER_ADMIN')
    const { organization, ...row } = event

    return {
      event: { ...toAdmissionEvent(row), status: row.status },
      sessions: toDoorNights(row.sessions),
      organization: { id: organization.id, name: organization.name },
      authority: authority.authority,
      role: authority.role,
    }
  })

  return {
    entries,
    meta: {
      scope: 'PLATFORM',
      organizations: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
      })),
      truncated: events.length > PLATFORM_DOOR_LIST_LIMIT,
    },
  }
}
