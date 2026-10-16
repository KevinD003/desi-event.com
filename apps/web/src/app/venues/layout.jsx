/**
 * The venue directory: the venue directory and each venue’s page, in the public shell.
 *
 * The header, the page and the footer plate (`components/public-shell.jsx`).
 * The root layout no longer draws them, because the organiser and platform
 * areas have a working shell of their own.
 *
 * @module app/venues/layout
 */

import { PublicShell } from '../../components/public-shell.jsx'

/**
 * @typedef {object} VenuesLayoutProps
 * @property {ReactNode} children The page.
 */

/**
 * The public shell around the venue directory and each venue’s page.
 *
 * @param {VenuesLayoutProps} props Component props.
 * @returns {JSX.Element} The page in its shell.
 */
export default function VenuesLayout({ children }) {
  return <PublicShell>{children}</PublicShell>
}
