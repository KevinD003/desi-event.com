/**
 * The picture pipeline: sniff, rebuild, measure, checksum.
 *
 * One entry point for every upload. The first bytes decide the format — the
 * declared Content-Type and the file name are never consulted — and the file is
 * rebuilt by that format's allow-list sanitiser, so what is stored is only the
 * image data, never the original. The size limits are then applied to the
 * *displayed* dimensions, and the checksum is of the bytes that will be stored.
 *
 * No pixel is decoded, so a decompression bomb costs nothing here; the
 * dimension and pixel caps protect everything downstream that will decode it.
 *
 * @module @desi-event/api/lib/media/sanitise
 */

import { createHash } from 'node:crypto'

import { MEDIA_LIMITS, sniffImageType } from '@desi-event/schemas/media'

import { sanitiseJpeg } from './jpeg.js'
import { sanitisePng } from './png.js'
import { MediaRefusal } from './refusal.js'
import { sanitiseWebp } from './webp.js'

/** What a refused format is called in the refusal sentence. */
const LOOKS_LIKE = Object.freeze({
  svg: 'an SVG drawing',
  html: 'a web page',
  gif: 'a GIF',
  heic: 'a HEIC photo',
  avif: 'an AVIF picture',
  pdf: 'a PDF',
  bmp: 'a BMP picture',
  tiff: 'a TIFF picture',
  zip: 'an archive',
})

/** Each stored format's sanitiser. */
const SANITISERS = Object.freeze({
  'image/jpeg': sanitiseJpeg,
  'image/png': sanitisePng,
  'image/webp': sanitiseWebp,
})

/**
 * The refusal for bytes that are none of the three formats.
 *
 * @param {string|null} looksLike What the bytes resemble, from `sniffImageType`.
 * @returns {MediaRefusal} A 415 naming what the file is, where that is known.
 */
function unsupported(looksLike) {
  const what = LOOKS_LIKE[looksLike]
  const heicHint =
    looksLike === 'heic' || looksLike === 'avif'
      ? ' Most phones can save or share a photo as JPEG instead.'
      : ''

  return new MediaRefusal(
    'UNSUPPORTED_MEDIA_TYPE',
    what
      ? `This file is ${what}, not a JPEG, PNG or WebP picture.${heicHint}`
      : 'This file is not a JPEG, PNG or WebP picture.',
  )
}

/**
 * Check the displayed size against the limits for this kind of picture.
 *
 * @param {{width: number, height: number}} size The displayed size.
 * @param {'EVENT_COVER'|'EVENT_GALLERY'} kind What the picture is for.
 * @returns {void}
 * @throws {MediaRefusal} When the picture is too large or too small.
 */
export function assertDimensions({ width, height }, kind) {
  if (
    width > MEDIA_LIMITS.maxSide ||
    height > MEDIA_LIMITS.maxSide ||
    width * height > MEDIA_LIMITS.maxPixels
  ) {
    throw new MediaRefusal(
      'IMAGE_TOO_LARGE',
      `This picture is ${width} × ${height}. No side may be longer than ${MEDIA_LIMITS.maxSide} pixels and the whole picture may hold at most ${MEDIA_LIMITS.maxPixels / 1_000_000} megapixels. Save a smaller copy and try again.`,
    )
  }

  if (
    kind === 'EVENT_COVER' &&
    (width < MEDIA_LIMITS.coverMinWidth || height < MEDIA_LIMITS.coverMinHeight)
  ) {
    throw new MediaRefusal(
      'IMAGE_TOO_SMALL',
      `This picture is ${width} × ${height}. A cover must be at least ${MEDIA_LIMITS.coverMinWidth} × ${MEDIA_LIMITS.coverMinHeight} so it stays sharp across the top of the page.`,
    )
  }

  if (kind === 'EVENT_GALLERY' && Math.min(width, height) < MEDIA_LIMITS.galleryMinSide) {
    throw new MediaRefusal(
      'IMAGE_TOO_SMALL',
      `This picture is ${width} × ${height}. A gallery picture must be at least ${MEDIA_LIMITS.galleryMinSide} pixels on its shorter side.`,
    )
  }
}

/**
 * Sanitise an upload.
 *
 * @param {Uint8Array} bytes The request body.
 * @param {{kind: 'EVENT_COVER'|'EVENT_GALLERY'}} options What the picture is for.
 * @returns {{contentType: string, bytes: Buffer, byteSize: number, width: number, height: number, checksum: string, removed: string[]}} What will be stored.
 * @throws {MediaRefusal} With a 400, 413, 415 or 422 and a sentence the organiser can act on.
 */
export function sanitiseImage(bytes, { kind }) {
  if (bytes === undefined || bytes === null || bytes.length === 0) {
    throw new MediaRefusal('EMPTY_UPLOAD')
  }

  // Only bytes are a picture. A body some other parser turned into a string,
  // an object or an array is refused here too, whatever the route let in.
  if (!(bytes instanceof Uint8Array)) throw new MediaRefusal('UNSUPPORTED_MEDIA_TYPE')

  if (bytes.length > MEDIA_LIMITS.maxBytes) throw new MediaRefusal('PAYLOAD_TOO_LARGE')

  const { type, looksLike } = sniffImageType(bytes)

  if (!type) throw unsupported(looksLike)

  let rebuilt

  try {
    rebuilt = SANITISERS[type](bytes)
  } catch (error) {
    if (error instanceof MediaRefusal) throw error

    // A read past the end the walker did not foresee. The file is hostile or
    // damaged either way, and the answer is a refusal rather than a 500.
    if (error instanceof RangeError) {
      throw new MediaRefusal('MALFORMED_IMAGE')
    }

    throw error
  }

  assertDimensions(rebuilt, kind)

  // Belt and braces: the rebuilt file must still be what it was sniffed as.
  if (sniffImageType(rebuilt.bytes).type !== type) throw new MediaRefusal('MALFORMED_IMAGE')

  if (rebuilt.bytes.length > MEDIA_LIMITS.maxBytes) throw new MediaRefusal('PAYLOAD_TOO_LARGE')

  return {
    contentType: type,
    bytes: rebuilt.bytes,
    byteSize: rebuilt.bytes.length,
    width: rebuilt.width,
    height: rebuilt.height,
    checksum: createHash('sha256').update(rebuilt.bytes).digest('hex'),
    removed: rebuilt.removed.slice(0, 10),
  }
}
