/**
 * The class lists behind the button and the links that look like one.
 *
 * Pure functions with no React in them, so a Server Component can draw a
 * link as a button without pulling the component library's client modules
 * into the server graph (the app imports them from `@desi-event/ui/classes`).
 *
 * @module @desi-event/ui/buttonClasses
 */

import { cn } from './cn.js'

/**
 * Tailwind classes per button variant, in semantic tokens only.
 *
 * `primary` is the register's primary action: the kit's magenta on public
 * pages, Royal Purple inside a signed-in area and gold at the door, each with
 * its own measured ink — `token-contrast.test.js` pins them resting and
 * hovered in every register.
 *
 * `secondary` is every other action a screen offers beside the primary one —
 * cancel, dismiss, clear, stop — so it is outlined rather than filled: a
 * second filled colour next to the primary made two buttons compete for one
 * decision. `outline` is the same thing under its older name, kept so no
 * caller changes meaning.
 *
 * Three more variants come from the link kits they replace: `accent`, an
 * outline in the accent for the secondary action on a public page; `ink`, a
 * firmer ink outline for "back" and "clear"; and `inverse`, an outline in
 * white for the purple plate.
 *
 * Every variant uses the one focus ring. It used to be a different colour per
 * variant, and three of the five were below 3:1 against white.
 */
const SECONDARY =
  'border border-action-secondary-line bg-action-secondary text-action-secondary-ink shadow-control hover:bg-action-secondary-hover'

export const BUTTON_VARIANTS = {
  primary: 'bg-action-primary text-action-primary-ink shadow-control hover:bg-action-primary-hover',
  secondary: SECONDARY,
  outline: SECONDARY,
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-subtle hover:text-ink',
  danger: 'bg-action-danger text-action-danger-ink shadow-control hover:bg-action-danger-hover',
  accent: 'border-2 border-accent-strong bg-surface-raised text-accent-strong hover:bg-accent-soft',
  ink: 'border-2 border-ink bg-surface-raised text-ink hover:bg-surface-subtle',
  inverse:
    'border-2 border-ink-inverse/40 text-ink-inverse hover:border-ink-inverse hover:bg-ink-inverse/10',
}

/**
 * Tailwind classes per button size.
 *
 * Heights are minimums, so a label that wraps grows the button instead of
 * spilling out of it. `md` and `lg` are at least 44px everywhere, the touch
 * target the site holds itself to. `sm` is for dense tables on a desk, so it
 * is 36px under a mouse and grows to 44px wherever the pointer is a finger.
 */
export const BUTTON_SIZES = {
  sm: 'min-h-9 gap-1.5 px-3.5 text-sm pointer-coarse:min-h-11',
  md: 'min-h-11 gap-2 px-5 text-sm',
  lg: 'min-h-12 gap-2 px-7 text-base',
}

/** The shape every button and button-like link shares. */
const BASE = 'inline-flex items-center justify-center rounded-control font-semibold'

/**
 * The feel of a press: colour and shadow ease over the theme's fast duration,
 * and an enabled button settles to 98% while held. `motion-safe:` keeps the
 * press out of reduced motion entirely, and the theme's reduced-motion rule
 * stops the colour transition too.
 */
const BUTTON_MOTION =
  'transition duration-(--duration-fast) ease-standard motion-safe:enabled:active:scale-[0.98]'

/** The same press for a link, which has no `:enabled` state to gate on. */
const LINK_MOTION =
  'transition duration-(--duration-fast) ease-standard motion-safe:active:scale-[0.98]'

/**
 * An outline rather than a box-shadow ring: it survives forced-colours mode,
 * and its offset shows whatever the button sits on — white, a card or the
 * purple plate — rather than painting a white gap.
 */
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/**
 * @typedef {object} ButtonLook
 * @property {'primary'|'secondary'|'outline'|'ghost'|'danger'|'accent'|'ink'|'inverse'} [variant] Visual variant. Defaults to `primary`.
 * @property {'sm'|'md'|'lg'} [size] Size token. Defaults to `md`.
 * @property {boolean} [fullWidth] Stretches to the width of the container.
 * @property {'button'|'link'} [element] What the classes are for: a `<button>` (the default) or a link drawn as one.
 * @property {string} [className] Extra classes, merged last so they win.
 */

/**
 * The class list of a button, for something that has to look like one
 * without being a {@link Button} — a link drawn as a button, a label, a
 * summary.
 *
 * The link kits (`PRIMARY_LINK` and friends) are built from this, so a link
 * to the checkout and the button beside it are the same height, radius and
 * colours by construction rather than by copying.
 *
 * @param {ButtonLook} [look] The look.
 * @returns {string} The classes.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  element = 'button',
  className,
} = {}) {
  return cn(
    BASE,
    element === 'link' ? LINK_MOTION : BUTTON_MOTION,
    FOCUS,
    element === 'link'
      ? 'aria-disabled:pointer-events-none aria-disabled:opacity-60'
      : 'disabled:cursor-not-allowed disabled:opacity-60',
    BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.primary,
    BUTTON_SIZES[size] ?? BUTTON_SIZES.md,
    fullWidth && 'w-full',
    className,
  )
}

/**
 * Tailwind classes per text-link tone.
 *
 * A link in running text is underlined, so it is never told by colour alone.
 * `accent` is the public site's link, in the accent's text colour; `ink` the
 * signed-in areas' quieter one, ink with an accent underline that takes the
 * accent on hover; `inverse` the gold link on the purple plate. None changes
 * weight on hover, which would reflow the line.
 */
const TEXT_LINK_TONES = {
  accent:
    'font-semibold text-accent-strong underline decoration-1 underline-offset-4 hover:decoration-2',
  ink: 'font-medium text-ink underline decoration-accent-line decoration-2 underline-offset-4 hover:text-accent-strong hover:decoration-accent',
  inverse:
    'font-semibold text-accent-inverse underline decoration-1 underline-offset-4 hover:decoration-2',
}

/**
 * The class list of a link in running text.
 *
 * @param {{tone?: 'accent'|'ink'|'inverse', className?: string}} [look] The tone (default `accent`) and extra classes.
 * @returns {string} The classes.
 */
export function textLinkClasses({ tone = 'accent', className } = {}) {
  return cn(
    'rounded-sm transition-colors duration-(--duration-fast) ease-standard',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    TEXT_LINK_TONES[tone] ?? TEXT_LINK_TONES.accent,
    className,
  )
}
