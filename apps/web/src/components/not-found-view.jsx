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

/** Shared link styling for the primary action. */
const primaryLink =
  'inline-flex h-12 items-center justify-center rounded-lg bg-marigold-700 px-6 text-base ' +
  'font-medium text-white shadow-sm transition-colors hover:bg-marigold-800 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-600 ' +
  'focus-visible:ring-offset-2'

/** Shared link styling for the secondary actions. */
const secondaryLink =
  'inline-flex h-12 items-center justify-center rounded-lg border border-slate-300 bg-white ' +
  'px-6 text-base font-medium text-slate-900 transition-colors hover:bg-slate-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-600 ' +
  'focus-visible:ring-offset-2'

/**
 * The shared not-found page body.
 *
 * @returns {JSX.Element} The rendered view.
 */
export function NotFoundView() {
  return (
    <div data-testid="not-found-view" className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p aria-hidden="true" className="font-display text-6xl text-marigold-500">
        ✺
      </p>
      <h1 className="mt-6 text-3xl font-bold text-indigo-night-900 sm:text-4xl">
        This one is not on the bill
      </h1>
      <p className="mt-4 text-lg text-slate-700">
        The page you were looking for has either finished its run or never existed. The rest of the
        programme is still going.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/events" className={primaryLink}>
          Browse every event
        </Link>
        <Link href="/events#filter-q" className={secondaryLink}>
          Search events
        </Link>
        <Link href="/" className={secondaryLink}>
          Back to the home page
        </Link>
      </div>
    </div>
  )
}
