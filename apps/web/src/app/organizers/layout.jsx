/**
 * The organiser directory: the organiser directory and each organiser’s page, in the public shell.
 *
 * The header, the page and the footer plate (`components/public-shell.jsx`).
 * The root layout no longer draws them, because the organiser and platform
 * areas have a working shell of their own.
 *
 * @module app/organizers/layout
 */

import { PublicShell } from '../../components/public-shell.jsx'

/**
 * @typedef {object} OrganizersLayoutProps
 * @property {ReactNode} children The page.
 */

/**
 * The public shell around the organiser directory and each organiser’s page.
 *
 * @param {OrganizersLayoutProps} props Component props.
 * @returns {JSX.Element} The page in its shell.
 */
export default function OrganizersLayout({ children }) {
  return <PublicShell>{children}</PublicShell>
}
