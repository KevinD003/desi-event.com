/**
 * Event pictures: who may see them, and every change to them.
 *
 * ## What "public" means
 *
 * A picture reaches a public surface — a card, the event page, a wallet, a
 * social preview — only when all four hold: a moderator approved it, the
 * structural check passed, the bytes were rebuilt before storage, and the event
 * itself is publicly visible. That is `PUBLIC_MEDIA_WHERE` plus the event's
 * status, and it is checked twice: in the query, and again in JavaScript by
 * {@link isPubliclyServable}, so a query that forgot its `where` still cannot
 * put an unreviewed picture on a page.
 *
 * ## What may change when
 *
 * New pixels — an upload, a replaced cover — while the event is editable, where
 * every new picture is reviewed with the event, and once it is posted (live,
 * finished or cancelled), where each new picture is stored waiting and shown
 * only after somebody on the team at The Desi Events other than its uploader approves
 * it (SPEC2-XI X-3). A cover uploaded to a posted event waits beside the
 * current one (`replacesMediaId`), which stays public until the new one is
 * approved; approving it removes the old cover in the same transaction, which
 * locks the event first. A description and the gallery order may change in
 * the same statuses. A picture may be removed in every status except the two
 * in which a moderator holds this version, and DELETED, whose pictures are kept
 * for a restore (and so do not count toward the organisation's quota). Every
 * write goes through `authorChange`, so each one takes the event revision as a
 * precondition, bumps it, and is audited in the same transaction; the
 * organisation's members write under their membership, the team at The Desi Events in
 * an editing sitting (`lib/event-authority.js`).
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/lib/event-media
 */

import { CAPABILITIES, can } from '@desi-event/permissions'
import { toSkipTake } from '@desi-event/schemas'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'
import {
  MEDIA_ARRANGE_STATUSES,
  MEDIA_LIMITS,
  MEDIA_REMOVE_STATUSES,
  MEDIA_UPLOAD_STATUSES,
} from '@desi-event/schemas/media'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { resolveEventAuthority } from './event-authority.js'
import { authorChange } from './event-authoring.js'
import {
  MEDIA_CHANGED_SENTENCE,
  databaseErrorCode,
  httpError,
  isRetryableConflict,
  notFound,
} from './errors.js'
import { STRUCTURAL_SCAN_NOTE, createPostgresMediaStorage } from './media-storage.js'
import { assertIndependentReviewer } from './review-independence.js'
import { TRANSACTION_BUDGETS, budgetedTransaction } from './transaction-budget.js'

/** The conditions a picture must meet, besides its event's status, to be public. */
export const PUBLIC_MEDIA_WHERE = Object.freeze({
  moderationStatus: 'APPROVED',
  scanStatus: 'CLEAN',
  sanitisedAt: { not: null },
})

/** What a public projection reads. Never the storage key, the scan note or the uploader. */
export const PUBLIC_MEDIA_SELECT = Object.freeze({
  id: true,
  kind: true,
  position: true,
  altText: true,
  width: true,
  height: true,
  contentType: true,
  moderationStatus: true,
  scanStatus: true,
  sanitisedAt: true,
  createdAt: true,
})

/** What the organiser and moderator view reads. Still no storage key, scan note or uploader. */
export const EVENT_MEDIA_SELECT = Object.freeze({
  ...PUBLIC_MEDIA_SELECT,
  byteSize: true,
  checksum: true,
  moderationNote: true,
  replacesMediaId: true,
})

/** The order pictures are listed in: the cover, then the gallery by position. */
export const MEDIA_ORDER = Object.freeze([
  { kind: 'asc' },
  { position: 'asc' },
  { createdAt: 'asc' },
])

/** Include for a list: the public cover only. */
export const EVENT_COVER_INCLUDE = Object.freeze({
  media: {
    where: { ...PUBLIC_MEDIA_WHERE, kind: 'EVENT_COVER' },
    select: PUBLIC_MEDIA_SELECT,
    take: 1,
  },
})

/** Include for a detail: every public picture, in order. */
export const EVENT_MEDIA_INCLUDE = Object.freeze({
  media: {
    where: PUBLIC_MEDIA_WHERE,
    select: PUBLIC_MEDIA_SELECT,
    orderBy: MEDIA_ORDER,
  },
})

/**
 * Whether a picture may be shown to anybody at all.
 *
 * @param {object} asset A `MediaAsset` row, or the public selection of one.
 * @param {string} eventStatus Its event's status.
 * @returns {boolean} True when it is public.
 */
export function isPubliclyServable(asset, eventStatus) {
  return (
    Boolean(asset) &&
    asset.moderationStatus === 'APPROVED' &&
    asset.scanStatus === 'CLEAN' &&
    asset.sanitisedAt !== null &&
    asset.sanitisedAt !== undefined &&
    PUBLICLY_VISIBLE_STATUSES.has(eventStatus)
  )
}

/**
 * A picture as a public page receives it.
 *
 * @param {object} asset A `MediaAsset` row.
 * @returns {{id: string, url: string, altText: string, width: number, height: number, contentType: string}} The payload.
 */
export function toPublicMedia(asset) {
  return {
    id: asset.id,
    url: `/v1/media/${asset.id}`,
    altText: asset.altText,
    width: asset.width,
    height: asset.height,
    contentType: asset.contentType,
  }
}

/**
 * A picture as its organiser and a moderator see it.
 *
 * @param {object} asset A `MediaAsset` row selected with {@link EVENT_MEDIA_SELECT}.
 * @param {string} eventStatus Its event's status.
 * @returns {object} A payload satisfying `eventMediaSchema`.
 */
export function toEventMedia(asset, eventStatus) {
  return {
    ...toPublicMedia(asset),
    kind: asset.kind,
    position: asset.position ?? null,
    byteSize: asset.byteSize,
    checksum: asset.checksum,
    moderationStatus: asset.moderationStatus,
    // Named for what it is on the wire: the column's own name belongs to the
    // event's private moderator note, which no browser bundle may carry.
    rejectionReason: asset.moderationStatus === 'REJECTED' ? (asset.moderationNote ?? null) : null,
    publiclyVisible: isPubliclyServable(asset, eventStatus),
    replacesMediaId: asset.replacesMediaId ?? null,
    createdAt: asset.createdAt,
  }
}

/**
 * The event's public cover, or null for the generated poster.
 *
 * @param {object} event An event row whose `media` was loaded with one of the includes above.
 * @returns {object|null} A `publicMediaSchema` payload, or null.
 */
export function publicCover(event) {
  const cover = (event?.media ?? []).find(
    (asset) => asset.kind === 'EVENT_COVER' && isPubliclyServable(asset, event.status),
  )

  return cover ? toPublicMedia(cover) : null
}

/**
 * The event's public gallery, in the organiser's order.
 *
 * @param {object} event An event row whose `media` was loaded with {@link EVENT_MEDIA_INCLUDE}.
 * @returns {object[]} `publicMediaSchema` payloads, at most eight.
 */
export function publicGallery(event) {
  return (event?.media ?? [])
    .filter((asset) => asset.kind === 'EVENT_GALLERY' && isPubliclyServable(asset, event.status))
    .sort(
      (left, right) =>
        (left.position ?? 0) - (right.position ?? 0) ||
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    )
    .slice(0, MEDIA_LIMITS.galleryMax)
    .map(toPublicMedia)
}

/**
 * Load the few columns every picture write needs.
 *
 * @param {object} prisma The Prisma client.
 * @param {string} eventId The event.
 * @returns {Promise<{id: string, organizationId: string, status: string, revision: number}>} The event.
 * @throws {Error} A 404 when there is no such event.
 */
export async function loadEventForMedia(prisma, eventId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, organizationId: true, status: true, revision: true, title: true },
  })

  if (!event) throw notFound('No such event.')

  return event
}

/**
 * Whether this caller may read an event's pictures that are not public yet.
 *
 * Members who may see the organisation's drafts, moderators and platform
 * administrators. The same question the rest of the authoring surface asks.
 *
 * @param {object} event The event, with `organizationId`.
 * @param {object|null} actor The request actor.
 * @returns {boolean} True when they may.
 */
export function maySeePrivateMedia(event, actor) {
  return (
    can(actor, CAPABILITIES.MODERATION_REVIEW) ||
    can(actor, CAPABILITIES.PLATFORM_ADMIN) ||
    can(actor, CAPABILITIES.EVENT_VIEW_DRAFT, { organizationId: event.organizationId })
  )
}

/**
 * Why an approved event's pictures are held, in the organiser's words. The
 * moderator has decided; the event is waiting for its organiser to publish it,
 * and once it is published its pictures can be arranged and removed again.
 */
export const APPROVED_MEDIA_SENTENCE =
  'This event is approved and waiting for you to publish it. Its pictures can be described again, reordered or removed once it is published.'

/** Why an event under review holds its pictures. */
const IN_REVIEW_SENTENCE =
  'This event is waiting for review. A moderator is looking at this version, so its pictures cannot change until they decide or you withdraw it from review.'

/**
 * Why a deleted event's pictures hold: nobody is reviewing it, and they stay
 * as they were so a restore brings the event back whole (SPEC2-XI X-8).
 */
const DELETED_MEDIA_SENTENCE =
  'This event was deleted. Its pictures stay as they were, so a restore by the team at The Desi Events brings the event back whole.'

/** Why a status refuses each kind of change, in the organiser's words. */
const STATUS_REFUSALS = Object.freeze({
  upload: (status) => {
    if (status === 'DELETED') return DELETED_MEDIA_SENTENCE
    if (status === 'REVIEW_PENDING') {
      return 'This event is waiting for review, so no picture can be added. Withdraw it from review first.'
    }
    if (status === 'APPROVED') {
      return 'This event is approved and waiting for you to publish it. New pictures can be added once it is published; each appears once the team at The Desi Events approves it.'
    }
    if (status === 'REJECTED') {
      return 'A moderator rejected this event. Rework it as a draft to add pictures.'
    }

    return `This event is ${String(status).toLowerCase()}, so no picture can be added.`
  },
  arrange: (status) => {
    if (status === 'DELETED') return DELETED_MEDIA_SENTENCE
    if (status === 'APPROVED') return APPROVED_MEDIA_SENTENCE
    if (status === 'REVIEW_PENDING') return IN_REVIEW_SENTENCE

    return `This event is ${status}, so its pictures cannot be described again or reordered.`
  },
  // Removal is refused in exactly three statuses: the two in which a moderator
  // holds this version, and DELETED.
  remove: (status) => {
    if (status === 'DELETED') return DELETED_MEDIA_SENTENCE

    return status === 'APPROVED' ? APPROVED_MEDIA_SENTENCE : IN_REVIEW_SENTENCE
  },
})

/** Which statuses allow each kind of change. */
const STATUS_SETS = Object.freeze({
  upload: MEDIA_UPLOAD_STATUSES,
  arrange: MEDIA_ARRANGE_STATUSES,
  remove: MEDIA_REMOVE_STATUSES,
})

/**
 * Assert this actor may make this kind of change to this event's pictures now.
 *
 * "You may not" is a 403; "not in this state" is a 409 `NOT_EDITABLE`. The
 * organisation's members change pictures under their membership
 * (`event:update`); the team at The Desi Events in an open editing sitting of this
 * browser session, on a posted event only (SPEC2-XI X-7).
 *
 * @param {object} db A Prisma client.
 * @param {object} event The event, with `id`, `organizationId` and `status`.
 * @param {object} actor The request actor.
 * @param {'upload'|'arrange'|'remove'} change The kind of change.
 * @param {object} [options] Options.
 * @param {object|null} [options.session] The request's session row.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} The authority, for `authorChange`.
 * @throws {Error} A 403 or a 409.
 */
export async function assertMediaChange(db, event, actor, change, { session = null, now } = {}) {
  const authority = await resolveEventAuthority(db, {
    event,
    actor,
    session,
    orgCapability: CAPABILITIES.EVENT_UPDATE,
    now: now ?? new Date(),
  })

  if (!STATUS_SETS[change].has(event.status)) {
    throw httpError(409, 'NOT_EDITABLE', STATUS_REFUSALS[change](event.status), {
      status: event.status,
    })
  }

  return authority
}

/** The database codes a picture write meets when the pictures changed under it. */
const MEDIA_RACE_CODES = Object.freeze(new Set(['23503', '23514', 'P2002', 'P2025']))

/**
 * A picture's decision: its row, and for a replacement cover the event's row
 * and the old cover's removal. It waits behind whatever holds the event's row
 * (an organiser's upload, a deletion); one that runs out answers 503 and
 * decides nothing (`lib/transaction-budget.js`).
 */
const MEDIA_DECISION_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Another change to this event’s pictures was being saved at the same moment, and this decision could not wait for it, so nothing was decided. Try again in a moment.',
})

/**
 * Turn a database refusal met by a picture write into the conflict it means.
 *
 * A replacement cover approved while the organiser removed or replaced the
 * cover it pointed at, a row gone under a decision, a deadlock with the event's
 * own writes: 409 `MEDIA_CHANGED`, never a 500 (SPEC2-XI X-P). Anything the
 * API raised itself passes through untouched.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {never} Always throws.
 * @throws {Error} The conflict, or the original error.
 */
export function rethrowMediaChanged(error) {
  if (MEDIA_RACE_CODES.has(databaseErrorCode(error)) || isRetryableConflict(error)) {
    throw httpError(409, 'MEDIA_CHANGED', MEDIA_CHANGED_SENTENCE)
  }

  throw error
}

/**
 * Refuse a gallery upload when the gallery is full.
 *
 * @param {object} client A Prisma client or transaction.
 * @param {string} eventId The event.
 * @returns {Promise<number>} How many gallery pictures there are now.
 * @throws {Error} A 409 `GALLERY_FULL`.
 */
export async function assertGalleryRoom(client, eventId) {
  const count = await client.mediaAsset.count({ where: { eventId, kind: 'EVENT_GALLERY' } })

  if (count >= MEDIA_LIMITS.galleryMax) {
    throw httpError(
      409,
      'GALLERY_FULL',
      `The gallery already holds ${MEDIA_LIMITS.galleryMax} pictures. Remove one before adding another.`,
    )
  }

  return count
}

/**
 * What deleted events' pictures may hold on top of the organisation's quota:
 * one quota more, so an organisation holds at most twice its quota in all.
 *
 * @type {number}
 */
export const DELETED_EVENT_ALLOWANCE_BYTES = MEDIA_LIMITS.organizationQuotaBytes

/** The refusal when the organisation's own pictures fill its quota. */
export const MEDIA_QUOTA_SENTENCE =
  'Your organisation has used its 1 GB of picture storage. Remove pictures from past events to make room.'

/** The refusal when deleted events' pictures, kept for a restore, fill what is left. */
export const MEDIA_HELD_FOR_DELETED_SENTENCE =
  'Your organisation’s deleted events still hold their pictures, kept so the team at The Desi Events can restore them, and together with your other pictures they fill the 2 GB your organisation may store in all. To make room, remove pictures from past events, or ask the team at The Desi Events to restore a deleted event and then remove its pictures.'

/**
 * Refuse an upload that would take the organisation past its storage quota.
 *
 * Two ceilings. The quota counts the pictures of events that are not deleted:
 * a deleted event's pictures are kept for a restore and cannot be removed
 * while it is deleted (`MEDIA_REMOVE_STATUSES`), so they do not use up the
 * room an organisation can free (SPEC2-XI decision 10). They are still bytes
 * the organisation holds, and nothing purges them, so without a second bound
 * deleting full events and uploading again would grow storage without end.
 * Everything the organisation holds, deleted events included, may come to the
 * quota plus {@link DELETED_EVENT_ALLOWANCE_BYTES}.
 *
 * @param {object} client A Prisma client or transaction.
 * @param {string} organizationId The organisation.
 * @param {number} adding Bytes the upload adds (net of anything it replaces).
 * @returns {Promise<void>} Resolves when there is room.
 * @throws {Error} A 409 `MEDIA_QUOTA_EXCEEDED`.
 */
export async function assertQuota(client, organizationId, adding) {
  const more = Math.max(0, adding)
  const live = await client.mediaAsset.aggregate({
    where: { event: { organizationId, status: { not: 'DELETED' } } },
    _sum: { byteSize: true },
  })
  const used = live._sum?.byteSize ?? 0

  if (used + more > MEDIA_LIMITS.organizationQuotaBytes) {
    throw httpError(409, 'MEDIA_QUOTA_EXCEEDED', MEDIA_QUOTA_SENTENCE)
  }

  const deleted = await client.mediaAsset.aggregate({
    where: { event: { organizationId, status: 'DELETED' } },
    _sum: { byteSize: true },
  })
  const kept = deleted._sum?.byteSize ?? 0

  if (used + kept + more > MEDIA_LIMITS.organizationQuotaBytes + DELETED_EVENT_ALLOWANCE_BYTES) {
    throw httpError(409, 'MEDIA_QUOTA_EXCEEDED', MEDIA_HELD_FOR_DELETED_SENTENCE, {
      deletedEventBytes: kept,
    })
  }
}

/**
 * The checks an upload can make before its body is read.
 *
 * Run as an `onRequest` hook, after the session guard: may this caller edit
 * this event, is the event in a state that takes new pictures, is there room
 * in the gallery, and room in the organisation's quota for what the request
 * says it is sending. Every one of them is asserted again inside the
 * transaction; this pass exists so that a refused upload is refused before ten
 * megabytes are read.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Options.
 * @param {string} options.eventId The event in the path.
 * @param {object} options.actor The request actor.
 * @param {unknown} options.kind The raw `kind` query value; validated later.
 * @param {number} options.declaredBytes The request's Content-Length, or 0.
 * @param {object|null} [options.session] The request's session row.
 * @returns {Promise<void>} Resolves when the upload may proceed to its body.
 */
export async function gateUpload(prisma, { eventId, actor, kind, declaredBytes, session = null }) {
  const event = await loadEventForMedia(prisma, eventId)

  await assertMediaChange(prisma, event, actor, 'upload', { session })

  if (kind === 'EVENT_GALLERY') await assertGalleryRoom(prisma, event.id)

  await assertQuota(prisma, event.organizationId, declaredBytes > 0 ? declaredBytes : 0)
}

/**
 * Every picture of an event, as its organiser sees them.
 *
 * @param {object} client A Prisma client or transaction.
 * @param {object} event The event, with `id` and `status`.
 * @returns {Promise<object[]>} `eventMediaSchema` payloads.
 */
export async function listEventMedia(client, event) {
  const rows = await client.mediaAsset.findMany({
    where: { eventId: event.id },
    select: EVENT_MEDIA_SELECT,
    orderBy: MEDIA_ORDER,
  })

  return rows.map((row) => toEventMedia(row, event.status))
}

/**
 * Store a sanitised upload.
 *
 * Inside one short transaction: the revision bump (which locks the event
 * first, so it serialises with a replacement cover's approval), the cover
 * swap, the gallery and quota checks again, the asset row, its bytes and the
 * audit row. Sanitising happened before, outside it, so nothing slow holds the
 * event row.
 *
 * A cover on a draft replaces the old one at once. A cover on a posted event
 * waits beside the current one (`replacesMediaId`): a replacement already
 * waiting, or taken down, is discarded first, so there is at most one. With no
 * current cover, it is simply the (waiting) cover.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} storage The `MediaStorage` adapter.
 * @param {object} options Options.
 * @param {object} options.event The event, from {@link loadEventForMedia}.
 * @param {object} options.actor The request actor.
 * @param {number} options.revision The revision the caller read.
 * @param {'EVENT_COVER'|'EVENT_GALLERY'} options.kind What the picture is for.
 * @param {string} options.altText The normalised description.
 * @param {object} options.upload What `sanitiseImage` returned.
 * @returns {Promise<object>} `{ asset, event }`: the stored asset and the event after the write.
 */
export async function addEventMedia(prisma, storage, options) {
  const { event, actor, revision, kind, altText, upload, session = null } = options

  const authority = await assertMediaChange(prisma, event, actor, 'upload', { session })
  const posted = PUBLICLY_VISIBLE_STATUSES.has(event.status)

  /** @type {object} */
  let created
  /** @type {object|null} */
  let replaced = null
  /** @type {object|null} */
  let waitsBeside = null
  /** @type {string[]} */
  let discarded = []

  const updated = await authorChange(prisma, {
    event,
    revision,
    actor,
    authority,
    sessionId: session?.id ?? null,
    action: AUDIT_ACTIONS.EVENT_MEDIA_ADDED,
    metadata: () => ({
      mediaId: created.id,
      kind,
      contentType: upload.contentType,
      byteSize: upload.byteSize,
      width: upload.width,
      height: upload.height,
      checksum: upload.checksum,
      altTextLength: altText.length,
      replacedMediaId: replaced?.id ?? null,
      // On a posted event: the cover this one waits to replace, and any
      // replacement it discarded.
      replacesMediaId: waitsBeside?.id ?? null,
      discardedMediaIds: discarded,
    }),
    write: async (tx) => {
      let position = null

      if (kind === 'EVENT_COVER' && posted) {
        // A replacement already waiting, or taken down, goes first: there is
        // at most one, and the newest upload is the organiser's choice.
        const earlier = await tx.mediaAsset.findMany({
          where: { eventId: event.id, kind: 'EVENT_COVER', replacesMediaId: { not: null } },
          select: { id: true, storageKey: true },
        })

        for (const row of earlier) {
          await storage.remove(tx, row.storageKey)
          await tx.mediaAsset.deleteMany({ where: { id: row.id } })
        }

        discarded = earlier.map((row) => row.id)
        waitsBeside = await tx.mediaAsset.findFirst({
          where: { eventId: event.id, kind: 'EVENT_COVER', replacesMediaId: null },
          select: { id: true },
        })
      } else if (kind === 'EVENT_COVER') {
        // A draft's cover is reviewed with the event: the new one replaces the
        // old one at once, and any replacement left from before goes too.
        const covers = await tx.mediaAsset.findMany({
          where: { eventId: event.id, kind: 'EVENT_COVER' },
          select: { id: true, storageKey: true, byteSize: true, replacesMediaId: true },
        })

        replaced = covers.find((row) => !row.replacesMediaId) ?? null

        for (const row of [...covers].sort(
          (left, right) =>
            Number(Boolean(right.replacesMediaId)) - Number(Boolean(left.replacesMediaId)),
        )) {
          await storage.remove(tx, row.storageKey)
          await tx.mediaAsset.deleteMany({ where: { id: row.id } })
        }
      } else {
        position = await assertGalleryRoom(tx, event.id)
      }

      await assertQuota(tx, event.organizationId, upload.byteSize)

      const key = storage.newKey()

      created = await tx.mediaAsset.create({
        data: {
          ownerType: 'EVENT',
          ownerId: event.id,
          eventId: event.id,
          kind,
          storageKey: key,
          contentType: upload.contentType,
          byteSize: upload.byteSize,
          width: upload.width,
          height: upload.height,
          checksum: upload.checksum,
          altText,
          position,
          sanitisedAt: new Date(),
          scanStatus: 'CLEAN',
          scanNote: STRUCTURAL_SCAN_NOTE,
          moderationStatus: 'PENDING',
          uploadedById: actor?.id ?? null,
          replacesMediaId: waitsBeside?.id ?? null,
        },
        select: EVENT_MEDIA_SELECT,
      })

      await storage.put(tx, {
        key,
        bytes: upload.bytes,
        checksum: upload.checksum,
        byteSize: upload.byteSize,
      })
    },
  }).catch(rethrowMediaChanged)

  return { asset: toEventMedia(created, updated.status), event: updated }
}

/**
 * Load one picture of an event inside a write, or refuse with the 404 a
 * missing picture gets.
 *
 * @param {object} tx The transaction client.
 * @param {string} eventId The event.
 * @param {string} mediaId The picture.
 * @param {object} [select] Extra columns to read.
 * @returns {Promise<object>} The picture.
 */
async function pictureOf(tx, eventId, mediaId, select = {}) {
  const asset = await tx.mediaAsset.findFirst({
    where: { id: mediaId, eventId },
    select: { ...EVENT_MEDIA_SELECT, ...select },
  })

  if (!asset) throw notFound('No such picture on this event.')

  return asset
}

/**
 * Describe a picture again.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event.
 * @param {object} options.actor The request actor.
 * @param {number} options.revision The revision the caller read.
 * @param {string} options.mediaId The picture.
 * @param {string} options.altText The new description.
 * @param {object|null} [options.session] The request's session, for a platform sitting's check.
 * @returns {Promise<object>} `{ asset, event }`: the picture and the event after the write.
 */
export async function describeEventMedia(
  prisma,
  { event, actor, revision, mediaId, altText, session = null },
) {
  const authority = await assertMediaChange(prisma, event, actor, 'arrange', { session })

  /** @type {object} */
  let described

  const updated = await authorChange(prisma, {
    event,
    revision,
    actor,
    authority,
    sessionId: session?.id ?? null,
    action: AUDIT_ACTIONS.EVENT_MEDIA_DESCRIBED,
    metadata: () => ({ mediaId, kind: described.kind, altTextLength: altText.length }),
    write: async (tx) => {
      await pictureOf(tx, event.id, mediaId)

      described = await tx.mediaAsset.update({
        where: { id: mediaId },
        data: { altText },
        select: EVENT_MEDIA_SELECT,
      })
    },
  }).catch(rethrowMediaChanged)

  return { asset: toEventMedia(described, updated.status), event: updated }
}

/**
 * Write gallery positions 0..n-1 in the given order, touching only rows whose
 * position changes.
 *
 * @param {object} tx The transaction client.
 * @param {Array<{id: string, position: number|null}>} ordered The gallery, in its new order.
 * @returns {Promise<void>} Resolves once written.
 */
async function writePositions(tx, ordered) {
  for (const [index, asset] of ordered.entries()) {
    if (asset.position === index) continue

    await tx.mediaAsset.update({ where: { id: asset.id }, data: { position: index } })
  }
}

/**
 * Put the gallery in a new order.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event.
 * @param {object} options.actor The request actor.
 * @param {number} options.revision The revision the caller read.
 * @param {string[]} options.galleryIds Every gallery picture, in the new order.
 * @param {object|null} [options.session] The request's session, for a platform sitting's check.
 * @returns {Promise<object>} `{ event }`: the event after the write.
 * @throws {Error} A 409 `GALLERY_CHANGED` when the list is not exactly the current gallery.
 */
export async function reorderEventMedia(
  prisma,
  { event, actor, revision, galleryIds, session = null },
) {
  const authority = await assertMediaChange(prisma, event, actor, 'arrange', { session })

  const updated = await authorChange(prisma, {
    event,
    revision,
    actor,
    authority,
    sessionId: session?.id ?? null,
    action: AUDIT_ACTIONS.EVENT_MEDIA_REORDERED,
    metadata: { galleryIds },
    write: async (tx) => {
      const gallery = await tx.mediaAsset.findMany({
        where: { eventId: event.id, kind: 'EVENT_GALLERY' },
        select: { id: true, position: true },
      })
      const current = new Set(gallery.map((asset) => asset.id))

      if (current.size !== galleryIds.length || galleryIds.some((id) => !current.has(id))) {
        throw httpError(
          409,
          'GALLERY_CHANGED',
          'The gallery changed since this page loaded: a picture was added or removed. Reload to see it as it is now.',
          { expected: gallery.length, received: galleryIds.length },
        )
      }

      const byId = new Map(gallery.map((asset) => [asset.id, asset]))

      await writePositions(
        tx,
        galleryIds.map((id) => byId.get(id)),
      )
    },
  }).catch(rethrowMediaChanged)

  return { event: updated }
}

/**
 * Remove a picture and its bytes, and close the gap in the gallery.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} storage The `MediaStorage` adapter.
 * @param {object} options Options.
 * @param {object} options.event The event.
 * @param {object} options.actor The request actor.
 * @param {number} options.revision The revision the caller read.
 * @param {string} options.mediaId The picture.
 * @param {object|null} [options.session] The request's session, for a platform sitting's check.
 * @returns {Promise<object>} `{ event }`: the event after the write.
 */
export async function removeEventMedia(
  prisma,
  storage,
  { event, actor, revision, mediaId, session = null },
) {
  const authority = await assertMediaChange(prisma, event, actor, 'remove', { session })

  /** @type {object} */
  let removed

  const updated = await authorChange(prisma, {
    event,
    revision,
    actor,
    authority,
    sessionId: session?.id ?? null,
    action: AUDIT_ACTIONS.EVENT_MEDIA_REMOVED,
    metadata: () => ({
      mediaId,
      kind: removed.kind,
      byteSize: removed.byteSize,
      checksum: removed.checksum,
    }),
    write: async (tx) => {
      removed = await pictureOf(tx, event.id, mediaId, { storageKey: true })

      await storage.remove(tx, removed.storageKey)
      await tx.mediaAsset.delete({ where: { id: mediaId } })

      if (removed.kind === 'EVENT_GALLERY') {
        const remaining = await tx.mediaAsset.findMany({
          where: { eventId: event.id, kind: 'EVENT_GALLERY' },
          select: { id: true, position: true, createdAt: true },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        })

        await writePositions(tx, remaining)
      }
    },
  }).catch(rethrowMediaChanged)

  return { event: updated }
}

/**
 * Swap a replacement cover in for the cover it replaces, inside the caller's
 * transaction: the old cover and its bytes go, and the replacement stops
 * pointing at it, so it is the event's current cover. The caller has locked
 * the event row first (SPEC2-XI X-P), and approves the replacement next.
 *
 * Tolerates a cover already gone (the organiser removed it meanwhile): the
 * pointer was cleared by the database's `ON DELETE SET NULL` then.
 *
 * @param {object} tx The transaction client.
 * @param {object} storage The `MediaStorage` adapter.
 * @param {string} replacedId The cover being replaced.
 * @returns {Promise<{removed: boolean}>} Whether this call removed it.
 */
async function removeReplacedCover(tx, storage, replacedId) {
  const old = await tx.mediaAsset.findUnique({
    where: { id: replacedId },
    select: { id: true, storageKey: true },
  })

  if (!old) return { removed: false }

  const { count } = await tx.mediaAsset.deleteMany({ where: { id: old.id } })

  if (count === 1) await storage.remove(tx, old.storageKey)

  return { removed: count === 1 }
}

/**
 * Approve every picture still waiting on an event the moderator just approved.
 *
 * Called from `transitionEvent`'s `onCommit`, inside the approval transaction.
 * Uploads are refused while an event is under review, but an organiser can
 * withdraw it, add a picture and resubmit while a moderator's page is open, and
 * the status alone cannot show that. What pins the set is the event revision:
 * every picture write bumps it, and `moderation.decide` refuses an approval
 * whose `revision` is not the current one before this runs. The review page
 * always sends it; a caller that omits it approves whatever is waiting.
 *
 * A waiting replacement cover (left from a posted event that was since
 * withdrawn into review, say) is swapped in as `decideMedia` swaps one: the
 * cover it replaces goes first, so the database never sees two approved covers.
 *
 * @param {object} tx The transaction client.
 * @param {object} event The event, after the transition.
 * @param {object} actor The moderator.
 * @returns {Promise<number>} How many pictures were approved.
 */
export async function approvePendingEventMedia(tx, event, actor) {
  const waiting = await tx.mediaAsset.findMany({
    where: {
      eventId: event.id,
      moderationStatus: 'PENDING',
      scanStatus: 'CLEAN',
      sanitisedAt: { not: null },
    },
    select: { id: true, kind: true, checksum: true, replacesMediaId: true },
  })

  if (waiting.length === 0) return 0

  const moderatedAt = new Date()
  // Bytes are removed inside the transaction; the client is not used.
  const storage = createPostgresMediaStorage(null)

  for (const asset of waiting.filter((row) => row.replacesMediaId)) {
    await removeReplacedCover(tx, storage, asset.replacesMediaId)
  }

  await tx.mediaAsset.updateMany({
    where: { id: { in: waiting.map((asset) => asset.id) }, moderationStatus: 'PENDING' },
    data: {
      moderationStatus: 'APPROVED',
      moderatedAt,
      moderatedById: actor?.id ?? null,
      moderationNote: null,
      replacesMediaId: null,
    },
  })

  for (const asset of waiting) {
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.MEDIA_APPROVED,
      entityType: 'MediaAsset',
      entityId: asset.id,
      actorId: actor?.id ?? null,
      metadata: {
        eventId: event.id,
        kind: asset.kind,
        checksum: asset.checksum,
        via: 'event_approval',
      },
    })

    if (asset.replacesMediaId) {
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.EVENT_MEDIA_REPLACEMENT_APPLIED,
        entityType: 'Event',
        entityId: event.id,
        actorId: actor?.id ?? null,
        metadata: {
          mediaId: asset.id,
          replacedMediaId: asset.replacesMediaId,
          via: 'event_approval',
        },
      })
    }
  }

  return waiting.length
}

/** What each per-picture decision writes. */
const DECISIONS = Object.freeze({
  approve: { to: 'APPROVED', from: ['PENDING', 'REJECTED'], action: AUDIT_ACTIONS.MEDIA_APPROVED },
  reject: { to: 'REJECTED', from: ['PENDING', 'APPROVED'], action: AUDIT_ACTIONS.MEDIA_REJECTED },
})

/** Why a deleted event's pictures take no decision. */
const DELETED_DECISION_SENTENCE = 'This event was deleted.'

/**
 * A moderator's decision on one picture.
 *
 * A compare-and-set on the status read, so two moderators deciding at once
 * produce one decision and the second is told the picture moved. The event's
 * revision is not touched, so an organiser mid-edit is not interrupted.
 *
 * Nobody approves a picture they uploaded (403 `SELF_REVIEW`), and a reviewer
 * who belongs to the event's organisation decides none of its pictures (403
 * `CONFLICT_OF_INTEREST`). A deleted event's pictures take no decision (409
 * `NOT_EDITABLE`).
 *
 * Approving a replacement cover swaps it in (SPEC2-XI X-P): the event row is
 * locked `FOR UPDATE` first, without bumping its revision — the organiser's
 * upload of another replacement locks it too, so the two serialise — then both
 * rows are read again, the old cover and its bytes are removed (none left is
 * tolerated), and the replacement is approved conditionally. A race the
 * database still refuses is 409 `MEDIA_CHANGED`, never a 500.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Options.
 * @param {string} options.mediaId The picture.
 * @param {'approve'|'reject'} options.decision The decision.
 * @param {string|null} [options.reason] Why, required to reject.
 * @param {object} options.actor The moderator.
 * @param {object} [options.storage] The `MediaStorage` adapter; PostgreSQL by default.
 * @returns {Promise<object>} `{ asset, event }`: the picture after the decision and its event.
 * @throws {Error} A 404 for no such picture, a 403 for a reviewer who may not decide it, a 409 when the decision does not apply.
 */
export async function decideMedia(prisma, { mediaId, decision, reason = null, actor, storage }) {
  const media = storage ?? createPostgresMediaStorage(prisma)
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: {
      ...EVENT_MEDIA_SELECT,
      uploadedById: true,
      event: { select: { id: true, status: true, revision: true, organizationId: true } },
    },
  })

  if (!asset || !asset.event) throw notFound('No such picture.')

  if (asset.event.status === 'DELETED') {
    throw httpError(409, 'NOT_EDITABLE', DELETED_DECISION_SENTENCE, { status: 'DELETED' })
  }

  // A reviewer who belongs to the event's organisation does not decide its
  // pictures, and nobody approves a picture they uploaded: somebody else on
  // the team at The Desi Events does. Taking a picture down is not approving it.
  const { exemption } = await assertIndependentReviewer(prisma, {
    actor,
    organizationId: asset.event.organizationId,
    uploadedById: decision === 'approve' ? (asset.uploadedById ?? null) : null,
    // A picture an import copied into the platform-held organisation may be
    // approved by the administrator who imported it (SPEC2-XI O5).
    mediaAssetId: asset.id,
  })

  const rule = DECISIONS[decision]

  if (!rule.from.includes(asset.moderationStatus)) {
    throw httpError(
      409,
      'CONFLICT',
      decision === 'approve'
        ? 'This picture is already approved.'
        : 'This picture has already been taken down.',
      { moderationStatus: asset.moderationStatus },
    )
  }

  if (rule.to === 'APPROVED' && (asset.scanStatus !== 'CLEAN' || !asset.sanitisedAt)) {
    throw httpError(409, 'CONFLICT', 'This picture did not pass the structural check.')
  }

  return budgetedTransaction(prisma, MEDIA_DECISION_BUDGET, async (tx) => {
    /** @type {string|null} */
    let replaced = null

    if (rule.to === 'APPROVED' && asset.replacesMediaId) {
      // The event first, as every writer of its pictures takes it.
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${asset.event.id} FOR UPDATE`

      const current = await tx.mediaAsset.findUnique({
        where: { id: mediaId },
        select: { id: true, moderationStatus: true, replacesMediaId: true },
      })

      if (!current || current.moderationStatus !== asset.moderationStatus) {
        throw httpError(409, 'MEDIA_CHANGED', MEDIA_CHANGED_SENTENCE)
      }

      if (current.replacesMediaId) {
        await removeReplacedCover(tx, media, current.replacesMediaId)
        replaced = current.replacesMediaId
      }
    }

    const { count } = await tx.mediaAsset.updateMany({
      where: { id: mediaId, moderationStatus: asset.moderationStatus },
      data: {
        moderationStatus: rule.to,
        moderatedAt: new Date(),
        moderatedById: actor?.id ?? null,
        moderationNote: rule.to === 'REJECTED' ? reason : null,
        // An approved picture replaces nothing: the cover it pointed at is
        // gone, and the CHECK refuses an approved row that still points.
        ...(rule.to === 'APPROVED' ? { replacesMediaId: null } : {}),
      },
    })

    if (count !== 1) {
      throw httpError(
        409,
        'MEDIA_CHANGED',
        'Somebody else decided on this picture, or it was removed, while you were looking. Reload to see it as it is now.',
      )
    }

    await recordAudit(tx, {
      action: rule.action,
      entityType: 'MediaAsset',
      entityId: mediaId,
      actorId: actor?.id ?? null,
      metadata: {
        eventId: asset.event.id,
        kind: asset.kind,
        checksum: asset.checksum,
        from: asset.moderationStatus,
        to: rule.to,
        // The moderator's reason, as `moderation.decide` records one: it is
        // the note the organiser reads, not a secret and not the picture.
        ...(rule.to === 'REJECTED' ? { reason } : {}),
        // Who imported it and who approved it, when the import exemption
        // let the uploader approve it.
        ...(exemption
          ? {
              exemption,
              importedById: asset.uploadedById ?? null,
              approvedById: actor?.id ?? null,
            }
          : {}),
      },
    })

    if (replaced) {
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.EVENT_MEDIA_REPLACEMENT_APPLIED,
        entityType: 'Event',
        entityId: asset.event.id,
        actorId: actor?.id ?? null,
        metadata: { mediaId, replacedMediaId: replaced },
      })
    }

    const after = await tx.mediaAsset.findUnique({
      where: { id: mediaId },
      select: EVENT_MEDIA_SELECT,
    })

    return { asset: toEventMedia(after, asset.event.status), event: asset.event }
  }).catch(rethrowMediaChanged)
}

/** The statuses whose pictures the queue lists: posted events only. */
const QUEUE_EVENT_STATUSES = Object.freeze([...PUBLICLY_VISIBLE_STATUSES])

/**
 * The pictures of posted events waiting for the team at The Desi Events (or taken
 * down), oldest first, each with its event and whether its organisation
 * uploaded it. Never who uploaded it.
 *
 * A draft's pictures are approved with the event, so they are not here; a
 * deleted event's are not either.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} query The parsed `mediaQueueQuerySchema` value.
 * @returns {Promise<{rows: object[], total: number}>} One page, and how many there are.
 */
export async function listMediaQueue(prisma, query) {
  const { skip, take } = toSkipTake(query)
  const where = {
    moderationStatus: query.status ?? 'PENDING',
    event: { status: { in: QUEUE_EVENT_STATUSES } },
  }

  const [rows, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where,
      select: {
        ...EVENT_MEDIA_SELECT,
        uploadedById: true,
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            organizationId: true,
            organization: { select: { name: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take,
    }),
    prisma.mediaAsset.count({ where }),
  ])

  const uploaders = [...new Set(rows.map((row) => row.uploadedById).filter(Boolean))]
  const memberships =
    uploaders.length === 0
      ? []
      : await prisma.membership.findMany({
          where: { userId: { in: uploaders } },
          select: { userId: true, organizationId: true },
        })
  const member = new Set(memberships.map((row) => `${row.userId}:${row.organizationId}`))

  return {
    total,
    rows: rows.map((row) => ({
      ...toEventMedia(row, row.event.status),
      event: {
        id: row.event.id,
        title: row.event.title,
        slug: row.event.slug,
        status: row.event.status,
        organizationName: row.event.organization?.name ?? '',
      },
      uploadedByOrganiser: Boolean(
        row.uploadedById && member.has(`${row.uploadedById}:${row.event.organizationId}`),
      ),
    })),
  }
}
