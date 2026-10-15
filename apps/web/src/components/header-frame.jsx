'use client'

/**
 * The header's frame: sticky, white, and lifted by a shadow once the page has
 * scrolled beneath it.
 *
 * The only part of the header that needs the browser. The shadow is how a
 * reader tells that content is passing under the bar rather than ending at it;
 * it is a change of state, not movement, so it is shown under reduced motion
 * too — only its fade is suppressed there, by the theme's reduced-motion rule.
 *
 * Everything inside — the brand, the navigation groups read from the session,
 * the account control — is rendered by the server and passed in as children.
 *
 * @module components/header-frame
 */

import { useScrolledPast } from './motion.jsx'
import { MirrorBand } from './festive-decor.jsx'

/**
 * @typedef {object} HeaderFrameProps
 * @property {ReactNode} children The header's content.
 */

/**
 * The sticky header element, with the mirror-work band along its foot.
 *
 * @param {HeaderFrameProps} props Component props.
 * @returns {JSX.Element} The header.
 */
export function HeaderFrame({ children }) {
  const scrolled = useScrolledPast()

  return (
    <header
      data-scrolled={scrolled ? '' : undefined}
      className={`sticky top-0 z-40 bg-surface transition-shadow duration-(--duration-base) ease-standard ${
        scrolled ? 'shadow-card-hover' : 'shadow-none'
      }`}
    >
      {children}
      <MirrorBand />
    </header>
  )
}
