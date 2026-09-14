import { cn } from './cn.js'

/**
 * @typedef {object} CardProps
 * @property {ElementType} [as] Element to render. Use `article` or `li` when the card is a list item.
 * @property {boolean} [interactive] Adds hover and focus affordances for cards that wrap a link.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Card content.
 */

/**
 * A surface that groups related content.
 *
 * The element is deliberately configurable through `as`: a card inside a list
 * should be an `li`, and a card describing one entity should be an `article`,
 * so that the document outline stays meaningful.
 *
 * @param {CardProps} props Component props.
 * @returns {JSX.Element} The rendered card.
 */
export function Card({ as: Component = 'div', interactive = false, className, children, ...rest }) {
  return (
    <Component
      data-slot="card"
      className={cn(
        'rounded-card border border-slate-200 bg-white text-slate-900 shadow-sm',
        interactive &&
          'transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-marigold-500 focus-within:ring-offset-2',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * @typedef {object} CardSectionProps
 * @property {ElementType} [as] Element to render.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Section content.
 */

/**
 * The top section of a {@link Card}, typically holding its heading.
 *
 * @param {CardSectionProps} props Component props.
 * @returns {JSX.Element} The rendered header.
 */
export function CardHeader({ as: Component = 'div', className, children, ...rest }) {
  return (
    <Component
      data-slot="card-header"
      className={cn('flex flex-col gap-1 border-b border-slate-200 px-5 py-4', className)}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * The main content section of a {@link Card}.
 *
 * @param {CardSectionProps} props Component props.
 * @returns {JSX.Element} The rendered body.
 */
export function CardBody({ as: Component = 'div', className, children, ...rest }) {
  return (
    <Component data-slot="card-body" className={cn('px-5 py-4', className)} {...rest}>
      {children}
    </Component>
  )
}

/**
 * The bottom section of a {@link Card}, typically holding actions.
 *
 * @param {CardSectionProps} props Component props.
 * @returns {JSX.Element} The rendered footer.
 */
export function CardFooter({ as: Component = 'div', className, children, ...rest }) {
  return (
    <Component
      data-slot="card-footer"
      className={cn('flex items-center gap-3 border-t border-slate-200 px-5 py-3', className)}
      {...rest}
    >
      {children}
    </Component>
  )
}
