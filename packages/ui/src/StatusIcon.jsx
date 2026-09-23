import { cn } from './cn.js'

/**
 * The glyph for each tone.
 *
 * A shape per meaning, so a status is never carried by colour alone (WCAG
 * 1.4.1): a circle with a tick, a triangle with a bar, a circle with a bar, a
 * circle with an "i". `refusal` is a circle with a stroke through it rather
 * than the danger glyph, because a working guard saying no is not a fault.
 * `pending` is a clock and `mock` a dashed ring, so a simulated state never
 * borrows the shape of a real one.
 *
 * Every path is drawn on a 20 by 20 box in `currentColor`, so the icon takes
 * the text colour of whatever it sits in and needs no token of its own.
 */
const GLYPHS = {
  success: (
    <>
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.5 10.25l2.25 2.25 4.75-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  warning: (
    <>
      <path
        d="M10 2.75L18.25 17H1.75L10 2.75z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8v4.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="10" cy="14.6" r="1" fill="currentColor" />
    </>
  ),
  danger: (
    <>
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 5.75v5.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="10" cy="13.9" r="1" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="6.4" r="1" fill="currentColor" />
      <path d="M10 9v5.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  refusal: (
    <>
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.25 15.75L15.75 4.25" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  pending: (
    <>
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 5.5V10l3 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  mock: (
    <>
      <circle
        cx="10"
        cy="10"
        r="8.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 2.5"
      />
      <circle cx="10" cy="10" r="2.25" fill="currentColor" />
    </>
  ),
  neutral: <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />,
}

/** The tones this icon draws, which are the status tokens' names. */
export const STATUS_TONES = Object.freeze(Object.keys(GLYPHS))

/**
 * @typedef {object} StatusIconProps
 * @property {'success'|'warning'|'danger'|'info'|'refusal'|'pending'|'mock'|'neutral'} [tone] Which glyph. Unknown tones draw the neutral ring.
 * @property {string} [className] Extra classes merged after the defaults.
 */

/**
 * A small status glyph, decorative by design.
 *
 * Always `aria-hidden`: the word beside it is the status, and an icon that
 * also announced itself would say everything twice. A caller that shows the
 * icon without a word is using it wrongly, and no `aria-label` here would fix
 * that.
 *
 * @param {StatusIconProps} props Component props.
 * @returns {JSX.Element} The rendered icon.
 */
export function StatusIcon({ tone = 'neutral', className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      data-slot="status-icon"
      data-tone={GLYPHS[tone] ? tone : 'neutral'}
      className={cn('h-5 w-5 shrink-0', className)}
    >
      {GLYPHS[tone] ?? GLYPHS.neutral}
    </svg>
  )
}

export default StatusIcon
