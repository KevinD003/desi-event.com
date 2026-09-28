/**
 * An event's gallery: the pictures a moderator approved, in the organiser's
 * order.
 *
 * Each picture opens full size in the browser, and says so to a screen reader,
 * because a link that leaves the page should not surprise anybody. The
 * organiser's description is the alt text. Nothing is rendered for an empty
 * gallery: a heading over nothing is noise.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-gallery
 */

import Image from 'next/image'

import { mediaSrc } from '../lib/media.js'

/**
 * @typedef {object} EventGalleryProps
 * @property {Array<{id: string, url: string, altText: string, width: number, height: number}>} [images] The approved gallery.
 * @property {string} [headingId] The heading's id, for `aria-labelledby`.
 */

/**
 * The gallery section.
 *
 * @param {EventGalleryProps} props Component props.
 * @returns {JSX.Element|null} The section, or nothing.
 */
export function EventGallery({ images = [], headingId = 'event-gallery-heading' }) {
  const shown = (images ?? [])
    .map((image) => ({ image, src: mediaSrc(image) }))
    .filter(({ src }) => src !== null)

  if (shown.length === 0) return null

  return (
    <section aria-labelledby={headingId} data-slot="event-gallery" className="space-y-4">
      <h2 id={headingId} className="font-display text-2xl font-semibold text-ink">
        Pictures
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map(({ image, src }) => (
          <li key={image.id}>
            <a
              href={src}
              className="group relative block aspect-square overflow-hidden rounded-card bg-surface-subtle focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Image
                src={src}
                alt={image.altText}
                fill
                sizes="(min-width: 640px) 33vw, 50vw"
                className="object-cover transition-transform duration-(--duration-base) ease-standard motion-safe:group-hover:scale-105"
              />
              <span className="sr-only"> (opens the full-size picture)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
