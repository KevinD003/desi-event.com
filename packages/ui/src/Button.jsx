import { cn } from './cn.js'
import { Spinner } from './Spinner.jsx'

/**
 * Tailwind classes per button variant.
 *
 * `primary` sits on marigold-**700**, not 600. White on marigold-600 is 3.12:1,
 * and WCAG AA asks for 4.5:1 at this text size; 700 is 4.70:1. The brand colour
 * is unchanged everywhere it is a surface rather than a background for small
 * white text — this is a contrast decision about one component, not a repaint.
 * The scanner in `accessibility-sweep.spec.js` is what found it.
 */
const BUTTON_VARIANTS = {
  primary:
    'bg-marigold-700 text-white shadow-sm hover:bg-marigold-800 focus-visible:ring-marigold-600',
  secondary:
    'bg-indigo-night-700 text-white shadow-sm hover:bg-indigo-night-900 focus-visible:ring-indigo-night-500',
  outline:
    'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 focus-visible:ring-marigold-500',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 focus-visible:ring-rose-500',
}

/** Tailwind classes per button size. */
const BUTTON_SIZES = {
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-6 text-base',
}

/** Spinner size that reads well inside each button size. */
const SPINNER_FOR_SIZE = { sm: 'xs', md: 'sm', lg: 'md' }

/**
 * @typedef {object} ButtonProps
 * @property {'primary'|'secondary'|'outline'|'ghost'|'danger'} [variant] Visual variant. Defaults to `primary`.
 * @property {'sm'|'md'|'lg'} [size] Size token. Defaults to `md`.
 * @property {boolean} [loading] Shows a spinner, sets `aria-busy` and blocks interaction while an action is in flight.
 * @property {boolean} [disabled] Disables the button.
 * @property {boolean} [fullWidth] Stretches the button to the width of its container.
 * @property {string} [type] Native button type. Defaults to `button`, never the surprising `submit`.
 * @property {Ref} [ref] Forwarded to the underlying `button` element.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Button label.
 */

/**
 * The library's button primitive.
 *
 * `loading` is a real state, not a style: the button reports `aria-busy`, is
 * disabled so neither pointer nor keyboard can fire the action twice, and shows
 * a decorative spinner. The accessible name is left alone so that a button does
 * not rename itself halfway through a submission.
 *
 * @param {ButtonProps} props Component props, forwarded to the `button` element.
 * @returns {JSX.Element} The rendered button.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  type = 'button',
  className,
  children,
  ref,
  ...rest
}) {
  const isDisabled = disabled || loading

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-slot="button"
      data-variant={variant}
      data-loading={loading ? 'true' : undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.primary,
        BUTTON_SIZES[size] ?? BUTTON_SIZES.md,
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={SPINNER_FOR_SIZE[size] ?? 'sm'} label={null} /> : null}
      {children}
    </button>
  )
}

export default Button
