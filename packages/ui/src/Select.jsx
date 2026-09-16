import { controlClasses, isInvalidControl } from './controlClasses.js'

/**
 * @typedef {object} SelectOption
 * @property {string} value Submitted value.
 * @property {string} label Text shown to the user.
 * @property {boolean} [disabled] Whether the option can be chosen.
 */

/**
 * @typedef {object} SelectProps
 * @property {SelectOption[]} [options] Options to render. Ignored when `children` are supplied.
 * @property {string} [placeholder] Text for a leading empty option, e.g. "Choose a city".
 * @property {boolean} [invalid] Renders the error styling and sets `aria-invalid`.
 * @property {Ref} [ref] Forwarded to the underlying `select` element.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Hand-written `option`/`optgroup` markup.
 */

/**
 * A native select.
 *
 * A native `select` is used rather than a custom listbox because the platform
 * control already behaves correctly with every screen reader, on touch, and
 * with keyboard type-ahead.
 *
 * @param {SelectProps} props Component props, forwarded to the `select` element.
 * @returns {JSX.Element} The rendered select.
 */
export function Select({
  options,
  placeholder,
  invalid = false,
  className,
  children,
  ref,
  'aria-invalid': ariaInvalid,
  ...rest
}) {
  const isInvalid = isInvalidControl(invalid, ariaInvalid)

  return (
    <select
      ref={ref}
      data-slot="select"
      aria-invalid={isInvalid || undefined}
      className={controlClasses({ invalid: isInvalid, className: ['pr-8', className] })}
      {...rest}
    >
      {placeholder ? (
        <option value="" disabled={rest.required}>
          {placeholder}
        </option>
      ) : null}
      {children ??
        (options ?? []).map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
    </select>
  )
}

export default Select
