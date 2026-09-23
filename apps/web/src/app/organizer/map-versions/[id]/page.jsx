/**
 * Editing — or, once published, reading — one map version.
 *
 * The same screen serves both. A frozen version is not a different page with
 * the controls deleted: it is this page with `readOnly` set, saying why, and
 * offering the one action that does apply. Two pages would drift.
 *
 * @module app/organizer/map-versions/id/page
 */

import Link from 'next/link'

import { Alert } from '../../../../components/ui.jsx'
import { MapEditor } from '../../../../components/map-editor.jsx'
import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { getMapVersion } from '../../../../lib/organizer-api.js'
import { describeApiRefusal } from '../../../../lib/refusal.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Seating layout', robots: { index: false, follow: false } }

/**
 * The editor page.
 *
 * @param {object} props Route props.
 * @param {Promise<{id: string}>} props.params The route parameters.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function MapVersionPage({ params }) {
  const { id } = await params

  let version = null
  let failure = null

  try {
    version = await getMapVersion(id)
  } catch (error) {
    failure = error
  }

  if (failure) {
    const { state } = describeApiRefusal(failure)

    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold text-ink">Seat layout</h1>
        {state === 'permission-denied' ? (
          // The API says which of two things it is, and both are public
          // facts: a venue's owner and whether it is shared are on its page.
          <Alert variant="error" title="Could not load this layout" className="mt-4">
            This map belongs to another organisation, or to a venue shared between all of them.
          </Alert>
        ) : (
          <ReadRefusal
            error={failure}
            what="This layout"
            action="edit this layout"
            backHref="/organizer/venues"
            backLabel="Back to your venues"
          />
        )}
      </div>
    )
  }

  // Frozen for either reason: published, or already being sold against. The
  // editor is told it is read-only and explains which.
  const readOnly = Boolean(version.publishedAt) || version.inUse

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link
          href="/organizer/venues"
          className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          Your venues
        </Link>
      </nav>

      <h1 className="mt-4 text-3xl font-bold text-ink">Version {version.version}</h1>
      <p className="mt-2 text-ink-muted">
        {version.seatCount.toLocaleString('en-IN')} seats.
        {version.inUse ? ' A session is selling against this layout.' : ''}
      </p>

      <div className="mt-8">
        <MapEditor version={version} initialLayout={version.layout} readOnly={readOnly} />
      </div>
    </div>
  )
}
