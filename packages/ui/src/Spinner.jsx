import { cn } from './cn.js'
import { VisuallyHidden } from './VisuallyHidden.jsx'

/** Tailwind sizing per spinner size token. */
const SPINNER_SIZES = {
  xs: 'h-3 w-3 border',
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-2',
}

/**
 * @typedef {object} SpinnerProps
 * @property {'xs'|'sm'|'md'|'lg'} [size] Diameter token. Defaults to `md`.
 * @property {string|null} [label] Text announced while the spinner is shown. Pass `null` for a purely decorative spinner, e.g. inside a button that already sets `aria-busy`.
 * @property {string} [className] Extra classes merged after the defaults.
 */

/**
 * An indeterminate loading indicator.
 *
 * With a `label` the spinner is a live region (`role="status"`) carrying
 * visually hidden text; without one it is hidden from assistive technology so
 * that a surrounding control owns the announcement instead.
 *
 * @param {SpinnerProps} props Component props.
 * @returns {JSX.Element} The rendered spinner.
 */
export function Spinner({ size = 'md', label = 'Loading', className, ...rest }) {
  const circle = (
    <span
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent align-[-0.125em]',
        SPINNER_SIZES[size] ?? SPINNER_SIZES.md,
        className,
      )}
    />
  )

  if (label == null) {
    return (
      <span aria-hidden="true" data-slot="spinner" {...rest}>
        {circle}
      </span>
    )
  }

  return (
    <span role="status" data-slot="spinner" {...rest}>
      {circle}
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  )
}

export default Spinner
