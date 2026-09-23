/**
 * The organiser directory: who has upcoming events listed on Desi-Event.
 *
 * There is no list endpoint for organisers, and this page does not pretend
 * there is. It is derived the way the sitemap derives its organiser URLs: from
 * the public event listing, read a page at a time and collected into distinct
 * organisers with how many listed events each has (`deriveOrganizers` in
 * `lib/directory.js`). The listing is read from now on — every listed status,
 * events that have not started yet — because that is what the organiser's own
 * page lists as "Upcoming events", so the count on a card is the count behind
 * the link. That makes the framing exact rather than approximate: these are
 * the organisers with upcoming events listed, not every organiser the
 * platform has ever onboarded, and the page says so in those words.
 *
 * The walk is bounded to five pages of a hundred events. When it stops before
 * the end of the listing, the page says how many events it was built from
 * instead of implying the list is complete.
 *
 * No verified badge. The event listing does not carry verification, and a badge
 * inferred from anything else is an endorsement nobody made; the organiser's
 * own page shows the badge when the API says it has been earned.
 *
 * When the API cannot be reached, the listing comes from the sample catalogue
 * and the page says so. The links still lead somewhere: `loadOrganizerBySlug`
 * falls back to the same catalogue, so a sample organiser's page resolves.
 *
 * @module app/organizers/page
 */

import Link from 'next/link'

import { Empty } from '../../components/page-state.jsx'
import { RevealOnScroll } from '../../components/motion.jsx'
import { SampleDataNotice } from '../../components/sample-data-notice.jsx'
import { deriveOrganizers, organizerCountLabel } from '../../lib/directory.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Organisers',
  description:
    'The collectives, trusts and promoters with upcoming events listed on Desi-Event — open one to see everything they have on.',
}

/**
 * Say how much of the listing the directory was built from, when not all of it.
 *
 * @param {object} directory The directory `deriveOrganizers` returned.
 * @returns {string|null} A sentence, or `null` when the whole listing was read.
 */
function coverageSentence(directory) {
  if (!directory.truncated) return null

  const read = directory.eventsRead.toLocaleString('en-IN')
  const of =
    directory.totalListed !== null && directory.totalListed > directory.eventsRead
      ? ` of ${directory.totalListed.toLocaleString('en-IN')}`
      : ''
  // "the first 1 of 250 upcoming events": the noun agrees with the total when there is one.
  const noun = directory.eventsRead === 1 && of === '' ? 'event' : 'events'

  if (directory.interrupted) {
    return `Showing organisers from the first ${read}${of} upcoming ${noun}: the rest of the listing could not be read just now.`
  }

  return `Showing organisers from the first ${read}${of} upcoming ${noun}.`
}

/**
 * The organiser directory.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrganizersPage() {
  const directory = await deriveOrganizers()
  const coverage = coverageSentence(directory)

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold text-ink sm:text-4xl">Organisers</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        These are the organisers with upcoming events listed on Desi-Event, and how many each has
        coming up. Open one to see what they have on and their refund policy.
      </p>

      <SampleDataNotice show={directory.usedFallback} />

      {coverage ? (
        <p data-testid="organizer-coverage" className="mt-6 text-sm font-medium text-ink-muted">
          {coverage}
        </p>
      ) : null}

      {directory.organizers.length === 0 ? (
        <Empty
          title="No organisers have upcoming events listed"
          description="An organiser appears here while at least one of their upcoming events is listed."
        />
      ) : (
        <ul
          aria-label="Organisers"
          className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {directory.organizers.map((organizer, index) => (
            <RevealOnScroll
              as="li"
              key={organizer.slug}
              index={Math.min(index, 8)}
              className="flex flex-col rounded-card border border-line bg-surface-raised p-5"
            >
              <h2 className="font-display text-lg font-semibold text-ink">
                <Link
                  href={`/organizers/${encodeURIComponent(organizer.slug)}`}
                  className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
                >
                  {organizer.name}
                </Link>
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {organizerCountLabel(organizer.eventCount)}
              </p>
            </RevealOnScroll>
          ))}
        </ul>
      )}
    </div>
  )
}
