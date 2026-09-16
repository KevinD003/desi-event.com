/**
 * The event listing: filter by category, city and free text.
 *
 * All filter state lives in the query string, so the server renders the right
 * results on the first response, the back button behaves, and a filtered view
 * can be shared as a link. `searchParams` is a promise in the App Router and
 * must be awaited before it is read.
 *
 * @module app/events/page
 */

import Link from 'next/link'
import { EmptyState } from '../../components/ui.jsx'

import { loadCatalogueFacets, loadEventList } from '../../lib/api.js'
import { describeCategories } from '../../lib/catalog.js'
import { buildEventsHref, hasActiveFilters, parseEventFilters } from '../../lib/search-params.js'
import { EventFilters } from '../../components/listing-filters.jsx'
import { EventGrid } from '../../components/listing-card.jsx'
import { SampleDataNotice } from '../../components/sample-data-notice.jsx'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'All events',
  description:
    'Every garba night, qawwali mehfil, mela, film retrospective and comedy show on Desi-Event — filter by category, city or search.',
}

/**
 * Describe the current result set in one sentence.
 *
 * @param {object} pagination Page counters from the listing.
 * @param {object} filters Active filters.
 * @returns {string} A sentence such as `3 events in Toronto`.
 */
function resultSummary(pagination, filters) {
  const noun = pagination.total === 1 ? 'event' : 'events'
  const where = filters.city ? ` in ${filters.city}` : ''
  const matching = filters.q ? ` matching “${filters.q}”` : ''

  return `${pagination.total} ${noun}${where}${matching}`
}

/**
 * @typedef {object} EventsPageProps
 * @property {Promise<Record<string, string|string[]|undefined>>} searchParams The URL's query parameters.
 */

/**
 * The filtered event listing.
 *
 * @param {EventsPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered listing.
 */
export default async function EventsPage({ searchParams }) {
  const filters = parseEventFilters(await searchParams)

  // The filter selects offer every category and city the catalogue has, not
  // just the ones surviving the current filter — otherwise choosing "Toronto"
  // would delete every other city from the city select.
  //
  // They come from facet counts computed in the database over every published
  // event, not from a page of results. Deriving them from one page meant a city
  // whose events all started later than the forty-eighth was absent from the
  // select entirely, and its events unreachable through filtering.
  const [listing, facetResult] = await Promise.all([loadEventList(filters), loadCatalogueFacets()])

  const { events, pagination, usedFallback } = listing
  const categories = describeCategories(facetResult.facets.categories)
  const cities = facetResult.facets.cities.map((entry) => entry.value)
  const active = hasActiveFilters(filters)

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold text-indigo-night-900 sm:text-4xl">What&rsquo;s on</h1>
      <p className="mt-2 max-w-2xl text-slate-700">
        Ten cities’ worth of ambition, four cities’ worth of listings. Filter it down to the night
        you actually want.
      </p>

      <div className="mt-6">
        {/*
          No `key` here, deliberately. It used to be derived from the filter
          values, which remounted the whole form on every change and threw
          keyboard focus back to the document body mid-interaction.
        */}
        <EventFilters
          categories={categories}
          cities={cities}
          filters={filters}
          anyActive={active}
          resultCount={pagination?.total ?? events.length}
        />
      </div>

      <SampleDataNotice show={usedFallback} />

      <p
        role="status"
        data-testid="result-count"
        className="mt-6 text-sm font-medium text-slate-600"
      >
        {resultSummary(pagination, filters)}
      </p>

      {/*
        `tabIndex={-1}` makes this a focus target for the filter bar's
        "Skip to results" link without putting it in the tab order. Focus moves
        here only when a visitor asks for it, never automatically on a filter
        change.
      */}
      <div id="event-results" tabIndex={-1} className="mt-4 scroll-mt-4">
        {events.length === 0 ? (
          <EmptyState
            icon="◎"
            title="Nothing matches that yet"
            description="Try a broader search, another city, or browse everything we have on."
            action={
              <Link
                href="/events"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-marigold-700 px-4 text-sm font-medium text-white transition-colors hover:bg-marigold-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-600 focus-visible:ring-offset-2"
              >
                Clear all filters
              </Link>
            }
          />
        ) : (
          <EventGrid events={events} label="Matching events" headingLevel="h2" />
        )}
      </div>

      {pagination.totalPages > 1 ? (
        <nav aria-label="Listing pages" className="mt-10 flex items-center justify-between gap-4">
          {pagination.hasPreviousPage ? (
            <Link
              href={buildEventsHref({ ...filters, page: pagination.page - 1 })}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-600 focus-visible:ring-offset-2"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}

          <p className="text-sm text-slate-600">
            Page {pagination.page} of {pagination.totalPages}
          </p>

          {pagination.hasNextPage ? (
            <Link
              href={buildEventsHref({ ...filters, page: pagination.page + 1 })}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-600 focus-visible:ring-offset-2"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  )
}
