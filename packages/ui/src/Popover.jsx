import { Popover as Base } from '@base-ui/react/popover'

import { cn } from './cn.js'
import { FLOATING_PANEL } from './floating.js'

/**
 * @typedef {object} PopoverProps
 * @property {ReactElement} trigger The control that opens it, usually a {@link Button}. It becomes the trigger: it gains `aria-expanded` and `aria-controls`, and its own props and ref are kept.
 * @property {ReactNode} [title] A heading for the panel, which also names it.
 * @property {ReactNode} [children] The panel's content.
 * @property {'top'|'bottom'|'left'|'right'} [side] Which side of the trigger it opens on. Defaults to `bottom`; it flips when there is no room.
 * @property {'start'|'center'|'end'} [align] How it lines up with the trigger. Defaults to `start`.
 * @property {boolean} [open] Whether it is open, when controlled.
 * @property {function(boolean): void} [onOpenChange] Called when it asks to open or close.
 * @property {HTMLElement} [container] Where to portal it. Defaults to `<body>`.
 * @property {string} [className] Extra classes merged onto the panel.
 */

/**
 * A small panel anchored to a button: a filter set, a date's details, a
 * share list. Not modal — the page behind stays usable — and it closes on
 * Escape or a click outside, handing focus back to its trigger.
 *
 * Behaviour (focus, dismissal, positioning, flipping at the viewport edge)
 * is Base UI's; the look is this theme's. Portalled to `<body>` so no
 * `overflow: hidden` ancestor can clip it. Not for the header's menu, which
 * must stay inside the banner: that is {@link Sheet}.
 *
 * @param {PopoverProps} props Component props.
 * @returns {JSX.Element} The trigger and its panel.
 */
export function Popover({
  trigger,
  title,
  children,
  side = 'bottom',
  align = 'start',
  open,
  onOpenChange,
  container,
  className,
}) {
  return (
    <Base.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <Base.Trigger render={trigger} />
      <Base.Portal container={container}>
        <Base.Positioner
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={16}
          className="z-50"
        >
          <Base.Popup
            data-slot="popover"
            className={cn(
              FLOATING_PANEL,
              'flex max-w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 p-4',
              className,
            )}
          >
            {title ? (
              <Base.Title className="font-display text-title font-bold text-ink">
                {title}
              </Base.Title>
            ) : null}
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}

export default Popover
