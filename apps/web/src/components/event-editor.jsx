'use client'

/**
 * The event editor: nine steps, one draft, and a save that cannot silently
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
 * colour: "Saved at 7:04 PM" is a fact somebody can act on, and a green dot is not.
 * A failed save says what failed and leaves the value in the box — the one
 * thing a form must never do is clear a field it could not save.
 *
 * Validation is summarised at the top as a list of links into the fields that
 * are wrong, focus moves to the summary when a save is refused, and each link
 * moves focus to its field. That is the pattern a keyboard user needs and the
 * one a mouse user gets for free.
 *
 * ## After publication
 *
 * A public event is still edited here, in `live` mode. The description, the
 * line-up, the questions and the other housekeeping still autosave, and only
 * those fields are sent. The date, the place and the terms are read-only in
 * the steps: somebody bought a ticket on the strength of them, so they change
 * through the material change panel, with a reason and a confirmation, and the
 * API records a notice for every current order. In review, approved, rejected
 * or finished, nothing is edited here (`locked`).
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

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Alert, Badge, Button, FormField, Input, Select, Textarea } from './ui.jsx'
import { TEXT_LINK } from './link-classes.js'
import { GuestInfoStep, ProgrammeStep } from './event-content-steps.jsx'
import { EventLifecyclePanel } from './event-lifecycle-panel.jsx'
import { EventMediaEditor } from './event-media-editor.jsx'
import { EventSessionsEditor } from './event-sessions-editor.jsx'
import { EventTiersEditor } from './event-tiers-editor.jsx'
import { MaterialChangePanel } from './material-change-panel.jsx'
import { RichTextField } from './rich-text-field.jsx'
import { TimeZoneSelect } from './time-zone-select.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { refusalSentence } from '../lib/refusal.js'
import { ACCESSIBILITY_LABELS } from '../lib/accessibility.js'
// The one list of categories this application has. Duplicating it here is how
// a select ends up offering a value the API has never heard of.
import { EVENT_CATEGORIES } from '../lib/catalog.js'
import {
  CONTENT_LIMITS,
  DESCRIPTION_LIMIT,
  contentProblems,
  fromEventContent,
  toContentPatch,
} from '../lib/event-content.js'
import { MATERIAL_FIELDS, editMode, statusReading } from '../lib/event-status.js'
import { fromLocalInputValue, toLocalInputValue, zoneAbbreviation } from '../lib/zoned-time.js'

/** How long to wait after the last keystroke before saving. */
const AUTOSAVE_DELAY_MS = 1500

/**
 * The steps, in the order somebody works through them.
 *
 * The first six keep the numbers they have always had — people, tests and the
 * browser suites find "Step 3 Sessions" and "Step 6 Media" by them — and the
 * two content steps come after the pictures, before the review. No new step's
 * name contains "details" or "review", so a search for either still finds one.
 */
const STEPS = Object.freeze([
  { id: 'details', title: 'Details' },
  { id: 'schedule', title: 'When and where' },
  { id: 'sessions', title: 'Sessions' },
  { id: 'tickets', title: 'Tickets' },
  { id: 'policies', title: 'Policies and access' },
  { id: 'media', title: 'Media' },
  { id: 'programme', title: 'Line-up and running order' },
  { id: 'guests', title: 'Guest information' },
  { id: 'review', title: 'Review' },
])

/** The steps whose fields belong to the event itself and save through the shell. */
const FORM_STEPS = new Set(['details', 'schedule', 'policies', 'programme', 'guests'])

/**
 * The form fields that carry a material field, and are changed on a public
 * event only through the material change panel.
 */
const MATERIAL_FORM_FIELDS = Object.freeze([
  'startsAt',
  'endsAt',
  'timezone',
  'venueId',
  'isOnline',
  'onlineUrl',
  'ageRestriction',
  'policyEntry',
  'policyRefund',
  'policyConduct',
  'policyAgeNote',
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
    timezone: event.timezone ?? 'America/New_York',
    startsAt: event.startsAt ?? '',
    endsAt: event.endsAt ?? '',
    venueId: event.venueId ?? '',
    isOnline: Boolean(event.isOnline),
    onlineUrl: event.onlineUrl ?? '',
    ageRestriction: event.ageRestriction == null ? '' : String(event.ageRestriction),
    policyEntry: event.policies?.entry ?? '',
    policyRefund: event.policies?.refund ?? '',
    policyConduct: event.policies?.conduct ?? '',
    policyAgeNote: event.policies?.ageNote ?? '',
    accessFeatures: event.accessibility?.features ?? [],
    accessNote: event.accessibility?.note ?? '',
    // The line-up, running order, questions, contact, links, sponsors, dress
    // code and directions.
    ...fromEventContent(event),
  }
}

/**
 * The form's values as the API's update body.
 *
 * @param {object} values The form's values.
 * @returns {object} A body `updateEventRequestSchema` accepts.
 */
export function toPatch(values) {
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
    timezone: values.timezone,
    startsAt: values.startsAt || undefined,
    endsAt: values.endsAt || undefined,
    venueId: values.isOnline ? null : values.venueId || null,
    isOnline: values.isOnline,
    onlineUrl: values.isOnline ? values.onlineUrl.trim() || null : null,
    ageRestriction: values.ageRestriction === '' ? null : Number(values.ageRestriction),
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

  // The line-up is sent as performers; the server keeps the names in
  // `artists` in step with them.
  return { ...patch, ...toContentPatch(values) }
}

/**
 * The part of the update body a public event may autosave.
 *
 * Everything except the material fields. Those change only through the
 * material change panel, with a reason — and leaving them out here means an
 * autosave can never be refused for a change nobody meant, such as the same
 * policies in a different key order.
 *
 * @param {object} values The form's values.
 * @returns {object} The body, without the material fields.
 */
export function toHousekeepingPatch(values) {
  const patch = toPatch(values)

  for (const field of MATERIAL_FIELDS) delete patch[field]

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
  } else if (values.description.trim().length > DESCRIPTION_LIMIT) {
    problems.push({
      field: 'description',
      message: `Keep the description to ${DESCRIPTION_LIMIT.toLocaleString('en-US')} characters.`,
    })
  }

  const slug = String(values.slug ?? '').trim()

  if (!slug) {
    problems.push({ field: 'slug', message: 'Give the event a web address.' })
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug.toLowerCase()) || slug.length > 140) {
    problems.push({
      field: 'slug',
      message:
        'Use lower-case letters, numbers and single hyphens for the web address, such as diwali-mela-2026.',
    })
  }

  if (values.startsAt && values.endsAt && new Date(values.endsAt) <= new Date(values.startsAt)) {
    problems.push({ field: 'endsAt', message: 'The event has to end after it starts.' })
  }

  if (values.ageRestriction !== '' && !Number.isInteger(Number(values.ageRestriction))) {
    problems.push({ field: 'ageRestriction', message: 'An age restriction is a whole number.' })
  }

  return [...problems, ...contentProblems(values)]
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
 * Which step holds a field, so a link in the problem summary can open it.
 *
 * @param {string} field The field id, without the `event-` prefix.
 * @returns {string|null} The step's id, or null when no step holds it.
 */
export function stepOfField(field) {
  if (['title', 'summary', 'description', 'category', 'slug', 'languages'].includes(field)) {
    return 'details'
  }
  if (
    ['timezone', 'startsAt', 'endsAt', 'venueId', 'isOnline', 'onlineUrl', 'directions'].includes(
      field,
    )
  ) {
    return 'schedule'
  }
  if (/^(policy|access)/u.test(field) || field === 'ageRestriction' || field === 'dressCode') {
    return 'policies'
  }
  if (/^(performers|runningOrder)/u.test(field)) return 'programme'
  if (
    /^(faq|sponsors|social-)/u.test(field) ||
    field === 'publicEmail' ||
    field === 'publicPhone'
  ) {
    return 'guests'
  }

  return null
}

/**
 * @typedef {object} EventEditorProps
 * @property {object} event The event as loaded.
 * @property {object[]} venues Venues this organisation may use.
 * @property {object[]} sessions The event's sessions, as loaded, with their usage and price zones.
 * @property {object[]} [tiers] The event's ticket types from the organiser's read (`GET /v1/events/:id/tiers`).
 * @property {object[]} mapVersions Published seating map versions for the event's venue.
 * @property {object[]} preview The server's all-in price breakdown per tier.
 * @property {object} readiness The server's readiness result.
 * @property {object} transitions The server's available transitions.
 * @property {object[]} history The moderation history, newest first.
 * @property {object[]} [media] The event's pictures with their review state, from `GET /v1/events/:id/media`.
 * @property {{status: number, code: string|null, retryAfterSeconds: number|null}|null} [mediaFailure] Why the pictures could not be read, from `mediaReadFailure`; the Media step then shows that instead of an empty list.
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
  tiers = null,
  mapVersions = [],
  preview = [],
  readiness = null,
  transitions = null,
  history = [],
  media = [],
  mediaFailure = null,
}) {
  const [values, setValues] = useState(() => toFormValues(event))
  const [baseline, setBaseline] = useState(() => toFormValues(event))
  const [revision, setRevision] = useState(event.revision ?? 0)
  // Held here for the same reason as the revision: the Media step unmounts
  // whenever another step is chosen, and a list kept inside it would come
  // back as the one the page first loaded.
  const [pictures, setPictures] = useState(media)
  // The same for the sessions and the ticket types: each step reloads its list
  // after a write and hands it back, and the tickets step offers the sessions
  // the sessions step has just added.
  const [sessionList, setSessionList] = useState(sessions)
  const [tierList, setTierList] = useState(tiers)
  const [pricePreview, setPricePreview] = useState(preview)
  const [materialOpen, setMaterialOpen] = useState(false)
  const [status, setStatus] = useState(event.status)
  const [step, setStep] = useState('details')
  const [save, setSave] = useState({ kind: 'idle', message: 'No changes made.' })
  const [serverProblems, setServerProblems] = useState([])
  const [conflict, setConflict] = useState(null)
  // Everything here is client-side: until hydration the step buttons, the
  // autosave and the lifecycle panel do nothing. `data-enhanced` marks the
  // moment they start to, for anything that has to wait for it.
  const [enhanced, setEnhanced] = useState(false)

  useEffect(() => setEnhanced(true), [])

  const summaryRef = useRef(null)
  const timer = useRef(null)

  const mode = editMode(status)
  // Whether the step fields accept input at all, and whether the material ones
  // do. On a public event the second is false: they change through the panel.
  const editable = mode !== 'locked'
  const materialEditable = mode === 'draft'
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
        // A public event autosaves its housekeeping only; the date, place and
        // terms go through the material change panel.
        const patch = mode === 'live' ? toHousekeepingPatch(values) : toPatch(values)
        const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...patch, revision }),
        })

        const body = await response.json().catch(() => null)

        if (response.ok) {
          setRevision(body.data.revision)
          setStatus(body.data.status)
          setBaseline(toFormValues(body.data))
          setSave({
            kind: 'saved',
            message: `Saved at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`,
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
          message: `Not saved. ${refusalSentence(response.status, body, 'The API refused.')}`,
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
    [event.id, mode, problems, revision, values],
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
      // A successful save's own "Saved at 7:04 PM" is left alone: that is a fact,
      // and it is more useful than "no unsaved changes".
      setSave((current) =>
        current.kind === 'error' || current.kind === 'unsaved'
          ? { kind: 'idle', message: 'No unsaved changes.' }
          : current,
      )

      return undefined
    }

    if (problems.length > 0) {
      setSave({ kind: 'unsaved', message: 'Not saved — some fields need attention.' })
      return undefined
    }

    setSave({ kind: 'unsaved', message: 'Unsaved changes.' })

    timer.current = setTimeout(() => commit({ silent: true }), AUTOSAVE_DELAY_MS)

    return () => clearTimeout(timer.current)
  }, [commit, conflict, dirty, editable, problems.length])

  /**
   * Fold a saved material change back in.
   *
   * The panel's fields become the saved ones; anything else still in the boxes
   * and not yet autosaved stays, and saves on its own as before.
   *
   * @param {object} detail The event the API returned.
   * @returns {void}
   */
  function materialSaved(detail) {
    const saved = toFormValues(detail)

    setRevision(detail.revision)
    setStatus(detail.status)
    setBaseline(saved)
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(MATERIAL_FORM_FIELDS.map((field) => [field, saved[field]])),
    }))
    setMaterialOpen(false)
    setSave({
      kind: 'saved',
      message: `Change saved at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. A notice has been recorded for every current order.`,
    })
  }

  /**
   * Take a lifecycle command's answer as the event's new state.
   *
   * The review panel sends the command; this shell holds the status, the
   * revision and the saved values every other step writes with. A rework
   * moves REJECTED to DRAFT, which unlocks the fields; a reschedule moves the
   * revision, the dates and the nights. Without taking both in here the fields
   * stay locked until a reload, and the next save carries the old revision and
   * is refused as if somebody else had edited the event. `router.refresh()`
   * does not do this: it keeps client state as it was.
   *
   * A field the command changed on the server is taken into the boxes; one it
   * left alone keeps whatever is typed there, saved or not.
   *
   * @param {object} detail The event as the server returned it.
   * @returns {Promise<void>} Resolves once the nights are re-read.
   */
  async function lifecycleChanged(detail) {
    if (!detail) return

    const saved = toFormValues(detail)
    const moved = Object.keys(saved).filter(
      (field) => JSON.stringify(saved[field]) !== JSON.stringify(baseline[field]),
    )

    if (Number.isInteger(detail.revision)) setRevision(detail.revision)
    if (detail.status) setStatus(detail.status)
    setBaseline(saved)
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(moved.map((field) => [field, saved[field]])),
    }))

    // Only a reschedule moves the nights, and it moved the event's dates too.
    if (!moved.includes('startsAt') && !moved.includes('endsAt')) return

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}/sessions`)
      const body = await response.json().catch(() => null)

      if (response.ok && Array.isArray(body?.data)) setSessionList(body.data)
    } catch {
      // The sessions step re-reads after its own next write; a failed read
      // here leaves the old dates on screen, not a wrong revision.
    }
  }

  /**
   * Keep the sessions the sessions step saved, and re-read the ticket types.
   *
   * Removing a session removes the ticket types priced for it on the server,
   * so the list the tickets step would open with is stale the moment a
   * session goes: its Edit and Remove buttons would answer "no such ticket
   * type". Re-read after every session write rather than guess which ones
   * cascaded.
   *
   * @param {object[]} next The sessions as the server now lists them.
   * @returns {Promise<void>} Resolves once the ticket types are re-read.
   */
  async function sessionsChanged(next) {
    setSessionList(next)

    try {
      const [tiersResponse, previewResponse] = await Promise.all([
        apiFetch(`/v1/events/${encodeURIComponent(event.id)}/tiers`),
        apiFetch(`/v1/events/${encodeURIComponent(event.id)}/price-preview`),
      ])
      const tiersBody = await tiersResponse.json().catch(() => null)
      const previewBody = await previewResponse.json().catch(() => null)

      if (tiersResponse.ok && Array.isArray(tiersBody?.data)) setTierList(tiersBody.data)
      if (previewResponse.ok && Array.isArray(previewBody?.data)) setPricePreview(previewBody.data)
    } catch {
      // The tickets step shows what it had; its own next write re-reads.
    }
  }

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
    ...problems.map((problem, index) => ({ ...problem, id: `event-${problem.field}-${index}` })),
    ...serverProblems.map((message, index) => ({ field: null, message, id: `server-${index}` })),
  ]

  // Problems by field, for the boxes of the content steps to show under themselves.
  const fieldErrors = Object.fromEntries(
    [...problems].reverse().map((problem) => [problem.field, problem.message]),
  )

  /**
   * Follow a link in a summary to its field, opening the step that holds it.
   *
   * A plain `#event-title` link does nothing while another step is showing,
   * because the field is not on the page.
   *
   * @param {object} click The click event.
   * @param {string} field The field id, without the prefix.
   * @returns {void}
   */
  function openField(click, field) {
    const target = stepOfField(field)

    if (!target || target === step) return

    click.preventDefault()
    setStep(target)
    requestAnimationFrame(() => document.getElementById(`event-${field}`)?.focus())
  }

  return (
    <div data-enhanced={enhanced ? 'true' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={reading.tone} srLabel="State:">
            {reading.label}
          </Badge>
          <span className="text-sm text-ink-muted">Revision {revision}</span>
        </div>

        {/*
          Text, in a polite live region, so a screen reader hears "Saved at
          7:04 PM" without being interrupted mid-sentence. A spinner announces
          nothing and a colour announces nothing.
        */}
        <p
          data-testid="save-status"
          data-save-state={save.kind}
          role="status"
          aria-live="polite"
          className="text-sm font-medium text-ink-muted"
        >
          {save.message}
        </p>
      </div>

      <p className="mt-2 text-sm text-ink-muted">{reading.next}</p>

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
          className="mt-4 rounded-card border border-status-danger/25 bg-status-danger-soft p-4"
        >
          <h2 className="text-sm font-semibold text-status-danger">
            {allProblems.length === 1
              ? 'One thing needs fixing before this can be saved'
              : `${allProblems.length} things need fixing before this can be saved`}
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-status-danger">
            {allProblems.map((problem) => (
              <li key={problem.id}>
                {problem.field ? (
                  <a
                    className="underline underline-offset-4"
                    href={`#event-${problem.field}`}
                    onClick={(click) => openField(click, problem.field)}
                  >
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

      {gaps.length > 0 && mode === 'draft' ? (
        <div
          data-testid="readiness-gaps"
          className="mt-4 rounded-card border border-status-warning/30 bg-status-warning-soft p-4"
        >
          <h2 className="text-sm font-semibold text-status-warning">
            Still to do before this can be published
          </h2>
          <p className="mt-1 text-sm text-status-warning">
            None of this stops the draft saving. The review step has the full list.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-status-warning">
            {gaps.map((gap) => (
              <li key={gap.field}>
                <a
                  className="underline underline-offset-4"
                  href={`#event-${gap.field}`}
                  onClick={(click) => openField(click, gap.field)}
                >
                  {gap.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mode === 'locked' ? (
        <Alert variant="info" title="This event is not open for editing" className="mt-4">
          <p>{reading.next}</p>
        </Alert>
      ) : null}

      {mode === 'live' ? (
        <Alert variant="info" title="This event is public" className="mt-4">
          <p>
            The description, line-up, questions and other details save as you type. The date, place
            and terms change through “Change date, place or terms…”, with a reason, because people
            have bought tickets on the strength of them.
          </p>
        </Alert>
      ) : null}

      {materialOpen && mode === 'live' ? (
        <MaterialChangePanel
          event={event}
          baseline={baseline}
          revision={revision}
          venues={venues}
          onSaved={materialSaved}
          onConflict={(message) => {
            setMaterialOpen(false)
            setConflict(message)
            setSave({ kind: 'conflict', message: 'Not saved. Somebody else changed this event.' })
          }}
          onCancel={() => setMaterialOpen(false)}
        />
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
                  className={`flex min-h-11 w-full items-center rounded-control px-3 text-left text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                    step === entry.id
                      ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                      : 'border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink'
                  }`}
                >
                  {/* Full opacity, not 70%. Dimming inherited text to 70% on
                      the slate-100 step background lands at 4.14:1, and AA asks
                      for 4.5:1 at 12px. The step number is small enough already
                      without also being faint. */}
                  <span className="text-xs">Step {index + 1}</span>
                  <span className="block">{entry.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0">
          {step === 'details' ? (
            <DetailsStep
              values={values}
              setField={setField}
              editable={editable}
              errors={fieldErrors}
            />
          ) : null}
          {step === 'schedule' ? (
            <ScheduleStep
              values={values}
              setField={setField}
              editable={editable}
              materialEditable={materialEditable}
              onChangeMaterial={() => setMaterialOpen(true)}
              venues={venues}
            />
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
              sessions={sessionList}
              onSessions={sessionsChanged}
              mapVersions={mapVersions}
              mode={mode}
              revision={revision}
              onRevision={setRevision}
            />
          ) : null}
          {step === 'tickets' ? (
            <EventTiersEditor
              event={event}
              sessions={sessionList}
              tiers={tierList}
              preview={pricePreview}
              onTiers={(nextTiers, nextPreview) => {
                setTierList(nextTiers)
                setPricePreview(nextPreview)
              }}
              mode={mode}
              revision={revision}
              onRevision={setRevision}
            />
          ) : null}
          {step === 'tickets' ? (
            <p className="mt-6 text-sm">
              <Link
                href={`/organizer/promo-codes?organizationId=${encodeURIComponent(event.organizationId)}&eventId=${encodeURIComponent(event.id)}`}
                className={TEXT_LINK}
              >
                Promo codes for this event
              </Link>
            </p>
          ) : null}
          {step === 'policies' ? (
            <PoliciesStep
              values={values}
              setField={setField}
              editable={editable}
              materialEditable={materialEditable}
              onChangeMaterial={() => setMaterialOpen(true)}
            />
          ) : null}
          {/* Shown in every status: the panel says which changes the event's
              state allows, and every one of them writes with the shell's
              revision, like the sessions and tickets steps. */}
          {step === 'media' ? (
            <EventMediaEditor
              event={event}
              status={status}
              media={pictures}
              onMediaChange={setPictures}
              failure={mediaFailure}
              revision={revision}
              onRevision={setRevision}
            />
          ) : null}
          {step === 'programme' ? (
            <ProgrammeStep
              values={values}
              setField={setField}
              editable={editable}
              errors={fieldErrors}
            />
          ) : null}
          {step === 'guests' ? (
            <GuestInfoStep
              values={values}
              setField={setField}
              editable={editable}
              errors={fieldErrors}
            />
          ) : null}
          {step === 'review' && readiness ? (
            <EventLifecyclePanel
              event={{ ...event, status }}
              readiness={readiness}
              transitions={transitions}
              history={history}
              revision={revision}
              sessions={sessionList}
              onChanged={lifecycleChanged}
            />
          ) : null}

          {editable && FORM_STEPS.has(step) ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => commit()} disabled={save.kind === 'saving'}>
                {dirty ? 'Save now' : 'Saved'}
              </Button>
              <span className="text-sm text-ink-muted">
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
 * @property {boolean} [materialEditable] Whether the date, place and terms accept input; false on a public event.
 * @property {Function} [onChangeMaterial] Opens the material change panel.
 * @property {Record<string, string>} [errors] Problems by field id.
 * @property {object[]} [venues] Venues to choose from.
 */

/**
 * The line a public event shows where its date, place or terms are.
 *
 * @param {object} props Component props.
 * @param {Function} props.onChangeMaterial Opens the panel.
 * @returns {JSX.Element} The note and its button.
 */
function MaterialNote({ onChangeMaterial }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-subtle p-4">
      <p className="text-sm text-ink-muted">
        This event is public, so these fields change with a reason and a notice for every current
        order.
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={onChangeMaterial}>
        Change date, place or terms…
      </Button>
    </div>
  )
}

/**
 * What the event is.
 *
 * @param {StepProps} props Component props.
 * @returns {JSX.Element} The step.
 */
function DetailsStep({ values, setField, editable, errors = {} }) {
  return (
    <section aria-labelledby="details-heading" className="space-y-5">
      <h2 id="details-heading" className="text-xl font-semibold text-ink">
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

      <RichTextField
        label="Description"
        id="event-description"
        required
        value={values.description}
        disabled={!editable}
        error={errors.description ?? null}
        onChange={(text) => setField('description', text)}
      />

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
        required
        description="The last part of the public URL. Changing it after people have shared the link will break their link."
        {...(errors.slug ? { error: errors.slug } : {})}
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

      <p className="text-sm text-ink-muted">
        The line-up, with roles and short bios, is on the “Line-up and running order” step.
      </p>
    </section>
  )
}

/**
 * An instant from a stored timestamp, or now when there is none yet.
 *
 * @param {string|null|undefined} value An ISO-8601 instant.
 * @returns {Date} That instant, or the current one.
 */
function instantOr(value) {
  const at = value ? new Date(value) : null

  return at && !Number.isNaN(at.getTime()) ? at : new Date()
}

/**
 * When it is on and where.
 *
 * @param {StepProps} props Component props.
 * @returns {JSX.Element} The step.
 */
function ScheduleStep({
  values,
  setField,
  editable,
  materialEditable = editable,
  onChangeMaterial = () => {},
  venues,
}) {
  const zone = values.timezone
  // Read at the times themselves: New York is EDT in October and EST in
  // December, and a label read at any other instant says the wrong one.
  const startAbbreviation = zoneAbbreviation(zone, instantOr(values.startsAt))
  const endAbbreviation = zoneAbbreviation(zone, instantOr(values.endsAt || values.startsAt))

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
      <h2 id="schedule-heading" className="text-xl font-semibold text-ink">
        When and where
      </h2>

      {editable && !materialEditable ? <MaterialNote onChangeMaterial={onChangeMaterial} /> : null}

      <FormField
        label="Time zone"
        id="event-timezone"
        required
        description="The zone the times below are in. The venue's local time, not yours."
      >
        <TimeZoneSelect
          value={zone}
          disabled={!materialEditable}
          onChange={(change) => setField('timezone', change.target.value)}
        />
      </FormField>

      <FormField
        label={`Starts${startAbbreviation ? ` (${startAbbreviation})` : ''}`}
        id="event-startsAt"
        required
        description={`Local time at the venue — ${zone}.`}
      >
        <Input
          type="datetime-local"
          value={toLocalInputValue(values.startsAt, zone)}
          disabled={!materialEditable}
          onChange={(change) => setInstant('startsAt', change.target.value)}
        />
      </FormField>

      <FormField
        label={`Ends${endAbbreviation ? ` (${endAbbreviation})` : ''}`}
        id="event-endsAt"
        required
        description={`Local time at the venue — ${zone}.`}
      >
        <Input
          type="datetime-local"
          value={toLocalInputValue(values.endsAt, zone)}
          disabled={!materialEditable}
          onChange={(change) => setInstant('endsAt', change.target.value)}
        />
      </FormField>

      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-1 text-sm font-medium text-ink">How people attend</legend>

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            id="event-isOnline"
            checked={values.isOnline}
            disabled={!materialEditable}
            onChange={(change) => setField('isOnline', change.target.checked)}
            className="size-4 rounded border-line-strong"
          />
          This event is online
        </label>

        {values.isOnline ? (
          <div className="mt-4">
            <FormField
              label="Where to join"
              id="event-onlineUrl"
              required
              description="The address ticket holders use to join. It is not shown on the public page."
            >
              <Input
                type="url"
                value={values.onlineUrl}
                disabled={!materialEditable}
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
                disabled={!materialEditable}
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

      <FormField
        label="Parking and directions for this event"
        id="event-directions"
        description={`Shown on the event page after the venue's own directions. For example: overflow parking at the school across the road. ${String(values.directions ?? '').length.toLocaleString('en-US')} of ${CONTENT_LIMITS.directions.toLocaleString('en-US')} characters.`}
      >
        <Textarea
          rows={4}
          value={values.directions}
          disabled={!editable}
          onChange={(change) => setField('directions', change.target.value)}
        />
      </FormField>
    </section>
  )
}

/**
 * The terms and who can come in.
 *
 * @param {StepProps} props Component props.
 * @returns {JSX.Element} The step.
 */
function PoliciesStep({
  values,
  setField,
  editable,
  materialEditable = editable,
  onChangeMaterial = () => {},
}) {
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
      <h2 id="policies-heading" className="text-xl font-semibold text-ink">
        Policies and access
      </h2>

      <Alert variant="info" title="These are copied onto every order">
        <p>
          The policies in force for an order are the ones as they stood when it was placed. Editing
          them here changes the terms for future buyers, not past ones. After publication, a change
          to them needs a reason and a confirmation, and a notice is recorded for every current
          order. This build does not send email, so tell ticket holders yourself as well.
        </p>
      </Alert>

      {editable && !materialEditable ? <MaterialNote onChangeMaterial={onChangeMaterial} /> : null}

      <FormField
        label="Refunds"
        id="event-policyRefund"
        description="The one a person looks for when something has gone wrong. Say what you will and will not refund, and by when."
      >
        <Textarea
          rows={4}
          value={values.policyRefund}
          disabled={!materialEditable}
          onChange={(change) => setField('policyRefund', change.target.value)}
        />
      </FormField>

      <FormField label="Getting in" id="event-policyEntry">
        <Textarea
          rows={4}
          value={values.policyEntry}
          disabled={!materialEditable}
          onChange={(change) => setField('policyEntry', change.target.value)}
        />
      </FormField>

      <FormField label="House rules" id="event-policyConduct">
        <Textarea
          rows={4}
          value={values.policyConduct}
          disabled={!materialEditable}
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
          disabled={!materialEditable}
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
          disabled={!materialEditable}
          onChange={(change) => setField('policyAgeNote', change.target.value)}
        />
      </FormField>

      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-1 text-sm font-medium text-ink">Accessibility for this event</legend>
        <p className="mt-1 text-sm text-ink-muted">
          These are added to whatever the venue already claims. Tick only what is true: somebody is
          going to decide whether they can come on the strength of it.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(ACCESSIBILITY_LABELS).map(([code, label]) => (
            <label key={code} className="flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={values.accessFeatures.includes(code)}
                disabled={!editable}
                onChange={(change) => toggle(code, change.target.checked)}
                className="size-4 rounded border-line-strong"
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

      <FormField
        label="Dress code"
        id="event-dressCode"
        description={`Shown on the event page. For example: traditional dress welcome; comfortable shoes for garba. ${String(values.dressCode ?? '').length.toLocaleString('en-US')} of ${CONTENT_LIMITS.dressCode.toLocaleString('en-US')} characters.`}
      >
        <Textarea
          rows={3}
          value={values.dressCode}
          disabled={!editable}
          onChange={(change) => setField('dressCode', change.target.value)}
        />
      </FormField>
    </section>
  )
}
