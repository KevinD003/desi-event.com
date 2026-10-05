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
 * New pixels — an upload, a replaced cover — only while the event is editable,
 * because every new picture is reviewed with the event. A description and the
 * gallery order may change while it is editable or live. A picture may be
 * removed in every status except the two in which a moderator holds this
 * version, and DELETED, whose pictures are kept for a restore (and so do not
 * count toward the organisation's quota). Every organiser write goes through
 * `authorChange`, so each one takes
 * the event revision as a precondition, bumps it, and is audited in the same
 * transaction.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/lib/event-media
 */

import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'
import {
  MEDIA_ARRANGE_STATUSES,
  MEDIA_LIMITS,
  MEDIA_REMOVE_STATUSES,
  MEDIA_UPLOAD_STATUSES,
} from '@desi-event/schemas/media'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { authorChange } from './event-authoring.js'
import { httpError, notFound } from './errors.js'
import { STRUCTURAL_SCAN_NOTE } from './media-storage.js'
import { assertIndependentReviewer } from './review-independence.js'

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
    select: { id: true, organizationId: true, status: true, revision: true },
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
  'This event was deleted. Its pictures stay as they were, so a restore by the Desi-Event team brings the event back whole.'

/** Why a status refuses each kind of change, in the organiser's words. */
const STATUS_REFUSALS = Object.freeze({
  upload: (status) => {
    if (status === 'DELETED') return DELETED_MEDIA_SENTENCE
    if (status === 'REVIEW_PENDING') {
      return 'This event is waiting for review, so no picture can be added. Withdraw it from review first.'
    }

    return `This event is ${status}. New pictures can be added only while it is a draft or has changes requested, because every new picture is reviewed with the event.`
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
 * "You may not" is a 403; "not in this state" is a 409 `NOT_EDITABLE`.
 *
 * @param {object} event The event, with `organizationId` and `status`.
 * @param {object} actor The request actor.
 * @param {'upload'|'arrange'|'remove'} change The kind of change.
 * @returns {void}
 * @throws {Error} A 403 or a 409.
 */
export function assertMediaChange(event, actor, change) {
  assertCan(actor, CAPABILITIES.EVENT_UPDATE, { organizationId: event.organizationId })

  if (!STATUS_SETS[change].has(event.status)) {
    throw httpError(409, 'NOT_EDITABLE', STATUS_REFUSALS[change](event.status), {
      status: event.status,
    })
  }
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
 * Refuse an upload that would take the organisation past its storage quota.
 *
 * @param {object} client A Prisma client or transaction.
 * @param {string} organizationId The organisation.
 * @param {number} adding Bytes the upload adds (net of anything it replaces).
 * @returns {Promise<void>} Resolves when there is room.
 * @throws {Error} A 409 `MEDIA_QUOTA_EXCEEDED`.
 */
export async function assertQuota(client, organizationId, adding) {
  // A deleted event's pictures are kept for a restore and cannot be removed
  // while it is deleted (`MEDIA_REMOVE_STATUSES`), so they do not count against
  // the room the organisation can free.
  const { _sum: sum } = await client.mediaAsset.aggregate({
    where: { event: { organizationId, status: { not: 'DELETED' } } },
    _sum: { byteSize: true },
  })
  const used = sum?.byteSize ?? 0

  if (used + Math.max(0, adding) > MEDIA_LIMITS.organizationQuotaBytes) {
    throw httpError(
      409,
      'MEDIA_QUOTA_EXCEEDED',
      'Your organisation has used its 1 GB of picture storage. Remove pictures from past events to make room.',
    )
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
 * @returns {Promise<void>} Resolves when the upload may proceed to its body.
 */
export async function gateUpload(prisma, { eventId, actor, kind, declaredBytes }) {
  const event = await loadEventForMedia(prisma, eventId)

  assertMediaChange(event, actor, 'upload')

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
 * Inside one short transaction: the revision bump, the old cover's removal when
 * this is a cover, the gallery and quota checks again, the asset row, its
 * bytes and the audit row. Sanitising happened before, outside it, so nothing
 * slow holds the event row.
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
  const { event, actor, revision, kind, altText, upload } = options

  assertMediaChange(event, actor, 'upload')

  /** @type {object} */
  let created
  /** @type {object|null} */
  let replaced = null

  const updated = await authorChange(prisma, {
    event,
    revision,
    actor,
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
    }),
    write: async (tx) => {
      let position = null

      if (kind === 'EVENT_COVER') {
        replaced = await tx.mediaAsset.findFirst({
          where: { eventId: event.id, kind: 'EVENT_COVER' },
          select: { id: true, storageKey: true, byteSize: true },
        })

        if (replaced) {
          await storage.remove(tx, replaced.storageKey)
          await tx.mediaAsset.delete({ where: { id: replaced.id } })
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
  })

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
 * @returns {Promise<object>} `{ asset, event }`: the picture and the event after the write.
 */
export async function describeEventMedia(prisma, { event, actor, revision, mediaId, altText }) {
  assertMediaChange(event, actor, 'arrange')

  /** @type {object} */
  let described

  const updated = await authorChange(prisma, {
    event,
    revision,
    actor,
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
  })

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
 * @returns {Promise<object>} `{ event }`: the event after the write.
 * @throws {Error} A 409 `GALLERY_CHANGED` when the list is not exactly the current gallery.
 */
export async function reorderEventMedia(prisma, { event, actor, revision, galleryIds }) {
  assertMediaChange(event, actor, 'arrange')

  const updated = await authorChange(prisma, {
    event,
    revision,
    actor,
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
  })

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
 * @returns {Promise<object>} `{ event }`: the event after the write.
 */
export async function removeEventMedia(prisma, storage, { event, actor, revision, mediaId }) {
  assertMediaChange(event, actor, 'remove')

  /** @type {object} */
  let removed

  const updated = await authorChange(prisma, {
    event,
    revision,
    actor,
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
  })

  return { event: updated }
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
    select: { id: true, kind: true, checksum: true },
  })

  if (waiting.length === 0) return 0

  const moderatedAt = new Date()

  await tx.mediaAsset.updateMany({
    where: { id: { in: waiting.map((asset) => asset.id) }, moderationStatus: 'PENDING' },
    data: {
      moderationStatus: 'APPROVED',
      moderatedAt,
      moderatedById: actor?.id ?? null,
      moderationNote: null,
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
  }

  return waiting.length
}

/** What each per-picture decision writes. */
const DECISIONS = Object.freeze({
  approve: { to: 'APPROVED', from: ['PENDING', 'REJECTED'], action: AUDIT_ACTIONS.MEDIA_APPROVED },
  reject: { to: 'REJECTED', from: ['PENDING', 'APPROVED'], action: AUDIT_ACTIONS.MEDIA_REJECTED },
})

/**
 * A moderator's decision on one picture.
 *
 * A compare-and-set on the status read, so two moderators deciding at once
 * produce one decision and the second is told the picture moved. The event's
 * revision is not touched, so an organiser mid-edit is not interrupted.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Options.
 * @param {string} options.mediaId The picture.
 * @param {'approve'|'reject'} options.decision The decision.
 * @param {string|null} [options.reason] Why, required to reject.
 * @param {object} options.actor The moderator.
 * @returns {Promise<object>} `{ asset, event }`: the picture after the decision and its event.
 * @throws {Error} A 404 for no such picture, a 409 when the decision does not apply.
 */
export async function decideMedia(prisma, { mediaId, decision, reason = null, actor }) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: {
      ...EVENT_MEDIA_SELECT,
      event: { select: { id: true, status: true, revision: true, organizationId: true } },
    },
  })

  if (!asset || !asset.event) throw notFound('No such picture.')

  // A reviewer who belongs to the event's organisation does not decide its
  // pictures: somebody else on the Desi-Event team does.
  await assertIndependentReviewer(prisma, {
    actor,
    organizationId: asset.event.organizationId,
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

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.mediaAsset.updateMany({
      where: { id: mediaId, moderationStatus: asset.moderationStatus },
      data: {
        moderationStatus: rule.to,
        moderatedAt: new Date(),
        moderatedById: actor?.id ?? null,
        moderationNote: rule.to === 'REJECTED' ? reason : null,
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
      },
    })

    const after = await tx.mediaAsset.findUnique({
      where: { id: mediaId },
      select: EVENT_MEDIA_SELECT,
    })

    return { asset: toEventMedia(after, asset.event.status), event: asset.event }
  })
}
