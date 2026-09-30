'use client'

/**
 * Inviting somebody to the team.
 *
 * `POST /v1/organizations/:id/invitations` with an address and a role. The
 * roles offered are the ones the API said this caller may grant
 * (`assignableRoles` on the team list); the API bounds them again.
 *
 * ## The code is shown once, here, and handed over by the inviter
 *
 * This build sends no email. The API therefore answers with the invitation
 * code in the response (`delivery.mode` MANUAL), exactly once, and keeps only
 * its digest. This form puts it in {@link OneTimeCodePanel} and in nothing
 * else — not in a web address, not in browser storage. The page is refreshed
 * only after the person says they have handed it over, so a re-render cannot
 * lose it before then. Where a deployment does send email (`EMAIL`), the
 * response carries no code and the form says it was emailed.
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
 */

/**
 * The invite form.
 *
 * @param {InviteFormProps} props Component props.
 * @returns {JSX.Element|null} The form, or nothing when no role may be granted.
 */
export function InviteForm({ organizationId, assignableRoles }) {
  const router = useRouter()
  const id = useId()
  const roles = assignableRoles.filter((role) => role !== 'OWNER')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(roles.includes('STAFF') ? 'STAFF' : (roles.at(-1) ?? ''))
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [issued, setIssued] = useState(null)
  const [emailed, setEmailed] = useState(null)
  const refusalRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  if (roles.length === 0) return null

  const trimmed = email.trim()

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
        { method: 'POST', body: JSON.stringify({ email: trimmed, role }) },
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        const data = body?.data ?? {}

        setEmail('')

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
            ? describeApiRefusal({ status: 429, retryAfterSeconds }).detail
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
                  className="rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
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
        description="They join by signing in with this address and typing the code you are about to be shown."
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
        {isEventScoped(role) ? (
          <p className="mt-1 text-sm text-ink-muted">
            A door role admits nobody until you choose its events, which you do from their row once
            they have joined.
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <Button type="submit" className="min-h-11" disabled={busy || !trimmed.includes('@')}>
          {busy ? 'Inviting…' : 'Invite them'}
        </Button>
      </div>
    </form>
  )
}
