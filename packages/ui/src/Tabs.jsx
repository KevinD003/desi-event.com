import { useCallback, useId, useRef, useState } from 'react'
import { cn } from './cn.js'
import { focusElement } from './focus.js'

/**
 * @typedef {object} TabItem
 * @property {string} id Stable identifier, used to build the tab and panel ids.
 * @property {ReactNode} label Tab label.
 * @property {ReactNode} [content] Panel content.
 * @property {boolean} [disabled] Whether the tab can be selected.
 */

/**
 * @typedef {object} TabsProps
 * @property {TabItem[]} items Tabs to render, in visual order.
 * @property {string} label Accessible name of the tab list, e.g. "Event sections".
 * @property {string} [defaultTabId] Initially selected tab when uncontrolled. Defaults to the first enabled tab.
 * @property {string} [activeTabId] Selected tab id. Supplying this makes the component controlled.
 * @property {Function} [onChange] Called with the newly selected tab id.
 * @property {'horizontal'|'vertical'} [orientation] Arrow-key axis. Defaults to `horizontal`.
 * @property {'automatic'|'manual'} [activation] `automatic` selects a tab as focus reaches it; `manual` waits for Enter or Space. Defaults to `automatic`.
 * @property {string} [className] Extra classes merged onto the wrapper.
 * @property {string} [listClassName] Extra classes merged onto the tab list.
 * @property {string} [panelClassName] Extra classes merged onto each panel.
 */

/**
 * Find the next selectable tab, skipping disabled ones and wrapping around.
 *
 * @param {TabItem[]} items Tabs in visual order.
 * @param {number} from Index to move away from.
 * @param {number} step `1` to move forward, `-1` to move back.
 * @returns {number} Index of the next enabled tab, or `from` when there is none.
 */
function nextEnabledIndex(items, from, step) {
  const count = items.length

  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + step * offset) % count) + count) % count
    if (!items[index].disabled) return index
  }

  return from
}

/**
 * Find the first or last selectable tab.
 *
 * @param {TabItem[]} items Tabs in visual order.
 * @param {'first'|'last'} edge Which end to start from.
 * @returns {number} Index of the enabled tab at that edge, or -1 when every tab is disabled.
 */
function edgeEnabledIndex(items, edge) {
  const indexes = items.map((_item, index) => index)
  const ordered = edge === 'first' ? indexes : indexes.reverse()

  return ordered.find((index) => !items[index].disabled) ?? -1
}

/**
 * An accessible tabbed interface implementing the WAI-ARIA tabs pattern.
 *
 * The tab list is a single tab stop: arrow keys move between tabs (Home and End
 * jump to the ends, disabled tabs are skipped and the selection wraps), while
 * Tab from the tab list moves on to the panel. Each tab points at its panel
 * with `aria-controls` and each panel names itself with `aria-labelledby`, so
 * the relationship survives however far apart they are rendered.
 *
 * Works controlled (`activeTabId` plus `onChange`) or uncontrolled
 * (`defaultTabId`).
 *
 * @param {TabsProps} props Component props.
 * @returns {JSX.Element} The rendered tabs.
 */
export function Tabs({
  items,
  label,
  defaultTabId,
  activeTabId,
  onChange,
  orientation = 'horizontal',
  activation = 'automatic',
  className,
  listClassName,
  panelClassName,
  ...rest
}) {
  const generatedId = useId()
  const tabRefs = useRef(new Map())

  const firstEnabled = items[edgeEnabledIndex(items, 'first')]
  const [uncontrolledId, setUncontrolledId] = useState(defaultTabId ?? firstEnabled?.id)

  const isControlled = activeTabId != null
  const currentId = isControlled ? activeTabId : uncontrolledId
  const selectedIndex = Math.max(
    items.findIndex((item) => item.id === currentId),
    0,
  )

  const tabId = useCallback((id) => `tab-${generatedId}-${id}`, [generatedId])
  const panelId = useCallback((id) => `tabpanel-${generatedId}-${id}`, [generatedId])

  const select = useCallback(
    (index, { moveFocus = true } = {}) => {
      const item = items[index]
      if (!item || item.disabled) return

      if (!isControlled) setUncontrolledId(item.id)
      if (moveFocus) focusElement(tabRefs.current.get(item.id))
      if (item.id !== currentId) onChange?.(item.id)
    },
    [items, isControlled, currentId, onChange],
  )

  const handleKeyDown = useCallback(
    (event) => {
      const forwardKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
      const backKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'

      let target = -1

      if (event.key === forwardKey) target = nextEnabledIndex(items, selectedIndex, 1)
      else if (event.key === backKey) target = nextEnabledIndex(items, selectedIndex, -1)
      else if (event.key === 'Home') target = edgeEnabledIndex(items, 'first')
      else if (event.key === 'End') target = edgeEnabledIndex(items, 'last')
      else return

      if (target < 0) return

      event.preventDefault()

      if (activation === 'manual') {
        // Manual activation moves focus only; selection waits for Enter/Space.
        focusElement(tabRefs.current.get(items[target].id))
        return
      }

      select(target)
    },
    [orientation, items, selectedIndex, activation, select],
  )

  return (
    <div data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...rest}>
      <div
        role="tablist"
        aria-label={label}
        aria-orientation={orientation}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex gap-1 border-line',
          orientation === 'vertical' ? 'flex-col border-r pr-2' : 'flex-row border-b',
          listClassName,
        )}
      >
        {items.map((item, index) => {
          const selected = index === selectedIndex

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={tabId(item.id)}
              ref={(element) => {
                if (element) tabRefs.current.set(item.id, element)
                else tabRefs.current.delete(item.id)
              }}
              aria-selected={selected}
              aria-controls={panelId(item.id)}
              // Roving tabindex: the tab list is one stop in the page's tab order.
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(index, { moveFocus: false })}
              className={cn(
                'rounded-t-lg px-4 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                'disabled:cursor-not-allowed disabled:text-ink-subtle',
                selected
                  ? 'border-b-2 border-accent text-accent-strong'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {items.map((item, index) => (
        <div
          key={item.id}
          role="tabpanel"
          id={panelId(item.id)}
          aria-labelledby={tabId(item.id)}
          hidden={index !== selectedIndex}
          tabIndex={0}
          className={cn(
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            panelClassName,
          )}
        >
          {item.content}
        </div>
      ))}
    </div>
  )
}

export default Tabs
