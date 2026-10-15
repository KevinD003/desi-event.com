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
 * @typedef {object} AlertProps
 * @property {'info'|'success'|'warning'|'error'} [variant] Severity. Defaults to `info`.
 * @property {string} [title] Optional heading shown above the message.
 * @property {Function} [onDismiss] When supplied, renders a labelled close button that calls this.
 * @property {string} [dismissLabel] Accessible name of the close button. Defaults to `Dismiss`.
 * @property {boolean} [urgent] Interrupt the screen reader. Reserved for outcomes that cannot wait, such as a refusal at the door.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] Alert body.
 */

/**
 * An inline message about the result of an action or the state of a page.
 *
 * Every variant is `role="status"` (polite) unless it is marked `urgent`.
 * An assertive region preempts whatever the screen reader is saying, and a
 * page that interrupts for every failed save teaches people to stop listening;
 * so severity alone does not earn it. `urgent` is for the few outcomes that
 * cannot wait for the reader to finish — a ticket refused at the door, a
 * ticket already admitted — and becomes `role="alert"` (assertive).
 *
 * A form that fails moves focus to its message as well, so a polite region is
 * not the only way the failure is heard.
 *
 * @param {AlertProps} props Component props.
 * @returns {JSX.Element} The rendered alert.
 */
export function Alert({
  variant = 'info',
  title,
  onDismiss,
  dismissLabel = 'Dismiss',
  urgent = false,
  className,
  children,
  ...rest
}) {
  const styles = ALERT_VARIANTS[variant] ?? ALERT_VARIANTS.info

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      data-slot="alert"
      data-variant={variant}
      className={cn(
        'flex items-start gap-3 rounded-control border px-4 py-3 text-sm text-ink',
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
          // 32px under a mouse, 44px under a finger; the negative margins keep
          // the glyph where the smaller button put it.
          className="-my-1.5 -mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-(--duration-fast) ease-standard hover:bg-surface/60 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">{dismissLabel}</span>
        </button>
      ) : null}
    </div>
  )
}

export default Alert
