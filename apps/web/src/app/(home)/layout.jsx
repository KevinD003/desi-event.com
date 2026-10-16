/**
 * The home page, in the public shell.
 *
 * The home page sits in a route group of its own (`(home)`, which adds
 * nothing to the address) only so that it can have a layout: the root layout
 * draws the document and nothing else, and every public area's layout draws
 * the header, the page and the footer plate (`components/public-shell.jsx`).
 *
 * @module app/home/layout
 */

import { PublicShell } from '../../components/public-shell.jsx'

/**
 * @typedef {object} HomeLayoutProps
 * @property {ReactNode} children The page.
 */

/**
 * The public shell around the home page.
 *
 * @param {HomeLayoutProps} props Component props.
 * @returns {JSX.Element} The page in its shell.
 */
export default function HomeLayout({ children }) {
  return <PublicShell>{children}</PublicShell>
}
