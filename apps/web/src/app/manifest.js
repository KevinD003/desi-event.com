/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * What it does: lets a browser that offers installation add The Desi Events to a
 * home screen, open it without the browser's chrome, and colour that chrome as
 * the page it frames. The colours are the page token; `semantic-classes.test.js`
 * holds every hex here to a semantic token, as it does the root layout's. The
 * icons are the brand kit's own 192 and 512 pixel app icons, copied as
 * delivered into `public/icons/` (`docs/BRAND.md`); `manifest.test.js` reads
 * each file and holds it to the size declared for it.
 *
 * What it deliberately does not come with: a service worker. A worker that
 * cached pages would cache a ticket's pass and the pages around it, and a pass
 * must never sit in a cache — the same rule that keeps it out of storage and
 * URLs. Nor would a cache make the door work offline: admission asks the
 * server every time, and offline admission is not implemented. So an installed
 * copy needs a connection exactly as the website does, and says so where it
 * matters (the door page's offline notice). Whether a given browser offers to
 * install without a worker is that browser's decision; nothing here claims it
 * has been verified on a device.
 *
 * @module app/manifest
 */

/** The page token, `--color-page`, as hex: a manifest cannot read a custom property. */
const PAGE = '#fff9f0'

/**
 * The manifest.
 *
 * @returns {object} The manifest's fields.
 */
export default function manifest() {
  return {
    name: 'The Desi Events',
    short_name: 'The Desi Events',
    description:
      'Garba and dandiya nights across the USA and Canada. Tickets sold here are priced in US dollars with their fee shown. Payments on this site are simulated.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: PAGE,
    theme_color: PAGE,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
