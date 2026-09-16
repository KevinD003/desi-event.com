'use client'

/**
 * An event's sessions: the actual performances people buy a seat at.
 *
 * A one-night show has one. Navratri has nine, and somebody has to be able to
 * add the ninth without retyping the first eight, which is why this is a list
 * with an add form rather than a wizard.
 *
 * Two rules the form makes visible rather than discovering at save time:
 *
 *   - **Every local time carries its zone.** A session inherits the event's, and
 *     can override it, because a festival that moves venue mid-week moves zone
 *     with it. The boxes are wall-clock at the venue and the label says which
 *     zone that is.
 *   - **A reserved session needs a published map version.** The map freezes when
 *     sales open, so an editable version cannot back a session; the select lists
 *     only versions that are published, and says so when there are none.
 *
 * Every write carries the revision, so two people editing the same schedule
 * find out rather than overwrite each other.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-sessions-editor
 */

import { useState } from 'react'

import { Alert, Badge, Button, Card, CardBody, FormField, Input, Select } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { fromLocalInputValue, toLocalInputValue, zoneAbbreviation } from '../lib/zoned-time.js'

/**
 * A blank session, timed like the event itself.
 *
 * @param {object} event The event.
 * @returns {object} Form values for a new session.
 */
function blankSession(event) {
  return {
    startsAt: event.startsAt ?? '',
    endsAt: event.endsAt ?? '',
    doorsOpenAt: '',
    timezone: event.timezone ?? 'Asia/Kolkata',
    salesStartAt: '',
    salesEndAt: '',
    venueMapVersionId: '',
    capacity: '',
  }
}

/**
 * @typedef {object} EventSessionsEditorProps
 * @property {object} event The event.
 * @property {object[]} sessions The sessions as loaded.
 * @property {number} revision The event's current revision, owned by the editor shell.
 * @property {Function} onRevision Called with the new revision after every write.
 * @property {object[]} mapVersions Published map versions for the event's venue.
 * @property {boolean} editable Whether the event's state allows changes.
 */

/**
 * The sessions step.
 *
 * @param {EventSessionsEditorProps} props Component props.
 * @returns {JSX.Element} The step.
 */
export function EventSessionsEditor({
  event,
  sessions: initial = [],
  revision = 0,
  onRevision = () => {},
  mapVersions = [],
  editable = true,
}) {
  const [sessions, setSessions] = useState(initial)
  const [draft, setDraft] = useState(() => blankSession(event))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState([])
  const [notice, setNotice] = useState(null)

  /**
   * Send one authoring write and fold the answer back in.
   *
   * @param {string} path The path under the event.
   * @param {string} method The HTTP method.
   * @param {object} [body] The body, which always carries the revision.
   * @returns {Promise<object|null>} The response body, or null when it failed.
   */
  async function write(path, method, body = {}) {
    setBusy(true)
    setError(null)
    setProblems([])

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}${path}`, {
        method,
        body: JSON.stringify({ ...body, revision }),
      })

      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        if (Number.isInteger(parsed?.meta?.revision)) onRevision(parsed.meta.revision)
        return parsed
      }

      setError(parsed?.error?.message ?? 'The change was refused.')
      setProblems(parsed?.error?.problems ?? [])
      return null
    } catch {
      setError('The service is not responding. Nothing has been saved.')
      return null
    } finally {
      setBusy(false)
    }
  }

  /**
   * Re-read the list after a change that moved more than one row.
   *
   * @returns {Promise<void>} Resolves when reloaded.
   */
  async function reload() {
    const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}/sessions`)
    const body = await response.json().catch(() => null)

    if (response.ok && body) {
      setSessions(body.data ?? [])
      if (Number.isInteger(body.meta?.revision)) onRevision(body.meta.revision)
    }
  }

  /**
   * Add the session in the form.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function addSession(submitted) {
    submitted.preventDefault()

    const body = {
      startsAt: draft.startsAt || undefined,
      endsAt: draft.endsAt || undefined,
      doorsOpenAt: draft.doorsOpenAt || null,
      timezone: draft.timezone,
      salesStartAt: draft.salesStartAt || null,
      salesEndAt: draft.salesEndAt || null,
      venueMapVersionId: draft.venueMapVersionId || null,
      capacity: draft.capacity === '' ? null : Number(draft.capacity),
    }

    const result = await write('/sessions', 'POST', body)

    if (!result) return

    setSessions((current) => [...current, result.data])
    setDraft(blankSession(event))
    setNotice('Session added.')
  }

  /**
   * Remove one session.
   *
   * @param {object} session The session.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function removeSession(session) {
    const result = await write(`/sessions/${encodeURIComponent(session.id)}`, 'DELETE')

    if (!result) return

    await reload()
    setNotice('Session removed.')
  }

  /**
   * Prepare inventory for one session.
   *
   * @param {object} session The session.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function prepare(session) {
    setBusy(true)
    setError(null)
    setProblems([])

    try {
      const response = await apiFetch(
        `/v1/events/${encodeURIComponent(event.id)}/prepare-inventory`,
        { method: 'POST', body: JSON.stringify({ eventSessionId: session.id }) },
      )

      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error?.message ?? 'Inventory could not be prepared.')
        setProblems(body?.error?.problems ?? [])
        return
      }

      // `created` and `prepared` are separate in the response precisely so that
      // a second run can say "already done" rather than claiming work.
      const { kind, created, prepared, expected } = body.data

      if (kind === 'general_admission') {
        // Nothing to prepare, and saying "already prepared: 0 of 0" would read
        // as a failure. A general-admission session counts a quantity; there
        // are no seat rows, and inventing some would create rows nothing reads.
        setNotice(
          'This session is general admission, so there are no seats to prepare — its capacity is its inventory. Give it a published seating map to sell reserved seats.',
        )
        return
      }

      setNotice(
        created === 0
          ? `Already prepared: ${prepared} of ${expected} seats exist. Nothing new was created.`
          : `Prepared ${created} new seat${created === 1 ? '' : 's'}; ${prepared} of ${expected} now exist.`,
      )
    } catch {
      setError('The service is not responding.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="sessions-heading" className="space-y-5">
      <h2 id="sessions-heading" className="text-xl font-bold text-indigo-night-900">
        Sessions
      </h2>
      <p className="text-sm text-slate-600">
        One per performance. A single-night event has one; a nine-night festival has nine, and a
        ticket type belongs to exactly one of them.
      </p>

      {notice ? (
        <Alert variant="success" title="Done">
          <p>{notice}</p>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="error" title="That did not work">
          <p>{error}</p>
          {problems.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      {sessions.length === 0 ? (
        <p className="rounded-card border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          No sessions yet. An event cannot be published without at least one.
        </p>
      ) : (
        <ol className="space-y-3">
          {sessions.map((session, index) => (
            <li key={session.id}>
              <Card>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-indigo-night-900">
                        Session {index + 1}
                        {session.venueMapVersionId ? (
                          <>
                            {' '}
                            <Badge variant="info" srLabel="Seating:">
                              Reserved seating
                            </Badge>
                          </>
                        ) : (
                          <>
                            {' '}
                            <Badge variant="neutral" srLabel="Seating:">
                              General admission
                            </Badge>
                          </>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {toLocalInputValue(session.startsAt, session.timezone).replace('T', ' ')} —{' '}
                        {toLocalInputValue(session.endsAt, session.timezone).replace('T', ' ')}{' '}
                        <span className="text-slate-600">
                          ({session.timezone} {zoneAbbreviation(session.timezone)})
                        </span>
                      </p>
                      {session.capacity ? (
                        <p className="mt-1 text-sm text-slate-600">
                          Capacity {session.capacity.toLocaleString('en-IN')}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => prepare(session)}
                      >
                        Prepare inventory
                      </Button>
                      {editable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => removeSession(session)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {editable ? (
        <form onSubmit={addSession} className="space-y-4 rounded-card border border-slate-200 p-4">
          <h3 className="text-lg font-semibold text-indigo-night-900">Add a session</h3>

          <FormField
            label="Time zone"
            id="session-timezone"
            required
            description="The venue's local time for this session. A festival that moves venue mid-week moves zone with it."
          >
            <Select
              value={draft.timezone}
              onChange={(change) => setDraft({ ...draft, timezone: change.target.value })}
            >
              {[...new Set([draft.timezone, event.timezone, 'Asia/Kolkata'])]
                .filter(Boolean)
                .map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
            </Select>
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Starts" id="session-startsAt" required>
              <Input
                type="datetime-local"
                value={toLocalInputValue(draft.startsAt, draft.timezone)}
                onChange={(change) =>
                  setDraft({
                    ...draft,
                    startsAt: fromLocalInputValue(change.target.value, draft.timezone) ?? '',
                  })
                }
              />
            </FormField>

            <FormField label="Ends" id="session-endsAt" required>
              <Input
                type="datetime-local"
                value={toLocalInputValue(draft.endsAt, draft.timezone)}
                onChange={(change) =>
                  setDraft({
                    ...draft,
                    endsAt: fromLocalInputValue(change.target.value, draft.timezone) ?? '',
                  })
                }
              />
            </FormField>

            <FormField label="Doors open" id="session-doorsOpenAt">
              <Input
                type="datetime-local"
                value={toLocalInputValue(draft.doorsOpenAt, draft.timezone)}
                onChange={(change) =>
                  setDraft({
                    ...draft,
                    doorsOpenAt: fromLocalInputValue(change.target.value, draft.timezone) ?? '',
                  })
                }
              />
            </FormField>

            <FormField
              label="Capacity"
              id="session-capacity"
              description="General admission only. A reserved session's capacity is its map."
            >
              <Input
                type="number"
                min="0"
                value={draft.capacity}
                onChange={(change) => setDraft({ ...draft, capacity: change.target.value })}
              />
            </FormField>

            <FormField
              label="Sales open"
              id="session-salesStartAt"
              description="Leave empty to sell as soon as the event does."
            >
              <Input
                type="datetime-local"
                value={toLocalInputValue(draft.salesStartAt, draft.timezone)}
                onChange={(change) =>
                  setDraft({
                    ...draft,
                    salesStartAt: fromLocalInputValue(change.target.value, draft.timezone) ?? '',
                  })
                }
              />
            </FormField>

            <FormField label="Sales close" id="session-salesEndAt">
              <Input
                type="datetime-local"
                value={toLocalInputValue(draft.salesEndAt, draft.timezone)}
                onChange={(change) =>
                  setDraft({
                    ...draft,
                    salesEndAt: fromLocalInputValue(change.target.value, draft.timezone) ?? '',
                  })
                }
              />
            </FormField>
          </div>

          <FormField
            label="Seating map"
            id="session-venueMapVersionId"
            description="Only published versions appear here. A version somebody is still editing cannot back a session, because the seats would move underneath the tickets."
          >
            <Select
              value={draft.venueMapVersionId}
              onChange={(change) => setDraft({ ...draft, venueMapVersionId: change.target.value })}
            >
              <option value="">General admission — no seating map</option>
              {mapVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.mapName} v{version.version} — {version.seatCount} seats
                </option>
              ))}
            </Select>
          </FormField>

          {mapVersions.length === 0 ? (
            <p className="text-sm text-slate-600">
              This venue has no published seating map, so sessions here are general admission.
              Publish a map version on the venue first to sell reserved seats.
            </p>
          ) : null}

          <Button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add session'}
          </Button>
        </form>
      ) : null}
    </section>
  )
}
