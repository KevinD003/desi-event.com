'use client'

/**
 * Asking a moderator to verify the organisation, or answering their question.
 *
 * `POST /v1/organizations/:id/verification` with an optional legal name and a
 * note. The body names no state: the only place an organiser can move the
 * organisation to is the moderators' queue. Nothing here takes a document, a
 * bank detail or a tax number — none of that is collected on this site.
 *
 * When a moderator has asked for more information, the note is the answer, so
 * it is required.
 *
 * @module app/organizer/organization/verification-request-form
 */

import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { Alert, Button, FormField, Input, Textarea } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import { NOTE_MAX } from '../../../lib/organization-vocabulary.js'

/**
 * @typedef {object} VerificationRequestFormProps
 * @property {string} organizationId Which organisation.
 * @property {string} status Its current verification state.
 */

/**
 * The request form.
 *
 * @param {VerificationRequestFormProps} props Component props.
 * @returns {JSX.Element} The form, or what it did.
 */
export function VerificationRequestForm({ organizationId, status }) {
  const router = useRouter()
  const id = useId()
  const answering = status === 'REQUIRES_INFORMATION'
  const [legalName, setLegalName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [sent, setSent] = useState(false)
  const refusalRef = useRef(null)
  const trimmedNote = note.trim()

  /**
   * Send the request.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function onSubmit(submitted) {
    submitted.preventDefault()
    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(
        `/v1/organizations/${encodeURIComponent(organizationId)}/verification`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
            ...(trimmedNote ? { note: trimmedNote } : {}),
          }),
        },
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        setSent(true)
        router.refresh()
        return
      }

      const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

      setRefused(
        refusalSentence(response.status, body, 'The request was refused.', retryAfterSeconds),
      )
      queueMicrotask(() => refusalRef.current?.focus())
    } catch {
      setRefused(describeApiRefusal(null).detail)
      queueMicrotask(() => refusalRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="mt-4">
        <Alert variant="success" title="Sent to the moderators">
          <p>It is waiting for a moderator. Their decision, and its reason, will appear here.</p>
        </Alert>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mt-4 max-w-xl"
      aria-label={answering ? 'Answer the moderator' : 'Ask for verification'}
    >
      {refused ? (
        <div ref={refusalRef} tabIndex={-1} className="mb-3 focus-visible:outline-none">
          <Alert variant="error" title="Nothing was sent">
            <p>{refused}</p>
          </Alert>
        </div>
      ) : null}

      <p className="text-sm text-ink-muted">
        A moderator checks who is behind the organisation. No documents, bank details or tax numbers
        are collected here.
      </p>

      <div className="mt-3">
        <FormField
          label="Registered legal name (optional)"
          id={`${id}-legal`}
          description="When it differs from the name people see."
        >
          <Input
            type="text"
            autoComplete="organization"
            maxLength={500}
            value={legalName}
            onChange={(changed) => setLegalName(changed.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <FormField
          label={answering ? 'Your answer to the moderator' : 'A note for the moderator (optional)'}
          id={`${id}-note`}
          required={answering}
          description={
            answering
              ? `Required: say what they asked for. Up to ${NOTE_MAX} characters.`
              : `Anything that helps them check, such as how long you have run events. Up to ${NOTE_MAX} characters.`
          }
        >
          <Textarea
            rows={4}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(changed) => setNote(changed.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <Button
          type="submit"
          className="min-h-11"
          disabled={busy || (answering && trimmedNote.length === 0)}
        >
          {busy ? 'Sending…' : answering ? 'Send the answer' : 'Ask for verification'}
        </Button>
      </div>
    </form>
  )
}
