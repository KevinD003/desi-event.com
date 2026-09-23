'use client'

/**
 * Motion primitives.
 *
 * Every animation on the site goes through one of these three components, for
 * one reason: `useReducedMotion` is consulted in exactly one place and cannot
 * be forgotten. When the visitor's platform asks for reduced motion, these
 * render the plain element in its final state — no transform, no fade, no
 * transition — rather than a faster version of the same movement. Vestibular
 * disorders are not helped by a shorter slide.
 *
 * Every element rendered here carries a `data-motion` attribute, and that is
 * load-bearing rather than decorative. The server cannot know the visitor's
 * motion preference, so it renders the animated branch and inlines
 * `opacity: 0`. A visitor who prefers reduced motion then hydrates into the
 * plain branch, which sets no style at all — and React does not strip the
 * inline style the server already wrote. The content stays invisible forever.
 *
 * `data-motion` gives `globals.css` something to target, so the final state is
 * forced in CSS under `prefers-reduced-motion: reduce` and inside `noscript`.
 * CSS is the only layer here that cannot disagree with the server.
 *
 * @module components/motion
 */

import { motion, useReducedMotion } from 'framer-motion'

/** Deceleration curve used for every entrance, so the site moves consistently. */
const EASE_OUT = [0.22, 1, 0.36, 1]

/** Seconds added per position in a staggered group. */
const STAGGER_STEP = 0.06

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
 * @typedef {object} MotionProps
 * @property {string} [as] Intrinsic element to render, e.g. `section` or `li`. Defaults to `div`.
 * @property {number} [delay] Extra delay in seconds before the entrance starts.
 * @property {number} [index] Position in a staggered group; adds a small per-item delay.
 * @property {number} [distance] Pixels the element travels upward as it appears.
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
  distance = 14,
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
      transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: delay + index * STAGGER_STEP }}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * Fade and lift content in the first time it scrolls into view.
 *
 * Use for sections below the fold. The animation runs once: re-animating on
 * every scroll past turns a page into a slideshow.
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The animated element, or a plain one under reduced motion.
 */
export function RevealOnScroll({
  as = 'div',
  delay = 0,
  index = 0,
  distance = 18,
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
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: delay + index * STAGGER_STEP }}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * Lift an element slightly while it is hovered or focused within.
 *
 * Under reduced motion the element still responds — the shadow and ring come
 * from Tailwind classes on the card itself — it simply does not move.
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The animated element, or a plain one under reduced motion.
 */
export function HoverLift({ as = 'div', className, children, ...rest }) {
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
      whileHover={{ y: -4 }}
      // A timed curve rather than a spring: a spring's length depends on its
      // physics and overshoots, and neither is a duration anybody chose.
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      {...rest}
    >
      {children}
    </Component>
  )
}
