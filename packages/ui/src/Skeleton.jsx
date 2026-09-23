import { cn } from './cn.js'

/**
 * @typedef {object} SkeletonProps
 * @property {ElementType} [as] Element to render. Defaults to `span`.
 * @property {number} [lines] Render this many stacked placeholder bars instead of one.
 * @property {string} [className] Extra classes merged after the defaults.
 */

/**
 * A shimmering placeholder shown while content loads.
 *
 * Skeletons are decoration: they are hidden from assistive technology, because
 * a screen reader user should be told "loading" once by a live region rather
 * than hear a description of the placeholder geometry.
 *
 * @param {SkeletonProps} props Component props.
 * @returns {JSX.Element} The rendered placeholder.
 */
export function Skeleton({ as: Component = 'span', lines = 1, className, ...rest }) {
  const bar = 'block animate-pulse rounded-md bg-line/80'

  if (lines > 1) {
    return (
      <Component
        aria-hidden="true"
        data-slot="skeleton"
        className={cn('block space-y-2', className)}
        {...rest}
      >
        {Array.from({ length: lines }, (_unused, index) => (
          <span key={index} className={cn(bar, 'h-4', index === lines - 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </Component>
    )
  }

  return (
    <Component
      aria-hidden="true"
      data-slot="skeleton"
      className={cn(bar, 'h-4 w-full', className)}
      {...rest}
    />
  )
}

export default Skeleton
