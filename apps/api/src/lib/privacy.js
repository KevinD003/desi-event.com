/**
 * Privacy redaction: scope, vocabulary and presentation.
 *
 * Phase 3's authorization floor. Nothing here redacts anything; what it does is
 * answer the two questions every privacy route has to answer before it does
 * anything at all — *which organisation is this about* and *is this person in
 * it* — and answer them on the server, from the database, never from the
 * request body.
 *
 * The capability guard is necessary and not sufficient, which is the reason
 * this module exists. `privacy:redact` is organisation-scoped, so an organiser
 * is already confined to the organisation named in the path. A platform
 * `SUPER_ADMIN` is not: the permission table grants every capability
 * platform-wide, and `decide` returns a platform grant before it ever looks at
 * an organisation id. So for that actor the capability check alone would let a
 * request name organisation A while targeting somebody who only exists in
 * organisation B. {@link assertSubjectBelongsToOrganization} is the layer that
 * refuses it, and it refuses it for everybody rather than special-casing a role.
 *
 * @module @desi-event/api/lib/privacy
 */

import { notFound } from './errors.js'

/**
 * The revision of the redaction policy a request is evaluated against.
 *
 * Stamped onto every request and every audit event, so a later change of policy
 * does not silently rewrite what was promised at the time. Bumped when the
 * category-to-column mapping or the treatment of a category changes — not when
 * prose changes.
 *
 * @type {string}
 */
export const PRIVACY_POLICY_VERSION = '2026-09-17.1'

/**
 * Why a redaction was asked for.
 *
 * Mirrors the `PrivacyRequestReason` enum. Closed, because free text is where
 * somebody records the circumstances, and the circumstances are personal data
 * about the person the request exists to remove.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PRIVACY_REASONS = Object.freeze({
  SUBJECT_REQUEST: 'SUBJECT_REQUEST',
  ORGANIZER_REQUEST: 'ORGANIZER_REQUEST',
  RETENTION_POLICY: 'RETENTION_POLICY',
  DATA_MINIMISATION: 'DATA_MINIMISATION',
})

/**
 * How a request ended.
 *
 * Also closed, and for a sharper reason: an outcome written as a sentence tends
 * to quote the row it failed on, and the row it failed on is the person.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PRIVACY_OUTCOMES = Object.freeze({
  REDACTED: 'REDACTED',
  ALREADY_REDACTED: 'ALREADY_REDACTED',
  WITHDRAWN_BY_OPERATOR: 'WITHDRAWN_BY_OPERATOR',
  REFUSED_LEGAL_HOLD: 'REFUSED_LEGAL_HOLD',
  REFUSED_FRAUD_HOLD: 'REFUSED_FRAUD_HOLD',
  REFUSED_OPEN_PROCESS: 'REFUSED_OPEN_PROCESS',
  CONFIRMATION_LAPSED: 'CONFIRMATION_LAPSED',
  STOPPED_SAFELY: 'STOPPED_SAFELY',
})

/**
 * The personal-data categories a redaction is expressed in.
 *
 * Categories rather than columns. A category is what an operator can be asked
 * to confirm; a column list is a map of where the personal data is, and a
 * preview that hands one to the browser is a worse leak than the fields it
 * describes.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PRIVACY_CATEGORIES = Object.freeze({
  ACCOUNT_IDENTITY: 'ACCOUNT_IDENTITY',
  BUYER_IDENTITY: 'BUYER_IDENTITY',
  TICKET_HOLDER_IDENTITY: 'TICKET_HOLDER_IDENTITY',
  NOTIFICATION_DELIVERY: 'NOTIFICATION_DELIVERY',
  SECURITY_METADATA: 'SECURITY_METADATA',
  EXPORTS: 'EXPORTS',
})

/**
 * Load the organisation a privacy action names, or refuse.
 *
 * 404 rather than 403 for an organisation the caller may not touch, so a caller
 * cannot learn that an identifier is real from the shape of the refusal. The
 * capability guard has already asserted `privacy:redact` against this id; what
 * is left is whether the row exists.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {string} organizationId The organisation named in the path.
 * @returns {Promise<{id: string}>} The organisation.
 * @throws {Error} A 404 when there is no such organisation.
 */
export async function loadOrganizationForPrivacy(prisma, organizationId) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  })

  if (!organization) throw notFound('No such organisation.')

  return organization
}

/**
 * Is this person somebody this organisation holds data about?
 *
 * Membership is the obvious relationship and not the only one: most subjects of
 * a redaction are buyers and attendees rather than staff. A person counts when
 * the organisation holds any of the four things a redaction would reach — a
 * membership, an order, a ticket, or a waitlist entry against one of its events.
 *
 * Counted with `findFirst` per relationship rather than one join, because each
 * of the four is a different reason and the first match is enough: this is a
 * yes-or-no question and enumerating a person's whole history to answer it would
 * be the opposite of data minimisation.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @returns {Promise<boolean>} Whether the organisation holds data about them.
 */
export async function subjectBelongsToOrganization(prisma, { organizationId, subjectUserId }) {
  const membership = await prisma.membership.findFirst({
    where: { organizationId, userId: subjectUserId },
    select: { id: true },
  })

  if (membership) return true

  const order = await prisma.order.findFirst({
    where: { userId: subjectUserId, event: { organizationId } },
    select: { id: true },
  })

  if (order) return true

  const ticket = await prisma.ticket.findFirst({
    where: { ownerUserId: subjectUserId, orderItem: { order: { event: { organizationId } } } },
    select: { id: true },
  })

  if (ticket) return true

  const waitlisted = await prisma.waitlistEntry.findFirst({
    where: { userId: subjectUserId, event: { organizationId } },
    select: { id: true },
  })

  return Boolean(waitlisted)
}

/**
 * Refuse a subject this organisation holds nothing about.
 *
 * The non-enumerating refusal is the whole point. A caller who may act on
 * organisation A must not be able to discover, by the difference between two
 * error messages, that a given identifier belongs to a real person in
 * organisation B. Both answers are the same 404 with the same sentence.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @returns {Promise<void>} Nothing, when the subject is in scope.
 * @throws {Error} A 404 when they are not, whatever the reason.
 */
export async function assertSubjectBelongsToOrganization(
  prisma,
  { organizationId, subjectUserId },
) {
  const belongs = await subjectBelongsToOrganization(prisma, { organizationId, subjectUserId })

  if (!belongs) throw notFound('No such person in this organisation.')
}

/**
 * Project a stored request onto what an operator may see.
 *
 * An allow list, and every field named: the subject appears as an opaque row id
 * and the work as counts by category. Deliberately absent, and each for its own
 * reason — `confirmationHash`, because a confirmation an API returns is not a
 * confirmation; `idempotencyKey`, for the same reason; `leaseOwner`,
 * `leaseExpiresAt` and `attempts`, because a browser that can see a lease is a
 * browser somebody will eventually let steer one; `organizationId`, because the
 * caller supplied it in the path and echoing it invites a client to trust the
 * echo; and `heldByHoldId`, because which matter is holding somebody's data is
 * not the same question as whether their data is held.
 *
 * @param {object} row A `PrivacyRequest` row.
 * @returns {object} The payload described by `privacyRequestSchema`.
 */
export function toPrivacyRequest(row) {
  return {
    id: row.id,
    subjectId: row.subjectUserId,
    state: row.state,
    reason: row.reason,
    holdDecision: row.holdDecision,
    policyVersion: row.policyVersion,
    correlationId: row.correlationId,
    scope: Array.isArray(row.scope) ? row.scope : null,
    outcomeCode: row.outcomeCode ?? null,
    requestedAt: row.createdAt,
    confirmedAt: row.confirmedAt ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    cancelledAt: row.cancelledAt ?? null,
  }
}
