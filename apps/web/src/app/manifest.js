/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * What it does: lets a browser that offers installation add Desi-Event to a
 * home screen, open it without the browser's chrome, and colour that chrome as
 * the page it frames. The colours are the page token and the icon's are the
 * inverse surface and accent; `semantic-classes.test.js` holds every hex here
 * to a semantic token, as it does the root layout's.
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
    name: 'Desi-Event',
    short_name: 'Desi-Event',
    description:
      'Garba and dandiya nights across the USA, with every price shown in US dollars with its fee. Payments on this site are simulated.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: PAGE,
    theme_color: PAGE,
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }
}
