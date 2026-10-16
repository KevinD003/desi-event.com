/**
 * Class strings for links that look like something other than a link.
 *
 * A navigation is a link even when it looks like a button — "Choose tickets"
 * goes to another page, it does not do anything on this one — so these are
 * applied to `<Link>`, never to a `<button>` pretending to navigate.
 *
 * They are no longer written here. Each is the component library's own
 * `buttonClasses()` or `textLinkClasses()` (`@desi-event/ui`, served to Server
 * Components at `@desi-event/ui/classes`), so a link-as-button on the home
 * page, one in a workspace and the `Button` beside them are the same height,
 * radius, colours, press and focus outline by construction. The names stay as
 * thin aliases so no caller has to change; new code can use `ButtonLink` and
 * `TextLink`, or `buttonClasses()` directly.
 *
 * @module components/link-classes
 */

import { buttonClasses, cn, textLinkClasses } from '@desi-event/ui/classes'

/** The one thing a screen most wants done, as a link: the primary action at the large size. */
export const PRIMARY_LINK = buttonClasses({ variant: 'primary', size: 'lg', element: 'link' })

/** A smaller primary link, for inside a card or an empty state. */
export const PRIMARY_LINK_SMALL = buttonClasses({ variant: 'primary', size: 'md', element: 'link' })

/** A secondary action on the page: outlined in the accent, white inside. */
export const SECONDARY_LINK = buttonClasses({ variant: 'accent', size: 'lg', element: 'link' })

/** A quieter outlined action: ink on white, for "back" and "clear". */
export const OUTLINE_LINK = buttonClasses({ variant: 'ink', size: 'md', element: 'link' })

/** An outlined action on the purple plate. */
export const INVERSE_OUTLINE_LINK = buttonClasses({
  variant: 'inverse',
  size: 'lg',
  element: 'link',
})

/** A link in running text, in the accent, underlined so it is not colour alone. */
export const TEXT_LINK = textLinkClasses({ tone: 'accent' })

/** A link on the purple plate, in gold. */
export const INVERSE_TEXT_LINK = textLinkClasses({ tone: 'inverse' })

/**
 * A pill that leads into a filtered listing — a city, a category. It takes the
 * accent on hover; it does not rise, because a chip that lifts under the
 * pointer is decoration, not an answer.
 */
export const CHIP_LINK = cn(
  'inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface-raised px-4 text-label font-semibold text-ink transition-colors duration-(--duration-base) ease-standard hover:border-accent-strong hover:text-accent-strong',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
)
