import { controlClasses, isInvalidControl } from './controlClasses.js'

/**
 * @typedef {object} TextareaProps
 * @property {number} [rows] Visible rows. Defaults to 4.
 * @property {boolean} [invalid] Renders the error styling and sets `aria-invalid`.
 * @property {Ref} [ref] Forwarded to the underlying `textarea` element.
 * @property {string} [className] Extra classes merged after the defaults.
 */

/**
 * A native multi-line text control.
 *
 * @param {TextareaProps} props Component props, forwarded to the `textarea` element.
 * @returns {JSX.Element} The rendered textarea.
 */
export function Textarea({
  rows = 4,
  invalid = false,
  className,
  ref,
  'aria-invalid': ariaInvalid,
  ...rest
}) {
  const isInvalid = isInvalidControl(invalid, ariaInvalid)

  return (
    <textarea
      ref={ref}
      rows={rows}
      data-slot="textarea"
      aria-invalid={isInvalid || undefined}
      className={controlClasses({ invalid: isInvalid, className: ['resize-y', className] })}
      {...rest}
    />
  )
}

export default Textarea
