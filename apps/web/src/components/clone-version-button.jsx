'use client'

/**
 * Starting a new draft from a published version.
 *
 * This is the only way to change a published map, so the button says what it
 * does rather than "edit": the original stays exactly where it is, and a copy
 * becomes the thing being worked on.
 *
 * @module components/clone-version-button
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { refusalSentence } from '../lib/refusal.js'

/**
 * @typedef {object} CloneVersionButtonProps
 * @property {string} mapId The map.
 * @property {string} versionId The version to copy.
 */

/**
 * The button.
 *
 * @param {CloneVersionButtonProps} props Component props.
 * @returns {JSX.Element} The rendered button.
 */
export function CloneVersionButton({ mapId, versionId }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  /**
   * Clone it.
   *
   * @returns {Promise<void>} Resolves when done.
   */
  async function clone() {
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(`/v1/venue-maps/${encodeURIComponent(mapId)}/versions`, {
        method: 'POST',
        body: JSON.stringify({ cloneFromVersionId: versionId }),
      })

      const body = await response.json().catch(() => null)

      if (response.ok && body?.data?.id) {
        router.push(`/organizer/map-versions/${body.data.id}`)
        return
      }

      setError(refusalSentence(response.status, body, 'Could not start a new version.'))
    } catch {
      setError('The ticketing service is not responding. Nothing has been created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant="secondary" size="sm" onClick={clone} disabled={busy}>
        {busy ? 'Copying…' : 'New version from this'}
      </Button>
      {error ? (
        <span role="status" className="text-xs text-status-danger">
          {error}
        </span>
      ) : null}
    </span>
  )
}
