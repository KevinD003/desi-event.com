/**
 * The create entry point.
 *
 * Tagged `@file` rather than `@module` because "new" is a reserved word in a
 * JSDoc namepath, and the directory name is the URL — it is not free to move.
 *
 * @file app/organizer/events/new/page.jsx
 */

import { Alert } from '../../../../components/ui.jsx'
import { CreateEventForm } from '../../../../components/create-event-form.jsx'
import { eventOrganizations, readSession } from '../../../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Create an event', robots: { index: false, follow: false } }

/**
 * The create page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function NewEventPage() {
  const organizations = eventOrganizations(await readSession())

  return (
    <div className="max-w-2xl">
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Events
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Create an event</h1>
      <p className="mt-2 text-ink-muted">
        Five things to start with. Sessions, tickets, seating and policies come next, in an editor
        that saves as you go.
      </p>

      {organizations.length === 0 ? (
        <div className="mt-6">
          <Alert variant="warning" title="No organisation to create it in">
            You are not a member of an organisation that can create events. Ask an owner or an admin
            for the event manager role.
          </Alert>
        </div>
      ) : (
        <div className="mt-8">
          <CreateEventForm organizations={organizations} />
        </div>
      )}
    </div>
  )
}
