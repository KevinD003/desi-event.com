'use client'

/**
 * A quantity picker for one ticket tier.
 *
 * It is a real `<input type="number">` between two buttons rather than three
 * buttons pretending to be a field: someone buying eight tickets should be able
 * to type `8`, and the native control brings its own numeric keypad on mobile
 * and its own screen-reader semantics.
 *
 * The tier's `minPerOrder` is respected as a *step off zero* rather than a
 * floor — a basket is allowed to contain none of a tier — so increasing from
 * zero jumps straight to the minimum and decreasing to below it clears the
 * line entirely.
 *
 * @module components/quantity-stepper
 */

import { useId } from 'react'

/**
 * @typedef {object} QuantityStepperProps
 * @property {string} label Name of the tier, used to build the control's accessible name.
 * @property {number} value Current quantity.
 * @property {number} max Largest quantity this tier allows right now.
 * @property {number} [min] Smallest non-zero quantity, the tier's `minPerOrder`.
 * @property {boolean} [disabled] Disables the whole control, e.g. for a sold-out tier.
 * @property {Function} onChange Called with the new quantity whenever it changes.
 * @property {string} [describedBy] Id of the element describing availability for this tier.
 */

/**
 * Clamp a requested quantity to what the tier allows.
 *
 * @param {number} requested Raw requested quantity.
 * @param {number} min Smallest non-zero quantity.
 * @param {number} max Largest allowed quantity.
 * @returns {number} `0`, or a quantity within `[min, max]`.
 */
export function clampQuantity(requested, min, max) {
  if (!Number.isFinite(requested) || requested <= 0) return 0
  if (max <= 0) return 0

  const rounded = Math.floor(requested)

  if (rounded < min) return Math.min(min, max)

  return Math.min(rounded, max)
}

/**
 * A minus/number/plus quantity control.
 *
 * @param {QuantityStepperProps} props Component props.
 * @returns {JSX.Element} The rendered stepper.
 */
export function QuantityStepper({
  label,
  value,
  max,
  min = 1,
  disabled = false,
  onChange,
  describedBy,
}) {
  const inputId = `qty-${useId()}`
  const atFloor = value <= 0
  const atCeiling = value >= max

  // 44px square, the site's touch target: a stepper is tapped repeatedly, on
  // a phone, by somebody counting heads, and a 36px button is an easy miss.
  const buttonClasses =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-xl leading-none font-bold text-ink transition-colors duration-(--duration-fast) hover:bg-accent-soft hover:text-accent-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-transparent motion-safe:enabled:active:scale-95'

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={inputId} className="sr-only">
        Quantity of {label}
      </label>
      <div
        className={`inline-flex items-center gap-0.5 rounded-[0.875rem] border border-line-strong bg-surface-raised p-0.5${
          disabled ? ' opacity-60' : ''
        }`}
      >
        <button
          type="button"
          className={buttonClasses}
          disabled={disabled || atFloor}
          aria-label={`Remove one ${label}`}
          onClick={() => onChange(clampQuantity(value - 1 < min ? 0 : value - 1, min, max))}
        >
          <span aria-hidden="true">−</span>
        </button>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          className="h-11 w-11 rounded-control bg-transparent text-center text-base font-bold text-ink tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          value={value}
          min={0}
          max={max}
          step={1}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(clampQuantity(Number(event.target.value), min, max))}
        />
        <button
          type="button"
          className={buttonClasses}
          disabled={disabled || atCeiling}
          aria-label={`Add one ${label}`}
          onClick={() => onChange(clampQuantity(value === 0 ? min : value + 1, min, max))}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  )
}
