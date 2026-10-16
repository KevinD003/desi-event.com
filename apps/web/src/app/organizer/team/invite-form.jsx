'use client'

/**
 * Inviting somebody to the team.
 *
 * `POST /v1/organizations/:id/invitations` with an address and a role. The
 * roles offered are the ones the API said this caller may grant
 * (`assignableRoles` on the team list): finance, staff, door scanner and
 * viewer at most. Roles that create or publish events are given by the
 * team at The Desi Events, so they are never on offer here; the API refuses one with
 * `POSTING_ROLE_NEEDS_PLATFORM`, and its sentence is shown as it is.
 *
 * ## The code is shown once, here, and handed over by the inviter
 *
 * When codes are not emailed (`MANUAL`, how this site runs unless a mail
 * server is configured), the API answers with the invitation code in the
 * response, exactly once, and keeps only its digest. This form puts it in
 * {@link OneTimeCodePanel} and in nothing else — not in a web address, not in
 * browser storage. The page is refreshed only after the person says they have
 * handed it over, so a re-render cannot lose it before then. Where codes are
 * emailed (`EMAIL`), the response carries no code and the form says it was
 * emailed.
 *
 * ## A door role is invited for chosen events (ADR 0019)
 *
 * For staff and door scanners the form offers the organisation's upcoming
 * events as a group of checkboxes, and sends the ticked ones as `eventIds`.
 * The API stores them with the invitation and makes them the person's door
 * scope when they accept; with none ticked they admit nobody until an owner or
 * administrator chooses their events. The page decides which events are on
 * offer: every upcoming one for an owner, an administrator or a platform
 * administrator, and for a manager only those it is scoped to itself — the
 * API refuses any other, and its sentence is shown as it is.
 *
 * @module app/organizer/team/invite-form
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { OneTimeCodePanel } from '../../../components/one-time-code-panel.jsx'
import { Alert, Button, FormField, Input, Select } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import {
  ACCEPT_PATH,
  ACCEPT_PLACE,
  ROLE_DESCRIPTIONS,
  isEventScoped,
  roleLabel,
} from './team-vocabulary.js'

/**
 * @typedef {object} InviteFormProps
 * @property {string} organizationId Whose team.
 * @property {string[]} assignableRoles The roles the API says this caller may grant.
 * @property {'MANUAL'|'EMAIL'|null} [deliveryMode] How codes go out here, as the session says.
 * @property {Array<{id: string, title: string, when?: string|null}>|null} [events] The events a door role may be invited for, or null when they could not be read.
 * @property {number|null} [laterEventCount] How many events start after the last one listed, when the list could not hold them all.
 * @property {boolean} [limitedToOwnScope] Whether the events are only the ones this caller is scoped to (a manager).
 */

/**
 * What the form says under its events when more start later than it lists.
 *
 * @param {number} count How many are left out.
 * @returns {string} The sentence.
 */
export function laterEventsSentence(count) {
  return count === 1
    ? 'One event that starts after the last one here is not listed: this list holds the hundred events that start soonest.'
    : `${count} events that start after the last one here are not listed: this list holds the hundred events that start soonest.`
}

/**
 * The invite form.
 *
 * @param {InviteFormProps} props Component props.
 * @returns {JSX.Element|null} The form, or nothing when no role may be granted.
 */
export function InviteForm({
  organizationId,
  assignableRoles,
  deliveryMode = null,
  events = null,
  laterEventCount = null,
  limitedToOwnScope = false,
}) {
  const router = useRouter()
  const id = useId()
  const roles = assignableRoles.filter((role) => role !== 'OWNER')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(roles.includes('STAFF') ? 'STAFF' : (roles.at(-1) ?? ''))
  const [chosen, setChosen] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [issued, setIssued] = useState(null)
  const [emailed, setEmailed] = useState(null)
  const refusalRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  if (roles.length === 0) return null

  const trimmed = email.trim()
  const scoped = isEventScoped(role)
  const eventIds = scoped
    ? (events ?? []).filter((event) => chosen.has(event.id)).map((event) => event.id)
    : []

  /**
   * Tick or untick one event.
   *
   * @param {string} eventId The event.
   * @param {boolean} on Whether it is now ticked.
   * @returns {void}
   */
  function toggle(eventId, on) {
    setChosen((current) => {
      const next = new Set(current)

      if (on) next.add(eventId)
      else next.delete(eventId)

      return next
    })
  }

  /**
   * Send the invitation.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function onSubmit(submitted) {
    submitted.preventDefault()
    setBusy(true)
    setRefused(null)
    setEmailed(null)

    try {
      const response = await apiFetch(
        `/v1/organizations/${encodeURIComponent(organizationId)}/invitations`,
        {
          method: 'POST',
          body: JSON.stringify({
            email: trimmed,
            role,
            ...(eventIds.length > 0 ? { eventIds } : {}),
          }),
        },
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        const data = body?.data ?? {}

        setEmail('')
        setChosen(new Set())

        if (data.delivery?.mode === 'MANUAL' && data.delivery.invitationCode) {
          // Held here and nowhere else until the person says it is handed over.
          setIssued({
            code: data.delivery.invitationCode,
            recipient: data.email ?? trimmed,
            expiresAt: data.expiresAt ?? null,
          })
          return
        }

        setEmailed(data.email ?? trimmed)
        router.refresh()
        return
      }

      const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

      setRefused({
        sentence:
          response.status === 429
            ? describeApiRefusal({
                status: 429,
                code: body?.error?.code ?? null,
                message: body?.error?.message ?? null,
                retryAfterSeconds,
              }).detail
            : refusalSentence(response.status, body, 'The invitation was refused.'),
        enrol: body?.error?.code === 'MFA_ENROLMENT_REQUIRED',
      })
      focusAfterRender(refusalRef)
    } catch {
      setRefused({ sentence: describeApiRefusal(null).detail, enrol: false })
      focusAfterRender(refusalRef)
    } finally {
      setBusy(false)
    }
  }

  if (issued) {
    return (
      <OneTimeCodePanel
        code={issued.code}
        heading={`Invitation code for ${issued.recipient}`}
        recipient={issued.recipient}
        expiresAt={issued.expiresAt}
        acceptPath={ACCEPT_PATH}
        acceptPlace={ACCEPT_PLACE}
        onDone={() => {
          // Dropped from memory first, then the list is read again: the new
          // invitation appears there, and the code does not.
          setIssued(null)
          router.refresh()
        }}
      />
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 max-w-xl" aria-label="Invite somebody">
      {emailed ? (
        <div className="mb-3">
          <Alert variant="success" title="Invitation sent">
            <p>An invitation was emailed to {emailed}.</p>
          </Alert>
        </div>
      ) : null}

      {refused ? (
        <div ref={refusalRef} tabIndex={-1} className="mb-3 focus-visible:outline-none">
          <Alert variant="error" title="Nobody was invited">
            <p>{refused.sentence}</p>
            {refused.enrol ? (
              <p className="mt-2">
                <Link
                  href="/account/security"
                  className="rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
                >
                  Set up two-step sign-in
                </Link>
              </p>
            ) : null}
          </Alert>
        </div>
      ) : null}

      <FormField
        label="Their email address"
        id={`${id}-email`}
        required
        description={
          deliveryMode === 'EMAIL'
            ? 'They join by signing in with this address and typing the code that is emailed to it.'
            : 'They join by signing in with this address and typing the code you are about to be shown.'
        }
      >
        <Input
          type="email"
          autoComplete="off"
          value={email}
          onChange={(changed) => setEmail(changed.target.value)}
        />
      </FormField>

      <div className="mt-4">
        <FormField
          label="Role"
          id={`${id}-role`}
          description="Only the roles your own role can grant."
        >
          <Select value={role} onChange={(changed) => setRole(changed.target.value)}>
            {roles.map((option) => (
              <option key={option} value={option}>
                {roleLabel(option)}
              </option>
            ))}
          </Select>
        </FormField>
        <p className="mt-2 text-sm text-ink-muted">{ROLE_DESCRIPTIONS[role] ?? ''}</p>
      </div>

      {scoped && events ? (
        <fieldset
          className="mt-4"
          aria-describedby={
            laterEventCount > 0 ? `${id}-events-note ${id}-events-later` : `${id}-events-note`
          }
        >
          <legend className="text-sm font-medium text-ink">
            Which events they may admit people to
          </legend>
          <p id={`${id}-events-note`} className="mt-1 text-sm text-ink-muted">
            The events you tick become their door scope when they accept. With none ticked they
            admit nobody until an owner or administrator chooses their events.
            {limitedToOwnScope
              ? ' You can give door access only for the events you are scoped to yourself.'
              : ''}
          </p>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              {limitedToOwnScope
                ? 'You are scoped to no upcoming event, so there is none to name.'
                : 'This organisation has no upcoming events to name.'}
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {events.map((event) => (
                <li key={event.id}>
                  <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={chosen.has(event.id)}
                      onChange={(changed) => toggle(event.id, changed.target.checked)}
                      className="size-5 accent-action-primary focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
                    />
                    <span>
                      {event.title}
                      {event.when ? <span className="text-ink-muted"> · {event.when}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {laterEventCount > 0 ? (
            <p id={`${id}-events-later`} className="mt-2 text-sm text-ink-muted">
              {laterEventsSentence(laterEventCount)}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {scoped && !events ? (
        <p className="mt-4 text-sm text-ink-muted">
          This organisation’s events could not be read, so none can be chosen here just now. Invited
          without events, they admit nobody until an owner or administrator chooses their events.
        </p>
      ) : null}

      <div className="mt-4">
        <Button type="submit" className="min-h-11" disabled={busy || !trimmed.includes('@')}>
          {busy ? 'Inviting…' : 'Invite them'}
        </Button>
      </div>
    </form>
  )
}
