/**
 * The page's own content, crossfaded when a navigation replaces it.
 *
 * Every shell wraps what it draws inside `main` in one of these. React starts
 * a view transition when a navigation (always a Transition in the App Router)
 * changes what is inside, and the browser crossfades the old picture of the
 * content into the new one. The shell around it never moves: the header,
 * the workspace's bar and rail and the footer each carry a
 * `view-transition-name` of their own whose animation the theme turns off
 * (`globals.css`, "Page transitions"), so they are drawn once, in place,
 * while only the content fades.
 *
 * Two speeds, both under the theme's 250ms ceiling for interface feedback:
 * 180ms on the public site (`page-fade`), and 150ms in the workspace
 * (`workspace-fade`), where people move between screens many times an hour
 * and anything slower starts to feel like waiting. Under reduced motion the
 * theme stops every `::view-transition-*` animation, so the new page is
 * simply there. A browser without view transitions swaps the page as before.
 *
 * The child is a real box, not `display: contents`: a view transition
 * captures an element's box, and a box-less element has nothing to capture.
 *
 * @module components/page-transition
 */

import { ViewTransition } from 'react'

/** The view-transition class each shell's content fades with. */
export const PAGE_FADE = Object.freeze({ public: 'page-fade', workspace: 'workspace-fade' })

/**
 * @typedef {object} PageTransitionProps
 * @property {'public'|'workspace'} [kind] Which shell this is in. Defaults to `public`.
 * @property {string} [className] Classes for the content box.
 * @property {ReactNode} children The page.
 */

/**
 * The content box, crossfaded between pages.
 *
 * @param {PageTransitionProps} props Component props.
 * @returns {JSX.Element} The page inside its transition boundary.
 */
export function PageTransition({ kind = 'public', className = 'flex flex-1 flex-col', children }) {
  const fade = PAGE_FADE[kind] ?? PAGE_FADE.public

  return (
    <ViewTransition default={fade}>
      <div data-page-content={kind} className={className}>
        {children}
      </div>
    </ViewTransition>
  )
}
