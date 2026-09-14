import { cn } from './cn.js'

/**
 * @typedef {object} LabelProps
 * @property {string} [htmlFor] Id of the control this label names. Required for the label to do anything at all.
 * @property {boolean} [required] Marks the control as required, both visually and for assistive technology.
 * @property {string} [requiredLabel] Text announced for the required marker. Defaults to `(required)`.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Label text.
 */

/**
 * A form label bound to a control through `htmlFor`.
 *
 * The required marker is an asterisk for sighted users plus visually hidden
 * words for screen reader users, because a lone "*" is read as "star" or
 * skipped entirely depending on the verbosity setting.
 *
 * @param {LabelProps} props Component props.
 * @returns {JSX.Element} The rendered label.
 */
export function Label({ htmlFor, required = false, requiredLabel = '(required)', className, children, ...rest }) {
  return (
    <label
      htmlFor={htmlFor}
      data-slot="label"
      className={cn('text-sm font-medium text-slate-900', className)}
      {...rest}
    >
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="ml-0.5 text-rose-600">
            *
          </span>
          <span className="sr-only"> {requiredLabel}</span>
        </>
      ) : null}
    </label>
  )
}

export default Label
