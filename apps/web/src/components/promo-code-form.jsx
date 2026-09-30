'use client'

/**
 * Make a promo code for an organisation.
 *
 * People type percentages ("10", "12.5") and amounts ("5.00"); the API stores
 * basis points and minor units. `lib/promo.js` converts, and refuses anything
 * it would have to round into a different discount. The window's times are the
 * zone stated beside them, never silently the browser's.
 *
 * Making a code live changes what buyers pay, so the API asks for a recent
 * second factor (`PROMO_ACTION`). When it does, the step-up prompt appears
 * beside the form — not inside it, where its own submit would submit this one
 * — and the code is made once the factor is confirmed.
 *
 * A code is a bearer discount: it goes in the request body and nowhere else,
 * never into the URL or storage.
 *
 * @module components/promo-code-form
 */

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { apiFetch } from '../lib/api-fetch.js'
import {
  PROMO_CODE_MAX_LENGTH,
  isPromoCodeShape,
  normalisePromoCode,
  promoValueFromForm,
} from '../lib/promo.js'
import { describeApiRefusal, fieldIssues } from '../lib/refusal.js'
import { fromLocalInputValue, zoneAbbreviation } from '../lib/zoned-time.js'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Button } from './ui.jsx'

/** The currencies a fixed amount may be in, on this USA-first build. */
const CURRENCIES = Object.freeze(['USD', 'CAD', 'GBP', 'EUR', 'INR'])

/** The shared input look. */
const INPUT =
  'mt-1 min-h-11 w-full rounded-control border border-line-strong bg-surface-raised px-3 text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none aria-invalid:border-status-danger'

/**
 * What is wrong with the form, field by field, before anything is sent.
 *
 * @param {object} values The form's values.
 * @returns {Record<string, string>} Problems by field; empty when it can be sent.
 */
export function promoFormProblems(values) {
  /** @type {Record<string, string>} */
  const problems = {}

  if (!isPromoCodeShape(values.code)) {
    problems.code = 'A code is 3 to 32 letters, numbers, hyphens or underscores.'
  }

  if (promoValueFromForm(values) === null) {
    problems.value =
      values.type === 'PERCENTAGE'
        ? 'Enter a percentage above 0 and at most 100, with up to two decimals.'
        : `Enter an amount above zero in ${values.currency}.`
  }

  if (values.maxRedemptions !== '' && !/^[1-9]\d{0,6}$/u.test(values.maxRedemptions)) {
    problems.maxRedemptions = 'Leave it empty for no limit, or enter a whole number from 1.'
  }

  if (values.startsAt && values.endsAt && values.endsAt <= values.startsAt) {
    problems.endsAt = 'The end must be after the start.'
  }

  return problems
}

/**
 * The request body the API takes, from the form's values.
 *
 * @param {object} values The form's values.
 * @param {string} timeZone The zone the window's times are in.
 * @returns {object} The body.
 */
export function promoRequestBody(values, timeZone) {
  return {
    code: normalisePromoCode(values.code),
    type: values.type,
    value: promoValueFromForm(values),
    currency: values.type === 'FIXED_AMOUNT' ? values.currency : null,
    eventId: values.eventId || null,
    maxRedemptions: values.maxRedemptions === '' ? null : Number(values.maxRedemptions),
    startsAt: values.startsAt ? fromLocalInputValue(values.startsAt, timeZone) : null,
    endsAt: values.endsAt ? fromLocalInputValue(values.endsAt, timeZone) : null,
    active: !values.startPaused,
  }
}

/**
 * @typedef {object} PromoCodeFormProps
 * @property {string} organizationId The organisation the code is for.
 * @property {Array<{id: string, title: string, timezone?: string, currency?: string|null}>} events The organisation's events, for the scope.
 * @property {string|null} [defaultEventId] An event to scope to by default.
 * @property {string} timeZone The zone an organisation-wide code's window is read in; a code for one event is read in that event's zone.
 */

/**
 * The form.
 *
 * @param {PromoCodeFormProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function PromoCodeForm({ organizationId, events, defaultEventId = null, timeZone }) {
  const router = useRouter()
  const id = useId()
  const scopedTo = (eventId) => events.find((event) => event.id === eventId) ?? null
  const [values, setValues] = useState({
    code: '',
    type: 'PERCENTAGE',
    value: '',
    currency: scopedTo(defaultEventId)?.currency ?? 'USD',
    eventId: scopedTo(defaultEventId) ? defaultEventId : '',
    maxRedemptions: '',
    startsAt: '',
    endsAt: '',
    startPaused: false,
  })
  const [problems, setProblems] = useState({})
  const [error, setError] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  // Counts refusals, so each one moves focus even when its words repeat: to
  // the refusal when there is one, else to the first field it names. A
  // message that only appears is not reliably heard, and focus left on the
  // button says nothing at all.
  const [failures, setFailures] = useState(0)
  const formRef = useRef(null)
  const errorRef = useRef(null)

  useEffect(() => {
    if (failures === 0) return

    if (errorRef.current) {
      errorRef.current.focus()
      return
    }

    formRef.current?.querySelector('[aria-invalid="true"]')?.focus()
  }, [failures])

  /**
   * Change some values.
   *
   * @param {object} patch The changed values.
   * @returns {void}
   */
  const set = (patch) => setValues((current) => ({ ...current, ...patch }))

  // A code for one event runs on that event's clock; one for every event on
  // the zone the page states.
  const windowZone = scopedTo(values.eventId)?.timezone ?? timeZone
  const zone = zoneAbbreviation(windowZone, new Date())
  const percent = values.type === 'PERCENTAGE' ? Number(values.value) : 0

  /**
   * Send the code.
   *
   * @returns {Promise<void>} Resolves once the attempt is over.
   */
  async function send() {
    const found = promoFormProblems(values)

    setProblems(found)
    setError(null)

    if (Object.keys(found).length > 0) {
      setFailures((count) => count + 1)
      return
    }

    setBusy(true)

    try {
      const response = await apiFetch(
        `/v1/organizations/${encodeURIComponent(organizationId)}/promo-codes`,
        { method: 'POST', body: JSON.stringify(promoRequestBody(values, windowZone)) },
      )

      if (response.ok) {
        const created = (await response.json()).data

        setStatus(`${created.code} made: ${created.status === 'PAUSED' ? 'paused' : 'live'}.`)
        setValues((current) => ({ ...current, code: '', value: '', maxRedemptions: '' }))
        router.refresh()
        return
      }

      // Read once: the code decides what to draw, the issues say which field.
      const body = await response.json().catch(() => null)
      const code = body?.error?.code ?? null

      if (response.status === 403 && code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      if (code === 'PROMO_CODE_TAKEN') {
        setProblems({
          code: `This organiser already has a code called ${normalisePromoCode(values.code)}.`,
        })
        setFailures((count) => count + 1)
        return
      }

      const issues = fieldIssues(body)

      if (Object.keys(issues).length > 0) setProblems(issues)
      setError(
        typeof body?.error?.message === 'string' && body.error.message.trim()
          ? body.error.message
          : describeApiRefusal({ status: response.status, code }).detail,
      )
      setFailures((count) => count + 1)
    } catch {
      setError('The service is not responding. Nothing was made.')
      setFailures((count) => count + 1)
    } finally {
      setBusy(false)
    }
  }

  /**
   * One field's error props.
   *
   * @param {string} field The field.
   * @returns {object} `aria-invalid` and `aria-describedby`, when it has a problem.
   */
  const invalid = (field) =>
    problems[field] ? { 'aria-invalid': 'true', 'aria-describedby': `${id}-${field}-problem` } : {}

  /**
   * A field's problem, beside it.
   *
   * @param {string} field The field.
   * @returns {JSX.Element|null} The message.
   */
  const problem = (field) =>
    problems[field] ? (
      <p id={`${id}-${field}-problem`} className="mt-1 text-sm text-status-danger">
        {problems[field]}
      </p>
    ) : null

  return (
    <div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-ink-muted">
        {status}
      </p>

      <form
        ref={formRef}
        noValidate
        onSubmit={(submitted) => {
          submitted.preventDefault()
          void send()
        }}
        className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2"
        aria-labelledby={`${id}-heading`}
      >
        <h2 id={`${id}-heading`} className="text-xl font-semibold text-ink sm:col-span-2">
          Make a promo code
        </h2>

        <div>
          <label htmlFor={`${id}-code`} className="block text-sm font-bold text-ink">
            Code
          </label>
          <input
            id={`${id}-code`}
            type="text"
            value={values.code}
            onChange={(changed) => set({ code: changed.target.value })}
            maxLength={PROMO_CODE_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={`${INPUT} font-mono uppercase`}
            {...invalid('code')}
          />
          {problem('code')}
        </div>

        <fieldset>
          <legend className="text-sm font-bold text-ink">Discount</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {[
              ['PERCENTAGE', 'Percentage off'],
              ['FIXED_AMOUNT', 'Fixed amount off'],
            ].map(([type, label]) => (
              <label key={type} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name={`${id}-type`}
                  value={type}
                  checked={values.type === type}
                  onChange={() => set({ type })}
                  className="h-5 w-5 accent-action-primary"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${id}-value`} className="block text-sm font-bold text-ink">
            {values.type === 'PERCENTAGE'
              ? 'Percentage off (%)'
              : `Amount off (${values.currency})`}
          </label>
          <input
            id={`${id}-value`}
            type="text"
            inputMode="decimal"
            value={values.value}
            onChange={(changed) => set({ value: changed.target.value })}
            autoComplete="off"
            className={INPUT}
            {...invalid('value')}
          />
          {problem('value')}
          {percent >= 50 ? (
            <p className="mt-1 text-sm text-ink-muted">
              A large discount is worth a long code: a short one is easier to guess.
            </p>
          ) : null}
        </div>

        {values.type === 'FIXED_AMOUNT' ? (
          <div>
            <label htmlFor={`${id}-currency`} className="block text-sm font-bold text-ink">
              Currency
            </label>
            <select
              id={`${id}-currency`}
              value={values.currency}
              onChange={(changed) => set({ currency: changed.target.value })}
              className={INPUT}
            >
              {[...new Set([...CURRENCIES, values.currency])].map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-ink-muted">
              For one event, the currency its tickets are priced in.
            </p>
          </div>
        ) : null}

        <div>
          <label htmlFor={`${id}-scope`} className="block text-sm font-bold text-ink">
            Applies to
          </label>
          <select
            id={`${id}-scope`}
            value={values.eventId}
            onChange={(changed) => {
              const eventId = changed.target.value
              const currency = scopedTo(eventId)?.currency

              set(currency ? { eventId, currency } : { eventId })
            }}
            className={INPUT}
          >
            <option value="">All of this organiser’s events</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-max`} className="block text-sm font-bold text-ink">
            Most uses (optional)
          </label>
          <input
            id={`${id}-max`}
            type="text"
            inputMode="numeric"
            value={values.maxRedemptions}
            onChange={(changed) => set({ maxRedemptions: changed.target.value })}
            autoComplete="off"
            className={INPUT}
            {...invalid('maxRedemptions')}
          />
          {problem('maxRedemptions')}
        </div>

        <div>
          <label htmlFor={`${id}-starts`} className="block text-sm font-bold text-ink">
            Starts (optional, {zone})
          </label>
          <input
            id={`${id}-starts`}
            type="datetime-local"
            value={values.startsAt}
            onChange={(changed) => set({ startsAt: changed.target.value })}
            className={INPUT}
          />
        </div>

        <div>
          <label htmlFor={`${id}-ends`} className="block text-sm font-bold text-ink">
            Ends (optional, {zone})
          </label>
          <input
            id={`${id}-ends`}
            type="datetime-local"
            value={values.endsAt}
            onChange={(changed) => set({ endsAt: changed.target.value })}
            className={INPUT}
            {...invalid('endsAt')}
          />
          {problem('endsAt')}
        </div>

        <p className="text-sm text-ink-muted sm:col-span-2">
          Times are {windowZone} ({zone}). A code with no start is live at once; with no end, until
          it is paused or used up.
        </p>

        <label className="flex min-h-11 items-center gap-2 text-sm text-ink sm:col-span-2">
          <input
            type="checkbox"
            checked={values.startPaused}
            onChange={(changed) => set({ startPaused: changed.target.checked })}
            className="h-5 w-5 accent-action-primary"
          />
          Start paused
        </label>

        {error ? (
          <div
            ref={errorRef}
            tabIndex={-1}
            className="rounded-card focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:col-span-2"
          >
            <Alert variant="error" title="Not made">
              {error}
            </Alert>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <Button type="submit" loading={busy} disabled={busy || stepUp}>
            Make the code
          </Button>
        </div>
      </form>

      {/* Beside the form, not inside it: the prompt is a form of its own. */}
      {stepUp ? (
        <div className="mt-4">
          <StepUpPrompt
            action="make a promo code"
            onConfirmed={() => {
              setStepUp(false)
              void send()
            }}
            onCancel={() => setStepUp(false)}
          />
        </div>
      ) : null}
    </div>
  )
}
