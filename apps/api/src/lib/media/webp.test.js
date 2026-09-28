import { describe, expect, it } from 'vitest'

import {
  bytes,
  metadataWebp,
  riffChunk,
  vp8Data,
  vp8lData,
  vp8x,
  webp,
} from '../../../tests/helpers/images.js'
import { MediaRefusal } from './refusal.js'
import { sanitiseWebp } from './webp.js'

/**
 * The refusal code a call throws, or null.
 *
 * @param {Function} run The call.
 * @returns {string|null} The code.
 */
function refusalCode(run) {
  try {
    run()
  } catch (error) {
    if (error instanceof MediaRefusal) return error.code
    throw error
  }

  return null
}

/**
 * The chunk names of a WebP, in order.
 *
 * @param {Buffer} file The file.
 * @returns {string[]} The names.
 */
function chunkNames(file) {
  const names = []
  let offset = 12

  while (offset + 8 <= file.length) {
    const size = file.readUInt32LE(offset + 4)

    names.push(file.subarray(offset, offset + 4).toString('latin1'))
    offset += 8 + size + (size % 2)
  }

  return names
}

describe('sanitiseWebp', () => {
  it('reads a lossy picture’s size and passes it through', () => {
    const file = webp([riffChunk('VP8 ', vp8Data(1200, 630))])
    const out = sanitiseWebp(file)

    expect([out.width, out.height]).toEqual([1200, 630])
    expect(out.bytes.equals(file)).toBe(true)
  })

  it('reads a lossless picture’s size and passes it through', () => {
    const file = webp([riffChunk('VP8L', vp8lData(640, 480))])
    const out = sanitiseWebp(file)

    expect([out.width, out.height]).toEqual([640, 480])
    expect(out.bytes.equals(file)).toBe(true)
  })

  it('drops EXIF and XMP, clears their flags, keeps ICCP, and recomputes the RIFF size', () => {
    const file = metadataWebp(1200, 630)
    const out = sanitiseWebp(file)

    expect(chunkNames(out.bytes)).toEqual(['VP8X', 'ICCP', 'VP8 '])
    expect(out.bytes[20] & 0x08).toBe(0)
    expect(out.bytes[20] & 0x04).toBe(0)
    expect(out.bytes[20] & 0x20).toBe(0x20)
    expect(out.bytes.readUInt32LE(4)).toBe(out.bytes.length - 8)
    expect(out.bytes.toString('latin1')).not.toMatch(/GPS|SecretCam|xmpmeta/)
    expect(out.removed).toEqual(['camera and location details (EXIF)', 'XMP metadata'])
    expect([out.width, out.height]).toEqual([1200, 630])
  })

  it('clears the ICC flag when no profile survives, and keeps ALPH', () => {
    const file = webp([
      vp8x(0x20 | 0x10, 800, 600),
      riffChunk('ALPH', bytes(0, 1, 2)),
      riffChunk('VP8 ', vp8Data(800, 600)),
    ])
    const out = sanitiseWebp(file)

    expect(out.bytes[20] & 0x20).toBe(0)
    expect(out.bytes[20] & 0x10).toBe(0x10)
    expect(chunkNames(out.bytes)).toEqual(['VP8X', 'ALPH', 'VP8 '])
  })

  it('pads an odd-sized chunk', () => {
    const file = webp([
      vp8x(0x10, 800, 600),
      riffChunk('ALPH', bytes(1, 2, 3)),
      riffChunk('VP8L', vp8lData(800, 600)),
    ])
    const out = sanitiseWebp(file)

    expect(out.bytes.length % 2).toBe(0)
    expect(chunkNames(out.bytes)).toEqual(['VP8X', 'ALPH', 'VP8L'])
  })

  it('drops bytes after the RIFF container, and unknown chunks', () => {
    const out = sanitiseWebp(
      webp(
        [vp8x(0, 800, 600), riffChunk('VP8 ', vp8Data(800, 600)), riffChunk('JUNK', bytes('x'))],
        {
          trailing: bytes('PK', 3, 4, 'zip-payload'),
        },
      ),
    )

    expect(out.bytes.toString('latin1')).not.toContain('zip-payload')
    expect(out.removed).toEqual(
      expect.arrayContaining(['data after the end of the image', 'other hidden details']),
    )
  })

  it('drops anything after the image chunk of a simple WebP', () => {
    const out = sanitiseWebp(
      webp([riffChunk('VP8 ', vp8Data(800, 600)), riffChunk('EXIF', bytes('MM', 0, 42))]),
    )

    expect(chunkNames(out.bytes)).toEqual(['VP8 '])
  })

  it('is idempotent', () => {
    const once = sanitiseWebp(metadataWebp(1200, 630))

    expect(sanitiseWebp(once.bytes).bytes.equals(once.bytes)).toBe(true)
  })

  it.each([
    ['the animation flag', webp([vp8x(0x02, 800, 600), riffChunk('VP8 ', vp8Data(800, 600))])],
    [
      'an ANIM chunk',
      webp([
        vp8x(0, 800, 600),
        riffChunk('ANIM', Buffer.alloc(6)),
        riffChunk('VP8 ', vp8Data(800, 600)),
      ]),
    ],
    ['an ANMF chunk', webp([vp8x(0, 800, 600), riffChunk('ANMF', Buffer.alloc(16))])],
  ])('refuses %s as ANIMATED_IMAGE', (_name, file) => {
    expect(refusalCode(() => sanitiseWebp(file))).toBe('ANIMATED_IMAGE')
  })

  it.each([
    [
      'a RIFF size larger than the file',
      webp([riffChunk('VP8 ', vp8Data(800, 600))], { riffSizeDelta: 100 }),
    ],
    [
      'a RIFF size smaller than the form type',
      Buffer.concat([bytes('RIFF', 2, 0, 0, 0, 'WEBP'), Buffer.alloc(8)]),
    ],
    ['a chunk running past the container', webp([bytes('VP8 ', 0xff, 0, 0, 0, 1, 2, 3, 4)])],
    ['no image chunk', webp([vp8x(0, 800, 600), riffChunk('ICCP', bytes('x'))])],
    ['an empty container', webp([])],
    ['a broken lossy header', webp([riffChunk('VP8 ', Buffer.alloc(12))])],
    ['a broken lossless header', webp([riffChunk('VP8L', bytes(0x2e, 0, 0, 0, 0))])],
    ['a short VP8X', webp([riffChunk('VP8X', Buffer.alloc(4))])],
    ['a first chunk that is not an image', webp([riffChunk('ICCP', bytes('x'))])],
    ['a zero-sized picture', webp([riffChunk('VP8 ', vp8Data(0, 600))])],
    ['not a WebP', bytes('RIFF', 0x20, 0, 0, 0, 'WAVE', Buffer.alloc(24))],
  ])('refuses %s as MALFORMED_IMAGE', (_name, file) => {
    expect(refusalCode(() => sanitiseWebp(file))).toBe('MALFORMED_IMAGE')
  })
})
