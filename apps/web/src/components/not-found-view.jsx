/**
 * The one "not found" view the whole site uses.
 *
 * Two things about it are deliberate.
 *
 * The first is that it renders on the server with no motion, no state and no
 * client component in its tree. Next.js 16.3.5 cannot server-render the UI
 * behind `notFound()` — the response it builds for that call is an empty
 * document that only fills in once the browser has hydrated — so every route
 * that discovers a missing resource renders *this* instead, and a visitor with
 * no JavaScript, a slow connection or a text browser still gets a page.
 *
 * The second is that the wording never changes. A missing event, an event that
 * was never published, one pulled by moderation, a private draft and a deleted
 * one all produce exactly these words, so the page cannot be used to probe
 * which of those a URL happens to be.
 *
 * @module components/not-found-view
 */

import Link from 'next/link'

import { Diamond, ScallopHem, Toran } from './festive-decor.jsx'
import { ArrowRightIcon, SearchIcon } from './icons.jsx'
import { OUTLINE_LINK, PRIMARY_LINK } from './link-classes.js'

/**
 * The shared not-found page body: a night band with the toran over the words,
 * and three ways onward. No motion — see above — and the toran's bulbs only
 * twinkle where the visitor has not asked for reduced motion, in CSS, with
 * nothing to hydrate.
 *
 * @returns {JSX.Element} The rendered view.
 */
export function NotFoundView() {
  return (
    <div data-testid="not-found-view">
      <section className="relative isolate overflow-hidden bg-surface-inverse text-ink-inverse">
        <Toran />
        <div className="relative mx-auto max-w-2xl px-4 pt-24 pb-20 text-center sm:px-6">
          <p className="flex items-center justify-center gap-2.5 text-micro font-bold tracking-eyebrow text-accent-inverse uppercase">
            <Diamond />
            Page not found
            <Diamond />
          </p>
          <h1 className="mt-5 text-h1 font-semibold text-ink-inverse">
            This one is not on the bill
          </h1>
          <p className="mt-4 text-body text-ink-inverse-muted">
            The page you were looking for has either finished its run or never existed. The rest of
            the programme is still going.
          </p>
        </div>
        <ScallopHem />
      </section>

      <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-3 px-4 pt-10 sm:px-6">
        <Link href="/events" className={PRIMARY_LINK}>
          Browse every event
          <ArrowRightIcon className="h-4.5 w-4.5" />
        </Link>
        <Link href="/events#filter-q" className={`${OUTLINE_LINK} min-h-12 text-base`}>
          <SearchIcon className="h-4.5 w-4.5" />
          Search events
        </Link>
        <Link href="/" className={`${OUTLINE_LINK} min-h-12 text-base`}>
          Back to the home page
        </Link>
      </div>
    </div>
  )
}
