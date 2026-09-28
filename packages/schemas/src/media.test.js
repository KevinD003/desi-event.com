import { describe, expect, it } from 'vitest'

import {
  MEDIA_ARRANGE_STATUSES,
  MEDIA_CONTENT_TYPES,
  MEDIA_LIMITS,
  MEDIA_REMOVE_STATUSES,
  MEDIA_UPLOAD_STATUSES,
  PUBLIC_MEDIA_MAX_AGE_SECONDS,
  altTextSchema,
  eventMediaListResponseSchema,
  eventMediaResponseSchema,
  eventMediaSchema,
  exifOrientation,
  moderateMediaRequestSchema,
  publicMediaSchema,
  readJpegOrientation,
  removeEventMediaQuerySchema,
  reorderEventMediaRequestSchema,
  revisionQueryParamSchema,
  sniffImageType,
  updateEventMediaRequestSchema,
  uploadEventMediaQuerySchema,
} from './media.js'
import { EVENT_STATUSES } from './enums.js'
import { moderationDecisionRequestSchema } from './requests.js'
import { ticketDetailResponseSchema, walletTicketSchema } from './responses.js'

const MEDIA_ID = 'cmedia0000000000000000001'

/**
 * Bytes from a mix of numbers and ASCII strings.
 *
 * @param {...(number|string|number[])} parts The parts.
 * @returns {Uint8Array} The bytes.
 */
function bytesOf(...parts) {
  const out = []

  for (const part of parts) {
    if (typeof part === 'string') for (const char of part) out.push(char.charCodeAt(0))
    else if (Array.isArray(part)) out.push(...part)
    else out.push(part)
  }

  return Uint8Array.from(out)
}

/**
 * An EXIF APP1 payload holding IFD0 with the given entries.
 *
 * @param {{little?: boolean, entries?: Array<number[]>}} options Byte order and `[tag, type, count, value]` entries.
 * @returns {number[]} The payload, starting at `Exif\0\0`.
 */
function exifPayload({ little = false, entries = [] } = {}) {
  const u16 = (value) => (little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff])
  const u32 = (value) =>
    little
      ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
      : [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]

  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8)]
  const ifd = [...u16(entries.length)]

  for (const [tag, type, count, value] of entries) {
    ifd.push(...u16(tag), ...u16(type), ...u32(count), ...u16(value), 0, 0)
  }

  ifd.push(...u32(0))

  return [...bytesOf('Exif', 0, 0), ...tiff, ...ifd]
}

/**
 * A JPEG with the given segments between SOI and a stub scan.
 *
 * @param {...number[]} segments Complete segments, markers included.
 * @returns {Uint8Array} The file.
 */
function jpegWith(...segments) {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])
}

/**
 * An APPn segment.
 *
 * @param {number} marker The marker's second byte.
 * @param {number[]} payload The payload.
 * @returns {number[]} The segment.
 */
function segment(marker, payload) {
  const length = payload.length + 2

  return [0xff, marker, length >> 8, length & 0xff, ...payload]
}

describe('MEDIA_LIMITS and the status sets', () => {
  it('names the limits the design sets', () => {
    expect(MEDIA_LIMITS).toMatchObject({
      maxBytes: 10 * 1024 * 1024,
      maxSide: 8000,
      maxPixels: 40_000_000,
      galleryMax: 8,
      coverMinWidth: 960,
      coverMinHeight: 540,
      galleryMinSide: 320,
      altTextMax: 300,
      organizationQuotaBytes: 1024 * 1024 * 1024,
    })
    expect(Object.isFrozen(MEDIA_LIMITS)).toBe(true)
    expect(MEDIA_CONTENT_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
    expect(PUBLIC_MEDIA_MAX_AGE_SECONDS).toBe(86_400)
  })

  it('adds new pixels only while the event is editable', () => {
    expect([...MEDIA_UPLOAD_STATUSES].sort()).toEqual(['CHANGES_REQUIRED', 'DRAFT'])
  })

  it('arranges while editable or live, never in review or after the end', () => {
    for (const status of ['DRAFT', 'CHANGES_REQUIRED', 'PUBLISHED', 'ON_SALE', 'POSTPONED']) {
      expect(MEDIA_ARRANGE_STATUSES.has(status), status).toBe(true)
    }
    for (const status of ['REVIEW_PENDING', 'APPROVED', 'CANCELLED', 'COMPLETED', 'ARCHIVED']) {
      expect(MEDIA_ARRANGE_STATUSES.has(status), status).toBe(false)
    }
  })

  it('removes in every status but the two a moderator holds', () => {
    expect(MEDIA_REMOVE_STATUSES.has('REVIEW_PENDING')).toBe(false)
    expect(MEDIA_REMOVE_STATUSES.has('APPROVED')).toBe(false)
    expect(MEDIA_REMOVE_STATUSES.size).toBe(EVENT_STATUSES.length - 2)
    expect(MEDIA_REMOVE_STATUSES.has('ARCHIVED')).toBe(true)
    expect(MEDIA_REMOVE_STATUSES.has('CANCELLED')).toBe(true)
  })
})

describe('altTextSchema', () => {
  it('normalises to NFC and collapses whitespace, newlines included', () => {
    const decomposed = 'Café dancers'
    expect(altTextSchema.parse(decomposed)).toBe('Café dancers')
    expect(altTextSchema.parse('  Dancers\n\n circling\ta   garbo  ')).toBe(
      'Dancers circling a garbo',
    )
  })

  it('accepts 1 to 300 characters after normalising', () => {
    expect(altTextSchema.safeParse('A').success).toBe(true)
    expect(altTextSchema.safeParse('a'.repeat(300)).success).toBe(true)
    expect(altTextSchema.safeParse('a'.repeat(301)).success).toBe(false)
    expect(altTextSchema.safeParse('').success).toBe(false)
    expect(altTextSchema.safeParse('   \n  ').success).toBe(false)
    expect(altTextSchema.safeParse(undefined).success).toBe(false)
  })

  it('refuses a control character that is not whitespace', () => {
    expect(altTextSchema.safeParse('Dancers\u0000 on stage').success).toBe(false)
    expect(altTextSchema.safeParse('Dancers\u007F on stage').success).toBe(false)
    expect(altTextSchema.safeParse('Dancers\u009B on stage').success).toBe(false)
  })

  it.each(['IMG_1234.jpg', 'cover.png', 'DSC-0042', 'photo 12', 'Screenshot_7', 'poster.WEBP'])(
    'refuses the file name %s with a sentence that says why',
    (value) => {
      const result = altTextSchema.safeParse(value)

      expect(result.success).toBe(false)
      expect(result.error.issues[0].message).toBe(
        'Describe what the picture shows, not its file name.',
      )
    },
  )

  it('accepts a description that merely mentions a photo', () => {
    expect(altTextSchema.safeParse('Photo of the stage at dusk').success).toBe(true)
  })
})

describe('revisionQueryParamSchema', () => {
  it('turns plain decimal digits into a number', () => {
    expect(revisionQueryParamSchema.parse('3')).toBe(3)
    expect(revisionQueryParamSchema.parse('0')).toBe(0)
    expect(revisionQueryParamSchema.parse('2147483647')).toBe(2_147_483_647)
  })

  it.each(['', ' 3', '03', '3.0', '-1', 'abc', '2147483648', '99999999999'])(
    'refuses %j rather than reading it loosely',
    (value) => {
      expect(revisionQueryParamSchema.safeParse(value).success).toBe(false)
    },
  )
})

describe('request schemas', () => {
  it('reads an upload query with kind, alt text and revision', () => {
    expect(
      uploadEventMediaQuerySchema.parse({
        kind: 'EVENT_COVER',
        altText: ' Dancers circling a lit garbo ',
        revision: '4',
      }),
    ).toEqual({ kind: 'EVENT_COVER', altText: 'Dancers circling a lit garbo', revision: 4 })
  })

  it('refuses an upload query with an unknown key, kind, or no alt text', () => {
    expect(
      uploadEventMediaQuerySchema.safeParse({
        kind: 'EVENT_COVER',
        altText: 'Stage',
        revision: '1',
        url: 'https://elsewhere.test/a.png',
      }).success,
    ).toBe(false)
    expect(
      uploadEventMediaQuerySchema.safeParse({ kind: 'AVATAR', altText: 'Stage', revision: '1' })
        .success,
    ).toBe(false)
    expect(
      uploadEventMediaQuerySchema.safeParse({ kind: 'EVENT_GALLERY', revision: '1' }).success,
    ).toBe(false)
  })

  it('reads a remove query and a describe body', () => {
    expect(removeEventMediaQuerySchema.parse({ revision: '7' })).toEqual({ revision: 7 })
    expect(removeEventMediaQuerySchema.safeParse({}).success).toBe(false)
    expect(
      updateEventMediaRequestSchema.parse({ revision: 2, altText: 'The band at soundcheck' }),
    ).toEqual({ revision: 2, altText: 'The band at soundcheck' })
    expect(updateEventMediaRequestSchema.safeParse({ revision: 2 }).success).toBe(false)
  })

  it('requires a reorder to name 1 to 8 distinct pictures', () => {
    expect(
      reorderEventMediaRequestSchema.safeParse({ revision: 1, galleryIds: [MEDIA_ID] }).success,
    ).toBe(true)
    expect(reorderEventMediaRequestSchema.safeParse({ revision: 1, galleryIds: [] }).success).toBe(
      false,
    )
    expect(
      reorderEventMediaRequestSchema.safeParse({ revision: 1, galleryIds: [MEDIA_ID, MEDIA_ID] })
        .success,
    ).toBe(false)
    const nine = Array.from({ length: 9 }, (_, index) => `cmedia00000000000000000${10 + index}`)
    expect(
      reorderEventMediaRequestSchema.safeParse({ revision: 1, galleryIds: nine }).success,
    ).toBe(false)
  })

  it('requires a reason to take a picture down, and none to approve one', () => {
    const refused = moderateMediaRequestSchema.safeParse({ decision: 'reject' })

    expect(refused.success).toBe(false)
    expect(refused.error.issues[0].path).toEqual(['reason'])
    expect(
      moderateMediaRequestSchema.safeParse({ decision: 'reject', reason: '   ' }).success,
    ).toBe(false)
    expect(
      moderateMediaRequestSchema.safeParse({ decision: 'reject', reason: 'Shows a face' }).success,
    ).toBe(true)
    expect(moderateMediaRequestSchema.safeParse({ decision: 'approve' }).success).toBe(true)
    expect(moderateMediaRequestSchema.safeParse({ decision: 'delete' }).success).toBe(false)
  })

  it('lets an event decision name the revision the moderator reviewed, optionally', () => {
    expect(moderationDecisionRequestSchema.parse({ decision: 'approve', revision: 7 })).toEqual({
      decision: 'approve',
      revision: 7,
    })
    expect(moderationDecisionRequestSchema.safeParse({ decision: 'approve' }).success).toBe(true)

    for (const revision of [-1, 1.5, '7', null]) {
      expect(
        moderationDecisionRequestSchema.safeParse({ decision: 'approve', revision }).success,
      ).toBe(false)
    }
  })
})

describe('response schemas', () => {
  const picture = {
    id: MEDIA_ID,
    url: `/v1/media/${MEDIA_ID}`,
    altText: 'Dancers circling a lit garbo',
    width: 1200,
    height: 630,
    contentType: 'image/png',
  }

  it('accepts a same-origin media url and refuses any other', () => {
    expect(publicMediaSchema.safeParse(picture).success).toBe(true)
    expect(
      publicMediaSchema.safeParse({ ...picture, url: 'https://cdn.example/cover.png' }).success,
    ).toBe(false)
    expect(publicMediaSchema.safeParse({ ...picture, url: '/v1/media/../secret' }).success).toBe(
      false,
    )
    expect(publicMediaSchema.safeParse({ ...picture, contentType: 'image/svg+xml' }).success).toBe(
      false,
    )
  })

  it('strips what the organiser view must never carry', () => {
    const parsed = eventMediaSchema.parse({
      ...picture,
      kind: 'EVENT_COVER',
      position: null,
      byteSize: 4096,
      checksum: 'a'.repeat(64),
      moderationStatus: 'PENDING',
      rejectionReason: null,
      publiclyVisible: false,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      // The column's own name, which the browser-bundle scan reserves for the
      // event's private moderator note, never reaches the wire.
      moderationNote: 'column name',
      ['storage' + 'Key']: 'pg/secret',
      scanNote: 'structural',
      uploadedById: 'cuser000000000000000000001',
    })

    expect(Object.keys(parsed).sort()).toEqual(
      [
        'altText',
        'byteSize',
        'checksum',
        'contentType',
        'createdAt',
        'height',
        'id',
        'kind',
        'moderationStatus',
        'position',
        'publiclyVisible',
        'rejectionReason',
        'url',
        'width',
      ].sort(),
    )
    expect(parsed.createdAt).toBe('2026-09-01T10:00:00.000Z')
  })

  it('caps a list at a cover and eight gallery pictures', () => {
    const row = eventMediaSchema.parse({
      ...picture,
      kind: 'EVENT_GALLERY',
      position: 0,
      byteSize: 1,
      checksum: 'b'.repeat(64),
      moderationStatus: 'APPROVED',
      rejectionReason: null,
      publiclyVisible: true,
      createdAt: '2026-09-01T10:00:00Z',
    })

    expect(
      eventMediaListResponseSchema.safeParse({ data: Array(9).fill(row), meta: { revision: 1 } })
        .success,
    ).toBe(true)
    expect(
      eventMediaListResponseSchema.safeParse({ data: Array(10).fill(row), meta: { revision: 1 } })
        .success,
    ).toBe(false)
    expect(
      eventMediaResponseSchema.parse({ data: row, meta: { revision: 2, removed: ['text notes'] } })
        .meta.removed,
    ).toEqual(['text notes'])
  })

  it('puts the cover on the wallet event and the ticket-detail event', () => {
    const walletEvent = walletTicketSchema.shape.event

    expect(walletEvent.shape.coverImage.safeParse(picture).success).toBe(true)
    expect(walletEvent.shape.coverImage.safeParse(null).success).toBe(true)

    const detailEvent = ticketDetailResponseSchema.shape.data.shape.event

    expect(detailEvent.shape.coverImage.safeParse(picture).success).toBe(true)
    expect(
      detailEvent.shape.coverImage.safeParse({ ...picture, url: 'https://elsewhere.test/a.png' })
        .success,
    ).toBe(false)
  })
})

describe('sniffImageType', () => {
  const cases = [
    ['a JPEG', bytesOf(0xff, 0xd8, 0xff, 0xe0, 0, 16, 'JFIF'), 'image/jpeg', null],
    ['a PNG', bytesOf(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 'IHDR'), 'image/png', null],
    ['a WebP', bytesOf('RIFF', 0x20, 0, 0, 0, 'WEBP', 'VP8 '), 'image/webp', null],
    ['an SVG', bytesOf('<svg xmlns="http://www.w3.org/2000/svg">'), null, 'svg'],
    ['an SVG behind a BOM and whitespace', bytesOf(0xef, 0xbb, 0xbf, '\n  <svg>'), null, 'svg'],
    ['an XML prologue', bytesOf('<?xml version="1.0"?><svg>'), null, 'svg'],
    ['HTML', bytesOf('<!DOCTYPE html><html>'), null, 'html'],
    ['a script', bytesOf('<script>alert(1)</script>'), null, 'html'],
    ['a GIF', bytesOf('GIF89a', 1, 0, 1, 0), null, 'gif'],
    ['a HEIC', bytesOf(0, 0, 0, 24, 'ftyp', 'heic', 0, 0, 0, 0), null, 'heic'],
    ['an AVIF', bytesOf(0, 0, 0, 24, 'ftyp', 'avif', 0, 0, 0, 0), null, 'avif'],
    ['a PDF', bytesOf('%PDF-1.7\n'), null, 'pdf'],
    ['a BMP', bytesOf('BM', 0x36, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0), null, 'bmp'],
    ['a little-endian TIFF', bytesOf('II', 0x2a, 0), null, 'tiff'],
    ['a big-endian TIFF', bytesOf('MM', 0, 0x2a), null, 'tiff'],
    ['a ZIP', bytesOf('PK', 3, 4, 20, 0), null, 'zip'],
    ['nothing at all', new Uint8Array(0), null, null],
    ['random text', bytesOf('hello world'), null, null],
    ['a RIFF that is not WebP', bytesOf('RIFF', 0, 0, 0, 0, 'WAVE'), null, null],
  ]

  it.each(cases)('reads %s', (_name, bytes, type, looksLike) => {
    expect(sniffImageType(bytes)).toEqual({ type, looksLike })
  })

  it('reads only the first 32 bytes', () => {
    const late = new Uint8Array(64)

    late.set(bytesOf('<svg>'), 40)
    expect(sniffImageType(late)).toEqual({ type: null, looksLike: null })
  })

  it('takes an ArrayBuffer or a Node Buffer as well as a Uint8Array', () => {
    const png = bytesOf(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)

    expect(sniffImageType(png.buffer).type).toBe('image/png')
    expect(sniffImageType(Buffer.from(png)).type).toBe('image/png')
  })

  it('ignores what a file calls itself: bytes decide', () => {
    // A file named cover.png, declared image/png, whose bytes are an SVG.
    expect(sniffImageType(new TextEncoder().encode('<svg><script>x()</script></svg>')).type).toBe(
      null,
    )
  })
})

describe('readJpegOrientation and exifOrientation', () => {
  it.each([false, true])('reads orientation 6 from IFD0 (little-endian: %s)', (little) => {
    const jpeg = jpegWith(
      segment(0xe0, bytesOf('JFIF', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0)),
      segment(0xe1, exifPayload({ little, entries: [[0x0112, 3, 1, 6]] })),
    )

    expect(readJpegOrientation(jpeg)).toBe(6)
  })

  it('skips an XMP APP1 and finds the EXIF one after it', () => {
    const jpeg = jpegWith(
      segment(0xe1, [...bytesOf('http://ns.adobe.com/xap/1.0/', 0), ...bytesOf('<x/>')]),
      segment(
        0xe1,
        exifPayload({
          entries: [
            [0x0110, 2, 4, 0],
            [0x0112, 3, 1, 3],
          ],
        }),
      ),
    )

    expect(readJpegOrientation(jpeg)).toBe(3)
  })

  it('answers null for no EXIF, an out-of-range value, a wrong type, or a truncated file', () => {
    expect(readJpegOrientation(jpegWith())).toBeNull()
    expect(
      readJpegOrientation(jpegWith(segment(0xe1, exifPayload({ entries: [[0x0112, 3, 1, 9]] })))),
    ).toBeNull()
    expect(
      readJpegOrientation(jpegWith(segment(0xe1, exifPayload({ entries: [[0x0112, 4, 1, 6]] })))),
    ).toBeNull()
    expect(readJpegOrientation(bytesOf(0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00))).toBeNull()
    expect(readJpegOrientation(bytesOf(0x89, 'PNG'))).toBeNull()
  })

  it('never reads past a segment or loops on hostile input', () => {
    // An IFD claiming 65535 entries inside a tiny segment.
    const hostile = [...bytesOf('Exif', 0, 0), 0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0xff, 0xff]

    expect(exifOrientation(hostile)).toBeNull()
    expect(exifOrientation(bytesOf('NotExif'))).toBeUndefined()

    // Fill bytes before a marker are allowed.
    const filled = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xff,
      ...segment(0xe1, exifPayload({ entries: [[0x0112, 3, 1, 8]] })),
      0xff,
      0xda,
    ])

    expect(readJpegOrientation(filled)).toBe(8)
  })
})
