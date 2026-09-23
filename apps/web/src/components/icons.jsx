/**
 * The line icons the public pages use.
 *
 * Every one is decoration: `aria-hidden`, unfocusable, and drawn in
 * `currentColor`, so it takes the colour of the words beside it and never
 * carries meaning of its own. A word always travels with it — an icon that is
 * the only thing saying "on sale" or "verified" says nothing to a screen reader
 * and nothing to somebody who cannot tell the colours apart.
 *
 * Drawn here rather than taken from an icon package: a dozen strokes do not
 * justify a dependency, and a font or sprite from elsewhere would be a request
 * to somebody else's server.
 *
 * @module components/icons
 */

/**
 * The frame every icon shares: a 24-unit grid, round joins, a stroke that
 * follows the text colour.
 *
 * @param {object} props Component props.
 * @param {string} [props.className] Size and spacing. Defaults to 1.125rem square.
 * @param {number} [props.strokeWidth] Stroke weight on the 24-unit grid.
 * @param {ReactNode} props.children The strokes.
 * @returns {JSX.Element} The icon.
 */
function Icon({ className = 'h-4.5 w-4.5', strokeWidth = 2, children }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  )
}

/**
 * An arrow pointing onward.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function ArrowRightIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2.2}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  )
}

/**
 * An arrow pointing back.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function ArrowLeftIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2.2}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </Icon>
  )
}

/**
 * A map pin, beside a place.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function PinIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </Icon>
  )
}

/**
 * A calendar page, beside a date.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function CalendarIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icon>
  )
}

/**
 * A clock face, beside a time.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function ClockIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  )
}

/**
 * A head and shoulders, beside the sign-in link and an organiser's name.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function PersonIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </Icon>
  )
}

/**
 * A magnifying glass, inside a search field.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function SearchIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Icon>
  )
}

/**
 * A seal with a tick: beside the word "Verified", never instead of it.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function VerifiedIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 2.8 14.3 4.5l2.8-.1.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.1L12 21.2l-2.3-1.7-2.8.1-.9-2.7-2.3-1.6.9-2.7-.9-2.7 2.3-1.6.9-2.7 2.8.1Z" />
      <path d="m8.8 12.2 2.2 2.2 4.3-4.6" />
    </Icon>
  )
}

/**
 * A plain tick, in an accessibility list and a success notice.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function CheckIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2.6}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  )
}

/**
 * A ticket stub.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function TicketIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M3.5 8.5V6.8A1.8 1.8 0 0 1 5.3 5h13.4a1.8 1.8 0 0 1 1.8 1.8v1.7a2.5 2.5 0 0 0 0 5v1.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8v-1.7a2.5 2.5 0 0 0 0-5Z" />
      <path d="M14.5 5v14" strokeDasharray="1.5 2.5" />
    </Icon>
  )
}

/**
 * A letter i in a circle, beside a note that explains.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function InfoIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </Icon>
  )
}

/**
 * A shield, beside the sentence that says payments are simulated.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function ShieldIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 3 5 5.8v5.4c0 4.3 2.9 8 7 9.8 4.1-1.8 7-5.5 7-9.8V5.8Z" />
      <path d="M9 12h6" />
    </Icon>
  )
}

/**
 * A step-free route, for access information.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function AccessIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="4.5" r="1.8" />
      <path d="M6 8.5h12M12 8.5v5M12 13.5l-3.5 7M12 13.5l3.5 7" />
    </Icon>
  )
}

/**
 * A folded page with lines, beside a policy.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function PolicyIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M6.5 3.5h8l4 4v13h-12Z" />
      <path d="M14.5 3.5v4h4M9.5 12h5M9.5 15.5h5" />
    </Icon>
  )
}

/**
 * A circle of dancers round a lamp: the garba category.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function GarbaIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={1.8}>
      <circle cx="12" cy="12" r="8.5" strokeDasharray="2.2 2.4" />
      <path d="M12 8.5c1.4 1.3 1.4 2.7 0 4-1.4-1.3-1.4-2.7 0-4Z" />
      <path d="M9.5 15.5h5" />
    </Icon>
  )
}

/**
 * Two crossed dandiya sticks: workshops.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function SticksIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={1.8}>
      <path d="m5 19 14-14M5 5l14 14" />
      <circle cx="5" cy="19" r="1.2" />
      <circle cx="19" cy="19" r="1.2" />
    </Icon>
  )
}

/**
 * A hanging lantern: melas and festivals.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function LanternIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={1.8}>
      <path d="M12 2.5v3M9 5.5h6l2 4-2 8H9l-2-8Z" />
      <path d="M7 9.5h10M10 17.5v2.5h4v-2.5M12 20v1.5" />
    </Icon>
  )
}

/**
 * A dhol, the barrel drum: live music.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function DholIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={1.8}>
      <ellipse cx="5.5" cy="12" rx="2" ry="5" />
      <ellipse cx="18.5" cy="12" rx="2" ry="5" />
      <path d="M5.5 7h13M5.5 17h13M9 7.5l3 9 3-9" />
    </Icon>
  )
}

/**
 * A four-pointed spark, for anything without an icon of its own.
 *
 * @param {{className?: string}} props Component props.
 * @returns {JSX.Element} The icon.
 */
export function SparkIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={1.8}>
      <path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z" />
    </Icon>
  )
}

/** The icon for each category that has one; everything else is a spark. */
const CATEGORY_ICONS = Object.freeze({
  GARBA_DANDIYA: GarbaIcon,
  CLASSICAL_DANCE: GarbaIcon,
  WORKSHOP: SticksIcon,
  CULTURAL_FESTIVAL: LanternIcon,
  RELIGIOUS: LanternIcon,
  MUSIC_CONCERT: DholIcon,
  BOLLYWOOD_NIGHT: DholIcon,
})

/**
 * The icon for a category.
 *
 * @param {object} props Component props.
 * @param {string} props.category An `EventCategory` enum member.
 * @param {string} [props.className] Size and spacing.
 * @returns {JSX.Element} The icon.
 */
export function CategoryIcon({ category, className }) {
  const Drawn = CATEGORY_ICONS[category] ?? SparkIcon

  return <Drawn className={className} />
}
