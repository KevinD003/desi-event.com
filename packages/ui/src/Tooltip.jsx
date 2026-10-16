import { Tooltip as Base } from '@base-ui/react/tooltip'

import { cn } from './cn.js'
import { FLOATING_MOTION } from './floating.js'

/** How long a pointer rests on the trigger before the first tooltip shows. */
export const TOOLTIP_DELAY_MS = 500

/**
 * @typedef {object} TooltipProps
 * @property {ReactNode} content What it says: the same words as the trigger's accessible name.
 * @property {ReactElement} children The trigger, usually an icon button with an `aria-label`.
 * @property {'top'|'bottom'|'left'|'right'} [side] Defaults to `top`.
 * @property {boolean} [open] Whether it is shown, when controlled (for a screenshot or a test).
 * @property {HTMLElement} [container] Where to portal it. Defaults to `<body>`.
 * @property {string} [className] Extra classes merged onto the tip.
 */

/**
 * A short label shown on hover or keyboard focus, for a control whose
 * picture is its only visible label — the copy button beside an order
 * number, a row's icon actions in a dense table.
 *
 * It repeats the control's accessible name for sighted readers; it never
 * carries information the control does not already announce, and nothing
 * interactive lives in it. It waits half a second before the first one
 * shows, then neighbours appear at once (Base UI's grouping), so scanning a
 * row of icons is quick without tips flickering under a passing pointer.
 *
 * @param {TooltipProps} props Component props.
 * @returns {JSX.Element} The trigger and its tip.
 */
export function Tooltip({ content, children, side = 'top', open, container, className }) {
  return (
    <Base.Root open={open}>
      <Base.Trigger delay={TOOLTIP_DELAY_MS} render={children} />
      <Base.Portal container={container}>
        <Base.Positioner side={side} sideOffset={6} collisionPadding={8} className="z-50">
          <Base.Popup
            data-slot="tooltip"
            className={cn(
              'max-w-64 rounded-control bg-surface-inverse px-2.5 py-1.5 text-caption font-semibold text-ink-inverse shadow-floating',
              FLOATING_MOTION,
              className,
            )}
          >
            {content}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}

export default Tooltip
