import { useEffect, useRef } from 'react'

import { cn } from './cn.js'
import { focusElement } from './focus.js'

/** Where a sheet enters from, and the transform it enters from. */
const FROM = {
  top: 'origin-top starting:-translate-y-2',
  bottom: 'origin-bottom starting:translate-y-4',
  start: 'origin-left starting:-translate-x-4',
  end: 'origin-right starting:translate-x-4',
}

/**
 * @typedef {object} SheetProps
 * @property {string} id The sheet's id, which its trigger names in `aria-controls`.
 * @property {boolean} open Whether it is shown. Closed, it stays in the DOM with `hidden`.
 * @property {function(Event): void} onClose Called on Escape inside the sheet.
 * @property {object} [returnFocusRef] Ref to the trigger. Focus goes back to it when the sheet closes by Escape.
 * @property {object} [initialFocusRef] Ref to what takes focus on open. Defaults to the sheet itself.
 * @property {'top'|'bottom'|'start'|'end'} [from] The edge it slides from. Defaults to `top`.
 * @property {ElementType} [as] The element. Defaults to `div`.
 * @property {string} [className] Extra classes merged onto the sheet.
 * @property {ReactNode} [children] Its content: a navigation, a set of filters.
 */

/**
 * A panel that opens in place, beside the control that opens it.
 *
 * Not a dialog and not portalled. The header's "Menu" opens one inside the
 * `banner`, and the accessibility sweep holds that the sheet — with the
 * `Primary` navigation in it — stays inside the banner, takes focus when it
 * opens and gives it back to "Menu" on Escape. A drawer portalled to `<body>`
 * breaks all three. So this renders where it is written, as a disclosure:
 * the trigger carries `aria-expanded` and `aria-controls={id}`, the page
 * behind stays reachable, and nothing is trapped.
 *
 * It slides 8px from its edge and fades in over the theme's sheet duration on
 * the drawer curve, drawn by CSS (`@starting-style`), so opening it never
 * waits on JavaScript and reduced motion simply shows it.
 *
 * @param {SheetProps} props Component props.
 * @returns {JSX.Element} The sheet.
 */
export function Sheet({
  id,
  open,
  onClose,
  returnFocusRef,
  initialFocusRef,
  from = 'top',
  as: Component = 'div',
  className,
  children,
  ...rest
}) {
  const sheetRef = useRef(null)

  // Opening hands focus in, so a keyboard user is where the new content is.
  useEffect(() => {
    if (!open) return
    if (!focusElement(initialFocusRef?.current)) focusElement(sheetRef.current)
  }, [open, initialFocusRef])

  return (
    <Component
      ref={sheetRef}
      id={id}
      hidden={!open}
      tabIndex={-1}
      data-slot="sheet"
      data-state={open ? 'open' : 'closed'}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return

        event.stopPropagation()
        onClose?.(event)
        focusElement(returnFocusRef?.current)
      }}
      className={cn(
        'transition-[opacity,translate] duration-(--duration-sheet) ease-drawer starting:opacity-0 focus-visible:outline-none',
        FROM[from] ?? FROM.top,
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
}

export default Sheet
