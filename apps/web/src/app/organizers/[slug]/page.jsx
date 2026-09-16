/**
 * An organiser's public page: who they are, what they have coming up, what they
 * have run before, and what happens if you need your money back.
 *
 * Three things about it are deliberate.
 *
 * **The badge is never decorative.** It renders only when the API says
 * `verified`, and the API derives that from the verification state rather than
 * from a denormalised column. There is no local fallback, no "probably", and no
 * styling that implies endorsement for an organiser who has not been through
 * the process. An unearned badge on a ticketing site is a lie that costs
 * somebody money.
 *
 * **It works with no JavaScript.** Everything here is server-rendered, the
 * links are links, and nothing needs hydration to become readable. That is not
 * a nicety: this page is what somebody checks from a bus on a bad connection
 * before spending two thousand rupees.
 *
 * **A suspended organiser is not found.** The API answers 404 rather than 403,
 * and this page renders the same not-found view a missing slug does, in the
 * same words. The page cannot be used to work out which of the two a URL is.
 *
 * @module app/organizers/slug/page
 */

import Link from 'next/link'

import { Badge, Card, CardBody } from '../../../components/ui.jsx'
import { FadeIn, RevealOnScroll } from '../../../components/motion.jsx'
import { NotFoundView } from '../../../components/not-found-view.jsx'
import { SampleDataNotice } from '../../../components/sample-data-notice.jsx'
import { loadOrganizerBySlug } from '../../../lib/api.js'
import {
  formatEventDate,
  formatEventTime,
  toDateTimeAttribute,
  toParagraphs,
} from '../../../lib/format.js'

export const dynamic = 'force-dynamic'

/**
 * Per-organiser metadata for search engines and link previews.
 *
 * A missing or suspended organiser gets `noindex, nofollow`: there is nothing
 * at the URL to index, and an indexed page for a suspended organiser would
 * outlive the suspension in somebody's search results.
 *
 * @param {object} props Route props.
 * @param {Promise<{slug: string}>} props.params The resolved route parameters.
 * @returns {Promise<object>} A Next.js metadata object.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params
  const { organizer } = await loadOrganizerBySlug(slug)

  if (!organizer) {
    return { title: 'Organiser not found', robots: { index: false, follow: false } }
  }

  const description =
    organizer.description ?? `Events presented by ${organizer.name}, with tickets on Desi-Event.`

  return {
    title: organizer.name,
    description,
    alternates: { canonical: `/organizers/${organizer.slug}` },
    openGraph: {
      type: 'profile',
      title: organizer.name,
      description,
      url: `/organizers/${organizer.slug}`,
    },
    twitter: { card: 'summary', title: organizer.name, description },
  }
}

/**
 * One row in an event list.
 *
 * A link and a time, and the time carries a machine-readable `dateTime` so the
 * page is legible to something that is not a person.
 *
 * @param {object} props Component props.
 * @param {object} props.event The listing entry.
 * @param {string} props.timezone The organiser's IANA zone.
 * @returns {JSX.Element} The rendered row.
 */
function EventRow({ event, timezone }) {
  return (
    <li className="border-b border-slate-200 last:border-b-0">
      <Link
        href={`/events/${event.slug}`}
        className="flex flex-col gap-1 rounded-sm py-4 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
      >
        <span className="font-medium text-indigo-night-900 underline-offset-4 group-hover:underline">
          {event.title}
        </span>
        {/*
          The date is held together as one unbreakable run and the venue is a
          separate segment that may wrap, because at 360px "Monday, 1 November
          2026 · 8:00 pm · Nehru Centre Auditorium" as a single nowrap string is
          398px of content in a 328px column — which is a page that scrolls
          sideways on the phone most of its visitors are holding.
        */}
        <span className="text-sm text-slate-600">
          <time className="whitespace-nowrap" dateTime={toDateTimeAttribute(event.startsAt)}>
            {formatEventDate(event.startsAt, timezone)} ·{' '}
            {formatEventTime(event.startsAt, timezone)}
          </time>
          {event.venueName ? (
            <span className="block sm:inline">
              <span className="hidden sm:inline"> · </span>
              {event.venueName}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  )
}

/**
 * A titled list of events, or a sentence saying there are none.
 *
 * @param {object} props Component props.
 * @param {string} props.id The heading id, for `aria-labelledby`.
 * @param {string} props.title The section heading.
 * @param {object[]} props.events The listing entries.
 * @param {string} props.empty What to say when the list is empty.
 * @param {string} props.timezone The organiser's IANA zone.
 * @returns {JSX.Element} The rendered section.
 */
function EventSection({ id, title, events, empty, timezone }) {
  return (
    <RevealOnScroll as="section" aria-labelledby={id}>
      <h2 id={id} className="text-2xl font-bold text-indigo-night-900">
        {title}
      </h2>
      {events.length === 0 ? (
        <p className="mt-4 text-slate-700">{empty}</p>
      ) : (
        <ul className="mt-2">
          {events.map((event) => (
            <EventRow key={event.slug} event={event} timezone={timezone} />
          ))}
        </ul>
      )}
    </RevealOnScroll>
  )
}

/**
 * @typedef {object} OrganizerPageProps
 * @property {Promise<{slug: string}>} params The resolved route parameters.
 */

/**
 * The public organiser page.
 *
 * @param {OrganizerPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrganizerPage({ params }) {
  const { slug } = await params
  const { organizer, usedFallback } = await loadOrganizerBySlug(slug)

  // Next.js 16.3.5 answers `notFound()` with a document that has no body until
  // the browser hydrates, so a missing organiser renders the shared not-found
  // view here instead. See components/not-found-view.jsx.
  if (!organizer) return <NotFoundView />

  const about = toParagraphs(organizer.description ?? '')
  const policy = toParagraphs(organizer.refundPolicy ?? '')

  return (
    <article className="mx-auto max-w-4xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/"
              className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500"
            >
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href="/events"
              className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500"
            >
              Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-slate-600">
            {organizer.name}
          </li>
        </ol>
      </nav>

      <FadeIn className="mt-6">
        <h1 className="text-3xl leading-tight font-bold text-indigo-night-900 sm:text-4xl">
          {organizer.name}
        </h1>

        {/*
          Rendered only when the organiser has actually been verified. There is
          no "pending" badge and no greyed-out one: a badge that appears in more
          than one state is a badge people learn to read as decoration.
        */}
        {organizer.verified ? (
          <p className="mt-3">
            <Badge variant="success" size="lg" srLabel="Organiser status:">
              Verified organiser
            </Badge>
          </p>
        ) : null}

        {organizer.websiteUrl ? (
          <p className="mt-3 text-slate-700">
            <a
              href={organizer.websiteUrl}
              rel="nofollow noopener noreferrer external"
              className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500"
            >
              {organizer.websiteUrl.replace(/^https?:\/\//, '')}
            </a>
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

        <EventSection
          id="upcoming-heading"
          title="Upcoming events"
          events={organizer.upcomingEvents}
          empty={`${organizer.name} has nothing on sale at the moment.`}
          timezone={organizer.timezone}
        />

        <EventSection
          id="past-heading"
          title="Previously"
          events={organizer.pastEvents}
          empty={`Nothing from ${organizer.name} has run on Desi-Event yet.`}
          timezone={organizer.timezone}
        />

        <RevealOnScroll as="section" aria-labelledby="policy-heading">
          <h2 id="policy-heading" className="text-2xl font-bold text-indigo-night-900">
            Refunds
          </h2>
          <Card className="mt-4">
            <CardBody>
              {policy.length > 0 ? (
                <div className="space-y-4 text-slate-700">
                  {policy.map((paragraph) => (
                    <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                  ))}
                </div>
              ) : (
                <p className="text-slate-700">
                  {organizer.name} has not published a refund policy. The terms shown at checkout
                  are the ones that apply to your order.
                </p>
              )}
              <p className="mt-4 text-sm text-slate-600">
                Whatever an organiser publishes here, the policy attached to your order at the
                moment you paid is the one that governs it. A later edit does not change what you
                agreed to.
              </p>
            </CardBody>
          </Card>
        </RevealOnScroll>

        <section aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="text-2xl font-bold text-indigo-night-900">
            Contact
          </h2>
          {/*
            No email address, by design. The organisation's contact address is
            an account detail, not a box office, and publishing it here would
            both expose it to scrapers and route order questions somewhere with
            no record of the order. Support reaches the organiser on the buyer's
            behalf instead.
          */}
          <p className="mt-4 text-slate-700">
            Questions about an order go through Desi-Event support, using the reply address on your
            confirmation email. Support puts you in touch with {organizer.name} and keeps the thread
            attached to your booking.
          </p>
        </section>
      </div>
    </article>
  )
}
