/**
 * The night band a public page opens with.
 *
 * The home page has its own, larger hero; every other public page — the
 * listing, the directories, a venue, an organiser, sign-in, the limitations —
 * opens with this one: the toran strung across the top, an optional trail and
 * eyebrow, the page's one `h1` in the display face, a line of lead copy, and
 * whatever the page wants to add beneath it. A scalloped hem closes it into the
 * ivory page.
 *
 * The heading and its copy rise into place when the page loads; under reduced
 * motion they are simply there. Nothing the page needs to read waits on the
 * animation, because the theme forces anything marked `data-motion` visible
 * when motion is reduced or scripting is off.
 *
 * @module components/page-hero
 */

import { Diamond, ScallopHem, Toran } from './festive-decor.jsx'
import { FadeIn } from './motion.jsx'

/**
 * @typedef {object} PageHeroProps
 * @property {string} headingId The `h1`'s id; the band is a region named by it.
 * @property {ReactNode} title The page's heading.
 * @property {ReactNode} [eyebrow] A short marigold line above the heading.
 * @property {ReactNode} [lead] A sentence or two under the heading.
 * @property {ReactNode} [breadcrumbs] A `Breadcrumbs` trail with `tone="inverse"`.
 * @property {ReactNode} [art] Decoration drawn on the right on a wide screen. Hidden from assistive technology.
 * @property {ReactNode} [children] Anything else the band should hold, under the lead.
 * @property {string} [className] Extra classes for the band's inner column, e.g. more room at the foot for a panel that overlaps it.
 */

/**
 * The night band at the top of a public page.
 *
 * @param {PageHeroProps} props Component props.
 * @returns {JSX.Element} The band.
 */
export function PageHero({
  headingId,
  title,
  eyebrow,
  lead,
  breadcrumbs,
  art,
  children,
  className = 'pb-16 sm:pb-20',
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="relative isolate overflow-hidden bg-surface-inverse text-ink-inverse"
    >
      <Toran />
      {art ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[44%] max-w-xl items-center justify-center lg:flex"
        >
          {art}
        </div>
      ) : null}

      <div className={`relative mx-auto max-w-content px-4 pt-16 sm:px-6 sm:pt-20 ${className}`}>
        <div className="max-w-2xl lg:max-w-[52%]">
          {breadcrumbs ? <div className="-mt-2 mb-2">{breadcrumbs}</div> : null}
          <FadeIn>
            {eyebrow ? (
              <p className="mb-3 flex items-center gap-2.5 text-micro font-bold tracking-eyebrow text-accent-inverse uppercase">
                <Diamond />
                {eyebrow}
              </p>
            ) : null}
            <h1 id={headingId} className="text-h1 font-semibold text-ink-inverse">
              {title}
            </h1>
          </FadeIn>
          {lead ? (
            <FadeIn delay={0.08}>
              <p className="mt-4 text-body text-ink-inverse-muted">{lead}</p>
            </FadeIn>
          ) : null}
          {children}
        </div>
      </div>

      <ScallopHem />
    </section>
  )
}
