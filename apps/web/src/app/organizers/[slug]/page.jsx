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
 * before spending a hundred dollars.
 *
 * **A suspended organiser is not found.** The API answers 404 rather than 403,
 * and this page renders the same not-found view a missing slug does, in the
 * same words. The page cannot be used to work out which of the two a URL is.
 *
 * @module app/organizers/slug/page
 */

import Link from 'next/link'

import { GarbaRings } from '../../../components/festive-decor.jsx'
import { ArrowRightIcon, PolicyIcon, VerifiedIcon } from '../../../components/icons.jsx'
import { INVERSE_TEXT_LINK } from '../../../components/link-classes.js'
import { FadeIn, Reveal } from '../../../components/motion.jsx'
import { NotFoundView } from '../../../components/not-found-view.jsx'
import { Breadcrumbs } from '../../../components/page-state.jsx'
import { PageHero } from '../../../components/page-hero.jsx'
import { SampleDataNotice } from '../../../components/sample-data-notice.jsx'
import { loadOrganizerBySlug } from '../../../lib/api.js'
import { calendarLeaf } from '../../../lib/home-sections.js'
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
  const leaf = calendarLeaf({ ...event, timezone })

  return (
    <li className="border-b border-line last:border-b-0">
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
            <span className="font-display text-xl leading-6 font-bold text-ink">{leaf.day}</span>
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-bold text-ink underline-offset-4 group-hover:text-accent-strong">
            {event.title}
          </span>
          {/*
            The date is held together as one unbreakable run and the venue is a
            separate segment that may wrap, because at 360px a long date, time
            and venue as a single nowrap string is wider than the column — which
            is a page that scrolls sideways on the phone most of its visitors
            are holding.
          */}
          <span className="text-sm text-ink-muted">
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
        </span>
        <ArrowRightIcon className="hidden h-5 w-5 text-accent-strong sm:block" />
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
    <Reveal as="section" aria-labelledby={id}>
      <h2 id={id} className="text-h2 font-semibold text-ink">
        {title}
      </h2>
      {events.length === 0 ? (
        <p className="mt-4 text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-5 overflow-hidden rounded-card bg-surface-raised shadow-card">
          {events.map((event) => (
            <EventRow key={event.slug} event={event} timezone={timezone} />
          ))}
        </ul>
      )}
    </Reveal>
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
    <article>
      <PageHero
        headingId="organiser-heading"
        breadcrumbs={
          <Breadcrumbs
            tone="inverse"
            trail={[
              { href: '/', label: 'Home' },
              { href: '/organizers', label: 'Organisers' },
              { href: null, label: organizer.name },
            ]}
          />
        }
        eyebrow="Organiser"
        title={organizer.name}
        art={<GarbaRings className="h-[28rem] w-[28rem]" />}
      >
        {/*
          Rendered only when the organiser has actually been verified. There is
          no "pending" badge and no greyed-out one: a badge that appears in more
          than one state is a badge people learn to read as decoration.
        */}
        {organizer.verified || organizer.websiteUrl ? (
          <FadeIn delay={0.08}>
            <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
              {organizer.verified ? (
                <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-ink-inverse/25 bg-ink-inverse/10 pr-3.5 pl-2 text-sm font-bold text-ink-inverse">
                  <VerifiedIcon className="h-4.5 w-4.5 text-accent-inverse" />
                  <span className="sr-only">Organiser status: </span>
                  Verified organiser
                </span>
              ) : null}
              {organizer.websiteUrl ? (
                <a
                  href={organizer.websiteUrl}
                  rel="nofollow noopener noreferrer external"
                  className={`${INVERSE_TEXT_LINK} inline-flex min-h-11 items-center`}
                >
                  {organizer.websiteUrl.replace(/^https?:\/\//, '')}
                </a>
              ) : null}
            </p>
          </FadeIn>
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

            <EventSection
              id="upcoming-heading"
              title="Upcoming events"
              events={organizer.upcomingEvents}
              empty={`${organizer.name} has no upcoming events listed.`}
              timezone={organizer.timezone}
            />

            <EventSection
              id="past-heading"
              title="Previously"
              events={organizer.pastEvents}
              empty={`Nothing from ${organizer.name} has run on Desi-Event.`}
              timezone={organizer.timezone}
            />
          </div>

          <div className="space-y-8 lg:sticky lg:top-28 lg:self-start">
            <Reveal
              as="section"
              aria-labelledby="policy-heading"
              className="rounded-card bg-surface-subtle p-6"
            >
              <h2
                id="policy-heading"
                className="flex items-center gap-3 text-h3 font-semibold text-ink"
              >
                <PolicyIcon className="h-5.5 w-5.5 text-accent-strong" />
                Refunds
              </h2>
              {policy.length > 0 ? (
                <div className="mt-3 space-y-3 text-ink">
                  {policy.map((paragraph) => (
                    <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-ink">{organizer.name} has not published a refund policy.</p>
              )}
              <p className="mt-4 text-sm text-ink-muted">
                This is the policy as it reads now. This site does not keep a copy of it as it stood
                when you bought, so if the terms matter to you, read them before you buy.
              </p>
            </Reveal>

            <section
              aria-labelledby="contact-heading"
              className="rounded-card bg-surface-raised p-6 shadow-card"
            >
              <h2 id="contact-heading" className="text-h3 font-semibold text-ink">
                Contact
              </h2>
              {/*
                No email address, by design. The organisation's contact address is
                an account detail, not a box office, and publishing it here would
                expose it to scrapers. This used to promise a support desk and a
                confirmation email to reply to; this build has neither, so it says
                what there is.
              */}
              <p className="mt-3 text-sm text-ink-muted">
                This site does not pass messages between buyers and organisers, and sends no email.{' '}
                {organizer.websiteUrl
                  ? `${organizer.name}'s own website, linked above, is the way to reach them.`
                  : `${organizer.name} has not given a website, so this page has no way to reach them.`}
              </p>
            </section>
          </div>
        </div>
      </div>
    </article>
  )
}
