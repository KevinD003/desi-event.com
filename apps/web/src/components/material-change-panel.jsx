'use client'

/**
 * Changing the date, the place or the terms of an event people have tickets for.
 *
 * On a public event these fields do not autosave. A change to them changes what
 * somebody bought, so it goes through this panel: the organiser edits the
 * fields, sees in words what they are changing, gives a reason, ticks that they
 * understand, and only then is anything sent. The API records a notice against
 * every current order in the same transaction — and notices are not emailed in
 * any configuration, which the panel says rather than implying people have
 * been told.
 *
 * Only the material fields that actually changed are sent, with the revision
 * the editor holds, `confirmMaterialChange: true` and the reason. A stale
 * revision is handed back to the editor, which owns the conflict dialogue.
 *
 * @module components/material-change-panel
 */

import { useEffect, useRef, useState } from 'react'

import { useFocusAfterRender } from './focus-after-render.jsx'
import { TimeZoneSelect } from './time-zone-select.jsx'
import { Alert, Button, FormField, Input, Select, Textarea } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { MATERIAL_FIELD_LABELS, MATERIAL_FIELDS } from '../lib/event-status.js'
import { refusalSentence } from '../lib/refusal.js'
import { fromLocalInputValue, toLocalInputValue, zoneAbbreviation } from '../lib/zoned-time.js'

/** The longest reason the API takes. */
const REASON_LIMIT = 2000

/**
 * The policies as the API holds them, from the form's four boxes.
 *
 * @param {object} values Form values.
 * @returns {{entry: string|null, refund: string|null, conduct: string|null, ageNote: string|null}} The policies.
 */
function policiesOf(values) {
  return {
    entry: values.policyEntry.trim() || null,
    refund: values.policyRefund.trim() || null,
    conduct: values.policyConduct.trim() || null,
    ageNote: values.policyAgeNote.trim() || null,
  }
}

/**
 * The material fields of the form, as the API's body would carry them.
 *
 * @param {object} values Form values.
 * @returns {Record<string, unknown>} One entry per material field.
 */
export function materialBody(values) {
  return {
    startsAt: values.startsAt || null,
    endsAt: values.endsAt || null,
    timezone: values.timezone,
    venueId: values.isOnline ? null : values.venueId || null,
    isOnline: Boolean(values.isOnline),
    onlineUrl: values.isOnline ? values.onlineUrl.trim() || null : null,
    ageRestriction: values.ageRestriction === '' ? null : Number(values.ageRestriction),
    policies: policiesOf(values),
  }
}

/**
 * Whether two values of one field mean the same.
 *
 * @param {unknown} before The saved value.
 * @param {unknown} after The value now.
 * @returns {boolean} True when unchanged.
 */
function same(before, after) {
  if (typeof before === 'string' && typeof after === 'string' && /T/u.test(before)) {
    return Date.parse(before) === Date.parse(after)
  }

  return JSON.stringify(before) === JSON.stringify(after)
}

/**
 * The material fields an edit changed, and their new values.
 *
 * @param {object} baseline The form values as saved.
 * @param {object} values The form values now.
 * @returns {Record<string, unknown>} The changed fields; empty when nothing changed.
 */
export function materialDiff(baseline, values) {
  const before = materialBody(baseline)
  const after = materialBody(values)

  return Object.fromEntries(
    MATERIAL_FIELDS.filter((field) => !same(before[field], after[field])).map((field) => [
      field,
      after[field],
    ]),
  )
}

/**
 * What is wrong with the change, field by field.
 *
 * @param {object} baseline The saved values.
 * @param {object} values The values now.
 * @param {string} reason The reason typed.
 * @param {boolean} confirmed Whether the box is ticked.
 * @returns {Array<{field: string, message: string}>} One entry per problem.
 */
export function materialProblems(baseline, values, reason, confirmed) {
  const problems = []
  const add = (field, message) => problems.push({ field, message })

  if (!values.startsAt) add('startsAt', 'Say when the event starts.')
  if (!values.endsAt) add('endsAt', 'Say when the event ends.')
  if (values.startsAt && values.endsAt && new Date(values.endsAt) <= new Date(values.startsAt)) {
    add('endsAt', 'The event has to end after it starts.')
  }
  if (values.isOnline && !values.onlineUrl.trim()) {
    add('onlineUrl', 'A published online event needs its joining link.')
  }
  if (!values.isOnline && !values.venueId) add('venueId', 'Choose the venue.')
  if (values.ageRestriction !== '' && !/^\d{1,3}$/u.test(String(values.ageRestriction))) {
    add('ageRestriction', 'An age restriction is a whole number.')
  }

  const hadPolicies = Object.values(policiesOf(baseline)).some(Boolean)
  const hasPolicies = Object.values(policiesOf(values)).some(Boolean)

  if (hadPolicies && !hasPolicies) {
    add(
      'policyRefund',
      'A published event keeps its terms. Change the wording rather than removing all of them.',
    )
  }

  if (!reason.trim()) add('changeReason', 'Say why this is changing.')
  else if (reason.trim().length > REASON_LIMIT) {
    add('changeReason', `Keep the reason to ${REASON_LIMIT.toLocaleString('en-US')} characters.`)
  }
  if (!confirmed) add('confirm', 'Tick the box to confirm the change.')

  return problems
}

/**
 * @typedef {object} MaterialChangePanelProps
 * @property {object} event The event (`id`).
 * @property {object} baseline The editor's form values as last saved.
 * @property {number} revision The revision the editor holds.
 * @property {object[]} venues Venues to choose from.
 * @property {Function} onSaved Called with the event detail the API returned.
 * @property {Function} onConflict Called with the refusal's message on `STALE_REVISION`.
 * @property {Function} onCancel Called when the organiser backs out.
 */

/**
 * The panel.
 *
 * @param {MaterialChangePanelProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function MaterialChangePanel({
  event,
  baseline,
  revision,
  venues = [],
  onSaved,
  onConflict,
  onCancel,
}) {
  const [values, setValues] = useState(baseline)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [shown, setShown] = useState([])
  const [refusal, setRefusal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const heading = useRef(null)
  const summary = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const zone = values.timezone
  const changed = materialDiff(baseline, values)
  const fields = Object.keys(changed)
  const errors = Object.fromEntries(shown.map((entry) => [entry.field, entry.message]))

  useEffect(() => {
    heading.current?.focus()
  }, [])

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
   * FormField props for one box.
   *
   * @param {string} field The field.
   * @returns {object} `id`, and `error` when there is one.
   */
  const at = (field) => ({
    id: `material-${field}`,
    ...(errors[field] ? { error: errors[field] } : {}),
  })

  /**
   * Check and send.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function submit(submitted) {
    submitted.preventDefault()
    setRefusal(null)

    if (fields.length === 0) {
      setShown([])
      setNotice('Nothing has changed.')
      return
    }

    const problems = materialProblems(baseline, values, reason, confirmed)

    setShown(problems)

    if (problems.length > 0) {
      focusAfterRender(summary)
      return
    }

    setBusy(true)

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...changed,
          revision,
          confirmMaterialChange: true,
          changeReason: reason.trim(),
        }),
      })
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        onSaved(body.data)
        return
      }

      if (body?.error?.code === 'STALE_REVISION') {
        onConflict(body.error.message)
        return
      }

      setRefusal({
        message: refusalSentence(response.status, body, 'The change was refused.'),
        problems: body?.error?.problems ?? [],
      })
    } catch {
      setRefusal({ message: 'The service is not responding. Nothing has changed.', problems: [] })
    } finally {
      setBusy(false)
    }
  }

  /**
   * One wall-clock box in the event's zone.
   *
   * @param {'startsAt'|'endsAt'} field Which instant.
   * @param {string} label The label.
   * @returns {JSX.Element} The field.
   */
  const instant = (field, label) => (
    <FormField
      label={`${label} (${zoneAbbreviation(zone, new Date(values[field] || Date.now()))})`}
      required
      description={`Local time at the venue — ${zone}.`}
      {...at(field)}
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

  return (
    <section
      aria-labelledby="material-heading"
      className="mt-4 space-y-4 rounded-card border border-status-warning/30 bg-surface-raised p-4"
    >
      <h2
        id="material-heading"
        ref={heading}
        tabIndex={-1}
        className="text-lg font-semibold text-ink focus-visible:outline-none"
      >
        Change date, place or terms
      </h2>
      <p className="text-sm text-ink-muted">
        People have bought tickets on the strength of these. A notice is recorded for every current
        order when you save. Notices are not emailed, so tell ticket holders yourself as well.
      </p>

      <form onSubmit={submit} noValidate className="space-y-4">
        {shown.length > 0 ? (
          <div
            ref={summary}
            tabIndex={-1}
            className="rounded-card border border-status-danger/25 bg-status-danger-soft p-4"
          >
            <h3 className="text-sm font-semibold text-status-danger">
              {shown.length === 1 ? 'One thing to fix' : `${shown.length} things to fix`}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-status-danger">
              {shown.map((problem) => (
                <li key={`${problem.field}-${problem.message}`}>
                  <a className="underline underline-offset-4" href={`#material-${problem.field}`}>
                    {problem.message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {refusal ? (
          <Alert variant="error" title="Not saved">
            <p>{refusal.message}</p>
            {refusal.problems.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {refusal.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}

        <FormField label="Time zone" required {...at('timezone')}>
          <TimeZoneSelect
            value={zone}
            onChange={(change) => set({ timezone: change.target.value })}
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {instant('startsAt', 'Starts')}
          {instant('endsAt', 'Ends')}
        </div>

        <fieldset className="space-y-3 rounded-card border border-line p-4">
          <legend className="px-1 text-sm font-medium text-ink">How people attend</legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              id="material-isOnline"
              className="size-4 rounded border-line-strong"
              checked={values.isOnline}
              onChange={(change) => set({ isOnline: change.target.checked })}
            />
            This event is online
          </label>
          {values.isOnline ? (
            <FormField
              label="Where to join"
              required
              description="Only people with a ticket see it."
              {...at('onlineUrl')}
            >
              <Input
                type="url"
                value={values.onlineUrl}
                onChange={(change) => set({ onlineUrl: change.target.value })}
              />
            </FormField>
          ) : (
            <FormField label="Venue" required {...at('venueId')}>
              <Select
                value={values.venueId}
                onChange={(change) => set({ venueId: change.target.value })}
              >
                <option value="">Choose a venue…</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name} — {venue.city}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
        </fieldset>

        <FormField
          label="Minimum age"
          description="Leave empty when there is no restriction."
          {...at('ageRestriction')}
        >
          <Input
            type="number"
            inputMode="numeric"
            min="0"
            max="120"
            value={values.ageRestriction}
            onChange={(change) => set({ ageRestriction: change.target.value })}
          />
        </FormField>

        <FormField label="Refunds" {...at('policyRefund')}>
          <Textarea
            rows={3}
            value={values.policyRefund}
            onChange={(change) => set({ policyRefund: change.target.value })}
          />
        </FormField>
        <FormField label="Getting in" {...at('policyEntry')}>
          <Textarea
            rows={3}
            value={values.policyEntry}
            onChange={(change) => set({ policyEntry: change.target.value })}
          />
        </FormField>
        <FormField label="House rules" {...at('policyConduct')}>
          <Textarea
            rows={3}
            value={values.policyConduct}
            onChange={(change) => set({ policyConduct: change.target.value })}
          />
        </FormField>
        <FormField label="What to bring for the age check" {...at('policyAgeNote')}>
          <Input
            value={values.policyAgeNote}
            onChange={(change) => set({ policyAgeNote: change.target.value })}
          />
        </FormField>

        <div
          aria-live="polite"
          className="rounded-card border border-line bg-surface-subtle p-3 text-sm text-ink"
        >
          {fields.length === 0
            ? 'You have not changed anything.'
            : `You are changing: ${fields.map((field) => MATERIAL_FIELD_LABELS[field] ?? field).join(', ')}.`}
        </div>

        <FormField
          label="Why this is changing"
          required
          description={`Kept with the notice on every order. ${reason.length.toLocaleString('en-US')} of ${REASON_LIMIT.toLocaleString('en-US')} characters.`}
          {...at('changeReason')}
        >
          <Textarea rows={3} value={reason} onChange={(change) => setReason(change.target.value)} />
        </FormField>

        {/* The id is on the box, not the label, so the summary's link lands
            focus on the control; the error is tied to it, so a screen reader
            hears why it is invalid when it gets there. */}
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            id="material-confirm"
            className="mt-1 size-4 rounded border-line-strong"
            checked={confirmed}
            aria-invalid={errors.confirm ? true : undefined}
            aria-describedby={errors.confirm ? 'material-confirm-error' : undefined}
            onChange={(change) => setConfirmed(change.target.checked)}
          />
          I understand this changes what people bought, and a notice will be recorded for every
          current order.
        </label>
        {errors.confirm ? (
          <p id="material-confirm-error" className="text-sm font-medium text-status-danger">
            {errors.confirm}
          </p>
        ) : null}

        {notice ? (
          <Alert variant="info" title="Not saved">
            <p>{notice}</p>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save the change'}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  )
}
