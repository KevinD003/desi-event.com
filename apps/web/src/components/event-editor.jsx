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
 * A public event is still edited here, in `live` mode, without another review.
 * The description, the line-up, the questions and the other housekeeping
 * autosave, and only those fields are sent. The date, the place and the terms
 * are inputs too, but a change to one is never autosaved: somebody bought a
 * ticket on the strength of them, so the editor lists what changed and asks
 * for a reason and a confirmation in the material change panel, and the API
 * records a notice for every current order. A finished or cancelled event
 * (`content`) keeps its words and pictures editable and nothing else. In
 * review, approved, rejected, archived or deleted, nothing is edited here
 * (`locked`).
 *
 * ## Whose authority
 *
 * The organiser edits as the organisation. The Desi-Event team edits a posted
 * event in an editing session it opened with a reason (`authority.kind ===
 * 'platform'`): a banner says so, the lifecycle panel is not offered (those
 * moves are the organiser's), and every write needs a second factor from the
 * last 10 minutes — the server asks, the autosave stops, asks, and sends the
 * same change again ("Not now" keeps it stopped until the next edit), and the
 * nights, ticket types and pictures ask where their own write was made. A
 * session opened again after this one ended arrives through a refresh, and
 * the fields take input again. Under the organisation's authority, the
 * organiser is told at the top while the Desi-Event team has the event open.
 * Which controls are offered (the danger zone, cancelling a night) comes in
 * as booleans the server page worked out.
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

import { useFocusAfterRender } from './focus-after-render.jsx'
import { Alert, Badge, Button, FormField, Input, Select, Textarea } from './ui.jsx'
import { TEXT_LINK } from './link-classes.js'
import { DeleteEventDialog } from './delete-event-dialog.jsx'
import { GuestInfoStep, ProgrammeStep } from './event-content-steps.jsx'
import { EventLifecyclePanel } from './event-lifecycle-panel.jsx'
import { EventMediaEditor } from './event-media-editor.jsx'
import { EventSessionsEditor } from './event-sessions-editor.jsx'
import { EventTiersEditor } from './event-tiers-editor.jsx'
import { MaterialChangePanel, materialDiff } from './material-change-panel.jsx'
import { PlatformChangesPanel } from './platform-changes-panel.jsx'
import { PlatformEditBanner } from './platform-edit-banner.jsx'
import { RichTextField } from './rich-text-field.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { TimeZoneSelect } from './time-zone-select.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import {
  PLATFORM_STEP_UP_SENTENCE,
  SITTING_ENDED_SENTENCE,
  teamEditingSentence,
} from '../lib/event-control.js'
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
import {
  MATERIAL_FIELDS,
  MATERIAL_FIELD_LABELS,
  editMode,
  statusReading,
} from '../lib/event-status.js'
import { normaliseWebsiteUrl, websiteUrlProblem } from '../lib/website.js'
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
 * The website's address is read only from an answer that carries it. One that
 * leaves the key out says nothing about the address, so the box keeps what it
 * had: read as empty, the next save would send `websiteUrl: null` and remove an
 * address nobody touched.
 *
 * @param {object} event The event as the API returned it.
 * @param {object|null} [previous] The values this answer replaces.
 * @returns {object} The form's values.
 */
export function toFormValues(event, previous = null) {
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
    websiteUrl: 'websiteUrl' in event ? (event.websiteUrl ?? '') : (previous?.websiteUrl ?? ''),
    // The line-up, running order, questions, contact, links, sponsors, dress
    // code and directions.
    ...fromEventContent(event),
  }
}

/**
 * The website's address as a save sends it, or undefined when it is not sent.
 *
 * Sent only when it differs from the address last saved. An address stored
 * before today's rules (a legacy one with a key in it, carried over and
 * waiting for the Desi-Event team) fails them; sent with every save, it would
 * be refused every time and stop the title, the questions and everything else
 * from saving until the organiser changed an address they never touched. The
 * status under the box says what is wrong with it.
 *
 * @param {object} values The form's values.
 * @param {object|null} [baseline] The values last saved; without them it is always sent.
 * @returns {string|null|undefined} The address, null to remove it, or undefined.
 */
export function websitePatch(values, baseline = null) {
  const next = String(values.websiteUrl ?? '').trim() || null

  if (baseline && next === (String(baseline.websiteUrl ?? '').trim() || null)) return undefined

  return next
}

/**
 * The form's values as the API's update body.
 *
 * @param {object} values The form's values.
 * @param {object|null} [baseline] The values last saved, which decide whether the website's address is sent (see `websitePatch`).
 * @returns {object} A body `updateEventRequestSchema` accepts.
 */
export function toPatch(values, baseline = null) {
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

  // Housekeeping, so a public event autosaves it too. The address waits for
  // a Desi-Event administrator; saving it never turns the link on or off.
  const websiteUrl = websitePatch(values, baseline)

  if (websiteUrl !== undefined) patch.websiteUrl = websiteUrl

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
 * @param {object|null} [baseline] The values last saved (see `toPatch`).
 * @returns {object} The body, without the material fields.
 */
export function toHousekeepingPatch(values, baseline = null) {
  const patch = toPatch(values, baseline)

  for (const field of MATERIAL_FIELDS) delete patch[field]

  return patch
}

/**
 * The form's values without the date, place and terms: what an autosave on a
 * public, finished or cancelled event may change, so a change waiting for its
 * reason never counts as unsaved housekeeping (and never sets the autosave
 * going round again and again).
 *
 * @param {object} values The form's values.
 * @returns {object} The values, the material ones left out.
 */
export function housekeepingValues(values) {
  const rest = { ...values }

  for (const field of MATERIAL_FORM_FIELDS) delete rest[field]

  return rest
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
 * The website's address is checked only when it would be sent: one saved
 * before today's rules is left to the status under its box (see
 * `websitePatch`), and does not stop everything else from saving.
 *
 * @param {object} values The form's values.
 * @param {object|null} [baseline] The values last saved; without them the address is always checked.
 * @returns {Array<{field: string, message: string}>} One entry per problem.
 */
export function formProblems(values, baseline = null) {
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

  const website = websitePatch(values, baseline)
  const websiteProblem = website ? websiteUrlProblem(website) : null

  if (websiteProblem) {
    problems.push({ field: 'websiteUrl', message: `Your website: ${websiteProblem}` })
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
    field === 'publicPhone' ||
    field === 'websiteUrl'
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
 * @property {{kind: 'organization'}|{kind: 'platform', editId: string, reason: string, expiresAt: string, organizationName?: string|null}} [authority] Whose authority the edits are made under: the organisation's, or the Desi-Event team's open editing session (with the name of the organisation whose event it is).
 * @property {boolean} [mayDelete] Whether to offer the danger zone, worked out on the server.
 * @property {boolean} [mayCancelNights] Whether to offer cancelling a night, worked out on the server.
 * @property {object[]} [platformEdits] The Desi-Event team's editing sessions on this event.
 * @property {string} [listHref] The list this editor came from, where a deletion leads back to.
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
  authority = { kind: 'organization' },
  mayDelete = false,
  mayCancelNights = false,
  platformEdits = [],
  listHref = '/organizer/events',
}) {
  const platform = authority?.kind === 'platform'
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
  // The material change panel, when open: `proposed` to confirm what the
  // steps hold, or `form` for its own boxes ("Change date, place or terms…").
  const [materialOpen, setMaterialOpen] = useState(null)
  const [status, setStatus] = useState(event.status)
  // The website link's switch, read-only here: only the Desi-Event team moves
  // it. Taken from every answer that carries it.
  const [websiteRedirect, setWebsiteRedirect] = useState(event.websiteRedirect ?? null)
  const [step, setStep] = useState('details')
  const [save, setSave] = useState({ kind: 'idle', message: 'No changes made.' })
  const [serverProblems, setServerProblems] = useState([])
  const [conflict, setConflict] = useState(null)
  // Under the Desi-Event team's authority: a save waiting for a second factor,
  // and whether the editing session was found closed by a refused write.
  const [stepUpPending, setStepUpPending] = useState(false)
  // The second factor was asked for and the person backed out: the autosave
  // stays paused until the next edit or "Save now", rather than asking again
  // a moment later.
  const [stepUpDeclined, setStepUpDeclined] = useState(false)
  const [sittingEnded, setSittingEnded] = useState(false)
  // A new editing session, opened again after this one ended, reaches here
  // through `router.refresh()`, which keeps this component's state: the ended
  // flag is reset when the session the page hands down changes.
  const sittingKey = platform ? `${authority.editId ?? ''}|${authority.expiresAt ?? ''}` : null

  useEffect(() => {
    setSittingEnded(false)
  }, [sittingKey])
  // Everything here is client-side: until hydration the step buttons, the
  // autosave and the lifecycle panel do nothing. `data-enhanced` marks the
  // moment they start to, for anything that has to wait for it.
  const [enhanced, setEnhanced] = useState(false)

  useEffect(() => setEnhanced(true), [])

  const summaryRef = useRef(null)
  const timer = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  const mode = editMode(status)
  // Whether the step fields accept input at all, and whether the material ones
  // do. On a public event both do; a change to a material one waits for its
  // reason. A finished or cancelled event keeps only its words.
  const editable = mode !== 'locked' && !sittingEnded
  const materialEditable = editable && (mode === 'draft' || mode === 'live')
  const reading = statusReading(status)
  // In a draft every field saves as it is typed; anywhere else only the
  // housekeeping does, so only it counts as unsaved.
  const dirty = useMemo(
    () =>
      mode === 'draft'
        ? JSON.stringify(values) !== JSON.stringify(baseline)
        : JSON.stringify(housekeepingValues(values)) !==
          JSON.stringify(housekeepingValues(baseline)),
    [mode, values, baseline],
  )
  // The date, place and terms changed in the steps of a public event, waiting
  // for a reason and a confirmation.
  const pendingMaterial = useMemo(
    () => (mode === 'live' ? Object.keys(materialDiff(baseline, values)) : []),
    [mode, values, baseline],
  )
  const problems = useMemo(() => formProblems(values, baseline), [values, baseline])
  const gaps = useMemo(() => formGaps(values), [values])
  // The Desi-Event team's editing session open on this event, which the
  // organiser is told about at the top of the editor (X-7).
  const openSitting = platform ? null : ((platformEdits ?? []).find((edit) => edit?.open) ?? null)
  // A step's write found the editing session closed: the banner offers to
  // open it again.
  const endSitting = useCallback(() => setSittingEnded(true), [])
  // "Change date, place or terms…": the panel's own boxes, offered on a
  // public event while nothing changed in the steps waits to be confirmed.
  const changeMaterial =
    mode === 'live' && pendingMaterial.length === 0 && !materialOpen
      ? () => setMaterialOpen('form')
      : null

  /**
   * Change one field.
   *
   * @param {string} field The field name.
   * @param {unknown} value Its new value.
   * @returns {void}
   */
  const setField = useCallback((field, value) => {
    setStepUpDeclined(false)
    setValues((current) => ({ ...current, [field]: value }))
  }, [])

  /**
   * Take the website link's switch from an answer that carries it.
   *
   * @param {object|null} detail The event as the server returned it.
   * @returns {void}
   */
  const takeWebsiteRedirect = useCallback((detail) => {
    if (detail && 'websiteRedirect' in detail) setWebsiteRedirect(detail.websiteRedirect ?? null)
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

        if (!silent) focusAfterRender(summaryRef)
        return
      }

      setSave({ kind: 'saving', message: 'Saving…' })
      setServerProblems([])

      try {
        // A public, finished or cancelled event autosaves its housekeeping
        // only; the date, place and terms go through the material change
        // panel, with a reason.
        const patch =
          mode === 'draft' ? toPatch(values, baseline) : toHousekeepingPatch(values, baseline)
        const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...patch, revision }),
        })

        const body = await response.json().catch(() => null)

        if (response.ok) {
          const sentWebsite = values.websiteUrl
          const savedWebsite =
            'websiteUrl' in body.data &&
            normaliseWebsiteUrl(sentWebsite) === (body.data.websiteUrl ?? null)
              ? (body.data.websiteUrl ?? '')
              : null

          setRevision(body.data.revision)
          setStatus(body.data.status)
          setBaseline((current) => toFormValues(body.data, current))
          // The server stores the address normalised ("https://www.Example.com"
          // becomes "https://www.example.com/"). The box takes the stored form
          // when it still holds what was sent, so the form is not dirty for a
          // difference nobody typed and does not save the same address again.
          if (savedWebsite !== null) {
            setValues((current) =>
              current.websiteUrl === sentWebsite
                ? { ...current, websiteUrl: savedWebsite }
                : current,
            )
          }
          takeWebsiteRedirect(body.data)
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
          focusAfterRender(summaryRef)
          return
        }

        if (platform && body?.error?.code === 'STEP_UP_REQUIRED') {
          // The Desi-Event team confirms every 10 minutes of writes. Stop the
          // autosave, ask, and send the same change once confirmed.
          setStepUpPending(true)
          setSave({ kind: 'unsaved', message: 'Not saved yet: confirm it’s you to keep editing.' })
          return
        }

        // Only an editing session can end. Under the organisation's authority
        // the same code is a plain refusal, and its own sentence says why.
        if (platform && body?.error?.code === 'PLATFORM_EDIT_NOT_OPEN') {
          setSittingEnded(true)
          setSave({ kind: 'error', message: `Not saved. ${SITTING_ENDED_SENTENCE}` })
          return
        }

        setServerProblems(body?.error?.problems ?? [])
        setSave({
          kind: 'error',
          message: `Not saved. ${refusalSentence(response.status, body, 'The API refused.')}`,
        })
        focusAfterRender(summaryRef)
      } catch {
        setSave({
          kind: 'error',
          message:
            'Not saved. The service is not responding — your changes are still in the boxes.',
        })
      }
    },
    [
      baseline,
      event.id,
      focusAfterRender,
      mode,
      platform,
      problems,
      revision,
      takeWebsiteRedirect,
      values,
    ],
  )

  // Autosave. Deliberately not on an interval: a timer that fires while
  // somebody is mid-sentence saves half a word and announces it.
  useEffect(() => {
    if (!editable || conflict || stepUpPending) return undefined

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

    // Paused after "Not now" on the second-factor prompt; its message stays.
    if (stepUpDeclined) return undefined

    setSave({ kind: 'unsaved', message: 'Unsaved changes.' })

    timer.current = setTimeout(() => commit({ silent: true }), AUTOSAVE_DELAY_MS)

    return () => clearTimeout(timer.current)
  }, [commit, conflict, dirty, editable, problems.length, stepUpDeclined, stepUpPending])

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
    const saved = toFormValues(detail, baseline)

    takeWebsiteRedirect(detail)

    setRevision(detail.revision)
    setStatus(detail.status)
    setBaseline(saved)
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(MATERIAL_FORM_FIELDS.map((field) => [field, saved[field]])),
    }))
    setMaterialOpen(null)
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

    const saved = toFormValues(detail, baseline)

    takeWebsiteRedirect(detail)
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

    setValues(toFormValues(body.data, baseline))
    setBaseline(toFormValues(body.data, baseline))
    takeWebsiteRedirect(body.data)
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

      {platform ? (
        <PlatformEditBanner
          eventId={event.id}
          sitting={{
            reason: authority.reason ?? '',
            expiresAt: authority.expiresAt,
            organizationName: authority.organizationName ?? null,
          }}
          ended={sittingEnded}
          timeZone={baseline.timezone}
        />
      ) : null}

      {/* The organiser sees, at the top, that the Desi-Event team has this
          event open for editing, until when and why (X-7); never who. */}
      {openSitting ? (
        <Alert
          variant="info"
          title="The Desi-Event team is editing this event"
          className="mt-4"
          data-testid="team-editing-notice"
        >
          <p>{teamEditingSentence(openSitting.expiresAt, baseline.timezone)}</p>
          {openSitting.reason ? <p className="mt-1">Reason: {openSitting.reason}</p> : null}
          <p className="mt-1">
            Each change it makes is listed under “Changes made by the Desi-Event team” on the Review
            step.
          </p>
        </Alert>
      ) : null}

      {stepUpPending ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium text-ink">{PLATFORM_STEP_UP_SENTENCE}</p>
          <StepUpPrompt
            action="keep editing this event"
            onConfirmed={() => {
              setStepUpPending(false)
              // The same change, sent again now the second factor is fresh.
              commit()
            }}
            onCancel={() => {
              // Paused until the next edit or "Save now": asking again a
              // moment later would make "Not now" mean "in a second".
              setStepUpPending(false)
              setStepUpDeclined(true)
              setSave({
                kind: 'unsaved',
                message: 'Not saved: confirm it’s you to save these changes.',
              })
            }}
          />
        </div>
      ) : null}

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
            Everything here can change. The description, line-up and other details save as you type.
            A change to the date, place or terms is confirmed with a reason, because people holding
            tickets are shown it.
          </p>
        </Alert>
      ) : null}

      {mode === 'content' ? (
        <Alert
          variant="info"
          title={status === 'COMPLETED' ? 'This event has finished' : 'This event was cancelled'}
          className="mt-4"
        >
          <p>
            Its words and pictures can still be updated, and save as you type. Its date, place,
            terms, nights and ticket types stay as ticket holders were told them.
          </p>
        </Alert>
      ) : null}

      {pendingMaterial.length > 0 && !materialOpen ? (
        <section
          aria-labelledby="pending-material-heading"
          data-testid="pending-material"
          className="mt-4 space-y-2 rounded-card border border-status-warning/30 bg-status-warning-soft p-4"
        >
          <h2 id="pending-material-heading" className="text-sm font-semibold text-ink">
            Not saved: a change to the date, place or terms
          </h2>
          <p className="text-sm text-ink">
            You changed{' '}
            {pendingMaterial.map((field) => MATERIAL_FIELD_LABELS[field] ?? field).join(', ')}.
            People holding tickets are shown this change, so it is saved only once you confirm it
            with a reason.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => setMaterialOpen('proposed')}>
              Confirm these changes…
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    MATERIAL_FORM_FIELDS.map((field) => [field, baseline[field]]),
                  ),
                }))
              }
            >
              Put them back
            </Button>
          </div>
        </section>
      ) : null}

      {materialOpen && mode === 'live' ? (
        <MaterialChangePanel
          event={event}
          baseline={baseline}
          proposed={materialOpen === 'proposed' && pendingMaterial.length > 0 ? values : null}
          revision={revision}
          venues={venues}
          onRefusedField={(code) => {
            if (platform && code === 'PLATFORM_EDIT_NOT_OPEN') setSittingEnded(true)
          }}
          onSaved={materialSaved}
          onConflict={(message) => {
            setMaterialOpen(null)
            setConflict(message)
            setSave({ kind: 'conflict', message: 'Not saved. Somebody else changed this event.' })
          }}
          onCancel={() => setMaterialOpen(null)}
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
              materialNote={materialNoteFor(mode, status)}
              onChangeMaterial={changeMaterial}
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
              mayCancelNights={mayCancelNights && !sittingEnded}
              platform={platform}
              onSittingEnded={endSitting}
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
              platform={platform}
              onSittingEnded={endSitting}
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
              materialNote={materialNoteFor(mode, status)}
              onChangeMaterial={changeMaterial}
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
              platform={platform}
              onSittingEnded={endSitting}
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
              websiteRedirect={websiteRedirect}
              savedWebsiteUrl={baseline.websiteUrl.trim() || null}
            />
          ) : null}
          {/* The lifecycle moves are the organiser's: under the Desi-Event
              team's editing session the review step offers only what that
              session may do. */}
          {step === 'review' && readiness && !platform ? (
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
          {step === 'review' ? (
            <PlatformChangesPanel edits={platformEdits} timeZone={values.timezone} />
          ) : null}
          {step === 'review' && mayDelete ? (
            <section
              aria-labelledby="danger-zone-heading"
              className="mt-6 space-y-3 rounded-card border border-status-danger/30 bg-surface-raised p-4"
            >
              <h2 id="danger-zone-heading" className="text-lg font-semibold text-ink">
                Danger zone
              </h2>
              <p className="text-sm text-ink">
                Deleting takes the event off the site straight away. What else it does depends on
                its sales, and is shown before anything is deleted.
              </p>
              <DeleteEventDialog
                event={{ id: event.id, title: baseline.title || event.title, slug: event.slug }}
                listHref={listHref}
                listLabel={platform ? 'Back to all events' : 'Back to your events'}
              />
            </section>
          ) : null}

          {editable && FORM_STEPS.has(step) ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => {
                  setStepUpDeclined(false)
                  commit()
                }}
                disabled={save.kind === 'saving'}
              >
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
 * @property {boolean} [materialEditable] Whether the date, place and terms accept input; false on a finished or cancelled event.
 * @property {string|null} [materialNote] What the step says about those fields, when the event is not a draft.
 * @property {Function|null} [onChangeMaterial] Opens the material change panel's own form, on a public event.
 * @property {Record<string, string>} [errors] Problems by field id.
 * @property {object[]} [venues] Venues to choose from.
 */

/**
 * What the date, place and terms steps say about those fields, by mode.
 *
 * @param {string} mode The editing mode.
 * @param {string} status The event's status.
 * @returns {string|null} The sentence, or null in a draft.
 */
export function materialNoteFor(mode, status) {
  if (mode === 'live') {
    return 'This event is public: a change to its date, place or terms is saved only once you confirm it with a reason, and every current order is shown a notice of it.'
  }
  if (mode === 'content') {
    return `This event ${status === 'COMPLETED' ? 'has finished' : 'was cancelled'}, so its date, place and terms stay as ticket holders were told them.`
  }

  return null
}

/**
 * The line a public, finished or cancelled event shows where its date, place
 * or terms are.
 *
 * On a public event it keeps "Change date, place or terms…" for somebody who
 * prefers the panel's own form to changing the boxes in the steps (X-5).
 *
 * @param {object} props Component props.
 * @param {string} props.children The sentence.
 * @param {Function|null} [props.onChangeMaterial] Opens the panel's own form; no button without it.
 * @returns {JSX.Element} The note.
 */
function MaterialNote({ children, onChangeMaterial = null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-subtle p-4">
      <p className="text-sm text-ink">{children}</p>
      {onChangeMaterial ? (
        <Button type="button" variant="secondary" size="sm" onClick={onChangeMaterial}>
          Change date, place or terms…
        </Button>
      ) : null}
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
  materialNote = null,
  onChangeMaterial = null,
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

      {editable && materialNote ? (
        <MaterialNote onChangeMaterial={onChangeMaterial}>{materialNote}</MaterialNote>
      ) : null}

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
  materialNote = null,
  onChangeMaterial = null,
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
          order. Notices are not emailed, so tell ticket holders yourself as well.
        </p>
      </Alert>

      {editable && materialNote ? (
        <MaterialNote onChangeMaterial={onChangeMaterial}>{materialNote}</MaterialNote>
      ) : null}

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
