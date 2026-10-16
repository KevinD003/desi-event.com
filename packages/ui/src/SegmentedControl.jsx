import { useId, useState } from 'react'

import { cn } from './cn.js'

/**
 * @typedef {object} SegmentedOption
 * @property {string} value The value submitted and reported.
 * @property {ReactNode} label What the segment says.
 * @property {boolean} [disabled] Shown but not choosable.
 */

/**
 * @typedef {object} SegmentedControlProps
 * @property {string} label What the choice is about, for the group's legend. Visually hidden unless `showLabel`.
 * @property {SegmentedOption[]} options Two to five choices.
 * @property {string} [name] The form field name. Generated when absent.
 * @property {string} [value] The chosen value, when controlled.
 * @property {string} [defaultValue] The first choice, when uncontrolled. Defaults to the first option.
 * @property {function(string, Event): void} [onChange] Called with the new value.
 * @property {boolean} [showLabel] Show the legend above the segments.
 * @property {'sm'|'md'} [size] Segment height: `md` 44px (the default), or `sm` 36px under a mouse and 44px under a finger.
 * @property {string} [className] Extra classes merged onto the group.
 */

/**
 * One choice from a few, side by side: "List / Calendar", "Upcoming / Past",
 * "Card / At the venue".
 *
 * Built on native radio buttons inside a `fieldset`, so the browser supplies
 * the semantics and the keyboard model for free — Tab reaches the group once,
 * the arrow keys move the choice — and it submits with a form without any
 * JavaScript. The radios themselves are visually hidden; each segment's label
 * draws the chosen state (a raised white face on a sunken track) and the one
 * focus outline when its radio has keyboard focus.
 *
 * @param {SegmentedControlProps} props Component props.
 * @returns {JSX.Element} The group.
 */
export function SegmentedControl({
  label,
  options,
  name,
  value,
  defaultValue,
  onChange,
  showLabel = false,
  size = 'md',
  className,
}) {
  const generated = useId()
  const fieldName = name ?? `segmented-${generated}`
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value)
  const chosen = value ?? own

  return (
    <fieldset data-slot="segmented-control" className={cn('min-w-0', className)}>
      <legend className={showLabel ? 'mb-2 text-label font-semibold text-ink' : 'sr-only'}>
        {label}
      </legend>
      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-control bg-surface-sunken p-1">
        {options.map((option) => {
          const checked = option.value === chosen

          return (
            <label
              key={option.value}
              data-state={checked ? 'checked' : 'unchecked'}
              className={cn(
                'relative inline-flex items-center justify-center rounded-plate px-3.5 text-label font-semibold transition-colors duration-(--duration-fast) ease-standard select-none',
                size === 'sm' ? 'min-h-9 pointer-coarse:min-h-11' : 'min-h-11',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                checked
                  ? 'bg-surface-raised text-ink shadow-control'
                  : 'text-ink-muted hover:text-ink',
                option.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              )}
            >
              <input
                type="radio"
                name={fieldName}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                onChange={(event) => {
                  if (value === undefined) setOwn(option.value)
                  onChange?.(option.value, event)
                }}
                className="sr-only"
              />
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default SegmentedControl
