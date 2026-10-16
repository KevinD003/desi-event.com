'use client'

/**
 * The header's frame: sticky, white, ruled in magenta along its foot, and
 * lifted by a shadow once the page has scrolled beneath it.
 *
 * The only part of the header that needs the browser. The shadow is how a
 * reader tells that content is passing under the bar rather than ending at it;
 * it is a change of state, not movement, so it is shown under reduced motion
 * too — only its fade is suppressed there, by the theme's reduced-motion rule.
 *
 * The rule is the brand's one ornament on every page: a single 2px line in
 * the accent magenta. It replaced a band of mirror-work, which with the
 * bunting, the scalloped hems and the diamond dividers below it stacked four
 * decorations onto every screen; one quiet line is enough to say whose site
 * this is.
 *
 * The header keeps its place during a page transition: it carries a
 * `view-transition-name` whose animation the stylesheet turns off, so only
 * the page beneath it crossfades.
 *
 * Everything inside — the brand, the navigation groups read from the session,
 * the account control — is rendered by the server and passed in as children.
 *
 * @module components/header-frame
 */

import { useScrolledPast } from './motion.jsx'
import { BrandRule } from './festive-decor.jsx'

/**
 * @typedef {object} HeaderFrameProps
 * @property {ReactNode} children The header's content.
 */

/**
 * The sticky header element, with the brand rule along its foot.
 *
 * @param {HeaderFrameProps} props Component props.
 * @returns {JSX.Element} The header.
 */
export function HeaderFrame({ children }) {
  const scrolled = useScrolledPast()

  return (
    <header
      data-scrolled={scrolled ? '' : undefined}
      className={`sticky top-0 z-40 bg-surface transition-shadow duration-(--duration-base) ease-standard [view-transition-name:site-header] ${
        scrolled ? 'shadow-card-hover' : 'shadow-none'
      }`}
    >
      {children}
      <BrandRule />
    </header>
  )
}
