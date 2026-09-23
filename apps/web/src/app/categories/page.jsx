/**
 * Browse by category: every kind of night out, and how much of each is listed.
 *
 * Every category is offered, in the same editorial order the home page uses,
 * including the ones with nothing in them right now. That is the difference
 * from the home page's grid, which hides empty categories because it is a
 * shop window; this is a directory, and a directory that silently loses
 * "Theatre" in a quiet month reads as a site that does not do theatre. An
 * empty category says so in words and still links, because the listing it
 * opens says the same thing honestly and fills up the day something is
 * published.
 *
 * The numbers are the facet counts from the API, computed in the database over
 * every listed event — the statuses a listing shows, published, on sale, sales
 * paused and sold out (`FACET_SCOPE`, `LISTED`, in
 * `apps/api/src/lib/facets.js`) — so a category's number is how many events
 * the listing it links to holds. They are worded as "listed" because that is
 * what they count: not "upcoming", which they do not check, and not "on sale",
 * which is one status of four. Nothing here is worked out from a page of
 * results, and nothing is sorted by count: order by size and the page starts
 * claiming what is popular, which the data does not say.
 *
 * When the API cannot be reached, the facets come from the sample catalogue,
 * like every other public read, and the page says so.
 *
 * @module app/categories/page
 */

import Link from 'next/link'

import { RevealOnScroll } from '../../components/motion.jsx'
import { SampleDataNotice } from '../../components/sample-data-notice.jsx'
import { loadCatalogueFacets } from '../../lib/api.js'
import { categoryCountLabel, describeCategoryDirectory } from '../../lib/directory.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Categories',
  description:
    'Garba and dandiya, live music, Bollywood nights, classical dance, comedy, melas and more — every kind of event on Desi-Event, with how many are listed in each.',
}

/**
 * The category directory.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function CategoriesPage() {
  const { facets, usedFallback } = await loadCatalogueFacets()
  const { categories, countsKnown } = describeCategoryDirectory(facets)

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold text-ink sm:text-4xl">Browse by category</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        From a two-hour Bharatanatyam margam to a food festival that takes a whole weekend. The
        number beside each category is how many events are listed in it.
      </p>

      <SampleDataNotice show={usedFallback} />

      {countsKnown ? null : (
        <p className="mt-6 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-muted">
          How many events each category holds could not be read just now, so no counts are shown.
          Every category still opens its listing.
        </p>
      )}

      <ul
        aria-label="Event categories"
        className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {categories.map((category, index) => {
          const count = categoryCountLabel(category.count)

          return (
            <RevealOnScroll as="li" key={category.value} index={index}>
              <Link
                href={category.href}
                className="group flex h-full min-h-11 items-start gap-4 rounded-card border border-line bg-surface-raised p-5 transition-colors hover:border-accent-line hover:bg-accent-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-xl text-accent-strong"
                >
                  {category.glyph}
                </span>
                <div className="flex flex-col gap-1">
                  <h2 className="font-display text-base font-semibold text-ink group-hover:text-accent-strong">
                    {category.label}
                  </h2>
                  <p className="text-sm text-ink-muted">{category.blurb}</p>
                  {count ? (
                    <p data-testid="category-count" className="text-xs font-medium text-ink-muted">
                      {count}
                    </p>
                  ) : null}
                </div>
              </Link>
            </RevealOnScroll>
          )
        })}
      </ul>

      <p className="mt-10">
        <Link
          href="/events"
          className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-accent-strong underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          Browse every event instead
        </Link>
      </p>
    </div>
  )
}
