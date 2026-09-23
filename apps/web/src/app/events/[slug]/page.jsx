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
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { Alert, Badge, Card, CardBody } from '../../../components/ui.jsx'

import { accessibilityLabel, mergedAccessibility } from '../../../lib/accessibility.js'
import { loadEventBySlug } from '../../../lib/api.js'
import { categoryLabel } from '../../../lib/catalog.js'
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
import { formatPrice, priceSelection, taxLabelForPlace } from '../../../lib/pricing.js'
import { EventPoster } from '../../../components/poster.jsx'
import { NotFoundView } from '../../../components/not-found-view.jsx'
import { FadeIn, RevealOnScroll } from '../../../components/motion.jsx'
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

/**
 * The cheapest ticket still on sale, used for the "from" price.
 *
 * @param {object[]} ticketTypes Ticket tiers with availability folded in.
 * @returns {object|null} The cheapest available tier, or `null` when everything has gone.
 */
function cheapestAvailable(ticketTypes) {
  const available = ticketTypes.filter((tier) => !tier.isSoldOut)
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
 * @returns {{allInCents: number, feesCents: number, taxCents: number, taxLabel: string}|null} The breakdown, or null.
 */
function allInPrice(tier, venue) {
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
    currency: tier.currency ?? 'INR',
    place,
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
  const cheapest = cheapestAvailable(ticketTypes)
  const address = formatVenueAddress(event.venue)
  const zoneLabel = formatTimeZoneLabel(event)
  const paragraphs = toParagraphs(event.description)

  const notice = lifecycleNotice(event.status)
  const buyable = BUYABLE_STATUSES.has(event.status) && Boolean(cheapest)
  const allIn = allInPrice(cheapest, event.venue)
  const access = mergedAccessibility(event)
  const policies = event.policies ?? {}
  const artists = event.artists ?? []

  // Emitted only for an event a stranger may load at all. For a draft being
  // previewed by its own organiser there is nothing a search engine should be
  // told, and a `<script>` block is the one part of a page that a `noindex`
  // header does not stop a scraper reading.
  const structuredData = PUBLICLY_VISIBLE_STATUSES.has(event.status)
    ? eventJsonLd(event, { siteUrl })
    : null

  return (
    <article className="mx-auto max-w-6xl px-4 py-8">
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      ) : null}

      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/"
              className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href="/events"
              className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink-muted">
            {event.title}
          </li>
        </ol>
      </nav>

      <FadeIn className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand" size="lg">
            {categoryLabel(event.category)}
          </Badge>
          {event.venue?.city ? <Badge variant="info">{event.venue.city}</Badge> : null}
          {ticketTypes.length > 0 && !cheapest ? (
            <Badge variant="danger" srLabel="Availability:">
              Sold out
            </Badge>
          ) : null}
          {/* A number, not a colour: "18+" is the whole fact, and a red dot is not. */}
          {event.ageRestriction ? (
            <Badge variant="warning" srLabel="Age restriction:">
              {event.ageRestriction}+
            </Badge>
          ) : null}
        </div>

        <h1 className="mt-4 text-3xl leading-tight font-bold text-ink sm:text-4xl">
          {event.title}
        </h1>
        <p className="mt-3 max-w-3xl text-lg text-ink-muted">{event.summary}</p>
      </FadeIn>

      {/*
        Above the fold, before the poster, and carrying its own words. A person
        who has just been sent this link by a friend finds out here that the
        show is off, rather than after scrolling past a hero image to a greyed
        button.
      */}
      {notice ? (
        <Alert variant={notice.variant} title={notice.title} className="mt-6">
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

      <SampleDataNotice show={usedFallback} />

      <FadeIn delay={0.08} className="mt-8 overflow-hidden rounded-card">
        <EventPoster event={event} variant="hero" />
      </FadeIn>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1.7fr_1fr] lg:items-start">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-2xl font-bold text-ink">
              About this event
            </h2>
            <div className="mt-4 space-y-4 text-ink-muted">
              {paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 48)}>{paragraph}</p>
              ))}
            </div>

            {event.languages?.length > 0 ? (
              <p className="mt-5 text-sm text-ink-muted">
                <span className="font-medium text-ink">Languages: </span>
                {event.languages.join(', ')}
              </p>
            ) : null}

            {/* Billing order, kept: for a lot of these events the order of the
                names on the bill is the thing being negotiated. */}
            {artists.length > 0 ? (
              <div className="mt-5">
                <h3 className="text-sm font-medium text-ink">Line-up</h3>
                <ol className="mt-2 flex flex-wrap gap-2">
                  {artists.map((artist) => (
                    <li
                      key={artist}
                      className="rounded-full border border-line bg-surface-subtle px-3 py-1 text-sm text-ink-muted"
                    >
                      {artist}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>

          <RevealOnScroll as="section" aria-labelledby="schedule-heading">
            <h2 id="schedule-heading" className="text-2xl font-bold text-ink">
              Schedule
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-card border border-line bg-surface-raised p-4">
                <dt className="text-sm font-medium text-ink-muted">Doors / start</dt>
                <dd className="mt-1 text-ink">
                  <time dateTime={toDateTimeAttribute(event.startsAt)}>
                    {formatEventDate(event.startsAt, event.timezone)} ·{' '}
                    {formatEventTime(event.startsAt, event.timezone)}
                  </time>
                </dd>
              </div>
              <div className="rounded-card border border-line bg-surface-raised p-4">
                <dt className="text-sm font-medium text-ink-muted">Ends</dt>
                <dd className="mt-1 text-ink">
                  <time dateTime={toDateTimeAttribute(event.endsAt)}>
                    {formatEventDate(event.endsAt, event.timezone)} ·{' '}
                    {formatEventTime(event.endsAt, event.timezone)}
                  </time>
                </dd>
              </div>
              <div className="rounded-card border border-line bg-surface-raised p-4 sm:col-span-2">
                <dt className="text-sm font-medium text-ink-muted">Local time</dt>
                <dd className="mt-1 text-ink">
                  All times are {zoneLabel ? `${zoneLabel} — ` : ''}the local time at the venue (
                  {event.timezone}), not your own.
                </dd>
              </div>
            </dl>
          </RevealOnScroll>

          <RevealOnScroll as="section" aria-labelledby="venue-heading">
            <h2 id="venue-heading" className="text-2xl font-bold text-ink">
              Venue
            </h2>
            {event.venue ? (
              <Card className="mt-4">
                <CardBody>
                  <p className="font-display text-lg font-semibold text-ink">
                    {/* Linked when there is a slug. Deriving one from the name
                        would produce a URL that looks right and 404s. */}
                    {event.venue.slug ? (
                      <Link
                        href={`/venues/${event.venue.slug}`}
                        className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                      >
                        {event.venue.name}
                      </Link>
                    ) : (
                      event.venue.name
                    )}
                  </p>
                  <address className="mt-2 text-ink-muted not-italic">
                    {address.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </address>
                  {event.venue.capacity ? (
                    <p className="mt-3 text-sm text-ink-muted">
                      Capacity {event.venue.capacity.toLocaleString('en-IN')}
                    </p>
                  ) : null}
                </CardBody>
              </Card>
            ) : (
              <p className="mt-4 text-ink-muted">
                The venue for this event has not been announced.
              </p>
            )}
          </RevealOnScroll>

          {event.organization ? (
            <RevealOnScroll as="section" aria-labelledby="organiser-heading">
              <h2 id="organiser-heading" className="text-2xl font-bold text-ink">
                Presented by
              </h2>
              <Card className="mt-4">
                <CardBody>
                  <p className="flex flex-wrap items-center gap-2">
                    {/*
                      Linked when there is a slug to link to, plain text when
                      there is not. Building the href from the name would
                      produce a URL that looks right and 404s.
                    */}
                    {event.organization.slug ? (
                      <Link
                        href={`/organizers/${event.organization.slug}`}
                        className="rounded-sm font-display text-lg font-semibold text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        {event.organization.name}
                      </Link>
                    ) : (
                      <span className="font-display text-lg font-semibold text-ink">
                        {event.organization.name}
                      </span>
                    )}
                    {event.organization.verified ? (
                      <Badge variant="success" srLabel="Organiser status:">
                        Verified organiser
                      </Badge>
                    ) : null}
                  </p>
                  {event.organization.description ? (
                    <p className="mt-2 text-ink-muted">{event.organization.description}</p>
                  ) : null}
                </CardBody>
              </Card>
            </RevealOnScroll>
          ) : null}

          {/*
            Before you come: the two questions that decide whether somebody can
            come at all, answered together rather than buried in a description.
            Rendered as text per claim rather than as an icon row — an icon is
            unreadable to a screen reader without a label nobody writes.
          */}
          {access.features.length > 0 || access.notes.length > 0 || event.ageRestriction ? (
            <RevealOnScroll as="section" aria-labelledby="access-heading">
              <h2 id="access-heading" className="text-2xl font-bold text-ink">
                Access and admission
              </h2>

              {event.ageRestriction ? (
                <p className="mt-4 text-ink-muted">
                  <span className="font-medium text-ink">Age {event.ageRestriction} and over.</span>{' '}
                  {policies.ageNote ??
                    'Bring photo identification — the door may ask for it, and a ticket is not a way in without it.'}
                </p>
              ) : null}

              {access.features.length > 0 ? (
                <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {access.features.map((code) => (
                    <li
                      key={code}
                      className="rounded-card border border-line bg-surface-raised px-3 py-2 text-sm text-ink-muted"
                    >
                      {accessibilityLabel(code)}
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* Attributed, because "ring the bell at Gate 3" and "this
                  performance is captioned" answer different questions. */}
              {access.notes.map((note) => (
                <p key={note.source} className="mt-3 text-sm text-ink-muted">
                  <span className="font-medium text-ink">{note.source}: </span>
                  {note.text}
                </p>
              ))}

              {access.features.length === 0 && access.notes.length === 0 ? (
                <p className="mt-4 text-sm text-ink-muted">
                  No accessibility information has been published for this event. Ask the organiser
                  before you buy rather than assuming either way.
                </p>
              ) : null}
            </RevealOnScroll>
          ) : null}

          {/*
            The refund rule first. It is the one a person needs when something
            has gone wrong, and burying it under entry conditions is how a
            policy block becomes decoration.
          */}
          {policies.refund || policies.entry || policies.conduct ? (
            <RevealOnScroll as="section" aria-labelledby="policies-heading">
              <h2 id="policies-heading" className="text-2xl font-bold text-ink">
                Policies
              </h2>
              <dl className="mt-4 space-y-4">
                {policies.refund ? (
                  <div className="rounded-card border border-line bg-surface-raised p-4">
                    <dt className="font-medium text-ink">Refunds</dt>
                    <dd className="mt-1 text-ink-muted">{policies.refund}</dd>
                  </div>
                ) : null}
                {policies.entry ? (
                  <div className="rounded-card border border-line bg-surface-raised p-4">
                    <dt className="font-medium text-ink">Getting in</dt>
                    <dd className="mt-1 text-ink-muted">{policies.entry}</dd>
                  </div>
                ) : null}
                {policies.conduct ? (
                  <div className="rounded-card border border-line bg-surface-raised p-4">
                    <dt className="font-medium text-ink">House rules</dt>
                    <dd className="mt-1 text-ink-muted">{policies.conduct}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-3 text-sm text-ink-muted">
                These are the terms as they stand now. The set in force for an order is the set
                copied onto it when it was placed, so a later edit cannot change what you agreed to.
              </p>
            </RevealOnScroll>
          ) : null}
        </div>

        <aside aria-labelledby="tickets-heading" className="lg:sticky lg:top-24">
          <h2 id="tickets-heading" className="text-2xl font-bold text-ink">
            Tickets
          </h2>
          <p className="mt-2 text-sm text-ink-muted">{formatEventWhen(event)}</p>

          {ticketTypes.length === 0 ? (
            <p className="mt-4 text-ink-muted">
              Tickets for this event are not on sale yet. Check back shortly.
            </p>
          ) : (
            <>
              <div className="mt-4">
                <TicketTiers ticketTypes={ticketTypes} />
              </div>

              {cheapest ? (
                <div className="mt-5 rounded-card border border-accent-line bg-accent-soft p-4">
                  <p className="text-sm text-ink-muted">
                    From{' '}
                    <span className="font-display text-xl font-semibold text-ink">
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
                      <span className="font-medium text-ink">
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
                      className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-lg bg-action-primary px-6 text-base font-medium text-action-primary-ink shadow-sm transition-colors hover:bg-action-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
                    >
                      Choose tickets
                    </Link>
                  ) : (
                    /*
                      No link rather than a disabled-looking one. A button that
                      is styled dead but still navigates is the worst of both,
                      and a `<button disabled>` is a control that announces
                      itself to a screen reader and then does nothing. The
                      sentence says why, which is the part a person needs.
                    */
                    <p className="mt-3 rounded-lg border border-line-strong bg-surface-raised px-4 py-3 text-sm text-ink-muted">
                      {notice?.title
                        ? `${notice.title}. Tickets cannot be bought here at the moment.`
                        : 'Tickets are not on sale at the moment.'}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-5 rounded-card border border-status-danger/25 bg-status-danger-soft p-4 text-sm text-status-danger">
                  Every tier has sold out. Tickets sometimes return when holds expire, so it is
                  worth looking again closer to the day.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </article>
  )
}
