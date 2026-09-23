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

import { Badge } from '../../../components/ui.jsx'
import { GarbaRings, MirrorBand } from '../../../components/festive-decor.jsx'
import { ArrowRightIcon, CheckIcon, ClockIcon, PinIcon } from '../../../components/icons.jsx'
import { Reveal } from '../../../components/motion.jsx'
import { NotFoundView } from '../../../components/not-found-view.jsx'
import { Breadcrumbs } from '../../../components/page-state.jsx'
import { PageHero } from '../../../components/page-hero.jsx'
import { SampleDataNotice } from '../../../components/sample-data-notice.jsx'
import { accessibilityLabel } from '../../../lib/accessibility.js'
import { loadVenueBySlug } from '../../../lib/api.js'
import { calendarLeaf } from '../../../lib/home-sections.js'
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

  const locality = [venue.city, venue.region].filter(Boolean).join(', ')

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(placeStructuredData(venue)) }}
      />

      <PageHero
        headingId="venue-heading"
        breadcrumbs={
          <Breadcrumbs
            tone="inverse"
            trail={[
              { href: '/', label: 'Home' },
              { href: '/venues', label: 'Venues' },
              { href: null, label: venue.name },
            ]}
          />
        }
        eyebrow="Venue"
        title={venue.name}
        lead={locality}
        art={<GarbaRings className="h-[28rem] w-[28rem]" />}
      >
        {venue.canonicalSlug ? (
          <p className="mt-6 rounded-card border border-status-warning/30 bg-status-warning-soft p-4 text-sm text-ink">
            This venue record was merged into another one.{' '}
            <Link
              href={`/venues/${venue.canonicalSlug}`}
              className="font-bold text-ink underline underline-offset-4"
            >
              See the current page
            </Link>
            . Your existing tickets are unaffected.
          </p>
        ) : null}
      </PageHero>

      <div className="mx-auto max-w-content px-4 sm:px-6">
        <SampleDataNotice show={usedFallback} className="mt-8" />

        <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
          <div className="min-w-0 space-y-14">
            {about.length > 0 ? (
              <section aria-labelledby="about-heading">
                <h2 id="about-heading" className="text-h2 font-semibold text-ink">
                  About
                </h2>
                <div className="mt-4 space-y-4 text-body text-ink-muted">
                  {about.map((paragraph) => (
                    <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ) : null}

            <Reveal as="section" aria-labelledby="access-heading">
              <h2 id="access-heading" className="text-h2 font-semibold text-ink">
                Accessibility
              </h2>
              {features.length === 0 && !note ? (
                <p className="mt-4 text-ink-muted">
                  This venue has not published its accessibility details, so this page cannot say
                  what access there is, and nothing here should be read as step-free. This site has
                  no way to ask the venue on your behalf.
                </p>
              ) : (
                <>
                  {features.length > 0 ? (
                    <ul className="mt-5 flex flex-wrap gap-2">
                      {features.map((code) => (
                        <li key={code}>
                          {/* Text, not an icon: a pictogram with no label is invisible
                              to a screen reader, and colour alone carries nothing. */}
                          <Badge variant="success" size="lg" srLabel="This venue has:">
                            <CheckIcon className="h-3.5 w-3.5" />
                            {accessibilityLabel(code)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {note ? <p className="mt-4 text-ink-muted">{note}</p> : null}
                </>
              )}
            </Reveal>

            <Reveal as="section" aria-labelledby="whats-on-heading">
              <h2 id="whats-on-heading" className="text-h2 font-semibold text-ink">
                What&rsquo;s on
              </h2>
              {venue.upcomingEvents.length === 0 ? (
                <p className="mt-4 text-ink-muted">No upcoming events are listed here.</p>
              ) : (
                <ul className="mt-5 overflow-hidden rounded-card bg-surface-raised shadow-card">
                  {venue.upcomingEvents.map((event) => {
                    const leaf = calendarLeaf({ ...event, timezone: venue.timezone })

                    return (
                      <li key={event.slug} className="border-b border-line last:border-b-0">
                        <Link
                          href={`/events/${event.slug}`}
                          className="group flex items-center gap-4 px-5 py-4 transition-colors duration-(--duration-fast) hover:bg-surface-subtle"
                        >
                          {leaf ? (
                            <span
                              aria-hidden="true"
                              className="flex h-14 w-13 shrink-0 flex-col items-center justify-center rounded-control bg-surface-subtle group-hover:bg-surface-raised"
                            >
                              <span className="text-[0.6875rem] font-bold tracking-eyebrow text-accent-strong uppercase">
                                {leaf.month}
                              </span>
                              <span className="font-display text-xl leading-6 font-bold text-ink">
                                {leaf.day}
                              </span>
                            </span>
                          ) : null}
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="font-bold text-ink group-hover:text-accent-strong">
                              {event.title}
                            </span>
                            <span className="text-sm text-ink-muted">
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
                          </span>
                          <ArrowRightIcon className="hidden h-5 w-5 text-accent-strong sm:block" />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Reveal>

            {policies.length > 0 ? (
              <Reveal
                as="section"
                aria-labelledby="rules-heading"
                className="rounded-card bg-surface-subtle p-6 sm:p-8"
              >
                <h2 id="rules-heading" className="text-h2 font-semibold text-ink">
                  House rules
                </h2>
                <div className="mt-4 space-y-4 text-ink">
                  {policies.map((paragraph) => (
                    <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                  ))}
                </div>
                <p className="mt-4 text-sm text-ink-muted">
                  The rules attached to your order when you paid are the ones that govern it. A
                  later edit here does not change what you agreed to.
                </p>
              </Reveal>
            ) : null}
          </div>

          <section aria-labelledby="where-heading" className="lg:sticky lg:top-28 lg:self-start">
            <section className="overflow-hidden rounded-card bg-surface-raised shadow-card">
              <MirrorBand />
              <div className="p-6">
                <h2 id="where-heading" className="text-h3 font-semibold text-ink">
                  Where it is
                </h2>
                <address className="mt-3 flex gap-3 text-ink-muted not-italic">
                  <PinIcon className="mt-1 h-5 w-5 text-accent-strong" />
                  <span>
                    {address.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </span>
                </address>
                <p className="mt-4 flex gap-3 text-sm text-ink-muted">
                  <ClockIcon className="mt-0.5 h-4.5 w-4.5 text-accent-strong" />
                  <span>
                    All times on this page are {venue.timezone} — the local time at the venue, not
                    yours.
                  </span>
                </p>
                {venue.capacity ? (
                  <p className="mt-3 text-sm text-ink-muted">
                    Capacity {venue.capacity.toLocaleString('en-US')}
                  </p>
                ) : null}

                {directions.length > 0 ? (
                  <div className="mt-5 border-t border-line pt-5">
                    <h3 className="font-sans text-sm font-bold text-ink">Getting in</h3>
                    <div className="mt-2 space-y-3 text-sm text-ink-muted">
                      {directions.map((paragraph) => (
                        <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </section>
        </div>
      </div>
    </article>
  )
}
