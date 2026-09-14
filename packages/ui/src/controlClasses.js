/**
 * Shared Tailwind classes for the native form controls (`Input`, `Textarea`,
 * `Select`) so that the three stay visually identical and gain a consistent
 * invalid state.
 *
 * @module @desi-event/ui/controlClasses
 */

import { cn } from './cn.js'

/** Classes every control shares: layout, border, typography and focus ring. */
export const CONTROL_BASE_CLASSES =
  'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ' +
  'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-1 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

/** Border and focus ring colours for a control in its valid state. */
export const CONTROL_VALID_CLASSES =
  'border-slate-300 focus:border-marigold-500 focus:ring-marigold-500'

/** Border and focus ring colours for a control that failed validation. */
export const CONTROL_INVALID_CLASSES = 'border-rose-500 focus:border-rose-600 focus:ring-rose-500'

/**
 * Build the class name for a native form control.
 *
 * @param {object} options Options.
 * @param {boolean} [options.invalid] Whether the control is currently invalid.
 * @param {string} [options.className] Caller classes, merged last so they win.
 * @returns {string} The merged class name string.
 */
export function controlClasses({ invalid = false, className } = {}) {
  return cn(
    CONTROL_BASE_CLASSES,
    invalid ? CONTROL_INVALID_CLASSES : CONTROL_VALID_CLASSES,
    className,
  )
}

/**
 * Decide whether a control should render its invalid state.
 *
 * `FormField` communicates validity through `aria-invalid` alone, so a control
 * dropped inside one must honour that attribute as well as its own `invalid`
 * prop, otherwise the styling and the accessibility tree disagree.
 *
 * @param {boolean} [invalid] The control's own `invalid` prop.
 * @param {boolean|string} [ariaInvalid] An `aria-invalid` value received from a parent field.
 * @returns {boolean} True when the control is invalid.
 */
export function isInvalidControl(invalid, ariaInvalid) {
  return Boolean(invalid) || ariaInvalid === true || ariaInvalid === 'true'
}
