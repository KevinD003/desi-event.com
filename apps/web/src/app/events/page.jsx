/**
 * The event listing: filter by category, state or province and city, free
 * text, and — behind "More filters" — when, language, format, price and
 * whether tickets are on sale.
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
import {
  buildEventsHref,
  citiesFor,
  hasActiveFilters,
  parseEventFilters,
  reconcileFilters,
  regionValue,
} from '../../lib/search-params.js'
import { MirrorDivider } from '../../components/festive-decor.jsx'
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon, SearchIcon } from '../../components/icons.jsx'
import { PRIMARY_LINK_SMALL, SECONDARY_LINK } from '../../components/link-classes.js'
import { EventFilters } from '../../components/listing-filters.jsx'
import { EventGrid } from '../../components/listing-card.jsx'
import { FadeIn } from '../../components/motion.jsx'
import { Breadcrumbs } from '../../components/page-state.jsx'
import { PageHero } from '../../components/page-hero.jsx'
import { EventArt } from '../../components/event-art.jsx'
import { SampleDataNotice } from '../../components/sample-data-notice.jsx'
import { TrafficScope } from '../../components/traffic-scope.jsx'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'All events',
  description:
    'Every garba and dandiya night, beginner garba class and Navratri mela on The Desi Events — filter by category, state or province, city, date, language or price, or search.',
}

/** How a "When" choice reads in the summary sentence. */
const WHEN_PHRASES = Object.freeze({
  today: 'today',
  weekend: 'this weekend',
  week: 'this week',
  month: 'this month',
})

/**
 * Where the summary says the events are: the city with its state's code, the
 * city alone, or the state's name.
 *
 * @param {object} filters Active filters.
 * @param {object|null} region The chosen state's facet, when one is chosen.
 * @returns {string} ` in Frisco, TX`, ` in Texas`, or an empty string.
 */
function placePhrase(filters, region) {
  if (filters.city && region) return ` in ${filters.city}, ${region.region}`
  if (filters.city) return ` in ${filters.city}`
  if (region) return ` in ${region.name}`

  return ''
}

/**
 * A chosen day as the summary says it.
 *
 * The day is a calendar day, not an instant, so it is written in UTC: the
 * same day on the server and in every browser.
 *
 * @param {string} day `YYYY-MM-DD`.
 * @returns {string} `Oct 17, 2026`.
 */
function dayLabel(day) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00.000Z`))
}

/**
 * When the summary says the events are.
 *
 * @param {object} filters Active filters.
 * @returns {string} ` this weekend`, ` from Oct 17, 2026 to Oct 18, 2026`, or an empty string.
 */
function whenPhrase(filters) {
  const { when, from, to } = filters

  if (WHEN_PHRASES[when]) return ` ${WHEN_PHRASES[when]}`
  if (from && to && from === to) return ` on ${dayLabel(from)}`
  if (from && to) return ` from ${dayLabel(from)} to ${dayLabel(to)}`
  if (from) return ` from ${dayLabel(from)}`
  if (to) return ` until ${dayLabel(to)}`

  return ''
}

/**
 * Describe the current result set in one sentence.
 *
 * @param {object} pagination Page counters from the listing.
 * @param {object} filters Active filters.
 * @param {object|null} [region] The chosen state's facet, for its name.
 * @returns {string} A sentence such as `3 free events in Frisco, TX this weekend`.
 */
function resultSummary(pagination, filters, region = null) {
  const noun = pagination.total === 1 ? 'event' : 'events'
  const kind = [
    filters.free ? 'free' : '',
    filters.format === 'online' ? 'online' : '',
    filters.format === 'in_person' ? 'in-person' : '',
  ]
    .filter(Boolean)
    .map((word) => `${word} `)
    .join('')
  const language = filters.language ? ` in ${filters.language}` : ''
  const onSale = filters.onSale ? ' on sale now' : ''
  const matching = filters.q ? ` matching “${filters.q}”` : ''

  return `${pagination.total} ${kind}${noun}${placePhrase(filters, region)}${whenPhrase(filters)}${language}${onSale}${matching}`
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
  const parsed = parseEventFilters(await searchParams)

  // The filter selects offer every category, state and city the catalogue
  // has, not just the ones surviving the current filter — otherwise choosing
  // "Toronto" would delete every other city from the city select. The one
  // narrowing is the one a visitor asks for: with a state chosen, the City
  // select lists that state's cities.
  //
  // They come from facet counts computed in the database over every listed
  // event, not from a page of results. Deriving them from one page meant a city
  // whose events all started later than the forty-eighth was absent from the
  // select entirely, and its events unreachable through filtering.
  //
  // The facets are read first because they decide which filters stand: a
  // state, city or language the catalogue does not have is dropped, and a
  // city outside the chosen state with it (`reconcileFilters`).
  //
  // Both are asked for at once with the filters as the URL gave them; in the
  // rare case that changes them, the listing is asked for again.
  const [facetResult, asParsed] = await Promise.all([loadCatalogueFacets(), loadEventList(parsed)])
  const facets = facetResult.facets ?? {}
  const filters = reconcileFilters(parsed, facets)
  const changed = ['region', 'city', 'language'].some((name) => filters[name] !== parsed[name])
  const listing = changed ? await loadEventList(filters) : asParsed

  const { events, pagination, usedFallback } = listing
  const categories = describeCategories(facets.categories ?? [])
  const regions = Array.isArray(facets.regions) ? facets.regions : []
  const region = regions.find((entry) => regionValue(entry) === filters.region) ?? null
  const cities = citiesFor(facets, filters.region)
  const languages = (facets.languages ?? []).map((entry) => entry.value)
  const active = hasActiveFilters(filters)

  // A fan of the first posters on the page, behind the heading. Decoration:
  // the same posters are on the cards below, each with its name.
  const fan = events.slice(0, 3)

  return (
    <div>
      <PageHero
        headingId="events-heading"
        breadcrumbs={
          <Breadcrumbs
            tone="inverse"
            trail={[
              { href: '/', label: 'Home' },
              { href: null, label: 'Discover events' },
            ]}
          />
        }
        title={
          <>
            What&rsquo;s <em className="font-medium text-accent-inverse italic">on</em>
          </>
        }
        lead="Garba, dandiya and raas nights from Edison to Santa Clara. Filter it down to the night you actually want."
        art={fan.length > 0 ? <PosterFan events={fan} /> : null}
        className="pb-24 sm:pb-28"
      />

      <div className="mx-auto max-w-content px-4 sm:px-6">
        <FadeIn delay={0.12} className="relative z-10 -mt-14">
          {/*
            No `key` here, deliberately. It used to be derived from the filter
            values, which remounted the whole form on every change and threw
            keyboard focus back to the document body mid-interaction.
          */}
          <EventFilters
            categories={categories}
            regions={regions}
            cities={cities}
            languages={languages}
            filters={filters}
            anyActive={active}
            resultCount={pagination?.total ?? events.length}
          />
        </FadeIn>

        <SampleDataNotice show={usedFallback} />

        <div className="mt-12 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p
              role="status"
              data-testid="result-count"
              className="font-display text-h2 font-semibold text-ink"
            >
              {resultSummary(pagination, filters, region)}
            </p>
            {pagination.totalPages > 1 ? (
              <p className="mt-1 text-[0.9375rem] text-ink-muted">
                Page {pagination.page} of {pagination.totalPages}, soonest first
              </p>
            ) : (
              <p className="mt-1 text-[0.9375rem] text-ink-muted">Soonest first</p>
            )}
          </div>
          <p className="inline-flex items-start gap-2.5 rounded-control bg-surface-subtle px-4 py-2.5 text-sm text-ink-muted md:max-w-md">
            <InfoIcon className="mt-0.5 h-4.5 w-4.5 text-accent-strong" />
            <span>
              A card’s price says whether the booking fee is in it.{' '}
              <strong className="font-bold text-ink">Payments on this site are simulated.</strong>
            </span>
          </p>
        </div>

        {/*
          `tabIndex={-1}` makes this a focus target for the filter bar's
          "Skip to results" link without putting it in the tab order. Focus moves
          here only when a visitor asks for it, never automatically on a filter
          change.
        */}
        <div id="event-results" tabIndex={-1} className="mt-8 scroll-mt-28">
          {events.length === 0 ? (
            <EmptyState
              icon={<SearchIcon className="h-8 w-8" />}
              title="Nothing matches that"
              description="Try a broader search, another city, or browse everything we have on."
              className="bg-surface-raised"
              action={
                <Link href="/events" className={PRIMARY_LINK_SMALL}>
                  Clear all filters
                </Link>
              }
            />
          ) : (
            <EventGrid
              events={events}
              label="Matching events"
              headingLevel="h2"
              // A click on a card is counted as from search results when the
              // visitor searched, and from the events list otherwise.
              trafficPlacement={usedFallback ? null : filters.q ? 'SEARCH' : 'LISTING'}
            />
          )}
        </div>

        {pagination.totalPages > 1 ? (
          <>
            <MirrorDivider className="mt-14" />
            <nav
              aria-label="Listing pages"
              className="mt-8 flex items-center justify-between gap-4 sm:justify-center sm:gap-8"
            >
              {pagination.hasPreviousPage ? (
                <Link
                  href={buildEventsHref({ ...filters, page: pagination.page - 1 })}
                  className={SECONDARY_LINK}
                >
                  <ArrowLeftIcon className="h-4.5 w-4.5" />
                  Previous
                </Link>
              ) : (
                <span className="w-28" />
              )}

              <p className="text-[0.9375rem] text-ink-muted">
                Page <span className="font-bold text-ink">{pagination.page}</span> of{' '}
                {pagination.totalPages}
              </p>

              {pagination.hasNextPage ? (
                <Link
                  href={buildEventsHref({ ...filters, page: pagination.page + 1 })}
                  className={SECONDARY_LINK}
                >
                  Next
                  <ArrowRightIcon className="h-4.5 w-4.5" />
                </Link>
              ) : (
                <span className="w-28" />
              )}
            </nav>
          </>
        ) : null}
      </div>

      {/* Counts clicks on the cards above; a signed-in organiser's own events
          and staff at The Desi Events are left out. */}
      <TrafficScope />
    </div>
  )
}

/**
 * Three posters fanned out behind the listing's heading.
 *
 * @param {object} props Component props.
 * @param {object[]} props.events The events whose posters to fan.
 * @returns {JSX.Element} The fan.
 */
function PosterFan({ events }) {
  const placements = [
    'left-0 top-14 w-48 -rotate-[9deg]',
    'right-0 top-12 w-48 rotate-[8deg]',
    'left-1/2 top-4 w-60 -translate-x-1/2 -rotate-[1.5deg]',
  ]

  return (
    <div className="relative h-60 w-[27.5rem]">
      {events.map((event, index) => (
        <FadeIn
          key={event.slug}
          delay={0.16 + index * 0.06}
          className={`absolute overflow-hidden rounded-2xl border-4 border-page shadow-dialog ${placements[index]}`}
        >
          <EventArt event={event} sizes="18rem" />
        </FadeIn>
      ))}
    </div>
  )
}
