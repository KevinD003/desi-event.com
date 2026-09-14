import { controlClasses, isInvalidControl } from './controlClasses.js'

/**
 * @typedef {object} InputProps
 * @property {string} [type] Native input type. Defaults to `text`.
 * @property {boolean} [invalid] Renders the error styling and sets `aria-invalid`. `FormField` sets this for you.
 * @property {Ref} [ref] Forwarded to the underlying `input` element.
 * @property {string} [className] Extra classes merged after the defaults.
 */

/**
 * A native text input.
 *
 * Deliberately unlabelled on its own: pair it with `FormField`, or with a
 * `Label` whose `htmlFor` matches this input's `id`. `aria-invalid` is derived
 * from `invalid` unless the caller passes it explicitly.
 *
 * @param {InputProps} props Component props, forwarded to the `input` element.
 * @returns {JSX.Element} The rendered input.
 */
export function Input({ type = 'text', invalid = false, className, ref, 'aria-invalid': ariaInvalid, ...rest }) {
  const isInvalid = isInvalidControl(invalid, ariaInvalid)

  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      aria-invalid={isInvalid || undefined}
      className={controlClasses({ invalid: isInvalid, className })}
      {...rest}
    />
  )
}

export default Input
