/**
 * The root layout: the document shell every page renders inside.
 *
 * @module app/layout
 */

import './globals.css'

import { SiteFooter } from '../components/site-footer.jsx'
import { SiteHeader } from '../components/site-header.jsx'

/** Where this deployment is served from, used to resolve relative metadata URLs. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'

/**
 * Site-wide metadata. Individual pages extend rather than replace this: the
 * title template means an event page only has to supply its own title.
 */
export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Desi-Event — garba, qawwali, melas and stand-up, ticketed properly',
    template: '%s · Desi-Event',
  },
  description:
    'Find and book South Asian events near you: Navratri garba nights, qawwali mehfils, Diwali melas, Bollywood nights, classical dance and diaspora comedy across Mumbai, Ahmedabad, Toronto and London.',
  applicationName: 'Desi-Event',
  keywords: [
    'garba tickets',
    'dandiya night',
    'qawwali concert',
    'Diwali mela',
    'Bollywood night',
    'South Asian events',
    'desi events near me',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Desi-Event',
    locale: 'en_IN',
    title: 'Desi-Event — garba, qawwali, melas and stand-up',
    description:
      'Nine nights of garba in Ahmedabad, a qawwali mehfil in Bombay, a Diwali mela in Mississauga and stand-up in Limehouse. All in one place.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Desi-Event',
    description: 'South Asian events, ticketed properly.',
  },
  robots: { index: true, follow: true },
}

/** Theme colour for the browser chrome, taken from the marigold ramp. */
export const viewport = {
  themeColor: '#f5a524',
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
 * @param {RootLayoutProps} props Component props.
 * @returns {JSX.Element} The rendered document.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="en-IN" data-scroll-behavior="smooth">
      <body className="flex min-h-dvh flex-col">
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
