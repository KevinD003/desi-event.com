/**
 * The 404 page.
 *
 * A dead end is still a page: it keeps the header, the footer and a route back
 * into the catalogue rather than dropping the visitor somewhere blank.
 *
 * @module app/not-found
 */

import Link from 'next/link'

export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
}

/**
 * The not-found page.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
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
        <Link
          href="/events"
          className="inline-flex h-12 items-center justify-center rounded-lg bg-marigold-600 px-6 text-base font-medium text-white shadow-sm transition-colors hover:bg-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2"
        >
          Browse every event
        </Link>
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-6 text-base font-medium text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2"
        >
          Back to the home page
        </Link>
      </div>
    </div>
  )
}
