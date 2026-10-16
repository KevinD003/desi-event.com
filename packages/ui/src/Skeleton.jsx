import { cn } from './cn.js'

/**
 * The shapes a placeholder can take, matched to what it stands in for so the
 * page does not jump when the content arrives.
 */
const SHAPES = {
  text: 'h-4 w-full rounded-plate',
  title: 'h-8 w-1/2 rounded-plate',
  block: 'h-32 w-full rounded-card',
  circle: 'h-10 w-10 rounded-full',
  button: 'h-11 w-32 rounded-control',
}

/**
 * @typedef {object} SkeletonProps
 * @property {ElementType} [as] Element to render. Defaults to `span`.
 * @property {'text'|'title'|'block'|'circle'|'button'} [variant] The shape. Defaults to `text`, a line of body copy.
 * @property {number} [lines] Render this many stacked text bars instead of one, the last one short.
 * @property {number} [rows] Render this many table rows, each a short and a long bar and a figure.
 * @property {string} [className] Extra classes merged after the defaults.
 */

/**
 * A placeholder shown while content loads, in the shape of what is coming.
 *
 * Skeletons are decoration: they are hidden from assistive technology,
 * because a screen reader user should be told "loading" once by a live region
 * rather than hear a description of the placeholder geometry. They pulse
 * slowly only where motion is welcome (`motion-safe:`); a reader who asked
 * for less gets a still placeholder.
 *
 * @param {SkeletonProps} props Component props.
 * @returns {JSX.Element} The rendered placeholder.
 */
export function Skeleton({
  as: Component = 'span',
  variant = 'text',
  lines = 1,
  rows = 0,
  className,
  ...rest
}) {
  const fill = 'block bg-surface-sunken motion-safe:animate-pulse'

  if (rows > 0) {
    return (
      <Component
        aria-hidden="true"
        data-slot="skeleton"
        data-variant="rows"
        className={cn('block divide-y divide-line', className)}
        {...rest}
      >
        {Array.from({ length: rows }, (_unused, index) => (
          <span key={index} className="flex items-center gap-4 py-3">
            <span className={cn(fill, 'h-4 w-1/4 rounded-plate')} />
            <span className={cn(fill, 'h-4 flex-1 rounded-plate')} />
            <span className={cn(fill, 'h-4 w-16 rounded-plate')} />
          </span>
        ))}
      </Component>
    )
  }

  if (lines > 1) {
    return (
      <Component
        aria-hidden="true"
        data-slot="skeleton"
        data-variant="lines"
        className={cn('block space-y-2', className)}
        {...rest}
      >
        {Array.from({ length: lines }, (_unused, index) => (
          <span
            key={index}
            className={cn(fill, 'h-4 rounded-plate', index === lines - 1 ? 'w-2/3' : 'w-full')}
          />
        ))}
      </Component>
    )
  }

  return (
    <Component
      aria-hidden="true"
      data-slot="skeleton"
      data-variant={SHAPES[variant] ? variant : 'text'}
      className={cn(fill, SHAPES[variant] ?? SHAPES.text, className)}
      {...rest}
    />
  )
}

export default Skeleton
