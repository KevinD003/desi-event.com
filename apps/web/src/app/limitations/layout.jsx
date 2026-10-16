/**
 * What this site does not do: the limitations page, in the public shell.
 *
 * The header, the page and the footer plate (`components/public-shell.jsx`).
 * The root layout no longer draws them, because the organiser and platform
 * areas have a working shell of their own.
 *
 * @module app/limitations/layout
 */

import { PublicShell } from '../../components/public-shell.jsx'

/**
 * @typedef {object} LimitationsLayoutProps
 * @property {ReactNode} children The page.
 */

/**
 * The public shell around the limitations page.
 *
 * @param {LimitationsLayoutProps} props Component props.
 * @returns {JSX.Element} The page in its shell.
 */
export default function LimitationsLayout({ children }) {
  return <PublicShell>{children}</PublicShell>
}
