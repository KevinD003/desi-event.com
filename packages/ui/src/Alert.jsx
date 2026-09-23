import { cn } from './cn.js'
import { StatusIcon } from './StatusIcon.jsx'

/**
 * Semantic classes per alert variant.
 *
 * The body is always `ink`, and only the title and the icon take the status
 * colour. Body copy in amber or rose was harder to read than it needed to be,
 * and the colour was doing a job the icon, the title and the role already do.
 * Every pairing — body on each soft ground, status word on it — is pinned in
 * `token-contrast.test.js`.
 */
const ALERT_VARIANTS = {
  info: {
    box: 'border-status-info/25 bg-status-info-soft',
    accent: 'text-status-info',
    tone: 'info',
  },
  success: {
    box: 'border-status-success/25 bg-status-success-soft',
    accent: 'text-status-success',
    tone: 'success',
  },
  warning: {
    box: 'border-status-warning/30 bg-status-warning-soft',
    accent: 'text-status-warning',
    tone: 'warning',
  },
  error: {
    box: 'border-status-danger/25 bg-status-danger-soft',
    accent: 'text-status-danger',
    tone: 'danger',
  },
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
  const styles = ALERT_VARIANTS[variant] ?? ALERT_VARIANTS.info

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      data-slot="alert"
      data-variant={variant}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm text-ink',
        styles.box,
        className,
      )}
      {...rest}
    >
      <StatusIcon tone={styles.tone} className={cn('mt-px', styles.accent)} />
      <div className="min-w-0 flex-1">
        {title ? <p className={cn('font-semibold', styles.accent)}>{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">{dismissLabel}</span>
        </button>
      ) : null}
    </div>
  )
}

export default Alert
