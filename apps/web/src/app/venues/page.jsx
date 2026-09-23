/**
 * The venue directory: the shared venues on Desi-Event, and what each one
 * asserts about getting in.
 *
 * ## Whose venues
 *
 * `GET /v1/venues` is asked anonymously, so this is the list every visitor
 * sees: the shared, platform-curated venues. An organiser's own venue record is
 * theirs, and the API keeps it out of anybody else's list. A venue with no
 * slug has no public page and is not listed; neither is one merged into
 * another, which the API already leaves out.
 *
 * ## Accessibility is a filter, and a claim
 *
 * Each card shows the claims the venue asserts, as words — the same words its
 * own page uses — and never an absent claim as a "no": a venue that has not
 * said whether it has a hearing loop has not said it lacks one. A venue can
 * also write a free-text note, with or without claims; the card says the note
 * is on the venue's page rather than calling that venue silent, and says a
 * venue has published nothing only when it has neither, as its page does. The
 * filter asks the API for venues asserting every ticked claim.
 *
 * The API applies that filter to each page after reading it, because the
 * claims live in a JSON column (see `venues.list` in
 * `apps/api/src/routes/venues.js`). Two consequences are stated on the page
 * rather than papered over: a filtered page can hold fewer venues than the one
 * after it, and the listing's `total` counts venues before the filter, so no
 * total is shown at all.
 *
 * ## Failure
 *
 * There is no sample catalogue of venues to fall back to, so a failed read is
 * drawn as the refusal it is, by `ReadRefusal`. An empty grid in its place
 * would tell a visitor there are no venues. The refusal is worded as the
 * server's, not the visitor's: this read is made by the web server, so "check
 * your connection" would be advice for the wrong person (`refusalOf` in
 * `lib/directory.js`).
 *
 * The filter is a plain GET form: it works before any JavaScript arrives and
 * leaves the whole state in a URL somebody can share.
 *
 * @module app/venues/page
 */

import Link from 'next/link'
import { ACCESSIBILITY_FEATURES } from '@desi-event/schemas'

import { GarbaRings } from '../../components/festive-decor.jsx'
import { ArrowLeftIcon, ArrowRightIcon, PinIcon } from '../../components/icons.jsx'
import { SECONDARY_LINK, TEXT_LINK } from '../../components/link-classes.js'
import { FadeIn } from '../../components/motion.jsx'
import { Empty } from '../../components/page-state.jsx'
import { PageHero } from '../../components/page-hero.jsx'
import { ReadRefusal } from '../../components/read-refusal.jsx'
import { Badge, Button, Input } from '../../components/ui.jsx'
import { accessibilityLabel } from '../../lib/accessibility.js'
import {
  MAX_ACCESSIBILITY_FILTERS,
  buildVenuesHref,
  hasVenueFilters,
  loadVenueDirectory,
  parseVenueFilters,
  venueAccessibilityLabels,
  venueHasAccessibilityNote,
  venuePlace,
} from '../../lib/directory.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Venues',
  description:
    'Halls and pavilions on Desi-Event, with the accessibility each venue asserts — step-free entrances, hearing loops, accessible toilets and more.',
}

/** Classes for a pagination link, matching the event listing. */
const PAGE_LINK = SECONDARY_LINK

/**
 * The filter form.
 *
 * @param {object} props Component props.
 * @param {object} props.filters The filters in force, from `parseVenueFilters`.
 * @returns {JSX.Element} The form.
 */
function VenueFilterForm({ filters }) {
  // Only what was applied is ticked. A claim left out for being the seventh is
  // named in the notice below the form; ticking it here would say it counted.
  const ticked = new Set(filters.accessibility)

  return (
    <form
      method="get"
      action="/venues"
      aria-label="Filter venues"
      className="rounded-card bg-surface-raised p-5 shadow-dialog sm:p-6"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="venue-city"
            className="pl-1 text-micro font-bold tracking-eyebrow text-ink-muted uppercase"
          >
            City
          </label>
          <p id="venue-city-hint" className="text-sm text-ink-muted">
            The whole name, such as Edison or Santa Clara.
          </p>
          <Input
            id="venue-city"
            name="city"
            type="text"
            defaultValue={filters.city}
            maxLength={120}
            autoComplete="address-level2"
            aria-describedby="venue-city-hint"
          />
        </div>

        <fieldset aria-describedby="venue-access-hint">
          <legend className="pl-1 text-micro font-bold tracking-eyebrow text-ink-muted uppercase">
            What you need to get in
          </legend>
          <p id="venue-access-hint" className="mt-1 text-sm text-ink-muted">
            Only venues asserting every one you tick are shown. Up to {MAX_ACCESSIBILITY_FILTERS} at
            once.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {ACCESSIBILITY_FEATURES.map((code) => (
              <label key={code} className="flex min-h-11 items-center gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  name="accessibility"
                  value={code}
                  defaultChecked={ticked.has(code)}
                  className="h-5 w-5 shrink-0 accent-action-primary"
                />
                <span>{accessibilityLabel(code)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg">
          Apply
        </Button>
        {hasVenueFilters(filters) ? (
          <Link
            href="/venues"
            className={`${TEXT_LINK} inline-flex min-h-11 items-center px-2 text-sm`}
          >
            Clear filters
          </Link>
        ) : null}
      </div>
    </form>
  )
}

/**
 * One venue in the directory.
 *
 * @param {object} props Component props.
 * @param {object} props.venue A listable venue summary.
 * @returns {JSX.Element} The card.
 */
function VenueCard({ venue }) {
  const place = venuePlace(venue)
  const claims = venueAccessibilityLabels(venue)
  const hasNote = venueHasAccessibilityNote(venue)
  const capacity = Number.isInteger(venue.capacity) && venue.capacity > 0 ? venue.capacity : null

  return (
    <li className="flex flex-col rounded-card bg-surface-raised p-6 shadow-card">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent-strong"
        >
          <PinIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-h3 font-semibold text-ink">
            <Link
              href={`/venues/${encodeURIComponent(venue.slug)}`}
              className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:text-accent-strong hover:underline"
            >
              {venue.name}
            </Link>
          </h2>
          {place ? <p className="text-sm text-ink-muted">{place}</p> : null}
          {capacity ? (
            <p className="mt-1 text-sm text-ink-muted">
              Capacity {capacity.toLocaleString('en-US')}
            </p>
          ) : null}
        </div>
      </div>

      {claims.length > 0 ? (
        <ul aria-label={`Accessibility at ${venue.name}`} className="mt-5 flex flex-wrap gap-2">
          {claims.map((claim) => (
            <li key={claim}>
              {/* Words, not icons, and the same words the venue's own page uses. */}
              <Badge variant="secondary">{claim}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {hasNote ? (
        <p className="mt-4 text-sm text-ink-muted">
          {claims.length > 0
            ? 'The venue adds an accessibility note on its page.'
            : 'The venue describes its accessibility in a note on its page.'}
        </p>
      ) : null}

      {claims.length === 0 && !hasNote ? (
        <p className="mt-5 text-sm text-ink-muted">
          This venue has not published its accessibility details.
        </p>
      ) : null}
    </li>
  )
}

/**
 * What to say when a page of the directory has no venues on it.
 *
 * Five different situations, and they are not interchangeable: a directory
 * with nothing in it, filters that matched nothing, a filtered page whose
 * matches are on a later page, a filtered last page whose matches were all on
 * earlier ones, and a page number past the end.
 *
 * @param {object} props Component props.
 * @param {object} props.filters The filters in force, from `parseVenueFilters`.
 * @param {{page: number, hasNextPage: boolean}} props.pagination Where this page sits.
 * @returns {JSX.Element} The message.
 */
function NoVenuesHere({ filters, pagination }) {
  if (pagination.hasNextPage) {
    return (
      <Empty
        title="None of the venues on this page can be shown"
        description={
          filters.accessibility.length > 0
            ? 'The accessibility filter is applied a page at a time, so matching venues may still be on the next page.'
            : 'Venues without a public page are not listed. There are more on the next page.'
        }
      />
    )
  }

  if (pagination.page > 1 && filters.accessibility.length > 0) {
    return (
      <Empty
        title="None of the venues on this page match"
        description="The accessibility filter is applied a page at a time, so earlier pages may still have venues that do."
      />
    )
  }

  if (pagination.page > 1) {
    return (
      <Empty
        title="There is nothing on this page"
        description="The directory ends before this page. Go back to the first page to start again."
      />
    )
  }

  if (hasVenueFilters(filters)) {
    return (
      <Empty
        title="No venues match those filters"
        description="Try another city, or fewer accessibility needs. The city has to be the whole name."
      />
    )
  }

  return (
    <Empty
      title="No venues are listed"
      description="This directory lists the venues shared across Desi-Event, and it has none."
    />
  )
}

/**
 * @typedef {object} VenuesPageProps
 * @property {Promise<Record<string, string|string[]|undefined>>} searchParams The URL's query parameters.
 */

/**
 * The venue directory.
 *
 * @param {VenuesPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function VenuesPage({ searchParams }) {
  const filters = parseVenueFilters(await searchParams)
  const result = await loadVenueDirectory(filters)

  return (
    <div>
      <PageHero
        headingId="venues-heading"
        eyebrow="Halls & pavilions"
        title="Venues"
        lead="The halls and pavilions shared across Desi-Event, and what each one asserts about getting in. Open a venue for its address, how to reach it and what is on there."
        art={<GarbaRings className="h-[30rem] w-[30rem]" />}
        className="pb-24 sm:pb-28"
      />

      <div className="mx-auto max-w-content px-4 sm:px-6">
        <FadeIn delay={0.12} className="relative z-10 -mt-14">
          <VenueFilterForm filters={filters} />
        </FadeIn>

        {filters.leftOut.length > 0 ? (
          <p className="mt-4 rounded-card border border-status-warning/30 bg-status-warning-soft p-4 text-sm text-status-warning">
            Only {MAX_ACCESSIBILITY_FILTERS} accessibility needs can be applied at once, so these
            were left out: {filters.leftOut.map((code) => accessibilityLabel(code)).join(', ')}.
          </p>
        ) : null}

        {result.ok ? (
          <>
            <p
              data-testid="venue-summary"
              className="mt-10 font-display text-h3 font-semibold text-ink"
            >
              {result.venues.length === 1
                ? '1 venue on this page'
                : `${result.venues.length} venues on this page`}
            </p>
            {filters.accessibility.length > 0 ? (
              <p className="mt-1 text-sm text-ink-muted">
                The accessibility filter is applied a page at a time, so one page can hold fewer
                venues than the next.
              </p>
            ) : null}

            {result.venues.length === 0 ? (
              <NoVenuesHere filters={filters} pagination={result.pagination} />
            ) : (
              <ul
                aria-label="Venues"
                className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
              >
                {result.venues.map((venue) => (
                  <VenueCard key={venue.slug} venue={venue} />
                ))}
              </ul>
            )}

            {result.pagination.page > 1 || result.pagination.hasNextPage ? (
              <nav
                aria-label="Directory pages"
                className="mt-10 flex items-center justify-between gap-4"
              >
                {result.pagination.page > 1 ? (
                  <Link
                    href={buildVenuesHref({ ...filters, page: result.pagination.page - 1 })}
                    className={PAGE_LINK}
                  >
                    <ArrowLeftIcon className="h-4.5 w-4.5" />
                    Previous
                  </Link>
                ) : (
                  <span />
                )}

                <p className="text-sm text-ink-muted">Page {result.pagination.page}</p>

                {result.pagination.hasNextPage ? (
                  <Link
                    href={buildVenuesHref({ ...filters, page: result.pagination.page + 1 })}
                    className={PAGE_LINK}
                  >
                    Next
                    <ArrowRightIcon className="h-4.5 w-4.5" />
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        ) : (
          <ReadRefusal
            error={result.error}
            what="The venue directory"
            action="see the venue directory"
            backHref="/events"
            backLabel="Browse events instead"
          />
        )}
      </div>
    </div>
  )
}
