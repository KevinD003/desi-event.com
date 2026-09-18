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
  REQUESTED: 'border-amber-300 bg-amber-50 text-amber-900',
  QUEUED: 'border-sky-300 bg-sky-50 text-sky-900',
  PROCESSING: 'border-sky-300 bg-sky-50 text-sky-900',
  COMPLETED: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  HELD: 'border-violet-300 bg-violet-50 text-violet-900',
  FAILED_SAFE: 'border-rose-300 bg-rose-50 text-rose-900',
  CANCELLED: 'border-slate-300 bg-slate-100 text-slate-700',
  ACTIVE: 'border-violet-300 bg-violet-50 text-violet-900',
  RELEASED: 'border-slate-300 bg-slate-100 text-slate-700',
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
  const tone = TONES[state] ?? 'border-slate-300 bg-slate-100 text-slate-700'

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tone}`}
    >
      {label}
    </span>
  )
}
