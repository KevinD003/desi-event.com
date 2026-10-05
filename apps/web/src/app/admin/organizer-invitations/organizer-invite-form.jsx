'use client'

/**
 * Inviting an organiser.
 *
 * `POST /v1/platform/organizer-invitations` with the address, the name of the
 * organisation it starts and, optionally, the organisation's public
 * description and website and a note for the recipient. Nothing else is sent:
 * no role (an organiser invitation always makes its recipient the new
 * organisation's owner), no status and no organisation. The API strips
 * anything else, and decides everything that matters again — that the caller
 * may invite, that the address is nobody on the Desi-Event team, and that no
 * invitation to it is already waiting.
 *
 * What goes public under the organisation's Verified badge is what is written
 * here: its name, description and website are the administrator's, not the
 * recipient's. The note is for the recipient alone and never shown publicly.
 *
 * ## The code
 *
 * Issuing needs a recent second factor (the `SECURITY_ROLE` step-up). When the
 * API asks for one, {@link StepUpPrompt} is drawn and the same request is sent
 * again, once, after it is accepted.
 *
 * When codes are not emailed (`MANUAL`), the 201 carries the code, once. It is
 * held in this component's state and drawn in {@link OneTimeCodePanel}, with
 * the ready-to-send message composed here from `@desi-event/schemas/code-letters`
 * — the same words the site's mailer sends in `EMAIL` mode. It is never put in
 * a web address or in browser storage, and the list is refreshed only after
 * the person says they have handed it over. When codes are emailed, the
 * response carries none, and the form says where it went.
 *
 * Imports only the `code-letters` subpath of the schemas package, never its
 * barrel.
 *
 * @module app/admin/organizer-invitations/organizer-invite-form
 */

import { organizerInvitationLetter } from '@desi-event/schemas/code-letters'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { OneTimeCodePanel } from '../../../components/one-time-code-panel.jsx'
import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { Alert, Button, FormField, Input, Textarea } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import {
  describeApiRefusal,
  fieldIssues,
  parseRetryAfter,
  refusalSentence,
} from '../../../lib/refusal.js'
import { JOIN_PATH, JOIN_PLACE } from './organizer-invitation-vocabulary.js'

/** The longest description the API accepts. */
const DESCRIPTION_MAX = 2000

/** The longest note the API accepts. */
const NOTE_MAX = 1000

/** The fields the API names in its issues, and the boxes they belong to. */
const FIELDS = Object.freeze([
  'email',
  'organizationName',
  'organizationDescription',
  'organizationWebsiteUrl',
  'note',
])

/** How the "works until" moment is printed: in UTC, and saying so. */
const UNTIL = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC',
})

/**
 * A moment in words, or null.
 *
 * @param {string|null|undefined} value An ISO timestamp.
 * @returns {string|null} The words.
 */
export function untilWords(value) {
  const time = value ? Date.parse(value) : Number.NaN

  return Number.isFinite(time) ? `${UNTIL.format(new Date(time))} UTC` : null
}

/**
 * The ready-to-send message for a code, or null when it cannot be written.
 *
 * The letter module refuses a join address it cannot print safely (plain
 * http anywhere but this machine, say). Then the panel shows the code and the
 * instructions without a message, rather than a message with a hole in it.
 *
 * @param {object} fields What the letter says.
 * @returns {{subject: string, text: string}|null} The letter.
 */
export function composeLetter(fields) {
  try {
    return organizerInvitationLetter({
      ...fields,
      joinUrl: `${window.location.origin}${JOIN_PATH}`,
    })
  } catch {
    return null
  }
}

/**
 * @typedef {object} OrganizerInviteFormProps
 * @property {'MANUAL'|'EMAIL'|null} deliveryMode How codes go out here, as the API said.
 * @property {string|null} [inviterName] The administrator's display name, for the message.
 */

/**
 * The invite form.
 *
 * @param {OrganizerInviteFormProps} props Component props.
 * @returns {JSX.Element} The form, or the code it issued.
 */
export function OrganizerInviteForm({ deliveryMode, inviterName = null }) {
  const router = useRouter()
  const id = useId()
  const [email, setEmail] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [description, setDescription] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [issues, setIssues] = useState({})
  const [stepUp, setStepUp] = useState(false)
  const [issued, setIssued] = useState(null)
  const [emailed, setEmailed] = useState(null)
  const refusalRef = useRef(null)
  const emailedRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  const trimmedEmail = email.trim()
  const trimmedName = organizationName.trim()
  const ready = trimmedEmail.includes('@') && trimmedName.length >= 2 && trimmedName.length <= 120

  /**
   * The body: the fields the API takes, and only those filled in.
   *
   * @returns {object} The body.
   */
  function body() {
    return {
      email: trimmedEmail,
      organizationName: trimmedName,
      ...(description.trim() ? { organizationDescription: description.trim() } : {}),
      ...(websiteUrl.trim() ? { organizationWebsiteUrl: websiteUrl.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
  }

  /**
   * Send the invitation.
   *
   * @param {boolean} retried Whether this is the one retry after a step-up.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(retried = false) {
    const sent = body()

    setBusy(true)
    setRefused(null)
    setIssues({})
    setEmailed(null)

    try {
      const response = await apiFetch('/v1/platform/organizer-invitations', {
        method: 'POST',
        body: JSON.stringify(sent),
      })
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        const data = parsed?.data ?? {}
        const recipient = data.email ?? sent.email

        setEmail('')
        setOrganizationName('')
        setDescription('')
        setWebsiteUrl('')
        setNote('')

        if (data.delivery?.mode === 'MANUAL' && data.delivery.invitationCode) {
          const code = data.delivery.invitationCode

          // Held here and nowhere else until the person says it is handed over.
          setIssued({
            code,
            recipient,
            expiresAt: data.expiresAt ?? null,
            letter: composeLetter({
              code,
              email: recipient,
              organizationName: data.organizationName ?? sent.organizationName,
              expiresAt: data.expiresAt,
              note: data.note ?? sent.note ?? null,
              inviterName,
            }),
          })
          return
        }

        setEmailed({ recipient, until: untilWords(data.expiresAt) })
        focusAfterRender(emailedRef)
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED' && !retried) {
        setStepUp(true)
        return
      }

      const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)
      const byField = fieldIssues(parsed)

      setIssues(
        Object.fromEntries(
          FIELDS.filter((field) => byField[field]).map((field) => [field, byField[field]]),
        ),
      )
      setRefused({
        sentence: refusalSentence(
          response.status,
          parsed,
          'Nobody was invited.',
          retryAfterSeconds,
        ),
        enrol: parsed?.error?.code === 'MFA_ENROLMENT_REQUIRED',
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
        heading={`Organiser invitation code for ${issued.recipient}`}
        recipient={issued.recipient}
        expiresAt={issued.expiresAt}
        acceptPath={JOIN_PATH}
        acceptPlace={JOIN_PLACE}
        lostAdvice="If it is lost, issue a new code from this list, which stops this one working."
        letter={issued.letter}
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
    <form
      onSubmit={(submitted) => {
        submitted.preventDefault()
        void send()
      }}
      noValidate
      className="mt-4 max-w-2xl"
      aria-label="Invite an organiser"
    >
      {emailed ? (
        <div ref={emailedRef} tabIndex={-1} className="mb-3 focus-visible:outline-none">
          <Alert variant="success" title="Invitation sent">
            <p>
              The invitation was emailed to {emailed.recipient}.
              {emailed.until ? ` It works until ${emailed.until}.` : ''}
            </p>
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
        error={issues.email}
        description="The code works only for an account signed in with this address."
      >
        <Input
          type="email"
          autoComplete="off"
          spellCheck={false}
          value={email}
          onChange={(changed) => setEmail(changed.target.value)}
        />
      </FormField>

      <div className="mt-4">
        <FormField
          label="Organisation name"
          id={`${id}-name`}
          required
          error={issues.organizationName}
          description="The organisation their invitation starts, as people will see it. Between 2 and 120 characters. They cannot change it when they accept."
        >
          <Input
            type="text"
            autoComplete="off"
            maxLength={120}
            value={organizationName}
            onChange={(changed) => setOrganizationName(changed.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <FormField
          label="Public description of the organisation (optional, shown on its organiser page)"
          id={`${id}-description`}
          error={issues.organizationDescription}
          description={`Up to ${DESCRIPTION_MAX} characters. Shown publicly under the Verified badge, so write only what you have checked.`}
        >
          <Textarea
            rows={4}
            maxLength={DESCRIPTION_MAX}
            value={description}
            onChange={(changed) => setDescription(changed.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <FormField
          label="The organisation’s website (optional, shown on its organiser page)"
          id={`${id}-website`}
          error={issues.organizationWebsiteUrl}
          description="A full address starting with https://, to a page you have checked."
        >
          <Input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={websiteUrl}
            onChange={(changed) => setWebsiteUrl(changed.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <FormField
          label="A note for them (optional, sent with the code, never shown publicly)"
          id={`${id}-note`}
          error={issues.note}
          description={`Up to ${NOTE_MAX} characters. Do not put the code or a password in it.`}
        >
          <Textarea
            rows={3}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(changed) => setNote(changed.target.value)}
          />
        </FormField>
      </div>

      {stepUp ? (
        <div className="mt-4">
          <StepUpPrompt
            action="invite this organiser"
            onConfirmed={() => {
              setStepUp(false)
              void send(true)
            }}
            onCancel={() => setStepUp(false)}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <Button type="submit" className="min-h-11" disabled={busy || !ready || stepUp}>
          {busy
            ? 'Inviting…'
            : deliveryMode === 'EMAIL'
              ? 'Send the invitation'
              : 'Create the invitation'}
        </Button>
      </div>
    </form>
  )
}
