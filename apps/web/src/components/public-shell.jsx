/**
 * The public shell: the site header, the page, and the footer plate.
 *
 * Every page a visitor can reach without signing in is drawn inside this, and
 * so are the attendee's own pages (their tickets and account), which belong
 * to the same site: the header that brought them there is the one that takes
 * them back. The organiser and platform areas are not: they have their own
 * working shell (`workspace-shell.jsx`), with a compact bar and a rail and no
 * marketing footer, because somebody scanning tickets at a door or reading a
 * ledger is not browsing.
 *
 * Until the shells were split, the root layout drew this header and footer
 * around every page, the door and the ledger included. Now the root layout
 * draws only the document and the skip link, and each area's layout draws
 * its own shell, which keeps exactly one `banner`, one `main` and one
 * `contentinfo` on every page whichever shell it is in.
 *
 * `main` keeps the skip link's target: the id it jumps to, and
 * `tabIndex={-1}` so following the link moves focus there rather than only
 * scrolling.
 *
 * @module components/public-shell
 */

import { PageTransition } from './page-transition.jsx'
import { SiteFooter } from './site-footer.jsx'
import { SiteHeader } from './site-header.jsx'

/**
 * @typedef {object} PublicShellProps
 * @property {ReactNode} children The page.
 */

/**
 * The public chrome around a page.
 *
 * @param {PublicShellProps} props Component props.
 * @returns {JSX.Element} The header, the page in `main`, and the footer.
 */
export function PublicShell({ children }) {
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
        <PageTransition kind="public">{children}</PageTransition>
      </main>
      <SiteFooter />
    </>
  )
}
