/**
 * The organiser's venues.
 *
 * Shows what this person may actually author, which is not the same as what
 * they can list an event at. A shared venue appears in event creation and not
 * here, because a hall a hundred organisers use is not one of them to edit —
 * and a list that mixed the two would teach people otherwise.
 *
 * @module app/organizer/venues/page
 */

import Link from 'next/link'

import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { Badge, Card, CardBody } from '../../../components/ui.jsx'
import { listVenues } from '../../../lib/organizer-api.js'
import { authoringOrganizations, readSession } from '../../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Your venues', robots: { index: false, follow: false } }

/**
 * The venue list.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrganizerVenuesPage() {
  const session = await readSession()
  const organizations = authoringOrganizations(session)

  let venues = []
  let failure = null

  try {
    // Every organisation this person may author in, then filtered to the ones
    // that are actually theirs. The API scopes this too; asking per
    // organisation is what keeps a shared venue out of an editing list.
    const lists = await Promise.all(
      organizations.map((organization) => listVenues(organization.organizationId)),
    )

    venues = lists.flat()
  } catch (error) {
    // No fallback: an organiser shown a list that is not their list would act
    // on it.
    failure = error
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-3xl font-bold text-ink">Your venues</h1>
        <Link
          href="/organizer/venues/new"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-action-primary px-5 text-sm font-medium text-action-primary-ink shadow-sm transition-colors hover:bg-action-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Add a venue
        </Link>
      </div>

      {failure ? <ReadRefusal error={failure} what="Your venues" action="see your venues" /> : null}

      {organizations.length === 0 ? (
        <p className="mt-6 text-ink-muted">
          You are not a member of an organisation that can manage venues. Ask an owner or admin to
          give you the event manager role.
        </p>
      ) : null}

      {!failure && organizations.length > 0 && venues.length === 0 ? (
        <p className="mt-6 text-ink-muted">
          You have no venues of your own yet. You can still list an event at a shared venue — adding
          one here is for a hall you run.
        </p>
      ) : null}

      {venues.length > 0 ? (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {venues.map((venue) => (
            <li key={venue.id}>
              <Card>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-display text-lg font-semibold text-ink">
                      <Link
                        href={`/organizer/venues/${venue.id}/maps`}
                        className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                      >
                        {venue.name}
                      </Link>
                    </h2>
                    {venue.shared ? (
                      <Badge variant="info" srLabel="Ownership:">
                        Shared
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {venue.city}
                    {venue.region ? `, ${venue.region}` : ''}
                  </p>
                  {venue.capacity ? (
                    <p className="mt-2 text-sm text-ink-muted">
                      Capacity {venue.capacity.toLocaleString('en-IN')}
                    </p>
                  ) : null}
                  <p className="mt-4 flex flex-wrap gap-3 text-sm">
                    <Link
                      href={`/organizer/venues/${venue.id}/maps`}
                      className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    >
                      Seating maps
                    </Link>
                    <Link
                      href={`/organizer/venues/${venue.id}/edit`}
                      className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    >
                      Edit details
                    </Link>
                  </p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
