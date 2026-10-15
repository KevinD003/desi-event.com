/**
 * The root layout: the document shell every page renders inside.
 *
 * @module app/layout
 */

import './globals.css'

import { SiteFooter } from '../components/site-footer.jsx'
import { SiteHeader } from '../components/site-header.jsx'
import { SHARE_IMAGE } from '../lib/brand.js'
import { registerFor } from '../lib/register.js'
import { requestPathname } from '../lib/request-path.js'

/** Where this deployment is served from, used to resolve relative metadata URLs. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'

/**
 * Site-wide metadata. Individual pages extend rather than replace this: the
 * title template means an event page only has to supply its own title.
 *
 * `metadataBase` makes the link-preview picture's address absolute, as Open
 * Graph requires. The browser and home-screen icons are not listed here: they
 * are this folder's `favicon.ico`, `icon.png` and `apple-icon.png`, which Next
 * links by its file conventions. All three are the brand kit's files, as
 * delivered (`docs/BRAND.md`).
 */
export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'The Desi Events — garba and dandiya nights across the USA and Canada',
    template: '%s · The Desi Events',
  },
  description:
    'Find Navratri garba and dandiya nights, beginner garba classes and Navratri melas across the USA and Canada — Edison, Queens, Houston, Chicago, the Bay Area, Atlanta and more. Tickets sold here are priced in US dollars with their fee shown; events listed on Sulekha show Sulekha’s own prices.',
  applicationName: 'The Desi Events',
  keywords: [
    'garba tickets',
    'dandiya night',
    'Navratri garba USA',
    'garba near me',
    'dandiya raas',
    'Navratri events',
    'garba class',
  ],
  openGraph: {
    type: 'website',
    siteName: 'The Desi Events',
    locale: 'en_US',
    title: 'The Desi Events — garba and dandiya nights across the USA and Canada',
    description:
      'Nine nights of garba in Edison, dandiya to a live dhol in Houston, a glow night in Santa Clara and a mela in Queens. All in one place, priced in dollars.',
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Desi Events',
    description: 'Garba and dandiya nights across the USA and Canada, in one place.',
    images: [SHARE_IMAGE],
  },
  robots: { index: true, follow: true },
}

/**
 * The browser's own chrome, coloured as the page it frames.
 *
 * The page token as hex, because this is metadata rather than CSS and cannot
 * read a custom property. `semantic-classes.test.js` checks it still equals the
 * token. It used to be a bright marigold that no token declared, which put a
 * saturated band above a page that is nearly cream.
 */
export const viewport = {
  themeColor: '#fff9f0',
  width: 'device-width',
  initialScale: 1,
}

/**
 * @typedef {object} RootLayoutProps
 * @property {ReactNode} children The active route's content.
 */

/**
 * The application shell.
 *
 * The skip link is first in the tab order and `main` carries `tabIndex={-1}`
 * so that following it actually moves focus rather than only scrolling — a
 * skip link that leaves focus in the header skips nothing for a keyboard user.
 *
 * `data-register` puts a signed-in area in the Quiet Courtyard register (see
 * `lib/register.js`); a public page carries none and stays editorial.
 *
 * @param {RootLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered document.
 */
export default async function RootLayout({ children }) {
  const register = registerFor(await requestPathname())

  return (
    <html lang="en-US" data-scroll-behavior="smooth">
      <body
        className="flex min-h-dvh flex-col"
        data-register={register === 'courtyard' ? 'courtyard' : undefined}
      >
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  )
}
