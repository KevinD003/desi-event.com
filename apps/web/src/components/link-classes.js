/**
 * Class strings for links that look like something other than a link.
 *
 * A navigation is a link even when it looks like a button — "Choose tickets"
 * goes to another page, it does not do anything on this one — so these are
 * applied to `<Link>`, never to a `<button>` pretending to navigate. Written
 * once here so that a link-as-button on the home page and one on an event page
 * are the same height, the same radius and the same colours as the `Button`
 * primitive beside them.
 *
 * Every one keeps the browser's own focus outline (the theme draws it in the
 * focus token on every ground) and is at least 44px tall. The press and the
 * lift are `motion-safe:` only.
 *
 * @module components/link-classes
 */

/** Shared by every link drawn as a button. */
const BUTTON_LIKE =
  'inline-flex items-center justify-center gap-2 rounded-control font-bold transition duration-(--duration-fast) ease-standard motion-safe:active:scale-[0.98]'

/** The one thing a screen most wants done, as a link: rani pink, white text. */
export const PRIMARY_LINK = `${BUTTON_LIKE} min-h-12 bg-action-primary px-6 text-base text-action-primary-ink shadow-control hover:bg-action-primary-hover`

/** A smaller primary link, for inside a card or an empty state. */
export const PRIMARY_LINK_SMALL = `${BUTTON_LIKE} min-h-11 bg-action-primary px-4 text-sm text-action-primary-ink shadow-control hover:bg-action-primary-hover`

/** A secondary action on the page: outlined in the accent, white inside. */
export const SECONDARY_LINK = `${BUTTON_LIKE} min-h-12 border-[1.5px] border-accent-strong bg-surface-raised px-5 text-base text-accent-strong hover:bg-accent-soft`

/** A quieter outlined action: ink on white, for "back" and "clear". */
export const OUTLINE_LINK = `${BUTTON_LIKE} min-h-11 border-[1.5px] border-ink bg-surface-raised px-4 text-sm text-ink hover:bg-surface-subtle`

/** An outlined action on a night band. */
export const INVERSE_OUTLINE_LINK = `${BUTTON_LIKE} min-h-12 border-[1.5px] border-ink-inverse/40 px-5 text-base text-ink-inverse hover:border-ink-inverse hover:bg-ink-inverse/10`

/** A link in running text, in the accent, underlined so it is not colour alone. */
export const TEXT_LINK =
  'rounded-sm font-bold text-accent-strong underline decoration-1 underline-offset-4 transition-colors duration-(--duration-fast) hover:decoration-2'

/** A link on a night band, in marigold. */
export const INVERSE_TEXT_LINK =
  'rounded-sm font-bold text-accent-inverse underline decoration-1 underline-offset-4 hover:decoration-2'

/**
 * A pill that leads into a filtered listing — a city, a category. It rises 2px
 * and takes the accent on hover.
 */
export const CHIP_LINK =
  'inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface-raised px-4 text-[0.9375rem] font-semibold text-ink shadow-control transition duration-(--duration-base) ease-standard hover:border-accent-strong hover:text-accent-strong motion-safe:hover:-translate-y-0.5'
