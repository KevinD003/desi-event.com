import { createElement } from 'react'

import { cn } from '../cn.js'
import { GLYPHS } from './glyphs.js'

/** The family's one stroke weight, on the 24-unit grid. */
export const ICON_STROKE = 1.75

/**
 * @typedef {object} IconProps
 * @property {string} name Which glyph (see `icons/glyphs.js`).
 * @property {string} [label] What the icon means, when nothing beside it says so. Without one the icon is decoration and hidden from assistive technology.
 * @property {string} [className] Size and spacing. Defaults to 1.25rem square.
 */

/**
 * One icon from the family: a 24-unit grid, 1.75 strokes, round caps and
 * joins, drawn in `currentColor` so it takes the colour of the words beside
 * it.
 *
 * Decoration by default — `aria-hidden` and unfocusable — because a word
 * always travels with an icon on this site: an icon that is the only thing
 * saying "admitted" says nothing to a screen reader, or to somebody who
 * cannot tell the colours apart. Give it a `label` only where it stands
 * alone, such as an icon button's glyph whose button has no other name; it is
 * then an image with that name.
 *
 * An unknown name throws rather than drawing nothing: a misspelt icon should
 * fail a test, not ship as a gap.
 *
 * @param {IconProps} props Component props, forwarded to the `svg`.
 * @returns {JSX.Element} The icon.
 */
export function Icon({ name, label, className, ...rest }) {
  const glyph = GLYPHS[name]

  if (!glyph) throw new Error(`No icon is drawn under the name "${name}".`)

  const named = typeof label === 'string' && label.trim() !== ''

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      data-slot="icon"
      data-icon={name}
      {...(named ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}
      className={cn('h-5 w-5 shrink-0', className)}
      {...rest}
    >
      {glyph.map(([element, attributes], index) =>
        createElement(element, { key: index, ...attributes }),
      )}
    </svg>
  )
}

export default Icon
