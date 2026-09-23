import { cn } from './cn.js'

/**
 * @typedef {object} EmptyStateProps
 * @property {ReactNode} title Short statement of what is missing, e.g. "No events yet".
 * @property {ReactNode} [description] One or two sentences explaining what to do next.
 * @property {ReactNode} [icon] Decorative illustration. Hidden from assistive technology.
 * @property {ReactNode} [action] Call to action, typically a `Button` or a link.
 * @property {'h2'|'h3'|'h4'|'p'} [headingLevel] Element used for the title. Pick the level that keeps the page outline correct. Defaults to `h2`.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Extra content rendered below the description.
 */

/**
 * The placeholder shown where a list, search result or dashboard has nothing
 * to show.
 *
 * The title is a real heading so that a screen reader user navigating by
 * heading lands on the explanation instead of an apparently empty region, and
 * the icon is hidden because it repeats the title.
 *
 * @param {EmptyStateProps} props Component props.
 * @returns {JSX.Element} The rendered empty state.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  headingLevel: Heading = 'h2',
  className,
  children,
  ...rest
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong px-6 py-12 text-center',
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden="true" className="text-3xl text-ink-subtle">
          {icon}
        </span>
      ) : null}
      <Heading className="text-lg font-semibold text-ink">{title}</Heading>
      {description ? <p className="max-w-prose text-sm text-ink-muted">{description}</p> : null}
      {children}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export default EmptyState
