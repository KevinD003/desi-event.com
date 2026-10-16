import { Menu as Base } from '@base-ui/react/menu'

import { cn } from './cn.js'
import { FLOATING_PANEL } from './floating.js'

/**
 * @typedef {object} MenuItem
 * @property {ReactNode} [label] What the entry says.
 * @property {string} [href] Where it goes, for an entry that navigates.
 * @property {function(Event): void} [onSelect] What it does, for an entry that acts.
 * @property {boolean} [disabled] Shown but not choosable.
 * @property {'default'|'danger'} [tone] `danger` for an entry that destroys something; it is still confirmed elsewhere.
 * @property {boolean} [separator] A rule between groups instead of an entry.
 */

/**
 * @typedef {object} MenuProps
 * @property {ReactElement} trigger The button that opens it.
 * @property {MenuItem[]} items The entries, in order.
 * @property {ElementType} [linkAs] What renders an entry with an `href`: the app's router link. Defaults to `a`.
 * @property {'top'|'bottom'|'left'|'right'} [side] Defaults to `bottom`.
 * @property {'start'|'center'|'end'} [align] Defaults to `end`, so a menu at the right of a bar opens inward.
 * @property {boolean} [open] Whether it is open, when controlled.
 * @property {function(boolean): void} [onOpenChange] Called when it asks to open or close.
 * @property {HTMLElement} [container] Where to portal it. Defaults to `<body>`.
 * @property {string} [className] Extra classes merged onto the list.
 */

/** One entry's classes: a 44px row, the accent on the highlighted one. */
const ENTRY =
  'flex min-h-11 w-full cursor-default items-center gap-2 rounded-control px-3 text-left text-label font-semibold outline-none select-none data-[highlighted]:bg-surface-subtle data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60'

/**
 * A list of actions or destinations behind a button: an account's pages, a
 * row's "More" actions.
 *
 * The WAI-ARIA menu button pattern, from Base UI: arrow keys move through the
 * entries, typing jumps to one by its first letters, Enter or Space chooses,
 * Escape closes and returns focus to the button. The entries are `menuitem`s,
 * so a screen reader announces how many there are. Destinations render as
 * real links (`linkAs`), so they open in a new tab when asked.
 *
 * @param {MenuProps} props Component props.
 * @returns {JSX.Element} The trigger and its menu.
 */
export function Menu({
  trigger,
  items,
  linkAs: LinkComponent = 'a',
  side = 'bottom',
  align = 'end',
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
          <Base.Popup data-slot="menu" className={cn(FLOATING_PANEL, 'min-w-56 p-1.5', className)}>
            {items.map((item, index) => {
              if (item.separator) {
                return <Base.Separator key={`separator-${index}`} className="my-1.5 h-px bg-line" />
              }

              const tone = item.tone === 'danger' ? 'text-status-danger' : 'text-ink'

              if (item.href) {
                return (
                  <Base.LinkItem
                    key={item.href}
                    render={<LinkComponent href={item.href} />}
                    className={cn(ENTRY, tone)}
                  >
                    {item.label}
                  </Base.LinkItem>
                )
              }

              return (
                <Base.Item
                  key={`item-${index}`}
                  disabled={item.disabled}
                  onClick={item.onSelect}
                  className={cn(ENTRY, tone)}
                >
                  {item.label}
                </Base.Item>
              )
            })}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}

export default Menu
