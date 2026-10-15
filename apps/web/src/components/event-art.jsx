/**
 * An event's picture: the organiser's approved cover, or the generated poster.
 *
 * The cover arrives on an event payload only once a moderator has approved it
 * and the event is public, and only as a same-origin URL; anything else draws
 * the poster, which stays the fallback everywhere. The cover goes through
 * `next/image`, so a card gets a sized, re-encoded copy rather than the
 * original upload, and the optimiser — which fetches without cookies — can
 * only ever see a picture the API serves to anybody.
 *
 * The alt text is the organiser's own description. Where the picture sits
 * beside a title that already says what it is — a thumbnail, a basket — it is
 * decorative and says nothing.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-art
 */

import Image from 'next/image'

import { mediaSrc } from '../lib/media.js'
import { EventPoster, VARIANT_CLASSES } from './poster.jsx'

/** What the browser is told about the rendered width, per variant. */
const DEFAULT_SIZES = Object.freeze({
  card: '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
  hero: '100vw',
})

/**
 * @typedef {object} EventArtProps
 * @property {object} event An event or summary carrying `slug`, `title`, `category` and, when approved, `coverImage`.
 * @property {'card'|'hero'} [variant] Sizing, as `EventPoster` takes it.
 * @property {string} [className] Extra classes for the frame.
 * @property {boolean} [priority] Preload the cover: for the page's largest picture only.
 * @property {boolean} [decorative] Whether a title beside it already says what it is; the alt text is then empty.
 * @property {string} [sizes] The `sizes` attribute, when the default does not fit the layout.
 */

/**
 * The event's picture.
 *
 * @param {EventArtProps} props Component props.
 * @returns {JSX.Element} The cover or the poster.
 */
export function EventArt({
  event,
  variant = 'card',
  className,
  priority = false,
  decorative = false,
  sizes,
}) {
  const cover = event?.coverImage ?? null
  const src = mediaSrc(cover)

  if (!src) return <EventPoster event={event} variant={variant} className={className} />

  const scene = variant === 'hero' ? 'hero' : 'card'

  return (
    <div
      data-slot="event-art"
      className={[
        'relative block w-full overflow-hidden bg-surface-subtle',
        VARIANT_CLASSES[scene],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Image
        src={src}
        alt={decorative ? '' : cover.altText}
        fill
        sizes={sizes ?? DEFAULT_SIZES[scene]}
        className="object-cover"
        {...(priority ? { preload: true } : {})}
      />
    </div>
  )
}
