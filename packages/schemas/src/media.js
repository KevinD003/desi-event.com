/**
 * Event pictures: the limits, the wire shapes, and the byte sniffers.
 *
 * An organiser uploads a cover and up to eight gallery pictures. The API
 * rebuilds each file from its image data alone, stores it in PostgreSQL, and
 * serves it only once a moderator has approved it and the event is public. This
 * module is the part of that the browser and the API share: how big a picture
 * may be, which statuses allow which change, what a picture looks like on the
 * wire, and a pure function that reads the first bytes of a file and says what
 * it really is.
 *
 * Imported by client components as `@desi-event/schemas/media`, a subpath, so
 * the browser never takes the schemas barrel and every entity shape behind it.
 * Nothing here names a storage column or a sanitiser: those are the API's.
 *
 * @module @desi-event/schemas/media
 */

import { z } from 'zod'

import {
  EVENT_STATUSES,
  eventStatusSchema,
  mediaKindSchema,
  mediaModerationStatusSchema,
} from './enums.js'
import { EDITABLE_STATUSES, PUBLICLY_VISIBLE_STATUSES } from './lifecycle.js'
import {
  POSTGRES_INT_MAX,
  cuidSchema,
  paginationQuerySchema,
  revisionPreconditionSchema,
  slugSchema,
  timestampSchema,
} from './primitives.js'

/**
 * What the platform accepts, in one place.
 *
 * - `maxBytes`: one upload, 10 MiB. Enforced by the web proxy before it
 *   buffers, by the API's body parser, and by a database CHECK.
 * - `maxSide` and `maxPixels`: a picture larger than this is refused rather
 *   than decoded. They protect browsers, the image optimiser and the social
 *   preview renderer from a dimension bomb.
 * - `coverMinWidth` × `coverMinHeight`: a cover fills a wide frame, so it has
 *   to be at least 960 × 540. A 1080 × 1350 flyer fits.
 * - `galleryMinSide`: a gallery picture's shorter side.
 * - `galleryMax`: pictures in one event's gallery. Backed by a trigger.
 * - `altTextMax`: characters of description.
 * - `organizationQuotaBytes`: everything one organisation may store, 1 GiB.
 * - `socialEmbedMaxPixels`: a cover larger than this is not embedded in a
 *   social preview; the generated poster is used instead.
 *
 * @type {Readonly<{maxBytes: number, maxSide: number, maxPixels: number, galleryMax: number, coverMinWidth: number, coverMinHeight: number, galleryMinSide: number, altTextMax: number, organizationQuotaBytes: number, socialEmbedMaxPixels: number}>}
 */
export const MEDIA_LIMITS = Object.freeze({
  maxBytes: 10_485_760,
  maxSide: 8000,
  maxPixels: 40_000_000,
  galleryMax: 8,
  coverMinWidth: 960,
  coverMinHeight: 540,
  galleryMinSide: 320,
  altTextMax: 300,
  organizationQuotaBytes: 1_073_741_824,
  socialEmbedMaxPixels: 12_000_000,
})

/**
 * The three picture formats stored. Anything else is refused, whatever the
 * upload's declared type or file name said.
 *
 * @type {ReadonlyArray<string>}
 */
export const MEDIA_CONTENT_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])

/**
 * What an upload may declare as its `Content-Type`. The declaration is only a
 * gate for the body parser: the bytes decide the type.
 *
 * @type {ReadonlyArray<string>}
 */
export const MEDIA_UPLOAD_CONTENT_TYPES = Object.freeze([
  ...MEDIA_CONTENT_TYPES,
  'application/octet-stream',
])

/**
 * How long a public picture may be cached, in seconds: one day.
 *
 * Not a year. A moderator's takedown has to leave browsers, the image
 * optimiser's cache and social previews, and a day bounds how long a picture
 * somebody already had can outlive the decision.
 *
 * @type {number}
 */
export const PUBLIC_MEDIA_MAX_AGE_SECONDS = 86_400

/**
 * Statuses in which a new picture may be uploaded, or a cover replaced: while
 * the event is editable, and once it is posted (publicly visible: live,
 * finished or cancelled).
 *
 * No new pixels reach a public page without a review. On a draft every new
 * picture is reviewed with the event. On a posted event each new picture is
 * stored waiting for approval by the team at The Desi Events and is not shown
 * until somebody other than its uploader approves it; a new cover waits beside the
 * current one, which stays public until the new one is approved (SPEC2-XI X-3).
 * Not while a moderator holds this version (REVIEW_PENDING, APPROVED), nor
 * once it is rejected, archived or deleted.
 *
 * @type {ReadonlySet<string>}
 */
export const MEDIA_UPLOAD_STATUSES = Object.freeze(
  new Set([...EDITABLE_STATUSES, ...PUBLICLY_VISIBLE_STATUSES]),
)

/**
 * Statuses in which a picture's description and order may change: the same as
 * {@link MEDIA_UPLOAD_STATUSES}, so a finished or cancelled event's pictures
 * can still be described and reordered.
 *
 * @type {ReadonlySet<string>}
 */
export const MEDIA_ARRANGE_STATUSES = Object.freeze(
  new Set([...EDITABLE_STATUSES, ...PUBLICLY_VISIBLE_STATUSES]),
)

/**
 * Statuses in which a picture may be removed: every one except the two in
 * which a moderator holds this version of the event, and DELETED, whose
 * pictures stay as they were so a restore brings the event back whole (and a
 * deleted event's pictures do not count toward the storage quota). Removal
 * stays open for a completed, cancelled or archived event so the quota can
 * always be freed.
 *
 * @type {ReadonlySet<string>}
 */
export const MEDIA_REMOVE_STATUSES = Object.freeze(
  new Set(
    EVENT_STATUSES.filter(
      (status) => status !== 'REVIEW_PENDING' && status !== 'APPROVED' && status !== 'DELETED',
    ),
  ),
)

/** A media URL as the API writes it: the asset id and nothing else. */
export const MEDIA_URL_PATTERN = /^\/v1\/media\/[a-z][a-z0-9]{7,31}$/

/**
 * View any byte source as a `Uint8Array` without copying it.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayLike<number>} bytes The bytes.
 * @returns {Uint8Array} A view over them.
 */
function asBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  return Uint8Array.from(bytes ?? [])
}

/**
 * Whether `bytes` holds `ascii` starting at `offset`.
 *
 * @param {Uint8Array} bytes The bytes.
 * @param {number} offset Where to look.
 * @param {string} ascii The expected characters.
 * @returns {boolean} True on a match.
 */
function hasAscii(bytes, offset, ascii) {
  if (offset + ascii.length > bytes.length) return false

  for (let index = 0; index < ascii.length; index += 1) {
    if (bytes[offset + index] !== ascii.charCodeAt(index)) return false
  }

  return true
}

/** ISO base-media brands that mean HEIF/HEIC. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

/** ISO base-media brands that mean AVIF. */
const AVIF_BRANDS = new Set(['avif', 'avis'])

/**
 * What a file really is, read from its first 32 bytes.
 *
 * Pure and cheap, so the browser can run it on a chosen file before uploading
 * and the API can run it before parsing. `type` is one of the three stored
 * formats or null; when it is null, `looksLike` names the common format the
 * bytes resemble, so a refusal can say "this is an SVG" rather than "no".
 *
 * The declared type and the file name are never consulted. A file called
 * `cover.png` that begins `<svg` is an SVG.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayLike<number>} input The file's leading bytes (more are ignored).
 * @returns {{type: 'image/jpeg'|'image/png'|'image/webp'|null, looksLike: 'svg'|'html'|'gif'|'heic'|'avif'|'pdf'|'bmp'|'tiff'|'zip'|null}} The verdict.
 */
export function sniffImageType(input) {
  const all = asBytes(input)
  const bytes = all.subarray(0, Math.min(all.length, 32))

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: 'image/jpeg', looksLike: null }
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    hasAscii(bytes, 1, 'PNG') &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { type: 'image/png', looksLike: null }
  }

  if (hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')) {
    return { type: 'image/webp', looksLike: null }
  }

  return { type: null, looksLike: resemblance(bytes) }
}

/**
 * Which refused format some leading bytes resemble, if any.
 *
 * @param {Uint8Array} bytes At most 32 leading bytes.
 * @returns {'svg'|'html'|'gif'|'heic'|'avif'|'pdf'|'bmp'|'tiff'|'zip'|null} The resemblance.
 */
function resemblance(bytes) {
  if (hasAscii(bytes, 0, 'GIF87a') || hasAscii(bytes, 0, 'GIF89a')) return 'gif'
  if (hasAscii(bytes, 0, '%PDF-')) return 'pdf'
  if (hasAscii(bytes, 0, 'PK') && bytes.length >= 4 && bytes[2] < 0x09 && bytes[3] < 0x09) {
    return 'zip'
  }
  if (hasAscii(bytes, 0, 'II') && bytes[2] === 0x2a && bytes[3] === 0x00) return 'tiff'
  if (hasAscii(bytes, 0, 'MM') && bytes[2] === 0x00 && bytes[3] === 0x2a) return 'tiff'

  if (hasAscii(bytes, 4, 'ftyp') && bytes.length >= 12) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12))

    if (AVIF_BRANDS.has(brand)) return 'avif'
    if (HEIC_BRANDS.has(brand)) return 'heic'
  }

  if (hasAscii(bytes, 0, 'BM') && bytes.length >= 14) return 'bmp'

  // Text formats: skip a byte-order mark and leading whitespace, then read
  // case-insensitively. Only ASCII matters for the markers being looked for.
  let start = 0

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3

  while (start < bytes.length && [0x09, 0x0a, 0x0d, 0x20].includes(bytes[start])) start += 1

  const text = String.fromCharCode(...bytes.subarray(start)).toLowerCase()

  if (text.startsWith('<svg') || text.startsWith('<?xml') || text.includes('<svg')) return 'svg'

  if (
    text.startsWith('<!doctype html') ||
    text.startsWith('<html') ||
    text.startsWith('<head') ||
    text.startsWith('<body') ||
    text.startsWith('<script') ||
    text.startsWith('<!--')
  ) {
    return 'html'
  }

  return null
}

/** The most IFD entries read before giving up: a real IFD0 has a few dozen. */
const MAX_IFD_ENTRIES = 256

/**
 * The EXIF Orientation value in one APP1 payload, if it carries one.
 *
 * Reads only IFD0, only tag 0x0112, and never follows a pointer out of the
 * segment. Returns `undefined` rather than null when the payload is not EXIF at
 * all, so a caller walking every APP1 can tell "no EXIF here" from "EXIF with
 * no orientation".
 *
 * @param {Uint8Array|ArrayBuffer|ArrayLike<number>} input The APP1 payload, starting at `Exif\0\0`.
 * @returns {number|null|undefined} 1–8, null for EXIF without a usable value, undefined for a payload that is not EXIF.
 */
export function exifOrientation(input) {
  const payload = asBytes(input)

  if (!hasAscii(payload, 0, 'Exif') || payload[4] !== 0 || payload[5] !== 0) return undefined

  const tiff = 6

  if (payload.length < tiff + 8) return null

  let little

  if (payload[tiff] === 0x49 && payload[tiff + 1] === 0x49) little = true
  else if (payload[tiff] === 0x4d && payload[tiff + 1] === 0x4d) little = false
  else return null

  const u16 = (at) =>
    at + 2 > payload.length
      ? null
      : little
        ? payload[at] | (payload[at + 1] << 8)
        : (payload[at] << 8) | payload[at + 1]
  const u32 = (at) =>
    at + 4 > payload.length
      ? null
      : little
        ? (payload[at] | (payload[at + 1] << 8) | (payload[at + 2] << 16)) +
          payload[at + 3] * 0x1000000
        : payload[at] * 0x1000000 +
          ((payload[at + 1] << 16) | (payload[at + 2] << 8) | payload[at + 3])

  if (u16(tiff + 2) !== 42) return null

  const ifd = u32(tiff + 4)

  if (ifd === null || ifd < 8) return null

  const count = u16(tiff + ifd)

  if (count === null) return null

  for (let entry = 0; entry < Math.min(count, MAX_IFD_ENTRIES); entry += 1) {
    const at = tiff + ifd + 2 + entry * 12

    if (at + 12 > payload.length) return null

    if (u16(at) !== 0x0112) continue

    // SHORT, one value, stored in the first two bytes of the value field.
    if (u16(at + 2) !== 3 || u32(at + 4) !== 1) return null

    const value = u16(at + 8)

    return value !== null && value >= 1 && value <= 8 ? value : null
  }

  return null
}

/** The most JPEG segments walked looking for EXIF before giving up. */
const MAX_JPEG_SEGMENTS = 512

/**
 * The EXIF Orientation of a JPEG, or null when it has none.
 *
 * Walks the marker segments up to the first scan, bounded and without
 * recursion, and reads the first EXIF APP1 it meets. Used by the social preview
 * renderer, which can embed only an upright JPEG.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayLike<number>} input The whole JPEG.
 * @returns {number|null} 1–8, or null.
 */
export function readJpegOrientation(input) {
  const bytes = asBytes(input)

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let offset = 2

  for (let segments = 0; segments < MAX_JPEG_SEGMENTS; segments += 1) {
    if (offset + 2 > bytes.length || bytes[offset] !== 0xff) return null

    // Fill bytes: any number of 0xFF may precede a marker.
    while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) offset += 1

    if (offset + 2 > bytes.length) return null

    const marker = bytes[offset + 1]

    if (marker === 0xda || marker === 0xd9) return null

    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2
      continue
    }

    if (offset + 4 > bytes.length) return null

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]

    if (length < 2 || offset + 2 + length > bytes.length) return null

    if (marker === 0xe1) {
      const found = exifOrientation(bytes.subarray(offset + 4, offset + 2 + length))

      if (found !== undefined) return found
    }

    offset += 2 + length
  }

  return null
}

/** Control characters (C0, DEL and C1) that survive whitespace collapsing. */
const CONTROL_CHARACTERS = /\p{Cc}/u

/** A description that is really a file name. */
const FILE_NAME_ALT = [
  /\.(jpe?g|png|webp|heic|gif)$/iu,
  /^(img|dsc|image|photo|screenshot)[\s_-]?\d+$/iu,
]

/**
 * Normalise alt text: Unicode NFC, runs of whitespace (newlines included) as
 * one space, trimmed.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} The normalised string, or `value` unchanged.
 */
function normaliseAltText(value) {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, ' ').trim() : value
}

/**
 * A picture's description, as a screen reader reads it and as the public page
 * shows it. Required for every event picture, because a picture without one is
 * a blank to somebody who cannot see it.
 */
export const altTextSchema = z.preprocess(
  normaliseAltText,
  z
    .string()
    .min(1, 'Describe the picture.')
    .max(MEDIA_LIMITS.altTextMax, `Keep the description to ${MEDIA_LIMITS.altTextMax} characters.`)
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: 'The description contains a control character.',
    })
    .refine((value) => !FILE_NAME_ALT.some((pattern) => pattern.test(value)), {
      message: 'Describe what the picture shows, not its file name.',
    }),
)

/**
 * A revision number carried in a query string.
 *
 * Only plain decimal digits become a number. An empty string is refused, where
 * `z.coerce` would have turned it into 0, and so are `03`, `3.0` and ` 3`: a
 * revision is a precondition, and a precondition read loosely is not one.
 * Normalised in `z.preprocess`, the house convention, so the document says
 * "integer".
 */
export const revisionQueryParamSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && /^(0|[1-9]\d{0,9})$/u.test(value) ? Number(value) : value,
  z.int().min(0).max(POSTGRES_INT_MAX),
)

/** `POST /v1/events/:id/media` query: what the picture is, what it shows, and the revision read. */
export const uploadEventMediaQuerySchema = z
  .object({
    kind: mediaKindSchema,
    altText: altTextSchema,
    revision: revisionQueryParamSchema,
  })
  .strict()

/** `PATCH /v1/events/:id/media/:mediaId`: a new description. */
export const updateEventMediaRequestSchema = z
  .object({
    revision: revisionPreconditionSchema,
    altText: altTextSchema,
  })
  .strict()

/** `PUT /v1/events/:id/media/order`: every gallery picture, in the new order. */
export const reorderEventMediaRequestSchema = z
  .object({
    revision: revisionPreconditionSchema,
    galleryIds: z
      .array(cuidSchema)
      .min(1)
      .max(MEDIA_LIMITS.galleryMax)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Name each picture once.',
      }),
  })
  .strict()

/** `DELETE /v1/events/:id/media/:mediaId` query: the revision read. */
export const removeEventMediaQuerySchema = z
  .object({
    revision: revisionQueryParamSchema,
  })
  .strict()

/** Path parameters naming one picture of one event. */
export const eventMediaParamSchema = z.object({ id: cuidSchema, mediaId: cuidSchema })

/** `POST /v1/moderation/media/:id/decision`: approve, or take down with a reason. */
export const moderateMediaRequestSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === 'reject' && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Say why the picture is being taken down; the organiser reads this.',
      })
    }
  })

/**
 * A picture as a public page receives it: where to fetch it, what it shows,
 * and its size. The URL is same-origin and names the asset id only.
 */
export const publicMediaSchema = z.object({
  id: cuidSchema,
  url: z.string().regex(MEDIA_URL_PATTERN),
  altText: z.string().min(1).max(MEDIA_LIMITS.altTextMax),
  width: z.int().min(1).max(MEDIA_LIMITS.maxSide),
  height: z.int().min(1).max(MEDIA_LIMITS.maxSide),
  contentType: z.enum([...MEDIA_CONTENT_TYPES]),
})

/**
 * A picture as its organiser and a moderator see it. Carries its review state
 * and, for a picture taken down, the reason the moderator gave, and
 * deliberately nothing about where the bytes are kept, how they were checked,
 * or who uploaded them.
 *
 * The reason is `rejectionReason` on the wire although the column is
 * `MediaAsset.moderationNote`: this module ships to the organiser's browser,
 * and `moderationNote` is the name of the event's private moderator note,
 * which the browser-bundle scan forbids. The two must not share a name a scan
 * could confuse.
 */
export const eventMediaSchema = publicMediaSchema.extend({
  kind: mediaKindSchema,
  position: z
    .int()
    .min(0)
    .max(MEDIA_LIMITS.galleryMax - 1)
    .nullable(),
  byteSize: z.int().min(1).max(MEDIA_LIMITS.maxBytes),
  checksum: z.string().regex(/^[0-9a-f]{64}$/u),
  moderationStatus: mediaModerationStatusSchema,
  rejectionReason: z.string().max(1000).nullable(),
  publiclyVisible: z.boolean(),
  /**
   * For a cover uploaded to a posted event: the current cover it would
   * replace once the team at The Desi Events approves it. The current cover stays
   * public until then. Null for every other picture.
   */
  replacesMediaId: cuidSchema.nullable().default(null),
  createdAt: timestampSchema,
})

/**
 * `GET /v1/events/:id/media` and the list-returning writes: the cover, a
 * replacement cover waiting for approval, and the gallery.
 */
export const eventMediaListResponseSchema = z.object({
  data: z.array(eventMediaSchema).max(MEDIA_LIMITS.galleryMax + 2),
  meta: z.object({ revision: z.int().min(0) }),
})

/** One picture, after a write. `removed` lists what the upload was stripped of. */
export const eventMediaResponseSchema = z.object({
  data: eventMediaSchema,
  meta: z.object({
    revision: z.int().min(0),
    removed: z.array(z.string().max(120)).max(10).optional(),
  }),
})

/**
 * `GET /v1/moderation/media`: the pictures of posted events waiting for the team
 * at The Desi Events (PENDING, the default) or taken down (REJECTED), oldest
 * first.
 */
export const mediaQueueQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'REJECTED']).default('PENDING'),
})

/**
 * One picture in the queue, with the event it belongs to. Who uploaded it is
 * never named: `uploadedByOrganiser` is false when the team at The Desi Events uploaded
 * it in an editing sitting (or the uploader has since left the organisation),
 * and nobody approves a picture they uploaded themselves.
 */
export const mediaQueueItemSchema = eventMediaSchema.extend({
  event: z.object({
    id: cuidSchema,
    title: z.string(),
    slug: slugSchema,
    status: eventStatusSchema,
    organizationName: z.string(),
  }),
  uploadedByOrganiser: z.boolean(),
})

/** `GET /v1/media/:id`: the picture's bytes. Documentation only. */
export const mediaBytesSchema = z.string().describe('The picture bytes; see Content-Type.')
