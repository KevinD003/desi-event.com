import { describe, expect, it } from 'vitest'

import {
  PNG_SIGNATURE,
  bytes,
  ihdr,
  pngChunk,
  solidIdat,
  solidPng,
} from '../../../tests/helpers/images.js'
import { sanitisePng } from './png.js'
import { MediaRefusal } from './refusal.js'

/**
 * The chunk types of a PNG, in order.
 *
 * @param {Buffer} file The PNG.
 * @returns {string[]} The types.
 */
function chunkTypes(file) {
  const types = []
  let offset = 8

  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset)

    types.push(file.subarray(offset + 4, offset + 8).toString('latin1'))
    offset += 12 + length
  }

  return types
}

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

describe('sanitisePng', () => {
  it('reads the size from IHDR and copies a plain PNG unchanged', () => {
    const file = solidPng(400, 300)
    const out = sanitisePng(file)

    expect([out.width, out.height]).toEqual([400, 300])
    expect(out.bytes.equals(file)).toBe(true)
    expect(out.removed).toEqual([])
  })

  it.each([
    ['tEXt', pngChunk('tEXt', bytes('Author', 0, 'Priya at home')), 'text notes'],
    ['zTXt', pngChunk('zTXt', bytes('Comment', 0, 0, 'x')), 'text notes'],
    ['iTXt', pngChunk('iTXt', bytes('XML:com.adobe.xmp', 0, 0, 0, 0, 0, '<x/>')), 'text notes'],
    ['eXIf', pngChunk('eXIf', bytes('MM', 0, 0x2a, 'GPS')), 'camera and location details (EXIF)'],
    ['tIME', pngChunk('tIME', bytes(0x07, 0xea, 1, 2, 3, 4, 5)), 'the time it was last saved'],
    ['pHYs', pngChunk('pHYs', Buffer.alloc(9)), 'other hidden details'],
    ['an unknown ancillary chunk', pngChunk('prVt', bytes('vendor')), 'other hidden details'],
  ])('drops %s and says so', (_name, chunk, said) => {
    const out = sanitisePng(solidPng(400, 300, { before: [chunk] }))

    expect(out.bytes.indexOf(chunk)).toBe(-1)
    expect(out.removed).toContain(said)
    expect(chunkTypes(out.bytes)).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  it('keeps PLTE, tRNS, gAMA, sRGB, iCCP and the other colour chunks byte for byte', () => {
    const kept = [
      pngChunk('gAMA', bytes(0, 0, 0xb1, 0x8f)),
      pngChunk('sRGB', bytes(0)),
      pngChunk('iCCP', bytes('icc', 0, 0, 'profile')),
      pngChunk('cHRM', Buffer.alloc(32, 1)),
      pngChunk('sBIT', bytes(8, 8, 8)),
      pngChunk('PLTE', bytes(0, 0, 0, 255, 255, 255)),
      pngChunk('tRNS', bytes(0, 0)),
      pngChunk('bKGD', bytes(0, 0, 0, 0, 0, 0)),
      pngChunk('cICP', bytes(1, 13, 0, 1)),
      pngChunk('cLLI', Buffer.alloc(8)),
      pngChunk('mDCV', Buffer.alloc(24)),
    ]
    const out = sanitisePng(solidPng(400, 300, { before: kept }))

    for (const chunk of kept) expect(out.bytes.indexOf(chunk)).toBeGreaterThan(0)
    expect(out.removed).toEqual([])
  })

  it('turns an APNG into its still picture and says the animation went', () => {
    const file = solidPng(400, 300, {
      before: [pngChunk('acTL', bytes(0, 0, 0, 2, 0, 0, 0, 0)), pngChunk('fcTL', Buffer.alloc(26))],
      after: [pngChunk('fcTL', Buffer.alloc(26)), pngChunk('fdAT', Buffer.alloc(12))],
    })
    const out = sanitisePng(file)

    expect(chunkTypes(out.bytes)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(out.removed).toContain('animation (kept as a still picture)')
  })

  it('drops bytes after IEND', () => {
    const out = sanitisePng(solidPng(400, 300, { trailing: bytes('<html><script>x()</script>') }))

    expect(out.bytes.toString('latin1')).not.toContain('<html>')
    expect(out.bytes.subarray(-12).equals(pngChunk('IEND'))).toBe(true)
    expect(out.removed).toContain('data after the end of the image')
  })

  it('is idempotent', () => {
    const once = sanitisePng(solidPng(400, 300, { text: 'hello' }))

    expect(sanitisePng(once.bytes).bytes.equals(once.bytes)).toBe(true)
  })

  it.each([
    [
      'a bad CRC',
      Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', Buffer.alloc(13), { badCrc: true })]),
    ],
    [
      'IHDR not first',
      Buffer.concat([PNG_SIGNATURE, pngChunk('gAMA', bytes(0, 0, 0, 1)), ihdr(10, 10)]),
    ],
    ['an unknown critical chunk', solidPng(400, 300, { before: [pngChunk('ZZZZ', bytes('x'))] })],
    ['no IDAT', Buffer.concat([PNG_SIGNATURE, ihdr(400, 300), pngChunk('IEND')])],
    ['no IEND', Buffer.concat([PNG_SIGNATURE, ihdr(400, 300), solidIdat(400, 300)])],
    ['truncation mid-chunk', solidPng(400, 300).subarray(0, 60)],
    ['a wrong signature', bytes(0x89, 'PNX', 0x0d, 0x0a, 0x1a, 0x0a)],
    [
      'a zero width',
      Buffer.concat([PNG_SIGNATURE, ihdr(0, 10), solidIdat(1, 1), pngChunk('IEND')]),
    ],
    [
      'a short IHDR',
      Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', Buffer.alloc(12)), pngChunk('IEND')]),
    ],
    [
      'an impossible bit depth',
      Buffer.concat([
        PNG_SIGNATURE,
        pngChunk(
          'IHDR',
          Buffer.concat([Buffer.from([0, 0, 0, 9, 0, 0, 0, 9]), bytes(7, 2, 0, 0, 0)]),
        ),
        pngChunk('IEND'),
      ]),
    ],
    [
      'an unknown compression method',
      Buffer.concat([
        PNG_SIGNATURE,
        pngChunk(
          'IHDR',
          Buffer.concat([Buffer.from([0, 0, 0, 9, 0, 0, 0, 9]), bytes(8, 2, 1, 0, 0)]),
        ),
        pngChunk('IEND'),
      ]),
    ],
    ['two headers', Buffer.concat([PNG_SIGNATURE, ihdr(4, 4), ihdr(4, 4), pngChunk('IEND')])],
    [
      'a chunk with a name that is not letters',
      Buffer.concat([PNG_SIGNATURE, ihdr(4, 4), pngChunk('ID4T', bytes(1))]),
    ],
  ])('refuses %s', (_name, file) => {
    expect(refusalCode(() => sanitisePng(file))).toBe('MALFORMED_IMAGE')
  })
})
