/**
 * Rebuild a WebP from an allow-list of its chunks.
 *
 * A simple WebP — one `VP8 ` (lossy) or `VP8L` (lossless) chunk — carries no
 * metadata and is copied as it is. An extended one (`VP8X`) can carry EXIF and
 * XMP; those chunks are not copied, their flags are cleared, and the RIFF size
 * is recomputed for what remains. The colour profile (`ICCP`), the alpha
 * channel (`ALPH`) and the image itself are kept. An animated WebP is refused:
 * there is no one frame that is obviously "the picture".
 *
 * Anything outside the RIFF container's declared size is trailing data and is
 * not copied.
 *
 * @module @desi-event/api/lib/media/webp
 */

import { MediaRefusal, malformed } from './refusal.js'

/** VP8X flag bits. */
const FLAGS = Object.freeze({ ANIMATION: 0x02, XMP: 0x04, EXIF: 0x08, ALPHA: 0x10, ICC: 0x20 })

/** The most chunks accepted before the file is called malformed. */
const MAX_CHUNKS = 10_000

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
 * Split a RIFF body into chunks.
 *
 * @param {Buffer} bytes The whole file.
 * @param {number} start The first chunk's offset.
 * @param {number} end The end of the RIFF container.
 * @returns {Array<{fourcc: string, data: Buffer}>} The chunks, in order.
 * @throws {MediaRefusal} When a chunk runs past the container.
 */
function chunksOf(bytes, start, end) {
  const chunks = []
  let offset = start

  while (offset < end) {
    if (chunks.length >= MAX_CHUNKS) throw malformed('This WebP has too many chunks.')
    if (offset + 8 > end) throw malformed('This WebP ends in the middle of a chunk.')

    const fourcc = bytes.subarray(offset, offset + 4).toString('latin1')
    const size = bytes.readUInt32LE(offset + 4)
    const dataEnd = offset + 8 + size

    if (dataEnd > end) throw malformed('This WebP ends in the middle of a chunk.')

    chunks.push({ fourcc, data: bytes.subarray(offset + 8, dataEnd) })

    // Chunks are padded to an even length; a missing final pad byte is tolerated.
    offset = dataEnd + (size % 2)
  }

  return chunks
}

/**
 * Serialise one chunk with its padding.
 *
 * @param {string} fourcc The chunk name.
 * @param {Buffer} data The chunk data.
 * @returns {Buffer} Header, data and pad byte.
 */
function chunk(fourcc, data) {
  const header = Buffer.alloc(8)

  header.write(fourcc, 0, 'latin1')
  header.writeUInt32LE(data.length, 4)

  return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
}

/**
 * The size a lossy bitstream declares.
 *
 * @param {Buffer} data The `VP8 ` chunk data.
 * @returns {{width: number, height: number}} The size.
 * @throws {MediaRefusal} When the frame header is not a key frame.
 */
function vp8Size(data) {
  if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
    throw malformed('This WebP has a damaged image header.')
  }

  return { width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff }
}

/**
 * The size a lossless bitstream declares.
 *
 * @param {Buffer} data The `VP8L` chunk data.
 * @returns {{width: number, height: number}} The size.
 * @throws {MediaRefusal} When the signature byte is wrong.
 */
function vp8lSize(data) {
  if (data.length < 5 || data[0] !== 0x2f) throw malformed('This WebP has a damaged image header.')

  const bits = data.readUInt32LE(1)

  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
}

/**
 * Sanitise a WebP.
 *
 * @param {Uint8Array} input The uploaded bytes.
 * @returns {{bytes: Buffer, width: number, height: number, removed: string[]}} The rebuilt file, its size, and what was left out.
 * @throws {MediaRefusal} When the file is not a still WebP a browser can draw.
 */
export function sanitiseWebp(input) {
  const bytes = asBuffer(input)

  if (
    bytes.length < 20 ||
    bytes.subarray(0, 4).toString('latin1') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('latin1') !== 'WEBP'
  ) {
    throw malformed('This file does not start like a WebP.')
  }

  const riffSize = bytes.readUInt32LE(4)
  const end = 8 + riffSize

  if (riffSize < 4 || end > bytes.length) {
    throw malformed('This WebP says it is larger than the file that arrived.')
  }

  const removed = new Set()

  if (end < bytes.length) removed.add('data after the end of the image')

  const chunks = chunksOf(bytes, 12, end)

  if (chunks.length === 0) throw malformed('This WebP has no image data.')

  const [first] = chunks
  let size
  /** @type {Buffer[]} */
  let body

  if (first.fourcc === 'VP8 ' || first.fourcc === 'VP8L') {
    size = first.fourcc === 'VP8 ' ? vp8Size(first.data) : vp8lSize(first.data)
    body = [chunk(first.fourcc, first.data)]

    if (chunks.length > 1) removed.add('other hidden details')
  } else if (first.fourcc === 'VP8X') {
    ;({ size, body } = extended(first.data, chunks.slice(1), removed))
  } else {
    throw malformed('This WebP does not start with an image chunk.')
  }

  if (size.width === 0 || size.height === 0) {
    throw malformed('This WebP does not state its size.')
  }

  const payload = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...body])
  const header = Buffer.alloc(8)

  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(payload.length, 4)

  return {
    bytes: Buffer.concat([header, payload]),
    width: size.width,
    height: size.height,
    removed: [...removed],
  }
}

/**
 * Rebuild an extended WebP: VP8X, then ICCP, ALPH and the image.
 *
 * @param {Buffer} header The VP8X chunk data.
 * @param {Array<{fourcc: string, data: Buffer}>} rest The chunks after it.
 * @param {Set<string>} removed What was left out, added to in place.
 * @returns {{size: {width: number, height: number}, body: Buffer[]}} The canvas size and the new chunks.
 * @throws {MediaRefusal} When the file is animated or has no image.
 */
function extended(header, rest, removed) {
  if (header.length < 10) throw malformed('This WebP has a damaged extended header.')

  let flags = header[0]

  if (
    flags & FLAGS.ANIMATION ||
    rest.some(({ fourcc }) => fourcc === 'ANIM' || fourcc === 'ANMF')
  ) {
    throw new MediaRefusal('ANIMATED_IMAGE')
  }

  const size = {
    width: header.readUIntLE(4, 3) + 1,
    height: header.readUIntLE(7, 3) + 1,
  }

  /** @type {Buffer[]} */
  const kept = []
  let icc = false
  let image = false

  for (const { fourcc, data } of rest) {
    if (fourcc === 'ICCP' && !icc && !image) {
      kept.push(chunk(fourcc, data))
      icc = true
    } else if (fourcc === 'ALPH' && !image) {
      kept.push(chunk(fourcc, data))
    } else if ((fourcc === 'VP8 ' || fourcc === 'VP8L') && !image) {
      // Checked for shape; the canvas size is what the picture is shown at.
      if (fourcc === 'VP8 ') vp8Size(data)
      else vp8lSize(data)

      kept.push(chunk(fourcc, data))
      image = true
    } else if (fourcc === 'EXIF') {
      removed.add('camera and location details (EXIF)')
    } else if (fourcc === 'XMP ') {
      removed.add('XMP metadata')
    } else {
      removed.add('other hidden details')
    }
  }

  if (!image) throw malformed('This WebP has no image data.')

  flags &= ~(FLAGS.EXIF | FLAGS.XMP)

  if (!icc) flags &= ~FLAGS.ICC

  const vp8x = Buffer.from(header.subarray(0, 10))

  vp8x[0] = flags

  return { size, body: [chunk('VP8X', vp8x), ...kept] }
}
