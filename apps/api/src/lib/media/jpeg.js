/**
 * Rebuild a JPEG from an allow-list of its segments.
 *
 * Nothing is deleted from the upload. A new file is assembled from the parts a
 * browser needs to draw the picture — the quantisation and Huffman tables, the
 * frame header, the scans and their entropy-coded data — plus the colour
 * information that changes how it looks. Everything else is simply not copied:
 * camera and location details (EXIF, GPS), XMP, IPTC, comments, embedded
 * thumbnails, secondary images, and any bytes after the end-of-image marker,
 * which is where a JPEG/ZIP or JPEG/HTML polyglot keeps its second life.
 *
 * The orientation is the one piece of EXIF worth keeping, because without it a
 * portrait photo taken on a phone is shown on its side. It survives as a new,
 * minimal APP1 holding that single tag, and the width and height returned are
 * the displayed ones.
 *
 * The walker is bounded and not recursive: every step advances, every read is
 * checked against the buffer, and a hostile length is a refusal rather than a
 * crash. No pixel is decoded.
 *
 * @module @desi-event/api/lib/media/jpeg
 */

import { exifOrientation } from '@desi-event/schemas/media'

import { MediaRefusal, malformed } from './refusal.js'

/** The most marker segments accepted before the file is called malformed. */
const MAX_SEGMENTS = 4096

/** An Adobe APP14 payload larger than this is not the colour-transform record. */
const MAX_ADOBE_PAYLOAD = 16

/**
 * The fixed part of a JFIF APP0 payload: `JFIF\0`, version (2), density units
 * (1), X and Y density (2 each), thumbnail width and height (1 each).
 */
const JFIF_HEADER_LENGTH = 14

/** Frame types browsers draw: baseline, extended sequential, progressive (Huffman). */
const SUPPORTED_FRAMES = new Set([0xc0, 0xc1, 0xc2])

/**
 * Frame and coding markers refused outright: lossless, hierarchical and
 * arithmetic-coded JPEG, and the reserved JPG extensions.
 */
const REFUSED_CODING = new Set([
  0xc3, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf, 0xdc, 0xde, 0xdf,
])

/**
 * View bytes as a Buffer without copying.
 *
 * @param {Uint8Array} bytes The bytes.
 * @returns {Buffer} A Buffer over the same memory.
 */
function asBuffer(bytes) {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)
}

/**
 * Whether a payload begins with an ASCII signature.
 *
 * @param {Buffer} payload The segment payload.
 * @param {string} signature The expected leading characters, NULs included.
 * @returns {boolean} True on a match.
 */
function startsWith(payload, signature) {
  return (
    payload.length >= signature.length &&
    payload.subarray(0, signature.length).toString('latin1') === signature
  )
}

/**
 * The minimal APP1 carrying one EXIF tag: Orientation.
 *
 * Big-endian TIFF, one IFD with one SHORT entry and no next IFD. No camera, no
 * date, no location: the one fact needed to draw the picture upright.
 *
 * @param {number} orientation 2–8.
 * @returns {Buffer} The complete segment, marker included.
 */
export function orientationSegment(orientation) {
  const payload = Buffer.from([
    ...Buffer.from('Exif\0\0', 'latin1'),
    // TIFF header: big-endian, 42, IFD0 at offset 8.
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    // One entry: tag 0x0112, type SHORT (3), count 1, value.
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    // No next IFD.
    0x00,
    0x00,
    0x00,
    0x00,
  ])
  const length = payload.length + 2

  return Buffer.concat([Buffer.from([0xff, 0xe1, length >> 8, length & 0xff]), payload])
}

/**
 * A JFIF APP0 rebuilt from its fixed fields, with no thumbnail.
 *
 * The version, density units and densities are copied; the thumbnail size is
 * written as 0 × 0 and nothing after the fixed header is copied. A JFIF
 * segment may carry an uncompressed RGB thumbnail there — the classic leak of
 * what a crop cut out — or any other bytes a polyglot wants to smuggle.
 *
 * @param {Buffer} payload The original APP0 payload, at least {@link JFIF_HEADER_LENGTH} bytes.
 * @returns {Buffer} The complete segment, marker included: always 18 bytes.
 */
export function jfifSegment(payload) {
  const header = Buffer.from(payload.subarray(0, JFIF_HEADER_LENGTH))

  // No thumbnail: width and height 0.
  header[12] = 0
  header[13] = 0

  const length = header.length + 2

  return Buffer.concat([Buffer.from([0xff, 0xe0, length >> 8, length & 0xff]), header])
}

/**
 * Sanitise a JPEG.
 *
 * @param {Uint8Array} input The uploaded bytes.
 * @returns {{bytes: Buffer, width: number, height: number, orientation: number|null, removed: string[]}} The rebuilt file, its displayed size, and what was left out.
 * @throws {MediaRefusal} When the file is not a JPEG a browser can draw.
 */
export function sanitiseJpeg(input) {
  const bytes = asBuffer(input)
  const length = bytes.length

  if (length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw malformed('This file does not start like a JPEG.')
  }

  /** @type {Buffer[]} */
  const head = []
  /** @type {Buffer[]} */
  const body = []
  const removed = new Set()

  let offset = 2
  let frame = null
  let scans = 0
  let orientation = null
  let keptJfif = false
  let ended = false

  for (let segments = 0; !ended; segments += 1) {
    if (segments > MAX_SEGMENTS) throw malformed('This JPEG has too many segments.')
    if (offset >= length) throw malformed('This JPEG ends before its end-of-image marker.')
    if (bytes[offset] !== 0xff) throw malformed('This JPEG has data where a marker belongs.')

    // Fill bytes: any run of 0xFF may precede a marker.
    while (offset + 1 < length && bytes[offset + 1] === 0xff) offset += 1

    if (offset + 1 >= length) throw malformed('This JPEG ends in the middle of a marker.')

    const marker = bytes[offset + 1]

    if (marker === 0xd9) {
      if (!frame || scans === 0) throw malformed('This JPEG has no image data.')

      body.push(bytes.subarray(offset, offset + 2))

      if (offset + 2 < length) removed.add('data after the end of the image')

      ended = true
      continue
    }

    if (marker === 0x01) {
      offset += 2
      continue
    }

    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x00) {
      throw malformed('This JPEG has a marker in a place it cannot be.')
    }

    if (REFUSED_CODING.has(marker) || (marker >= 0xf0 && marker <= 0xfd)) {
      throw malformed(
        'This JPEG uses a lossless, hierarchical or arithmetic encoding that browsers do not show reliably. Save it again as a standard JPEG.',
      )
    }

    if (offset + 4 > length) throw malformed('This JPEG ends in the middle of a segment.')

    const segmentLength = bytes.readUInt16BE(offset + 2)
    const end = offset + 2 + segmentLength

    if (segmentLength < 2 || end > length) {
      throw malformed('This JPEG ends in the middle of a segment.')
    }

    const segment = bytes.subarray(offset, end)
    const payload = bytes.subarray(offset + 4, end)

    if (marker === 0xe0) {
      if (startsWith(payload, 'JFIF\0') && !keptJfif) {
        if (payload.length < JFIF_HEADER_LENGTH) {
          // Too short to be the header it claims; a browser does not need it.
          removed.add('application data')
        } else {
          // Rebuilt, not copied: only the fixed fields survive.
          head.push(jfifSegment(payload))
          keptJfif = true

          if (payload.length > JFIF_HEADER_LENGTH) {
            removed.add(
              payload[12] > 0 && payload[13] > 0 ? 'an embedded thumbnail' : 'application data',
            )
          }
        }
      } else if (startsWith(payload, 'JFXX\0')) {
        removed.add('an embedded thumbnail')
      } else if (!startsWith(payload, 'JFIF\0')) {
        removed.add('application data')
      }
    } else if (marker === 0xe1) {
      if (startsWith(payload, 'Exif\0\0')) {
        const found = exifOrientation(payload)

        if (orientation === null && typeof found === 'number') orientation = found

        removed.add('camera and location details (EXIF)')
      } else if (startsWith(payload, 'http://ns.adobe.com/')) {
        removed.add('XMP metadata')
      } else {
        removed.add('application data')
      }
    } else if (marker === 0xe2) {
      if (startsWith(payload, 'ICC_PROFILE\0')) {
        body.push(segment)
      } else if (startsWith(payload, 'MPF\0')) {
        removed.add('additional images (MPF)')
      } else {
        removed.add('application data')
      }
    } else if (marker === 0xed) {
      removed.add('IPTC and Photoshop details')
    } else if (marker === 0xee) {
      if (startsWith(payload, 'Adobe') && payload.length <= MAX_ADOBE_PAYLOAD) {
        body.push(segment)
      } else {
        removed.add('application data')
      }
    } else if (marker >= 0xe3 && marker <= 0xef) {
      removed.add('application data')
    } else if (marker === 0xfe) {
      removed.add('comments')
    } else if (marker === 0xdb || marker === 0xc4 || marker === 0xdd) {
      body.push(segment)
    } else if (SUPPORTED_FRAMES.has(marker)) {
      if (frame) throw malformed('This JPEG holds more than one image frame.')

      frame = readFrame(payload)
      body.push(segment)
    } else if (marker === 0xda) {
      if (!frame) throw malformed('This JPEG has image data before its frame header.')

      body.push(segment)

      const dataEnd = entropyEnd(bytes, end)

      body.push(bytes.subarray(end, dataEnd))
      scans += 1
      offset = dataEnd
      continue
    } else {
      throw malformed('This JPEG contains a segment this platform does not accept.')
    }

    offset = end
  }

  const quarterTurned = orientation !== null && orientation >= 5
  const parts = [bytes.subarray(0, 2), ...head]

  if (orientation !== null && orientation !== 1) {
    parts.push(orientationSegment(orientation))
  }

  return {
    bytes: Buffer.concat([...parts, ...body]),
    width: quarterTurned ? frame.height : frame.width,
    height: quarterTurned ? frame.width : frame.height,
    orientation,
    removed: [...removed],
  }
}

/**
 * Read a frame header's size and check its component count.
 *
 * @param {Buffer} payload The SOF payload.
 * @returns {{width: number, height: number}} The coded size.
 * @throws {MediaRefusal} When the header is short or describes no picture.
 */
function readFrame(payload) {
  if (payload.length < 6) throw malformed('This JPEG has a damaged frame header.')

  const height = payload.readUInt16BE(1)
  const width = payload.readUInt16BE(3)
  const components = payload[5]

  if (components < 1 || components > 4 || payload.length < 6 + components * 3) {
    throw malformed('This JPEG has a damaged frame header.')
  }

  if (width === 0 || height === 0) {
    throw malformed('This JPEG does not state its size in its frame header.')
  }

  return { width, height }
}

/**
 * Where a scan's entropy-coded data ends.
 *
 * Inside a scan, 0xFF is followed by 0x00 (a stuffed 0xFF byte) or a restart
 * marker, and both are data. Any other marker ends the scan.
 *
 * @param {Buffer} bytes The whole file.
 * @param {number} start Where the scan's data starts.
 * @returns {number} The offset of the marker that ends it.
 * @throws {MediaRefusal} When the file ends inside the scan.
 */
function entropyEnd(bytes, start) {
  let cursor = start

  for (;;) {
    const found = bytes.indexOf(0xff, cursor)

    if (found < 0 || found + 1 >= bytes.length) {
      throw new MediaRefusal('MALFORMED_IMAGE', 'This JPEG ends in the middle of its image data.')
    }

    const next = bytes[found + 1]

    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      cursor = found + 2
      continue
    }

    return found
  }
}
