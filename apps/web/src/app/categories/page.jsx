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

import { GarbaRings } from '../../components/festive-decor.jsx'
import { ArrowRightIcon, CategoryIcon } from '../../components/icons.jsx'
import { SECONDARY_LINK } from '../../components/link-classes.js'
import { HoverLift, Stagger, StaggerItem } from '../../components/motion.jsx'
import { PageHero } from '../../components/page-hero.jsx'
import { SampleDataNotice } from '../../components/sample-data-notice.jsx'
import { loadCatalogueFacets } from '../../lib/api.js'
import { categoryCountLabel, describeCategoryDirectory } from '../../lib/directory.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Categories',
  description:
    'Garba and dandiya, workshops, live music, melas and more — every kind of event on Desi-Event, with how many are listed in each.',
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
    <div>
      <PageHero
        headingId="categories-heading"
        eyebrow="Categories"
        title="Browse by category"
        lead="From an open-floor garba night to a mela that takes a whole weekend. The number on each is how many events are listed in it."
        art={<GarbaRings className="h-[30rem] w-[30rem]" />}
      />

      <div className="mx-auto max-w-content px-4 pt-10 sm:px-6">
        <SampleDataNotice show={usedFallback} className="mb-6" />

        {countsKnown ? null : (
          <p className="mb-6 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-muted">
            How many events each category holds could not be read just now, so no counts are shown.
            Every category still opens its listing.
          </p>
        )}

        <Stagger
          as="ul"
          aria-label="Event categories"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3"
        >
          {categories.map((category) => {
            const count = categoryCountLabel(category.count)

            return (
              <StaggerItem as="li" key={category.value} className="flex">
                <HoverLift className="group flex w-full">
                  <Link
                    href={category.href}
                    className="flex min-h-11 w-full items-start gap-4 rounded-card bg-surface-raised p-5 shadow-card transition-shadow duration-(--duration-base) ease-standard group-data-lifted:shadow-card-hover hover:shadow-card-hover sm:p-6"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent-strong"
                    >
                      <CategoryIcon category={category.value} className="h-6 w-6" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <h2 className="text-h3 font-semibold text-ink transition-colors duration-(--duration-fast) group-hover:text-accent-strong">
                        {category.label}
                      </h2>
                      <p className="text-sm text-ink-muted">{category.blurb}</p>
                      {count ? (
                        <p
                          data-testid="category-count"
                          className="mt-2 text-sm font-bold text-accent-strong"
                        >
                          {count}
                        </p>
                      ) : null}
                    </div>
                  </Link>
                </HoverLift>
              </StaggerItem>
            )
          })}
        </Stagger>

        <p className="mt-12">
          <Link href="/events" className={SECONDARY_LINK}>
            Browse every event instead
            <ArrowRightIcon className="h-4.5 w-4.5" />
          </Link>
        </p>
      </div>
    </div>
  )
}
