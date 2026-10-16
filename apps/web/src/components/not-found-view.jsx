/**
 * What a visitor sees when the page they asked for is not there.
 *
 * Rendered by the root not-found page for an address that matches no route,
 * and by the event, checkout, organiser and venue routes themselves when the
 * thing they name is missing (see `e2e/not-found.spec.js` for why those
 * routes draw it rather than calling `notFound()`). One view for every case,
 * taking no props, so the page cannot be used to tell "never published" from
 * "withdrawn" from "deleted".
 *
 * Laid out as a poster: the line set large on the page, a purple plate beside
 * it holding a magenta ticket that admits nobody, and the three ways on.
 * Nothing moves, so reduced motion has nothing to stop and nothing can be
 * caught half-drawn.
 *
 * @module components/not-found-view
 */

import Link from 'next/link'
import { Icon } from '@desi-event/ui/icons'

import { OUTLINE_LINK, PRIMARY_LINK, TEXT_LINK } from './link-classes.js'

/**
 * The not-found view.
 *
 * @returns {JSX.Element} The view.
 */
export function NotFoundView() {
  return (
    <div
      data-testid="not-found-view"
      className="mx-auto grid w-full max-w-bleed grid-cols-1 items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:gap-10 lg:px-10 lg:py-24"
    >
      <div className="lg:col-span-7">
        <h1 className="max-w-[14ch] text-display text-ink">This one is not on the bill</h1>
        <p className="mt-6 max-w-[52ch] text-body text-ink-muted">
          The page you were looking for has either finished its run or never existed. The rest of
          the programme is still going.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/events" className={PRIMARY_LINK}>
            Browse every event
            <Icon name="arrow-right" className="h-4.5 w-4.5" />
          </Link>
          <Link href="/events#filter-q" className={`${OUTLINE_LINK} min-h-12 text-base`}>
            <Icon name="search" className="h-4.5 w-4.5" />
            Search events
          </Link>
          <Link href="/" className={`${TEXT_LINK} ml-1 inline-flex min-h-11 items-center`}>
            Back to the home page
          </Link>
        </div>
      </div>

      {/* The plate: a magenta ticket on the purple, notched at its tear
          line, that admits nobody. Decoration: it says in a joke what the
          heading says in words, so it is hidden from assistive technology. */}
      <div
        aria-hidden="true"
        data-plate=""
        className="relative hidden aspect-[4/5] items-center justify-center overflow-hidden rounded-plate bg-surface-inverse lg:col-span-5 lg:flex"
      >
        <div className="stub-notches w-[68%] -rotate-6 bg-accent px-10 pt-12 pb-10 text-ink-inverse">
          <p className="font-display text-[clamp(3.5rem,6.5vw,6rem)] leading-[0.88] font-extrabold tracking-[-0.01em] uppercase [font-stretch:75%]">
            Admit
            <br />
            none
          </p>
          <p className="mt-10 border-t-2 border-dashed border-ink-inverse/60 pt-4 text-label font-semibold text-ink-inverse">
            Not on tonight&rsquo;s programme
          </p>
        </div>
      </div>
    </div>
  )
}
