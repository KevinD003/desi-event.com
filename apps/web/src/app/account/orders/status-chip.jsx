/**
 * A status as a word, a colour and a shape — in that order of importance.
 *
 * The word carries the meaning. The colour repeats it for somebody who can see
 * it, and the glyph repeats it again for somebody who cannot tell two colours
 * apart (WCAG 1.4.1). The glyph is `aria-hidden`, so a screen reader hears the
 * word once.
 *
 * @module app/account/orders/status-chip
 */

import { StatusIcon } from '../../../components/ui.jsx'

/** Chip classes per tone, from the semantic token layer. */
const TONE = Object.freeze({
  success: 'bg-status-success-soft text-status-success',
  pending: 'bg-status-pending-soft text-status-pending',
  info: 'bg-status-info-soft text-status-info',
  danger: 'bg-status-danger-soft text-status-danger',
  neutral: 'bg-status-neutral-soft text-status-neutral',
})

/**
 * @typedef {object} StatusChipProps
 * @property {{label: string, tone: string}} meaning What the status says, from `order-status.js`.
 */

/**
 * The chip.
 *
 * @param {StatusChipProps} props Component props.
 * @returns {JSX.Element} The chip.
 */
export function StatusChip({ meaning }) {
  const tone = TONE[meaning.tone] ? meaning.tone : 'neutral'

  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pr-3 pl-1.5 text-sm font-semibold ${TONE[tone]}`}
    >
      {/* Its own size, 20px, which is the line height of `text-sm`. */}
      <StatusIcon tone={tone} />
      {meaning.label}
    </span>
  )
}
