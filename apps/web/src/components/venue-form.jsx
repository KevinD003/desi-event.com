'use client'

/**
 * Creating and editing a venue.
 *
 * One component for both, because the fields are the same and two would drift.
 * What differs is the method, the URL, and whether an organisation can still be
 * chosen — a venue does not move between organisations, so that choice exists
 * once and then never again.
 *
 * The accessibility claims are checkboxes over a fixed vocabulary rather than a
 * free-text box, because a visitor filtering for step-free access cannot filter
 * on a paragraph. The paragraph is still here, underneath, for what the
 * vocabulary cannot say.
 *
 * @module components/venue-form
 */

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Alert, Button, FormField, Input, Select } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { refusalSentence } from '../lib/refusal.js'

/**
 * The accessibility vocabulary, and how each claim reads.
 *
 * Mirrors `ACCESSIBILITY_FEATURES` in `@desi-event/schemas/venues`. Listed here
 * rather than imported so the browser does not take the schemas barrel for
 * fifteen strings — the same lesson NF-16 taught, applied rather than repeated.
 *
 * @type {Array<string[]>}
 */
const FEATURES = Object.freeze([
  ['STEP_FREE_ENTRANCE', 'Step-free entrance'],
  ['STEP_FREE_TO_SEATING', 'Step-free route to the seating'],
  ['ACCESSIBLE_TOILET', 'Accessible toilet'],
  ['ACCESSIBLE_PARKING', 'Accessible parking'],
  ['WHEELCHAIR_SPACES', 'Wheelchair spaces'],
  ['COMPANION_SEATING', 'Companion seating'],
  ['HEARING_LOOP', 'Hearing loop'],
  ['AUDIO_DESCRIPTION', 'Audio description'],
  ['SIGN_LANGUAGE', 'Sign language interpretation'],
  ['CAPTIONING', 'Captioning'],
  ['QUIET_SPACE', 'Quiet space'],
  ['ASSISTANCE_DOGS_WELCOME', 'Assistance dogs welcome'],
  ['LIFT_ACCESS', 'Lift access'],
  ['SEATED_ONLY', 'Seated only'],
  ['STANDING_ONLY', 'Standing only'],
])

/**
 * @typedef {object} VenueFormProps
 * @property {object|null} venue The venue being edited, or null when creating.
 * @property {Array<object>} organizations Organisations this person may create a venue in.
 */

/**
 * The form.
 *
 * @param {VenueFormProps} props Component props.
 * @returns {JSX.Element} The rendered form.
 */
export function VenueForm({ venue = null, organizations = [] }) {
  const router = useRouter()
  const editing = Boolean(venue)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [features, setFeatures] = useState(venue?.accessibility?.features ?? [])
  const errorRef = useRef(null)

  /**
   * Create or update.
   *
   * @param {object} event The submit event.
   * @returns {Promise<void>} Resolves when done.
   */
  async function onSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)

    /**
     * A trimmed string field, or null when empty.
     *
     * @param {string} name The field name.
     * @returns {string|null} The value.
     */
    const text = (name) => String(form.get(name) ?? '').trim() || null

    const payload = {
      name: text('name'),
      addressLine1: text('addressLine1'),
      addressLine2: text('addressLine2'),
      city: text('city'),
      region: text('region'),
      postalCode: text('postalCode'),
      country: text('country') ?? 'US',
      capacity: form.get('capacity') ? Number(form.get('capacity')) : null,
      directions: text('directions'),
      policies: text('policies'),
      description: text('description'),
      accessibility: { features, note: text('accessibilityNote') },
    }

    if (!editing) payload.organizationId = text('organizationId')

    try {
      const response = await apiFetch(
        editing ? `/v1/venues/${encodeURIComponent(venue.id)}` : '/v1/venues',
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      )

      const body = await response.json().catch(() => null)

      if (response.ok) {
        router.push(`/organizer/venues/${body.data.id}/maps`)
        return
      }

      setError(refusalSentence(response.status, body, 'Could not save the venue.'))
      queueMicrotask(() => errorRef.current?.focus())
    } catch {
      setError('The ticketing service is not responding. Nothing has been saved.')
      queueMicrotask(() => errorRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <div ref={errorRef} tabIndex={-1}>
          <Alert variant="error" title="Could not save the venue">
            {error}
          </Alert>
        </div>
      ) : null}

      {!editing ? (
        <FormField
          label="Organisation"
          id="organizationId"
          description="The venue belongs to this organisation, and only it can edit the record."
          required
        >
          <Select id="organizationId" name="organizationId" required defaultValue="">
            <option value="" disabled>
              Choose an organisation
            </option>
            {organizations.map((organization) => (
              <option key={organization.organizationId} value={organization.organizationId}>
                {organization.organizationName ?? organization.organizationId}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}

      <FormField label="Venue name" id="name" required>
        <Input id="name" name="name" defaultValue={venue?.name ?? ''} required maxLength={200} />
      </FormField>

      <FormField label="Street address" id="addressLine1" required>
        <Input
          id="addressLine1"
          name="addressLine1"
          defaultValue={venue?.addressLine1 ?? ''}
          required
        />
      </FormField>

      <FormField label="Building, floor or unit" id="addressLine2">
        <Input id="addressLine2" name="addressLine2" defaultValue={venue?.addressLine2 ?? ''} />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="City" id="city" required>
          <Input id="city" name="city" defaultValue={venue?.city ?? ''} required />
        </FormField>
        <FormField label="Region" id="region" required>
          <Input id="region" name="region" defaultValue={venue?.region ?? ''} required />
        </FormField>
        <FormField label="Postcode" id="postalCode" required>
          <Input
            id="postalCode"
            name="postalCode"
            defaultValue={venue?.postalCode ?? ''}
            required
            maxLength={16}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Country" id="country" description="Two-letter code.">
          <Input id="country" name="country" defaultValue={venue?.country ?? 'US'} maxLength={2} />
        </FormField>
        <FormField label="Capacity" id="capacity">
          <Input
            id="capacity"
            name="capacity"
            type="number"
            min={0}
            defaultValue={venue?.capacity ?? ''}
          />
        </FormField>
      </div>

      <FormField
        label="Getting in"
        id="directions"
        description="Which gate, which metro stop, where to park."
      >
        <Input id="directions" name="directions" defaultValue={venue?.directions ?? ''} />
      </FormField>

      <FormField label="House rules" id="policies">
        <Input id="policies" name="policies" defaultValue={venue?.policies ?? ''} />
      </FormField>

      <fieldset>
        <legend className="text-sm font-medium text-ink-muted">Accessibility</legend>
        <p className="mt-1 text-sm text-ink-muted">
          Only tick what is true. Somebody will plan a journey around these.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FEATURES.map(([code, label]) => (
            <label key={code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={features.includes(code)}
                onChange={(event) =>
                  setFeatures((current) =>
                    event.target.checked
                      ? [...current, code]
                      : current.filter((entry) => entry !== code),
                  )
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <FormField
        label="Anything else about access"
        id="accessibilityNote"
        description="Where the accessible entrance is, who to ask, how long it takes. This is the part people actually read."
      >
        <Input
          id="accessibilityNote"
          name="accessibilityNote"
          defaultValue={venue?.accessibility?.note ?? ''}
          maxLength={2000}
        />
      </FormField>

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? 'Saving…' : editing ? 'Save venue' : 'Create venue'}
      </Button>
    </form>
  )
}
