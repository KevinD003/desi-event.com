/**
 * Event pictures in the browser and on the server: where to fetch one, how to
 * upload one, and a plain-English check before the upload starts.
 *
 * Every picture this site shows is its own: `/api/v1/media/<id>` through the
 * same-origin proxy, or `/_next/image` over that. A URL that does not have
 * exactly that shape is not used, so a payload carrying anything else — a
 * third-party address, a path with a query — draws the poster instead.
 *
 * Imports the narrow `@desi-event/schemas/media` subpath, never the barrel.
 *
 * @module lib/media
 */

import { MEDIA_LIMITS, MEDIA_URL_PATTERN, sniffImageType } from '@desi-event/schemas/media'

/** What a refused format is called, for the sentence a person reads. */
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

/**
 * The same-origin address of a picture, or null when the payload's URL is not
 * one this site serves.
 *
 * @param {{url?: string}|null|undefined} image A `publicMediaSchema` or `eventMediaSchema` payload.
 * @returns {string|null} `/api/v1/media/<id>`, or null.
 */
export function mediaSrc(image) {
  const url = image?.url

  if (typeof url !== 'string' || !MEDIA_URL_PATTERN.test(url)) return null

  return `/api${url}`
}

/**
 * The absolute address of a picture, for structured data and social cards.
 *
 * @param {{url?: string}|null|undefined} image The payload.
 * @param {string} siteUrl The site's origin, e.g. `https://desi-event.example`.
 * @returns {string|null} The absolute URL, or null.
 */
export function absoluteMediaUrl(image, siteUrl) {
  const src = mediaSrc(image)

  if (!src || typeof siteUrl !== 'string' || siteUrl.length === 0) return null

  return `${siteUrl.replace(/\/+$/u, '')}${src}`
}

/**
 * A failed read of an event's pictures, as plain data a client component can
 * be handed and `ReadRefusal` can read.
 *
 * Kept distinct from an empty list on purpose. "This event has no pictures"
 * after a read that failed is untrue, and on the moderation page it sits above
 * an approval that approves every picture waiting; in the editor it offers an
 * upload that would replace a cover the page could not show.
 *
 * @param {unknown} error What `callApi` threw.
 * @returns {{status: number, code: string|null, retryAfterSeconds: number|null}} The refusal's facts, never its message.
 */
export function mediaReadFailure(error) {
  const facts = /** @type {{status?: unknown, code?: unknown, retryAfterSeconds?: unknown}} */ (
    error ?? {}
  )

  return {
    status: Number.isInteger(facts.status) ? /** @type {number} */ (facts.status) : 0,
    code: typeof facts.code === 'string' ? facts.code : null,
    retryAfterSeconds: Number.isFinite(facts.retryAfterSeconds)
      ? /** @type {number} */ (facts.retryAfterSeconds)
      : null,
  }
}

/**
 * The upload path for an event, with what the picture is in the query.
 *
 * The body is the file itself; the alt text travels here because it is public
 * page text, not a secret.
 *
 * @param {string} eventId The event.
 * @param {{kind: 'EVENT_COVER'|'EVENT_GALLERY', altText: string, revision: number}} options What the picture is.
 * @returns {string} A path beginning `/v1/`, for `apiFetch`.
 */
export function uploadPath(eventId, { kind, altText, revision }) {
  const query = new URLSearchParams({ kind, altText, revision: String(revision) })

  return `/v1/events/${encodeURIComponent(eventId)}/media?${query.toString()}`
}

/**
 * The size in megabytes, rounded for a sentence.
 *
 * @param {number} bytes The size.
 * @returns {string} e.g. "12.4 MB".
 */
function megabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Check a chosen file before uploading it, in words a person can act on.
 *
 * The same test the server makes first — the bytes, not the name or the
 * declared type — so a mistaken choice is caught before ten megabytes are
 * sent. The server checks everything again; this is a courtesy, not a control.
 *
 * @param {Blob|null|undefined} file The chosen file.
 * @returns {Promise<string|null>} What is wrong with it, or null when it may be sent.
 */
export async function precheckImageFile(file) {
  if (!file) return 'Choose a picture to upload.'
  if (file.size === 0) return 'That file is empty. Choose a JPEG, PNG or WebP picture.'

  if (file.size > MEDIA_LIMITS.maxBytes) {
    return `That file is ${megabytes(file.size)}; pictures can be at most 10 MB. Save a smaller copy and try again.`
  }

  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const { type, looksLike } = sniffImageType(head)

  if (type) return null

  const what = LOOKS_LIKE[looksLike]
  const phone =
    looksLike === 'heic' || looksLike === 'avif'
      ? ' Most phones can save or share a photo as JPEG instead.'
      : ''

  return what
    ? `That file is ${what}, not a JPEG, PNG or WebP picture.${phone}`
    : 'That file is not a JPEG, PNG or WebP picture.'
}
