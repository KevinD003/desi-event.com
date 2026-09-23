'use client'

/**
 * What a team manager may do to one member, or to one open invitation.
 *
 * ## What is offered is decided on the server; what happens is decided by the API
 *
 * The page works out, per row, whether this session holds `team:role_manage`
 * or `team:remove` *in this organisation*, whether the row is the caller's
 * own, and whether the caller's role reaches the member's — the three things
 * `apps/api/src/routes/teams.js` checks. It passes the answers in as
 * booleans. None of that is authorisation: the API asks again, inside the
 * transaction that writes, and this component repeats its refusal word for
 * word when it has one worth repeating ("You cannot change your own role…",
 * "This is the only owner…").
 *
 * ## A role change always sends the whole door scope
 *
 * The API replaces a member's scope on every role change, and an omitted
 * `eventIds` is an empty one. So for MANAGER, STAFF and SCANNER the form starts
 * from the scope the member has, sends every event that is ticked, and keeps
 * any scoped event the picker could not list rather than dropping it without a
 * word. When the organisation's events could not be read at all, a door role
 * cannot be saved from here: saving would have admitted the person to nothing,
 * and they would find out at the door.
 *
 * The picker lists at most a hundred events, the API's largest page: the ones
 * that start latest, in date order (see `listOrganizationEvents`). When the
 * organisation has more, the picker says how many are left out.
 *
 * ## A role that cannot be kept starts on no role
 *
 * An owner may change another owner's role, and Owner is never on offer. The
 * select then has nothing to start on that means "as it is", and starting on
 * the first role in the list would make a demotion one click long. So it
 * starts on "Choose a role", Save waits for a choice, and the panel says what
 * the member is now.
 *
 * ## Removing somebody is confirmed in place
 *
 * An inline panel, not a modal: it traps nothing, it says what removal does,
 * and it asks for a reason that goes on the audit record. The API accepts a
 * shorter reason or none; this screen asks for four characters or more,
 * because "x" on an audit record is the same as no reason.
 *
 * @module app/organizer/team/member-actions
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { Alert, Button, FormField, Select, Textarea } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import { useAnnounce } from './team-announcer.jsx'
import {
  REASON_MAX,
  REASON_MIN,
  ROLE_DESCRIPTIONS,
  isEventScoped,
  isOrganizationWide,
  roleLabel,
} from './team-vocabulary.js'

/** The frame of an open panel. */
const PANEL =
  'mt-3 rounded-card border border-line-strong bg-surface-raised p-4 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/** The frame of the removal panel: danger, because it is. */
const DANGER_PANEL =
  'mt-3 rounded-card border border-status-danger/25 bg-status-danger-soft p-4 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * @typedef {object} Refused
 * @property {string} sentence What to tell the person.
 * @property {boolean} enrol Whether the way forward is setting up a second factor.
 */

/**
 * What a refused mutation should say.
 *
 * The API's own sentence for a 403, 404, 409 or 422 — those are specific and
 * written for people. The refusal vocabulary's for everything else, because a
 * step-up or enrolment refusal names an endpoint and a server error is not for
 * a person at all. A rate limit says how long, when `Retry-After` does.
 *
 * @param {Response} response The refused response.
 * @param {object|null} body Its parsed body.
 * @returns {Refused} The sentence, and whether enrolment is the way forward.
 */
function refusedBecause(response, body) {
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

    return {
      sentence: describeApiRefusal({ status: 429, retryAfterSeconds }).detail,
      enrol: false,
    }
  }

  return {
    sentence: refusalSentence(response.status, body, 'That was refused.'),
    enrol: body?.error?.code === 'MFA_ENROLMENT_REQUIRED',
  }
}

/**
 * The refusal, with the enrolment link when that is the way forward.
 *
 * @param {object} props Component props.
 * @param {Refused|null} props.refused What was refused, or null.
 * @returns {JSX.Element|null} The alert.
 */
function RefusalAlert({ refused }) {
  if (!refused) return null

  return (
    <div className="mt-3">
      <Alert variant="error" title="Nothing was changed">
        <p>{refused.sentence}</p>
        {refused.enrol ? (
          <p className="mt-2">
            <Link
              href="/account/security"
              className="rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              Set up two-step sign-in
            </Link>
          </p>
        ) : null}
      </Alert>
    </div>
  )
}

/**
 * Say an outcome: through the page's shared region when there is one, or here.
 *
 * @returns {{announce: Function, region: JSX.Element|null}} The announcer and, when needed, its own region.
 */
function useOutcome() {
  const shared = useAnnounce()
  const [local, setLocal] = useState('')

  if (shared) return { announce: shared, region: null }

  return {
    announce: (text) => setLocal(text),
    region: (
      <p aria-live="polite" role="status" className="text-sm text-ink-muted">
        {local}
      </p>
    ),
  }
}

/**
 * @typedef {object} PickerEvent
 * @property {string} id The event id.
 * @property {string} title Its title.
 * @property {string} when Its date, already formatted in its own zone.
 */

/**
 * @typedef {object} MemberActionsProps
 * @property {string} organizationId Whose team.
 * @property {{id: string, name: string, role: string, scopedEventIds: string[]}} member The member, with a name already cleared of any address.
 * @property {string[]} assignableRoles The roles the API says this caller may grant.
 * @property {PickerEvent[]|null} events The organisation's events, or null when they could not be read.
 * @property {number|null} [eventTotal] How many events the organisation has in all, when the picker could not list every one.
 * @property {boolean} offerRoleChange Whether to offer changing this member's role.
 * @property {boolean} offerRemove Whether to offer removing this member.
 */

/**
 * The controls for one member.
 *
 * @param {MemberActionsProps} props Component props.
 * @returns {JSX.Element|null} The controls, or nothing when none are offered.
 */
export function MemberActions({
  organizationId,
  member,
  assignableRoles,
  events,
  eventTotal = null,
  offerRoleChange,
  offerRemove,
}) {
  const router = useRouter()
  const id = useId()
  const { announce, region } = useOutcome()
  // OWNER is never assignable — ownership moves by a route of its own — so it
  // is filtered here as well as by the API.
  const grantable = assignableRoles.filter((role) => role !== 'OWNER')
  // A role that cannot be kept (an owner's) starts on no choice at all.
  const keepsRole = grantable.includes(member.role)
  const initialRole = keepsRole ? member.role : ''

  const [pending, setPending] = useState(null)
  const [role, setRole] = useState(initialRole)
  const [chosen, setChosen] = useState(() => new Set(member.scopedEventIds))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const panelRef = useRef(null)
  const returnFocus = useRef(null)

  const canChange = offerRoleChange && grantable.length > 0

  if (!canChange && !offerRemove) return null

  const listed = new Set((events ?? []).map((event) => event.id))
  // Scoped events the picker cannot show — beyond the first hundred, or not
  // visible to this caller. Kept as they are rather than silently dropped.
  const unlisted = member.scopedEventIds.filter((eventId) => !listed.has(eventId))
  const scoped = isEventScoped(role)
  const eventIds = [
    ...(events ?? []).filter((event) => chosen.has(event.id)).map((event) => event.id),
    ...unlisted,
  ]
  const unchanged =
    role === member.role &&
    (!scoped ||
      (eventIds.length === member.scopedEventIds.length &&
        eventIds.every((eventId) => member.scopedEventIds.includes(eventId))))
  const omittedEvents =
    events && Number.isInteger(eventTotal) && eventTotal > events.length
      ? eventTotal - events.length
      : 0
  const trimmedReason = reason.trim()
  const reasonValid = trimmedReason.length >= REASON_MIN && trimmedReason.length <= REASON_MAX

  /**
   * Open one panel.
   *
   * @param {string} key `role` or `remove`.
   * @param {object} trigger The pressed element, so focus can come back.
   * @returns {void}
   */
  function begin(key, trigger) {
    returnFocus.current = trigger
    setPending(key)
    setRefused(null)
    setStepUp(false)
    setRole(initialRole)
    setChosen(new Set(member.scopedEventIds))
    setReason('')
    queueMicrotask(() => panelRef.current?.focus())
  }

  /**
   * Close the panel and put focus back.
   *
   * @returns {void}
   */
  function dismiss() {
    setPending(null)
    setStepUp(false)
    setRefused(null)
    queueMicrotask(() => returnFocus.current?.focus())
  }

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
   * Send the open panel's command.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    const base = `/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.id)}`
    const removing = pending === 'remove'

    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(removing ? `${base}/remove` : base, {
        method: removing ? 'POST' : 'PATCH',
        body: JSON.stringify(
          removing ? { reason: trimmedReason } : { role, ...(scoped ? { eventIds } : {}) },
        ),
      })
      const body = await response.json().catch(() => null)

      if (response.ok) {
        setPending(null)

        if (removing) {
          // The row is about to go, and the button with it: the shared region
          // takes focus so it is not left on nothing.
          announce(`${member.name} is no longer on this team.`, { focus: true })
        } else {
          announce(`${member.name} is now ${roleLabel(role).toLowerCase()}.`)
          queueMicrotask(() => returnFocus.current?.focus())
        }

        router.refresh()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefused(refusedBecause(response, body))
      queueMicrotask(() => panelRef.current?.focus())
    } catch {
      setRefused({ sentence: describeApiRefusal(null).detail, enrol: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {region}

      {pending === null ? (
        <div className="flex flex-wrap gap-2">
          {canChange ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              aria-label={`Change ${member.name}’s role`}
              onClick={(pressed) => begin('role', pressed.currentTarget)}
            >
              Change role
            </Button>
          ) : null}
          {offerRemove ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              aria-label={`Remove ${member.name} from the team`}
              onClick={(pressed) => begin('remove', pressed.currentTarget)}
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}

      {pending === 'role' ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-role-heading`}
          className={PANEL}
        >
          <h3 id={`${id}-role-heading`} className="font-semibold text-ink">
            Change {member.name}’s role
          </h3>
          <p className="mt-1 text-sm text-ink-muted">Now: {roleLabel(member.role)}.</p>

          <RefusalAlert refused={refused} />

          {stepUp ? (
            <div className="mt-3">
              <StepUpPrompt
                action={`change ${member.name}’s role`}
                onConfirmed={() => {
                  setStepUp(false)
                  void send()
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          <div className="mt-3">
            <FormField
              label="New role"
              id={`${id}-role`}
              description="Only the roles your own role can grant. Owner is not among them: ownership is handed over separately."
            >
              <Select value={role} onChange={(changed) => setRole(changed.target.value)}>
                {keepsRole ? null : (
                  <option value="" disabled>
                    Choose a role
                  </option>
                )}
                {grantable.map((option) => (
                  <option key={option} value={option}>
                    {roleLabel(option)}
                  </option>
                ))}
              </Select>
            </FormField>
            <p className="mt-2 text-sm text-ink-muted">{ROLE_DESCRIPTIONS[role] ?? ''}</p>
          </div>

          {scoped && events ? (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-ink">
                Which events they may admit people to
              </legend>
              <p className="mt-1 text-sm text-ink-muted">
                The whole door scope, replaced on save. With no event ticked they admit nobody.
              </p>
              {events.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  This organisation has no events to name.
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
                          className="size-5 accent-action-primary focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
                        />
                        <span>
                          {event.title}
                          {event.when ? (
                            <span className="text-ink-muted"> · {event.when}</span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {omittedEvents > 0 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  Only the {events.length} latest-starting of this organisation’s {eventTotal}{' '}
                  events are listed; the {omittedEvents} that start earliest are left out.
                </p>
              ) : null}
              {unlisted.length > 0 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  {unlisted.length === 1
                    ? 'One event in their scope is not in this list; it is kept as it is.'
                    : `${unlisted.length} events in their scope are not in this list; they are kept as they are.`}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          {scoped && !events ? (
            <p className="mt-4 rounded-card border border-status-warning/30 bg-status-warning-soft p-3 text-sm text-ink">
              This organisation’s events could not be read, so a door scope cannot be chosen here
              just now. Saving a door role without one would leave them admitting nobody, so it is
              not offered. Reload to try again.
            </p>
          ) : null}

          {role && !scoped && member.scopedEventIds.length > 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              {isOrganizationWide(role)
                ? 'Their door scope is cleared: this role admits to every event of the organisation without one.'
                : 'Their door scope is cleared: this role does not work a door.'}
            </p>
          ) : null}

          {scoped && events && eventIds.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-status-warning">
              No event is ticked. Saved like this, they will admit nobody.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              onClick={send}
              disabled={busy || unchanged || !role || (scoped && !events)}
            >
              {busy ? 'Saving…' : 'Save the new role'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={dismiss}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {pending === 'remove' ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-remove-heading`}
          className={DANGER_PANEL}
        >
          <h3 id={`${id}-remove-heading`} className="font-semibold text-status-danger">
            Remove {member.name} from the team
          </h3>
          <p className="mt-1 text-sm text-ink">
            Their role and every door scope in this organisation go at once, from their next
            request. Their account stays. Bringing them back needs an invitation, and invitations
            cannot be delivered in this build.
          </p>

          <RefusalAlert refused={refused} />

          {stepUp ? (
            <div className="mt-3">
              <StepUpPrompt
                action={`remove ${member.name}`}
                onConfirmed={() => {
                  setStepUp(false)
                  void send()
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          <div className="mt-3">
            <FormField
              label="Why"
              id={`${id}-reason`}
              required
              description={`Between ${REASON_MIN} and ${REASON_MAX} characters. Kept with the audit record of the removal.`}
            >
              <Textarea
                rows={3}
                maxLength={REASON_MAX}
                value={reason}
                onChange={(changed) => setReason(changed.target.value)}
              />
            </FormField>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              className="min-h-11"
              onClick={send}
              disabled={busy || !reasonValid}
            >
              {busy ? 'Removing…' : `Remove ${member.name}`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={dismiss}
              disabled={busy}
            >
              Keep them
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * @typedef {object} InvitationActionsProps
 * @property {string} organizationId Whose team.
 * @property {{id: string, role: string}} invitation The invitation.
 */

/**
 * Withdrawing one open invitation, confirmed in place.
 *
 * `POST …/invitations/:id/revoke`. Idempotent on the API's side, so a second
 * press after a slow first one changes nothing.
 *
 * @param {InvitationActionsProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function InvitationActions({ organizationId, invitation }) {
  const router = useRouter()
  const id = useId()
  const { announce, region } = useOutcome()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const panelRef = useRef(null)
  const returnFocus = useRef(null)
  const what = `the invitation to join as ${roleLabel(invitation.role).toLowerCase()}`

  /**
   * Withdraw it.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(
        `/v1/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitation.id)}/revoke`,
        { method: 'POST' },
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        setConfirming(false)
        announce(`Withdrawn: ${what} can no longer be accepted.`, { focus: true })
        router.refresh()
        return
      }

      // The contract declares no step-up on revoke; if the auth plugin asks
      // for one all the same, it is offered rather than left as a dead end.
      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefused(refusedBecause(response, body))
      queueMicrotask(() => panelRef.current?.focus())
    } catch {
      setRefused({ sentence: describeApiRefusal(null).detail, enrol: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {region}

      {confirming ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-heading`}
          className={PANEL}
        >
          <h3 id={`${id}-heading`} className="font-semibold text-ink">
            Withdraw {what}?
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            It stops working at once. Nothing was ever delivered for it, so nobody is told.
          </p>

          <RefusalAlert refused={refused} />

          {stepUp ? (
            <div className="mt-3">
              <StepUpPrompt
                action={`withdraw ${what}`}
                onConfirmed={() => {
                  setStepUp(false)
                  void send()
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" onClick={send} disabled={busy}>
              {busy ? 'Withdrawing…' : 'Withdraw it'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                setRefused(null)
                setStepUp(false)
                queueMicrotask(() => returnFocus.current?.focus())
              }}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          aria-label={`Withdraw ${what}`}
          onClick={(pressed) => {
            returnFocus.current = pressed.currentTarget
            setRefused(null)
            setStepUp(false)
            setConfirming(true)
            queueMicrotask(() => panelRef.current?.focus())
          }}
        >
          Withdraw
        </Button>
      )}
    </div>
  )
}
