'use client'

/**
 * Changing one account's platform role.
 *
 * `POST /v1/platform/users/:id/role` with the role and a reason. The API
 * decides everything that matters — that the caller is still a super
 * administrator, that the account is not the caller's own, that the last super
 * administrator is not demoted — inside the transaction that writes, and this
 * component repeats its sentence when it refuses.
 *
 * ## What the person is told before they save
 *
 * That the account is signed out everywhere, because a role change ends every
 * session it holds; and, for a role that needs a second factor on an account
 * that has none, that the account will be asked to set one up before it can do
 * anything in that role.
 *
 * ## The caller's own account
 *
 * Offered disabled, with the reason beside it. The API refuses it as well; the
 * point of drawing it at all is that a missing control reads as a fault.
 *
 * ## A recent second factor
 *
 * The route's step-up policy is short. When the API answers
 * `STEP_UP_REQUIRED`, {@link StepUpPrompt} is drawn, and the same request is
 * sent again once the factor is accepted.
 *
 * @module app/admin/users/platform-role-change
 */

import Link from 'next/link'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { Alert, Button, FormField, Select, Textarea } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import {
  PLATFORM_ROLES,
  PLATFORM_ROLE_DESCRIPTIONS,
  PRIVILEGED_PLATFORM_ROLES,
  REASON_LIMITS,
  platformRoleLabel,
} from './platform-role-vocabulary.js'

/** The frame of the open panel. */
const PANEL =
  'mt-3 rounded-card border border-line-strong bg-surface p-4 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus'

/**
 * @typedef {object} PlatformRoleChangeProps
 * @property {object} account The account, as the search answers it.
 * @property {Function} onChanged Called once the API has changed it.
 */

/**
 * The control and its panel.
 *
 * @param {PlatformRoleChangeProps} props Component props.
 * @returns {JSX.Element} The rendered control.
 */
export function PlatformRoleChange({ account, onChanged }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [outcome, setOutcome] = useState('')
  const panelRef = useRef(null)
  const openerRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  const name = account.displayName
  const trimmedReason = reason.trim()
  const reasonValid =
    trimmedReason.length >= REASON_LIMITS.min && trimmedReason.length <= REASON_LIMITS.max
  const needsFactor = PRIVILEGED_PLATFORM_ROLES.includes(role) && !account.mfaEnrolled
  const ready = role !== '' && role !== account.role && reasonValid

  if (account.self) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-ink">Platform role</h3>
        <Button
          type="button"
          variant="secondary"
          className="mt-2 min-h-11"
          disabled
          aria-describedby={`${id}-self`}
        >
          Change platform role
        </Button>
        <p id={`${id}-self`} className="mt-2 text-sm text-ink-muted">
          This is your own account. Another super administrator must change your platform role.
        </p>
      </div>
    )
  }

  /**
   * Close the panel and put focus back on the control that opened it.
   *
   * @returns {void}
   */
  function close() {
    setOpen(false)
    setRefused(null)
    setStepUp(false)
    focusAfterRender(openerRef)
  }

  /**
   * Send the change.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(`/v1/platform/users/${encodeURIComponent(account.id)}/role`, {
        method: 'POST',
        body: JSON.stringify({ role, reason: trimmedReason }),
      })
      const body = await response.json().catch(() => null)

      if (response.ok) {
        const ended = body?.data?.sessionsRevoked ?? 0

        setOpen(false)
        setOutcome(
          `${name}’s platform role is now ${platformRoleLabel(role)}. ${sessionsSentence(ended)}`,
        )
        focusAfterRender(openerRef)
        await onChanged?.()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

      setRefused({
        sentence:
          response.status === 429
            ? describeApiRefusal({ status: 429, retryAfterSeconds }).detail
            : refusalSentence(response.status, body, 'The change was refused.'),
        enrol: body?.error?.code === 'MFA_ENROLMENT_REQUIRED',
      })
      focusAfterRender(panelRef)
    } catch {
      setRefused({ sentence: describeApiRefusal(null).detail, enrol: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">Platform role</h3>
      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        {outcome}
      </p>

      {open ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-heading`}
          className={PANEL}
        >
          <h4 id={`${id}-heading`} className="font-semibold text-ink">
            Change {name}’s platform role
          </h4>
          <p className="mt-1 text-sm text-ink-muted">
            Their platform role is {platformRoleLabel(account.role)} now.
          </p>

          <div className="mt-3">
            <FormField label="New platform role" id={`${id}-role`} required>
              <Select value={role} onChange={(changed) => setRole(changed.target.value)}>
                <option value="">Choose a role</option>
                {PLATFORM_ROLES.map((option) => (
                  <option key={option} value={option} disabled={option === account.role}>
                    {platformRoleLabel(option)}
                    {option === account.role ? ' (now)' : ''}
                  </option>
                ))}
              </Select>
            </FormField>
            {role ? (
              <p className="mt-2 text-sm text-ink-muted">{PLATFORM_ROLE_DESCRIPTIONS[role]}</p>
            ) : null}
          </div>

          <div className="mt-3">
            <FormField
              label="Reason"
              id={`${id}-reason`}
              required
              description={`Kept on the audit record. ${REASON_LIMITS.min} to ${REASON_LIMITS.max} characters.`}
            >
              <Textarea
                rows={2}
                maxLength={REASON_LIMITS.max}
                value={reason}
                onChange={(changed) => setReason(changed.target.value)}
              />
            </FormField>
          </div>

          <p className="mt-3 text-sm text-ink">
            Saving signs {name} out everywhere, so they sign in again under the new role.
            {needsFactor
              ? ` The ${platformRoleLabel(role)} role needs two-step sign-in, which ${name} has not set up: they will be asked to before they can do anything in it.`
              : ''}
          </p>

          {refused ? (
            <div className="mt-3">
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
            <div className="mt-3">
              <StepUpPrompt
                action={`change ${name}’s platform role`}
                onConfirmed={() => {
                  setStepUp(false)
                  void send()
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" disabled={busy || !ready} onClick={send}>
              {busy ? 'Changing…' : 'Change the role'}
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
        <Button
          ref={openerRef}
          type="button"
          variant="secondary"
          className="mt-2 min-h-11"
          aria-label={`Change ${name}’s platform role`}
          onClick={() => {
            setRole('')
            setReason('')
            setRefused(null)
            setStepUp(false)
            setOutcome('')
            setOpen(true)
            focusAfterRender(panelRef)
          }}
        >
          Change platform role
        </Button>
      )}
    </div>
  )
}

/**
 * How many sessions ended, in words.
 *
 * @param {number} count The count.
 * @returns {string} The sentence.
 */
function sessionsSentence(count) {
  if (count === 0) return 'They had no session open.'
  if (count === 1) return 'Their one session was ended.'

  return `All ${count} of their sessions were ended.`
}
