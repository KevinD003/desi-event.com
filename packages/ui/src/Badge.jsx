import { cn } from './cn.js'

/** Tailwind classes per badge variant. */
const BADGE_VARIANTS = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-marigold-100 text-marigold-900 ring-marigold-200',
  success: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-100 text-amber-900 ring-amber-200',
  danger: 'bg-rose-100 text-rose-800 ring-rose-200',
  info: 'bg-indigo-night-100 text-indigo-night-900 ring-indigo-night-100',
}

/** Tailwind classes per badge size. */
const BADGE_SIZES = {
  sm: 'px-1.5 py-0.5 text-[0.6875rem]',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
}

/**
 * @typedef {object} BadgeProps
 * @property {'neutral'|'brand'|'success'|'warning'|'danger'|'info'} [variant] Colour token. Defaults to `neutral`.
 * @property {'sm'|'md'|'lg'} [size] Size token. Defaults to `md`.
 * @property {string} [srLabel] Extra context announced before the badge text, for badges whose meaning is carried by colour, e.g. "Status:".
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Badge content.
 */

/**
 * A small status pill.
 *
 * @param {BadgeProps} props Component props.
 * @returns {JSX.Element} The rendered badge.
 */
export function Badge({ variant = 'neutral', size = 'md', srLabel, className, children, ...rest }) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset whitespace-nowrap',
        BADGE_VARIANTS[variant] ?? BADGE_VARIANTS.neutral,
        BADGE_SIZES[size] ?? BADGE_SIZES.md,
        className,
      )}
      {...rest}
    >
      {srLabel ? <span className="sr-only">{srLabel} </span> : null}
      {children}
    </span>
  )
}

export default Badge
