import { buttonClasses } from './buttonClasses.js'
import { Spinner } from './Spinner.jsx'

/** Spinner size that reads well inside each button size. */
const SPINNER_FOR_SIZE = { sm: 'xs', md: 'sm', lg: 'md' }

/**
 * @typedef {object} ButtonProps
 * @property {'primary'|'secondary'|'outline'|'ghost'|'danger'|'accent'|'ink'|'inverse'} [variant] Visual variant. Defaults to `primary`.
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
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner size={SPINNER_FOR_SIZE[size] ?? 'sm'} label={null} /> : null}
      {children}
    </button>
  )
}

/**
 * @typedef {object} ButtonLinkProps
 * @property {ElementType} [as] What renders the link: `a` by default, or a router's link component (Next's `Link`) passed in by the app, since this library knows no router.
 * @property {string} href Where it goes.
 * @property {'primary'|'secondary'|'outline'|'ghost'|'danger'|'accent'|'ink'|'inverse'} [variant] Visual variant. Defaults to `primary`.
 * @property {'sm'|'md'|'lg'} [size] Size token. Defaults to `md`.
 * @property {boolean} [fullWidth] Stretches to the width of the container.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] The label.
 */

/**
 * A link drawn as a button.
 *
 * A navigation is a link even when it looks like a button — "Choose tickets"
 * goes to another page, it does not do anything on this one — so this renders
 * an anchor (or the router's link), never a `<button>` pretending to
 * navigate. It looks exactly like the {@link Button} of the same variant and
 * size.
 *
 * @param {ButtonLinkProps} props Component props, forwarded to the link.
 * @returns {JSX.Element} The link.
 */
export function ButtonLink({
  as: Component = 'a',
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  children,
  ...rest
}) {
  return (
    <Component
      data-slot="button-link"
      data-variant={variant}
      className={buttonClasses({ variant, size, fullWidth, element: 'link', className })}
      {...rest}
    >
      {children}
    </Component>
  )
}

export default Button
