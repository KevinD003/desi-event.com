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
 * ## The roles offered are the API's, member by member
 *
 * The team list carries, for each member, the roles this caller may set for
 * them (`roleChoices`), and the select offers exactly those. Roles that create
 * or publish events — event manager, manager, administrator, owner — are given
 * by the team at The Desi Events: somebody who already posts events can be moved down
 * among them, and nobody can be moved up into one from here. A member who does
 * not post events is told so beside the select. When the API refuses all the
 * same (`POSTING_ROLE_NEEDS_PLATFORM`, decided again on the locked row), its
 * sentence is shown as it is.
 *
 * ## A role that cannot be kept starts on no role
 *
 * An owner may change another owner's role, and Owner is never on offer. The
 * select then has nothing to start on that means "as it is", and starting on
 * the first role in the list would make a demotion one click long. So it
 * starts on "Choose a role", Save waits for a choice, and the panel says what
 * the member is now.
 *
 * ## A new code for an invitation, and ownership handed on
 *
 * An open invitation can be given a new code (`…/reissue`) when the first was
 * lost or never handed out. The old code stops working in the same moment, and
 * the new one is shown once in {@link OneTimeCodePanel} — or, when codes are
 * emailed, sent to the invited address and never shown. Offered only for a
 * role the caller may grant, which is the bound the API applies.
 *
 * An owner can hand ownership to another member ({@link TransferOwnership}).
 * It is one swap — they become the owner, the caller an administrator — and
 * needs a recent second factor, so the step-up prompt is offered when the API
 * asks for it and the request is sent again after.
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

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { OneTimeCodePanel } from '../../../components/one-time-code-panel.jsx'
import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { Alert, Button, FormField, Select, Textarea } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import { useAnnounce, useHoldCode } from './team-announcer.jsx'
import {
  ACCEPT_PATH,
  ACCEPT_PLACE,
  REASON_MAX,
  REASON_MIN,
  ROLE_DESCRIPTIONS,
  isEventScoped,
  isOrganizationWide,
  roleLabel,
} from './team-vocabulary.js'

/**
 * Said beside the role select for a member who does not post events: the
 * roles that do are not on offer, and why.
 */
export const POSTING_ROLES_HINT =
  'Roles that create or publish events — event manager, manager and administrator — are given by the team at The Desi Events, not from this page. Ask the team at The Desi Events to add this person in one of those roles.'

/**
 * What withdrawing and reissuing say about the code, per delivery mode.
 *
 * @type {Readonly<Record<string, {withdraw: string, reissue: string}>>}
 */
export const INVITATION_DELIVERY_COPY = Object.freeze({
  MANUAL: {
    withdraw:
      'It stops working at once, and so does its code. Nobody is told: codes are not emailed from this site, so if you handed the code to somebody, let them know yourself.',
    reissue:
      'The code issued before stops working at once. The new one is shown to you once, to hand over yourself.',
  },
  EMAIL: {
    withdraw:
      'It stops working at once, and so does its code. Withdrawing it is not emailed to anybody, so if they are expecting it, let them know yourself.',
    reissue:
      'The code issued before stops working at once. The new one is emailed to the invited address. You will not see it.',
  },
})

/** The frame of an open panel. */
const PANEL =
  'mt-3 rounded-card border border-line-strong bg-surface-raised p-5 shadow-card focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

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

    // The code and message go along: an address that has had its codes for
    // the day is told so, rather than "wait a little".
    return {
      sentence: describeApiRefusal({
        status: 429,
        code: body?.error?.code ?? null,
        message: body?.error?.message ?? null,
        retryAfterSeconds,
      }).detail,
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
 * @property {{id: string, name: string, role: string, postsEvents?: boolean, scopedEventIds: string[]}} member The member, with a name already cleared of any address.
 * @property {string[]} roleChoices The roles the API says this caller may set for this member (its `roleChoices`).
 * @property {PickerEvent[]|null} events The organisation's events, or null when they could not be read.
 * @property {number|null} [eventTotal] How many events the organisation has in all, when the picker could not list every one.
 * @property {boolean} offerRoleChange Whether to offer changing this member's role.
 * @property {boolean} offerRemove Whether to offer removing this member.
 * @property {boolean} [rescopeOnly] Whether keeping a door role and changing only its events is a change (the platform-held organisation, ADR 0019).
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
  roleChoices = [],
  events,
  eventTotal = null,
  offerRoleChange,
  offerRemove,
  rescopeOnly = false,
}) {
  const router = useRouter()
  const id = useId()
  const { announce, region } = useOutcome()
  // Exactly the API's list for this member. OWNER is never on it — ownership
  // moves by its own route (`TransferOwnership`) — and is filtered here too.
  const grantable = roleChoices.filter((role) => role !== 'OWNER')
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
  const focusAfterRender = useFocusAfterRender()

  // A different role — or, in the platform-held organisation, where a scanner
  // stays a scanner (ADR 0019), the same door role with other events.
  const canChange =
    offerRoleChange &&
    (grantable.some((role) => role !== member.role) ||
      (rescopeOnly && isEventScoped(member.role) && grantable.includes(member.role)))

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
    focusAfterRender(panelRef)
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
    focusAfterRender(returnFocus)
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
          focusAfterRender(returnFocus)
        }

        router.refresh()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefused(refusedBecause(response, body))
      focusAfterRender(panelRef)
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
              description="Only the roles your own role can give this member. Owner is not among them: an owner hands ownership over from the Ownership section."
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
            {member.postsEvents ? null : (
              <p className="mt-2 text-sm text-ink-muted">{POSTING_ROLES_HINT}</p>
            )}
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
            request. Their account stays. Bringing them back needs a new invitation.
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
 * @property {boolean} [reissuable] Whether this caller may issue a new code for it: its role is one they may grant.
 * @property {string|null} [recipient] Its address, when this caller may see addresses; otherwise null.
 * @property {boolean} [neverDelivered] Whether its code never reached anybody, so a new one is the only way in.
 * @property {'MANUAL'|'EMAIL'|null} [deliveryMode] How codes go out here, as the session says.
 */

/**
 * Withdrawing one open invitation, or giving it a new code, confirmed in place.
 *
 * `POST …/invitations/:id/revoke`, idempotent on the API's side, so a second
 * press after a slow first one changes nothing. `POST …/invitations/:id/reissue`
 * answers with a new code once, which is drawn in the one-time panel and
 * dropped when the person says they have handed it over.
 *
 * @param {InvitationActionsProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function InvitationActions({
  organizationId,
  invitation,
  reissuable = false,
  recipient = null,
  neverDelivered = false,
  deliveryMode = null,
}) {
  const router = useRouter()
  const id = useId()
  const { announce, region } = useOutcome()
  const holdCode = useHoldCode()
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [issued, setIssued] = useState(null)
  const panelRef = useRef(null)
  const returnFocus = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const what = `the invitation to join as ${roleLabel(invitation.role).toLowerCase()}`
  const reissuing = confirming === 'reissue'

  /**
   * Open one panel.
   *
   * @param {'reissue'|'revoke'} key Which.
   * @param {object} trigger The pressed element, so focus can come back.
   * @returns {void}
   */
  function begin(key, trigger) {
    returnFocus.current = trigger
    setRefused(null)
    setStepUp(false)
    setConfirming(key)
    focusAfterRender(panelRef)
  }

  /**
   * Withdraw it, or give it a new code.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(
        `/v1/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitation.id)}/${reissuing ? 'reissue' : 'revoke'}`,
        { method: 'POST' },
      )
      const body = await response.json().catch(() => null)

      if (response.ok && reissuing) {
        setConfirming(null)

        const code = body?.data?.delivery?.invitationCode

        if (code) {
          const fresh = {
            code,
            recipient: body?.data?.email ?? recipient,
            expiresAt: body?.data?.expiresAt ?? null,
          }

          if (holdCode) {
            // Held above the table, which a refresh does not replace. This
            // row is the withdrawn invitation's and goes at the next refresh,
            // so the list is read again at once: it shows the new invitation,
            // and nothing offers a second code for the old one.
            holdCode({ ...fresh, what })
            router.refresh()
          } else {
            // No page around this control: held here until handed over.
            setIssued(fresh)
          }
        } else {
          announce(`A new invitation was emailed for ${what}.`, { focus: true })
          router.refresh()
        }

        return
      }

      if (response.ok) {
        setConfirming(null)
        announce(`Withdrawn: ${what} can no longer be accepted.`, { focus: true })
        router.refresh()
        return
      }

      // The contract declares no step-up on either; if the auth plugin asks
      // for one all the same, it is offered rather than left as a dead end.
      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefused(refusedBecause(response, body))
      focusAfterRender(panelRef)
    } catch {
      setRefused({ sentence: describeApiRefusal(null).detail, enrol: false })
    } finally {
      setBusy(false)
    }
  }

  if (issued) {
    return (
      <div>
        {region}
        <OneTimeCodePanel
          code={issued.code}
          heading="New invitation code"
          recipient={issued.recipient}
          expiresAt={issued.expiresAt}
          acceptPath={ACCEPT_PATH}
          acceptPlace={ACCEPT_PLACE}
          onDone={() => {
            // Dropped from memory first, then the list is read again.
            setIssued(null)
            announce(`The new code for ${what} is handed over.`, { focus: true })
            router.refresh()
          }}
        />
      </div>
    )
  }

  let confirmLabel = busy ? 'Withdrawing…' : 'Withdraw it'

  if (reissuing) confirmLabel = busy ? 'Issuing…' : 'Issue a new code'

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
            {reissuing ? `Issue a new code for ${what}?` : `Withdraw ${what}?`}
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            {reissuing
              ? (INVITATION_DELIVERY_COPY[deliveryMode]?.reissue ??
                'The code issued before stops working at once.')
              : (INVITATION_DELIVERY_COPY[deliveryMode]?.withdraw ??
                'It stops working at once, and so does its code. Withdrawing it is not emailed to anybody, so if they are expecting it, let them know yourself.')}
          </p>

          <RefusalAlert refused={refused} />

          {stepUp ? (
            <div className="mt-3">
              <StepUpPrompt
                action={reissuing ? `issue a new code for ${what}` : `withdraw ${what}`}
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
              {confirmLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                setConfirming(null)
                setRefused(null)
                setStepUp(false)
                focusAfterRender(returnFocus)
              }}
            >
              {reissuing ? 'Keep the current code' : 'Keep it'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {reissuable ? (
            <Button
              type="button"
              variant={neverDelivered ? 'primary' : 'secondary'}
              className="min-h-11"
              aria-label={`Issue a new code for ${what}`}
              onClick={(pressed) => begin('reissue', pressed.currentTarget)}
            >
              Issue a new code
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            aria-label={`Withdraw ${what}`}
            onClick={(pressed) => begin('revoke', pressed.currentTarget)}
          >
            Withdraw
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * @typedef {object} TransferOwnershipProps
 * @property {string} organizationId Whose ownership.
 * @property {string} organizationName Its name, for the confirmation.
 * @property {{id: string, name: string}} member The member it would go to, with a name already cleared of any address.
 */

/**
 * Handing ownership to another member, confirmed in place.
 *
 * `POST /v1/organizations/:id/ownership` with `{ toMemberId }`. One swap on the
 * server: the member becomes the owner and the caller an administrator. The
 * API asks for a recent second factor under the `SECURITY_ROLE` policy; when it
 * does, the step-up prompt is shown and the request sent again after it.
 *
 * @param {TransferOwnershipProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function TransferOwnership({ organizationId, organizationName, member }) {
  const router = useRouter()
  const id = useId()
  const { announce, region } = useOutcome()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const panelRef = useRef(null)
  const returnFocus = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  /**
   * Hand it over.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(
        `/v1/organizations/${encodeURIComponent(organizationId)}/ownership`,
        { method: 'POST', body: JSON.stringify({ toMemberId: member.id }) },
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        setConfirming(false)
        announce(`${member.name} is now the owner. You are an administrator.`, { focus: true })
        router.refresh()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefused(refusedBecause(response, body))
      focusAfterRender(panelRef)
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
          className={DANGER_PANEL}
        >
          <h3 id={`${id}-heading`} className="font-semibold text-status-danger">
            Hand {organizationName} to {member.name}?
          </h3>
          <p className="mt-1 text-sm text-ink">
            {member.name} becomes the owner and you become an administrator, in one step. They are
            signed out everywhere and sign in again as the owner, and must set up two-step sign-in
            if they have not. Only they can hand it back.
          </p>

          <RefusalAlert refused={refused} />

          {stepUp ? (
            <div className="mt-3">
              <StepUpPrompt
                action={`hand ownership to ${member.name}`}
                onConfirmed={() => {
                  setStepUp(false)
                  void send()
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              className="min-h-11"
              onClick={send}
              disabled={busy}
            >
              {busy ? 'Handing over…' : `Make ${member.name} the owner`}
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
                focusAfterRender(returnFocus)
              }}
            >
              Keep ownership
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          aria-label={`Hand ownership to ${member.name}`}
          onClick={(pressed) => {
            returnFocus.current = pressed.currentTarget
            setRefused(null)
            setStepUp(false)
            setConfirming(true)
            focusAfterRender(panelRef)
          }}
        >
          Hand ownership over
        </Button>
      )}
    </div>
  )
}
