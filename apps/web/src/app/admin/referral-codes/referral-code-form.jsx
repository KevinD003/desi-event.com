'use client'

/**
 * Making a referral code, or changing one (SPEC3 §12.5).
 *
 * A new code is generated (the default) or typed; a label for the team at
 * The Desi Events only; all events or chosen ones (up to 50); an expiry, typed in UTC and
 * labelled with it; and a total limit. A
 * change sends only what differs from the code as read, with
 * `expectedUpdatedAt`, so somebody else's change in between is refused
 * (`REFERRAL_CODE_CHANGED`, with a Reload button) rather than overwritten. The
 * text of a code cannot change.
 *
 * The server asks for a second factor (PAYMENT_TERMS); the form only reacts:
 * it asks, then sends the same request again. A form that fails its own checks
 * shows the problems in a summary that takes focus, each a link to its field,
 * and under each field.
 *
 * ## Where a new code is
 *
 * In this component's state, shown once after it is made with "Copy code",
 * "Give this code only to the people it is for." and a link to its page —
 * never in the address, browser storage, a log or an analytics event.
 *
 * ## The time zone
 *
 * UTC, named in the field's label ({@link REFERRAL_EXPIRY_ZONE}): the zone every
 * administrator screen at The Desi Events writes times in. Never the browser's, which
 * nobody chose for this: a code works across events in every US zone, and an
 * expiry read in whichever zone a laptop happens to be set to would mean a
 * different moment to the next administrator. The same zone on the server and
 * in the browser, so the form draws once.
 *
 * ## Which events
 *
 * A code's own answer names every event of its scope, so a change to its
 * events starts from all of them and sends them all back but the ones
 * removed. Should an answer ever name fewer than the code holds, the form
 * keeps the scope as it is: it says so and offers no change to it, rather
 * than replace the events it could not see.
 *
 * @module app/admin/referral-codes/referral-code-form
 */

import { REFERRAL_LABEL_DESCRIPTION, REFERRAL_LIMITS } from '@desi-event/schemas/payment-terms'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { STEP_UP_DECLINED_SENTENCE, useStepUpRetry } from '../../../components/step-up-retry.jsx'
import { Alert, Button } from '../../../components/ui.jsx'
import { TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { fieldIssues, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import { toLocalInputValue } from '../../../lib/zoned-time.js'
import { CopyCodeButton } from './copy-code-button.jsx'
import { ReferralEventPicker } from './referral-event-picker.jsx'
import {
  GIVE_ONLY_TO,
  EXPIRY_HINT,
  LIMIT_HINT,
  REFERRAL_CODES_PATH,
  REFERRAL_EXPIRY_ZONE,
  TYPED_CODE_HINT,
  referralFormRequest,
} from './referral-vocabulary.js'

/** The classes of a text box. */
const CONTROL =
  'min-h-11 w-full rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none aria-invalid:border-status-danger'

/** The API's field names, as the form's. */
const FIELD_OF = Object.freeze({
  referralCode: 'referralCode',
  generate: 'referralCode',
  label: 'label',
  scope: 'events',
  eventIds: 'events',
  expiresAt: 'expires',
  maxUses: 'maxUses',
})

/**
 * The API's sentence for the one 503 `TRY_AGAIN` it still sends: five
 * generated codes in a row were already in use, so no code was made, and
 * making it again draws new ones. Every busy refusal is 503
 * `SERVICE_UNAVAILABLE`, which the shared rule reads; this is not one of them.
 *
 * @param {number} status The response's status.
 * @param {object|null} body The parsed body.
 * @returns {string|null} The sentence, or null for any other answer.
 */
function clashSentence(status, body) {
  const said = typeof body?.error?.message === 'string' ? body.error.message.trim() : ''

  return status === 503 && body?.error?.code === 'TRY_AGAIN' && said ? said : null
}

/**
 * The form's starting values.
 *
 * @param {object|null} code The code being changed, or null for a new one.
 * @param {string} timeZone The zone the expiry is shown in.
 * @returns {object} The values.
 */
function startingValues(code, timeZone) {
  return {
    codeMode: 'GENERATE',
    referralCode: '',
    label: code?.label ?? '',
    scope: code?.scope ?? 'ALL_EVENTS',
    events: (code?.events ?? []).map((event) => ({ id: event.id, title: event.title })),
    eventsTouched: false,
    expires: code?.expiresAt ? toLocalInputValue(code.expiresAt, timeZone) : '',
    maxUses: code?.maxUses ? String(code.maxUses) : '',
  }
}

/**
 * @typedef {object} ReferralCodeFormProps
 * @property {'create'|'edit'} mode Which form.
 * @property {object} [code] The code being changed, as `referralCodes.get` read it.
 */

/**
 * The form, its expiry in UTC.
 *
 * @param {ReferralCodeFormProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function ReferralCodeForm(props) {
  return <ReferralCodeFormFields {...props} timeZone={REFERRAL_EXPIRY_ZONE} />
}

/**
 * The fields.
 *
 * @param {object} props Component props.
 * @param {'create'|'edit'} props.mode Which form.
 * @param {object} [props.code] The code being changed.
 * @param {string} props.timeZone The zone the expiry is typed in.
 * @returns {JSX.Element} The form, or what was made.
 */
function ReferralCodeFormFields({ mode, code: initialCode = null, timeZone }) {
  const router = useRouter()
  const id = useId()
  const focusAfterRender = useFocusAfterRender()
  const [code, setCode] = useState(initialCode)
  const [values, setValues] = useState(() => startingValues(initialCode, timeZone))
  // The code as the page last drew it. When the page is read again after a
  // change made elsewhere on it (switching it off or on), the form starts from
  // the code as it now stands, so its `expectedUpdatedAt` is the new one.
  const [drawn, setDrawn] = useState(initialCode?.updatedAt ?? null)

  if (initialCode && initialCode.updatedAt !== drawn) {
    setDrawn(initialCode.updatedAt)
    setCode(initialCode)
    setValues(startingValues(initialCode, timeZone))
  }
  const [errors, setErrors] = useState({})
  const [refusal, setRefusal] = useState(null)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [made, setMade] = useState(null)
  const summaryRef = useRef(null)
  const refusalRef = useRef(null)
  const madeRef = useRef(null)
  const submitRef = useRef(null)
  const editing = mode === 'edit'
  const stepUp = useStepUpRetry({
    action: editing ? 'save these changes to the referral code' : 'make this referral code',
    takeFocus: true,
    onDeclined: () => {
      setRefusal(STEP_UP_DECLINED_SENTENCE)
      focusAfterRender(refusalRef)
    },
  })
  const shownEvents = code?.events?.length ?? 0
  const allEvents = code?.eventCount ?? 0
  // An answer that names fewer events than the code holds: its events are
  // kept as they are, never replaced by the ones that could be read.
  const partlyRead = editing && code?.scope === 'SELECTED_EVENTS' && allEvents > shownEvents

  /**
   * Change some values, and forget what was said about the last attempt.
   *
   * @param {object} changes The new values.
   * @returns {void}
   */
  function set(changes) {
    setValues((current) => ({ ...current, ...changes }))
    setSaved('')
  }

  /**
   * Send the request, and take what the API answers.
   *
   * @param {object} body The body.
   * @returns {Promise<object|null>} The code the API answered with, or null.
   */
  async function send(body) {
    setBusy(true)
    setRefusal(null)
    setStale(false)

    try {
      const response = await apiFetch(
        editing
          ? `/v1/platform/referral-codes/${encodeURIComponent(code.id)}`
          : '/v1/platform/referral-codes',
        { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      )
      const parsed = await response.json().catch(() => null)

      if (response.ok && parsed?.data) return parsed.data

      const retried = stepUp.refused(parsed, () => send(body))

      if (retried) return retried

      const issues = fieldIssues(parsed)
      const fieldErrors = {}

      for (const [field, message] of Object.entries(issues)) {
        if (FIELD_OF[field]) fieldErrors[FIELD_OF[field]] ??= message
      }

      if (parsed?.error?.details?.field === 'expiresAt' && parsed?.error?.message) {
        fieldErrors.expires = parsed.error.message
      }

      if (parsed?.error?.code === 'REFERRAL_EVENT_NOT_ELIGIBLE') {
        fieldErrors.events = parsed.error.message
      }

      setErrors(fieldErrors)
      setRefusal(
        clashSentence(response.status, parsed) ??
          refusalSentence(
            response.status,
            parsed,
            editing ? 'The code was not changed.' : 'No code was made.',
            parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
          ),
      )
      setStale(parsed?.error?.code === 'REFERRAL_CODE_CHANGED')
      focusAfterRender(refusalRef)
      return null
    } catch {
      setRefusal(
        `The service is not responding. ${editing ? 'The code was not changed.' : 'No code was made.'}`,
      )
      focusAfterRender(refusalRef)
      return null
    } finally {
      setBusy(false)
    }
  }

  /**
   * Check the form and send it.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves once the attempt is over.
   */
  async function submit(submitted) {
    submitted.preventDefault()
    setSaved('')

    const request = referralFormRequest(values, { mode, timeZone, code })

    setErrors(request.errors)

    if (!request.body) {
      focusAfterRender(summaryRef)
      return
    }

    const answered = await send(request.body)

    if (!answered) return

    if (editing) {
      setCode(answered)
      setValues(startingValues(answered, timeZone))
      setSaved('Changes saved.')
      // Back to the button, which a confirmed second factor took focus from.
      focusAfterRender(submitRef)
      router.refresh()
    } else {
      setMade(answered)
      focusAfterRender(madeRef)
    }
  }

  /**
   * Start again with an empty form, after a code was made.
   *
   * @returns {void}
   */
  function another() {
    setMade(null)
    setValues(startingValues(null, timeZone))
    setErrors({})
  }

  if (made) {
    return (
      <section
        aria-labelledby={`${id}-made`}
        className="mt-6 rounded-card border border-line-strong bg-surface-raised p-5 shadow-card"
      >
        <h2
          id={`${id}-made`}
          ref={madeRef}
          tabIndex={-1}
          className="text-lg font-semibold text-ink focus-visible:outline-none"
        >
          Referral code made
        </h2>
        <p className="mt-3 font-mono text-2xl break-all text-ink">{made.referralCode}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyCodeButton code={made} size="md" />
        </div>
        <p className="mt-3 text-sm font-medium text-ink">{GIVE_ONLY_TO}</p>
        <ul className="mt-4 flex flex-wrap gap-4 text-sm">
          <li>
            <Link
              href={`${REFERRAL_CODES_PATH}/${encodeURIComponent(made.id)}`}
              className={TEXT_LINK}
            >
              Open the code’s page
            </Link>
          </li>
          <li>
            <Button type="button" variant="secondary" size="sm" onClick={another}>
              Make another referral code
            </Button>
          </li>
        </ul>
      </section>
    )
  }

  const problems = [
    errors.form ? { id: `${id}-label`, message: errors.form } : null,
    errors.referralCode ? { id: `${id}-code`, message: errors.referralCode } : null,
    errors.label ? { id: `${id}-label`, message: errors.label } : null,
    errors.events ? { id: `${id}-events`, message: errors.events } : null,
    errors.expires ? { id: `${id}-expires`, message: errors.expires } : null,
    errors.maxUses ? { id: `${id}-limit`, message: errors.maxUses } : null,
  ].filter(Boolean)

  /**
   * A field's error, under it.
   *
   * @param {string} key The field.
   * @returns {JSX.Element|null} The message, or nothing.
   */
  const problem = (key) =>
    errors[key] ? (
      <p id={`${id}-${key}-error`} className="mt-1 text-sm font-medium text-status-danger">
        {errors[key]}
      </p>
    ) : null

  /**
   * The wiring of a field that may be in error.
   *
   * @param {string} key The field.
   * @param {string} [hintId] Its hint's id.
   * @returns {object} `aria-invalid` and `aria-describedby`.
   */
  const wiring = (key, hintId) => ({
    'aria-invalid': errors[key] ? 'true' : undefined,
    'aria-describedby':
      [hintId, errors[key] ? `${id}-${key}-error` : null].filter(Boolean).join(' ') || undefined,
  })

  return (
    <>
      <form onSubmit={submit} noValidate className="mt-6 max-w-3xl space-y-6">
        {problems.length > 0 ? (
          <div ref={summaryRef} tabIndex={-1} className="focus-visible:outline-none">
            <Alert variant="error" title="Check these and try again">
              <ul className="list-disc space-y-1 pl-5">
                {problems.map((each) => (
                  <li key={`${each.id}-${each.message}`}>
                    <a className="underline underline-offset-4" href={`#${each.id}`}>
                      {each.message}
                    </a>
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        ) : null}

        {refusal ? (
          <div ref={refusalRef} tabIndex={-1} className="focus-visible:outline-none">
            <Alert
              variant="error"
              title={editing ? 'The code was not changed' : 'The code was not made'}
            >
              <p>{refusal}</p>
              {stale ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => router.refresh()}
                >
                  Reload
                </Button>
              ) : null}
            </Alert>
          </div>
        ) : null}

        {!editing ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-bold text-ink">Code</legend>
            {[
              { value: 'GENERATE', label: 'Generate a code for me' },
              { value: 'TYPED', label: 'I’ll type one' },
            ].map((option) => (
              <div key={option.value} className="flex items-center gap-3">
                <input
                  id={`${id}-mode-${option.value}`}
                  type="radio"
                  name={`${id}-mode`}
                  value={option.value}
                  checked={values.codeMode === option.value}
                  onChange={() => set({ codeMode: option.value })}
                  className="size-6 shrink-0 accent-action-primary"
                />
                <label htmlFor={`${id}-mode-${option.value}`} className="text-sm text-ink">
                  {option.label}
                </label>
              </div>
            ))}
            {values.codeMode === 'TYPED' ? (
              <div className="pl-9">
                <label htmlFor={`${id}-code`} className="block text-sm font-medium text-ink">
                  Referral code
                </label>
                <p id={`${id}-code-hint`} className="mt-1 text-sm text-ink-muted">
                  {TYPED_CODE_HINT}
                </p>
                <input
                  id={`${id}-code`}
                  type="text"
                  value={values.referralCode}
                  onChange={(changed) => set({ referralCode: changed.target.value })}
                  maxLength={REFERRAL_LIMITS.maxLength + 8}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className={`${CONTROL} mt-2 font-mono uppercase`}
                  {...wiring('referralCode', `${id}-code-hint`)}
                />
                {problem('referralCode')}
              </div>
            ) : null}
          </fieldset>
        ) : null}

        <div>
          <label htmlFor={`${id}-label`} className="block text-sm font-medium text-ink">
            Label (optional)
          </label>
          <p id={`${id}-label-hint`} className="mt-1 text-sm text-ink-muted">
            {REFERRAL_LABEL_DESCRIPTION}
          </p>
          <input
            id={`${id}-label`}
            type="text"
            value={values.label}
            onChange={(changed) => set({ label: changed.target.value })}
            maxLength={REFERRAL_LIMITS.labelMax + 20}
            autoComplete="off"
            className={`${CONTROL} mt-2`}
            {...wiring('label', `${id}-label-hint`)}
          />
          {problem('label')}
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-bold text-ink">Works for</legend>
          {[
            { value: 'ALL_EVENTS', label: 'All events' },
            { value: 'SELECTED_EVENTS', label: 'Chosen events' },
          ].map((option) => (
            <div key={option.value} className="flex items-center gap-3">
              <input
                id={`${id}-scope-${option.value}`}
                type="radio"
                name={`${id}-scope`}
                value={option.value}
                checked={values.scope === option.value}
                onChange={() => set({ scope: option.value })}
                disabled={partlyRead}
                className="size-6 shrink-0 accent-action-primary"
              />
              <label htmlFor={`${id}-scope-${option.value}`} className="text-sm text-ink">
                {option.label}
              </label>
            </div>
          ))}
          {values.scope === 'SELECTED_EVENTS' && partlyRead ? (
            <p className="pl-9 text-sm text-ink-muted">
              This code works for {allEvents.toLocaleString('en-US')} events, but they could not all
              be read, so its events can’t be changed here. Reload the page to change them.
            </p>
          ) : null}
          {values.scope === 'SELECTED_EVENTS' && !partlyRead ? (
            <div className="pl-9">
              <ReferralEventPicker
                selected={values.events}
                onChange={(events) => set({ events, eventsTouched: true })}
                max={REFERRAL_LIMITS.maxEvents}
                errorId={`${id}-events`}
                error={errors.events ?? null}
                disabled={busy}
              />
            </div>
          ) : null}
        </fieldset>

        <div>
          <label htmlFor={`${id}-expires`} className="block text-sm font-medium text-ink">
            Expires (optional, UTC)
          </label>
          <p id={`${id}-expires-hint`} className="mt-1 text-sm text-ink-muted">
            {EXPIRY_HINT}
          </p>
          <input
            id={`${id}-expires`}
            type="datetime-local"
            value={values.expires}
            onChange={(changed) => set({ expires: changed.target.value })}
            className={`${CONTROL} mt-2 sm:w-72`}
            {...wiring('expires', `${id}-expires-hint`)}
          />
          {problem('expires')}
        </div>

        <div>
          <label htmlFor={`${id}-limit`} className="block text-sm font-medium text-ink">
            Limit (optional)
          </label>
          <p id={`${id}-limit-hint`} className="mt-1 text-sm text-ink-muted">
            {LIMIT_HINT}
          </p>
          <input
            id={`${id}-limit`}
            type="text"
            inputMode="numeric"
            value={values.maxUses}
            onChange={(changed) => set({ maxUses: changed.target.value })}
            maxLength={12}
            autoComplete="off"
            className={`${CONTROL} mt-2 sm:w-48`}
            {...wiring('maxUses', `${id}-limit-hint`)}
          />
          {problem('maxUses')}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button ref={submitRef} type="submit" loading={busy} disabled={busy || stepUp.waiting}>
            {editing ? 'Save changes' : 'Make referral code'}
          </Button>
          <p role="status" aria-live="polite" className="text-sm font-medium text-status-success">
            {saved}
          </p>
        </div>
      </form>

      {/* Outside the form: the prompt is a form of its own, and a form inside
          a form would send both when it is confirmed — two codes made, the
          first shown to nobody. */}
      {stepUp.prompt ? <div className="mt-4 max-w-3xl">{stepUp.prompt}</div> : null}
    </>
  )
}
