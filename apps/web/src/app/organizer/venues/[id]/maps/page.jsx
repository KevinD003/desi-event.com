/**
 * A venue's seating maps and their version history.
 *
 * The history is the point of this screen. A published version is a permanent
 * record of what somebody bought a seat on, so the list never prunes and never
 * reorders into "current and old" — it shows every version with its state, and
 * the states are what tell an organiser what they may do:
 *
 *   - **Draft** — editable.
 *   - **Published** — frozen. The action is "start a new version from this",
 *     not "edit".
 *   - **In use** — a session is selling against it. Frozen for a second,
 *     stronger reason, and the screen says which.
 *
 * @module app/organizer/venues/id/maps/page
 */

import Link from 'next/link'

import { Alert, Badge, Card, CardBody } from '../../../../../components/ui.jsx'
import { CreateMapForm } from '../../../../../components/create-map-form.jsx'
import { CloneVersionButton } from '../../../../../components/clone-version-button.jsx'
import { getVenue, listMaps } from '../../../../../lib/organizer-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Seating maps', robots: { index: false, follow: false } }

/**
 * Format a version's state as a badge and a sentence.
 *
 * @param {object} version The version.
 * @returns {{variant: string, label: string, note: string}} How to show it.
 */
export function versionState(version) {
  if (version.inUse) {
    return {
      variant: 'warning',
      label: 'In use',
      note: 'A session is selling against this layout, so it cannot change.',
    }
  }

  if (version.publishedAt) {
    return {
      variant: 'success',
      label: 'Published',
      note: 'Frozen. Start a new version from it to make changes.',
    }
  }

  return { variant: 'neutral', label: 'Draft', note: 'Editable. Not yet sellable.' }
}

/**
 * The map list.
 *
 * @param {object} props Route props.
 * @param {Promise<{id: string}>} props.params The route parameters.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function VenueMapsPage({ params }) {
  const { id } = await params

  let venue = null
  let maps = []
  let failure = null

  try {
    ;[venue, maps] = await Promise.all([getVenue(id), listMaps(id)])
  } catch (error) {
    failure = error
  }

  if (failure) {
    return (
      <Alert variant="danger" title="Could not load this venue">
        {failure.status === 403
          ? 'This venue belongs to another organisation, or is shared between all of them. You can list an event here without being able to change its layout.'
          : failure.message}
      </Alert>
    )
  }

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link
          href="/organizer/venues"
          className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
        >
          Your venues
        </Link>
      </nav>

      <h1 className="mt-4 text-3xl font-bold text-indigo-night-900">Seating maps — {venue.name}</h1>
      <p className="mt-2 text-slate-700">
        A map is one way of laying the hall out. Each map keeps every version it has ever had.
      </p>

      {maps.length === 0 ? (
        <p className="mt-6 text-slate-700">
          This venue has no seating maps. Without one it sells general admission only.
        </p>
      ) : (
        <ul className="mt-8 space-y-6">
          {maps.map((map) => (
            <li key={map.id}>
              <Card>
                <CardBody>
                  <h2 className="font-display text-xl font-semibold text-indigo-night-900">
                    {map.name}
                  </h2>
                  {map.notes ? <p className="mt-1 text-sm text-slate-600">{map.notes}</p> : null}

                  <h3 className="mt-5 text-sm font-medium text-slate-500">Version history</h3>
                  <ul className="mt-2 divide-y divide-slate-200">
                    {map.versions.map((version) => {
                      const state = versionState(version)

                      return (
                        <li
                          key={version.id}
                          className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-indigo-night-900">
                                Version {version.version}
                              </span>
                              <Badge variant={state.variant} srLabel="State:">
                                {state.label}
                              </Badge>
                              <span className="text-sm text-slate-600">
                                {version.seatCount.toLocaleString('en-IN')} seats
                              </span>
                            </p>
                            <p className="mt-1 text-sm text-slate-600">{state.note}</p>
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-3 text-sm">
                            {version.publishedAt || version.inUse ? (
                              <>
                                <Link
                                  href={`/organizer/map-versions/${version.id}`}
                                  className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                                >
                                  View layout
                                </Link>
                                <CloneVersionButton mapId={map.id} versionId={version.id} />
                              </>
                            ) : (
                              <Link
                                href={`/organizer/map-versions/${version.id}`}
                                className="rounded-sm font-medium underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                              >
                                Edit layout
                              </Link>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 border-t border-slate-200 pt-6">
        <h2 className="text-xl font-bold text-indigo-night-900">Add a map</h2>
        <div className="mt-4 max-w-md">
          <CreateMapForm venueId={venue.id} />
        </div>
      </div>
    </div>
  )
}
