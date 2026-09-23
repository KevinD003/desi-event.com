/**
 * The home page: a night-band hero with a search, the soonest nights, the
 * cities and categories the catalogue covers, how buying works here, and a
 * word for organisers.
 *
 * Rendered per request because ticket availability changes by the minute and a
 * cached "on sale" badge on a sold-out night is worse than a slower page.
 *
 * ## Everything on it is read, not written in
 *
 * The featured cards are the soonest events on the listing. The city chips and
 * their numbers are the facets the API counted in the database, grouped by the
 * time zone their events are held in; the category tiles are the categories
 * that have something listed. The hero's poster is the next event's own
 * poster. Where a figure cannot be read — the facets failed, the listing is
 * empty — the page leaves it out rather than showing a zero or a guess.
 *
 * ## Motion
 *
 * The headline's words arrive one after another, the poster fades up, the
 * toran's bulbs twinkle three times and stop, and the sections below rise into
 * view as they are scrolled to. Under reduced motion all of it is simply there.
 *
 * @module app/page
 */

import Link from 'next/link'
import { Fragment } from 'react'

import { CategoryGrid } from '../components/category-grid.jsx'
import {
  Diamond,
  GarbaRings,
  MirrorDivider,
  ScallopHem,
  Toran,
} from '../components/festive-decor.jsx'
import {
  ArrowRightIcon,
  CalendarIcon,
  PinIcon,
  SearchIcon,
  ShieldIcon,
  TicketIcon,
} from '../components/icons.jsx'
import {
  INVERSE_TEXT_LINK,
  PRIMARY_LINK,
  SECONDARY_LINK,
  TEXT_LINK,
} from '../components/link-classes.js'
import { EventGrid } from '../components/listing-card.jsx'
import { FadeIn, Reveal, Stagger, StaggerItem } from '../components/motion.jsx'
import { EventPoster } from '../components/poster.jsx'
import { SampleDataNotice } from '../components/sample-data-notice.jsx'
import { Input, Select } from '../components/ui.jsx'
import { loadCatalogueFacets, loadCatalogueOverview } from '../lib/api.js'
import { describeCategories } from '../lib/catalog.js'
import { formatEventStart, toDateTimeAttribute } from '../lib/format.js'
import {
  calendarLeaf,
  groupCitiesByZone,
  notYetOver,
  organisersWithNext,
} from '../lib/home-sections.js'
import { buildEventsHref } from '../lib/search-params.js'

export const dynamic = 'force-dynamic'

/** How many events the "coming up" row shows: one row of four on a wide screen. */
const FEATURED_COUNT = 4

/** The headline, a line at a time; the last line is set in marigold italic. */
const HEADLINE = Object.freeze([
  ['Nine', 'nights.'],
  ['One', 'circle.'],
  ['Find', 'your', 'garba.'],
])

/** A search-panel label: the small uppercase eyebrow. */
const FIELD_LABEL = 'pl-1 text-micro font-bold tracking-eyebrow text-ink-muted uppercase'

/** A section's eyebrow, in the accent. */
const EYEBROW = 'text-micro font-bold tracking-eyebrow text-accent-strong uppercase'

/**
 * The three steps of buying here. The third says, in its own words, that
 * payment is simulated — it is the step where somebody would otherwise expect
 * to hand over a card.
 */
const STEPS = Object.freeze([
  {
    title: 'Find your night',
    body: 'Browse by city or category, or search for an event, a venue or an organiser. The price on a card says whether the booking fee is in it.',
    Icon: SearchIcon,
  },
  {
    title: 'Reserve your tickets',
    body: 'Choose your tiers and how many. Reserving holds them while you check out, and the notice says until when. Buying needs an account, because that is where tickets are kept.',
    Icon: TicketIcon,
  },
  {
    title: 'Pay (simulated)',
    lead: 'Payments on this site are simulated — no card, no money moves.',
    body: 'Your tickets then appear in My tickets.',
    Icon: ShieldIcon,
  },
])

/**
 * The hero's headline, its words arriving one after another.
 *
 * The heading's text is the words and the spaces between them, so a screen
 * reader and a search engine read one sentence; the stagger only decides when
 * each word becomes visible. Each space is a text node between two words
 * rather than the tail of one, because an accessible name is assembled from
 * each element's trimmed text, and a trailing space would be trimmed away.
 *
 * @returns {JSX.Element} The heading.
 */
function Headline() {
  return (
    <h1 id="hero-heading" className="text-display font-semibold tracking-tight text-ink-inverse">
      <Stagger as="span" trigger="mount" delay={0.04} className="block">
        {HEADLINE.map((line, lineIndex) => (
          <Fragment key={line.join(' ')}>
            {lineIndex > 0 ? ' ' : null}
            <span
              className={`block ${
                lineIndex === HEADLINE.length - 1 ? 'font-medium text-accent-inverse italic' : ''
              }`}
            >
              {line.map((word, wordIndex) => (
                <Fragment key={word}>
                  {wordIndex > 0 ? ' ' : null}
                  <StaggerItem as="span" className="inline-block">
                    {word}
                  </StaggerItem>
                </Fragment>
              ))}
            </span>
          </Fragment>
        ))}
      </Stagger>
    </h1>
  )
}

/**
 * The search panel: a city and a query, sent to the listing as a plain GET, so
 * it works before any JavaScript arrives and leaves a URL somebody can share.
 *
 * @param {object} props Component props.
 * @param {string[]} props.cities Every listed city, from the facets.
 * @returns {JSX.Element} The form.
 */
function HeroSearch({ cities }) {
  return (
    <form
      action="/events"
      method="get"
      role="search"
      aria-label="Find events"
      className="grid grid-cols-1 gap-3 rounded-card bg-surface-raised p-4 text-ink shadow-dialog sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-end sm:p-3"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="home-city" className={FIELD_LABEL}>
          City
        </label>
        <Select
          id="home-city"
          name="city"
          defaultValue=""
          className="h-13 font-semibold"
          options={[
            { value: '', label: 'All cities' },
            ...cities.map((city) => ({ value: city, label: city })),
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="home-q" className={FIELD_LABEL}>
          What
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
          <Input
            id="home-q"
            type="search"
            name="q"
            placeholder="Event, venue or organiser"
            autoComplete="off"
            className="h-13 pl-11"
          />
        </div>
      </div>
      <button
        type="submit"
        className="inline-flex h-13 items-center justify-center gap-2 rounded-control bg-action-primary px-6 text-base font-bold text-action-primary-ink shadow-control transition duration-(--duration-fast) ease-standard hover:bg-action-primary-hover motion-safe:active:scale-[0.98]"
      >
        Find events
        <ArrowRightIcon className="h-4.5 w-4.5" />
      </button>
    </form>
  )
}

/**
 * The next event, as the hero shows it: its poster in a glowing frame, and a
 * small card underneath that says when and where and leads to its page.
 *
 * @param {object} props Component props.
 * @param {object} props.event The next garba night on the listing, or the next night of any kind.
 * @returns {JSX.Element} The figure.
 */
function NextUp({ event }) {
  const leaf = calendarLeaf(event)
  const label = event.category === 'GARBA_DANDIYA' ? 'Next garba night' : 'Next up'

  return (
    <div className="relative pb-10 lg:pb-8">
      <div className="rounded-[1.75rem] bg-ink-inverse/5 p-2 shadow-2xl ring-1 shadow-highlight/30 ring-accent-inverse/35 sm:p-2.5">
        <div className="aspect-[3/2] overflow-hidden rounded-card">
          <EventPoster event={event} variant="hero" className="h-full" />
        </div>
      </div>
      <Link
        href={`/events/${event.slug}`}
        className="group absolute right-4 bottom-0 left-4 flex items-center gap-3.5 rounded-2xl bg-surface-raised p-3.5 text-ink shadow-dialog transition duration-(--duration-base) ease-standard hover:shadow-card-hover motion-safe:hover:-translate-y-1 sm:right-auto sm:left-[-1.5rem] sm:w-[22rem] lg:left-[-2.75rem]"
      >
        {leaf ? (
          <span
            aria-hidden="true"
            className="flex h-15 w-14 shrink-0 flex-col items-center justify-center rounded-control bg-surface-subtle"
          >
            <span className="text-[0.6875rem] font-bold tracking-eyebrow text-accent-strong uppercase">
              {leaf.month}
            </span>
            <span className="font-display text-2xl leading-7 font-bold text-ink">{leaf.day}</span>
          </span>
        ) : null}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-semibold text-ink-subtle">
            <span className="sr-only">{label}:</span>{' '}
            <time dateTime={toDateTimeAttribute(event.startsAt)}>{formatEventStart(event)}</time>
            {event.city ? ` · ${event.city}` : ''}
          </span>
          <span className="text-[0.9375rem] leading-5 font-bold text-ink group-hover:text-accent-strong">
            {event.title}
          </span>
        </span>
      </Link>
    </div>
  )
}

/**
 * The home hero on the night band.
 *
 * @param {object} props Component props.
 * @param {string[]} props.cities Every listed city.
 * @param {number|null} props.listed How many events the listing holds, when known.
 * @param {object|null} props.lead The soonest event, for the poster.
 * @returns {JSX.Element} The hero.
 */
function Hero({ cities, listed, lead }) {
  const facts = [
    cities.length > 0
      ? { Icon: PinIcon, text: `${cities.length} ${cities.length === 1 ? 'city' : 'cities'}` }
      : null,
    Number.isInteger(listed) && listed > 0
      ? { Icon: CalendarIcon, text: `${listed} ${listed === 1 ? 'event' : 'events'} listed` }
      : null,
    { Icon: TicketIcon, text: 'Prices in US dollars' },
  ].filter(Boolean)

  return (
    <section
      aria-labelledby="hero-heading"
      className="relative isolate overflow-hidden bg-surface-inverse text-ink-inverse"
    >
      <Toran />
      {lead ? (
        <GarbaRings className="absolute top-1/2 right-[-14rem] hidden h-[50rem] w-[50rem] -translate-y-[45%] lg:block xl:right-[-8rem]" />
      ) : null}

      <div className="relative mx-auto grid max-w-bleed grid-cols-1 items-center gap-12 px-4 pt-20 pb-20 sm:px-6 sm:pt-24 lg:grid-cols-[minmax(0,38rem)_minmax(0,1fr)] lg:gap-16 lg:px-10 lg:pt-28 lg:pb-24 xl:px-16">
        <div>
          <FadeIn>
            <p className="mb-5 flex items-center gap-2.5 text-micro font-bold tracking-eyebrow text-accent-inverse uppercase">
              <Diamond />
              Garba &amp; dandiya nights · across the USA
            </p>
          </FadeIn>
          <Headline />
          <FadeIn delay={0.34}>
            <p className="mt-6 max-w-lg text-body text-ink-inverse-muted">
              Garba, dandiya and raas nights from Edison to Santa Clara. Prices are in US dollars,
              and the booking fee is shown before you reach checkout.
            </p>
          </FadeIn>
          <FadeIn delay={0.4} className="mt-8">
            <HeroSearch cities={cities} />
          </FadeIn>
          <FadeIn delay={0.46}>
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-inverse-muted">
              {facts.map(({ Icon, text }) => (
                <li key={text} className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-accent-inverse" />
                  {text}
                </li>
              ))}
            </ul>
          </FadeIn>
        </div>

        {lead ? (
          <FadeIn delay={0.2} className="mx-auto w-full max-w-xl lg:max-w-none">
            <NextUp event={lead} />
          </FadeIn>
        ) : null}
      </div>

      <ScallopHem />
    </section>
  )
}

/**
 * A section's heading block: eyebrow, heading, and whatever sits beside it.
 *
 * @param {object} props Component props.
 * @param {string} props.id The heading's id.
 * @param {string} props.eyebrow The eyebrow.
 * @param {string} props.title The heading.
 * @param {'h1'|'h2'|'h3'} [props.size] How large the heading is set.
 * @param {ReactNode} [props.aside] Copy or a link on the right on a wide screen.
 * @returns {JSX.Element} The block.
 */
function SectionHeading({ id, eyebrow, title, size = 'h1', aside }) {
  return (
    <Reveal className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
      <div>
        <p className={`mb-2 ${EYEBROW}`}>{eyebrow}</p>
        <h2 id={id} className={`${size === 'h1' ? 'text-h1' : 'text-h2'} font-semibold text-ink`}>
          {title}
        </h2>
      </div>
      {aside}
    </Reveal>
  )
}

/**
 * The home page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function HomePage() {
  const [overview, facetResult] = await Promise.all([
    loadCatalogueOverview(),
    loadCatalogueFacets(),
  ])

  const { events } = overview
  const { facets } = facetResult
  const usedFallback = overview.usedFallback || facetResult.usedFallback

  // "Coming up" and "next" are claims about the date, so they are made only
  // of events that have not finished.
  const upcoming = notYetOver(events)
  const featured = upcoming.slice(0, FEATURED_COUNT)
  // The hero is about garba, so its poster is the next garba night when there
  // is one, and otherwise simply the next night.
  const lead = upcoming.find((event) => event.category === 'GARBA_DANDIYA') ?? upcoming[0] ?? null
  const categories = describeCategories(facets.categories)
  const cityNames = (facets.cities ?? [])
    .map((entry) => entry.value)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
  const cityGroups = groupCitiesByZone(facets.cities, events)
  const zoneCount = cityGroups.filter((group) => group.key !== 'other').length
  const listed = Number.isInteger(facets.scope?.total) ? facets.scope.total : null
  const organisers = organisersWithNext(upcoming)

  return (
    <div className="pb-4">
      <Hero cities={cityNames} listed={listed} lead={lead} />

      {usedFallback ? (
        <div className="mx-auto max-w-content px-4 sm:px-6">
          <SampleDataNotice show />
        </div>
      ) : null}

      <section
        aria-labelledby="featured-heading"
        className="mx-auto max-w-content px-4 pt-16 pb-14 sm:px-6 lg:pt-20"
      >
        <SectionHeading
          id="featured-heading"
          eyebrow="Coming up"
          title="The next nights out"
          aside={
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <p className="max-w-sm text-[0.9375rem] leading-6 text-ink-muted">
                The soonest nights on the listing, earliest first, with the time in each venue’s own
                zone.
              </p>
              <Link href="/events" className={`${SECONDARY_LINK} shrink-0`}>
                See all events
                <ArrowRightIcon className="h-4.5 w-4.5" />
              </Link>
            </div>
          }
        />

        <div className="mt-9">
          {featured.length > 0 ? (
            <EventGrid events={featured} label="Events happening soon" layout="rail" />
          ) : (
            <p className="rounded-card bg-surface-subtle p-6 text-ink-muted">
              Nothing is listed right now. The listing fills up the moment an organiser publishes a
              night.
            </p>
          )}
        </div>
      </section>

      {cityGroups.length > 0 ? (
        <section
          aria-labelledby="cities-heading"
          className="mx-auto max-w-content px-4 pb-16 sm:px-6"
        >
          <MirrorDivider className="mb-12" />
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-14">
            <Reveal>
              <p className={`mb-2 ${EYEBROW}`}>Browse by city</p>
              <h2 id="cities-heading" className="text-h2 font-semibold text-ink">
                Garba near you, coast to coast
              </h2>
              <p className="mt-3 text-[0.9375rem] leading-6 text-ink-muted">
                {cityNames.length} {cityNames.length === 1 ? 'city' : 'cities'}
                {zoneCount > 1 ? ` across ${zoneCount} time zones` : ''}. Every time is shown in the
                venue’s own zone. The number is how many events each city has listed.
              </p>
            </Reveal>

            <div className="flex flex-col gap-5">
              {cityGroups.map((group) => (
                <div
                  key={group.key}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-4"
                >
                  <p className="flex items-center gap-2">
                    <Diamond className="h-2.5 w-2.5 fill-accent" />
                    <span className="flex flex-col">
                      <span className="text-sm font-bold text-ink">{group.name}</span>
                      {group.short ? (
                        <span className="text-xs text-ink-subtle">{group.short}</span>
                      ) : null}
                    </span>
                  </p>
                  <Stagger
                    as="ul"
                    aria-label={`Cities in ${group.name}`}
                    className="flex flex-wrap gap-2.5"
                  >
                    {group.cities.map(({ city, count }) => (
                      <StaggerItem as="li" key={city}>
                        <Link
                          href={buildEventsHref({ city })}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface-raised py-1 pr-2 pl-4 text-[0.9375rem] font-semibold text-ink shadow-control transition duration-(--duration-base) ease-standard hover:border-accent-strong hover:text-accent-strong motion-safe:hover:-translate-y-0.5"
                        >
                          {city}{' '}
                          {count !== null ? (
                            <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-bold text-ink-muted tabular-nums">
                              {count}{' '}
                              <span className="sr-only">
                                {count === 1 ? 'event listed' : 'events listed'}
                              </span>
                            </span>
                          ) : (
                            <span aria-hidden="true" className="w-2" />
                          )}
                        </Link>
                      </StaggerItem>
                    ))}
                  </Stagger>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {categories.length > 0 ? (
        <section
          aria-labelledby="categories-heading"
          className="mx-auto max-w-content px-4 pb-20 sm:px-6"
        >
          <SectionHeading
            id="categories-heading"
            eyebrow="Categories"
            title="Pick your kind of night"
            size="h2"
            aside={
              <Link
                href="/categories"
                className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-sm font-bold text-accent-strong underline-offset-4 hover:underline"
              >
                Browse all categories
                <ArrowRightIcon className="h-4.5 w-4.5" />
              </Link>
            }
          />
          <div className="mt-8">
            <CategoryGrid categories={categories} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="how-heading" className="relative bg-surface-subtle">
        <div className="mx-auto max-w-content px-4 py-16 sm:px-6 lg:py-20">
          <SectionHeading
            id="how-heading"
            eyebrow="Before you book"
            title="How tickets work here"
            aside={
              <p className="max-w-md text-body text-ink-muted">
                Prices are in US dollars. US sales tax is not calculated in this demo, so checkout
                shows it as $0.00.
              </p>
            }
          />
          <Stagger as="ol" className="mt-9 grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
            {STEPS.map((step, index) => {
              const last = index === STEPS.length - 1

              return (
                <StaggerItem
                  as="li"
                  key={step.title}
                  className={`rounded-card p-6 sm:p-7 ${
                    last
                      ? 'bg-accent-soft shadow-[0_0_0_1px_var(--color-accent-line)]'
                      : 'bg-surface-raised shadow-card'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span
                      aria-hidden="true"
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-h3 font-bold ${
                        last
                          ? 'bg-action-primary text-action-primary-ink'
                          : 'bg-highlight text-highlight-ink'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <h3 className="flex-1 text-h3 font-semibold text-ink">{step.title}</h3>
                    <step.Icon className="h-6 w-6 text-accent-strong" />
                  </div>
                  <p className="mt-3 text-[0.9375rem] leading-6 text-ink-muted">
                    {step.lead ? (
                      <strong className="font-bold text-ink">{step.lead} </strong>
                    ) : null}
                    {step.body}
                  </p>
                </StaggerItem>
              )
            })}
          </Stagger>
        </div>
      </section>

      <section
        aria-labelledby="organisers-heading"
        className="mx-auto max-w-content px-4 pt-16 pb-6 sm:px-6"
      >
        <Reveal className="relative isolate grid grid-cols-1 items-center gap-10 overflow-hidden rounded-[1.75rem] bg-surface-inverse px-6 py-12 text-ink-inverse sm:px-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-14 lg:px-16 lg:py-14">
          <GarbaRings className="pointer-events-none absolute -top-72 -left-80 -z-10 h-[36rem] w-[36rem] opacity-60" />
          <div>
            <p className="mb-4 flex items-center gap-2.5 text-micro font-bold tracking-eyebrow text-accent-inverse uppercase">
              <Diamond />
              For organisers
            </p>
            <h2 id="organisers-heading" className="text-h1 font-semibold text-ink-inverse">
              Running a garba night?
            </h2>
            <p className="mt-4 max-w-xl text-body text-ink-inverse-muted">
              List your event with its venue, dates and ticket tiers in US dollars, then run it —
              sales, orders and door check-in — from the organiser workspace. Organiser accounts are
              set up by the platform in this build; there is no sign-up for an organisation.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href="/organizer" className={PRIMARY_LINK}>
                Open the organiser workspace
                <ArrowRightIcon className="h-4.5 w-4.5" />
              </Link>
              <Link
                href="/limitations"
                className={`${INVERSE_TEXT_LINK} inline-flex min-h-11 items-center`}
              >
                What this site does not do
              </Link>
            </div>
          </div>

          {organisers.length > 0 ? (
            <div className="rounded-card bg-surface-raised p-5 text-ink shadow-dialog sm:p-6">
              <h3 className="font-sans text-micro font-bold tracking-eyebrow text-ink-subtle uppercase">
                Organisers with nights coming up
              </h3>
              <ul className="mt-2 divide-y divide-line">
                {organisers.map(({ name, slug, next }) => (
                  <li key={slug}>
                    <Link
                      href={`/organizers/${encodeURIComponent(slug)}`}
                      className="group flex min-h-11 items-center gap-3 rounded-control py-2.5"
                    >
                      <span
                        aria-hidden="true"
                        className="h-10 w-15 shrink-0 overflow-hidden rounded-lg bg-surface-subtle"
                      >
                        <EventPoster event={next} className="h-full" />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-bold text-ink underline-offset-4 group-hover:text-accent-strong group-hover:underline">
                          {name}
                        </span>
                        <span className="truncate text-xs text-ink-subtle">
                          Next:{' '}
                          <time dateTime={toDateTimeAttribute(next.startsAt)}>
                            {formatEventStart(next)}
                          </time>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href="/organizers"
                className={`${TEXT_LINK} mt-3 inline-flex min-h-11 items-center gap-2 text-sm`}
              >
                Every organiser
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          ) : null}
        </Reveal>
      </section>
    </div>
  )
}
