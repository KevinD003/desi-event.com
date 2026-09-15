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
import { getMapVersion } from '../../../../lib/organizer-api.js'

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
    return (
      <Alert variant="danger" title="Could not load this layout">
        {failure.status === 403
          ? 'This map belongs to another organisation, or to a venue shared between all of them.'
          : failure.message}
      </Alert>
    )
  }

  // Frozen for either reason: published, or already being sold against. The
  // editor is told it is read-only and explains which.
  const readOnly = Boolean(version.publishedAt) || version.inUse

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

      <h1 className="mt-4 text-3xl font-bold text-indigo-night-900">Version {version.version}</h1>
      <p className="mt-2 text-slate-700">
        {version.seatCount.toLocaleString('en-IN')} seats.
        {version.inUse ? ' A session is selling against this layout.' : ''}
      </p>

      <div className="mt-8">
        <MapEditor version={version} initialLayout={version.layout} readOnly={readOnly} />
      </div>
    </div>
  )
}
