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
 * The tiers themselves come from the organiser's own read,
 * `GET /v1/events/:id/tiers`, not the public page: it carries what the edit form
 * needs to prefill — the session, the price zone, whether a tier is hidden or
 * complimentary — and what is using each one, so a tier that has sold says why
 * it cannot be removed instead of offering a button that would fail.
 *
 * Every write carries the event's revision, and a removal carries it in the
 * query string: a DELETE has no body.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-tiers-editor
 */

import { useState } from 'react'

import { TierForm } from './tier-form.jsx'
import { Alert, Badge, Button, Card, CardBody } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { fieldIssues, refusalSentence } from '../lib/refusal.js'
import { formatAmount, formatPrice } from '../lib/pricing.js'
import { blankTierForm, sessionLabel, toTierForm } from '../lib/tier-form.js'

/** How each tier status reads. */
const TIER_STATUS = Object.freeze({
  DRAFT: ['Not on sale (draft)', 'neutral'],
  ON_SALE: ['On sale', 'success'],
  PAUSED: ['Paused', 'warning'],
  SOLD_OUT: ['Sold out', 'info'],
  CLOSED: ['Sales closed', 'neutral'],
})

/**
 * A moment in a zone, as a person reads it.
 *
 * @param {string} value An ISO instant.
 * @param {string} zone An IANA zone.
 * @returns {string} For example `Oct 1, 11:59 PM EDT`.
 */
function when(value, zone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

/**
 * A tier's sales window, in words.
 *
 * @param {object} tier The tier.
 * @param {string} zone The zone it sells in.
 * @returns {string|null} The sentence, or null when it sells while the event does.
 */
function windowText(tier, zone) {
  if (tier.salesStartAt && tier.salesEndAt) {
    return `On sale from ${when(tier.salesStartAt, zone)} until ${when(tier.salesEndAt, zone)}`
  }
  if (tier.salesStartAt) return `On sale from ${when(tier.salesStartAt, zone)}`
  if (tier.salesEndAt) return `On sale until ${when(tier.salesEndAt, zone)}`

  return null
}

/**
 * Why a tier cannot be removed, when it cannot.
 *
 * @param {object} tier The tier, with its usage.
 * @returns {string} The sentence.
 */
function unremovableReason(tier) {
  if ((tier.quantitySold ?? 0) > 0 || tier.hasOrders) {
    return 'Cannot be removed: tickets of this type have been sold or ordered. Pause it or hide it instead.'
  }

  if ((tier.heldQuantity ?? 0) > 0) {
    return 'Cannot be removed while some are in somebody’s basket. Pause it to stop new ones.'
  }

  return 'Cannot be removed: a checkout still refers to it. Pause it or hide it instead.'
}

/**
 * @typedef {object} EventTiersEditorProps
 * @property {object} event The event.
 * @property {object[]} sessions The event's sessions, with their price zones.
 * @property {object[]} [tiers] The tiers from the organiser's read; the event's own list when absent.
 * @property {object[]} preview The all-in breakdown per tier, from the server.
 * @property {number} revision The event's current revision, owned by the editor shell.
 * @property {Function} onRevision Called with the new revision after every write.
 * @property {Function} [onTiers] Called with the tiers and the preview after a reload, so the shell keeps them when this step unmounts.
 * @property {boolean} [editable] Whether the event's state allows changes. Superseded by `mode`.
 * @property {'draft'|'live'|'locked'} [mode] The editing mode.
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
  tiers: initialTiers = null,
  preview: initialPreview = [],
  revision = 0,
  onRevision = () => {},
  onTiers = () => {},
  editable = true,
  mode: givenMode = null,
}) {
  const mode = givenMode ?? (editable ? 'draft' : 'locked')
  const canEdit = mode !== 'locked'
  const [tiers, setTiers] = useState(initialTiers ?? event.ticketTypes ?? [])
  const [preview, setPreview] = useState(initialPreview)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState([])
  const [fieldErrors, setFieldErrors] = useState({})
  const [editing, setEditing] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [notice, setNotice] = useState(null)
  const [addKey, setAddKey] = useState(0)
  const eventZone = event.timezone ?? 'America/New_York'

  /**
   * Re-read the tiers and the priced preview together.
   *
   * Together on purpose: a price shown beside a tier that has changed is worse
   * than no price.
   *
   * @returns {Promise<void>} Resolves when reloaded.
   */
  async function reload() {
    const [tiersResponse, previewResponse] = await Promise.all([
      apiFetch(`/v1/events/${encodeURIComponent(event.id)}/tiers`),
      apiFetch(`/v1/events/${encodeURIComponent(event.id)}/price-preview`),
    ])

    const tiersBody = await tiersResponse.json().catch(() => null)
    const previewBody = await previewResponse.json().catch(() => null)

    const nextTiers = tiersResponse.ok && tiersBody?.data ? tiersBody.data : tiers
    const nextPreview = previewResponse.ok && previewBody ? (previewBody.data ?? []) : preview

    if (tiersResponse.ok && tiersBody?.data) {
      setTiers(nextTiers)
      if (Number.isInteger(tiersBody.meta?.revision)) onRevision(tiersBody.meta.revision)
    }

    if (previewResponse.ok && previewBody) setPreview(nextPreview)

    onTiers(nextTiers, nextPreview)
  }

  /**
   * Send one write and reload on success.
   *
   * @param {string} path The path under the event.
   * @param {object} init `apiFetch` options.
   * @param {string} fallback What to say when the server gives no sentence.
   * @returns {Promise<boolean>} Whether it was saved.
   */
  async function write(path, init, fallback) {
    setBusy(true)
    setError(null)
    setProblems([])
    setFieldErrors({})
    setNotice(null)

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}${path}`, init)
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(refusalSentence(response.status, body, fallback))
        setProblems(body?.error?.problems ?? [])
        setFieldErrors(fieldIssues(body))
        return false
      }

      if (Number.isInteger(body?.meta?.revision)) onRevision(body.meta.revision)
      await reload()
      return true
    } catch {
      setError('The service is not responding. Nothing has been saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  /**
   * Add a tier.
   *
   * @param {object} body The body, without the revision.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function addTier(body) {
    const saved = await write(
      '/tiers',
      { method: 'POST', body: JSON.stringify({ revision, ...body }) },
      'The ticket type was refused.',
    )

    if (saved) {
      setAddKey((current) => current + 1)
      setNotice(`Added "${body.name}".`)
    }
  }

  /**
   * Save an edit: only the fields that changed.
   *
   * @param {object} tier The tier.
   * @param {object} changed The changed fields.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function saveTier(tier, changed) {
    const saved = await write(
      `/tiers/${encodeURIComponent(tier.id)}`,
      { method: 'PATCH', body: JSON.stringify({ revision, ...changed }) },
      'The ticket type could not be changed.',
    )

    if (saved) {
      setEditing(null)
      setNotice(`Saved "${changed.name ?? tier.name}".`)
    }
  }

  /**
   * Put a tier on sale, or pause it.
   *
   * @param {object} tier The tier.
   * @param {string} status The status to set.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function setTierStatus(tier, status) {
    await write(
      `/tiers/${encodeURIComponent(tier.id)}`,
      { method: 'PATCH', body: JSON.stringify({ revision, status }) },
      'The ticket type could not be changed.',
    )
  }

  /**
   * Remove one tier. The revision travels in the query string.
   *
   * @param {object} tier The tier.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function removeTier(tier) {
    const removed = await write(
      `/tiers/${encodeURIComponent(tier.id)}`,
      { method: 'DELETE', query: { revision } },
      'The ticket type could not be removed.',
    )

    setConfirmRemove(null)
    if (removed) setNotice(`Removed "${tier.name}".`)
  }

  /**
   * The server's all-in breakdown for one tier.
   *
   * @param {object} tier The tier.
   * @returns {object|null} The breakdown, or null when the preview has not caught up.
   */
  const priced = (tier) => preview.find((entry) => entry.ticketTypeId === tier.id) ?? null

  /**
   * Where a reserved tier's seats are, in words.
   *
   * @param {object} tier The tier.
   * @returns {string|null} `Reserved — Stalls at Session 1 — …`, or null.
   */
  function seating(tier) {
    if (!tier.reserved) return null

    const index = sessions.findIndex((candidate) => candidate.id === tier.eventSessionId)
    const session = sessions[index]
    const zone = session?.priceZones?.find((candidate) => candidate.id === tier.priceZoneId)

    return `Reserved — ${zone?.name ?? 'a price zone'}${session ? ` at ${sessionLabel(session, index)}` : ''}`
  }

  return (
    <section aria-labelledby="tiers-heading" className="space-y-5">
      <h2 id="tiers-heading" className="text-xl font-semibold text-ink">
        Tickets
      </h2>
      <p className="text-sm text-ink-muted">
        The all-in column is what a buyer is charged, worked out by the same code that charges them.
        It is on this screen so that the number you set and the number they pay are never a surprise
        to either of you.
      </p>
      {mode === 'live' ? (
        <p className="text-sm text-ink-muted">
          This event is public. You can add ticket types, rename them, change their sales windows,
          raise how many there are and pause them. A price somebody has paid stays as it is, and a
          new ticket type is a draft until you put it on sale.
        </p>
      ) : null}

      <p role="status" aria-live="polite" className="text-sm font-medium text-ink-muted">
        {notice}
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
        <p className="rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-muted">
          No ticket types. An event cannot go on sale without at least one.
        </p>
      ) : (
        <ul className="space-y-3">
          {tiers.map((tier) => {
            const money = priced(tier)
            const [label, tone] = TIER_STATUS[tier.status] ?? [tier.status, 'neutral']
            const session = sessions.find((candidate) => candidate.id === tier.eventSessionId)
            const zone = session?.timezone ?? eventZone
            const windowLine = windowText(tier, zone)
            const removable = tier.removable ?? (tier.quantitySold ?? 0) === 0

            return (
              <li key={tier.id}>
                <Card>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                          <span>{tier.name}</span>
                          <Badge variant={tone} srLabel="State:">
                            {label}
                          </Badge>
                          {tier.visibility === 'HIDDEN' ? (
                            <Badge variant="neutral" srLabel="Visibility:">
                              Hidden
                            </Badge>
                          ) : null}
                          {tier.complimentary ? (
                            <Badge variant="info" srLabel="Price:">
                              Complimentary
                            </Badge>
                          ) : null}
                        </p>
                        {tier.description ? (
                          <p className="mt-1 text-sm text-ink-muted">{tier.description}</p>
                        ) : null}
                        {seating(tier) ? (
                          <p className="mt-1 text-sm text-ink-muted">{seating(tier)}</p>
                        ) : null}
                        {windowLine ? (
                          <p className="mt-1 text-sm text-ink-muted">{windowLine}</p>
                        ) : null}
                        <p className="mt-2 text-sm text-ink-muted">
                          Face value {formatPrice(tier.priceCents, tier.currency)}
                          {tier.reserved
                            ? ` · ${(tier.quantitySold ?? 0).toLocaleString('en-US')} sold`
                            : ` · ${(tier.quantitySold ?? 0).toLocaleString('en-US')} of ${tier.quantityTotal.toLocaleString('en-US')} sold`}
                          {tier.heldQuantity > 0
                            ? ` · ${tier.heldQuantity.toLocaleString('en-US')} held`
                            : ''}
                        </p>

                        {money ? (
                          <p className="mt-1 text-sm">
                            <span className="font-medium text-ink">
                              {formatPrice(money.allInCents, money.currency)} all in
                            </span>{' '}
                            {/* The parts as amounts: a zero fee is "$0.00 fee",
                                never "Free fee", which reads as a fee called free. */}
                            <span className="text-ink-muted">
                              ({formatAmount(money.feesCents, money.currency)} fee
                              {money.taxCents > 0
                                ? ` + ${formatAmount(money.taxCents, money.currency)} tax`
                                : ''}
                              )
                            </span>
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-ink-muted">
                            The all-in price has not been worked out for this tier.
                          </p>
                        )}
                      </div>

                      {canEdit ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            aria-expanded={editing === tier.id}
                            onClick={() => setEditing(editing === tier.id ? null : tier.id)}
                          >
                            {editing === tier.id ? 'Close' : 'Edit'}
                          </Button>
                          {/*
                            The control `openSales` actually counts. A tier is
                            a draft until somebody says it sells, and an event
                            with no tier on sale cannot open sales at all.
                          */}
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              setTierStatus(tier, tier.status === 'ON_SALE' ? 'PAUSED' : 'ON_SALE')
                            }
                          >
                            {tier.status === 'ON_SALE' ? 'Pause' : 'Put on sale'}
                          </Button>
                          {removable ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => setConfirmRemove(tier.id)}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {canEdit && !removable ? (
                      <p className="mt-2 text-sm text-ink-muted">{unremovableReason(tier)}</p>
                    ) : null}

                    {confirmRemove === tier.id ? (
                      <div
                        role="group"
                        aria-label={`Remove ${tier.name}`}
                        className="mt-3 rounded-control border border-line p-3"
                      >
                        <p className="text-sm text-ink">
                          Remove “{tier.name}”? Nobody has bought or held one, so nothing is lost.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => removeTier(tier)}
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
                      </div>
                    ) : null}

                    {editing === tier.id ? (
                      <div className="mt-4 border-t border-line pt-4">
                        <h3 className="sr-only">Edit {tier.name}</h3>
                        <TierForm
                          kind="edit"
                          idPrefix={`tier-${tier.id}`}
                          initial={toTierForm(tier)}
                          sessions={sessions}
                          eventTimezone={eventZone}
                          mode={mode}
                          usage={{
                            sold: tier.quantitySold ?? 0,
                            held: tier.heldQuantity ?? 0,
                            hasOrders: Boolean(tier.hasOrders),
                          }}
                          serverErrors={fieldErrors}
                          busy={busy}
                          onSubmit={(changed) => saveTier(tier, changed)}
                          onCancel={() => setEditing(null)}
                        />
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      {canEdit ? (
        <div className="space-y-4 rounded-card border border-line p-4">
          <h3 className="text-lg font-semibold text-ink">Add a ticket type</h3>
          <TierForm
            key={addKey}
            kind="create"
            idPrefix="tier"
            initial={blankTierForm('USD')}
            sessions={sessions}
            eventTimezone={eventZone}
            mode={mode === 'live' ? 'live' : 'draft'}
            serverErrors={editing ? {} : fieldErrors}
            busy={busy}
            onSubmit={addTier}
          />
        </div>
      ) : null}
    </section>
  )
}
