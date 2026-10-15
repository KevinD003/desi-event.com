/**
 * The logo of The Desi Events: the owner's illustrated capital D — a dancer,
 * the Dallas skyline and a concert crowd — beside the name, as delivered in
 * the brand kit. `docs/BRAND.md` says which kit file each picture here was
 * derived from and how.
 *
 * Three pictures, each a trimmed WebP with transparency at 1x and 2x:
 *
 *   - `light`, the header logo for a white or cream surface — the header and
 *     anything else on the page's own ground;
 *   - `dark`, the header logo for a dark surface — the footer's night band;
 *   - `icon`, the D on its own, for a place where the name is already said.
 *
 * A plain `<img>` with `srcSet` rather than `next/image`: the optimiser is
 * deliberately allowed to fetch event pictures only (`next.config.mjs`), and
 * these files are already sized for where they are drawn, so there is nothing
 * for it to do. `width` and `height` are the 1x file's, so the browser
 * reserves the right box before the file arrives; a class that sets a smaller
 * height with `w-auto` scales the picture without distorting it.
 *
 * The name is said once. The logo's alternative text is "The Desi Events" —
 * the words drawn in it — and a link wrapped round it is named by that alone.
 * Where the brand is already named nearby, pass `decorative` and the picture
 * is `alt=""`, which assistive technology skips.
 *
 * @module components/brand-logo
 */

import { BRAND_NAME } from '../lib/contact.js'

/**
 * Every logo picture the site draws: its 1x and 2x files and the 1x file's
 * size in pixels. `brand-logo.test.jsx` holds each size to the file on disk.
 */
export const BRAND_LOGOS = Object.freeze({
  light: Object.freeze({
    src: '/brand/logo-light-1x.webp',
    src2x: '/brand/logo-light-2x.webp',
    width: 162,
    height: 40,
  }),
  dark: Object.freeze({
    src: '/brand/logo-dark-1x.webp',
    src2x: '/brand/logo-dark-2x.webp',
    width: 186,
    height: 56,
  }),
  icon: Object.freeze({
    src: '/brand/d-icon-1x.webp',
    src2x: '/brand/d-icon-2x.webp',
    width: 42,
    height: 40,
  }),
})

/**
 * @typedef {object} BrandLogoProps
 * @property {'light'|'dark'|'icon'} [variant] Which picture: `light` for a light
 *   surface, `dark` for a night band, `icon` for the D alone. Defaults to `light`.
 * @property {boolean} [priority] Fetch it first, without waiting for layout: for
 *   the header's logo, which is on every page above the fold.
 * @property {boolean} [decorative] The brand is named nearby, so the picture is
 *   skipped by assistive technology (`alt=""`).
 * @property {string} [className] Its displayed height (with `w-auto`) and spacing.
 */

/**
 * One logo picture.
 *
 * @param {BrandLogoProps} props Component props.
 * @returns {JSX.Element} The picture.
 */
export function BrandLogo({ variant = 'light', priority = false, decorative = false, className }) {
  const logo = BRAND_LOGOS[variant]

  return (
    <img
      src={logo.src}
      srcSet={`${logo.src} 1x, ${logo.src2x} 2x`}
      width={logo.width}
      height={logo.height}
      alt={decorative ? '' : BRAND_NAME}
      data-logo={variant}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={`block max-w-none shrink-0 ${className ?? ''}`.trim()}
    />
  )
}
