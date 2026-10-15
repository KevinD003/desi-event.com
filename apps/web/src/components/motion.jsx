'use client'

/**
 * Motion primitives.
 *
 * Every animation on the site goes through one of these components, for one
 * reason: `useReducedMotion` is consulted in exactly one place and cannot be
 * forgotten. When the visitor's platform asks for reduced motion, these render
 * the plain element in its final state — no transform, no fade, no transition
 * — rather than a faster version of the same movement. Vestibular disorders
 * are not helped by a shorter slide.
 *
 * Every element rendered here carries a `data-motion` attribute, and that is
 * load-bearing rather than decorative. The server cannot know the visitor's
 * motion preference, so it renders the animated branch and inlines
 * `opacity: 0`. A visitor who prefers reduced motion then hydrates into the
 * plain branch, which sets no style at all — and React does not strip the
 * inline style the server already wrote. The content stays invisible forever.
 *
 * `data-motion` gives the theme something to target, so the final state is
 * forced in CSS under `prefers-reduced-motion: reduce` and when scripting is
 * off. CSS is the only layer here that cannot disagree with the server.
 *
 * ## The choreography
 *
 * Richness comes from order, not length. Nothing moves for longer than the
 * theme's slowest duration (250 ms) or travels further than 12px: things rise
 * and fade in ({@link FadeIn} on arrival, {@link Reveal} on scrolling into
 * view), groups arrive 50 ms apart ({@link Stagger}), and a card lifts 4px while
 * its poster zooms to 1.04 inside its frame ({@link HoverLift},
 * {@link HoverZoom}). The one ambient effect, the hero's twinkling bulbs, is
 * CSS (`motion-safe:animate-twinkle`) and stops by itself after three cycles.
 *
 * @module components/motion
 */

import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * The theme's easing, `--ease-standard`, as framer-motion takes it: a quick
 * start that settles, so an entrance reads as arriving rather than drifting.
 * A test holds it equal to the token.
 */
export const EASE = Object.freeze([0.2, 0, 0, 1])

/**
 * Seconds between neighbours in a staggered group: inside the 40-60 ms that
 * reads as a sequence rather than as lag.
 */
export const STAGGER_STEP = 0.05

/**
 * How far into a long list the stagger keeps counting. Card twelve of a grid
 * should not wait half a second to appear because eleven came before it.
 */
const STAGGER_CAP = 6

/** How far anything rises as it appears, in pixels. */
const RISE = 12

/**
 * Seen once, as soon as any of it is on screen.
 *
 * `'some'` is an IntersectionObserver threshold of 0, and it has to be. A
 * fractional threshold is a share of the element, so an element taller than
 * the viewport divided by that share can never reach it: at 0.15 a 5,000px
 * organiser directory on a 700px phone tops out at 14% and would stay at
 * opacity 0 for good. A threshold of 0 is met by any element, however tall.
 */
export const VIEWPORT = Object.freeze({ once: true, amount: 'some' })

/**
 * The theme's three durations, in seconds, as framer-motion takes them.
 *
 * The same values as `--duration-fast`, `--duration-base` and
 * `--duration-slow` in the theme, and a test holds them equal. Nothing here
 * moves for longer than 250 ms: the entrances used to run for 450 and 500,
 * long enough to watch rather than to notice.
 */
export const DURATION = Object.freeze({ fast: 0.12, base: 0.18, slow: 0.25 })

/**
 * The delay for the item at a position in a group.
 *
 * @param {number} delay A delay the caller asked for, in seconds.
 * @param {number} index The item's position.
 * @returns {number} Seconds.
 */
function staggeredDelay(delay, index) {
  return delay + Math.min(Math.max(index, 0), STAGGER_CAP) * STAGGER_STEP
}

/**
 * @typedef {object} MotionProps
 * @property {string} [as] Intrinsic element to render, e.g. `section` or `li`. Defaults to `div`.
 * @property {number} [delay] Extra delay in seconds before the entrance starts.
 * @property {number} [index] Position in a staggered group; adds a small per-item delay.
 * @property {number} [distance] Pixels the element travels upward as it appears. Defaults to 12.
 * @property {string} [className] Classes applied to the rendered element.
 * @property {ReactNode} [children] Content.
 */

/**
 * Fade and lift content in as soon as it mounts.
 *
 * Use for anything already on screen when the page loads, such as the hero.
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The animated element, or a plain one under reduced motion.
 */
export function FadeIn({
  as = 'div',
  delay = 0,
  index = 0,
  distance = RISE,
  className,
  children,
  ...rest
}) {
  const prefersReducedMotion = useReducedMotion()
  const Component = motion[as] ?? motion.div

  if (prefersReducedMotion) {
    return (
      <Component className={className} data-motion="" {...rest}>
        {children}
      </Component>
    )
  }

  return (
    <Component
      className={className}
      data-motion=""
      initial={{ opacity: 0, y: distance }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE, delay: staggeredDelay(delay, index) }}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * Fade and rise content in the first time it scrolls into view.
 *
 * Use for sections and cards below the fold. The animation runs once:
 * re-animating on every scroll past turns a page into a slideshow.
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The animated element, or a plain one under reduced motion.
 */
export function Reveal({
  as = 'div',
  delay = 0,
  index = 0,
  distance = RISE,
  className,
  children,
  ...rest
}) {
  const prefersReducedMotion = useReducedMotion()
  const Component = motion[as] ?? motion.div

  if (prefersReducedMotion) {
    return (
      <Component className={className} data-motion="" {...rest}>
        {children}
      </Component>
    )
  }

  return (
    <Component
      className={className}
      data-motion=""
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: DURATION.slow, ease: EASE, delay: staggeredDelay(delay, index) }}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * {@link Reveal} under the name the pages first used for it, kept so that no
 * caller has to change to get the new timing.
 */
export const RevealOnScroll = Reveal

/** The two states a staggered group moves between. */
const STAGGER_ITEM = Object.freeze({
  hidden: { opacity: 0, y: RISE },
  shown: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE } },
})

/**
 * @typedef {object} StaggerProps
 * @property {string} [as] Intrinsic element to render. Defaults to `div`.
 * @property {'view'|'mount'} [trigger] Start when the group scrolls into view (the default), or as soon as it mounts — for the hero.
 * @property {number} [delay] Seconds before the first child starts.
 * @property {string} [className] Classes applied to the rendered element.
 * @property {ReactNode} [children] {@link StaggerItem}s, directly or deeper down.
 */

/**
 * A group whose {@link StaggerItem}s arrive one after another, 50 ms apart.
 *
 * The group itself does not move; it only sets the order. Use it for a row of
 * featured cards, a strip of chips, or the words of the hero's headline (each
 * word an inline-block `StaggerItem as="span"`).
 *
 * @param {StaggerProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The group, or a plain element under reduced motion.
 */
export function Stagger({ as = 'div', trigger = 'view', delay = 0, className, children, ...rest }) {
  const prefersReducedMotion = useReducedMotion()
  const Component = motion[as] ?? motion.div

  if (prefersReducedMotion) {
    return (
      <Component className={className} data-motion="" {...rest}>
        {children}
      </Component>
    )
  }

  const start =
    trigger === 'mount' ? { animate: 'shown' } : { whileInView: 'shown', viewport: VIEWPORT }

  return (
    <Component
      className={className}
      data-motion=""
      initial="hidden"
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: STAGGER_STEP, delayChildren: delay } },
      }}
      {...start}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * One member of a {@link Stagger} group: it fades and rises 12px in its turn.
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element. `delay`, `index` and `distance` are the group's to set, not the item's.
 * @returns {JSX.Element} The animated element, or a plain one under reduced motion.
 */
export function StaggerItem({ as = 'div', className, children, ...rest }) {
  const prefersReducedMotion = useReducedMotion()
  const Component = motion[as] ?? motion.div

  if (prefersReducedMotion) {
    return (
      <Component className={className} data-motion="" {...rest}>
        {children}
      </Component>
    )
  }

  return (
    <Component className={className} data-motion="" variants={STAGGER_ITEM} {...rest}>
      {children}
    </Component>
  )
}

/** A lifted card rises 4px; its poster zooms inside its frame. */
const LIFT = Object.freeze({ rest: { y: 0 }, lift: { y: -4 } })
const ZOOM = Object.freeze({ rest: { scale: 1 }, lift: { scale: 1.04 } })

/**
 * Lift an element 4px while it is hovered, or while something inside it has
 * keyboard focus, and zoom any {@link HoverZoom} inside it.
 *
 * Focus lifts it too so that a keyboard reader gets the same affordance as a
 * pointer: tabbing onto a card's link raises the card. While lifted the
 * element carries `data-lifted`, so with `className="group"` here a card
 * inside can deepen its shadow with `group-data-lifted:shadow-card-hover`,
 * for focus as well as hover.
 *
 * Under reduced motion nothing moves and `data-lifted` is never set; the
 * card's own `hover:` shadow still answers the pointer.
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The animated element, or a plain one under reduced motion.
 */
export function HoverLift({ as = 'div', className, children, onFocus, onBlur, ...rest }) {
  const prefersReducedMotion = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const Component = motion[as] ?? motion.div

  if (prefersReducedMotion) {
    return (
      <Component className={className} data-motion="" onFocus={onFocus} onBlur={onBlur} {...rest}>
        {children}
      </Component>
    )
  }

  const lifted = hovered || focused

  return (
    <Component
      className={className}
      data-motion=""
      data-lifted={lifted ? '' : undefined}
      initial={false}
      animate={lifted ? 'lift' : 'rest'}
      variants={LIFT}
      // A timed curve rather than a spring: a spring's length depends on its
      // physics and overshoots, and neither is a duration anybody chose.
      transition={{ duration: DURATION.base, ease: EASE }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        // Moving focus between two controls inside the card is not leaving it.
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        onBlur?.(event)
      }}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * A frame whose content zooms to 1.04 while the {@link HoverLift} around it is
 * lifted — the poster on a card.
 *
 * The frame clips, so the picture grows inside its own edges rather than over
 * the text below it. The zoom is slower than the lift (250 ms against 180) so
 * the picture settles just after the card does.
 *
 * @param {MotionProps} props Component props. `as` and `className` apply to the frame.
 * @returns {JSX.Element} The frame and its zooming content.
 */
export function HoverZoom({ as: Frame = 'div', className, children, ...rest }) {
  const prefersReducedMotion = useReducedMotion()
  const frameClass = ['overflow-hidden', className].filter(Boolean).join(' ')

  return (
    <Frame className={frameClass} {...rest}>
      {prefersReducedMotion ? (
        <motion.div className="h-full w-full" data-motion="">
          {children}
        </motion.div>
      ) : (
        <motion.div
          className="h-full w-full"
          data-motion=""
          variants={ZOOM}
          transition={{ duration: DURATION.slow, ease: EASE }}
        >
          {children}
        </motion.div>
      )}
    </Frame>
  )
}

/**
 * Whether the page has been scrolled past a point — for the header, which
 * gains a shadow once content slides beneath it.
 *
 * The shadow is a change of state rather than movement, so it is not held
 * back under reduced motion. The listener is passive and the value only
 * changes when the answer does, so scrolling does not re-render the header on
 * every frame.
 *
 * @param {number} [offset] Pixels of scroll that count as "scrolled". Defaults to 8.
 * @returns {boolean} True once the page is scrolled further than `offset`.
 */
export function useScrolledPast(offset = 8) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    /** Read the scroll position and store whether it is past the offset. */
    const update = () => setScrolled(window.scrollY > offset)

    update()
    window.addEventListener('scroll', update, { passive: true })

    return () => window.removeEventListener('scroll', update)
  }, [offset])

  return scrolled
}
