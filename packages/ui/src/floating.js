/**
 * The classes every floating surface shares — popover, menu, tooltip.
 *
 * A floating thing is the one place depth is allowed: it casts the theme's
 * `floating` shadow. It enters from 95% and transparent to full size over
 * the base duration on the ease-out curve, and leaves the same way; the scale
 * grows from the trigger (`--transform-origin`, which Base UI sets from the
 * side it opened on), never from the centre and never from zero. Reduced
 * motion makes the change instant through the theme's global rule.
 *
 * @module @desi-event/ui/floating
 */

/** The motion of a floating surface: origin-aware scale and fade, in and out. */
export const FLOATING_MOTION =
  'origin-(--transform-origin) transition-[opacity,scale] duration-(--duration-base) ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0'

/** A panel that floats: a popover's body, a menu's list. */
export const FLOATING_PANEL = `rounded-card border border-line bg-surface-raised text-ink shadow-floating outline-none ${FLOATING_MOTION}`
