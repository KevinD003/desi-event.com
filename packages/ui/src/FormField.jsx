import { cloneElement, isValidElement, useId } from 'react'
import { cn } from './cn.js'
import { Label } from './Label.jsx'

/**
 * @typedef {object} FormFieldControlProps
 * @property {string} id Id to put on the control, matching the label's `htmlFor`.
 * @property {string} [aria-describedby] Space-separated ids of the description and error text.
 * @property {boolean} [aria-invalid] Present only when the field is in error.
 * @property {boolean} [required] Mirrors the field's `required` prop.
 */

/**
 * @typedef {object} FormFieldProps
 * @property {ReactNode} label Label text. A field without a label is not a field.
 * @property {ReactNode|Function} children The control. Either a single element, which is cloned with the wiring props, or a render function receiving {@link FormFieldControlProps}.
 * @property {ReactNode} [description] Help text rendered under the label and referenced by `aria-describedby`.
 * @property {ReactNode} [error] Validation message. Its presence flips the field into the invalid state.
 * @property {boolean} [required] Marks the control as required.
 * @property {string} [id] Explicit control id. Generated with `useId` when omitted.
 * @property {string} [className] Extra classes merged after the defaults.
 */

/**
 * Wire a label, a control, help text and a validation message into one
 * accessible field.
 *
 * The control receives a generated `id` that the label points at with
 * `htmlFor`, an `aria-describedby` listing whichever of the description and
 * error are present, and `aria-invalid` while an error is showing. The error
 * itself is a live region, so a message that appears after a failed submit is
 * announced rather than silently drawn.
 *
 * @param {FormFieldProps} props Component props.
 * @returns {JSX.Element} The rendered field.
 * @throws {TypeError} When `children` is neither a single element nor a render function.
 */
export function FormField({
  label,
  children,
  description,
  error,
  required = false,
  id,
  className,
  ...rest
}) {
  const generatedId = useId()
  const controlId = id ?? `field-${generatedId}`
  const descriptionId = `${controlId}-description`
  const errorId = `${controlId}-error`

  const describedBy = cn(description && descriptionId, error && errorId) || undefined

  /** @type {FormFieldControlProps} */
  const controlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    required: required || undefined,
  }

  let control

  if (typeof children === 'function') {
    control = children(controlProps)
  } else if (isValidElement(children)) {
    // Respect any description the caller already attached to the control.
    const existingDescribedBy = children.props['aria-describedby']
    control = cloneElement(children, {
      ...controlProps,
      'aria-describedby': cn(existingDescribedBy, describedBy) || undefined,
    })
  } else {
    throw new TypeError('FormField expects a single control element or a render function as children')
  }

  return (
    <div data-slot="form-field" className={cn('flex flex-col gap-1.5', className)} {...rest}>
      <Label htmlFor={controlId} required={required}>
        {label}
      </Label>
      {description ? (
        <p id={descriptionId} className="text-sm text-slate-500">
          {description}
        </p>
      ) : null}
      {control}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default FormField
