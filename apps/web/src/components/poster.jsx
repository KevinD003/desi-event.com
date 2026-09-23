/**
 * The poster that stands in for an event's cover image.
 *
 * Deliberately an inline SVG rather than an `<img>`: the catalogue has no
 * hosted artwork, a remote image would make every page depend on a third party
 * being up, and a broken image is a worse first impression than none. The
 * drawing itself comes from `lib/poster-art.js` — garba dancers round a lit
 * garbo, crossed dandiya over a mandala, or lanterns and a toran, by category —
 * and is seeded by the event's slug, so an event wears the same poster in the
 * listing, on its own page and at checkout.
 *
 * The SVG carries `role="img"` and an `aria-label` saying what the picture
 * shows and whose poster it is, so it is announced exactly as a photograph
 * with alt text would be, and its shapes are not.
 *
 * It renders React elements from the drawing's element tree, never markup:
 * there is no `dangerouslySetInnerHTML` here, and only the drawing elements
 * `POSTER_ELEMENTS` names can be rendered at all.
 *
 * @module components/poster
 */

import { createElement, useId } from 'react'

import { POSTER_ELEMENTS, describePoster, posterArt } from '../lib/poster-art.js'

/** The elements a drawing may render, for constant-time lookup. */
const RENDERABLE = new Set(POSTER_ELEMENTS)

/**
 * Sizing per variant. Both crop the 3:2 drawing to the frame with
 * `preserveAspectRatio="xMidYMid slice"`, so a frame of any shape is filled
 * edge to edge and the centre of the scene — the garbo, the mandala — stays in
 * view.
 *
 * A `card` keeps the drawing's own 3:2. A `hero` is taller on a phone, where a
 * 16:7 strip would be a sliver, and opens out to 16:7 on a wide screen.
 */
const VARIANT_CLASSES = Object.freeze({
  card: 'aspect-[3/2]',
  hero: 'aspect-[4/3] sm:aspect-[2/1] lg:aspect-[16/7]',
})

/**
 * The React spelling of an SVG attribute.
 *
 * The drawing is written in SVG's own spelling (`fill-opacity`) so that
 * `toSvgString` can emit it verbatim; React wants the camel-cased property
 * (`fillOpacity`) and warns about the other.
 *
 * @param {string} name An attribute name as SVG spells it.
 * @returns {string} The prop name React expects.
 */
export function reactAttributeName(name) {
  return name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
}

/**
 * Render one node of the drawing, and its children, as React elements.
 *
 * @param {{tag: string, attrs: Record<string, string|number>, children: Array<object>}} node A node.
 * @param {number} key Its position among its siblings. The tree is static, so position is identity.
 * @returns {JSX.Element|null} The element, or nothing for a tag the poster does not draw.
 */
function renderNode(node, key) {
  if (!RENDERABLE.has(node.tag)) return null

  const props = { key }

  for (const [name, value] of Object.entries(node.attrs)) {
    props[reactAttributeName(name)] = value
  }

  return createElement(
    node.tag,
    props,
    node.children.length > 0 ? node.children.map(renderNode) : undefined,
  )
}

/**
 * An id prefix that is unique to this poster on the page.
 *
 * Every poster defines its own sky and glow gradients, and a listing draws
 * several posters from the same slug — the card and, say, a "you might also
 * like" strip. Two gradients with one id make the second poster paint with the
 * first one's colours, or with none if the first is later removed. `useId` is
 * unique per rendered instance and stable across the server render and
 * hydration; the characters are narrowed to those an SVG id and a CSS
 * `url(#…)` reference both accept without escaping.
 *
 * @returns {string} A prefix such as `poster-R1`.
 */
function usePosterIdPrefix() {
  return `poster-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
}

/**
 * @typedef {object} EventPosterProps
 * @property {object} event An event or event summary carrying `slug`, `title` and `category`.
 * @property {'card'|'hero'} [variant] Sizing and scene. `card` for listings, `hero` for the event page's banner, which also draws the fuller scene.
 * @property {string} [className] Extra classes merged after the defaults. Inside a frame with a set height, `h-full` lets the frame decide the crop.
 */

/**
 * A generated poster for an event.
 *
 * @param {EventPosterProps} props Component props.
 * @returns {JSX.Element} The rendered poster.
 */
export function EventPoster({ event, variant = 'card', className }) {
  const idPrefix = usePosterIdPrefix()
  const scene = variant === 'hero' ? 'hero' : 'card'
  const art = posterArt({
    seed: event?.slug ?? event?.id ?? 'desi-event',
    category: event?.category,
    variant: scene,
    idPrefix,
  })

  return (
    <svg
      role="img"
      aria-label={`${describePoster(event?.category)} for ${event?.title ?? 'this event'}`}
      viewBox={art.viewBox}
      preserveAspectRatio="xMidYMid slice"
      data-slot="poster"
      className={['block w-full', VARIANT_CLASSES[scene], className].filter(Boolean).join(' ')}
    >
      {art.children.map(renderNode)}
    </svg>
  )
}
