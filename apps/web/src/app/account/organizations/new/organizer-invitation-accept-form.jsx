'use client'

/**
 * Typing in an organiser invitation code.
 *
 * `POST /v1/organizer-invitations/accept` with the code and the two things the
 * organiser chooses: the organisation's time zone and, optionally, its web
 * address on this site. Nothing else is sent. The organisation's name, its
 * public description and its website are the ones the Desi-Event team wrote on
 * the invitation, and the platform sets its verification, its currency and its
 * contact address itself; this form has no field for any of them, and the API
 * strips them if they are sent.
 *
 * The code field is a password input with autocomplete off, because a code on
 * a screen is a code in a screenshot and in an autofill store; it is cleared
 * the moment the API accepts it. This page reads no query parameter, so a code
 * put in its address is never read or pre-filled.
 *
 * Every refusal for a code that cannot be used by this account — expired,
 * withdrawn, used, or sent to another address — is the API's one sentence:
 * telling them apart would tell somebody feeding in guesses which guess was a
 * real invitation. A team invitation's code typed here is told where it goes.
 *
 * Accepting makes the account an owner. When that account has no second
 * factor yet, every workspace page would refuse it, so the success panel sends
 * it to set one up first; otherwise to the new organisation's page.
 *
 * @file app/account/organizations/new/organizer-invitation-accept-form.jsx
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../../components/focus-after-render.jsx'
import { Alert, Button, FormField, Input, Select } from '../../../../components/ui.jsx'
import { apiFetch } from '../../../../lib/api-fetch.js'
import { US_TIMEZONE_OPTIONS } from '../../../../lib/organization-vocabulary.js'
import {
  describeApiRefusal,
  fieldIssues,
  parseRetryAfter,
  refusalSentence,
} from '../../../../lib/refusal.js'

/** The shortest code the API will look at. */
const MIN_LENGTH = 16

/** Said when Accept is pressed with nothing typed. */
export const NO_CODE = 'Type or paste the invitation code first.'

/** Said when what was typed is shorter than any code: most often a paste that lost its end. */
export const PART_OF_A_CODE =
  'That is shorter than any invitation code, so part of it is missing. Paste the whole code again.'

/**
 * Said when the organisation's name makes no web address and none was typed.
 *
 * The API's refusal names its `slug` field; this form calls that field the web
 * address, so the sentence does too.
 */
export const NO_ADDRESS_FROM_NAME =
  'We could not make a web address from the organisation’s name, because it has no letters from A to Z or digits. Type one in the web address field.'

/** What every code this account cannot use is told, when the API says nothing better. */
export const UNUSABLE_CODE =
  'That code cannot be used by this account. It may have expired, been withdrawn or used already, or it was sent to a different email address — sign in with the address the invitation was sent to.'

/** What the API says when the web address asked for is another organisation's. */
export const SLUG_TAKEN = 'That web address is taken by another organisation. Choose another.'

/** What a team invitation's code typed here is told. */
export const TEAM_CODE_HERE =
  'That is a team invitation code, not an organiser invitation. Enter it where team codes go instead.'

/** Said after the enrolment refusal: the code was never looked at. */
export const CODE_STILL_GOOD =
  'Your code has not been used, so keep it and enter it again once two-step sign-in is set up.'

/** A link that reads as a link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * The accept form.
 *
 * @returns {JSX.Element} The form, or what accepting made.
 */
export function OrganizerInvitationAcceptForm() {
  const router = useRouter()
  const id = useId()
  const [code, setCode] = useState('')
  const [timezone, setTimezone] = useState(US_TIMEZONE_OPTIONS[0].value)
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [fieldError, setFieldError] = useState(null)
  const [slugError, setSlugError] = useState(null)
  const [accepted, setAccepted] = useState(null)
  const [refusals, setRefusals] = useState(0)
  const refusalRef = useRef(null)
  const acceptedRef = useRef(null)
  const codeRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const trimmed = code.trim()

  // Focus goes to what replaced the form, and to each refusal, once they are
  // on screen: after the commit, not before it. Refusals are counted, so the
  // same sentence twice in a row is announced twice.
  useEffect(() => {
    if (accepted) acceptedRef.current?.focus()
  }, [accepted])

  useEffect(() => {
    if (refusals > 0) refusalRef.current?.focus()
  }, [refusals])

  /**
   * Draw a refusal and take focus to it.
   *
   * @param {object} value What to say.
   * @returns {void}
   */
  function refuse(value) {
    setRefused(value)
    setRefusals((count) => count + 1)
  }

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
      focusAfterRender(codeRef)
      return
    }

    setFieldError(null)
    setSlugError(null)
    setBusy(true)
    setRefused(null)

    // The code, the time zone, and the web address only when one was typed.
    const body = {
      token: trimmed,
      timezone,
      ...(slug.trim() ? { slug: slug.trim() } : {}),
    }

    try {
      const response = await apiFetch('/v1/organizer-invitations/accept', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        // Cleared at once: it is spent, and a spent secret left in a form is a
        // spent secret in a browser's autofill store.
        setCode('')
        setAccepted(parsed?.data ?? {})
        router.refresh()
        return
      }

      const errorCode = parsed?.error?.code ?? null
      const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)
      const issues = fieldIssues(parsed)

      if (response.status === 403 && errorCode === 'MFA_ENROLMENT_REQUIRED') {
        refuse({
          sentence: describeApiRefusal({ status: 403, code: errorCode }).detail,
          enrol: true,
        })
      } else if (response.status === 403 && errorCode === 'WRONG_INVITATION_KIND') {
        refuse({ sentence: TEAM_CODE_HERE, teamCode: true })
      } else if (response.status === 403 && errorCode === 'INVITATION_UNUSABLE') {
        refuse({ sentence: parsed?.error?.message || UNUSABLE_CODE })
      } else if (response.status === 422 && !body.slug) {
        // The one 422 accepting gives: no web address could be made from the
        // invitation's name, and none was typed.
        setSlugError(NO_ADDRESS_FROM_NAME)
        refuse({ sentence: NO_ADDRESS_FROM_NAME })
      } else if (response.status === 400 && issues.slug) {
        setSlugError(issues.slug)
        refuse({ sentence: 'Check the web address and try again. Your code has not been used.' })
      } else if (response.status === 400) {
        // A malformed code is just another code this account cannot use.
        refuse({ sentence: UNUSABLE_CODE })
      } else if (response.status === 409 && parsed?.error?.message === SLUG_TAKEN) {
        setSlugError(SLUG_TAKEN)
        refuse({ sentence: `${SLUG_TAKEN} Your code has not been used.` })
      } else {
        refuse({
          sentence: refusalSentence(
            response.status,
            parsed,
            'The invitation was not accepted.',
            retryAfterSeconds,
          ),
        })
      }
    } catch {
      refuse({ sentence: describeApiRefusal(null).detail })
    } finally {
      setBusy(false)
    }
  }

  if (accepted) {
    const organization = accepted.organization ?? {}
    const needsFactor = Boolean(accepted.session?.mfaRequired && !accepted.session?.mfaEnrolled)
    const organizationPage = `/organizer/organization?organizationId=${encodeURIComponent(organization.id ?? '')}`

    return (
      <div ref={acceptedRef} tabIndex={-1} className="mt-6 max-w-xl focus-visible:outline-none">
        <Alert variant="success" title={`${organization.name ?? 'Your organisation'} is yours`}>
          <p>
            You are its owner, and it is verified. Your other signed-in sessions have ended, so sign
            in again on any other device. Every event you create is reviewed by the Desi-Event team
            before it can be published.
          </p>
          {needsFactor ? (
            <p className="mt-2">
              Owners must use two-step sign-in, and the workspace will not open for this account
              until it is set up.{' '}
              <Link href="/account/security" className={LINK}>
                Set up two-step sign-in
              </Link>
            </p>
          ) : (
            <p className="mt-2">
              <Link href={organizationPage} className={LINK}>
                Open its organisation page
              </Link>
            </p>
          )}
        </Alert>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mt-6 max-w-xl"
      aria-label="Accept an organiser invitation"
    >
      {refused ? (
        <div ref={refusalRef} tabIndex={-1} className="mb-3 focus-visible:outline-none">
          <Alert variant="error" title="Nothing was created">
            <p>{refused.sentence}</p>
            {refused.teamCode ? (
              <p className="mt-2">
                <Link href="/account/invitations" className={LINK}>
                  Join an organisation’s team
                </Link>
              </p>
            ) : null}
            {refused.enrol ? (
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
        id={`${id}-code`}
        required
        description="Type or paste it exactly as the Desi-Event team gave it to you. It is hidden as you type, like a password."
        error={fieldError}
      >
        <Input
          ref={codeRef}
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

      <fieldset className="mt-6 rounded-card border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">About your organisation</legend>
        <p className="text-sm text-ink-muted">
          Its name, public description and website are the ones the Desi-Event team wrote on your
          invitation. You choose these two.
        </p>

        <div className="mt-4">
          <FormField
            label="Time zone"
            id={`${id}-timezone`}
            description="Where its events mostly happen. Its public page shows the dates and times of its events in this zone; each event still sets its own."
          >
            <Select value={timezone} onChange={(changed) => setTimezone(changed.target.value)}>
              {US_TIMEZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="mt-4">
          <FormField
            label="Web address on this site (optional)"
            id={`${id}-slug`}
            error={slugError}
            description="Its public page is desi-event.com/organizers/ followed by this: lower-case words joined by hyphens, as in bay-lights-garba. Left empty, one is made from its name."
          >
            <Input
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={140}
              value={slug}
              onChange={(changed) => {
                setSlug(changed.target.value)
                setSlugError(null)
              }}
            />
          </FormField>
        </div>
      </fieldset>

      <div className="mt-6">
        <Button type="submit" className="min-h-11" disabled={busy}>
          {busy ? 'Accepting…' : 'Accept the invitation'}
        </Button>
      </div>
    </form>
  )
}
