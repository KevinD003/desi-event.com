import { cn } from './cn.js'

/** Tailwind classes per alert variant. */
const ALERT_VARIANTS = {
  info: 'border-indigo-night-100 bg-indigo-night-50 text-indigo-night-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-rose-200 bg-rose-50 text-rose-900',
}

/**
 * Variants that interrupt the user. `role="alert"` is assertive and preempts
 * whatever the screen reader is saying, which is right for a failure and wrong
 * for "saved".
 */
const URGENT_VARIANTS = new Set(['warning', 'error'])

/**
 * @typedef {object} AlertProps
 * @property {'info'|'success'|'warning'|'error'} [variant] Severity. Defaults to `info`.
 * @property {string} [title] Optional heading shown above the message.
 * @property {Function} [onDismiss] When supplied, renders a labelled close button that calls this.
 * @property {string} [dismissLabel] Accessible name of the close button. Defaults to `Dismiss`.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Alert body.
 */

/**
 * An inline message about the result of an action or the state of a page.
 *
 * Urgent variants use `role="alert"` (assertive); informational ones use
 * `role="status"` (polite) so routine confirmations do not cut the screen
 * reader off mid-sentence.
 *
 * @param {AlertProps} props Component props.
 * @returns {JSX.Element} The rendered alert.
 */
export function Alert({
  variant = 'info',
  title,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
  children,
  ...rest
}) {
  const urgent = URGENT_VARIANTS.has(variant)

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      data-slot="alert"
      data-variant={variant}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
        ALERT_VARIANTS[variant] ?? ALERT_VARIANTS.info,
        className,
      )}
      {...rest}
    >
      <div className="flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 rounded p-1 leading-none text-current/70 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">{dismissLabel}</span>
        </button>
      ) : null}
    </div>
  )
}

export default Alert
