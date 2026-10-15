/**
 * The brand's published pictures and words, as the metadata and structured
 * data name them. The files live in `public/brand/` and are derived from the
 * owner's brand kit; `docs/BRAND.md` says from which file and how.
 *
 * @module lib/brand
 */

/** The tagline, as the brand kit states it, in sentence case. */
export const TAGLINE = 'Every moment, one place.'

/**
 * The picture a link to the site unfurls as: the kit's cover, with its
 * tagline, centred on a 1200 × 630 canvas of its own edge colour. Its words
 * are in the alternative text, because they are drawn in the picture.
 */
export const SHARE_IMAGE = Object.freeze({
  url: '/brand/og-default.jpg',
  width: 1200,
  height: 630,
  type: 'image/jpeg',
  alt: `The Desi Events — ${TAGLINE}`,
})

/** The square logo at 512 × 512, for structured data. */
export const SQUARE_LOGO_PATH = '/brand/logo-square-512.png'
