'use client'

/**
 * Motion primitives.
 *
 * Every animation on the site goes through one of these components, so the
 * visitor's motion preference is honoured in one place and cannot be
 * forgotten. When the platform asks for reduced motion, the plain element is
 * shown in its final state — no transform, no fade, no transition — rather
 * than a faster version of the same movement. Vestibular disorders are not
 * helped by a shorter slide.
 *
 * ## CSS first
 *
 * Entrances are drawn by the stylesheet, not by JavaScript. {@link FadeIn}
 * and a {@link Stagger} that starts on mount render a plain element marked
 * `data-motion="enter"`, and the theme gives that mark a 250 ms rise inside
 * `@media (prefers-reduced-motion: no-preference)`. Nothing is inlined at
 * `opacity: 0` by the server, so the hero's heading — the page's largest
 * text, and its LCP element — paints with the first frame instead of waiting
 * for hydration, and a reader who prefers reduced motion or has scripting off
 * never sees it hidden at all. The same markup is rendered whatever the
 * preference, so the server and the client always agree.
 *
 * {@link Reveal} (and a {@link Stagger} that starts in view) is visible as
 * the server sent it too. Only after hydration, and only for an element that
 * is then below the fold, does it mark itself `data-reveal="pending"` — the
 * theme's cue to hold it 12px low and transparent — and an
 * IntersectionObserver marks it `shown` the first time any of it is on
 * screen. Content that was already on screen, content above the fold, and
 * every element under reduced motion, without IntersectionObserver or without
 * JavaScript is never hidden, so no reveal can leave a blank band below the
 * hero, in a capture or in print.
 *
 * Every element rendered here carries a `data-motion` attribute, and that is
 * load-bearing rather than decorative: the theme forces it to its final state
 * under `prefers-reduced-motion: reduce`, with scripting off and in print.
 *
 * ## Framer Motion, for what CSS cannot do
 *
 * Gestures and springs — the poster's hover zoom today; a dragged sheet or a
 * rolling number tomorrow — use Framer Motion, through `m` components under
 * {@link MotionProvider}'s `LazyMotion`, so a page loads only the DOM
 * animation features (`domAnimation`) rather than the whole library, and
 * `strict` refuses any stray full `motion` component that would pull the rest
 * back in. `MotionConfig reducedMotion="user"` makes every one of them honour
 * the platform preference too.
 *
 * ## The choreography
 *
 * Richness comes from order, not length. Nothing here moves for longer than
 * the theme's slowest duration (250 ms) or travels further than 12px, and
 * nothing lifts: a card does not rise on hover, its poster zooms to 1.04
 * inside its own frame ({@link HoverLift}, {@link HoverZoom}). There is no
 * ambient animation: the festival bulbs that used to twinkle on every hero
 * went with the rest of the ornament (`festive-decor.jsx`).
 *
 * @module components/motion
 */

import { useEffect, useRef, useState } from 'react'
import { LazyMotion, MotionConfig, domAnimation, m, useReducedMotion } from 'framer-motion'

/**
 * The theme's easing, `--ease-standard`, as framer-motion takes it: a quick
 * start that settles, so an entrance reads as arriving rather than drifting.
 * A test holds it equal to the token.
 */
export const EASE = Object.freeze([0.2, 0, 0, 1])

/**
 * The theme's other curves, `--ease-out`, `--ease-in-out` and
 * `--ease-drawer`, for a spring-less gesture or a sheet: out for anything
 * entering or leaving, in-out for something moving on screen, and the drawer
 * curve for a sheet that slides in from an edge. Tests hold each equal to its
 * token.
 */
export const EASES = Object.freeze({
  out: Object.freeze([0.23, 1, 0.32, 1]),
  inOut: Object.freeze([0.77, 0, 0.175, 1]),
  drawer: Object.freeze([0.32, 0.72, 0, 1]),
})

/**
 * Seconds between neighbours in a staggered group: inside the 40-60 ms that
 * reads as a sequence rather than as lag.
 */
export const STAGGER_STEP = 0.05

/**
 * Seen once, as soon as any of it is on screen.
 *
 * `'some'` is an IntersectionObserver threshold of 0, and it has to be. A
 * fractional threshold is a share of the element, so an element taller than
 * the viewport divided by that share can never reach it: at 0.15 a 5,000px
 * organiser directory on a 700px phone tops out at 14% and would stay hidden
 * for good. A threshold of 0 is met by any element, however tall.
 */
export const VIEWPORT = Object.freeze({ once: true, amount: 'some' })

/**
 * The theme's three durations, in seconds, as framer-motion takes them.
 *
 * The same values as `--duration-fast`, `--duration-base` and
 * `--duration-slow` in the theme, and a test holds them equal. Nothing
 * interface-sized moves for longer than 250 ms: the entrances used to run
 * for 450 and 500, long enough to watch rather than to notice.
 */
export const DURATION = Object.freeze({ fast: 0.12, base: 0.18, slow: 0.25 })

/**
 * The two longer durations, for things larger than a control: a sheet
 * sliding in from an edge (`--duration-sheet`, 400 ms) and a page's view
 * transition (`--duration-page`, 300 ms). Named apart from {@link DURATION}
 * on purpose, so the 250 ms ceiling on interface feedback stays a ceiling.
 */
export const DURATION_EXPRESSIVE = Object.freeze({ sheet: 0.4, page: 0.3 })

/**
 * How many steps of delay the stylesheet knows, 40 ms each: up to 480 ms,
 * which is as long as anything on a first screen should wait.
 */
const DELAY_STEPS = 12

/** One delay step, in seconds. */
const DELAY_STEP = 0.04

/**
 * The theme's delay step for a delay in seconds: `data-motion-delay="3"` is
 * 120 ms. Stepped rather than inlined, so the element carries no `style`
 * attribute and renders the same markup on the server and the client.
 *
 * @param {number} seconds The delay the caller asked for.
 * @returns {string|undefined} The step, or undefined for none.
 */
function delayStep(seconds) {
  const step = Math.min(Math.max(Math.round(seconds / DELAY_STEP), 0), DELAY_STEPS)

  return step > 0 ? String(step) : undefined
}

/**
 * @typedef {object} MotionProps
 * @property {string} [as] Intrinsic element to render, e.g. `section` or `li`. Defaults to `div`.
 * @property {number} [delay] Extra delay in seconds before the entrance starts, in 40 ms steps up to 480 ms.
 * @property {number} [index] Position in a staggered group; adds a 50 ms step per item, up to the sixth.
 * @property {number} [distance] Accepted for older callers. The rise is the theme's 12px, or none with `0`.
 * @property {string} [className] Classes applied to the rendered element.
 * @property {ReactNode} [children] Content.
 */

/**
 * The delay for the item at a position in a group, in seconds.
 *
 * @param {number} delay A delay the caller asked for, in seconds.
 * @param {number} index The item's position.
 * @returns {number} Seconds.
 */
function staggeredDelay(delay, index) {
  return delay + Math.min(Math.max(index, 0), 6) * STAGGER_STEP
}

/**
 * Loads Framer Motion's DOM animation features once, lazily and strictly, and
 * makes every motion component under it honour the platform's reduced-motion
 * preference. The root layout wraps the page in it.
 *
 * @param {{children: ReactNode}} props Component props.
 * @returns {JSX.Element} The provider.
 */
export function MotionProvider({ children }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}

/**
 * Mark a CSS entrance finished once it has had time to run, so the theme can
 * drop the animation and leave the element at rest.
 *
 * An entrance inside something hidden (`display: none` — a decorative poster
 * shown only on wide screens) never runs, and the browser reports it at the
 * animation's first frame, transparent, for as long as it stays hidden. After
 * its delay and duration have passed, `data-motion-done` takes the animation
 * off, so the element is simply at rest whenever it is shown. Without
 * JavaScript the theme's `scripting: none` rule does the same.
 *
 * @param {object} ref The element's ref.
 * @param {string|undefined} step Its delay step (40 ms each).
 * @returns {void}
 */
function useEntranceSettles(ref, step) {
  useEffect(() => {
    const element = ref.current

    if (!element) return undefined

    const wait = Number(step ?? 0) * DELAY_STEP * 1000 + DURATION.slow * 1000 + 50
    const timer = setTimeout(() => {
      element.dataset.motionDone = ''
    }, wait)

    return () => clearTimeout(timer)
  }, [ref, step])
}

/**
 * Rise content in as soon as it is painted — from the first frame, by CSS.
 *
 * Use for anything already on screen when the page loads, such as the hero.
 * `distance={0}` fades without rising, for something whose position must not
 * shift (a picture that fills its frame).
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The element, marked for the theme's entrance.
 */
export function FadeIn({
  as: Component = 'div',
  delay = 0,
  index = 0,
  distance,
  className,
  children,
  ...rest
}) {
  const ref = useRef(null)
  const step = delayStep(staggeredDelay(delay, index))

  useEntranceSettles(ref, step)

  return (
    <Component
      ref={ref}
      className={className}
      data-motion="enter"
      data-motion-delay={step}
      data-motion-rise={distance === 0 ? 'none' : undefined}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * Hold an element back until it first scrolls into view, if — and only if —
 * it is below the fold once the page has hydrated and motion is welcome.
 *
 * @param {object} ref The element's ref.
 * @returns {void}
 */
function useRevealOnce(ref) {
  useEffect(() => {
    const element = ref.current

    if (!element || typeof window === 'undefined') return undefined
    if (typeof IntersectionObserver === 'undefined') return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    // Only what the reader has not seen yet: never something on screen or above it.
    if (element.getBoundingClientRect().top < window.innerHeight) return undefined

    element.dataset.reveal = 'pending'

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return

        element.dataset.reveal = 'shown'
        observer.disconnect()
      },
      { threshold: 0 },
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
      // A reveal torn down before it ran must not leave its element hidden.
      if (element.dataset.reveal === 'pending') element.dataset.reveal = 'shown'
    }
  }, [ref])
}

/**
 * Fade and rise content in the first time it scrolls into view.
 *
 * Use for sections and cards below the fold. The animation runs once:
 * re-animating on every scroll past turns a page into a slideshow. The
 * element is visible as the server rendered it, and is only held back after
 * hydration if it is still below the fold, so it can never be left hidden.
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The element, marked for the theme's reveal.
 */
export function Reveal({
  as: Component = 'div',
  delay = 0,
  index = 0,
  // Accepted so older callers keep working; the rise is the theme's.
  // eslint-disable-next-line no-unused-vars
  distance,
  className,
  children,
  ...rest
}) {
  const ref = useRef(null)

  useRevealOnce(ref)

  return (
    <Component
      ref={ref}
      className={className}
      data-motion="reveal"
      data-motion-delay={delayStep(staggeredDelay(delay, index))}
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

/**
 * @typedef {object} StaggerProps
 * @property {string} [as] Intrinsic element to render. Defaults to `div`.
 * @property {'view'|'mount'} [trigger] Start when the group scrolls into view (the default), or as soon as it is painted — for the hero.
 * @property {number} [delay] Seconds before the group starts.
 * @property {string} [className] Classes applied to the rendered element.
 * @property {ReactNode} [children] {@link StaggerItem}s, directly or deeper down.
 */

/**
 * A group that arrives as one: on mount like {@link FadeIn}, or in view like
 * {@link Reveal}.
 *
 * It used to release its items one by one, 50 ms apart — a hero headline
 * word by word. A dozen staggered entrances is a tell, not a choreography,
 * and a word-by-word heading cannot be painted before hydration; so the group
 * now moves as a unit and its items are plain. The name and props stay so no
 * caller changes.
 *
 * @param {StaggerProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The group.
 */
export function Stagger({ as = 'div', trigger = 'view', delay = 0, className, children, ...rest }) {
  const Group = trigger === 'mount' ? FadeIn : Reveal

  return (
    <Group as={as} delay={delay} className={className} {...rest}>
      {children}
    </Group>
  )
}

/**
 * One member of a {@link Stagger} group. It arrives with its group, so it
 * renders plainly, carrying `data-motion` so the theme's final-state rules
 * still reach it.
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element. `delay`, `index` and `distance` are the group's to set, not the item's.
 * @returns {JSX.Element} The element.
 */
export function StaggerItem({
  as: Component = 'div',
  // The group's to set; accepted and ignored so older callers keep working.
  // eslint-disable-next-line no-unused-vars
  delay,
  // eslint-disable-next-line no-unused-vars
  index,
  // eslint-disable-next-line no-unused-vars
  distance,
  className,
  children,
  ...rest
}) {
  return (
    <Component className={className} data-motion="" {...rest}>
      {children}
    </Component>
  )
}

/** The poster's zoom inside its frame while its card is engaged. */
const ZOOM = Object.freeze({ rest: { scale: 1 }, lift: { scale: 1.04 } })

/**
 * Mark an element engaged while it is hovered, or while something inside it
 * has keyboard focus, and zoom any {@link HoverZoom} inside it.
 *
 * It no longer lifts. A card that rises 4px on hover is the generated tell
 * the design refuses; the poster zooming inside its own frame is the one
 * response. The name stays so no caller changes.
 *
 * Focus engages it too so that a keyboard reader gets the same affordance as
 * a pointer. While engaged the element carries `data-lifted`, so with
 * `className="group"` here a card inside can answer with
 * `group-data-lifted:shadow-card-hover`, for focus as well as hover.
 *
 * Under reduced motion nothing zooms and `data-lifted` is never set; the
 * card's own `hover:` styles still answer the pointer.
 *
 * @param {MotionProps} props Component props, forwarded to the rendered element.
 * @returns {JSX.Element} The element.
 */
export function HoverLift({ as = 'div', className, children, onFocus, onBlur, ...rest }) {
  const prefersReducedMotion = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const Component = m[as] ?? m.div

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
 * engaged — the poster on a card.
 *
 * The frame clips, so the picture grows inside its own edges rather than over
 * the text below it, over the theme's slowest duration.
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
        <m.div className="h-full w-full" data-motion="">
          {children}
        </m.div>
      ) : (
        <m.div
          className="h-full w-full"
          data-motion=""
          variants={ZOOM}
          transition={{ duration: DURATION.slow, ease: EASES.out }}
        >
          {children}
        </m.div>
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
