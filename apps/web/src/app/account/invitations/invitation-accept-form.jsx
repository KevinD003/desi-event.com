'use client'

/**
 * Typing in an invitation code.
 *
 * `POST /v1/invitations/accept` with `{ token }`. The field is a password
 * input with autocomplete off, because a code on a screen is a code in a
 * screenshot and in an autofill store; it is cleared the moment the API
 * accepts it.
 *
 * Every refusal the API gives for a code that cannot be used — expired,
 * withdrawn, replaced, used, or issued to another address — is one sentence
 * here. (An organiser invitation's code typed here is the exception: the API
 * says which kind it is, which tells its holder nothing they did not have,
 * and the form sends them to the page where it works.) Telling them apart would tell somebody feeding in guesses which guess
 * was a real invitation.
 *
 * One 403 is not about the code at all: an account that already holds a role
 * needing two-step sign-in, and has none, is refused by every workspace route
 * before the code is even looked at. Calling that an unusable code would send
 * the person to ask for a new one — and a new code kills the one that works.
 * So that refusal says what it is, links to where the second factor is set
 * up, and says the code is still good.
 *
 * Joining can make an account privileged. When it does and the account has no
 * second factor, the next workspace page would refuse it; the success panel
 * says so first and links to where one is set up.
 *
 * @module app/account/invitations/invitation-accept-form
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { Alert, Button, FormField, Input } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter } from '../../../lib/refusal.js'
import { roleLabel } from '../../organizer/team/team-vocabulary.js'

/** The shortest code the API will look at. */
const MIN_LENGTH = 16

/** Said when Join is pressed with nothing typed. */
export const NO_CODE = 'Type or paste the invitation code first.'

/**
 * Said when what was typed is shorter than any code: most often a paste that
 * lost its end. The field hides what is in it, so the sentence has to say it.
 */
export const PART_OF_A_CODE =
  'That is shorter than any invitation code, so part of it is missing. Paste the whole code again.'

/** What every unusable code is told. */
export const UNUSABLE_CODE =
  'That code cannot be used by this account. It may have expired, been withdrawn or used already, or it was issued to a different email address — sign in with the address the invitation was sent to.'

/** What an organiser invitation's code typed here is told. */
export const ORGANIZER_CODE_HERE =
  'That is an organiser invitation code from the Desi-Event team, not a team invitation. Enter it where organiser codes go instead.'

/**
 * What a code for a role that creates or publishes events is told: such roles
 * come from the Desi-Event team now, so an older invitation to one cannot be
 * accepted. The code is not spent.
 */
export const POSTING_ROLE_CODE =
  'This invitation is for a role that creates or publishes events. Those roles are given by the Desi-Event team, so it cannot be accepted here. Ask whoever invited you to ask the Desi-Event team to add you.'

/** Said after the enrolment refusal: the code was never looked at. */
export const CODE_STILL_GOOD =
  'Your code has not been used, so keep it and enter it again once two-step sign-in is set up.'

/** A link that reads as a link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * The accept form.
 *
 * @returns {JSX.Element} The rendered form, or what joining did.
 */
export function InvitationAcceptForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [joined, setJoined] = useState(null)
  const [needsFactorFirst, setNeedsFactorFirst] = useState(false)
  const [organizerCode, setOrganizerCode] = useState(false)
  const [refusals, setRefusals] = useState(0)
  const [fieldError, setFieldError] = useState(null)
  const errorRef = useRef(null)
  const joinedRef = useRef(null)
  const fieldRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const trimmed = code.trim()

  // The form, and the button that had focus, are gone once joining is done:
  // focus goes to what replaced them, so it is read out and nobody is left on
  // <body>. After the commit, when the panel exists to take it.
  useEffect(() => {
    if (joined) joinedRef.current?.focus()
  }, [joined])

  // Each refusal takes focus once it is on screen — counted, so the same
  // sentence twice in a row is announced twice.
  useEffect(() => {
    if (refusals > 0) errorRef.current?.focus()
  }, [refusals])

  /**
   * Send the code.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function onSubmit(submitted) {
    submitted.preventDefault()

    // Nothing that cannot be a code is sent. The button stays pressable so it
    // never sits greyed out with no reason; the field says what is wrong.
    if (trimmed.length < MIN_LENGTH) {
      setFieldError(trimmed.length === 0 ? NO_CODE : PART_OF_A_CODE)
      focusAfterRender(fieldRef)
      return
    }

    setFieldError(null)
    setBusy(true)
    setError(null)
    setNeedsFactorFirst(false)
    setOrganizerCode(false)

    try {
      const response = await apiFetch('/v1/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token: trimmed }),
      })
      const body = await response.json().catch(() => null)

      if (response.ok) {
        // Cleared at once: it is spent, and a spent secret left in a form is a
        // spent secret in a browser's autofill store.
        setCode('')
        setJoined(body?.data ?? {})
        router.refresh()
        return
      }

      const errorCode = body?.error?.code ?? null

      if (response.status === 429) {
        const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

        setError(describeApiRefusal({ status: 429, retryAfterSeconds }).detail)
      } else if (response.status === 403 && errorCode === 'MFA_ENROLMENT_REQUIRED') {
        setError(describeApiRefusal({ status: 403, code: errorCode }).detail)
        setNeedsFactorFirst(true)
      } else if (response.status === 403 && errorCode === 'POSTING_ROLE_NEEDS_PLATFORM') {
        setError(POSTING_ROLE_CODE)
      } else if (response.status === 403 && errorCode === 'WRONG_INVITATION_KIND') {
        // An organiser invitation's code typed here: it is not spent, and it
        // works where organiser codes go.
        setError(ORGANIZER_CODE_HERE)
        setOrganizerCode(true)
      } else if (response.status === 403 || response.status === 409 || response.status === 400) {
        setError(UNUSABLE_CODE)
      } else {
        setError(
          describeApiRefusal({ status: response.status, code: body?.error?.code ?? null }).detail,
        )
      }

      setRefusals((count) => count + 1)
    } catch {
      setError(describeApiRefusal(null).detail)
      setRefusals((count) => count + 1)
    } finally {
      setBusy(false)
    }
  }

  if (joined) {
    const needsFactor = Boolean(joined.session?.mfaRequired && !joined.session?.mfaEnrolled)
    const organization = joined.organizationName ?? 'the organisation'
    const role = roleLabel(joined.role).toLowerCase()
    // False when the account was already a member: the code is spent, and
    // nothing else changed — no role, and no other session.
    const gained = joined.joined !== false

    return (
      <div ref={joinedRef} tabIndex={-1} className="mt-6 max-w-xl focus-visible:outline-none">
        <Alert variant="success" title={gained ? 'You have joined' : 'You were already a member'}>
          {gained ? (
            <p>
              You are now in {organization} as {role}. Your other signed-in sessions have ended, so
              sign in again on any other device.
            </p>
          ) : (
            <p>
              You already belong to {organization} as {role}, so the code is now used up and nothing
              else changed: not your role, and not your other signed-in sessions.
            </p>
          )}
          {needsFactor ? (
            <p className="mt-2">
              This role needs two-step sign-in, and until it is set up the workspace will refuse
              this account.{' '}
              <Link href="/account/security" className={LINK}>
                Set up two-step sign-in
              </Link>
            </p>
          ) : null}
          <p className="mt-2">
            <Link href="/organizer" className={LINK}>
              Open the workspace
            </Link>
          </p>
        </Alert>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 max-w-xl" aria-label="Join with a code">
      {error ? (
        <div ref={errorRef} tabIndex={-1} className="mb-3 focus-visible:outline-none">
          <Alert variant="error" title="That did not work">
            <p>{error}</p>
            {organizerCode ? (
              <p className="mt-2">
                <Link href="/account/organizations/new" className={LINK}>
                  Accept an organiser invitation
                </Link>
              </p>
            ) : null}
            {needsFactorFirst ? (
              <p className="mt-2">
                {CODE_STILL_GOOD}{' '}
                <Link href="/account/security" className={LINK}>
                  Set up two-step sign-in
                </Link>
              </p>
            ) : null}
          </Alert>
        </div>
      ) : null}

      <FormField
        label="Invitation code"
        id="invitation-code"
        required
        description="Type or paste it exactly as you were given it. It is hidden as you type, like a password."
        error={fieldError}
      >
        <Input
          ref={fieldRef}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(changed) => {
            setCode(changed.target.value)
            setFieldError(null)
          }}
        />
      </FormField>

      <div className="mt-4">
        <Button type="submit" className="min-h-11" disabled={busy}>
          {busy ? 'Joining…' : 'Join the organisation'}
        </Button>
      </div>
    </form>
  )
}
