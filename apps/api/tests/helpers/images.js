/**
 * Picture builders for the media tests.
 *
 * Byte-level control is the point: each builder writes exactly the segments,
 * chunks and metadata a test asks for, so a test can plant EXIF with a GPS
 * position, XMP, IPTC, a comment, text chunks or a polyglot tail and then check
 * that none of it survives. The pixels are never decoded by the code under
 * test, so the JPEG entropy data is structurally valid rather than a real
 * picture; the PNGs are real (zlib-compressed rows) and the WebP headers are
 * real key-frame headers.
 *
 * @module @desi-event/api/tests/helpers/images
 */

import { crc32, deflateSync } from 'node:zlib'

/**
 * Bytes from numbers, strings (Latin-1) and buffers.
 *
 * @param {...(number|string|Uint8Array|number[])} parts The parts.
 * @returns {Buffer} The bytes.
 */
export function bytes(...parts) {
  return Buffer.concat(
    parts.map((part) => {
      if (typeof part === 'number') return Buffer.from([part])
      if (typeof part === 'string') return Buffer.from(part, 'latin1')
      return Buffer.from(part)
    }),
  )
}

/**
 * A 16-bit big-endian value.
 *
 * @param {number} value The value.
 * @returns {Buffer} Two bytes.
 */
function u16be(value) {
  const out = Buffer.alloc(2)

  out.writeUInt16BE(value)

  return out
}

/**
 * A 32-bit big-endian value.
 *
 * @param {number} value The value.
 * @returns {Buffer} Four bytes.
 */
function u32be(value) {
  const out = Buffer.alloc(4)

  out.writeUInt32BE(value >>> 0)

  return out
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/** The PNG signature. */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * One PNG chunk with a correct CRC (or a deliberately wrong one).
 *
 * @param {string} type The four-letter type.
 * @param {Uint8Array} [data] The chunk data.
 * @param {{badCrc?: boolean}} [options] Corrupt the CRC.
 * @returns {Buffer} Length, type, data and CRC.
 */
export function pngChunk(type, data = Buffer.alloc(0), { badCrc = false } = {}) {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)])
  const crc = crc32(typed)

  return Buffer.concat([u32be(data.length), typed, u32be(badCrc ? crc ^ 1 : crc)])
}

/**
 * The IHDR chunk for an 8-bit RGB picture.
 *
 * @param {number} width The width.
 * @param {number} height The height.
 * @returns {Buffer} The chunk.
 */
export function ihdr(width, height) {
  return pngChunk('IHDR', Buffer.concat([u32be(width), u32be(height), bytes(8, 2, 0, 0, 0)]))
}

/**
 * The IDAT chunk for a solid-colour 8-bit RGB picture.
 *
 * @param {number} width The width.
 * @param {number} height The height.
 * @returns {Buffer} The chunk.
 */
export function solidIdat(width, height) {
  const row = Buffer.alloc(1 + width * 3, 0x80)

  row[0] = 0

  return pngChunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row))))
}

/**
 * A real solid-colour PNG, with whatever extra chunks a test wants.
 *
 * @param {number} width The width.
 * @param {number} height The height.
 * @param {object} [options] Options.
 * @param {Buffer[]} [options.before] Chunks between IHDR and IDAT.
 * @param {Buffer[]} [options.after] Chunks between IDAT and IEND.
 * @param {Uint8Array} [options.trailing] Bytes after IEND.
 * @param {string} [options.text] Adds a `tEXt` chunk with this comment.
 * @returns {Buffer} The file.
 */
export function solidPng(width, height, { before = [], after = [], trailing, text } = {}) {
  const extra = text ? [pngChunk('tEXt', bytes('Comment', 0, text))] : []

  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr(width, height),
    ...extra,
    ...before,
    solidIdat(width, height),
    ...after,
    pngChunk('IEND'),
    ...(trailing ? [Buffer.from(trailing)] : []),
  ])
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/**
 * A JPEG marker segment.
 *
 * @param {number} marker The marker's second byte.
 * @param {Uint8Array} payload The payload.
 * @returns {Buffer} Marker, length and payload.
 */
export function segment(marker, payload) {
  return Buffer.concat([bytes(0xff, marker), u16be(payload.length + 2), Buffer.from(payload)])
}

/** A JFIF APP0 segment. */
export const JFIF = segment(0xe0, bytes('JFIF', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0))

/** A JFXX APP0 segment: an embedded thumbnail extension. */
export const JFXX = segment(0xe0, bytes('JFXX', 0, 0x10, 'thumbnail-bytes'))

/**
 * An EXIF APP1 segment, big-endian, with IFD0 carrying a camera make and an
 * optional orientation, and a GPS IFD with a latitude.
 *
 * @param {object} [options] Options.
 * @param {number|null} [options.orientation] Orientation 1–8, or null for none.
 * @param {boolean} [options.gps] Include the GPS IFD.
 * @returns {Buffer} The segment.
 */
export function exifSegment({ orientation = null, gps = true } = {}) {
  // TIFF header (8) + IFD0.
  const entries = []
  const make = bytes('SecretCam', 0)
  const ifd0Count = 1 + (orientation ? 1 : 0) + (gps ? 1 : 0)
  const ifd0Size = 2 + ifd0Count * 12 + 4
  const makeOffset = 8 + ifd0Size
  const gpsOffset = makeOffset + make.length + (make.length % 2)

  entries.push(Buffer.concat([u16be(0x010f), u16be(2), u32be(make.length), u32be(makeOffset)]))

  if (orientation) {
    entries.push(Buffer.concat([u16be(0x0112), u16be(3), u32be(1), u16be(orientation), u16be(0)]))
  }

  if (gps) {
    entries.push(Buffer.concat([u16be(0x8825), u16be(4), u32be(1), u32be(gpsOffset)]))
  }

  const ifd0 = Buffer.concat([u16be(ifd0Count), ...entries, u32be(0)])
  const latitude = bytes('GPSLAT-18.9220N')
  const gpsIfd = Buffer.concat([
    u16be(1),
    // GPSLatitudeRef, ASCII 2, inline 'N\0'.
    u16be(0x0001),
    u16be(2),
    u32be(2),
    bytes('N', 0, 0, 0),
    u32be(0),
    latitude,
  ])

  const tiff = Buffer.concat([
    bytes('MM', 0, 0x2a),
    u32be(8),
    ifd0,
    make,
    make.length % 2 ? bytes(0) : Buffer.alloc(0),
    ...(gps ? [gpsIfd] : []),
  ])

  return segment(0xe1, Buffer.concat([bytes('Exif', 0, 0), tiff]))
}

/** An XMP APP1 segment carrying a location. */
export const XMP = segment(
  0xe1,
  bytes(
    'http://ns.adobe.com/xap/1.0/',
    0,
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><exif:GPSLatitude>18,55.32N</exif:GPSLatitude></x:xmpmeta>',
  ),
)

/** An APP13 Photoshop/IPTC segment with a byline. */
export const IPTC = segment(0xed, bytes('Photoshop 3.0', 0, '8BIM', 0x04, 0x04, 'IPTC-BYLINE'))

/** A COM segment. */
export const COMMENT = segment(0xfe, bytes('private comment: shot at home'))

/** An MPF APP2 segment, the index of a second image. */
export const MPF = segment(0xe2, bytes('MPF', 0, 'MM', 0, 0x2a, 'second-image-index'))

/**
 * One ICC_PROFILE APP2 chunk.
 *
 * @param {number} sequence 1-based chunk number.
 * @param {number} total Chunk count.
 * @param {string} data Profile bytes.
 * @returns {Buffer} The segment.
 */
export function iccSegment(sequence, total, data) {
  return segment(0xe2, bytes('ICC_PROFILE', 0, sequence, total, data))
}

/** An Adobe APP14 colour-transform segment. */
export const ADOBE = segment(0xee, bytes('Adobe', 0, 100, 0, 0, 0, 0, 1))

/** A quantisation table. */
export const DQT = segment(0xdb, Buffer.concat([bytes(0), Buffer.alloc(64, 1)]))

/** A Huffman table (structure only). */
export const DHT = segment(
  0xc4,
  Buffer.concat([bytes(0x00), Buffer.from([0, 1, ...Array(14).fill(0)]), bytes(0)]),
)

/**
 * A frame header.
 *
 * @param {number} width The width.
 * @param {number} height The height.
 * @param {number} [marker] The SOF marker; baseline by default.
 * @returns {Buffer} The segment.
 */
export function sof(width, height, marker = 0xc0) {
  return segment(
    marker,
    Buffer.concat([
      bytes(8),
      u16be(height),
      u16be(width),
      bytes(3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1),
    ]),
  )
}

/** A scan header for three components. */
export const SOS = segment(0xda, bytes(3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0))

/** Entropy-coded data with a stuffed 0xFF and every restart marker in it. */
export const ENTROPY = Buffer.concat([
  bytes(0x12, 0x34, 0xff, 0x00, 0x56),
  ...Array.from({ length: 8 }, (_, index) => bytes(0x78, 0xff, 0xd0 + index, 0x9a)),
  bytes(0xbc),
])

/**
 * A structurally valid JPEG.
 *
 * @param {number} width The width.
 * @param {number} height The height.
 * @param {object} [options] Options.
 * @param {Buffer[]} [options.head] Segments right after SOI (APPn, COM).
 * @param {Uint8Array} [options.trailing] Bytes after EOI.
 * @param {number} [options.frame] The SOF marker.
 * @param {boolean} [options.eoi] Whether to end with EOI.
 * @param {boolean} [options.scan] Whether to include the scan.
 * @returns {Buffer} The file.
 */
export function jpeg(
  width,
  height,
  { head = [JFIF], trailing, frame = 0xc0, eoi = true, scan = true } = {},
) {
  return Buffer.concat([
    bytes(0xff, 0xd8),
    ...head,
    DQT,
    sof(width, height, frame),
    DHT,
    ...(scan ? [SOS, ENTROPY] : []),
    ...(eoi ? [bytes(0xff, 0xd9)] : []),
    ...(trailing ? [Buffer.from(trailing)] : []),
  ])
}

/**
 * A camera JPEG: EXIF with a make and GPS, XMP, IPTC, a comment, a JFXX
 * thumbnail, an MPF index and a second image appended after EOI.
 *
 * @param {number} width The width.
 * @param {number} height The height.
 * @param {{orientation?: number|null}} [options] The EXIF orientation.
 * @returns {Buffer} The file.
 */
export function cameraJpeg(width, height, { orientation = null } = {}) {
  return jpeg(width, height, {
    head: [JFIF, JFXX, exifSegment({ orientation }), XMP, MPF, IPTC, COMMENT],
    trailing: jpeg(160, 120, { head: [] }),
  })
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

/**
 * A RIFF chunk with padding.
 *
 * @param {string} fourcc The name.
 * @param {Uint8Array} data The data.
 * @returns {Buffer} Header, data and pad.
 */
export function riffChunk(fourcc, data) {
  const header = Buffer.alloc(8)

  header.write(fourcc, 0, 'latin1')
  header.writeUInt32LE(data.length, 4)

  return Buffer.concat([header, Buffer.from(data), data.length % 2 ? bytes(0) : Buffer.alloc(0)])
}

/**
 * A lossy key-frame bitstream header of the given size.
 *
 * @param {number} width The width.
 * @param {number} height The height.
 * @param {number} [extra] Extra payload bytes.
 * @returns {Buffer} The `VP8 ` data.
 */
export function vp8Data(width, height, extra = 11) {
  const header = Buffer.alloc(10)

  header[0] = 0x10
  header[3] = 0x9d
  header[4] = 0x01
  header[5] = 0x2a
  header.writeUInt16LE(width & 0x3fff, 6)
  header.writeUInt16LE(height & 0x3fff, 8)

  return Buffer.concat([header, Buffer.alloc(extra, 0x55)])
}

/**
 * A lossless bitstream header of the given size.
 *
 * @param {number} width The width.
 * @param {number} height The height.
 * @returns {Buffer} The `VP8L` data.
 */
export function vp8lData(width, height) {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  const out = Buffer.alloc(9, 0x00)

  out[0] = 0x2f
  out.writeUInt32LE(bits >>> 0, 1)

  return out
}

/**
 * A RIFF/WEBP file from chunks.
 *
 * @param {Buffer[]} chunks The chunks.
 * @param {object} [options] Options.
 * @param {number} [options.riffSizeDelta] Added to the true RIFF size.
 * @param {Uint8Array} [options.trailing] Bytes after the container.
 * @returns {Buffer} The file.
 */
export function webp(chunks, { riffSizeDelta = 0, trailing } = {}) {
  const payload = Buffer.concat([bytes('WEBP'), ...chunks])
  const header = Buffer.alloc(8)

  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(payload.length + riffSizeDelta, 4)

  return Buffer.concat([header, payload, ...(trailing ? [Buffer.from(trailing)] : [])])
}

/**
 * A VP8X header chunk.
 *
 * @param {number} flags The flag byte.
 * @param {number} width The canvas width.
 * @param {number} height The canvas height.
 * @returns {Buffer} The chunk.
 */
export function vp8x(flags, width, height) {
  const data = Buffer.alloc(10)

  data[0] = flags
  data.writeUIntLE(width - 1, 4, 3)
  data.writeUIntLE(height - 1, 7, 3)

  return riffChunk('VP8X', data)
}

/**
 * An extended WebP carrying EXIF, XMP and an ICC profile.
 *
 * @param {number} width The width.
 * @param {number} height The height.
 * @returns {Buffer} The file.
 */
export function metadataWebp(width, height) {
  return webp([
    vp8x(0x20 | 0x08 | 0x04, width, height),
    riffChunk('ICCP', bytes('icc-profile-bytes')),
    riffChunk('VP8 ', vp8Data(width, height)),
    riffChunk('EXIF', exifSegment().subarray(4 + 6)),
    riffChunk('XMP ', bytes('<x:xmpmeta>GPSLatitude</x:xmpmeta>')),
  ])
}

/** An SVG that calls itself a PNG. */
export const SVG_AS_PNG = bytes(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
)
