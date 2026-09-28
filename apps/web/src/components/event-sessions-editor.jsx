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

import { SessionForm, toSessionForm } from './session-form.jsx'
import { Alert, Badge, Button, Card, CardBody } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { refusalSentence } from '../lib/refusal.js'
import { toLocalInputValue, zoneAbbreviation } from '../lib/zoned-time.js'

/**
 * @typedef {object} EventSessionsEditorProps
 * @property {object} event The event.
 * @property {object[]} sessions The sessions as loaded, with their usage and price zones.
 * @property {number} revision The event's current revision, owned by the editor shell.
 * @property {Function} onRevision Called with the new revision after every write.
 * @property {Function} [onSessions] Called with the list after it changes, so the tickets step sees new sessions.
 * @property {object[]} mapVersions Published map versions for the event's venue.
 * @property {boolean} [editable] Whether the event's state allows changes. Superseded by `mode`.
 * @property {'draft'|'live'|'locked'} [mode] The editing mode.
 */

/**
 * A session's usage line, in words.
 *
 * @param {object} session The session.
 * @returns {string|null} For example `120 of 200 sold · 4 held`, or null when nothing is known.
 */
function usageLine(session) {
  if (!session.usage) return null

  const { sold, held } = session.usage
  const of = session.capacity ? ` of ${session.capacity.toLocaleString('en-US')}` : ''

  return `${sold.toLocaleString('en-US')}${of} sold · ${held.toLocaleString('en-US')} held`
}

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
  onSessions = () => {},
  mapVersions = [],
  editable = true,
  mode: givenMode = null,
}) {
  const mode = givenMode ?? (editable ? 'draft' : 'locked')
  const canEdit = mode !== 'locked'
  const [sessions, setSessionsState] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState([])
  const [notice, setNotice] = useState(null)
  const [editing, setEditing] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [addKey, setAddKey] = useState(0)

  /**
   * Keep the list, and tell the shell.
   *
   * @param {object[]} next The sessions.
   * @returns {void}
   */
  const setSessions = (next) => {
    setSessionsState(next)
    onSessions(next)
  }

  /**
   * Send one authoring write and fold the answer back in.
   *
   * @param {string} path The path under the event.
   * @param {object} init `apiFetch` options, without the revision.
   * @param {object|null} [body] A JSON body; the revision is added to it.
   * @returns {Promise<object|null>} The response body, or null when it failed.
   */
  async function write(path, init, body = null) {
    setBusy(true)
    setError(null)
    setProblems([])
    setNotice(null)

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}${path}`, {
        ...init,
        ...(body ? { body: JSON.stringify({ ...body, revision }) } : { query: { revision } }),
      })

      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        if (Number.isInteger(parsed?.meta?.revision)) onRevision(parsed.meta.revision)
        return parsed ?? {}
      }

      setError(refusalSentence(response.status, parsed, 'The change was refused.'))
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
   * Re-read the list, with every session's usage.
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
   * Add a session.
   *
   * @param {object} body The session.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function addSession(body) {
    const result = await write('/sessions', { method: 'POST' }, body)

    if (!result) return

    await reload()
    setAddKey((current) => current + 1)
    setNotice('Session added.')
  }

  /**
   * Save an edit to a session.
   *
   * @param {object} session The session.
   * @param {object} patch What changed, with any confirmation.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function saveSession(session, patch) {
    const result = await write(
      `/sessions/${encodeURIComponent(session.id)}`,
      { method: 'PATCH' },
      patch,
    )

    if (!result) return

    await reload()
    setEditing(null)
    setNotice(
      patch.confirmMaterialChange
        ? 'Session changed. A notice has been recorded for every order for this night.'
        : 'Session saved.',
    )
  }

  /**
   * Remove one session. The revision travels in the query string.
   *
   * @param {object} session The session.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function removeSession(session) {
    const result = await write(`/sessions/${encodeURIComponent(session.id)}`, {
      method: 'DELETE',
    })

    setConfirmRemove(null)

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
        setError(refusalSentence(response.status, body, 'Inventory could not be prepared.'))
        setProblems(body?.error?.problems ?? [])
        return
      }

      // `created` and `prepared` are separate in the response precisely so that
      // a second run can say "already done" rather than claiming work.
      const { kind, created, prepared, expected, assigned = 0 } = body.data

      if (kind === 'general_admission') {
        // Nothing to prepare, and saying "already prepared: 0 of 0" would read
        // as a failure. A general-admission session counts a quantity; there
        // are no seat rows, and inventing some would create rows nothing reads.
        setNotice(
          'This session is general admission, so there are no seats to prepare — its capacity is its inventory. Give it a published seating map to sell reserved seats.',
        )
        return
      }

      const made =
        created === 0
          ? `Already prepared: ${prepared} of ${expected} seats exist. Nothing new was created.`
          : `Prepared ${created} new seat${created === 1 ? '' : 's'}; ${prepared} of ${expected} now exist.`
      const priced =
        assigned > 0
          ? ` ${assigned} seat${assigned === 1 ? ' was' : 's were'} matched to the reserved ticket type that prices ${assigned === 1 ? 'its' : 'their'} zone.`
          : ''

      setNotice(`${made}${priced}`)
    } catch {
      setError('The service is not responding.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="sessions-heading" className="space-y-5">
      <h2 id="sessions-heading" className="text-xl font-semibold text-ink">
        Sessions
      </h2>
      <p className="text-sm text-ink-muted">
        One per performance. A single-night event has one; a nine-night festival has nine, and a
        ticket type belongs to exactly one of them.
      </p>

      {mode === 'live' ? (
        <p className="text-sm text-ink-muted">
          This event is public. You can add a night, move one, or remove one nobody has a ticket
          for. Moving a night people have tickets for records a notice for each of their orders.
        </p>
      ) : null}

      <div aria-live="polite">
        {notice ? (
          <Alert variant="success" title="Done">
            <p>{notice}</p>
          </Alert>
        ) : null}
      </div>

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
        <p className="rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-muted">
          No sessions yet. An event cannot be published without at least one.
        </p>
      ) : (
        <ol className="space-y-3">
          {sessions.map((session, index) => {
            const usage = usageLine(session)
            const zones = session.priceZones ?? []

            return (
              <li key={session.id}>
                <Card>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-medium text-ink">
                          {session.label || `Session ${index + 1}`}{' '}
                          {session.venueMapVersionId ? (
                            <Badge variant="info" srLabel="Seating:">
                              Reserved seating
                            </Badge>
                          ) : (
                            <Badge variant="neutral" srLabel="Seating:">
                              General admission
                            </Badge>
                          )}
                        </h3>
                        <p className="mt-1 text-sm text-ink-muted">
                          {toLocalInputValue(session.startsAt, session.timezone).replace('T', ' ')}{' '}
                          — {toLocalInputValue(session.endsAt, session.timezone).replace('T', ' ')}{' '}
                          <span className="text-ink-muted">
                            ({session.timezone}{' '}
                            {zoneAbbreviation(session.timezone, new Date(session.startsAt))})
                          </span>
                        </p>
                        {session.capacity ? (
                          <p className="mt-1 text-sm text-ink-muted">
                            Capacity {session.capacity.toLocaleString('en-US')}
                          </p>
                        ) : null}
                        {zones.length > 0 ? (
                          <p className="mt-1 text-sm text-ink-muted">
                            Price zones: {zones.map((zone) => zone.name).join(', ')}
                          </p>
                        ) : null}
                        {usage ? <p className="mt-1 text-sm text-ink-muted">{usage}</p> : null}
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
                        {canEdit && editing !== session.id ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            aria-label={`Edit session ${index + 1}`}
                            onClick={() => {
                              setConfirmRemove(null)
                              setEditing(session.id)
                            }}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canEdit && session.removable !== false && confirmRemove !== session.id ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label={`Remove session ${index + 1}`}
                            onClick={() => setConfirmRemove(session.id)}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {canEdit && session.removable === false ? (
                      <p className="mt-2 text-sm text-ink-muted">
                        Cannot be removed: this night has orders, baskets or check-ins. Move it
                        instead, or cancel the event.
                      </p>
                    ) : null}

                    {confirmRemove === session.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-card border border-line p-3">
                        <p className="text-sm text-ink">
                          Remove this session? Its ticket types have to go first.
                        </p>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() => removeSession(session)}
                        >
                          Yes, remove it
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmRemove(null)}
                        >
                          Keep it
                        </Button>
                      </div>
                    ) : null}

                    {editing === session.id ? (
                      <div className="mt-4 border-t border-line pt-4">
                        <SessionForm
                          kind="edit"
                          idPrefix={`session-${session.id}`}
                          initial={toSessionForm(session)}
                          mode={mode}
                          mapVersions={mapVersions}
                          usage={session.usage ?? null}
                          busy={busy}
                          onSubmit={(patch) => saveSession(session, patch)}
                          onCancel={() => setEditing(null)}
                        />
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            )
          })}
        </ol>
      )}

      {canEdit ? (
        <div className="space-y-4 rounded-card border border-line p-4">
          <h3 className="text-lg font-semibold text-ink">Add a session</h3>
          {mapVersions.length === 0 ? (
            <p className="text-sm text-ink-muted">
              This venue has no published seating map, so sessions here are general admission.
              Publish a map version on the venue first to sell reserved seats.
            </p>
          ) : null}
          <SessionForm
            key={addKey}
            kind="create"
            idPrefix="session"
            initial={toSessionForm(event)}
            mode={mode}
            mapVersions={mapVersions}
            busy={busy}
            onSubmit={addSession}
          />
        </div>
      ) : null}
    </section>
  )
}
