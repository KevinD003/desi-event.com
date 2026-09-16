'use client'

/**
 * Creating a seating map.
 *
 * @module components/create-map-form
 */

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Alert, Button, FormField, Input } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'

/**
 * @typedef {object} CreateMapFormProps
 * @property {string} venueId The venue the map belongs to.
 */

/**
 * The form.
 *
 * @param {CreateMapFormProps} props Component props.
 * @returns {JSX.Element} The rendered form.
 */
export function CreateMapForm({ venueId }) {
  const router = useRouter()
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const errorRef = useRef(null)

  /**
   * Create the map.
   *
   * @param {object} event The submit event.
   * @returns {Promise<void>} Resolves when done.
   */
  async function onSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)

    try {
      const response = await apiFetch(`/v1/venues/${encodeURIComponent(venueId)}/maps`, {
        method: 'POST',
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          notes: String(form.get('notes') ?? '') || null,
        }),
      })

      if (response.ok) {
        router.refresh()
        event.target.reset()
        return
      }

      const body = await response.json().catch(() => null)

      setError(body?.error?.message ?? 'Could not create the map.')
      queueMicrotask(() => errorRef.current?.focus())
    } catch {
      setError('The ticketing service is not responding. Nothing has been created.')
      queueMicrotask(() => errorRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <div ref={errorRef} tabIndex={-1}>
          <Alert variant="error" title="Could not create the map">
            {error}
          </Alert>
        </div>
      ) : null}

      <FormField
        label="Map name"
        id="map-name"
        description="For example: End stage, or In the round."
        required
      >
        <Input id="map-name" name="name" required maxLength={120} />
      </FormField>

      <FormField label="Notes" id="map-notes">
        <Input id="map-notes" name="notes" maxLength={2000} />
      </FormField>

      <Button type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create map'}
      </Button>
    </form>
  )
}
