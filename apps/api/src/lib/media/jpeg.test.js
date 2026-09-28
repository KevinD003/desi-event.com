import { describe, expect, it } from 'vitest'

import { readJpegOrientation } from '@desi-event/schemas/media'

import {
  ADOBE,
  COMMENT,
  DHT,
  DQT,
  ENTROPY,
  JFIF,
  SOS,
  XMP,
  bytes,
  cameraJpeg,
  exifSegment,
  iccSegment,
  jpeg,
  segment,
  sof,
} from '../../../tests/helpers/images.js'
import { orientationSegment, sanitiseJpeg } from './jpeg.js'
import { MediaRefusal } from './refusal.js'

/**
 * Whether `haystack` contains `needle`.
 *
 * @param {Buffer} haystack The bytes searched.
 * @param {string|Buffer} needle What to find.
 * @returns {boolean} True when found.
 */
function contains(haystack, needle) {
  return haystack.indexOf(typeof needle === 'string' ? Buffer.from(needle, 'latin1') : needle) >= 0
}

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

describe('sanitiseJpeg: what it strips', () => {
  const camera = cameraJpeg(1600, 1200)
  const clean = sanitiseJpeg(camera)

  it.each([
    ['EXIF with a camera make', 'SecretCam'],
    ['the GPS position', 'GPSLAT'],
    ['the EXIF header itself', bytes('Exif', 0, 0)],
    ['XMP', 'http://ns.adobe.com/xap'],
    ['the XMP location', 'GPSLatitude'],
    ['IPTC', 'Photoshop 3.0'],
    ['the IPTC byline', 'IPTC-BYLINE'],
    ['the comment', 'private comment'],
    ['the JFXX thumbnail', 'thumbnail-bytes'],
    ['the MPF index', 'second-image-index'],
  ])('removes %s', (_name, marker) => {
    expect(contains(camera, marker)).toBe(true)
    expect(contains(clean.bytes, marker)).toBe(false)
  })

  it('removes a second image appended after EOI', () => {
    const eoi = clean.bytes.lastIndexOf(bytes(0xff, 0xd9))

    expect(eoi).toBe(clean.bytes.length - 2)
    // Exactly one SOI: the appended image's is gone.
    expect(clean.bytes.indexOf(bytes(0xff, 0xd8), 1)).toBe(-1)
  })

  it('says what it removed, in plain words', () => {
    expect(clean.removed).toEqual(
      expect.arrayContaining([
        'an embedded thumbnail',
        'camera and location details (EXIF)',
        'XMP metadata',
        'additional images (MPF)',
        'IPTC and Photoshop details',
        'comments',
        'data after the end of the image',
      ]),
    )
  })

  it('drops a thumbnail embedded in the JFIF segment itself, keeping its fixed fields', () => {
    // Version 1.02, dots per inch, 300 × 300, and a 2 × 2 RGB thumbnail.
    const thumbnail = bytes('THUMBPIXELS!')
    const withThumbnail = segment(
      0xe0,
      bytes('JFIF', 0, 1, 2, 1, 1, 0x2c, 1, 0x2c, 2, 2, thumbnail),
    )
    const out = sanitiseJpeg(jpeg(1000, 600, { head: [withThumbnail] }))

    expect(contains(out.bytes, thumbnail)).toBe(false)
    // The rebuilt APP0: the same version and density, and a 0 × 0 thumbnail.
    expect(out.bytes.subarray(2, 20)).toEqual(
      segment(0xe0, bytes('JFIF', 0, 1, 2, 1, 1, 0x2c, 1, 0x2c, 0, 0)),
    )
    expect(out.removed).toContain('an embedded thumbnail')
    expect(sanitiseJpeg(out.bytes).bytes.equals(out.bytes)).toBe(true)
  })

  it('drops bytes smuggled after the JFIF header', () => {
    const smuggled = bytes('<script>alert(1)</script>')
    const padded = segment(0xe0, Buffer.concat([JFIF.subarray(4), smuggled]))
    const out = sanitiseJpeg(jpeg(1000, 600, { head: [padded] }))

    expect(contains(out.bytes, smuggled)).toBe(false)
    expect(contains(out.bytes, 'script')).toBe(false)
    expect(out.bytes.indexOf(JFIF)).toBe(2)
    expect(out.removed).toContain('application data')
  })

  it('drops a JFIF segment too short to hold its own header', () => {
    const short = segment(0xe0, bytes('JFIF', 0, 1, 1))
    const out = sanitiseJpeg(jpeg(1000, 600, { head: [short] }))

    expect(contains(out.bytes, 'JFIF')).toBe(false)
    expect(out.removed).toContain('application data')
  })

  it('drops an unknown APPn', () => {
    const out = sanitiseJpeg(jpeg(1000, 600, { head: [JFIF, segment(0xe5, bytes('vendor-data'))] }))

    expect(contains(out.bytes, 'vendor-data')).toBe(false)
    expect(out.removed).toContain('application data')
  })
})

describe('sanitiseJpeg: what it keeps', () => {
  it('keeps JFIF, a multi-part ICC profile and Adobe APP14 byte for byte', () => {
    const icc1 = iccSegment(1, 2, 'profile-part-one')
    const icc2 = iccSegment(2, 2, 'profile-part-two')
    const out = sanitiseJpeg(jpeg(1000, 600, { head: [JFIF, icc1, icc2, ADOBE, COMMENT] }))

    expect(contains(out.bytes, JFIF)).toBe(true)
    expect(contains(out.bytes, Buffer.concat([icc1, icc2]))).toBe(true)
    expect(contains(out.bytes, ADOBE)).toBe(true)
  })

  it('copies DQT, DHT, the frame, the scan header and the entropy data unchanged', () => {
    const out = sanitiseJpeg(jpeg(1000, 600, { head: [JFIF, XMP] }))

    expect(contains(out.bytes, DQT)).toBe(true)
    expect(contains(out.bytes, DHT)).toBe(true)
    expect(contains(out.bytes, sof(1000, 600))).toBe(true)
    // FF00 stuffing and RST0-7 inside the scan are data, copied verbatim.
    expect(contains(out.bytes, Buffer.concat([SOS, ENTROPY, bytes(0xff, 0xd9)]))).toBe(true)
  })

  it('refuses an Adobe APP14 too large to be the colour record, as application data', () => {
    const big = segment(0xee, bytes('Adobe', Buffer.alloc(40, 1)))
    const out = sanitiseJpeg(jpeg(1000, 600, { head: [JFIF, big] }))

    expect(contains(out.bytes, big)).toBe(false)
  })

  it('keeps one JFIF only', () => {
    const out = sanitiseJpeg(jpeg(1000, 600, { head: [JFIF, JFIF] }))

    expect(out.bytes.indexOf(JFIF)).toBe(2)
    expect(out.bytes.indexOf(JFIF, 3)).toBe(-1)
  })

  it('accepts progressive and extended frames', () => {
    expect(sanitiseJpeg(jpeg(1000, 600, { frame: 0xc2 })).width).toBe(1000)
    expect(sanitiseJpeg(jpeg(1000, 600, { frame: 0xc1 })).height).toBe(600)
  })

  it('accepts fill bytes before a marker and a TEM marker', () => {
    const file = Buffer.concat([
      bytes(0xff, 0xd8, 0xff, 0xff, 0xff),
      JFIF.subarray(1),
      bytes(0xff, 0x01),
      DQT,
      sof(1000, 600),
      DHT,
      SOS,
      ENTROPY,
      bytes(0xff, 0xd9),
    ])

    expect(sanitiseJpeg(file).width).toBe(1000)
  })
})

describe('sanitiseJpeg: orientation', () => {
  it('keeps orientation 6 as a minimal APP1, and reports the displayed size', () => {
    const out = sanitiseJpeg(cameraJpeg(1600, 1200, { orientation: 6 }))

    expect(out.orientation).toBe(6)
    expect(out.width).toBe(1200)
    expect(out.height).toBe(1600)
    expect(readJpegOrientation(out.bytes)).toBe(6)
    expect(contains(out.bytes, orientationSegment(6))).toBe(true)
    expect(contains(out.bytes, 'SecretCam')).toBe(false)
    expect(contains(out.bytes, 'GPSLAT')).toBe(false)
  })

  it('writes an APP1 that holds the one tag and nothing else', () => {
    const app1 = orientationSegment(8)
    // Marker, length, `Exif\0\0`, TIFF header, one entry, no next IFD.
    expect(app1.length).toBe(4 + 6 + 8 + 2 + 12 + 4)
    expect(readJpegOrientation(Buffer.concat([bytes(0xff, 0xd8), app1]))).toBe(8)
  })

  it('writes no APP1 for orientation 1, or for none', () => {
    const upright = sanitiseJpeg(jpeg(1000, 600, { head: [exifSegment({ orientation: 1 })] }))

    expect(upright.orientation).toBe(1)
    expect(contains(upright.bytes, bytes('Exif', 0, 0))).toBe(false)
    expect(upright.width).toBe(1000)

    expect(sanitiseJpeg(jpeg(1000, 600)).orientation).toBeNull()
  })

  it('does not swap for orientations 2 to 4', () => {
    const out = sanitiseJpeg(jpeg(1000, 600, { head: [exifSegment({ orientation: 3 })] }))

    expect([out.width, out.height]).toEqual([1000, 600])
  })

  it('is idempotent: sanitising the output changes nothing', () => {
    const once = sanitiseJpeg(cameraJpeg(1600, 1200, { orientation: 5 }))
    const twice = sanitiseJpeg(once.bytes)

    expect(twice.bytes.equals(once.bytes)).toBe(true)
    expect([twice.width, twice.height]).toEqual([once.width, once.height])
  })
})

describe('sanitiseJpeg: refusals', () => {
  it.each([
    ['no SOI', bytes('not a jpeg at all')],
    ['a truncated segment length', bytes(0xff, 0xd8, 0xff, 0xe0, 0x40, 0x00, 'JFIF')],
    ['a length shorter than itself', bytes(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01)],
    ['a lossless frame (SOF3)', jpeg(1000, 600, { frame: 0xc3 })],
    ['an arithmetic frame (SOF9)', jpeg(1000, 600, { frame: 0xc9 })],
    ['a hierarchical frame (SOF5)', jpeg(1000, 600, { frame: 0xc5 })],
    ['no scan', jpeg(1000, 600, { scan: false })],
    ['no EOI', jpeg(1000, 600, { eoi: false })],
    ['zero height', jpeg(1000, 0)],
    ['zero width', jpeg(0, 600)],
    [
      'a second frame',
      Buffer.concat([jpeg(1000, 600, { eoi: false, scan: false }), sof(1000, 600)]),
    ],
    ['a DAC segment', jpeg(1000, 600, { head: [segment(0xcc, bytes(0, 0))] })],
    ['a JPGn segment', jpeg(1000, 600, { head: [segment(0xf3, bytes(0, 0))] })],
    ['a restart marker outside a scan', jpeg(1000, 600, { head: [bytes(0xff, 0xd3)] })],
    ['data where a marker belongs', jpeg(1000, 600, { head: [bytes(0x00, 0x11)] })],
    [
      'a scan before the frame',
      Buffer.concat([bytes(0xff, 0xd8), SOS, ENTROPY, bytes(0xff, 0xd9)]),
    ],
    ['a second SOI', jpeg(1000, 600, { head: [bytes(0xff, 0xd8)] })],
    ['a damaged frame header', jpeg(1000, 600, { head: [segment(0xc0, bytes(8, 0))] })],
  ])('refuses %s as MALFORMED_IMAGE', (_name, file) => {
    const refusal = refusalOf(() => sanitiseJpeg(file))

    expect(refusal?.code).toBe('MALFORMED_IMAGE')
    expect(refusal?.statusCode).toBe(422)
  })

  it('refuses a file that ends inside its entropy data', () => {
    const file = Buffer.concat([bytes(0xff, 0xd8), DQT, sof(1000, 600), DHT, SOS, bytes(1, 2, 3)])

    expect(refusalOf(() => sanitiseJpeg(file))?.message).toMatch(/middle of its image data/)
  })

  it('accepts a Uint8Array as well as a Buffer', () => {
    const file = jpeg(1000, 600)

    expect(sanitiseJpeg(new Uint8Array(file)).width).toBe(1000)
  })
})
