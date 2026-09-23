import { cn } from './cn.js'
import { Spinner } from './Spinner.jsx'

/**
 * Tailwind classes per button variant, in semantic tokens only.
 *
 * `primary` is the register's primary action: deep marigold on public pages,
 * indigo inside a signed-in area. It was marigold-700 with white text at
 * 4.70:1, chosen because white on marigold-600 is 3.12:1; the token is darker
 * still, 7.22:1, and `token-contrast.test.js` pins it resting and hovered in
 * both registers.
 *
 * `secondary` is every other action a screen offers beside the primary one —
 * cancel, dismiss, clear, stop — so it is outlined rather than filled: a
 * second filled colour next to the primary made two buttons compete for one
 * decision. `outline` is the same thing under its older name, kept so no
 * caller changes meaning.
 *
 * Every variant uses the one focus ring. It used to be a different colour per
 * variant, and three of the five were below 3:1 against white.
 */
const SECONDARY =
  'border border-action-secondary-line bg-action-secondary text-action-secondary-ink hover:bg-action-secondary-hover'

const BUTTON_VARIANTS = {
  primary: 'bg-action-primary text-action-primary-ink shadow-sm hover:bg-action-primary-hover',
  secondary: SECONDARY,
  outline: SECONDARY,
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-subtle hover:text-ink',
  danger: 'bg-action-danger text-action-danger-ink shadow-sm hover:bg-action-danger-hover',
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
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
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
