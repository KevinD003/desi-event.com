/**
 * Account creation: creating an account, in the public shell.
 *
 * The header, the page and the footer plate (`components/public-shell.jsx`).
 * The root layout no longer draws them, because the organiser and platform
 * areas have a working shell of their own.
 *
 * @module app/register/layout
 */

import { PublicShell } from '../../components/public-shell.jsx'

/**
 * @typedef {object} RegisterLayoutProps
 * @property {ReactNode} children The page.
 */

/**
 * The public shell around creating an account.
 *
 * @param {RegisterLayoutProps} props Component props.
 * @returns {JSX.Element} The page in its shell.
 */
export default function RegisterLayout({ children }) {
  return <PublicShell>{children}</PublicShell>
}
