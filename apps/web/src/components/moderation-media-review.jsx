'use client'

/**
 * A moderator's view of an event's pictures, and a hand on each one.
 *
 * Every picture is shown as the moderator's browser fetches it — through this
 * site, with their session, because a picture waiting for review is not public
 * — with its description printed as text beside it, so the words a screen
 * reader would hear are reviewed as well as the pixels.
 *
 * Approving the event approves every picture still waiting, in the same
 * decision, so there is no separate queue to work through. What this adds is
 * the exception: take one picture down, with a reason the organiser reads, or
 * put a taken-down one back. Either needs a recent second factor, which the
 * server asks for and this only reacts to.
 *
 * @module components/moderation-media-review
 */

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { Alert, Badge, Button, FormField, Textarea } from './ui.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { mediaSrc } from '../lib/media.js'
import { refusalSentence } from '../lib/refusal.js'

/** What each review state is called. */
const STATES = Object.freeze({
  PENDING: { label: 'Waiting for review', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Taken down', variant: 'danger' },
})

/** The short name of a stored type. */
const TYPE_LABELS = Object.freeze({
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
})

/**
 * A size in words.
 *
 * @param {number} bytes The size.
 * @returns {string} "1.2 MB" or "340 KB".
 */
function sizeLabel(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * @typedef {object} ModerationMediaReviewProps
 * @property {object[]} [media] The event's pictures, from `GET /v1/events/:id/media`.
 */

/**
 * The pictures, one card each.
 *
 * @param {ModerationMediaReviewProps} props Component props.
 * @returns {JSX.Element} The list.
 */
export function ModerationMediaReview({ media = [] }) {
  const [items, setItems] = useState(media)
  const [announcement, setAnnouncement] = useState('')

  if (items.length === 0) {
    return <p className="text-sm text-ink-muted">This event has no pictures.</p>
  }

  let galleryNumber = 0
  const galleryCount = items.filter((item) => item.kind === 'EVENT_GALLERY').length

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
        {announcement}
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => {
          const label =
            item.kind === 'EVENT_COVER'
              ? 'Cover'
              : `Gallery picture ${(galleryNumber += 1)} of ${galleryCount}`

          return (
            <PictureCard
              key={item.id}
              item={item}
              label={label}
              onDecided={(updated, sentence) => {
                setItems((current) => current.map((row) => (row.id === updated.id ? updated : row)))
                setAnnouncement(sentence)
              }}
            />
          )
        })}
      </ul>
    </div>
  )
}

/**
 * @typedef {object} PictureCardProps
 * @property {object} item The picture.
 * @property {string} label What to call it.
 * @property {Function} onDecided Given the updated picture and a sentence.
 */

/**
 * One picture and the decision that can be taken on it.
 *
 * @param {PictureCardProps} props Component props.
 * @returns {JSX.Element} The list item.
 */
function PictureCard({ item, label, onDecided }) {
  const router = useRouter()
  const headingId = useId()
  const reasonRef = useRef(null)
  const errorRef = useRef(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [error, setError] = useState(null)
  const [stepUp, setStepUp] = useState(null)
  const [busy, setBusy] = useState(false)
  const state = STATES[item.moderationStatus] ?? STATES.PENDING
  const src = mediaSrc(item)

  // A refusal is focused once it is on the page, so a keyboard user lands on it.
  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  /**
   * Send a decision.
   *
   * @param {'approve'|'reject'} decision The decision.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(decision) {
    if (decision === 'reject' && !reason.trim()) {
      setReasonError('Say why it is being taken down; the organiser reads this.')
      reasonRef.current?.focus()
      return
    }

    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(
        `/v1/moderation/media/${encodeURIComponent(item.id)}/decision`,
        {
          method: 'POST',
          body: JSON.stringify(
            decision === 'reject' ? { decision, reason: reason.trim() } : { decision },
          ),
        },
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        setRejecting(false)
        setReason('')
        onDecided(
          body.data,
          decision === 'reject'
            ? `${label} taken down. It is off every public page now.`
            : `${label} approved.`,
        )
        router.refresh()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        // The server decides when; this only reacts to being told.
        setStepUp(decision)
        return
      }

      setError(refusalSentence(response.status, body, 'The decision was not recorded.'))
    } catch {
      setError('The service is not responding. Nothing has been recorded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      aria-labelledby={headingId}
      className="space-y-3 rounded-card border border-line bg-surface-raised p-4 shadow-card"
    >
      <h3 id={headingId} className="font-semibold text-ink">
        {label}
      </h3>
      {src ? (
        // Fetched with the moderator's session: a picture waiting for review
        // is not public, so it never goes through the image optimiser.
        <img
          src={src}
          alt={item.altText}
          width={item.width}
          height={item.height}
          loading="lazy"
          className="h-auto max-h-64 w-full rounded-control bg-surface-subtle object-contain"
        />
      ) : null}
      <p className="text-sm text-ink">
        <span className="font-semibold">Description (alt text): </span>
        {item.altText}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Badge variant={state.variant}>{state.label}</Badge>
        <span>
          {item.width} × {item.height} · {sizeLabel(item.byteSize)} ·{' '}
          {TYPE_LABELS[item.contentType] ?? item.contentType}
        </span>
      </p>
      {item.moderationStatus === 'REJECTED' && item.rejectionReason ? (
        <p className="text-sm text-ink">
          <span className="font-semibold">Reason given: </span>
          {item.rejectionReason}
        </p>
      ) : null}

      {error ? (
        <div ref={errorRef} tabIndex={-1} className="focus-visible:outline-none">
          <Alert variant="error" title="That did not work">
            <p>{error}</p>
          </Alert>
        </div>
      ) : null}

      {stepUp ? (
        <StepUpPrompt
          action={stepUp === 'reject' ? 'take this picture down' : 'approve this picture'}
          onConfirmed={() => {
            const pending = stepUp

            setStepUp(null)
            send(pending)
          }}
          onCancel={() => setStepUp(null)}
        />
      ) : null}

      {!stepUp && rejecting ? (
        <div className="space-y-3">
          <FormField
            label="Why is it being taken down?"
            description="The organiser reads this. It is never shown publicly."
            error={reasonError}
            required
          >
            <Textarea
              ref={reasonRef}
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(changed) => {
                setReason(changed.currentTarget.value)
                setReasonError(null)
              }}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" loading={busy} onClick={() => send('reject')}>
              Take this picture down
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRejecting(false)
                setReasonError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {!stepUp && !rejecting ? (
        <div className="flex flex-wrap gap-2">
          {item.moderationStatus !== 'REJECTED' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setRejecting(true)
                queueMicrotask(() => reasonRef.current?.focus())
              }}
            >
              Reject this picture
            </Button>
          ) : (
            <Button type="button" loading={busy} onClick={() => send('approve')}>
              Approve this picture
            </Button>
          )}
        </div>
      ) : null}
    </li>
  )
}
