/**
 * The poster block that stands in for an event's cover image.
 *
 * Deliberately an inline SVG rather than an `<img>`: the fallback catalogue has
 * no hosted artwork, a remote image would make every page depend on a third
 * party being up, and a broken image is a worse first impression than none. The
 * SVG carries `role="img"` and an `aria-label`, so it is announced exactly as a
 * photograph with alt text would be.
 *
 * The colours are derived from the event slug, so a given event always gets the
 * same poster — recognisable across the listing, the detail page and checkout.
 *
 * @module components/poster
 */

import { categoryDescriptor } from '../lib/catalog.js'

/**
 * Marigold-to-indigo gradient pairs from the shared theme, as raw colour
 * values because an SVG gradient stop cannot take a Tailwind class.
 */
const PALETTES = [
  ['oklch(0.806 0.172 76.1)', 'oklch(0.567 0.148 48.6)'],
  ['oklch(0.751 0.176 70.3)', 'oklch(0.417 0.161 288.1)'],
  ['oklch(0.862 0.152 80.4)', 'oklch(0.462 0.101 153.8)'],
  ['oklch(0.672 0.169 58.7)', 'oklch(0.283 0.106 288.7)'],
  ['oklch(0.612 0.128 152.4)', 'oklch(0.213 0.076 289.4)'],
]

/**
 * Pick a stable palette for a string.
 *
 * @param {string} seed Stable identifier, normally the event slug.
 * @returns {string[]} A `[from, to]` pair of colour values.
 */
function paletteFor(seed) {
  let hash = 0

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000
  }

  return PALETTES[hash % PALETTES.length]
}

/**
 * @typedef {object} EventPosterProps
 * @property {object} event An event or event summary carrying `slug`, `title` and `category`.
 * @property {'card'|'hero'} [variant] Sizing preset. `card` for listings, `hero` for the detail page.
 * @property {string} [className] Extra classes merged after the defaults.
 */

/**
 * A generated poster for an event.
 *
 * @param {EventPosterProps} props Component props.
 * @returns {JSX.Element} The rendered poster.
 */
export function EventPoster({ event, variant = 'card', className }) {
  const seed = event?.slug ?? event?.id ?? 'desi-event'
  const [from, to] = paletteFor(seed)
  const { glyph, label } = categoryDescriptor(event?.category)
  const gradientId = `poster-gradient-${seed}`
  const isHero = variant === 'hero'

  return (
    <svg
      role="img"
      aria-label={`${label} poster for ${event?.title ?? 'this event'}`}
      viewBox="0 0 400 225"
      preserveAspectRatio="xMidYMid slice"
      className={['block aspect-[16/9] w-full', isHero ? 'max-h-80' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="400" height="225" fill={`url(#${gradientId})`} />
      {/* A suggestion of a rangoli: concentric arcs offset into the corner. */}
      <g fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.5">
        <circle cx="330" cy="40" r="26" />
        <circle cx="330" cy="40" r="44" />
        <circle cx="330" cy="40" r="62" />
        <circle cx="52" cy="196" r="20" />
        <circle cx="52" cy="196" r="36" />
      </g>
      <text
        x="28"
        y="150"
        fill="#ffffff"
        fillOpacity="0.92"
        fontSize="72"
        fontFamily="Georgia, 'Times New Roman', serif"
      >
        {glyph}
      </text>
    </svg>
  )
}
