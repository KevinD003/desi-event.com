'use client'

/**
 * Starting an event.
 *
 * Deliberately short. The full editor has seven steps and asks for a seating
 * map; a create form that asked for all of it up front is a form people abandon
 * on step three with nothing saved. This collects the five things an event
 * cannot exist without, creates a draft, and hands over to the editor where
 * everything else is autosaved.
 *
 * A new event is a draft. There is no way to make one that is not — the API
 * ignores any status sent to it, which was finding NF-17 — so this form does
 * not offer the choice and does not pretend to.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/create-event-form
 */

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Alert, Button, FormField, Input, Select, Textarea } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { refusalSentence } from '../lib/refusal.js'
// The one list of categories this application has. A second copy is how a
// select ends up offering a value the API has never heard of — which is
// exactly what it did: `LIVE_MUSIC` is not in `eventCategorySchema`, and every
// create was answered "Invalid request body".
import { EVENT_CATEGORIES } from '../lib/catalog.js'
import { COMMON_ZONES, fromLocalInputValue, toLocalInputValue } from '../lib/zoned-time.js'

/**
 * @typedef {object} CreateEventFormProps
 * @property {Array<{organizationId: string, organizationName: string|null}>} organizations Organisations this person may create in.
 */

/**
 * The form.
 *
 * @param {CreateEventFormProps} props Component props.
 * @returns {JSX.Element} The rendered form.
 */
export function CreateEventForm({ organizations = [] }) {
  const router = useRouter()
  const [organizationId, setOrganizationId] = useState(organizations[0]?.organizationId ?? '')
  const [timezone, setTimezone] = useState('America/New_York')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState([])
  const [issues, setIssues] = useState([])
  const errorRef = useRef(null)

  /**
   * Create the draft and go to its editor.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function onSubmit(submitted) {
    submitted.preventDefault()
    setBusy(true)
    setError(null)
    setProblems([])
    setIssues([])

    const form = new FormData(submitted.currentTarget)

    try {
      const response = await apiFetch('/v1/events', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          title: String(form.get('title') ?? '').trim(),
          summary: String(form.get('summary') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
          category: String(form.get('category') ?? 'OTHER'),
          timezone,
          startsAt,
          endsAt,
        }),
      })

      const body = await response.json().catch(() => null)

      if (response.ok) {
        router.push(`/organizer/events/${body.data.id}`)
        return
      }

      setError(refusalSentence(response.status, body, 'The event could not be created.'))
      setProblems(body?.error?.problems ?? [])
      // The field-level issues too. "Invalid request body" on its own is a
      // message nobody can act on — including whoever is debugging it.
      setIssues(body?.error?.issues ?? [])
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
          <Alert variant="error" title="The event was not created">
            <p>{error}</p>
            {problems.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            {issues.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {issues.map((issue) => (
                  <li key={`${issue.path}:${issue.code}`}>
                    <span className="font-medium">{issue.path || 'the request'}:</span>{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {organizations.length > 1 ? (
        <FormField label="Organisation" id="create-organizationId" required>
          <Select
            value={organizationId}
            onChange={(change) => setOrganizationId(change.target.value)}
          >
            {organizations.map((organization) => (
              <option key={organization.organizationId} value={organization.organizationId}>
                {organization.organizationName ?? organization.organizationId}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}

      <FormField label="Title" id="create-title" required>
        <Input name="title" required maxLength={200} />
      </FormField>

      <FormField
        label="One-line summary"
        id="create-summary"
        required
        description="What a card shows in a listing."
      >
        <Input name="summary" required maxLength={200} />
      </FormField>

      <FormField label="Description" id="create-description" required>
        <Textarea name="description" rows={6} required />
      </FormField>

      <FormField label="Category" id="create-category" required>
        <Select name="category" defaultValue="LIVE_MUSIC">
          {EVENT_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Time zone"
        id="create-timezone"
        required
        description="The venue's local time, not yours. Every time below is read in this zone."
      >
        <Select value={timezone} onChange={(change) => setTimezone(change.target.value)}>
          {COMMON_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Starts" id="create-startsAt" required>
          <Input
            type="datetime-local"
            required
            value={toLocalInputValue(startsAt, timezone)}
            onChange={(change) =>
              setStartsAt(fromLocalInputValue(change.target.value, timezone) ?? '')
            }
          />
        </FormField>

        <FormField label="Ends" id="create-endsAt" required>
          <Input
            type="datetime-local"
            required
            value={toLocalInputValue(endsAt, timezone)}
            onChange={(change) =>
              setEndsAt(fromLocalInputValue(change.target.value, timezone) ?? '')
            }
          />
        </FormField>
      </div>

      <p className="text-sm text-ink-muted">
        This creates a draft. Only your team can see it, and nothing is public until a moderator has
        approved it and you have chosen to publish.
      </p>

      <Button type="submit" disabled={busy || !organizationId}>
        {busy ? 'Creating…' : 'Create the draft'}
      </Button>
    </form>
  )
}
