'use client'

/**
 * Ticket types, and what each one actually costs a buyer.
 *
 * The part that earns its place is the all-in column. An organiser types a face
 * value; the platform adds a booking fee and, where the event is held, tax. If
 * the only number on this screen is the face value, the first time anybody sees
 * the real one is at checkout — which is the practice everybody hates about
 * buying tickets, and it starts here, in the screen where the price is set.
 *
 * So the preview comes from the server. Not recomputed in the browser from a
 * copy of the fee table: the same endpoint the public page's "all in" line is
 * derived from, so an organiser and a buyer cannot be shown different numbers.
 *
 * Every write carries the event's revision. A tier belongs to a session, and
 * the server refuses one that names a session belonging to another event —
 * that was finding NF-20, and it is now a database trigger as well as a check.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-tiers-editor
 */

import { useState } from 'react'

import { Alert, Badge, Button, Card, CardBody, FormField, Input, Select } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { formatPrice } from '../lib/pricing.js'

/** A blank tier. */
const BLANK = Object.freeze({
  name: '',
  description: '',
  priceCents: '',
  currency: 'INR',
  quantityTotal: '',
  minPerOrder: '1',
  maxPerOrder: '10',
  eventSessionId: '',
  reserved: false,
})

/**
 * @typedef {object} EventTiersEditorProps
 * @property {object} event The event.
 * @property {object[]} sessions The event's sessions, for the session select.
 * @property {object[]} preview The all-in breakdown per tier, from the server.
 * @property {number} revision The event's revision as loaded.
 * @property {boolean} editable Whether the event's state allows changes.
 */

/**
 * The tickets step.
 *
 * @param {EventTiersEditorProps} props Component props.
 * @returns {JSX.Element} The step.
 */
export function EventTiersEditor({
  event,
  sessions = [],
  preview: initialPreview = [],
  revision: initialRevision = 0,
  editable = true,
}) {
  const [tiers, setTiers] = useState(event.ticketTypes ?? [])
  const [preview, setPreview] = useState(initialPreview)
  const [revision, setRevision] = useState(initialRevision)
  const [draft, setDraft] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState([])

  /**
   * Re-read the tiers and the priced preview together.
   *
   * Together on purpose: a price shown beside a tier that has changed is worse
   * than no price.
   *
   * @returns {Promise<void>} Resolves when reloaded.
   */
  async function reload() {
    const [eventResponse, previewResponse] = await Promise.all([
      apiFetch(`/v1/events/${encodeURIComponent(event.id)}`),
      apiFetch(`/v1/events/${encodeURIComponent(event.id)}/price-preview`),
    ])

    const eventBody = await eventResponse.json().catch(() => null)
    const previewBody = await previewResponse.json().catch(() => null)

    if (eventResponse.ok && eventBody?.data) {
      setTiers(eventBody.data.ticketTypes ?? [])
      setRevision(eventBody.data.revision)
    }

    if (previewResponse.ok && previewBody) setPreview(previewBody.data ?? [])
  }

  /**
   * Add the tier in the form.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function addTier(submitted) {
    submitted.preventDefault()
    setBusy(true)
    setError(null)
    setProblems([])

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}/tiers`, {
        method: 'POST',
        body: JSON.stringify({
          revision,
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          priceCents: Number(draft.priceCents),
          currency: draft.currency,
          quantityTotal: Number(draft.quantityTotal),
          minPerOrder: Number(draft.minPerOrder),
          maxPerOrder: Number(draft.maxPerOrder),
          eventSessionId: draft.eventSessionId || null,
          reserved: draft.reserved,
        }),
      })

      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error?.message ?? 'The ticket type was refused.')
        setProblems(body?.error?.problems ?? [])
        return
      }

      setDraft(BLANK)
      await reload()
    } catch {
      setError('The service is not responding. Nothing has been saved.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Remove one tier.
   *
   * @param {object} tier The tier.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function removeTier(tier) {
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(
        `/v1/events/${encodeURIComponent(event.id)}/tiers/${encodeURIComponent(tier.id)}`,
        { method: 'DELETE', body: JSON.stringify({ revision }) },
      )

      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error?.message ?? 'The ticket type could not be removed.')
        setProblems(body?.error?.problems ?? [])
        return
      }

      await reload()
    } catch {
      setError('The service is not responding.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * The server's all-in breakdown for one tier.
   *
   * @param {object} tier The tier.
   * @returns {object|null} The breakdown, or null when the preview has not caught up.
   */
  const priced = (tier) => preview.find((entry) => entry.ticketTypeId === tier.id) ?? null

  return (
    <section aria-labelledby="tiers-heading" className="space-y-5">
      <h2 id="tiers-heading" className="text-xl font-bold text-indigo-night-900">
        Tickets
      </h2>
      <p className="text-sm text-slate-600">
        The all-in column is what a buyer is charged, worked out by the same code that charges them.
        It is on this screen so that the number you set and the number they pay are never a surprise
        to either of you.
      </p>

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

      {tiers.length === 0 ? (
        <p className="rounded-card border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          No ticket types yet. An event cannot go on sale without at least one.
        </p>
      ) : (
        <ul className="space-y-3">
          {tiers.map((tier) => {
            const money = priced(tier)

            return (
              <li key={tier.id}>
                <Card>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-indigo-night-900">
                          {tier.name}{' '}
                          <Badge variant="neutral" srLabel="State:">
                            {tier.status}
                          </Badge>
                        </p>
                        {tier.description ? (
                          <p className="mt-1 text-sm text-slate-600">{tier.description}</p>
                        ) : null}
                        <p className="mt-2 text-sm text-slate-700">
                          Face value {formatPrice(tier.priceCents, tier.currency)} ·{' '}
                          {tier.quantityTotal.toLocaleString('en-IN')} available ·{' '}
                          {tier.quantitySold.toLocaleString('en-IN')} sold
                        </p>

                        {money ? (
                          <p className="mt-1 text-sm">
                            <span className="font-medium text-indigo-night-900">
                              {formatPrice(money.allInCents, money.currency)} all in
                            </span>{' '}
                            <span className="text-slate-600">
                              ({formatPrice(money.feesCents, money.currency)} fee
                              {money.taxCents > 0
                                ? ` + ${formatPrice(money.taxCents, money.currency)} tax`
                                : ''}
                              )
                            </span>
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-slate-500">
                            The all-in price has not been worked out for this tier yet.
                          </p>
                        )}
                      </div>

                      {editable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy || tier.quantitySold > 0}
                          onClick={() => removeTier(tier)}
                        >
                          {tier.quantitySold > 0 ? 'Sold — cannot remove' : 'Remove'}
                        </Button>
                      ) : null}
                    </div>
                  </CardBody>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      {editable ? (
        <form onSubmit={addTier} className="space-y-4 rounded-card border border-slate-200 p-4">
          <h3 className="text-lg font-semibold text-indigo-night-900">Add a ticket type</h3>

          <FormField label="Name" id="tier-name" required>
            <Input
              value={draft.name}
              onChange={(change) => setDraft({ ...draft, name: change.target.value })}
            />
          </FormField>

          <FormField label="Description" id="tier-description">
            <Input
              value={draft.description}
              onChange={(change) => setDraft({ ...draft, description: change.target.value })}
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Face value, in paise"
              id="tier-priceCents"
              required
              description="Minor units, so ₹1,499 is 149900. Zero makes it free."
            >
              <Input
                type="number"
                min="0"
                value={draft.priceCents}
                onChange={(change) => setDraft({ ...draft, priceCents: change.target.value })}
              />
            </FormField>

            <FormField label="Currency" id="tier-currency" required>
              <Select
                value={draft.currency}
                onChange={(change) => setDraft({ ...draft, currency: change.target.value })}
              >
                {['INR', 'GBP', 'USD', 'CAD', 'AUD'].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="How many" id="tier-quantityTotal" required>
              <Input
                type="number"
                min="0"
                value={draft.quantityTotal}
                onChange={(change) => setDraft({ ...draft, quantityTotal: change.target.value })}
              />
            </FormField>

            <FormField label="Least per order" id="tier-minPerOrder" required>
              <Input
                type="number"
                min="1"
                value={draft.minPerOrder}
                onChange={(change) => setDraft({ ...draft, minPerOrder: change.target.value })}
              />
            </FormField>

            <FormField label="Most per order" id="tier-maxPerOrder" required>
              <Input
                type="number"
                min="1"
                value={draft.maxPerOrder}
                onChange={(change) => setDraft({ ...draft, maxPerOrder: change.target.value })}
              />
            </FormField>

            <FormField
              label="Session"
              id="tier-eventSessionId"
              description="Which performance this ticket is for."
            >
              <Select
                value={draft.eventSessionId}
                onChange={(change) => setDraft({ ...draft, eventSessionId: change.target.value })}
              >
                <option value="">Not tied to a session</option>
                {sessions.map((session, index) => (
                  <option key={session.id} value={session.id}>
                    Session {index + 1} — {new Date(session.startsAt).toISOString().slice(0, 10)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.reserved}
              onChange={(change) => setDraft({ ...draft, reserved: change.target.checked })}
              className="size-4 rounded border-slate-300"
            />
            Reserved seating — buyers choose a specific seat
          </label>

          <Button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add ticket type'}
          </Button>
        </form>
      ) : null}
    </section>
  )
}
