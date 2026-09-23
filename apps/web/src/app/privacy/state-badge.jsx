/**
 * A request or hold state, rendered so it reads the same to everyone.
 *
 * Colour carries meaning on this surface — held and stopped-safely are not the
 * same kind of thing as completed — so colour alone would hide that difference
 * from anybody who cannot see it. Every badge therefore carries its own words,
 * and the colour is redundant reinforcement rather than the message.
 *
 * The palette is deliberately not a traffic light. `COMPLETED` is not "good"
 * (somebody was erased) and `HELD` is not "bad" (the system refused correctly).
 * They are *different*, which is all the colour is asked to say.
 *
 * @module app/privacy/state-badge
 */

/** Tailwind classes per state. Unknown states fall back to slate. */
const TONES = Object.freeze({
  REQUESTED: 'border-status-warning/30 bg-status-warning-soft text-status-warning',
  QUEUED: 'border-status-info/25 bg-status-info-soft text-status-info',
  PROCESSING: 'border-status-info/25 bg-status-info-soft text-status-info',
  COMPLETED: 'border-status-success/25 bg-status-success-soft text-status-success',
  HELD: 'border-status-refusal/25 bg-status-refusal-soft text-status-refusal',
  FAILED_SAFE: 'border-status-danger/25 bg-status-danger-soft text-status-danger',
  CANCELLED: 'border-line-strong bg-surface-subtle text-ink-muted',
  ACTIVE: 'border-status-refusal/25 bg-status-refusal-soft text-status-refusal',
  RELEASED: 'border-line-strong bg-surface-subtle text-ink-muted',
})

/**
 * @typedef {object} StateBadgeProps
 * @property {string} state The raw state, used only to choose a tone.
 * @property {string} label The words. Never omitted — colour is not the message.
 */

/**
 * One state, as a badge.
 *
 * @param {StateBadgeProps} props Component props.
 * @returns {JSX.Element} The badge.
 */
export function StateBadge({ state, label }) {
  const tone = TONES[state] ?? 'border-line-strong bg-surface-subtle text-ink-muted'

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tone}`}
    >
      {label}
    </span>
  )
}
