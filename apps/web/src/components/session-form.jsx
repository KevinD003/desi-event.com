'use client'

/**
 * The form for one session, to add one or to change one.
 *
 * Times are wall-clock at the venue, in the session's own zone. On a live
 * event the form knows what it may not change — the seating layout people
 * chose seats from, a capacity below what is sold and held — and when a change
 * moves the night itself (its start, end, door time or zone) it asks for a
 * reason and a confirmation before it sends anything, because a notice is
 * recorded for everybody holding a ticket for that night.
 *
 * @module components/session-form
 */

import { useRef, useState } from 'react'

import { TimeZoneSelect } from './time-zone-select.jsx'
import { Alert, Button, FormField, Input, Select, Textarea } from './ui.jsx'
import { SESSION_MATERIAL_FIELDS } from '../lib/event-status.js'
import { fromLocalInputValue, toLocalInputValue, zoneAbbreviation } from '../lib/zoned-time.js'

/**
 * How each material field reads, for the confirmation.
 *
 * @type {Readonly<Record<string, string>>}
 */
const FIELD_WORDS = Object.freeze({
  startsAt: 'the start time',
  endsAt: 'the end time',
  timezone: 'the time zone',
  doorsOpenAt: 'the door time',
})

/**
 * A stored session, or a new one timed like the event, as form values.
 *
 * @param {object} source A session, or the event for a new one.
 * @returns {object} Form values.
 */
export function toSessionForm(source) {
  return {
    // Only a session carries a label; a new one timed like the event starts blank.
    label: typeof source.label === 'string' ? source.label : '',
    timezone: source.timezone ?? 'America/New_York',
    startsAt: source.startsAt ?? '',
    endsAt: source.endsAt ?? '',
    doorsOpenAt: source.doorsOpenAt ?? '',
    salesStartAt: source.salesStartAt ?? '',
    salesEndAt: source.salesEndAt ?? '',
    venueMapVersionId: source.venueMapVersionId ?? '',
    capacity: source.capacity == null ? '' : String(source.capacity),
  }
}

/**
 * The form's values as the API's body, without the revision.
 *
 * @param {object} values Form values.
 * @returns {object} The body.
 */
export function toSessionBody(values) {
  const label = String(values.label ?? '').trim()

  return {
    // Blank means the date labels the night; the API reads null the same way.
    label: label.length > 0 ? label : null,
    startsAt: values.startsAt || undefined,
    endsAt: values.endsAt || undefined,
    doorsOpenAt: values.doorsOpenAt || null,
    timezone: values.timezone,
    salesStartAt: values.salesStartAt || null,
    salesEndAt: values.salesEndAt || null,
    venueMapVersionId: values.venueMapVersionId || null,
    capacity: values.venueMapVersionId || values.capacity === '' ? null : Number(values.capacity),
  }
}

/**
 * Whether two values of one field mean the same.
 *
 * @param {unknown} before The first.
 * @param {unknown} after The second.
 * @returns {boolean} True when unchanged.
 */
function same(before, after) {
  if (before === after) return true
  if (before == null || after == null) return (before ?? null) === (after ?? null)

  if (typeof before === 'string' && typeof after === 'string' && /T/u.test(before)) {
    return Date.parse(before) === Date.parse(after)
  }

  return false
}

/**
 * Only what an edit changed.
 *
 * @param {object} original The values the edit started from.
 * @param {object} values The values now.
 * @returns {object} The changed keys of the body.
 */
export function diffSessionBody(original, values) {
  const before = toSessionBody(original)
  const after = toSessionBody(values)

  return Object.fromEntries(
    Object.entries(after).filter(([key, value]) => !same(before[key], value)),
  )
}

/**
 * Which of a patch's fields move the night itself.
 *
 * @param {object} patch The changed fields.
 * @returns {string[]} The material ones, in their declared order.
 */
export function materialSessionFields(patch) {
  return SESSION_MATERIAL_FIELDS.filter((field) => Object.hasOwn(patch, field))
}

/**
 * What is wrong with the form, field by field.
 *
 * Mirrors the server's `sessionProblems` and its capacity rule.
 *
 * @param {object} values Form values.
 * @param {object} [context] Context.
 * @param {'draft'|'live'} [context.mode] The editing mode.
 * @param {boolean} [context.isNew] Whether this adds a session.
 * @param {{sold: number, held: number}|null} [context.usage] What is using it, when editing.
 * @param {Date} [context.now] The moment in question.
 * @returns {Array<{field: string, message: string}>} One entry per problem.
 */
export function sessionFormProblems(
  values,
  { mode = 'draft', isNew = true, usage = null, now = new Date() } = {},
) {
  const problems = []
  const add = (field, message) => problems.push({ field, message })
  const at = (value) => (value ? new Date(value) : null)
  const starts = at(values.startsAt)
  const ends = at(values.endsAt)
  const doors = at(values.doorsOpenAt)
  const opens = at(values.salesStartAt)
  const closes = at(values.salesEndAt)

  if (!starts) add('startsAt', 'Say when the session starts.')
  if (!ends) add('endsAt', 'Say when the session ends.')
  if (starts && ends && ends <= starts) add('endsAt', 'The session has to end after it starts.')
  if (doors && starts && doors > starts) {
    add('doorsOpenAt', 'Doors cannot open after the session starts.')
  }
  if (mode === 'live' && isNew && starts && starts <= now) {
    add('startsAt', 'A night added to a published event has to start in the future.')
  }
  if (opens && closes && closes <= opens) add('salesEndAt', 'Sales have to close after they open.')
  if (closes && ends && closes > ends) {
    add('salesEndAt', 'Sales cannot close after the session has finished.')
  }

  if (!values.venueMapVersionId) {
    const capacity = /^\d+$/u.test(values.capacity) ? Number(values.capacity) : Number.NaN
    const floor = usage ? usage.sold + usage.held : 0

    if (!Number.isInteger(capacity) || capacity < 1) {
      add('capacity', 'A general-admission session needs a capacity above zero.')
    } else if (capacity < floor) {
      add('capacity', `At least ${floor}: ${usage.sold} sold and ${usage.held} held.`)
    }
  }

  return problems
}

/**
 * @typedef {object} SessionFormProps
 * @property {'create'|'edit'} kind Whether this adds a session or changes one.
 * @property {object} initial The values to start from.
 * @property {'draft'|'live'} mode The editing mode.
 * @property {object[]} mapVersions Published seating map versions for the venue.
 * @property {{sold: number, held: number}|null} [usage] What is using it, when editing.
 * @property {boolean} [busy] Whether a save is in flight.
 * @property {Function} onSubmit Called with the body; for an edit, only what changed plus any confirmation.
 * @property {Function} [onCancel] Called when the person backs out of an edit.
 * @property {string} idPrefix Distinguishes this form's field ids from another's.
 */

/**
 * The form.
 *
 * @param {SessionFormProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function SessionForm({
  kind,
  initial,
  mode = 'draft',
  mapVersions = [],
  usage = null,
  busy = false,
  onSubmit,
  onCancel = null,
  idPrefix,
}) {
  const [values, setValues] = useState(initial)
  const [shown, setShown] = useState([])
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState(null)
  const summary = useRef(null)
  const zone = values.timezone
  const layoutLocked = kind === 'edit' && mode === 'live'
  const changed = kind === 'edit' ? diffSessionBody(initial, values) : {}
  const material = mode === 'live' && kind === 'edit' ? materialSessionFields(changed) : []
  const errors = Object.fromEntries(shown.map((entry) => [entry.field, entry.message]))

  /**
   * Change fields.
   *
   * @param {object} patch The changed values.
   * @returns {void}
   */
  const set = (patch) => {
    setNotice(null)
    setValues((current) => ({ ...current, ...patch }))
  }

  /**
   * One wall-clock box.
   *
   * @param {string} field The instant field.
   * @param {string} label The label.
   * @param {object} [extra] Extra FormField props.
   * @returns {JSX.Element} The field.
   */
  const instant = (field, label, extra = {}) => (
    <FormField
      label={`${label} (${zoneAbbreviation(zone, new Date(values[field] || values.startsAt || Date.now()))})`}
      id={`${idPrefix}-${field}`}
      {...(errors[field] ? { error: errors[field] } : {})}
      {...extra}
    >
      <Input
        type="datetime-local"
        value={toLocalInputValue(values[field], zone)}
        onChange={(change) =>
          set({ [field]: fromLocalInputValue(change.target.value, zone) ?? '' })
        }
      />
    </FormField>
  )

  /**
   * Check and send.
   *
   * @param {object} submitted The submit event.
   * @returns {void}
   */
  function submit(submitted) {
    submitted.preventDefault()

    const problems = sessionFormProblems(values, { mode, isNew: kind === 'create', usage })

    if (material.length > 0 && !reason.trim()) {
      problems.push({ field: 'changeReason', message: 'Say why the night is moving.' })
    }

    if (material.length > 0 && !confirmed) {
      problems.push({ field: 'confirm', message: 'Tick the box to confirm the change.' })
    }

    setShown(problems)

    if (problems.length > 0) {
      queueMicrotask(() => summary.current?.focus())
      return
    }

    if (kind === 'create') {
      onSubmit(toSessionBody(values))
      return
    }

    if (Object.keys(changed).length === 0) {
      setNotice('Nothing has changed.')
      return
    }

    onSubmit(
      material.length > 0
        ? { ...changed, confirmMaterialChange: true, changeReason: reason.trim() }
        : changed,
    )
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {shown.length > 0 ? (
        <div
          ref={summary}
          tabIndex={-1}
          className="rounded-card border border-status-danger/25 bg-status-danger-soft p-4"
        >
          <h4 className="text-sm font-semibold text-status-danger">
            {shown.length === 1 ? 'One thing to fix' : `${shown.length} things to fix`}
          </h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-status-danger">
            {shown.map((problem) => (
              <li key={`${problem.field}-${problem.message}`}>
                <a className="underline underline-offset-4" href={`#${idPrefix}-${problem.field}`}>
                  {problem.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FormField
        label="Label (optional)"
        id={`${idPrefix}-label`}
        description="For example, Night 1. Leave blank to label it by its date."
        {...(errors.label ? { error: errors.label } : {})}
      >
        <Input
          type="text"
          maxLength={60}
          autoComplete="off"
          value={values.label ?? ''}
          onChange={(change) => set({ label: change.target.value })}
        />
      </FormField>

      <FormField
        label="Time zone"
        id={`${idPrefix}-timezone`}
        required
        description="The venue's local time for this session. A festival that moves venue mid-week moves zone with it."
      >
        <TimeZoneSelect
          value={zone}
          onChange={(change) => set({ timezone: change.target.value })}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {instant('startsAt', 'Starts', { required: true })}
        {instant('endsAt', 'Ends', { required: true })}
        {instant('doorsOpenAt', 'Doors open')}

        <FormField
          label="Capacity"
          id={`${idPrefix}-capacity`}
          description={
            values.venueMapVersionId
              ? "A reserved session's capacity is its map."
              : usage && mode === 'live'
                ? `At least ${usage.sold + usage.held}.`
                : 'General admission: how many people it holds.'
          }
          {...(errors.capacity ? { error: errors.capacity } : {})}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={usage && mode === 'live' ? usage.sold + usage.held : 1}
            disabled={Boolean(values.venueMapVersionId)}
            value={values.venueMapVersionId ? '' : values.capacity}
            onChange={(change) => set({ capacity: change.target.value })}
          />
        </FormField>

        {instant('salesStartAt', 'Sales open', {
          description: 'Leave empty to sell whenever the event does.',
        })}
        {instant('salesEndAt', 'Sales close', {
          description: 'Leave empty to sell until the session ends.',
        })}
      </div>

      <FormField
        label="Seating map"
        id={`${idPrefix}-venueMapVersionId`}
        description={
          layoutLocked
            ? 'This event is public, so the seating layout of a session stays as it is. Add a new session for another layout.'
            : 'Only published versions appear here. A version somebody is still editing cannot back a session, because the seats would move underneath the tickets.'
        }
      >
        <Select
          value={values.venueMapVersionId}
          disabled={layoutLocked}
          onChange={(change) => set({ venueMapVersionId: change.target.value })}
        >
          <option value="">General admission — no seating map</option>
          {mapVersions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.mapName} v{version.version} — {version.seatCount} seats
            </option>
          ))}
        </Select>
      </FormField>

      {material.length > 0 ? (
        <div className="space-y-3 rounded-card border border-status-warning/30 bg-status-warning-soft p-4">
          <p className="text-sm text-status-warning">
            You are changing {material.map((field) => FIELD_WORDS[field]).join(', ')} of a night
            people may have bought tickets for. A notice is recorded for every order for this night.
            This build does not send email, so tell them yourself as well.
          </p>
          <FormField
            label="Why the night is moving"
            id={`${idPrefix}-changeReason`}
            required
            {...(errors.changeReason ? { error: errors.changeReason } : {})}
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(change) => setReason(change.target.value)}
            />
          </FormField>
          <label className="flex items-start gap-2 text-sm text-ink" id={`${idPrefix}-confirm`}>
            <input
              type="checkbox"
              className="mt-1 size-4 rounded border-line-strong"
              checked={confirmed}
              onChange={(change) => setConfirmed(change.target.checked)}
            />
            I understand this changes what people bought, and a notice will be recorded for every
            order for this night.
          </label>
        </div>
      ) : null}

      {notice ? (
        <Alert variant="info" title="Not saved">
          <p>{notice}</p>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy
            ? kind === 'create'
              ? 'Adding…'
              : 'Saving…'
            : kind === 'create'
              ? 'Add session'
              : 'Save changes'}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  )
}
