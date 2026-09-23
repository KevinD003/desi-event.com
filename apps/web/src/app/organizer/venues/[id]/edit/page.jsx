/**
 * Editing a venue's details.
 *
 * @module app/organizer/venues/id/edit/page
 */

import { Alert } from '../../../../../components/ui.jsx'
import { VenueForm } from '../../../../../components/venue-form.jsx'
import { getVenue } from '../../../../../lib/organizer-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Edit venue', robots: { index: false, follow: false } }

/**
 * The edit page.
 *
 * @param {object} props Route props.
 * @param {Promise<{id: string}>} props.params The route parameters.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function EditVenuePage({ params }) {
  const { id } = await params

  let venue = null
  let failure = null

  try {
    venue = await getVenue(id)
  } catch (error) {
    failure = error
  }

  if (failure) {
    return (
      <Alert variant="error" title="Could not load this venue">
        {failure.status === 403
          ? 'This venue belongs to another organisation, or is shared between all of them. A shared hall is not one organiser’s to change.'
          : failure.message}
      </Alert>
    )
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-ink">{venue.name}</h1>
      {venue.shared ? (
        <div className="mt-4">
          <Alert variant="info" title="This venue is shared">
            Other organisations list events here too, so only platform staff can change the record.
          </Alert>
        </div>
      ) : null}
      <div className="mt-8">
        <VenueForm venue={venue} />
      </div>
    </div>
  )
}
