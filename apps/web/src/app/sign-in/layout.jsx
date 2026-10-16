/**
 * Sign in: signing in, in the public shell.
 *
 * The header, the page and the footer plate (`components/public-shell.jsx`).
 * The root layout no longer draws them, because the organiser and platform
 * areas have a working shell of their own.
 *
 * @module app/sign-in/layout
 */

import { PublicShell } from '../../components/public-shell.jsx'

/**
 * @typedef {object} SignInLayoutProps
 * @property {ReactNode} children The page.
 */

/**
 * The public shell around signing in.
 *
 * @param {SignInLayoutProps} props Component props.
 * @returns {JSX.Element} The page in its shell.
 */
export default function SignInLayout({ children }) {
  return <PublicShell>{children}</PublicShell>
}
