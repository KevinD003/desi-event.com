/**
 * The line icons the pages use, by the names they have always had.
 *
 * Every one is now drawn by the component library's single family
 * (`@desi-event/ui/icons`): a 24-unit grid, 1.75 strokes, round caps and
 * joins, in `currentColor`. These are thin wrappers so no page had to change
 * its imports; new code can use `<Icon name="…" />` directly.
 *
 * Every one is decoration: `aria-hidden`, unfocusable, taking the colour of
 * the words beside it and never carrying meaning of its own. A word always
 * travels with it — an icon that is the only thing saying "on sale" or
 * "verified" says nothing to a screen reader and nothing to somebody who
 * cannot tell the colours apart.
 *
 * @module components/icons
 */

import { Icon } from '@desi-event/ui/icons'

/** The size every icon here had before the family moved: 1.125rem square. */
const DEFAULT_SIZE = 'h-4.5 w-4.5'

/**
 * One wrapper per old name.
 *
 * @param {string} name The family's glyph.
 * @returns {function({className?: string}): JSX.Element} The component.
 */
function named(name) {
  /**
   * The icon.
   *
   * @param {{className?: string}} props Component props.
   * @returns {JSX.Element} The icon.
   */
  function Named({ className = DEFAULT_SIZE }) {
    return <Icon name={name} className={className} />
  }

  Named.displayName = `Icon(${name})`

  return Named
}

export const ArrowRightIcon = named('arrow-right')
export const ArrowLeftIcon = named('arrow-left')
export const PinIcon = named('pin')
export const CalendarIcon = named('calendar')
export const ClockIcon = named('clock')
export const PersonIcon = named('person')
export const SearchIcon = named('search')
export const VerifiedIcon = named('verified')
export const CheckIcon = named('check')
export const TicketIcon = named('ticket')
export const InfoIcon = named('info')
export const ShieldIcon = named('shield')
export const AccessIcon = named('access')
export const PolicyIcon = named('policy')
export const SparkIcon = named('spark')
export const WheelchairIcon = named('wheelchair')
export const EyeOffIcon = named('eye-off')
export const CrossIcon = named('close')

/** The old garba-only category glyphs, kept by name for any caller. */
export const GarbaIcon = named('dandiya')
export const SticksIcon = named('dandiya')
export const LanternIcon = named('lantern')
export const DholIcon = named('mic')

/**
 * A glyph for every category the API has (`EVENT_CATEGORIES` in
 * `@desi-event/schemas`; `icons.test.jsx` holds the two equal), each its own:
 * comedy is not a garba circle, and a cricket match is not a lantern.
 */
export const CATEGORY_GLYPHS = Object.freeze({
  MUSIC_CONCERT: 'mic',
  GARBA_DANDIYA: 'dandiya',
  BOLLYWOOD_NIGHT: 'bollywood',
  CLASSICAL_DANCE: 'ghungroo',
  COMEDY: 'comedy',
  FILM_SCREENING: 'film',
  CULTURAL_FESTIVAL: 'lantern',
  FOOD_FESTIVAL: 'thali',
  WEDDING_EXPO: 'rings',
  RELIGIOUS: 'diya',
  THEATRE: 'theatre',
  WORKSHOP: 'workshop',
  NETWORKING: 'network',
  SPORTS: 'cricket',
})

/**
 * The glyph for an event's category, or a spark for one the site does not
 * know yet.
 *
 * @param {{category: string, className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function CategoryIcon({ category, className = DEFAULT_SIZE }) {
  return <Icon name={CATEGORY_GLYPHS[category] ?? 'spark'} className={className} />
}
