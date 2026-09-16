import { cn } from './cn.js'

/**
 * @typedef {object} VisuallyHiddenProps
 * @property {ElementType} [as] Element to render. Defaults to `span`.
 * @property {boolean} [focusable] When true the content becomes visible once it receives focus, the "skip link" pattern.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Content exposed to assistive technology.
 */

/**
 * Hide content visually while leaving it in the accessibility tree.
 *
 * Uses the standard clip pattern (Tailwind's `sr-only`), never `display: none`
 * or `visibility: hidden`, because those remove the content from the
 * accessibility tree as well as from the screen.
 *
 * @param {VisuallyHiddenProps} props Component props.
 * @returns {JSX.Element} The rendered element.
 */
export function VisuallyHidden({
  as: Component = 'span',
  focusable = false,
  className,
  children,
  ...rest
}) {
  return (
    <Component className={cn('sr-only', focusable && 'focus:not-sr-only', className)} {...rest}>
      {children}
    </Component>
  )
}

export default VisuallyHidden
