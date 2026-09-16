'use client'

/**
 * The event editor: seven steps, one draft, and a save that cannot silently
 * lose somebody else's work.
 *
 * ## Why it autosaves, and why that is dangerous
 *
 * Authoring an event is long. Somebody fills in a schedule, goes to find the
 * venue's postcode, comes back. A form that loses that to a closed tab is a
 * form people stop using, so this saves on its own.
 *
 * Autosave is also how two people overwrite each other without either of them
 * noticing: two tabs, or two colleagues, each with a copy of the draft, each
 * saving the whole form. So every write carries the revision it was based on.
 * The server refuses a write whose precondition no longer holds and answers
 * `STALE_REVISION`, and this stops, says so, and offers the two honest choices:
 * take their version, or keep yours to copy somewhere first. It does not merge.
 * A merge nobody asked for is how you end up with one person's date and
 * another's venue.
 *
 * ## Saying what happened
 *
 * The save status is text, in a polite live region. Not a spinner and not a
 * colour: "Saved 19:04" is a fact somebody can act on, and a green dot is not.
 * A failed save says what failed and leaves the value in the box — the one
 * thing a form must never do is clear a field it could not save.
 *
 * Validation is summarised at the top as a list of links into the fields that
 * are wrong, focus moves to the summary when a save is refused, and each link
 * moves focus to its field. That is the pattern a keyboard user needs and the
 * one a mouse user gets for free.
 *
 * ## What it does not decide
 *
 * Nothing. The steps are a way through the same `PATCH /v1/events/:id` the API
 * would take from anywhere; readiness, entitlement and the lifecycle are the
 * server's answers, rendered. A button hidden here is a convenience, never a
 * control: every one of them is authorised again on the way in.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-editor
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Alert, Badge, Button, FormField, Input, Select, Textarea } from './ui.jsx'
import { EventLifecyclePanel } from './event-lifecycle-panel.jsx'
import { EventSessionsEditor } from './event-sessions-editor.jsx'
import { EventTiersEditor } from './event-tiers-editor.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { ACCESSIBILITY_LABELS } from '../lib/accessibility.js'
// The one list of categories this application has. Duplicating it here is how
// a select ends up offering a value the API has never heard of.
import { EVENT_CATEGORIES } from '../lib/catalog.js'
import { EDITABLE, statusReading } from '../lib/event-status.js'
import {
  COMMON_ZONES,
  fromLocalInputValue,
  toLocalInputValue,
  zoneAbbreviation,
} from '../lib/zoned-time.js'

/** How long to wait after the last keystroke before saving. */
const AUTOSAVE_DELAY_MS = 1500

/** The steps, in the order somebody works through them. */
const STEPS = Object.freeze([
  { id: 'details', title: 'Details' },
  { id: 'schedule', title: 'When and where' },
  { id: 'sessions', title: 'Sessions' },
  { id: 'tickets', title: 'Tickets' },
  { id: 'policies', title: 'Policies and access' },
  { id: 'media', title: 'Media' },
  { id: 'review', title: 'Review' },
])

/**
 * The editable fields of an event, as the form holds them.
 *
 * Arrays become comma-separated text because that is how somebody types a list
 * of languages, and JSON columns become their own named boxes.
 *
 * @param {object} event The event as the API returned it.
 * @returns {object} The form's values.
 */
function toFormValues(event) {
  return {
    title: event.title ?? '',
    summary: event.summary ?? '',
    description: event.description ?? '',
    category: event.category ?? 'OTHER',
    slug: event.slug ?? '',
    languages: (event.languages ?? []).join(', '),
    artists: (event.artists ?? []).join(', '),
    timezone: event.timezone ?? 'Asia/Kolkata',
    startsAt: event.startsAt ?? '',
    endsAt: event.endsAt ?? '',
    venueId: event.venueId ?? '',
    isOnline: Boolean(event.isOnline),
    onlineUrl: event.onlineUrl ?? '',
    ageRestriction: event.ageRestriction == null ? '' : String(event.ageRestriction),
    coverImageUrl: event.coverImageUrl ?? '',
    policyEntry: event.policies?.entry ?? '',
    policyRefund: event.policies?.refund ?? '',
    policyConduct: event.policies?.conduct ?? '',
    policyAgeNote: event.policies?.ageNote ?? '',
    accessFeatures: event.accessibility?.features ?? [],
    accessNote: event.accessibility?.note ?? '',
  }
}

/**
 * The form's values as the API's update body.
 *
 * @param {object} values The form's values.
 * @returns {object} A body `updateEventRequestSchema` accepts.
 */
function toPatch(values) {
  /**
   * A comma-separated box as a list, with the empties dropped.
   *
   * @param {string} raw The box's contents.
   * @returns {string[]} The list.
   */
  const list = (raw) =>
    String(raw ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

  const patch = {
    title: values.title.trim(),
    summary: values.summary.trim(),
    description: values.description.trim(),
    category: values.category,
    slug: values.slug.trim(),
    languages: list(values.languages),
    artists: list(values.artists),
    timezone: values.timezone,
    startsAt: values.startsAt || undefined,
    endsAt: values.endsAt || undefined,
    venueId: values.isOnline ? null : values.venueId || null,
    isOnline: values.isOnline,
    onlineUrl: values.isOnline ? values.onlineUrl.trim() || null : null,
    ageRestriction: values.ageRestriction === '' ? null : Number(values.ageRestriction),
    coverImageUrl: values.coverImageUrl.trim() || null,
  }

  // Omitted rather than sent empty. A `policies` object whose every field is
  // null is not "no policies"; it is a policies object, and a publication gate
  // that asks whether one exists would wave it through while the buyer has
  // agreed to nothing. The same for accessibility: an empty claim list is a
  // claim of nothing, and writing it would be indistinguishable from an
  // organiser who considered the question and answered no.
  const policies = {
    entry: values.policyEntry.trim() || null,
    refund: values.policyRefund.trim() || null,
    conduct: values.policyConduct.trim() || null,
    ageNote: values.policyAgeNote.trim() || null,
  }

  if (Object.values(policies).some(Boolean)) patch.policies = policies

  const note = values.accessNote.trim() || null

  if (values.accessFeatures.length > 0 || note) {
    patch.accessibility = { features: values.accessFeatures, note }
  }

  return patch
}

/**
 * What would make the save itself fail.
 *
 * Deliberately *only* that. A draft is allowed to be incomplete — being
 * incomplete is what a draft is — so "you have not chosen a venue yet" belongs
 * in the readiness checklist, not in the way of saving the sentence somebody
 * has just typed. Blocking autosave on incompleteness means an organiser
 * cannot keep any of their work until the whole thing is finished, which is
 * exactly backwards and is what this used to do.
 *
 * Every rule here mirrors one the API's schema enforces, so a save that passes
 * this and then fails is a bug rather than a normal outcome. The server's
 * answer is still the one that counts; this exists so that a title somebody
 * has just emptied does not cost a round trip to be told the same thing.
 *
 * @param {object} values The form's values.
 * @returns {Array<{field: string, message: string}>} One entry per problem.
 */
export function formProblems(values) {
  const problems = []

  if (!values.title.trim()) problems.push({ field: 'title', message: 'Give the event a title.' })
  if (!values.summary.trim()) {
    problems.push({
      field: 'summary',
      message: 'Write a one-line summary. It is what a card shows.',
    })
  }
  if (!values.description.trim()) {
    problems.push({ field: 'description', message: 'Describe the event.' })
  }

  if (values.startsAt && values.endsAt && new Date(values.endsAt) <= new Date(values.startsAt)) {
    problems.push({ field: 'endsAt', message: 'The event has to end after it starts.' })
  }

  if (values.ageRestriction !== '' && !Number.isInteger(Number(values.ageRestriction))) {
    problems.push({ field: 'ageRestriction', message: 'An age restriction is a whole number.' })
  }

  return problems
}

/**
 * What is missing, which is a different question from what is wrong.
 *
 * These save perfectly well and will stop the event being published. They are
 * shown as a note rather than as an error, because an organiser halfway
 * through filling a form has not made a mistake.
 *
 * The authoritative version of this list is the server's readiness result, on
 * the review step. This is the subset the form can see for itself, so somebody
 * on the schedule step finds out there before walking to the end.
 *
 * @param {object} values The form's values.
 * @returns {Array<{field: string, message: string}>} One entry per gap.
 */
export function formGaps(values) {
  const gaps = []

  if (values.isOnline && !values.onlineUrl.trim()) {
    gaps.push({
      field: 'onlineUrl',
      message: 'An online event needs an address to join it at before it can be published.',
    })
  }

  if (!values.isOnline && !values.venueId) {
    gaps.push({
      field: 'venueId',
      message: 'Choose a venue, or mark the event as online, before publishing.',
    })
  }

  return gaps
}

/**
 * @typedef {object} EventEditorProps
 * @property {object} event The event as loaded.
 * @property {object[]} venues Venues this organisation may use.
 * @property {object[]} sessions The event's sessions, as loaded.
 * @property {object[]} mapVersions Published seating map versions for the event's venue.
 * @property {object[]} preview The server's all-in price breakdown per tier.
 * @property {object} readiness The server's readiness result.
 * @property {object} transitions The server's available transitions.
 * @property {object[]} history The moderation history, newest first.
 */

/**
 * The editor.
 *
 * @param {EventEditorProps} props Component props.
 * @returns {JSX.Element} The rendered editor.
 */
export function EventEditor({
  event,
  venues = [],
  sessions = [],
  mapVersions = [],
  preview = [],
  readiness = null,
  transitions = null,
  history = [],
}) {
  const [values, setValues] = useState(() => toFormValues(event))
  const [baseline, setBaseline] = useState(() => toFormValues(event))
  const [revision, setRevision] = useState(event.revision ?? 0)
  const [status, setStatus] = useState(event.status)
  const [step, setStep] = useState('details')
  const [save, setSave] = useState({ kind: 'idle', message: 'No changes yet.' })
  const [serverProblems, setServerProblems] = useState([])
  const [conflict, setConflict] = useState(null)

  const summaryRef = useRef(null)
  const timer = useRef(null)

  const editable = EDITABLE.has(status)
  const reading = statusReading(status)
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(baseline),
    [values, baseline],
  )
  const problems = useMemo(() => formProblems(values), [values])
  const gaps = useMemo(() => formGaps(values), [values])

  /**
   * Change one field.
   *
   * @param {string} field The field name.
   * @param {unknown} value Its new value.
   * @returns {void}
   */
  const setField = useCallback((field, value) => {
    setValues((current) => ({ ...current, [field]: value }))
  }, [])

  /**
   * Send the draft.
   *
   * @param {object} [options] Options.
   * @param {boolean} [options.silent] Whether this is an autosave rather than a press.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  const commit = useCallback(
    async ({ silent = false } = {}) => {
      if (problems.length > 0) {
        setSave({
          kind: 'error',
          message: `Not saved: ${problems.length} ${problems.length === 1 ? 'thing needs' : 'things need'} fixing first.`,
        })

        if (!silent) queueMicrotask(() => summaryRef.current?.focus())
        return
      }

      setSave({ kind: 'saving', message: 'Saving…' })
      setServerProblems([])

      try {
        const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...toPatch(values), revision }),
        })

        const body = await response.json().catch(() => null)

        if (response.ok) {
          setRevision(body.data.revision)
          setStatus(body.data.status)
          setBaseline(toFormValues(body.data))
          setSave({
            kind: 'saved',
            message: `Saved at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`,
          })
          return
        }

        if (body?.error?.code === 'STALE_REVISION') {
          // Stop. Do not retry, do not merge: both would destroy somebody's
          // work, and the second would do it in a way nobody could reconstruct.
          setConflict(body.error.message)
          setSave({ kind: 'conflict', message: 'Not saved. Somebody else changed this event.' })
          queueMicrotask(() => summaryRef.current?.focus())
          return
        }

        setServerProblems(body?.error?.problems ?? [])
        setSave({
          kind: 'error',
          message: `Not saved. ${body?.error?.message ?? 'The API refused.'}`,
        })
        queueMicrotask(() => summaryRef.current?.focus())
      } catch {
        setSave({
          kind: 'error',
          message:
            'Not saved. The service is not responding — your changes are still in the boxes.',
        })
      }
    },
    [event.id, problems, revision, values],
  )

  // Autosave. Deliberately not on an interval: a timer that fires while
  // somebody is mid-sentence saves half a word and announces it.
  useEffect(() => {
    if (!editable || conflict) return undefined

    if (!dirty) {
      // The boxes match what was saved, so whatever went wrong a moment ago is
      // no longer true. Leaving "not saved: 1 thing needs fixing" up after
      // somebody has undone the thing is a message about a state that does not
      // exist — and it is the message they will act on.
      //
      // A successful save's own "Saved at 19:04" is left alone: that is a fact,
      // and it is more useful than "no unsaved changes".
      setSave((current) =>
        current.kind === 'error' || current.kind === 'unsaved'
          ? { kind: 'idle', message: 'No unsaved changes.' }
          : current,
      )

      return undefined
    }

    if (problems.length > 0) {
      setSave({ kind: 'unsaved', message: 'Not saved yet — some fields need attention.' })
      return undefined
    }

    setSave({ kind: 'unsaved', message: 'Unsaved changes.' })

    timer.current = setTimeout(() => commit({ silent: true }), AUTOSAVE_DELAY_MS)

    return () => clearTimeout(timer.current)
  }, [commit, conflict, dirty, editable, problems.length])

  /**
   * Take the server's version, losing whatever is in the boxes.
   *
   * @returns {Promise<void>} Resolves when the reload is done.
   */
  async function takeTheirs() {
    const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}`)
    const body = await response.json().catch(() => null)

    if (!response.ok || !body?.data) {
      setSave({ kind: 'error', message: 'Could not load the current version. Reload the page.' })
      return
    }

    setValues(toFormValues(body.data))
    setBaseline(toFormValues(body.data))
    setRevision(body.data.revision)
    setStatus(body.data.status)
    setConflict(null)
    setSave({
      kind: 'saved',
      message: 'Loaded the current version. Your unsaved changes are gone.',
    })
  }

  const allProblems = [
    ...problems.map((problem) => ({ ...problem, id: `event-${problem.field}` })),
    ...serverProblems.map((message, index) => ({ field: null, message, id: `server-${index}` })),
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={reading.tone} srLabel="State:">
            {reading.label}
          </Badge>
          <span className="text-sm text-slate-600">Revision {revision}</span>
        </div>

        {/*
          Text, in a polite live region, so a screen reader hears "Saved at
          19:04" without being interrupted mid-sentence. A spinner announces
          nothing and a colour announces nothing.
        */}
        <p
          data-testid="save-status"
          data-save-state={save.kind}
          role="status"
          aria-live="polite"
          className="text-sm font-medium text-slate-700"
        >
          {save.message}
        </p>
      </div>

      <p className="mt-2 text-sm text-slate-600">{reading.next}</p>

      {conflict ? (
        <Alert
          variant="warning"
          title="Somebody else saved this event while you were editing"
          className="mt-4"
        >
          <p>{conflict}</p>
          <p className="mt-2">
            Nothing of yours has been sent and nothing of theirs has been overwritten. Copy anything
            you need out of the boxes before you take their version.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={takeTheirs}>
              Load their version and lose mine
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConflict(null)}>
              Keep mine open so I can copy it
            </Button>
          </div>
        </Alert>
      ) : null}

      {allProblems.length > 0 ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          data-testid="validation-summary"
          className="mt-4 rounded-card border border-rose-200 bg-rose-50 p-4"
        >
          <h2 className="text-sm font-semibold text-rose-900">
            {allProblems.length === 1
              ? 'One thing needs fixing before this can be saved'
              : `${allProblems.length} things need fixing before this can be saved`}
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-900">
            {allProblems.map((problem) => (
              <li key={problem.id}>
                {problem.field ? (
                  <a className="underline underline-offset-4" href={`#event-${problem.field}`}>
                    {problem.message}
                  </a>
                ) : (
                  problem.message
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {gaps.length > 0 && editable ? (
        <div
          data-testid="readiness-gaps"
          className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-4"
        >
          <h2 className="text-sm font-semibold text-amber-900">
            Still to do before this can be published
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            None of this stops the draft saving. The review step has the full list.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {gaps.map((gap) => (
              <li key={gap.field}>
                <a className="underline underline-offset-4" href={`#event-${gap.field}`}>
                  {gap.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!editable ? (
        <Alert variant="info" title="This event is not open for editing" className="mt-4">
          <p>{reading.next}</p>
        </Alert>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[14rem_1fr] lg:items-start">
        {/* Real buttons in a list: tab reaches them, Enter and Space work, and
            `aria-current` says which one you are on without relying on colour. */}
        <nav aria-label="Editor steps" className="lg:sticky lg:top-24">
          <ol className="flex flex-wrap gap-2 lg:flex-col">
            {STEPS.map((entry, index) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setStep(entry.id)}
                  aria-current={step === entry.id ? 'step' : undefined}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none ${
                    step === entry.id
                      ? 'bg-indigo-night-900 font-semibold text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <span className="text-xs text-current/70">Step {index + 1}</span>
                  <span className="block">{entry.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0">
          {step === 'details' ? (
            <DetailsStep values={values} setField={setField} editable={editable} />
          ) : null}
          {step === 'schedule' ? (
            <ScheduleStep values={values} setField={setField} editable={editable} venues={venues} />
          ) : null}
          {/*
            Rendered here rather than handed down pre-rendered from the server,
            because all three steps write to the same event and every authoring
            write carries a revision precondition. A panel holding its own copy
            of the revision is stale the moment any other step saves — which is
            not a rare race: choosing a venue on one step and adding a session
            on the next is the ordinary way through this form.
          */}
          {step === 'sessions' ? (
            <EventSessionsEditor
              event={event}
              sessions={sessions}
              mapVersions={mapVersions}
              editable={editable}
              revision={revision}
              onRevision={setRevision}
            />
          ) : null}
          {step === 'tickets' ? (
            <EventTiersEditor
              event={event}
              sessions={sessions}
              preview={preview}
              editable={editable}
              revision={revision}
              onRevision={setRevision}
            />
          ) : null}
          {step === 'policies' ? (
            <PoliciesStep values={values} setField={setField} editable={editable} />
          ) : null}
          {step === 'media' ? (
            <MediaStep values={values} setField={setField} editable={editable} />
          ) : null}
          {step === 'review' && readiness ? (
            <EventLifecyclePanel
              event={{ ...event, status }}
              readiness={readiness}
              transitions={transitions}
              history={history}
              revision={revision}
            />
          ) : null}

          {editable && step !== 'sessions' && step !== 'tickets' && step !== 'review' ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => commit()} disabled={save.kind === 'saving'}>
                {dirty ? 'Save now' : 'Saved'}
              </Button>
              <span className="text-sm text-slate-600">
                Changes save on their own about a second after you stop typing.
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * @typedef {object} StepProps
 * @property {object} values The form's values.
 * @property {Function} setField Change one field.
 * @property {boolean} editable Whether the fields accept input.
 * @property {object[]} [venues] Venues to choose from.
 */

/**
 * What the event is.
 *
 * @param {StepProps} props Component props.
 * @returns {JSX.Element} The step.
 */
function DetailsStep({ values, setField, editable }) {
  return (
    <section aria-labelledby="details-heading" className="space-y-5">
      <h2 id="details-heading" className="text-xl font-bold text-indigo-night-900">
        Details
      </h2>

      <FormField label="Title" id="event-title" required>
        <Input
          value={values.title}
          disabled={!editable}
          onChange={(change) => setField('title', change.target.value)}
        />
      </FormField>

      <FormField
        label="One-line summary"
        id="event-summary"
        required
        description="What a card shows in a listing. One sentence."
      >
        <Input
          value={values.summary}
          disabled={!editable}
          maxLength={200}
          onChange={(change) => setField('summary', change.target.value)}
        />
      </FormField>

      <FormField label="Description" id="event-description" required>
        <Textarea
          rows={8}
          value={values.description}
          disabled={!editable}
          onChange={(change) => setField('description', change.target.value)}
        />
      </FormField>

      <FormField label="Category" id="event-category" required>
        <Select
          value={values.category}
          disabled={!editable}
          onChange={(change) => setField('category', change.target.value)}
        >
          {EVENT_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Web address"
        id="event-slug"
        description="The last part of the public URL. Changing it after people have shared the link will break their link."
      >
        <Input
          value={values.slug}
          disabled={!editable}
          onChange={(change) => setField('slug', change.target.value)}
        />
      </FormField>

      <FormField
        label="Languages"
        id="event-languages"
        description="Separated by commas, for example: Gujarati, Hindi"
      >
        <Input
          value={values.languages}
          disabled={!editable}
          onChange={(change) => setField('languages', change.target.value)}
        />
      </FormField>

      <FormField
        label="Line-up"
        id="event-artists"
        description="Separated by commas, in billing order."
      >
        <Input
          value={values.artists}
          disabled={!editable}
          onChange={(change) => setField('artists', change.target.value)}
        />
      </FormField>
    </section>
  )
}

/**
 * When it is on and where.
 *
 * @param {StepProps} props Component props.
 * @returns {JSX.Element} The step.
 */
function ScheduleStep({ values, setField, editable, venues }) {
  const zone = values.timezone
  const abbreviation = zoneAbbreviation(zone)

  /**
   * Set a timestamp from a wall-clock box.
   *
   * @param {string} field Which timestamp.
   * @param {string} local The `YYYY-MM-DDTHH:mm` value.
   * @returns {void}
   */
  const setInstant = (field, local) => setField(field, fromLocalInputValue(local, zone) ?? '')

  return (
    <section aria-labelledby="schedule-heading" className="space-y-5">
      <h2 id="schedule-heading" className="text-xl font-bold text-indigo-night-900">
        When and where
      </h2>

      <FormField
        label="Time zone"
        id="event-timezone"
        required
        description="The zone the times below are in. The venue's local time, not yours."
      >
        <Select
          value={zone}
          disabled={!editable}
          onChange={(change) => setField('timezone', change.target.value)}
        >
          {[...new Set([zone, ...COMMON_ZONES])].filter(Boolean).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label={`Starts${abbreviation ? ` (${abbreviation})` : ''}`}
        id="event-startsAt"
        required
        description={`Local time at the venue — ${zone}.`}
      >
        <Input
          type="datetime-local"
          value={toLocalInputValue(values.startsAt, zone)}
          disabled={!editable}
          onChange={(change) => setInstant('startsAt', change.target.value)}
        />
      </FormField>

      <FormField
        label={`Ends${abbreviation ? ` (${abbreviation})` : ''}`}
        id="event-endsAt"
        required
        description={`Local time at the venue — ${zone}.`}
      >
        <Input
          type="datetime-local"
          value={toLocalInputValue(values.endsAt, zone)}
          disabled={!editable}
          onChange={(change) => setInstant('endsAt', change.target.value)}
        />
      </FormField>

      <fieldset className="rounded-card border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium text-slate-800">How people attend</legend>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            id="event-isOnline"
            checked={values.isOnline}
            disabled={!editable}
            onChange={(change) => setField('isOnline', change.target.checked)}
            className="size-4 rounded border-slate-300"
          />
          This event is online
        </label>

        {values.isOnline ? (
          <div className="mt-4">
            <FormField
              label="Where to join"
              id="event-onlineUrl"
              required
              description="The address attendees are sent. It is not shown publicly before they have a ticket."
            >
              <Input
                type="url"
                value={values.onlineUrl}
                disabled={!editable}
                onChange={(change) => setField('onlineUrl', change.target.value)}
              />
            </FormField>
          </div>
        ) : (
          <div className="mt-4">
            <FormField
              label="Venue"
              id="event-venueId"
              required
              description="Venues your organisation can use, plus the shared ones."
            >
              <Select
                value={values.venueId}
                disabled={!editable}
                onChange={(change) => setField('venueId', change.target.value)}
              >
                <option value="">Choose a venue…</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name} — {venue.city}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        )}
      </fieldset>
    </section>
  )
}

/**
 * The terms and who can come in.
 *
 * @param {StepProps} props Component props.
 * @returns {JSX.Element} The step.
 */
function PoliciesStep({ values, setField, editable }) {
  /**
   * Turn one accessibility claim on or off.
   *
   * @param {string} code The claim.
   * @param {boolean} on Whether it is claimed.
   * @returns {void}
   */
  const toggle = (code, on) =>
    setField(
      'accessFeatures',
      on
        ? [...new Set([...values.accessFeatures, code])]
        : values.accessFeatures.filter((entry) => entry !== code),
    )

  return (
    <section aria-labelledby="policies-heading" className="space-y-5">
      <h2 id="policies-heading" className="text-xl font-bold text-indigo-night-900">
        Policies and access
      </h2>

      <Alert variant="info" title="These are copied onto every order">
        <p>
          The policies in force for an order are the ones as they stood when it was placed. Editing
          them here changes the terms for future buyers, not past ones — and after publication, a
          change to them has to be confirmed and is sent to everybody holding a ticket.
        </p>
      </Alert>

      <FormField
        label="Refunds"
        id="event-policyRefund"
        description="The one a person looks for when something has gone wrong. Say what you will and will not refund, and by when."
      >
        <Textarea
          rows={4}
          value={values.policyRefund}
          disabled={!editable}
          onChange={(change) => setField('policyRefund', change.target.value)}
        />
      </FormField>

      <FormField label="Getting in" id="event-policyEntry">
        <Textarea
          rows={4}
          value={values.policyEntry}
          disabled={!editable}
          onChange={(change) => setField('policyEntry', change.target.value)}
        />
      </FormField>

      <FormField label="House rules" id="event-policyConduct">
        <Textarea
          rows={4}
          value={values.policyConduct}
          disabled={!editable}
          onChange={(change) => setField('policyConduct', change.target.value)}
        />
      </FormField>

      <FormField
        label="Minimum age"
        id="event-ageRestriction"
        description="Leave empty when there is no restriction."
      >
        <Input
          type="number"
          min="0"
          max="120"
          value={values.ageRestriction}
          disabled={!editable}
          onChange={(change) => setField('ageRestriction', change.target.value)}
        />
      </FormField>

      <FormField
        label="What to bring for the age check"
        id="event-policyAgeNote"
        description="Shown beside the age restriction on the public page."
      >
        <Input
          value={values.policyAgeNote}
          disabled={!editable}
          onChange={(change) => setField('policyAgeNote', change.target.value)}
        />
      </FormField>

      <fieldset className="rounded-card border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium text-slate-800">
          Accessibility for this event
        </legend>
        <p className="mt-1 text-sm text-slate-600">
          These are added to whatever the venue already claims. Tick only what is true: somebody is
          going to decide whether they can come on the strength of it.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(ACCESSIBILITY_LABELS).map(([code, label]) => (
            <label key={code} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={values.accessFeatures.includes(code)}
                disabled={!editable}
                onChange={(change) => toggle(code, change.target.checked)}
                className="size-4 rounded border-slate-300"
              />
              {label}
            </label>
          ))}
        </div>

        <div className="mt-4">
          <FormField
            label="Anything the list cannot say"
            id="event-accessNote"
            description="For example: this performance is captioned; the accessible entrance is Gate 3."
          >
            <Textarea
              rows={3}
              value={values.accessNote}
              disabled={!editable}
              onChange={(change) => setField('accessNote', change.target.value)}
            />
          </FormField>
        </div>
      </fieldset>
    </section>
  )
}

/**
 * The poster.
 *
 * @param {StepProps} props Component props.
 * @returns {JSX.Element} The step.
 */
function MediaStep({ values, setField, editable }) {
  return (
    <section aria-labelledby="media-heading" className="space-y-5">
      <h2 id="media-heading" className="text-xl font-bold text-indigo-night-900">
        Media
      </h2>

      <FormField
        label="Cover image address"
        id="event-coverImageUrl"
        description="A link to an image you have the right to use. Left empty, the listing draws a generated poster rather than a broken image."
      >
        <Input
          type="url"
          value={values.coverImageUrl}
          disabled={!editable}
          onChange={(change) => setField('coverImageUrl', change.target.value)}
        />
      </FormField>

      {values.coverImageUrl ? (
        <figure className="max-w-md">
          {/* A plain `img`, not `next/image`: an arbitrary external address
              cannot go through the optimiser, and the point of this preview is
              to show exactly what the organiser typed — including when it is
              wrong. */}
          <img
            src={values.coverImageUrl}
            alt=""
            className="w-full rounded-card border border-slate-200"
          />
          <figcaption className="mt-2 text-sm text-slate-600">
            If this is blank or broken, the address is wrong.
          </figcaption>
        </figure>
      ) : null}
    </section>
  )
}
