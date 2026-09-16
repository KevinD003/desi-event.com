/**
 * A venue's public page: where it is, how to get in, and what is on there.
 *
 * The part that earns its place is the accessibility block. Fifteen structured
 * claims, each checkable, rather than one paragraph somebody has to read
 * hoping the answer is in it — because "is there step-free access" is a
 * yes-or-no question that decides whether a person can come at all, and a
 * description is not a way to ask it.
 *
 * The claims are rendered as a list with visible text per item rather than as
 * icons: an icon row is unreadable to a screen reader without labels nobody
 * writes, and colour-only status is unreadable to anybody. The free-text note
 * sits underneath, because "the accessible entrance is Gate 3, ring the bell,
 * staff take five minutes" is the sentence that actually makes a venue usable
 * and no vocabulary will ever hold it.
 *
 * A merged venue resolves rather than 404ing. Links, printed tickets and QR
 * codes made before a merge all point at the old slug, and answering 404 to
 * every one of them to tidy a duplicate is not a tidy-up — so the old URL
 * renders the surviving record and points its canonical at the real one.
 *
 * @module app/venues/slug/page
 */

import Link from 'next/link'

import { Badge, Card, CardBody } from '../../../components/ui.jsx'
import { FadeIn, RevealOnScroll } from '../../../components/motion.jsx'
import { NotFoundView } from '../../../components/not-found-view.jsx'
import { SampleDataNotice } from '../../../components/sample-data-notice.jsx'
import { accessibilityLabel } from '../../../lib/accessibility.js'
import { loadVenueBySlug } from '../../../lib/api.js'
import {
  formatEventDate,
  formatEventTime,
  formatVenueAddress,
  toDateTimeAttribute,
  toParagraphs,
} from '../../../lib/format.js'

export const dynamic = 'force-dynamic'

/**
 * Per-venue metadata.
 *
 * A merged venue points its canonical at the record that survived, which is
 * what stops two URLs competing for the same place in a search index.
 *
 * @param {object} props Route props.
 * @param {Promise<{slug: string}>} props.params The resolved route parameters.
 * @returns {Promise<object>} A Next.js metadata object.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params
  const { venue } = await loadVenueBySlug(slug)

  if (!venue) {
    return { title: 'Venue not found', robots: { index: false, follow: false } }
  }

  const description =
    venue.description ?? `${venue.name} in ${venue.city} — events and tickets on Desi-Event.`
  const canonical = `/venues/${venue.canonicalSlug ?? venue.slug}`

  return {
    title: `${venue.name}, ${venue.city}`,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', title: venue.name, description, url: canonical },
    twitter: { card: 'summary', title: venue.name, description },
  }
}

/**
 * Structured data describing the place.
 *
 * schema.org `Place` rather than `EventVenue`, which is not a type: a venue is
 * a place, and the events that happen there carry their own markup on their own
 * pages. Only asserts what the record actually holds — a missing postcode is
 * omitted rather than sent as an empty string.
 *
 * @param {object} venue The venue.
 * @returns {object} A JSON-LD object.
 */
function placeStructuredData(venue) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: venue.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: [venue.addressLine1, venue.addressLine2].filter(Boolean).join(', '),
      addressLocality: venue.city,
      addressRegion: venue.region,
      postalCode: venue.postalCode,
      addressCountry: venue.country,
    },
  }

  if (venue.latitude != null && venue.longitude != null) {
    data.geo = { '@type': 'GeoCoordinates', latitude: venue.latitude, longitude: venue.longitude }
  }

  if (venue.capacity != null) data.maximumAttendeeCapacity = venue.capacity

  const features = venue.accessibility?.features ?? []

  if (features.length > 0) {
    // The vocabulary is ours, so it is published as a human-readable summary
    // rather than as codes a consumer would have to guess the meaning of.
    data.accessibilityFeature = features.map((code) => accessibilityLabel(code))
  }

  return data
}

/**
 * @typedef {object} VenuePageProps
 * @property {Promise<{slug: string}>} params The resolved route parameters.
 */

/**
 * The public venue page.
 *
 * @param {VenuePageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function VenuePage({ params }) {
  const { slug } = await params
  const { venue, usedFallback } = await loadVenueBySlug(slug)

  // Next.js 16.3.5 answers `notFound()` with a document that has no body until
  // the browser hydrates, so a missing venue renders the shared view here.
  if (!venue) return <NotFoundView />

  const address = formatVenueAddress(venue)
  const features = venue.accessibility?.features ?? []
  const note = venue.accessibility?.note ?? null
  const directions = toParagraphs(venue.directions ?? '')
  const policies = toParagraphs(venue.policies ?? '')
  const about = toParagraphs(venue.description ?? '')

  return (
    <article className="mx-auto max-w-4xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(placeStructuredData(venue)) }}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/"
              className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
            >
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href="/events"
              className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
            >
              Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-slate-600">
            {venue.name}
          </li>
        </ol>
      </nav>

      <FadeIn className="mt-6">
        <h1 className="text-3xl leading-tight font-bold text-indigo-night-900 sm:text-4xl">
          {venue.name}
        </h1>
        <p className="mt-2 text-lg text-slate-700">
          {venue.city}
          {venue.region ? `, ${venue.region}` : ''}
        </p>

        {venue.canonicalSlug ? (
          <p className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This venue record was merged into another one.{' '}
            <Link href={`/venues/${venue.canonicalSlug}`} className="font-medium underline">
              See the current page
            </Link>
            . Your existing tickets are unaffected.
          </p>
        ) : null}
      </FadeIn>

      <SampleDataNotice show={usedFallback} />

      <div className="mt-10 space-y-10">
        {about.length > 0 ? (
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-2xl font-bold text-indigo-night-900">
              About
            </h2>
            <div className="mt-4 space-y-4 text-slate-700">
              {about.map((paragraph) => (
                <p key={paragraph.slice(0, 48)}>{paragraph}</p>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="where-heading">
          <h2 id="where-heading" className="text-2xl font-bold text-indigo-night-900">
            Where it is
          </h2>
          <Card className="mt-4">
            <CardBody>
              <address className="text-slate-700 not-italic">
                {address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
              <p className="mt-4 text-sm text-slate-600">
                All times on this page are {venue.timezone} — the local time at the venue, not
                yours.
              </p>
              {venue.capacity ? (
                <p className="mt-2 text-sm text-slate-600">
                  Capacity {venue.capacity.toLocaleString('en-IN')}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {directions.length > 0 ? (
            <div className="mt-4">
              <h3 className="font-display text-lg font-semibold text-indigo-night-900">
                Getting in
              </h3>
              <div className="mt-2 space-y-3 text-slate-700">
                {directions.map((paragraph) => (
                  <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <RevealOnScroll as="section" aria-labelledby="access-heading">
          <h2 id="access-heading" className="text-2xl font-bold text-indigo-night-900">
            Accessibility
          </h2>
          {features.length === 0 && !note ? (
            <p className="mt-4 text-slate-700">
              This venue has not published its accessibility details. Ask Desi-Event support before
              booking and we will find out for you rather than guess.
            </p>
          ) : (
            <>
              {features.length > 0 ? (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {features.map((code) => (
                    <li key={code}>
                      {/* Text, not an icon: a pictogram with no label is invisible
                          to a screen reader, and colour alone carries nothing. */}
                      <Badge variant="success" srLabel="This venue has:">
                        {accessibilityLabel(code)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
              {note ? <p className="mt-4 text-slate-700">{note}</p> : null}
            </>
          )}
        </RevealOnScroll>

        <RevealOnScroll as="section" aria-labelledby="whats-on-heading">
          <h2 id="whats-on-heading" className="text-2xl font-bold text-indigo-night-900">
            What&rsquo;s on
          </h2>
          {venue.upcomingEvents.length === 0 ? (
            <p className="mt-4 text-slate-700">Nothing is on sale here at the moment.</p>
          ) : (
            <ul className="mt-2">
              {venue.upcomingEvents.map((event) => (
                <li key={event.slug} className="border-b border-slate-200 last:border-b-0">
                  <Link
                    href={`/events/${event.slug}`}
                    className="flex flex-col gap-1 rounded-sm py-4 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                  >
                    <span className="font-medium text-indigo-night-900">{event.title}</span>
                    <span className="text-sm text-slate-600">
                      <time
                        className="whitespace-nowrap"
                        dateTime={toDateTimeAttribute(event.startsAt)}
                      >
                        {formatEventDate(event.startsAt, venue.timezone)} ·{' '}
                        {formatEventTime(event.startsAt, venue.timezone)}
                      </time>
                      {event.organizerName ? (
                        <span className="block sm:inline">
                          <span className="hidden sm:inline"> · </span>
                          {event.organizerName}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </RevealOnScroll>

        {policies.length > 0 ? (
          <RevealOnScroll as="section" aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="text-2xl font-bold text-indigo-night-900">
              House rules
            </h2>
            <Card className="mt-4">
              <CardBody>
                <div className="space-y-4 text-slate-700">
                  {policies.map((paragraph) => (
                    <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                  ))}
                </div>
                <p className="mt-4 text-sm text-slate-600">
                  The rules attached to your order when you paid are the ones that govern it. A
                  later edit here does not change what you agreed to.
                </p>
              </CardBody>
            </Card>
          </RevealOnScroll>
        ) : null}
      </div>
    </article>
  )
}
