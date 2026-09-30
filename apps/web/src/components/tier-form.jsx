'use client'

/**
 * The form for one ticket type, to add one or to change one.
 *
 * Prices are typed the way a person says them — "35.00", not 3500 — and sent
 * in minor units. A reserved tier picks its session and the price zone it
 * sells; a general-admission tier says how many there are. Sales windows are
 * wall-clock times at the session's venue, so an early bird that closes at
 * midnight closes at midnight where the show is.
 *
 * On a live event the form says what it will not allow before the server has
 * to: the price of a tier that has sold, and the seating of one people hold.
 *
 * @module components/tier-form
 */

import { useRef, useState } from 'react'

import { useFocusAfterRender } from './focus-after-render.jsx'
import { Alert, Button, FormField, Input, Select, Textarea } from './ui.jsx'
import {
  TIER_LIMITS,
  diffTierBody,
  sessionLabel,
  tierFormProblems,
  toTierBody,
} from '../lib/tier-form.js'
import { fromLocalInputValue, toLocalInputValue, zoneAbbreviation } from '../lib/zoned-time.js'

/** Currencies a tier may be priced in, with the catalogue's own first. */
const CURRENCIES = Object.freeze(['USD', 'CAD', 'GBP', 'INR', 'AUD'])

/**
 * @typedef {object} TierFormProps
 * @property {'create'|'edit'} kind Whether this adds a tier or changes one.
 * @property {object} initial The form values to start from.
 * @property {object[]} sessions The event's sessions, with their price zones.
 * @property {string} eventTimezone The event's zone, for a tier on every session.
 * @property {'draft'|'live'} mode The editing mode.
 * @property {{sold: number, held: number, hasOrders: boolean}|null} [usage] What is using the tier, when editing.
 * @property {Record<string, string>} [serverErrors] Field messages from a refused save.
 * @property {boolean} [busy] Whether a save is in flight.
 * @property {Function} onSubmit Called with the body to send; for an edit, only what changed.
 * @property {Function} [onCancel] Called when the person backs out of an edit.
 * @property {string} idPrefix Distinguishes this form's field ids from another's on the page.
 */

/**
 * The form.
 *
 * @param {TierFormProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function TierForm({
  kind,
  initial,
  sessions = [],
  eventTimezone = 'America/New_York',
  mode = 'draft',
  usage = null,
  serverErrors = {},
  busy = false,
  onSubmit,
  onCancel = null,
  idPrefix,
}) {
  const [values, setValues] = useState(initial)
  const [shown, setShown] = useState([])
  const [notice, setNotice] = useState(null)
  const summary = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  const session = sessions.find((candidate) => candidate.id === values.eventSessionId) ?? null
  const zone = session?.timezone ?? eventTimezone
  const mapped = sessions.filter((candidate) => candidate.venueMapVersionId)
  const zones = session?.priceZones ?? []
  const sold = usage?.sold ?? 0
  const inUse = Boolean(usage && (usage.sold > 0 || usage.held > 0 || usage.hasOrders))
  // The server keeps these; the form says so rather than letting somebody try.
  const priceLocked = kind === 'edit' && (sold > 0 || (usage?.held ?? 0) > 0)
  const seatingLocked = kind === 'edit' && inUse
  const errors = { ...Object.fromEntries(shown.map((entry) => [entry.field, entry.message])) }

  for (const [field, message] of Object.entries(serverErrors)) {
    const key = field === 'priceCents' ? 'price' : field

    if (!errors[key]) errors[key] = message
  }

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
   * Check and send.
   *
   * @param {object} submitted The submit event.
   * @returns {void}
   */
  function submit(submitted) {
    submitted.preventDefault()

    const problems = tierFormProblems(values, {
      sessions,
      mode,
      usage: usage ? { sold: usage.sold, held: usage.held } : null,
    })

    setShown(problems)

    if (problems.length > 0) {
      focusAfterRender(summary)
      return
    }

    if (kind === 'create') {
      onSubmit(toTierBody(values))
      return
    }

    const changed = diffTierBody(initial, values)

    if (Object.keys(changed).length === 0) {
      setNotice('Nothing has changed.')
      return
    }

    onSubmit(changed)
  }

  const id = (field) => `${idPrefix}-${field}`
  const described = (field) => (errors[field] ? { error: errors[field] } : {})

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
                <a className="underline underline-offset-4" href={`#${id(problem.field)}`}>
                  {problem.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FormField label="Name" id={id('name')} required {...described('name')}>
        <Input
          value={values.name}
          maxLength={TIER_LIMITS.tierName}
          onChange={(change) => set({ name: change.target.value })}
        />
      </FormField>

      <FormField
        label="Description"
        id={id('description')}
        description={`${values.description.length} of ${TIER_LIMITS.tierDescription} characters. Optional.`}
        {...described('description')}
      >
        <Textarea
          rows={2}
          value={values.description}
          onChange={(change) => set({ description: change.target.value })}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label={`Face value (${values.currency})`}
          id={id('price')}
          required
          description={
            values.complimentary
              ? 'A complimentary ticket is free.'
              : priceLocked
                ? `The price stays as it is: ${sold > 0 ? `${sold} sold at it` : 'some are in baskets at it'}.`
                : 'In the currency, as a buyer reads it: 35.00 for thirty-five dollars. 0 makes it free.'
          }
          {...described('price')}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={values.complimentary ? '0' : values.price}
            disabled={values.complimentary || priceLocked}
            onChange={(change) => set({ price: change.target.value })}
          />
        </FormField>

        <FormField label="Currency" id={id('currency')} required>
          <Select
            value={values.currency}
            disabled={priceLocked}
            onChange={(change) => set({ currency: change.target.value })}
          >
            {[...new Set([values.currency, ...CURRENCIES])].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Which session"
          id={id('eventSessionId')}
          description={
            seatingLocked
              ? 'Tickets of this type have been sold or held, so it stays on its session.'
              : 'Every session, or one of them.'
          }
          {...described('eventSessionId')}
        >
          <Select
            value={values.eventSessionId}
            disabled={seatingLocked}
            onChange={(change) => set({ eventSessionId: change.target.value, priceZoneId: '' })}
          >
            <option value="">Every session</option>
            {sessions.map((candidate, index) => (
              <option
                key={candidate.id}
                value={candidate.id}
                disabled={values.reserved && !candidate.venueMapVersionId}
              >
                {sessionLabel(candidate, index)}
              </option>
            ))}
          </Select>
        </FormField>

        {values.reserved ? (
          <FormField
            label="Price zone"
            id={id('priceZoneId')}
            required
            description="The seats in this zone are sold as this ticket type."
            {...described('priceZoneId')}
          >
            <Select
              value={values.priceZoneId}
              disabled={seatingLocked || zones.length === 0}
              onChange={(change) => set({ priceZoneId: change.target.value })}
            >
              <option value="">
                {zones.length === 0 ? 'Choose a session first' : 'Choose a zone'}
              </option>
              {zones.map((zoneOption) => (
                <option key={zoneOption.id} value={zoneOption.id}>
                  {zoneOption.name}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <FormField
            label="How many"
            id={id('quantityTotal')}
            required
            description={
              mode === 'live' && usage
                ? `At least ${usage.sold + usage.held}: ${usage.sold} sold and ${usage.held} in baskets.`
                : 'How many of this ticket type there are.'
            }
            {...described('quantityTotal')}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={mode === 'live' && usage ? usage.sold + usage.held : 1}
              value={values.quantityTotal}
              onChange={(change) => set({ quantityTotal: change.target.value })}
            />
          </FormField>
        )}

        <FormField
          label="Least per order"
          id={id('minPerOrder')}
          required
          {...described('minPerOrder')}
        >
          <Input
            type="number"
            inputMode="numeric"
            min="1"
            max={TIER_LIMITS.perOrderMax}
            value={values.minPerOrder}
            onChange={(change) => set({ minPerOrder: change.target.value })}
          />
        </FormField>

        <FormField
          label="Most per order"
          id={id('maxPerOrder')}
          required
          description={`At most ${TIER_LIMITS.perOrderMax}.`}
          {...described('maxPerOrder')}
        >
          <Input
            type="number"
            inputMode="numeric"
            min="1"
            max={TIER_LIMITS.perOrderMax}
            value={values.maxPerOrder}
            onChange={(change) => set({ maxPerOrder: change.target.value })}
          />
        </FormField>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1 size-4 rounded border-line-strong"
            checked={values.reserved}
            disabled={seatingLocked || mapped.length === 0}
            aria-describedby={mapped.length === 0 ? id('reserved-help') : undefined}
            onChange={(change) =>
              set({
                reserved: change.target.checked,
                priceZoneId: '',
                eventSessionId:
                  change.target.checked && !session?.venueMapVersionId
                    ? (mapped[0]?.id ?? '')
                    : values.eventSessionId,
              })
            }
          />
          Reserved seating — buyers choose a specific seat
        </label>
        {mapped.length === 0 ? (
          <p id={id('reserved-help')} className="text-sm text-ink-muted">
            No session has a seating map, so this ticket type is general admission. Give a session a
            published map on the Sessions step to sell seats.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label={`Sales open (${zoneAbbreviation(zone, new Date(values.salesStartAt || Date.now()))})`}
          id={id('salesStartAt')}
          description="Leave both empty to sell while the event is on sale. An early-bird tier usually closes when the next one opens."
          {...described('salesStartAt')}
        >
          <Input
            type="datetime-local"
            value={toLocalInputValue(values.salesStartAt, zone)}
            onChange={(change) =>
              set({ salesStartAt: fromLocalInputValue(change.target.value, zone) ?? '' })
            }
          />
        </FormField>

        <FormField
          label={`Sales close (${zoneAbbreviation(zone, new Date(values.salesEndAt || Date.now()))})`}
          id={id('salesEndAt')}
          description={`Times are in ${zone}.`}
          {...described('salesEndAt')}
        >
          <Input
            type="datetime-local"
            value={toLocalInputValue(values.salesEndAt, zone)}
            onChange={(change) =>
              set({ salesEndAt: fromLocalInputValue(change.target.value, zone) ?? '' })
            }
          />
        </FormField>
      </div>

      <fieldset
        className="space-y-2"
        aria-describedby={errors.visibility ? id('visibility-error') : undefined}
      >
        <legend className="text-sm font-medium text-ink">Who can see it</legend>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name={id('visibility')}
            value="PUBLIC"
            checked={values.visibility === 'PUBLIC'}
            disabled={values.complimentary}
            onChange={() => set({ visibility: 'PUBLIC' })}
          />
          Shown on the event page
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name={id('visibility')}
            value="HIDDEN"
            checked={values.visibility === 'HIDDEN'}
            onChange={() => set({ visibility: 'HIDDEN' })}
          />
          Hidden — only your team can book it
        </label>
        {errors.visibility ? (
          <p id={id('visibility-error')} className="text-sm font-medium text-status-danger">
            {errors.visibility}
          </p>
        ) : null}
      </fieldset>

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1 size-4 rounded border-line-strong"
          checked={values.complimentary}
          disabled={seatingLocked}
          onChange={(change) =>
            set(
              change.target.checked
                ? { complimentary: true, visibility: 'HIDDEN', price: '0' }
                : { complimentary: false },
            )
          }
        />
        Complimentary (guest list, no charge). Hidden from the event page; your team books it
        through the event&rsquo;s own checkout, where it is listed for them, and hands each ticket
        on with a transfer code.
      </label>

      <FormField
        label="Position in the list"
        id={id('sortOrder')}
        description="Lower numbers are listed first."
        {...described('sortOrder')}
      >
        <Input
          type="number"
          inputMode="numeric"
          min="0"
          max={TIER_LIMITS.sortOrderMax}
          value={values.sortOrder}
          onChange={(change) => set({ sortOrder: change.target.value })}
        />
      </FormField>

      {kind === 'create' ? (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={values.status === 'ON_SALE'}
            onChange={(change) => set({ status: change.target.checked ? 'ON_SALE' : 'DRAFT' })}
            className="size-4 rounded border-line-strong"
          />
          Put this tier on sale straight away
        </label>
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
              ? 'Add ticket type'
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
