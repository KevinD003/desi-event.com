import { useEffect, useRef, useState } from 'react'

import { cn } from './cn.js'

/** How long a changed figure takes to roll to its new value, in milliseconds. */
export const ROLL_MS = 600

/**
 * Whether the platform asks for reduced motion, read when it matters.
 *
 * @returns {boolean} True when motion should be kept to a minimum.
 */
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  )
}

/**
 * An ease-out curve, as a function of progress: fast at first, settling.
 *
 * @param {number} t Progress, 0..1.
 * @returns {number} Eased progress, 0..1.
 */
function easeOut(t) {
  return 1 - (1 - t) ** 3
}

/**
 * The figure shown while a number rolls from one value to another.
 *
 * Rolls only on a real change, never on first render: a dashboard's figures
 * are data a person reads, not a show, so they arrive as they are. Under
 * reduced motion, or when either value is not a finite number, the new value
 * is simply shown.
 *
 * @param {unknown} value The value to show.
 * @param {boolean} roll Whether a change may roll.
 * @returns {unknown} The value to draw this frame.
 */
function useRolledValue(value, roll) {
  // Null whenever nothing is rolling: the value itself is shown. Only the
  // animation frames below ever set it, never the render or the effect body.
  const [frameValue, setFrameValue] = useState(null)
  const previous = useRef(value)

  useEffect(() => {
    const from = previous.current
    previous.current = value

    if (!roll || prefersReducedMotion() || from === value) return undefined
    if (!Number.isFinite(from) || !Number.isFinite(value)) return undefined

    let frame = 0
    const start = performance.now()

    /**
     * Draw one frame of the roll.
     *
     * @param {number} now The frame's timestamp.
     * @returns {void}
     */
    const step = (now) => {
      const progress = Math.min(1, (now - start) / ROLL_MS)

      setFrameValue(progress === 1 ? null : from + (value - from) * easeOut(progress))
      if (progress < 1) frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(frame)
      setFrameValue(null)
    }
  }, [value, roll])

  return frameValue ?? value
}

/**
 * @typedef {object} StatProps
 * @property {ReactNode} label What the figure counts, in words: "Tickets sold".
 * @property {number|string} value The figure. A number is formatted with `format`.
 * @property {function(number): string} [format] Turns a number into its words: a currency formatter for money. Defaults to grouped digits (`1,284`).
 * @property {ReactNode} [hint] A line under the figure: what it covers, or where it came from.
 * @property {boolean} [roll] Roll to a changed number rather than jump to it. Off by default, and never under reduced motion.
 * @property {'div'|'li'} [as] The element. `li` inside a list of figures. Defaults to `div`.
 * @property {string} [className] Extra classes merged after the defaults.
 */

/**
 * One figure with its label: tickets sold, money taken, people admitted.
 *
 * The figure is set in the display face with tabular numerals, so a column
 * of them lines up and a changing one does not shimmer. A screen reader hears
 * the label and the final value once; the rolling digits a sighted reader sees
 * are hidden from it, so it never reads a number halfway through a roll.
 *
 * The label comes first and the figure under it, in reading order, so a
 * screen reader says "Tickets sold, 1,284".
 *
 * @param {StatProps} props Component props.
 * @returns {JSX.Element} The figure.
 */
export function Stat({
  label,
  value,
  format = (number) => number.toLocaleString('en-US'),
  hint,
  roll = false,
  as: Component = 'div',
  className,
  ...rest
}) {
  const shown = useRolledValue(value, roll)
  const words = (figure) =>
    typeof figure === 'number' ? format(Math.round(figure * 100) / 100) : figure
  const final = words(value)
  const rolling = shown !== value

  return (
    <Component data-slot="stat" className={cn('flex min-w-0 flex-col gap-1', className)} {...rest}>
      <span className="text-label font-medium text-ink-muted">{label}</span>
      <span className="font-display text-h2 font-bold break-words text-ink tabular-nums">
        {rolling ? (
          <>
            <span aria-hidden="true">
              {words(typeof shown === 'number' ? Math.round(shown) : shown)}
            </span>
            <span className="sr-only">{final}</span>
          </>
        ) : (
          final
        )}
      </span>
      {hint ? <span className="text-caption text-ink-subtle">{hint}</span> : null}
    </Component>
  )
}

export default Stat
