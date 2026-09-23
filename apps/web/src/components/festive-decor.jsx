/**
 * The festival's ornaments: the brand mark, the toran across a night band, the
 * rings of a garba circle, the scalloped hem where a band meets the page, and
 * the mirror-work divider between sections.
 *
 * All of it is decoration. Every piece is `aria-hidden`, holds no text and no
 * control, and is drawn in the theme's tokens through `fill-*` and `stroke-*`
 * classes — never a literal colour — so it follows the register and the
 * semantic-classes test can hold it to the palette like anything else.
 *
 * They render on the server and need no JavaScript. The one moving part, the
 * toran's bulbs, is a CSS animation (`motion-safe:animate-twinkle`) that runs
 * three times and stops, well inside the five seconds WCAG 2.2.2 allows, and
 * never runs for somebody who has asked for reduced motion.
 *
 * Repeating shapes are written out rather than drawn with an SVG `<pattern>`:
 * a pattern needs an id, two ornaments on one page would then need two ids,
 * and a server component has no clean way to mint them. The shapes are few
 * enough that spelling them out costs nothing.
 *
 * @module components/festive-decor
 */

/**
 * The Desi-Event mark: a rani-pink diamond, a marigold one inside it, and an
 * ivory mirror at the centre.
 *
 * @param {object} props Component props.
 * @param {boolean} [props.inverse] Drawn for a night band, where the centre takes the night's colour.
 * @param {string} [props.className] Size. Defaults to 2.25rem.
 * @returns {JSX.Element} The mark.
 */
export function BrandMark({ inverse = false, className = 'h-9 w-9' }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 36 36"
      className={`shrink-0 ${className}`}
    >
      <rect
        x="6"
        y="6"
        width="24"
        height="24"
        rx="4"
        transform="rotate(45 18 18)"
        className={inverse ? 'fill-accent' : 'fill-action-primary'}
      />
      <rect
        x="11"
        y="11"
        width="14"
        height="14"
        rx="2"
        transform="rotate(45 18 18)"
        className="fill-highlight"
      />
      <circle cx="18" cy="18" r="3.5" className={inverse ? 'fill-surface-inverse' : 'fill-page'} />
    </svg>
  )
}

/**
 * The wordmark: the mark, "Desi-Event" in the display face, and the name in
 * Devanagari beneath it. The Devanagari line is hidden from assistive
 * technology, so a link wrapped round the wordmark is named by the brand, said
 * once.
 *
 * @param {object} props Component props.
 * @param {boolean} [props.inverse] Drawn for the night band.
 * @returns {JSX.Element} The wordmark's content.
 */
export function Wordmark({ inverse = false }) {
  return (
    <>
      <BrandMark inverse={inverse} className="h-8 w-8 sm:h-9 sm:w-9" />
      <span className="flex flex-col">
        <span
          className={`font-display text-xl leading-6 font-bold tracking-tight sm:text-2xl sm:leading-6.5 ${
            inverse ? 'text-ink-inverse' : 'text-ink'
          }`}
        >
          Desi-Event
        </span>
        <span
          aria-hidden="true"
          className={`font-sans text-micro ${inverse ? 'text-ink-inverse-muted' : 'text-ink-subtle'}`}
        >
          देसी इवेंट
        </span>
      </span>
    </>
  )
}

/** How wide one swag of the toran is, in the drawing's units. */
const SWAG = 120

/** Enough swags to span the widest screen the layout allows, and then some. */
const SWAGS = 16

/** The five flags on each swag, left to right, as fill classes. */
const FLAG_FILLS = Object.freeze([
  'fill-accent',
  'fill-highlight',
  'fill-accent-secondary',
  'fill-action-primary',
  'fill-accent-inverse',
])

/** Each flag's triangle, relative to the start of its swag. */
const FLAGS = Object.freeze([
  'M11 12.7 L29 18.3 L20 40 Z',
  'M31 18.7 L49 21.5 L40 44 Z',
  'M51 21.7 L69 21.7 L60 46 Z',
  'M71 21.5 L89 18.7 L80 44 Z',
  'M91 18.3 L109 12.7 L100 40 Z',
])

/** The mirror stitched on each flag, relative to the start of its swag. */
const MIRRORS = Object.freeze([
  [20, 22],
  [40, 27],
  [60, 29],
  [80, 27],
  [100, 22],
])

/**
 * Staggered start times for the bulbs, in milliseconds, so they do not blink
 * in unison — a row of lights that pulses together reads as a warning sign.
 */
const BULB_DELAYS = Object.freeze([0, 400, 150, 550, 250, 650, 100, 500, 200, 600, 300, 450])

/**
 * Toran bunting with a string of lights, strung across the top of a night band.
 *
 * Drawn 1,920 units wide and cropped from the middle, so it keeps its size on
 * a phone rather than shrinking to threads.
 *
 * @param {object} props Component props.
 * @param {string} [props.className] Positioning. Defaults to the top edge of a `relative` parent.
 * @returns {JSX.Element} The bunting.
 */
export function Toran({ className = 'pointer-events-none absolute inset-x-0 top-0' }) {
  const width = SWAG * SWAGS
  const swags = Array.from({ length: SWAGS }, (_, index) => index * SWAG)
  const bulbs = Array.from({ length: SWAGS + 1 }, (_, index) => index * SWAG)

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${width} 56`}
      preserveAspectRatio="xMidYMin slice"
      className={`block h-14 w-full ${className}`}
    >
      {swags.map((x) => (
        <g key={x} transform={`translate(${x} 0)`}>
          <path
            d={`M0 8 Q${SWAG / 2} 36 ${SWAG} 8`}
            fill="none"
            strokeWidth="1.5"
            className="stroke-accent-inverse opacity-75"
          />
          {FLAGS.map((flag, index) => (
            <path key={flag} d={flag} className={FLAG_FILLS[index]} />
          ))}
          {MIRRORS.map(([cx, cy]) => (
            <circle key={cx} cx={cx} cy={cy} r="2.2" className="fill-page opacity-90" />
          ))}
        </g>
      ))}
      {bulbs.map((x) => (
        <circle key={`halo-${x}`} cx={x} cy="8" r="8" className="fill-accent-inverse opacity-20" />
      ))}
      {bulbs.map((x, index) => (
        <circle
          key={`bulb-${x}`}
          cx={x}
          cy="8"
          r="3.5"
          className="fill-accent-inverse motion-safe:animate-twinkle"
          style={{ animationDelay: `${BULB_DELAYS[index % BULB_DELAYS.length]}ms` }}
        />
      ))}
    </svg>
  )
}

/**
 * Concentric rings, the shape a garba circle makes from above, with a few
 * sparks round them. Placed behind a hero's poster.
 *
 * @param {object} props Component props.
 * @param {string} [props.className] Size and position.
 * @returns {JSX.Element} The rings.
 */
export function GarbaRings({ className = '' }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 800 800"
      className={`pointer-events-none ${className}`}
    >
      <circle
        cx="400"
        cy="400"
        r="318"
        fill="none"
        strokeWidth="1"
        className="stroke-accent-inverse opacity-15"
      />
      <circle
        cx="400"
        cy="400"
        r="352"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="0.1 18"
        className="stroke-accent-inverse opacity-45"
      />
      <circle
        cx="400"
        cy="400"
        r="396"
        fill="none"
        strokeWidth="1"
        className="stroke-accent opacity-30"
      />
      <path
        d="M40 213 L44 221 L52 225 L44 229 L40 237 L36 229 L28 225 L36 221 Z"
        className="fill-accent-inverse opacity-70"
      />
      <path
        d="M716 597 L719 603 L725 606 L719 609 L716 615 L713 609 L707 606 L713 603 Z"
        className="fill-accent-inverse opacity-60"
      />
      <path
        d="M110 690 L112 694 L116 696 L112 698 L110 702 L108 698 L104 696 L108 694 Z"
        className="fill-accent opacity-80"
      />
    </svg>
  )
}

/** The hem's scallops, as one path: a row of shallow arches 24 units wide. */
const HEM_PATH = Array.from({ length: SWAGS * 5 }, (_, index) => {
  const x = index * 24

  return `M${x} 12 V10 A12 10 0 0 1 ${x + 24} 10 V12 Z`
}).join(' ')

/**
 * A scalloped hem along the bottom of a night band, in the colour of the page
 * below it, so the band ends like the edge of a skirt rather than a ruler line.
 *
 * @param {object} props Component props.
 * @param {string} [props.className] Positioning. Defaults to the bottom edge of a `relative` parent.
 * @returns {JSX.Element} The hem.
 */
export function ScallopHem({ className = 'pointer-events-none absolute inset-x-0 bottom-0' }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${SWAG * SWAGS} 12`}
      preserveAspectRatio="xMidYMax slice"
      className={`block h-3 w-full ${className}`}
    >
      <path d={HEM_PATH} className="fill-page" />
    </svg>
  )
}

/**
 * A line of mirror-work between two sections: a hairline either side of a
 * short chain of diamonds and marigold dots.
 *
 * @param {object} props Component props.
 * @param {string} [props.className] Spacing around it.
 * @returns {JSX.Element} The divider.
 */
export function MirrorDivider({ className = '' }) {
  return (
    <div aria-hidden="true" className={`flex items-center gap-4 ${className}`}>
      <span className="h-px flex-1 bg-line-strong" />
      <svg focusable="false" viewBox="0 0 132 16" className="block h-4 w-33 shrink-0">
        <path d="M8 4 L12 8 L8 12 L4 8 Z" className="fill-accent-secondary" />
        <circle cx="24" cy="8" r="2" className="fill-highlight" />
        <path d="M40 2.5 L45.5 8 L40 13.5 L34.5 8 Z" className="fill-accent" />
        <circle cx="54" cy="8" r="2" className="fill-highlight" />
        <path d="M66 0 L74 8 L66 16 L58 8 Z" className="fill-action-primary" />
        <circle cx="66" cy="8" r="2.5" className="fill-page" />
        <circle cx="78" cy="8" r="2" className="fill-highlight" />
        <path d="M92 2.5 L97.5 8 L92 13.5 L86.5 8 Z" className="fill-accent" />
        <circle cx="108" cy="8" r="2" className="fill-highlight" />
        <path d="M124 4 L128 8 L124 12 L120 8 Z" className="fill-accent-secondary" />
      </svg>
      <span className="h-px flex-1 bg-line-strong" />
    </div>
  )
}

/**
 * The thin mirror-work band — the theme's `.mirror-band` — on a strip of its
 * own. It sits under the header and at the seams between the night bands and
 * the page.
 *
 * @param {object} props Component props.
 * @param {string} [props.className] The strip's ground. Defaults to sand.
 * @returns {JSX.Element} The band.
 */
export function MirrorBand({ className = 'bg-surface-subtle' }) {
  return (
    <div aria-hidden="true" className={className}>
      <div className="mirror-band" />
    </div>
  )
}

/**
 * A small diamond, the bullet the eyebrows and lists on a night band use.
 *
 * @param {object} props Component props.
 * @param {string} [props.className] Size and fill. Defaults to a marigold diamond.
 * @returns {JSX.Element} The diamond.
 */
export function Diamond({ className = 'h-3 w-3 fill-accent-inverse' }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 12 12"
      className={`shrink-0 ${className}`}
    >
      <path d="M6 0 L12 6 L6 12 L0 6 Z" />
    </svg>
  )
}
