import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { MEDIA_LIMITS, sniffImageType } from '@desi-event/schemas/media'

import {
  SVG_AS_PNG,
  bytes,
  cameraJpeg,
  jpeg,
  metadataWebp,
  pngChunk,
  riffChunk,
  solidPng,
  vp8Data,
  vp8lData,
  webp,
} from '../../../tests/helpers/images.js'
import { sanitiseJpeg } from './jpeg.js'
import { sanitisePng } from './png.js'
import { MEDIA_REFUSALS, MediaRefusal } from './refusal.js'
import { assertDimensions, sanitiseImage } from './sanitise.js'
import { sanitiseWebp } from './webp.js'

/**
 * The refusal a call throws, or null.
 *
 * @param {Function} run The call.
 * @returns {MediaRefusal|null} The refusal.
 */
function refusalOf(run) {
  try {
    run()
  } catch (error) {
    if (error instanceof MediaRefusal) return error
    throw error
  }

  return null
}

/**
 * A small seeded PRNG (mulberry32), so a fuzz failure reproduces.
 *
 * @param {number} seed The seed.
 * @returns {function(): number} A generator of floats in [0, 1).
 */
function prng(seed) {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('sanitiseImage: limits', () => {
  it('refuses a cover below 960 × 540', () => {
    const refusal = refusalOf(() => sanitiseImage(solidPng(959, 600), { kind: 'EVENT_COVER' }))

    expect(refusal?.code).toBe('IMAGE_TOO_SMALL')
    expect(refusal?.statusCode).toBe(422)
    expect(refusalOf(() => sanitiseImage(solidPng(1000, 539), { kind: 'EVENT_COVER' }))?.code).toBe(
      'IMAGE_TOO_SMALL',
    )
  })

  it('accepts a 1080 × 1350 flyer as a cover', () => {
    expect(sanitiseImage(jpeg(1080, 1350), { kind: 'EVENT_COVER' }).height).toBe(1350)
  })

  it('refuses a gallery picture below 320 on its shorter side, and takes one at 320', () => {
    expect(
      refusalOf(() => sanitiseImage(solidPng(1000, 319), { kind: 'EVENT_GALLERY' }))?.code,
    ).toBe('IMAGE_TOO_SMALL')
    expect(sanitiseImage(solidPng(320, 320), { kind: 'EVENT_GALLERY' }).width).toBe(320)
  })

  it('refuses a side over 8000 or more than 40 megapixels, without decoding a pixel', () => {
    expect(refusalOf(() => sanitiseImage(jpeg(8001, 600), { kind: 'EVENT_COVER' }))?.code).toBe(
      'IMAGE_TOO_LARGE',
    )
    expect(refusalOf(() => sanitiseImage(jpeg(7000, 6000), { kind: 'EVENT_COVER' }))?.code).toBe(
      'IMAGE_TOO_LARGE',
    )
    expect(sanitiseImage(jpeg(8000, 5000), { kind: 'EVENT_COVER' }).width).toBe(8000)
  })

  it('judges the displayed size, after the orientation turns it', () => {
    // 1600 × 900 on the sensor, turned a quarter: 900 × 1600 on the page,
    // which is too narrow for a cover.
    expect(
      refusalOf(() =>
        sanitiseImage(cameraJpeg(1600, 900, { orientation: 6 }), { kind: 'EVENT_COVER' }),
      )?.code,
    ).toBe('IMAGE_TOO_SMALL')
  })

  it('checks dimensions directly as well', () => {
    expect(() => assertDimensions({ width: 1000, height: 600 }, 'EVENT_COVER')).not.toThrow()
    expect(() => assertDimensions({ width: 300, height: 1000 }, 'EVENT_GALLERY')).toThrow(
      MediaRefusal,
    )
  })

  it('refuses an empty upload with 400 and an oversized one with 413', () => {
    expect(
      refusalOf(() => sanitiseImage(Buffer.alloc(0), { kind: 'EVENT_COVER' }))?.statusCode,
    ).toBe(400)
    expect(refusalOf(() => sanitiseImage(null, { kind: 'EVENT_COVER' }))?.code).toBe('EMPTY_UPLOAD')
    expect(
      refusalOf(() =>
        sanitiseImage(Buffer.alloc(MEDIA_LIMITS.maxBytes + 1), { kind: 'EVENT_COVER' }),
      )?.statusCode,
    ).toBe(413)
  })
})

describe('sanitiseImage: what it returns', () => {
  it.each([
    ['JPEG', cameraJpeg(1600, 1200), 'image/jpeg'],
    ['PNG', solidPng(1200, 630, { text: 'secret' }), 'image/png'],
    ['WebP', metadataWebp(1200, 630), 'image/webp'],
  ])('returns a %s whose checksum is the SHA-256 of the stored bytes', (_name, file, type) => {
    const out = sanitiseImage(file, { kind: 'EVENT_COVER' })

    expect(out.contentType).toBe(type)
    expect(out.byteSize).toBe(out.bytes.length)
    expect(out.checksum).toBe(createHash('sha256').update(out.bytes).digest('hex'))
    expect(out.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(out.removed.length).toBeGreaterThan(0)
    expect(out.removed.length).toBeLessThanOrEqual(10)
  })

  it('never stores EXIF with GPS, XMP, PNG text or eXIf', () => {
    const outputs = [
      sanitiseImage(cameraJpeg(1600, 1200, { orientation: 6 }), { kind: 'EVENT_COVER' }),
      sanitiseImage(
        solidPng(1200, 630, {
          text: 'secret',
          before: [pngChunk('eXIf', bytes('MM', 0, 0x2a, 'GPSLAT'))],
        }),
        { kind: 'EVENT_COVER' },
      ),
      sanitiseImage(metadataWebp(1200, 630), { kind: 'EVENT_COVER' }),
    ].map((out) => out.bytes.toString('latin1'))

    for (const text of outputs) {
      expect(text).not.toContain('GPSLAT')
      expect(text).not.toContain('SecretCam')
      expect(text).not.toContain('http://ns.adobe.com/xap')
      expect(text).not.toContain('tEXt')
      expect(text).not.toContain('eXIf')
    }
  })

  it('ignores whatever the upload claimed and reads the bytes', () => {
    // No declared type is passed at all: there is nothing to trust but bytes.
    expect(
      sanitiseImage(webp([riffChunk('VP8L', vp8lData(1000, 600))]), { kind: 'EVENT_COVER' })
        .contentType,
    ).toBe('image/webp')
  })
})

describe('sanitiseImage: what it refuses by type', () => {
  it.each([
    ['an SVG named cover.png', SVG_AS_PNG, 'an SVG drawing'],
    ['HTML', bytes('<!doctype html><html><body>hi</body></html>'), 'a web page'],
    ['a GIF', bytes('GIF89a', 1, 0, 1, 0, 0, 0, 0), 'a GIF'],
    ['a HEIC', bytes(0, 0, 0, 24, 'ftypheic', 0, 0, 0, 0, 'mif1heic'), 'a HEIC photo'],
    ['an AVIF', bytes(0, 0, 0, 24, 'ftypavif', 0, 0, 0, 0, 'mif1avif'), 'an AVIF picture'],
    ['a PDF', bytes('%PDF-1.7\n%'), 'a PDF'],
    ['a ZIP', bytes('PK', 3, 4, 20, 0, 0, 0), 'an archive'],
    ['a BMP', bytes('BM', Buffer.alloc(20)), 'a BMP picture'],
    ['a TIFF', bytes('II', 0x2a, 0, 8, 0, 0, 0), 'a TIFF picture'],
  ])('refuses %s with 415 and names what it is', (_name, file, what) => {
    const refusal = refusalOf(() => sanitiseImage(file, { kind: 'EVENT_GALLERY' }))

    expect(refusal?.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(refusal?.statusCode).toBe(415)
    expect(refusal?.message).toContain(what)
    expect(refusal?.message).toContain('not a JPEG, PNG or WebP')
  })

  it.each([
    ['a JSON array that starts like a JPEG', [255, 216, 255, 224, 0, 16]],
    ['a JSON object', { 0: 255, 1: 216, 2: 255, length: 3 }],
    ['a string', 'ÿØÿà'],
  ])('refuses %s with 415 rather than crashing: only bytes are a picture', (_name, body) => {
    const refusal = refusalOf(() => sanitiseImage(body, { kind: 'EVENT_COVER' }))

    expect(refusal?.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(refusal?.statusCode).toBe(415)
  })

  it('refuses bytes that resemble nothing with the plain sentence', () => {
    expect(
      refusalOf(() => sanitiseImage(bytes('hello world'), { kind: 'EVENT_COVER' }))?.message,
    ).toBe(MEDIA_REFUSALS.UNSUPPORTED_MEDIA_TYPE.message)
  })

  it('suggests JPEG for a phone photo', () => {
    expect(
      refusalOf(() =>
        sanitiseImage(bytes(0, 0, 0, 24, 'ftypheic', 0, 0, 0, 0), { kind: 'EVENT_COVER' }),
      )?.message,
    ).toMatch(/save or share a photo as JPEG/)
  })

  it('refuses an animated WebP', () => {
    const animated = webp([
      riffChunk('VP8X', Buffer.from([0x02, 0, 0, 0, 0xe7, 0x03, 0, 0x57, 0x02, 0])),
      riffChunk('VP8 ', vp8Data(1000, 600)),
    ])

    expect(refusalOf(() => sanitiseImage(animated, { kind: 'EVENT_COVER' }))?.code).toBe(
      'ANIMATED_IMAGE',
    )
  })
})

describe('MediaRefusal', () => {
  it('falls back to MALFORMED_IMAGE for an unknown code', () => {
    const refusal = new MediaRefusal('NOPE')

    expect(refusal.code).toBe('MALFORMED_IMAGE')
    expect(refusal.statusCode).toBe(422)
    expect(refusal.name).toBe('MediaRefusal')
  })
})

describe('seeded fuzz', () => {
  const random = prng(0x5eed_ed)
  const seeds = [
    jpeg(1000, 600),
    cameraJpeg(1600, 1200, { orientation: 6 }),
    solidPng(400, 400, { text: 'x' }),
    metadataWebp(1000, 600),
    webp([riffChunk('VP8L', vp8lData(1000, 600))]),
  ]

  /**
   * One hostile input: random bytes, a truncation, byte flips, a spliced
   * length, or a random insertion into a real file.
   *
   * @param {number} round The round.
   * @returns {Buffer} The input.
   */
  function hostile(round) {
    const pick = (n) => Math.floor(random() * n)

    if (round % 5 === 0) {
      return Buffer.from(Array.from({ length: pick(200) }, () => pick(256)))
    }

    const base = Buffer.from(seeds[pick(seeds.length)])

    switch (round % 5) {
      case 1:
        return base.subarray(0, pick(base.length))
      case 2: {
        for (let flips = 0; flips < 1 + pick(8); flips += 1) base[pick(base.length)] = pick(256)
        return base
      }
      case 3: {
        // Plant 0xFF 0xFF, which reads as a huge length or size wherever it lands.
        const at = pick(base.length - 2)
        base[at] = 0xff
        base[at + 1] = 0xff
        return base
      }
      default: {
        const at = pick(base.length)
        return Buffer.concat([
          base.subarray(0, at),
          Buffer.from(Array.from({ length: 1 + pick(16) }, () => pick(256))),
          base.subarray(at),
        ])
      }
    }
  }

  it('turns 500 hostile inputs into a refusal or a file of the same type, never a crash', () => {
    let refused = 0
    let accepted = 0

    for (let round = 0; round < 500; round += 1) {
      const input = hostile(round)
      const sniffed = sniffImageType(input).type

      try {
        const out = sanitiseImage(input, { kind: 'EVENT_GALLERY' })

        expect(sniffImageType(out.bytes).type, `round ${round}`).toBe(sniffed)
        expect(out.checksum).toMatch(/^[0-9a-f]{64}$/)
        accepted += 1
      } catch (error) {
        expect(error, `round ${round}: ${error?.stack}`).toBeInstanceOf(MediaRefusal)
        refused += 1
      }
    }

    expect(refused + accepted).toBe(500)
    expect(refused).toBeGreaterThan(0)
  })

  it('never lets a walker throw anything but a refusal, even without the pipeline’s net', () => {
    for (let round = 0; round < 500; round += 1) {
      const input = hostile(round)

      for (const walker of [sanitiseJpeg, sanitisePng, sanitiseWebp]) {
        try {
          walker(input)
        } catch (error) {
          expect(error, `round ${round} ${walker.name}: ${error?.stack}`).toBeInstanceOf(
            MediaRefusal,
          )
        }
      }
    }
  })
})
