/**
 * Rebuild a PNG from an allow-list of its chunks.
 *
 * Every chunk's CRC is checked, the header must come first, and the new file
 * is the signature plus the chunks that decide how the picture looks: the
 * header, palette, image data, transparency and colour information. Text notes
 * (`tEXt`, `zTXt`, `iTXt`), EXIF (`eXIf`), timestamps, physical-size hints and
 * every other ancillary chunk are simply not copied, and nothing after `IEND`
 * survives — which is where a PNG/HTML or PNG/ZIP polyglot keeps its payload.
 *
 * An animated PNG loses its animation chunks and becomes the still picture its
 * `IDAT` holds, and the caller is told so. An unknown *critical* chunk is a
 * refusal: by the PNG rules a decoder that does not understand one must not
 * draw the file, so neither will this platform.
 *
 * @module @desi-event/api/lib/media/png
 */

import { crc32 } from 'node:zlib'

import { malformed } from './refusal.js'

/** The eight-byte PNG signature. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Chunks copied into the rebuilt file. */
const KEPT = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'cICP',
  'mDCV',
  'cLLI',
])

/** The chunks an animated PNG adds. */
const ANIMATION = new Set(['acTL', 'fcTL', 'fdAT'])

/** What each dropped chunk is called in the organiser's list of removals. */
const DROPPED_AS = Object.freeze({
  tEXt: 'text notes',
  zTXt: 'text notes',
  iTXt: 'text notes',
  eXIf: 'camera and location details (EXIF)',
  tIME: 'the time it was last saved',
})

/** Largest chunk length the PNG format allows. */
const MAX_CHUNK = 0x7fffffff

/** The most chunks accepted before the file is called malformed. */
const MAX_CHUNKS = 100_000

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
 * Sanitise a PNG.
 *
 * @param {Uint8Array} input The uploaded bytes.
 * @returns {{bytes: Buffer, width: number, height: number, removed: string[]}} The rebuilt file, its size, and what was left out.
 * @throws {Error} A `MediaRefusal` when the file is not a PNG a browser can draw.
 */
export function sanitisePng(input) {
  const bytes = asBuffer(input)

  if (bytes.length < SIGNATURE.length || !bytes.subarray(0, 8).equals(SIGNATURE)) {
    throw malformed('This file does not start like a PNG.')
  }

  /** @type {Buffer[]} */
  const kept = [SIGNATURE]
  const removed = new Set()

  let offset = SIGNATURE.length
  let header = null
  let sawData = false
  let ended = false

  for (let chunks = 0; !ended; chunks += 1) {
    if (chunks > MAX_CHUNKS) throw malformed('This PNG has too many chunks.')

    if (offset + 12 > bytes.length) throw malformed('This PNG ends before its IEND chunk.')

    const length = bytes.readUInt32BE(offset)

    if (length > MAX_CHUNK || offset + 12 + length > bytes.length) {
      throw malformed('This PNG ends in the middle of a chunk.')
    }

    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1')

    if (!/^[A-Za-z]{4}$/u.test(type)) throw malformed('This PNG has a chunk with an invalid name.')

    const crcEnd = offset + 8 + length
    const expected = bytes.readUInt32BE(crcEnd)

    if (crc32(bytes.subarray(offset + 4, crcEnd)) !== expected) {
      throw malformed('This PNG is damaged: a chunk checksum does not match.')
    }

    const chunk = bytes.subarray(offset, crcEnd + 4)
    const data = bytes.subarray(offset + 8, crcEnd)

    if (!header && type !== 'IHDR') throw malformed('This PNG does not start with its header.')

    if (type === 'IHDR') {
      if (header) throw malformed('This PNG has two headers.')

      header = readHeader(data)
    }

    if (type === 'IDAT') sawData = true

    if (type === 'IEND') {
      if (!sawData) throw malformed('This PNG has no image data.')

      ended = true

      if (crcEnd + 4 < bytes.length) removed.add('data after the end of the image')
    }

    if (KEPT.has(type)) {
      kept.push(chunk)
    } else if (ANIMATION.has(type)) {
      removed.add('animation (kept as a still picture)')
    } else if ((type.charCodeAt(0) & 0x20) === 0) {
      // Upper-case first letter: critical. A decoder that does not know it
      // must not draw the file.
      throw malformed(`This PNG needs a "${type}" chunk this platform cannot check.`)
    } else {
      removed.add(DROPPED_AS[type] ?? 'other hidden details')
    }

    offset = crcEnd + 4
  }

  return {
    bytes: Buffer.concat(kept),
    width: header.width,
    height: header.height,
    removed: [...removed],
  }
}

/**
 * Read and check the IHDR chunk.
 *
 * @param {Buffer} data The chunk data.
 * @returns {{width: number, height: number}} The picture size.
 * @throws {Error} A `MediaRefusal` when the header is malformed.
 */
function readHeader(data) {
  if (data.length !== 13) throw malformed('This PNG has a damaged header.')

  const width = data.readUInt32BE(0)
  const height = data.readUInt32BE(4)
  const bitDepth = data[8]
  const colourType = data[9]

  if (width === 0 || height === 0 || width > MAX_CHUNK || height > MAX_CHUNK) {
    throw malformed('This PNG states an impossible size.')
  }

  if (![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colourType)) {
    throw malformed('This PNG has a damaged header.')
  }

  if (data[10] !== 0 || data[11] !== 0 || data[12] > 1) {
    throw malformed('This PNG uses a compression or filter method browsers do not know.')
  }

  return { width, height }
}
