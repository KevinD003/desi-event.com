'use client'

/**
 * What can be done to one organiser invitation that still has a code: withdraw
 * it, or issue a new code in its place.
 *
 * - **Withdraw** (`POST …/:id/revoke`) stops the code working at once. It only
 *   reduces what is on offer, so it needs no second factor.
 * - **Issue a new code** (`POST …/:id/reissue`) withdraws the old code and
 *   issues a new one for the same address, organisation and note, with a new
 *   fourteen days. It hands out something that makes an owner, so it needs a
 *   recent second factor (the `SECURITY_ROLE` step-up): when the API asks,
 *   {@link StepUpPrompt} is drawn and the request is sent again, once.
 *
 * Each asks first, in a group that says what will happen. Either takes the
 * row out of the waiting list, so the outcome is said, and a new code is held,
 * by the {@link InvitationAnnouncer} above the table, which the refresh does
 * not replace: a code is shown once, in {@link OneTimeCodePanel} with its
 * ready-to-send message, when codes are not emailed, and survives every
 * refresh until the person says they have handed it over. Outside an
 * announcer (a row drawn on its own) the row says and holds them itself.
 *
 * Any holder of the platform's invite capability may act on any invitation:
 * it is one shared queue, and the API records who did what.
 *
 * @module app/admin/organizer-invitations/organizer-invitation-actions
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { OneTimeCodePanel } from '../../../components/one-time-code-panel.jsx'
import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { Alert, Button } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import { composeLetter, untilWords } from './organizer-invite-form.jsx'
import { useHoldInvitationCode, useInvitationAnnounce } from './organizer-invitation-announcer.jsx'
import { JOIN_PATH, JOIN_PLACE, rowActions } from './organizer-invitation-vocabulary.js'

/** The frame of an open confirmation. */
const GROUP =
  'mt-2 rounded-card border border-line-strong bg-surface p-3 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus'

/**
 * @typedef {object} OrganizerInvitationActionsProps
 * @property {object} invitation The invitation, as the list answers it.
 * @property {string|null} [inviterName] The administrator's display name, for the message.
 */

/**
 * The row's actions.
 *
 * @param {OrganizerInvitationActionsProps} props Component props.
 * @returns {JSX.Element|null} The actions, or nothing for a row with no code left.
 */
export function OrganizerInvitationActions({ invitation, inviterName = null }) {
  const router = useRouter()
  const id = useId()
  const offers = rowActions(invitation)
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [issued, setIssued] = useState(null)
  const [outcome, setOutcome] = useState('')
  const groupRef = useRef(null)
  const withdrawRef = useRef(null)
  const reissueRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const announceAbove = useInvitationAnnounce()
  const holdAbove = useHoldInvitationCode()
  const email = invitation.email

  /**
   * Say what happened: above the table when there is a place for it, which a
   * refresh does not unmount, and in the row otherwise.
   *
   * @param {string} text The sentence.
   * @returns {void}
   */
  function say(text) {
    if (announceAbove) announceAbove(text, { focus: true })
    else setOutcome(text)
  }

  if (!offers.withdraw && !offers.reissue && !issued) return null

  /**
   * Open a confirmation.
   *
   * @param {'withdraw'|'reissue'} which Which one.
   * @returns {void}
   */
  function open(which) {
    setConfirming(which)
    setRefused(null)
    setStepUp(false)
    setOutcome('')
    focusAfterRender(groupRef)
  }

  /**
   * Close the confirmation and put focus back where it came from.
   *
   * @returns {void}
   */
  function close() {
    const opener = confirming === 'withdraw' ? withdrawRef : reissueRef

    setConfirming(null)
    setRefused(null)
    setStepUp(false)
    focusAfterRender(opener)
  }

  /**
   * Draw what the API refused, in its words.
   *
   * @param {Response} response The answer.
   * @param {object|null} parsed Its body.
   * @param {string} fallback What to say when the API said nothing useful.
   * @returns {void}
   */
  function refuse(response, parsed, fallback) {
    const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

    setRefused({
      sentence: refusalSentence(response.status, parsed, fallback, retryAfterSeconds),
      enrol: parsed?.error?.code === 'MFA_ENROLMENT_REQUIRED',
    })
    focusAfterRender(groupRef)
  }

  /**
   * Withdraw the invitation.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function withdraw() {
    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(
        `/v1/platform/organizer-invitations/${encodeURIComponent(invitation.id)}/revoke`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setConfirming(null)
        say(`The invitation to ${email} was withdrawn. Its code no longer works.`)
        router.refresh()
        return
      }

      refuse(response, parsed, 'The invitation was not withdrawn.')
    } catch {
      setRefused({ sentence: describeApiRefusal(null).detail, enrol: false })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Issue a new code in place of the old one.
   *
   * @param {boolean} retried Whether this is the one retry after a step-up.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function reissue(retried = false) {
    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(
        `/v1/platform/organizer-invitations/${encodeURIComponent(invitation.id)}/reissue`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        const data = parsed?.data ?? {}

        setConfirming(null)

        if (data.delivery?.mode === 'MANUAL' && data.delivery.invitationCode) {
          const code = data.delivery.invitationCode
          const held = {
            code,
            recipient: data.email ?? email,
            expiresAt: data.expiresAt ?? null,
            letter: composeLetter({
              code,
              email: data.email ?? email,
              organizationName: data.organizationName ?? invitation.organizationName,
              expiresAt: data.expiresAt,
              note: data.note ?? invitation.note ?? null,
              inviterName,
            }),
          }

          // Held above the table when it can be — this row goes at the next
          // refresh — and nowhere else until the person says it is handed over.
          if (holdAbove) holdAbove(held)
          else setIssued(held)
          return
        }

        const until = untilWords(data.expiresAt)

        say(`A new code was emailed to ${email}.${until ? ` It works until ${until}.` : ''}`)
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED' && !retried) {
        setStepUp(true)
        return
      }

      refuse(response, parsed, 'No new code was issued.')
    } catch {
      setRefused({ sentence: describeApiRefusal(null).detail, enrol: false })
    } finally {
      setBusy(false)
    }
  }

  if (issued) {
    return (
      <OneTimeCodePanel
        code={issued.code}
        heading={`New organiser invitation code for ${issued.recipient}`}
        recipient={issued.recipient}
        expiresAt={issued.expiresAt}
        acceptPath={JOIN_PATH}
        acceptPlace={JOIN_PLACE}
        lostAdvice="If it is lost, issue a new code from this list, which stops this one working."
        letter={issued.letter}
        onDone={() => {
          setIssued(null)
          router.refresh()
        }}
      />
    )
  }

  return (
    <div>
      <p role="status" aria-live="polite" className="text-sm text-ink">
        {outcome}
      </p>

      {confirming ? (
        <div
          ref={groupRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-heading`}
          className={GROUP}
        >
          <p id={`${id}-heading`} className="text-sm font-semibold text-ink">
            {confirming === 'withdraw'
              ? `Withdraw the invitation to ${email}?`
              : `Issue a new code for ${email}?`}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {confirming === 'withdraw'
              ? 'The code stops working at once.'
              : 'The code issued before stops working at once.'}
          </p>

          {refused ? (
            <div className="mt-2">
              <Alert variant="error" title="Nothing was changed">
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

          {stepUp ? (
            <div className="mt-2">
              <StepUpPrompt
                action={`issue a new code for ${email}`}
                onConfirmed={() => {
                  setStepUp(false)
                  void reissue(true)
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={confirming === 'withdraw' ? 'danger' : 'primary'}
              className="min-h-11"
              disabled={busy || stepUp}
              onClick={() => (confirming === 'withdraw' ? withdraw() : reissue())}
            >
              {confirming === 'withdraw'
                ? busy
                  ? 'Withdrawing…'
                  : 'Withdraw it'
                : busy
                  ? 'Issuing…'
                  : 'Issue a new code'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {offers.reissue ? (
            <Button
              ref={reissueRef}
              type="button"
              variant="secondary"
              className="min-h-11"
              aria-label={`Issue a new code for ${email}`}
              onClick={() => open('reissue')}
            >
              Issue a new code
            </Button>
          ) : null}
          {offers.withdraw ? (
            <Button
              ref={withdrawRef}
              type="button"
              variant="secondary"
              className="min-h-11"
              aria-label={`Withdraw the invitation to ${email}`}
              onClick={() => open('withdraw')}
            >
              Withdraw
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
