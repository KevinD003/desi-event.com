/**
 * The root layout: the document shell every page renders inside.
 *
 * @module app/layout
 */

import './globals.css'

import { MotionProvider } from '../components/motion.jsx'
import { RegisterSync } from '../components/register-sync.jsx'
import { Toaster } from '../components/ui.jsx'
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
    'Find Navratri garba and dandiya nights, beginner garba classes and Navratri melas across the USA and Canada — Edison, Queens, Houston, Chicago, the Bay Area, Atlanta and more. Tickets sold here are priced in US dollars, or Canadian dollars at a venue in Canada, with their fee shown; events imported from organisers’ public ticket listings are sold at the prices the organiser listed.',
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
 * saturated band above the page; it is now the white page and header.
 */
export const viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
}

/**
 * @typedef {object} RootLayoutProps
 * @property {ReactNode} children The active route's content.
 */

/**
 * The document: `<html>`, `<body>`, the skip link and the toaster.
 *
 * The skip link is first in the tab order on every page. Its target, `main`
 * with `tabIndex={-1}` so that following it actually moves focus rather than
 * only scrolling, belongs to the shell each area's layout draws: the public
 * shell (`components/public-shell.jsx`) for the site and the attendee's own
 * pages, the workspace shell (`components/workspace-shell.jsx`) for the
 * organiser and platform areas. Each draws exactly one `banner`, one `main`
 * and one `contentinfo`; this layout draws none of them, so a working screen
 * no longer sits inside the public header and footer.
 *
 * `data-register` puts a signed-in area in the Quiet Courtyard register (see
 * `lib/register.js`); a public page carries none and stays in the poster
 * register. This layout is not rendered again on a soft navigation, so
 * {@link RegisterSync} keeps the attribute in step with the route after the
 * first paint.
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
        <RegisterSync />
        <MotionProvider>
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          {children}
          {/* Short, non-critical confirmations ("Copied"), announced politely;
              everything a reader must know stays in the page. */}
          <Toaster />
        </MotionProvider>
      </body>
    </html>
  )
}
