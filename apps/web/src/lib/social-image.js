/**
 * The picture a shared link shows: the event's approved cover when it can be
 * drawn faithfully, otherwise the event's generated poster.
 *
 * `opengraph-image.js` and `twitter-image.js` beside the event page are both
 * built from here. The renderer (Satori, then Resvg) decodes PNG and JPEG but
 * not WebP, and ignores a JPEG's EXIF orientation, so a WebP cover or a JPEG
 * that is stored on its side falls back to the poster rather than appearing
 * wrong. A cover above 12 megapixels falls back too, to bound the renderer's
 * memory.
 *
 * The image's id names what it shows — `cover-<asset id>` or
 * `poster-<category>` — so the URL changes when the cover does and no cache
 * keeps serving a picture a moderator took down under the same address.
 *
 * Only reached for an event an anonymous caller may see, and the cover is
 * fetched anonymously: a picture that is not public cannot be drawn here.
 *
 * @module lib/social-image
 */

import { createElement } from 'react'

import {
  MEDIA_LIMITS,
  PUBLIC_MEDIA_MAX_AGE_SECONDS,
  readJpegOrientation,
  sniffImageType,
} from '@desi-event/schemas/media'

import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { loadEventBySlug } from './api.js'
import { getApiBaseUrl } from './api-client.js'
import { mediaSrc } from './media.js'
import { describePoster, toSvgString } from './poster-art.js'

/** A social card's size, as Open Graph and X both recommend. */
export const SOCIAL_IMAGE_SIZE = Object.freeze({ width: 1200, height: 630 })

/** How long a social card may be cached: the same day a picture may. */
export const SOCIAL_IMAGE_CACHE_CONTROL = `public, max-age=${PUBLIC_MEDIA_MAX_AGE_SECONDS}`

/** The two formats the renderer decodes. */
const EMBEDDABLE_TYPES = new Set(['image/png', 'image/jpeg'])

/**
 * The id and alt text of an event's social image.
 *
 * @param {object} event An event payload carrying `title`, `category` and maybe `coverImage`.
 * @returns {{id: string, alt: string}} The metadata.
 */
export function socialImageFor(event) {
  const cover = mediaSrc(event?.coverImage) ? event.coverImage : null

  if (cover) return { id: `cover-${cover.id}`, alt: cover.altText }

  const category = String(event?.category ?? 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')

  return {
    id: `poster-${category}`,
    alt: `${describePoster(event?.category)} for ${event?.title ?? 'this event'}`,
  }
}

/**
 * Whether a cover is one the renderer can draw, judged from its payload.
 *
 * @param {object|null|undefined} cover The event's `coverImage`.
 * @returns {boolean} True for a PNG or JPEG of at most 12 megapixels.
 */
export function coverIsEmbeddable(cover) {
  return (
    Boolean(mediaSrc(cover)) &&
    EMBEDDABLE_TYPES.has(cover.contentType) &&
    cover.width * cover.height <= MEDIA_LIMITS.socialEmbedMaxPixels
  )
}

/**
 * What to draw: the cover's bytes, or the poster.
 *
 * Pure, so the rules are testable without a renderer: a cover is drawn only
 * when its payload says it can be, its bytes arrived, they are the type the
 * payload said, and — for a JPEG — nothing asks for it to be turned.
 *
 * @param {object} options Options.
 * @param {object} options.event The event payload.
 * @param {Uint8Array|null} [options.bytes] The cover's bytes, when they were fetched.
 * @returns {{kind: 'cover', src: string, reason: null}|{kind: 'poster', src: string, reason: string}} The plan.
 */
export function socialImagePlan({ event, bytes = null }) {
  const cover = event?.coverImage ?? null
  /** @type {string|null} */
  let reason = null

  if (!mediaSrc(cover)) reason = 'no cover'
  else if (!EMBEDDABLE_TYPES.has(cover.contentType)) reason = 'the renderer cannot decode this type'
  else if (cover.width * cover.height > MEDIA_LIMITS.socialEmbedMaxPixels) reason = 'too large'
  else if (!bytes || bytes.length === 0) reason = 'the cover could not be fetched'
  else if (sniffImageType(bytes).type !== cover.contentType)
    reason = 'the bytes are not what the payload said'
  else if (cover.contentType === 'image/jpeg' && ![null, 1].includes(readJpegOrientation(bytes))) {
    reason = 'the cover is stored turned'
  }

  if (reason === null) {
    return {
      kind: 'cover',
      src: `data:${cover.contentType};base64,${Buffer.from(bytes).toString('base64')}`,
      reason: null,
    }
  }

  return { kind: 'poster', src: posterDataUri(event), reason }
}

/**
 * The event's poster as an SVG data URI, cropped to the social card's shape.
 *
 * @param {object} event The event payload.
 * @returns {string} A `data:image/svg+xml` URI.
 */
export function posterDataUri(event) {
  const svg = toSvgString({
    seed: event?.slug ?? event?.id ?? 'desi-event',
    category: event?.category,
    variant: 'hero',
    idPrefix: 'social',
    title: socialImageFor(event).alt,
  }).replace(
    '<svg ',
    `<svg width="${SOCIAL_IMAGE_SIZE.width}" height="${SOCIAL_IMAGE_SIZE.height}" preserveAspectRatio="xMidYMid slice" `,
  )

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/**
 * Fetch a public cover's bytes from the API, anonymously.
 *
 * No cookie and no credential: a social card is for anybody, so the only
 * picture it may draw is one the API serves to anybody.
 *
 * @param {object} cover The event's `coverImage`.
 * @returns {Promise<Uint8Array|null>} The bytes, or null.
 */
export async function fetchPublicCover(cover) {
  if (!mediaSrc(cover)) return null

  try {
    const response = await fetch(`${getApiBaseUrl()}${cover.url}`, { cache: 'no-store' })

    if (!response.ok) return null

    const bytes = new Uint8Array(await response.arrayBuffer())

    return bytes.length > 0 && bytes.length <= MEDIA_LIMITS.maxBytes ? bytes : null
  } catch {
    return null
  }
}

/**
 * The event a card is drawn for, when an anonymous caller may see it.
 *
 * Read anonymously — the loader forwards no cookie — and refused for any
 * status that is not publicly visible, so no card ever describes a draft.
 *
 * @param {Promise<{slug: string}>|{slug: string}} params The route parameters.
 * @param {object} [options] Options.
 * @param {Function} [options.load] Given the slug, resolves `{ event }`; the API's loader by default.
 * @returns {Promise<object|null>} The event, or null.
 */
export async function publicEventForCard(params, { load = loadEventBySlug } = {}) {
  const { slug } = await params
  const { event } = await load(slug)

  return event && PUBLICLY_VISIBLE_STATUSES.has(event.status) ? event : null
}

/**
 * Render an event's social card.
 *
 * @param {object} options Options.
 * @param {object} options.event The event payload, as an anonymous caller receives it.
 * @param {function(object): Promise<Uint8Array|null>} [options.fetchCover] Fetches the cover's bytes.
 * @param {Function} options.ImageResponse The `next/og` renderer, passed in so this module stays testable.
 * @returns {Promise<Response>} A 1200 × 630 PNG, cacheable for a day.
 */
export async function renderSocialImage({ event, fetchCover = fetchPublicCover, ImageResponse }) {
  const bytes = coverIsEmbeddable(event?.coverImage) ? await fetchCover(event.coverImage) : null
  const plan = socialImagePlan({ event, bytes })

  return new ImageResponse(
    createElement(
      'div',
      { style: { display: 'flex', width: '100%', height: '100%' } },
      createElement('img', {
        src: plan.src,
        width: SOCIAL_IMAGE_SIZE.width,
        height: SOCIAL_IMAGE_SIZE.height,
        style: { width: '100%', height: '100%', objectFit: 'cover' },
      }),
    ),
    { ...SOCIAL_IMAGE_SIZE, headers: { 'cache-control': SOCIAL_IMAGE_CACHE_CONTROL } },
  )
}
