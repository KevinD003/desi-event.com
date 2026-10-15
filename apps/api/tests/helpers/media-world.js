/**
 * Seeding pictures straight into the Prisma stub, and building upload
 * requests.
 *
 * The media API tests need events that already hold pictures in particular
 * review states — an approved cover on a published event, a rejected gallery
 * picture, a full gallery — and uploading each through the API would make every
 * serving test depend on the upload path working. So rows are written here the
 * way the upload writes them, bytes included.
 *
 * @module @desi-event/api/tests/helpers/media-world
 */

import { createHash, randomUUID } from 'node:crypto'

import { STRUCTURAL_SCAN_NOTE } from '../../src/lib/media-storage.js'
import { cuid } from './prisma-stub.js'
import { solidPng } from './images.js'

/**
 * Write one picture, and its bytes, into the stub.
 *
 * @param {object} prisma The stub.
 * @param {object} options Options.
 * @param {object} options.event The event row it belongs to.
 * @param {'EVENT_COVER'|'EVENT_GALLERY'} [options.kind] What it is.
 * @param {number|null} [options.position] Gallery position.
 * @param {'PENDING'|'APPROVED'|'REJECTED'} [options.moderationStatus] Review state.
 * @param {Buffer} [options.bytes] The stored bytes; a small PNG by default.
 * @param {string} [options.altText] The description.
 * @param {number} [options.byteSize] Override the recorded size, for quota tests.
 * @returns {object} The asset row.
 */
export function seedPicture(prisma, options) {
  const {
    event,
    kind = 'EVENT_COVER',
    position = kind === 'EVENT_GALLERY' ? 0 : null,
    moderationStatus = 'APPROVED',
    bytes = solidPng(kind === 'EVENT_COVER' ? 960 : 320, kind === 'EVENT_COVER' ? 540 : 320),
    altText = 'Dancers circling a lit garbo',
    byteSize,
  } = options
  const storageKey = `pg/${randomUUID()}`
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const now = new Date()
  const asset = {
    id: cuid(),
    ownerType: 'EVENT',
    ownerId: event.id,
    eventId: event.id,
    kind,
    storageKey,
    contentType: 'image/png',
    byteSize: byteSize ?? bytes.length,
    width: kind === 'EVENT_COVER' ? 960 : 320,
    height: kind === 'EVENT_COVER' ? 540 : 320,
    checksum,
    sanitisedAt: now,
    moderationStatus,
    scanStatus: 'CLEAN',
    scanNote: STRUCTURAL_SCAN_NOTE,
    uploadedById: null,
    altText,
    position,
    moderatedAt: moderationStatus === 'PENDING' ? null : now,
    moderatedById: null,
    moderationNote: moderationStatus === 'REJECTED' ? 'Shows a private home.' : null,
    // A seeded row bypasses the stub's column defaults; a picture replaces nothing.
    replacesMediaId: null,
    createdAt: new Date(now.getTime() + (position ?? 0)),
    updatedAt: now,
  }

  prisma._store.mediaAsset.push(asset)
  prisma._store.mediaBlob.push({
    storageKey,
    bytes,
    byteSize: bytes.length,
    checksum,
    createdAt: now,
  })

  return asset
}

/**
 * The upload URL for an event.
 *
 * @param {string} eventId The event.
 * @param {object} query The query.
 * @param {string} [query.kind] What the picture is for.
 * @param {string} [query.altText] Its description.
 * @param {number|string} [query.revision] The revision read.
 * @returns {string} The path and query string.
 */
export function uploadUrl(
  eventId,
  { kind = 'EVENT_COVER', altText = 'Dancers on stage', revision = 0 } = {},
) {
  const query = new URLSearchParams()

  if (kind !== undefined) query.set('kind', kind)
  if (altText !== undefined) query.set('altText', altText)
  if (revision !== undefined) query.set('revision', String(revision))

  return `/v1/events/${eventId}/media?${query.toString()}`
}
