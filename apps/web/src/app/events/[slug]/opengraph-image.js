/**
 * The Open Graph card for an event page.
 *
 * File-based, so it takes precedence over anything `generateMetadata` might
 * say about images. One image per event, whose id names what it shows —
 * `cover-<asset id>` or `poster-<category>` — so the address changes when the
 * cover does. The event is loaded anonymously, and only a publicly visible one
 * gets a card; everything else is a 404.
 *
 * See `lib/social-image.js` for what is drawn and why.
 *
 * @module app/events/slug/opengraph-image
 */

import { ImageResponse } from 'next/og'

import { publicEventForCard, renderSocialImage, socialImageFor } from '../../../lib/social-image.js'

/** Rendered per request: the cover can change, and so can the event's status. */
export const dynamic = 'force-dynamic'

export const contentType = 'image/png'

export const size = { width: 1200, height: 630 }

/**
 * The one image this page offers, and its alt text.
 *
 * @param {{params: Promise<{slug: string}>|{slug: string}}} props The route props.
 * @returns {Promise<object[]>} The image metadata, or none for an event nobody may see.
 */
export async function generateImageMetadata({ params }) {
  const event = await publicEventForCard(params)

  if (!event) return []

  const { id, alt } = socialImageFor(event)

  return [{ id, alt, size, contentType }]
}

/**
 * Draw the card.
 *
 * @param {{params: Promise<{slug: string}>}} props The route props.
 * @returns {Promise<Response>} The PNG, or a 404.
 */
export default async function Image({ params }) {
  const event = await publicEventForCard(params)

  if (!event) {
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  }

  return renderSocialImage({ event, ImageResponse })
}
