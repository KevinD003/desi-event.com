/**
 * Whose authority a change to an event is made under.
 *
 * Two kinds, and membership is always read first (SPEC2-XI X-A):
 *
 *   - **ORGANIZATION** — the actor's own membership in the event's organisation
 *     carries the capability the change needs. A platform role's capabilities
 *     never count as membership, so a SUPER_ADMIN who is not a member is not
 *     the organisation.
 *   - **PLATFORM** — the team at The Desi Events (ADMIN, SUPER_ADMIN) acting on an
 *     organisation's **posted** event. For an edit that is an open *sitting*:
 *     opened with a reason and a second factor (`platformEvents.openEdit`),
 *     at most sixty minutes long, answering only the browser session that
 *     opened it, and every write needs a second factor within the MODERATION
 *     window again. A deletion needs no sitting (it has its own preview,
 *     confirmation and step-up), and the organiser's lifecycle moves follow
 *     Rule L ({@link lifecycleAuthority}).
 *
 * Everything else is a 403. Every write made under platform authority is
 * audited with the sitting and its reason ({@link authorityAuditMetadata}), and
 * re-checks inside its own transaction that the sitting is still open
 * ({@link assertSittingStillOpen}), so a sitting closed or run out between the
 * check and the write refuses the write.
 *
 * @file @desi-event/api/lib/event-authority
 */

import { STEP_UP_POLICIES, stepUpSatisfied } from '@desi-event/auth'
import {
  CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  PermissionError,
  orgCapabilitiesFor,
} from '@desi-event/permissions'
import { PLATFORM_EDIT_MINUTES } from '@desi-event/schemas/event-control'
import { PLATFORM_EDITABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { forbidden, httpError } from './errors.js'

/** How long a sitting lasts, in milliseconds. */
export const PLATFORM_EDIT_WINDOW_MS = PLATFORM_EDIT_MINUTES * 60_000

/** The two kinds of authority, as `Event.deletionAuthority` stores them. */
export const AUTHORITY_KINDS = Object.freeze({
  ORGANIZATION: 'ORGANIZATION',
  PLATFORM: 'PLATFORM',
})

/** What a platform holder is told without an open sitting in this session. */
export const PLATFORM_EDIT_NOT_OPEN_SENTENCE =
  'Open this event for editing as the team at The Desi Events in this browser first: give a reason and confirm with your second factor.'

/** What the team at The Desi Events is told about an event that is not posted. */
export const NOT_POSTED_SENTENCE =
  'The Desi Events team edits an event only once it has been published. Before that it is the organiser’s draft; ask for changes through review.'

/** What a platform ADMIN is told about the organiser's lifecycle moves (Rule L). */
export const ORGANIZER_ONLY_SENTENCE =
  'Publishing, sales and postponement are the organiser’s decisions. The Desi Events team can change an event’s details in an editing session.'

/** What a platform holder is told when their MODERATION-window factor has lapsed mid-sitting. */
export const SITTING_STEP_UP_SENTENCE =
  "Confirm it's you to keep editing. The Desi Events team confirms every 10 minutes while editing someone else's event."

/**
 * Whether the actor's platform role carries a capability. Never membership.
 *
 * @param {object|null} actor The request actor.
 * @param {string} capability The capability.
 * @returns {boolean} True when the platform role holds it.
 */
export function platformHolds(actor, capability) {
  return (PLATFORM_ROLE_CAPABILITIES[actor?.role] ?? []).includes(capability)
}

/**
 * Whether the actor's membership in an organisation carries a capability.
 * A platform role's capabilities never count.
 *
 * @param {object|null} actor The request actor.
 * @param {string} capability The capability.
 * @param {string} organizationId The organisation.
 * @returns {boolean} True when a membership grants it.
 */
export function memberHolds(actor, capability, organizationId) {
  return orgCapabilitiesFor(actor, organizationId).includes(capability)
}

/**
 * The 403 an actor gets who holds neither kind of authority.
 *
 * Built like `assertCan`'s, so the error handler and every test that matches
 * on a capability refusal read it the same way.
 *
 * @param {string} capability The organisation capability that was needed.
 * @param {string} organizationId The organisation.
 * @returns {Error} The refusal.
 */
function notPermitted(capability, organizationId) {
  return new PermissionError(
    `Actor is not permitted to ${capability} in organization ${organizationId}.`,
    { capability, organizationId, reason: 'missing_capability' },
  )
}

/**
 * The open sitting this actor has on this event, if any (unexpired, not closed).
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} options Options.
 * @param {string} options.eventId The event.
 * @param {string} options.actorId The administrator.
 * @param {Date} options.now The instant.
 * @returns {Promise<object|null>} The sitting row, or null.
 */
export async function openSittingOf(db, { eventId, actorId, now }) {
  return db.eventPlatformEdit.findFirst({
    where: { eventId, actorId, closedAt: null, expiresAt: { gt: now } },
    orderBy: { openedAt: 'desc' },
  })
}

/**
 * Resolve the authority under which this actor may make this change.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} options Options.
 * @param {object} options.event The event, with `id`, `organizationId` and `status`.
 * @param {object} options.actor The request actor.
 * @param {object|null} [options.session] The request's session row, for the sitting and the step-up.
 * @param {string} options.orgCapability The organisation capability the change needs.
 * @param {string} [options.platformCapability] The platform capability standing in for it.
 * @param {boolean} [options.requireSitting] Whether platform authority needs an open sitting.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<{kind: 'ORGANIZATION'}|{kind: 'PLATFORM', via: string, editId: string|null, reason: string|null, importRunId: string|null}>} The authority.
 * @throws {Error} 403 (`PermissionError`, `PLATFORM_EDIT_NOT_OPEN`, `STEP_UP_REQUIRED`) or 409 `NOT_POSTED`.
 */
export async function resolveEventAuthority(db, options) {
  const {
    event,
    actor,
    session = null,
    orgCapability,
    platformCapability = CAPABILITIES.EVENT_PLATFORM_EDIT,
    requireSitting = true,
    now = new Date(),
  } = options

  if (memberHolds(actor, orgCapability, event.organizationId)) {
    return { kind: AUTHORITY_KINDS.ORGANIZATION }
  }

  if (!platformHolds(actor, platformCapability)) {
    throw notPermitted(orgCapability, event.organizationId)
  }

  if (!PLATFORM_EDITABLE_STATUSES.has(event.status)) {
    throw httpError(409, 'NOT_POSTED', NOT_POSTED_SENTENCE, { status: event.status })
  }

  if (!requireSitting) {
    return {
      kind: AUTHORITY_KINDS.PLATFORM,
      via: 'DELETION',
      editId: null,
      reason: null,
      importRunId: null,
    }
  }

  const sitting = await openSittingOf(db, { eventId: event.id, actorId: actor.id, now })

  // Bound to the browser session that opened it: a second session of the same
  // administrator, or a copied bearer token, has no sitting.
  if (!sitting || !session?.id || sitting.sessionId !== session.id) {
    throw forbidden(PLATFORM_EDIT_NOT_OPEN_SENTENCE, 'PLATFORM_EDIT_NOT_OPEN')
  }

  if (!stepUpSatisfied(session, { now, windowMs: STEP_UP_POLICIES.MODERATION })) {
    throw forbidden(SITTING_STEP_UP_SENTENCE, 'STEP_UP_REQUIRED')
  }

  return {
    kind: AUTHORITY_KINDS.PLATFORM,
    via: 'SITTING',
    editId: sitting.id,
    reason: sitting.reason,
    importRunId: null,
  }
}

/**
 * Re-check, inside the write's transaction, that the sitting is still open.
 *
 * Two steps, and the split is required: the lock is taken with a raw query
 * whose result is not read (`closeEdit` updates the row, so the two serialise),
 * and the decision is made with the query builder, which under READ COMMITTED
 * reads the latest committed row once the lock is granted.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object|null} authority From {@link resolveEventAuthority}.
 * @param {object} options Options.
 * @param {string|null} options.sessionId The request's session id.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<void>} Resolves when open, or when the authority is not a sitting.
 * @throws {Error} 403 `PLATFORM_EDIT_NOT_OPEN`.
 */
export async function assertSittingStillOpen(tx, authority, { sessionId, now = new Date() }) {
  if (authority?.kind !== AUTHORITY_KINDS.PLATFORM || authority.via !== 'SITTING') return

  await tx.$queryRaw`SELECT "id" FROM "EventPlatformEdit" WHERE "id" = ${authority.editId} FOR SHARE`

  const open = await tx.eventPlatformEdit.findFirst({
    where: { id: authority.editId, closedAt: null, expiresAt: { gt: now }, sessionId },
    select: { id: true },
  })

  if (!open) throw forbidden(PLATFORM_EDIT_NOT_OPEN_SENTENCE, 'PLATFORM_EDIT_NOT_OPEN')
}

/**
 * The audit metadata a write records about its authority: nothing for the
 * organisation (so existing audit rows are unchanged), and the sitting and its
 * reason for the team at The Desi Events.
 *
 * @param {object|null} authority From {@link resolveEventAuthority} or {@link lifecycleAuthority}.
 * @returns {object} Metadata to merge.
 */
export function authorityAuditMetadata(authority) {
  if (authority?.kind !== AUTHORITY_KINDS.PLATFORM) return {}

  return {
    authority: AUTHORITY_KINDS.PLATFORM,
    platformEditId: authority.editId ?? null,
    reason: authority.reason ?? null,
    ...(authority.via === 'IMPORT' ? { importRunId: authority.importRunId ?? null } : {}),
  }
}

/**
 * Whether a change under this authority was made by the team at The Desi Events, as
 * ticket holders are told it.
 *
 * @param {object|null} authority The authority.
 * @returns {boolean} True for platform authority.
 */
export function byPlatform(authority) {
  return authority?.kind === AUTHORITY_KINDS.PLATFORM
}

/**
 * Rule L: who may make the organiser's lifecycle moves (publish, sales,
 * postponement, cancellation, reschedule, review submissions, archive).
 *
 *   - A member whose membership carries the capability: ORGANIZATION.
 *   - A SUPER_ADMIN or platform ADMIN (`platform:admin`, ADR 0018) who is not
 *     such a member keeps the move through the platform role; it is recorded
 *     as the doing of the team at The Desi Events (`via: 'LIFECYCLE'`).
 *   - A platform role that edits posted events (`event:platform_edit`) without
 *     `platform:admin` (none today): 403 `ORGANIZER_ONLY`.
 *   - Anybody else: the ordinary capability refusal.
 *
 * @param {object} actor The request actor.
 * @param {object} event The event, with `organizationId`.
 * @param {string} capability The organisation capability the move needs.
 * @returns {{kind: 'ORGANIZATION'}|{kind: 'PLATFORM', via: 'LIFECYCLE', editId: null, reason: null, importRunId: null}} The authority.
 * @throws {Error} 403.
 */
export function lifecycleAuthority(actor, event, capability) {
  if (memberHolds(actor, capability, event.organizationId)) {
    return { kind: AUTHORITY_KINDS.ORGANIZATION }
  }

  if (platformHolds(actor, CAPABILITIES.PLATFORM_ADMIN) && platformHolds(actor, capability)) {
    return {
      kind: AUTHORITY_KINDS.PLATFORM,
      via: 'LIFECYCLE',
      editId: null,
      reason: null,
      importRunId: null,
    }
  }

  if (platformHolds(actor, CAPABILITIES.EVENT_PLATFORM_EDIT)) {
    throw forbidden(ORGANIZER_ONLY_SENTENCE, 'ORGANIZER_ONLY')
  }

  throw notPermitted(capability, event.organizationId)
}

/**
 * End every sitting still open on an event that is being deleted: the
 * editing of it by the team at The Desi Events ends with it. A sitting already run out is
 * recorded as EXPIRED, the rest as EVENT_DELETED. In the deletion's
 * transaction.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string} eventId The event.
 * @param {Date} now The instant.
 * @returns {Promise<number>} How many sittings were ended.
 */
export async function endSittingsOnDeletion(tx, eventId, now) {
  const running = await tx.eventPlatformEdit.updateMany({
    where: { eventId, closedAt: null, expiresAt: { gt: now } },
    data: { closedAt: now, endedBy: 'EVENT_DELETED' },
  })
  const lapsed = await tx.eventPlatformEdit.updateMany({
    where: { eventId, closedAt: null },
    data: { closedAt: now, endedBy: 'EXPIRED' },
  })

  return running.count + lapsed.count
}
