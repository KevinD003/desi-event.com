/**
 * The X (Twitter) card for an event page.
 *
 * The same picture as the Open Graph card, drawn by the same code; X reads its
 * own tag, so it gets its own file. See `opengraph-image.js` beside this one
 * and `lib/social-image.js`.
 *
 * @module app/events/slug/twitter-image
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
