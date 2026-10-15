/**
 * Adding a venue.
 *
 * Tagged `@file` rather than `@module` because "new" is a reserved word in a
 * JSDoc namepath, and the directory name is the URL — it is not free to move.
 *
 * @file app/organizer/venues/new/page.jsx
 */

import { Alert } from '../../../../components/ui.jsx'
import { VenueForm } from '../../../../components/venue-form.jsx'
import { authoringOrganizations, readSession } from '../../../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Add a venue', robots: { index: false, follow: false } }

/**
 * The create page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function NewVenuePage() {
  const organizations = authoringOrganizations(await readSession())

  return (
    <div className="max-w-2xl">
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Events and venues
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Add a venue</h1>
      <p className="mt-2 text-ink-muted">
        For a hall you run. To list an event somewhere shared, choose it when you create the event —
        you do not need a record of your own.
      </p>

      {organizations.length === 0 ? (
        <div className="mt-6">
          <Alert variant="warning" title="No organisation to add it to">
            You are not a member of an organisation that can manage venues. Ask an owner or admin
            for the event manager role.
          </Alert>
        </div>
      ) : (
        <div className="mt-8">
          <VenueForm organizations={organizations} />
        </div>
      )}
    </div>
  )
}
