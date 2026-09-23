/**
 * An event's detail page: what it is, when and where it runs, what a seat
 * costs all in, and whether it is still happening.
 *
 * ## Saying when something is off
 *
 * A cancelled show whose page looks exactly like a live one is the failure this
 * page is built around. Three things have to agree, and they are derived from
 * one status so they cannot drift:
 *
 *   - the banner a person reads,
 *   - the `schema.org` `eventStatus` a search engine reads,
 *   - and whether the buy button does anything.
 *
 * `lib/event-jsonld.js` owns the first two; the third is here. A banner saying
 * "cancelled" above a working "Choose tickets" button is worse than either
 * alone.
 *
 * ## What is not on the page
 *
 * Only what the API gives an anonymous caller. The structured data is built
 * from the same payload the page renders rather than from a second read, so
 * there is one allow list rather than two — a second source is how an
 * organiser's contact address ends up inside a `<script>` tag after having been
 * kept out of the visible page.
 *
 * @module app/events/slug/page
 */

import Link from 'next/link'
import { Fragment } from 'react'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { Alert, Badge } from '../../../components/ui.jsx'

import { accessibilityLabel, mergedAccessibility } from '../../../lib/accessibility.js'
import { loadEventBySlug } from '../../../lib/api.js'
import { categoryLabel } from '../../../lib/catalog.js'
import {
  allTiersSoldOut,
  eventAvailability,
  tierOnSaleNow,
} from '../../../lib/event-availability.js'
import { eventJsonLd, lifecycleNotice } from '../../../lib/event-jsonld.js'
import {
  formatEventDate,
  formatEventTime,
  formatEventWhen,
  formatTimeZoneLabel,
  formatVenueAddress,
  toDateTimeAttribute,
  toParagraphs,
} from '../../../lib/format.js'
import { initialOf } from '../../../lib/initial.js'
import { formatPrice, priceSelection, taxLabelForPlace } from '../../../lib/pricing.js'
import { buildEventsHref } from '../../../lib/search-params.js'
import {
  Diamond,
  MirrorBand,
  MirrorDivider,
  ScallopHem,
  Toran,
} from '../../../components/festive-decor.jsx'
import {
  ArrowRightIcon,
  CalendarIcon,
  CategoryIcon,
  CheckIcon,
  ClockIcon,
  PinIcon,
  PolicyIcon,
  ShieldIcon,
  TicketIcon,
  VerifiedIcon,
} from '../../../components/icons.jsx'
import { INVERSE_TEXT_LINK, PRIMARY_LINK, TEXT_LINK } from '../../../components/link-classes.js'
import { AvailabilityChip } from '../../../components/listing-card.jsx'
import { EventPoster } from '../../../components/poster.jsx'
import { NotFoundView } from '../../../components/not-found-view.jsx'
import { FadeIn, Reveal, Stagger, StaggerItem } from '../../../components/motion.jsx'
import { Breadcrumbs } from '../../../components/page-state.jsx'
import { SampleDataNotice } from '../../../components/sample-data-notice.jsx'
import { TicketTiers } from '../../../components/ticket-tiers.jsx'

export const dynamic = 'force-dynamic'

/** Where this deployment is served from. Mirrors the root layout and sitemap. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'

/**
 * Statuses in which the buy button leads somewhere.
 *
 * `PUBLISHED` is on the list and `SALES_PAUSED` is not: an announced event
 * whose sales have not opened yet still takes you to a page that says when they
 * do, whereas a paused one has been stopped on purpose and a link into checkout
 * would be a lie with a loading spinner on the end of it.
 *
 * @type {ReadonlySet<string>}
 */
const BUYABLE_STATUSES = new Set(['PUBLISHED', 'ON_SALE'])

/** A section's eyebrow: a small uppercase line in the accent, after a diamond. */
const EYEBROW =
  'flex items-center gap-2.5 text-micro font-bold tracking-eyebrow text-accent-strong uppercase'

/**
 * The cheapest ticket that can be bought now, used for the "from" price.
 *
 * "Can be bought" as the API's `salesOpen` means it (`tierOnSaleNow`): stock
 * left, the tier on sale, and now inside its sales window. Filtering on stock
 * alone quoted a tier whose sales had not opened, and put "On sale" above it
 * while the event's listing card said "Not on sale now".
 *
 * @param {object[]} ticketTypes Ticket tiers with availability folded in.
 * @param {Date} now The moment the page is rendered for.
 * @returns {object|null} The cheapest tier on sale now, or `null` when there is none.
 */
function cheapestAvailable(ticketTypes, now) {
  const available = ticketTypes.filter((tier) => tierOnSaleNow(tier, now))
  if (available.length === 0) return null

  return available.reduce((lowest, tier) => (tier.priceCents < lowest.priceCents ? tier : lowest))
}

/**
 * What one of a tier's tickets actually costs, fees and tax included.
 *
 * The number on the poster and the number on the card have to be the same
 * number. This computes the second one from the same tables the server charges
 * from — `@desi-event/pricing`, resolved against where the event is *held*
 * rather than what it is priced in — so the "from" line can show it before
 * anybody commits to anything.
 *
 * It is still an estimate in one honest sense: the server recomputes every
 * column from the ticket type rows when the order is placed, and that result is
 * what is charged. It cannot differ unless the tier changed underneath, which
 * is exactly when it should.
 *
 * @param {object|null} tier The cheapest available tier, or null.
 * @param {object|null} [venue] The venue, for the tax jurisdiction.
 * @param {Array<object>|null} [feeTerms] The fee terms the API published for the event.
 * @returns {{allInCents: number, feesCents: number, taxCents: number, taxLabel: string}|null} The breakdown, or null.
 */
function allInPrice(tier, venue, feeTerms = null) {
  if (!tier || !Number.isFinite(tier.priceCents)) return null

  const place = { country: venue?.country, region: venue?.region }

  const totals = priceSelection({
    lines: [
      {
        ticketTypeId: tier.id,
        name: tier.name,
        quantity: 1,
        unitPriceCents: tier.priceCents,
      },
    ],
    currency: tier.currency ?? 'USD',
    place,
    feeTerms,
  })

  return {
    allInCents: totals.totalCents,
    feesCents: totals.feesCents,
    taxCents: totals.taxCents,
    taxLabel: taxLabelForPlace(place),
  }
}

/**
 * Per-event metadata for search engines and link previews.
 *
 * @param {object} props Route props.
 * @param {Promise<{slug: string}>} props.params The resolved route parameters.
 * @returns {Promise<object>} A Next.js metadata object.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params
  const { event } = await loadEventBySlug(slug)

  if (!event) {
    return { title: 'Event not found', robots: { index: false, follow: false } }
  }

  const where = event.venue ? `${event.venue.name}, ${event.venue.city}` : 'Online'
  const when = formatEventDate(event.startsAt, event.timezone)

  return {
    title: event.title,
    description: event.summary,
    alternates: { canonical: `/events/${event.slug}` },
    /*
     * A page that is not public does not get indexed, whatever reached it.
     *
     * The API is what decides who may load a draft, and it answers a stranger
     * with 404. This is the second lock: if a signed-in organiser previews
     * their own unannounced event and a crawler follows them in — a shared
     * link, a browser extension, a proxy that caches — the response still says
     * not to index it. The set is the lifecycle's, not a list written here.
     *
     * `CANCELLED` and `POSTPONED` stay indexable on purpose. They are the
     * states where a stale rich result does real harm, and the way to fix a
     * stale rich result is to let the crawler read the page and find
     * `EventCancelled` in the structured data — not to hide the page and leave
     * the old answer standing.
     */
    robots: PUBLICLY_VISIBLE_STATUSES.has(event.status)
      ? undefined
      : { index: false, follow: false },
    openGraph: {
      type: 'article',
      title: `${event.title} — ${when}, ${where}`,
      description: event.summary,
      url: `/events/${event.slug}`,
    },
    twitter: { card: 'summary_large_image', title: event.title, description: event.summary },
  }
}

/**
 * @typedef {object} EventDetailPageProps
 * @property {Promise<{slug: string}>} params The resolved route parameters.
 */

/**
 * The event detail page.
 *
 * @param {EventDetailPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function EventDetailPage({ params }) {
  const { slug } = await params
  const { event, usedFallback } = await loadEventBySlug(slug)

  // Next.js 16.3.5 answers `notFound()` with a document that has no body until
  // the browser hydrates, so a missing event renders the shared not-found view
  // here instead. See components/not-found-view.jsx.
  if (!event) return <NotFoundView />

  const ticketTypes = event.ticketTypes ?? []
  const cheapest = cheapestAvailable(ticketTypes, new Date())
  const soldOut = allTiersSoldOut(ticketTypes)
  const address = formatVenueAddress(event.venue)
  const zoneLabel = formatTimeZoneLabel(event)
  const paragraphs = toParagraphs(event.description)

  const notice = lifecycleNotice(event.status)
  const buyable = BUYABLE_STATUSES.has(event.status) && Boolean(cheapest)
  const closedSentence = notice?.title
    ? `${notice.title}. Tickets cannot be bought here at the moment.`
    : 'Tickets are not on sale at the moment.'
  const allIn = allInPrice(cheapest, event.venue, event.feeTerms)
  const access = mergedAccessibility(event)
  const policies = event.policies ?? {}
  const artists = event.artists ?? []
  const place = event.venue ? { country: event.venue.country, region: event.venue.region } : null

  // The state a card would show, read from the status alone: cancelled,
  // postponed, finished, sold out or paused. An ordinary on-sale event has no
  // chip in the hero — the ticket box says so where it matters.
  const stateChip = eventAvailability({ status: event.status })
  // Sold out by stock, not merely "nothing to buy now": a tier whose sales have
  // not opened, or that is paused, has not sold out.
  const allTiersGone = soldOut && !stateChip
  const locality = event.venue
    ? [event.venue.city, event.venue.region].filter(Boolean).join(', ')
    : null
  const titleWords = String(event.title).split(/\s+/).filter(Boolean)
  const heroPrice = cheapest
    ? {
        amount: formatPrice(allIn ? allIn.allInCents : cheapest.priceCents, cheapest.currency),
        note: allIn
          ? `with fees${allIn.taxCents > 0 ? ' and tax' : ''}`
          : cheapest.priceCents === 0
            ? 'no charge'
            : 'before fees',
      }
    : null

  // Emitted only for an event a stranger may load at all. For a draft being
  // previewed by its own organiser there is nothing a search engine should be
  // told, and a `<script>` block is the one part of a page that a `noindex`
  // header does not stop a scraper reading.
  const structuredData = PUBLICLY_VISIBLE_STATUSES.has(event.status)
    ? eventJsonLd(event, { siteUrl })
    : null

  return (
    <article>
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      ) : null}

      <div className="mx-auto max-w-content px-4 py-1 sm:px-6">
        <Breadcrumbs
          trail={[
            { href: '/events', label: 'Discover events' },
            {
              href: buildEventsHref({ category: event.category }),
              label: categoryLabel(event.category),
            },
            { href: null, label: event.title },
          ]}
        />
      </div>

      {/*
        The hero. On a wide screen the poster fills the band and two scrims —
        one from the left, one from the foot — turn it to night behind the
        words, so the text sits on the band's own colour rather than on the
        picture. On a phone the poster stands above the words instead of
        behind them.
      */}
      <section
        aria-labelledby="event-title"
        className="relative isolate overflow-hidden bg-surface-inverse text-ink-inverse"
      >
        <div className="relative lg:absolute lg:inset-0">
          <FadeIn className="h-full" distance={0}>
            <EventPoster event={event} variant="hero" className="lg:h-full" />
          </FadeIn>
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-t from-surface-inverse via-surface-inverse/10 via-40% to-transparent lg:hidden"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden bg-linear-to-r from-surface-inverse from-20% via-surface-inverse/90 via-50% to-transparent to-85% lg:block"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden bg-linear-to-t from-surface-inverse via-transparent via-45% to-surface-inverse/40 lg:block"
          />
        </div>
        <Toran />

        <div className="relative mx-auto max-w-content px-4 pb-14 sm:px-6 lg:flex lg:min-h-[38rem] lg:items-end lg:pt-36 lg:pb-16">
          <div className="-mt-10 sm:-mt-16 lg:mt-0 lg:max-w-[50%]">
            <FadeIn>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex min-h-8 items-center gap-2 rounded-full bg-highlight px-3.5 text-[0.8125rem] font-bold text-highlight-ink">
                  <CategoryIcon category={event.category} className="h-4 w-4" />
                  {categoryLabel(event.category)}
                </span>
                {stateChip ? (
                  <span className="inline-flex min-h-8 items-center rounded-full bg-surface-raised px-3.5 text-[0.8125rem] font-bold text-availability-closed">
                    <span className="sr-only">Availability: </span>
                    {stateChip.label}
                  </span>
                ) : null}
                {allTiersGone ? (
                  <span className="inline-flex min-h-8 items-center rounded-full bg-surface-raised px-3.5 text-[0.8125rem] font-bold text-availability-closed">
                    <span className="sr-only">Availability: </span>
                    Sold out
                  </span>
                ) : null}
                {/* A number, not a colour: "18+" is the whole fact, and a red dot is not. */}
                {event.ageRestriction ? (
                  <Badge variant="warning" size="lg" srLabel="Age restriction:">
                    {event.ageRestriction}+
                  </Badge>
                ) : null}
                {locality ? (
                  <span className="text-micro font-bold tracking-eyebrow text-accent-inverse uppercase">
                    {locality}
                  </span>
                ) : null}
              </div>
            </FadeIn>

            <h1 id="event-title" className="mt-5 text-h1 font-semibold text-ink-inverse">
              {/* Each word rises in turn. The spaces sit between the words as
                  text of their own, so the heading reads as the title. */}
              <Stagger as="span" trigger="mount" delay={0.06} className="block">
                {titleWords.map((word, index) => (
                  <Fragment key={`${word}-${index}`}>
                    {index > 0 ? ' ' : null}
                    <StaggerItem as="span" className="inline-block">
                      {word}
                    </StaggerItem>
                  </Fragment>
                ))}
              </Stagger>
            </h1>

            <FadeIn delay={0.3}>
              {event.summary ? (
                <p className="mt-4 text-body text-ink-inverse-muted">{event.summary}</p>
              ) : null}

              {event.organization ? (
                <p className="mt-5 flex flex-wrap items-center gap-3 text-[0.9375rem] text-ink-inverse-muted">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-page font-display text-base font-bold text-ink"
                  >
                    {initialOf(event.organization.name)}
                  </span>
                  <span>{`Presented by ${event.organization.name}`}</span>
                  {event.organization.verified ? (
                    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-ink-inverse/25 bg-ink-inverse/10 pr-3 pl-1.5 text-xs font-bold text-ink-inverse">
                      <VerifiedIcon className="h-4.5 w-4.5 text-accent-inverse" />
                      Verified organiser
                    </span>
                  ) : null}
                </p>
              ) : null}

              <div aria-hidden="true" className="mt-6 h-px bg-ink-inverse/15" />

              <ul
                aria-label="Event details"
                className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-x-8 sm:gap-y-4"
              >
                <li className="flex items-center gap-3">
                  <HeroFactIcon Icon={CalendarIcon} />
                  <span className="min-w-0">
                    <span className="block text-[0.9375rem] font-bold text-ink-inverse">
                      <time dateTime={toDateTimeAttribute(event.startsAt)}>
                        {formatEventDate(event.startsAt, event.timezone)}
                      </time>
                    </span>
                    <span className="block text-sm text-ink-inverse-muted">
                      {formatEventTime(event.startsAt, event.timezone)}
                      {event.endsAt ? ` – ${formatEventTime(event.endsAt, event.timezone)}` : ''}
                      {zoneLabel ? ` ${zoneLabel}` : ''}
                    </span>
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <HeroFactIcon Icon={PinIcon} />
                  <span className="min-w-0">
                    <span className="block text-[0.9375rem] font-bold text-ink-inverse">
                      {event.isOnline ? 'Online' : (event.venue?.name ?? 'Venue to be announced')}
                    </span>
                    {locality ? (
                      <span className="block text-sm text-ink-inverse-muted">{locality}</span>
                    ) : null}
                  </span>
                </li>
                {heroPrice ? (
                  <li className="flex items-center gap-3">
                    <HeroFactIcon Icon={TicketIcon} />
                    <span className="min-w-0">
                      <span className="block text-[0.9375rem] font-bold text-ink-inverse">
                        From {heroPrice.amount}
                      </span>
                      <span className="block text-sm text-ink-inverse-muted">{heroPrice.note}</span>
                    </span>
                  </li>
                ) : null}
              </ul>

              {ticketTypes.length > 0 ? (
                <a
                  href="#tickets"
                  className={`${INVERSE_TEXT_LINK} mt-6 inline-flex min-h-11 items-center gap-2 lg:hidden`}
                >
                  <TicketIcon className="h-4.5 w-4.5" />
                  Tickets and prices
                </a>
              ) : null}
            </FadeIn>
          </div>
        </div>

        <ScallopHem />
      </section>

      <div className="mx-auto max-w-content px-4 sm:px-6">
        {/*
          Straight after the hero and carrying its own words. A person who has
          just been sent this link by a friend finds out here that the show is
          off, rather than after scrolling past the poster to a greyed button.
        */}
        {notice ? (
          <Alert variant={notice.variant} title={notice.title} className="mt-8 rounded-card">
            <p>{notice.body}</p>
            {event.status === 'POSTPONED' && event.previousStartsAt ? (
              <p className="mt-1">
                It was going to be on{' '}
                <time dateTime={toDateTimeAttribute(event.previousStartsAt)}>
                  {formatEventDate(event.previousStartsAt, event.timezone)}
                </time>
                .
              </p>
            ) : null}
          </Alert>
        ) : null}

        <SampleDataNotice show={usedFallback} className="mt-8" />

        <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start lg:gap-16">
          <div className="min-w-0 space-y-14">
            <Reveal as="section" aria-labelledby="about-heading">
              <p className={EYEBROW}>
                <Diamond className="h-2.5 w-2.5 fill-accent" />
                About this night
              </p>
              <h2 id="about-heading" className="mt-3 text-h2 font-semibold text-ink">
                About this event
              </h2>
              <div className="mt-5 space-y-4 text-ink-muted">
                {paragraphs.map((paragraph, index) => (
                  <p
                    key={paragraph.slice(0, 48)}
                    className={index === 0 ? 'text-[1.1875rem] leading-8 text-ink' : 'text-body'}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>

              {event.languages?.length > 0 ? (
                <p className="mt-6 text-sm text-ink-muted">
                  <span className="font-bold text-ink">Languages: </span>
                  {event.languages.join(', ')}
                </p>
              ) : null}

              {/* Billing order, kept: for a lot of these events the order of the
                  names on the bill is the thing being negotiated. */}
              {artists.length > 0 ? (
                <div className="mt-6">
                  <h3 className="font-sans text-sm font-bold text-ink">Line-up</h3>
                  <ol className="mt-2.5 flex flex-wrap gap-2">
                    {artists.map((artist) => (
                      <li
                        key={artist}
                        className="rounded-full border border-line-strong bg-surface-raised px-3.5 py-1.5 text-sm font-semibold text-ink"
                      >
                        {artist}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </Reveal>

            <MirrorDivider />

            <Reveal as="section" aria-labelledby="schedule-heading">
              <h2 id="schedule-heading" className="text-h2 font-semibold text-ink">
                Schedule
              </h2>
              <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                <ScheduleFact Icon={ClockIcon} term="Doors / start">
                  <time dateTime={toDateTimeAttribute(event.startsAt)}>
                    {formatEventDate(event.startsAt, event.timezone)} ·{' '}
                    {formatEventTime(event.startsAt, event.timezone)}
                  </time>
                </ScheduleFact>
                <ScheduleFact Icon={ClockIcon} term="Ends">
                  <time dateTime={toDateTimeAttribute(event.endsAt)}>
                    {formatEventDate(event.endsAt, event.timezone)} ·{' '}
                    {formatEventTime(event.endsAt, event.timezone)}
                  </time>
                </ScheduleFact>
                <ScheduleFact Icon={PinIcon} term="Local time" wide>
                  All times are {zoneLabel ? `${zoneLabel} — ` : ''}the local time at the venue (
                  {event.timezone}), not your own.
                </ScheduleFact>
              </dl>
            </Reveal>

            <Reveal as="section" aria-labelledby="venue-heading">
              <h2 id="venue-heading" className="text-h2 font-semibold text-ink">
                Venue
              </h2>
              {event.venue ? (
                <div className="mt-5 grid grid-cols-1 overflow-hidden rounded-card bg-surface-raised shadow-card sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <div
                    aria-hidden="true"
                    className="hidden items-center justify-center bg-surface-subtle text-accent-strong sm:flex"
                  >
                    <PinIcon className="h-10 w-10" />
                  </div>
                  <div className="p-6">
                    <p className="text-micro font-bold tracking-eyebrow text-ink-subtle uppercase">
                      Venue
                    </p>
                    <p className="mt-1 font-display text-h3 font-semibold text-ink">
                      {/* Linked when there is a slug. Deriving one from the name
                          would produce a URL that looks right and 404s. */}
                      {event.venue.slug ? (
                        <Link href={`/venues/${event.venue.slug}`} className={TEXT_LINK}>
                          {event.venue.name}
                        </Link>
                      ) : (
                        event.venue.name
                      )}
                    </p>
                    <address className="mt-2 text-[0.9375rem] leading-6 text-ink-muted not-italic">
                      {address.map((line) => (
                        <span key={line} className="block">
                          {line}
                        </span>
                      ))}
                    </address>
                    {event.venue.capacity ? (
                      <p className="mt-3 text-sm text-ink-muted">
                        Capacity {event.venue.capacity.toLocaleString('en-US')}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-ink-muted">
                  The venue for this event has not been announced.
                </p>
              )}
            </Reveal>

            {/*
              Before you come: the two questions that decide whether somebody can
              come at all, answered together rather than buried in a description.
              Rendered as text per claim rather than as an icon row — an icon is
              unreadable to a screen reader without a label nobody writes.
            */}
            {access.features.length > 0 || access.notes.length > 0 || event.ageRestriction ? (
              <Reveal as="section" aria-labelledby="access-heading">
                <h2 id="access-heading" className="text-h2 font-semibold text-ink">
                  Access and admission
                </h2>

                {event.ageRestriction ? (
                  <p className="mt-4 text-ink-muted">
                    <span className="font-bold text-ink">Age {event.ageRestriction} and over.</span>{' '}
                    {policies.ageNote ??
                      'Bring photo identification — the door may ask for it, and a ticket is not a way in without it.'}
                  </p>
                ) : null}

                {access.features.length > 0 ? (
                  <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {access.features.map((code) => (
                      <li key={code} className="flex items-center gap-3 text-[0.9375rem] text-ink">
                        <span
                          aria-hidden="true"
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-secondary-soft text-accent-secondary"
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                        </span>
                        {accessibilityLabel(code)}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* Attributed, because "ring the bell at Gate 3" and "this
                    performance is captioned" answer different questions. */}
                {access.notes.map((note) => (
                  <p key={note.source} className="mt-4 text-sm text-ink-muted">
                    <span className="font-bold text-ink">{note.source}: </span>
                    {note.text}
                  </p>
                ))}

                {access.features.length === 0 && access.notes.length === 0 ? (
                  <p className="mt-4 text-sm text-ink-muted">
                    No accessibility information has been published for this event. Ask the
                    organiser before you buy rather than assuming either way.
                  </p>
                ) : null}
              </Reveal>
            ) : null}

            {event.organization ? (
              <Reveal as="section" aria-labelledby="organiser-heading">
                <h2 id="organiser-heading" className="text-h2 font-semibold text-ink">
                  Presented by
                </h2>
                <div className="mt-5 rounded-card bg-surface-raised p-6 shadow-card">
                  <p className="flex flex-wrap items-center gap-3">
                    {/*
                      Linked when there is a slug to link to, plain text when
                      there is not. Building the href from the name would
                      produce a URL that looks right and 404s.
                    */}
                    {event.organization.slug ? (
                      <Link
                        href={`/organizers/${event.organization.slug}`}
                        className={`${TEXT_LINK} font-display text-h3`}
                      >
                        {event.organization.name}
                      </Link>
                    ) : (
                      <span className="font-display text-h3 font-bold text-ink">
                        {event.organization.name}
                      </span>
                    )}
                    {event.organization.verified ? (
                      <Badge variant="secondary" srLabel="Organiser status:">
                        <VerifiedIcon className="h-4 w-4" />
                        Verified organiser
                      </Badge>
                    ) : null}
                  </p>
                  {event.organization.description ? (
                    <p className="mt-3 text-ink-muted">{event.organization.description}</p>
                  ) : null}
                </div>
              </Reveal>
            ) : null}

            {/*
              The refund rule first. It is the one a person needs when something
              has gone wrong, and burying it under entry conditions is how a
              policy block becomes decoration.
            */}
            {policies.refund || policies.entry || policies.conduct ? (
              <Reveal
                as="section"
                aria-labelledby="policies-heading"
                className="rounded-card bg-surface-subtle p-6 sm:p-8"
              >
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-surface-raised text-accent-strong"
                  >
                    <PolicyIcon className="h-5.5 w-5.5" />
                  </span>
                  <h2 id="policies-heading" className="text-h2 font-semibold text-ink">
                    Policies
                  </h2>
                </div>
                <dl className="mt-5 space-y-4">
                  {policies.refund ? (
                    <div>
                      <dt className="font-bold text-ink">Refunds</dt>
                      <dd className="mt-1 text-ink">{policies.refund}</dd>
                    </div>
                  ) : null}
                  {policies.entry ? (
                    <div>
                      <dt className="font-bold text-ink">Getting in</dt>
                      <dd className="mt-1 text-ink">{policies.entry}</dd>
                    </div>
                  ) : null}
                  {policies.conduct ? (
                    <div>
                      <dt className="font-bold text-ink">House rules</dt>
                      <dd className="mt-1 text-ink">{policies.conduct}</dd>
                    </div>
                  ) : null}
                </dl>
                <p className="mt-5 text-sm text-ink-muted">
                  These are the terms as they stand now. The set in force for an order is the set
                  copied onto it when it was placed, so a later edit cannot change what you agreed
                  to.
                </p>
              </Reveal>
            ) : null}
          </div>

          <aside
            id="tickets"
            aria-labelledby="tickets-heading"
            className="scroll-mt-28 lg:sticky lg:top-28"
          >
            <FadeIn
              delay={0.2}
              className="overflow-hidden rounded-card bg-surface-raised shadow-dialog"
            >
              <MirrorBand />
              <div className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="tickets-heading" className="text-h2 font-semibold text-ink">
                    Tickets
                  </h2>
                  {buyable ? (
                    <AvailabilityChip availability={{ tone: 'open', label: 'On sale' }} />
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-ink-subtle">
                  {formatEventWhen(event)}
                  {zoneLabel ? ` ${zoneLabel}` : ''}
                </p>

                {ticketTypes.length === 0 ? (
                  <p className="mt-5 text-ink-muted">
                    Tickets for this event are not on sale yet. Check back shortly.
                  </p>
                ) : (
                  <>
                    <div className="mt-5 border-t border-line pt-5">
                      <TicketTiers
                        ticketTypes={ticketTypes}
                        place={place}
                        feeTerms={event.feeTerms ?? null}
                      />
                    </div>

                    {cheapest ? (
                      <div className="mt-6 border-t-[1.5px] border-ink pt-5">
                        <p className="text-sm text-ink-muted">
                          From{' '}
                          <span className="font-display text-h3 font-bold text-ink">
                            {formatPrice(cheapest.priceCents, cheapest.currency)}
                          </span>
                        </p>

                        {/*
                          The all-in number, on the page, before the button. A face
                          value that becomes something else at the last step of
                          checkout is the practice this block exists to make
                          impossible to ship by accident.
                        */}
                        {allIn && allIn.allInCents !== cheapest.priceCents ? (
                          <p className="mt-1 text-sm text-ink-muted">
                            <span className="font-bold text-ink">
                              {formatPrice(allIn.allInCents, cheapest.currency)} all in
                            </span>{' '}
                            — includes {formatPrice(allIn.feesCents, cheapest.currency)} booking fee
                            {allIn.taxCents > 0
                              ? ` and ${formatPrice(allIn.taxCents, cheapest.currency)} ${allIn.taxLabel}`
                              : ''}
                            .
                          </p>
                        ) : null}

                        {buyable ? (
                          <Link
                            href={`/events/${event.slug}/checkout`}
                            className={`${PRIMARY_LINK} mt-5 w-full`}
                          >
                            Choose tickets
                            <ArrowRightIcon className="h-4.5 w-4.5" />
                          </Link>
                        ) : (
                          /*
                            No link rather than a disabled-looking one. A button that
                            is styled dead but still navigates is the worst of both,
                            and a `<button disabled>` is a control that announces
                            itself to a screen reader and then does nothing. The
                            sentence says why, which is the part a person needs.
                          */
                          <p className="mt-5 rounded-control border border-line-strong bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
                            {closedSentence}
                          </p>
                        )}
                      </div>
                    ) : soldOut ? (
                      <p className="mt-6 rounded-control border border-status-danger/25 bg-status-danger-soft p-4 text-sm text-status-danger">
                        Every tier has sold out. Tickets sometimes return when holds expire, so it
                        is worth looking again closer to the day.
                      </p>
                    ) : (
                      // Nothing to buy now, but not because it has gone: sales
                      // have not opened, have closed or are paused. The tiers
                      // above say which.
                      <p className="mt-6 rounded-control border border-line-strong bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
                        {closedSentence}
                      </p>
                    )}
                  </>
                )}

                <p className="mt-5 flex items-start gap-3 rounded-control bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
                  <ShieldIcon className="mt-0.5 h-4.5 w-4.5 text-accent-strong" />
                  <span>
                    <strong className="font-bold text-ink">
                      Payments on this site are simulated.
                    </strong>{' '}
                    You will not be asked for a card.
                  </span>
                </p>
              </div>
            </FadeIn>
          </aside>
        </div>
      </div>
    </article>
  )
}

/**
 * A fact's icon on the hero: a marigold line icon on a faint marigold tile.
 *
 * @param {object} props Component props.
 * @param {Function} props.Icon The icon component.
 * @returns {JSX.Element} The tile.
 */
function HeroFactIcon({ Icon }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-accent-inverse/12 text-accent-inverse"
    >
      <Icon className="h-5 w-5" />
    </span>
  )
}

/**
 * One fact in the schedule: an icon on a pink tile, the term, and the value.
 *
 * @param {object} props Component props.
 * @param {Function} props.Icon The icon component.
 * @param {string} props.term What the fact is.
 * @param {boolean} [props.wide] Spans both columns.
 * @param {ReactNode} props.children The value.
 * @returns {JSX.Element} The fact.
 */
function ScheduleFact({ Icon, term, wide = false, children }) {
  // The group a `<dl>` allows is one `<div>` holding the `<dt>` and `<dd>`
  // and nothing else, so the tile sits inside the term, positioned against the
  // group, rather than in a wrapper of its own — a wrapper made the list one
  // that assistive technology cannot read as terms and values.
  return (
    <div className={`relative min-h-11 min-w-0 pl-[3.625rem] ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-sm font-bold text-ink">
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 flex h-11 w-11 items-center justify-center rounded-control bg-accent-soft text-accent-strong"
        >
          <Icon className="h-5 w-5" />
        </span>
        {term}
      </dt>
      <dd className="mt-0.5 text-[0.9375rem] leading-6 text-ink-muted">{children}</dd>
    </div>
  )
}
