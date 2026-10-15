'use client'

/**
 * An event's pictures: one cover and up to eight gallery pictures.
 *
 * ## What the organiser can do, and when
 *
 * On a draft, a new picture is reviewed with the event, and a new cover
 * replaces the old one at once. On a posted event (live, finished or cancelled)
 * a new picture waits for somebody on the team at The Desi Events other than
 * the person who uploaded it, and a new cover waits beside the current one,
 * which stays on the public page until the new one is approved; the panel shows
 * both, the waiting one marked. Nothing new appears on a public page without a
 * review. The panel says which of those applies, and why, rather than leaving
 * buttons greyed out with no explanation. The server enforces every one of
 * these rules again; the buttons here are a courtesy.
 *
 * ## Saying what happened
 *
 * Every result is a sentence in a polite live region: "Uploaded", what was
 * removed from the file before it was stored, what went wrong. A refusal is a
 * visible message too, focused so a keyboard user lands on it. Focus moves to
 * a new picture once it is uploaded, and to the section heading once one is
 * removed, so nobody is left on a button that no longer exists.
 *
 * ## The revision
 *
 * Every write carries the event's revision and hands the new one to the editor
 * shell, which owns it: the details step's autosave and this panel write to the
 * same event, and a panel holding its own copy of the revision would be stale
 * the moment either saved.
 *
 * Imports `@desi-event/schemas/media`, never the schemas barrel.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-media-editor
 */

import { useEffect, useId, useRef, useState } from 'react'

import { EDITABLE_STATUSES } from '@desi-event/schemas/lifecycle'
import {
  MEDIA_ARRANGE_STATUSES,
  MEDIA_LIMITS,
  MEDIA_REMOVE_STATUSES,
  MEDIA_UPLOAD_CONTENT_TYPES,
  MEDIA_UPLOAD_STATUSES,
  altTextSchema,
} from '@desi-event/schemas/media'

import { useFocusAfterRender } from './focus-after-render.jsx'
import { ReadRefusal } from './read-refusal.jsx'
import { STEP_UP_DECLINED_SENTENCE, useStepUpRetry } from './step-up-retry.jsx'
import { Alert, Badge, Button, FormField, Input, Textarea } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { mediaSrc, precheckImageFile, uploadPath } from '../lib/media.js'
import { refusalSentence } from '../lib/refusal.js'

/** The sentence a stale revision gets: reload, because somebody else saved. */
const STALE_SENTENCE =
  'Somebody else saved a change to this event while you were working on its pictures. Reload the page to see their version, then try again.'

/** The picture formats a file input offers. */
const ACCEPT = 'image/jpeg,image/png,image/webp'

/**
 * Sort the list the way the API does: the cover, then the gallery by position.
 *
 * @param {object[]} items Pictures.
 * @returns {object[]} The same pictures, in order.
 */
function ordered(items) {
  return [...items].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'EVENT_COVER' ? -1 : 1
    // The current cover before the replacement waiting beside it.
    if (left.kind === 'EVENT_COVER') {
      return Number(Boolean(left.replacesMediaId)) - Number(Boolean(right.replacesMediaId))
    }

    return (left.position ?? 0) - (right.position ?? 0)
  })
}

/**
 * How a picture's review state reads.
 *
 * A picture waiting on a draft waits for the event's review. On a posted event
 * nothing is reviewed again (SPEC2-XI X-2): a new picture there waits for
 * approval of that picture alone by the team at The Desi Events, a replacement
 * cover or a gallery picture alike, and says so in the same words.
 *
 * @param {object} item A picture.
 * @param {boolean} [posted] Whether the event is posted.
 * @returns {{label: string, variant: string}} The badge.
 */
export function reviewBadge(item, posted = false) {
  if (item.moderationStatus === 'REJECTED') {
    return item.replacesMediaId
      ? { label: 'Not approved', variant: 'danger' }
      : { label: 'Removed by a moderator', variant: 'danger' }
  }

  if (item.moderationStatus === 'APPROVED') {
    return item.publiclyVisible
      ? { label: 'On the public page', variant: 'success' }
      : { label: 'Approved; shown once the event is public', variant: 'info' }
  }

  return item.replacesMediaId || posted
    ? { label: 'Waiting for approval', variant: 'warning' }
    : { label: 'Waiting for review', variant: 'warning' }
}

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

/** The short name of a stored type. */
const TYPE_LABELS = Object.freeze({
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
})

/**
 * Read a response's body, or nothing.
 *
 * @param {Response} response The response.
 * @returns {Promise<object|null>} The parsed body.
 */
async function bodyOf(response) {
  return response.json().catch(() => null)
}

/**
 * @typedef {object} EventMediaEditorProps
 * @property {object} event The event, with its `id`.
 * @property {string} status The event's current status, as the editor shell knows it.
 * @property {object[]} [media] The pictures: as loaded, from `GET /v1/events/:id/media`, or as the editor shell holds them now.
 * @property {number} revision The event's current revision, owned by the editor shell.
 * @property {Function} onRevision Called with the new revision after every write.
 * @property {Function} [onMediaChange] The editor shell's setter for the list, given the new list or a function from the current one to it. With it, the shell owns the list, so it survives this step being closed and opened again; without it, the panel keeps its own copy.
 * @property {{status: number, code: string|null, retryAfterSeconds: number|null}|null} [failure] Why the pictures could not be read, from `mediaReadFailure`. The step then shows the refusal and offers no change at all.
 * @property {boolean} [platform] Whether the edits are made in the editing session of the team at The Desi Events, whose writes ask for a fresh second factor every 10 minutes.
 * @property {Function} [onSittingEnded] Called when a write finds that editing session closed.
 */

/**
 * The Media step.
 *
 * @param {EventMediaEditorProps} props Component props.
 * @returns {JSX.Element} The step.
 */
export function EventMediaEditor({ failure = null, ...props }) {
  // Not an empty list. A list that could not be read is unknown, and an
  // upload offered over it could replace a cover this page cannot see.
  if (failure) return <MediaUnavailable failure={failure} />

  return <MediaPanel {...props} />
}

/**
 * The Media step when the pictures could not be read.
 *
 * @param {{failure: object}} props Component props.
 * @returns {JSX.Element} The step.
 */
function MediaUnavailable({ failure }) {
  return (
    <section aria-labelledby="media-heading" className="space-y-3" data-slot="event-media-editor">
      <h2 id="media-heading" className="text-xl font-semibold text-ink">
        Media
      </h2>
      <p className="max-w-prose text-ink-muted">
        Until this event&rsquo;s pictures load, this step shows none of them and offers no change:
        an upload now could replace a cover this page cannot show. Reload the page to try again.
      </p>
      <ReadRefusal
        error={failure}
        what="This event’s pictures"
        action="see this event’s pictures"
      />
    </section>
  )
}

/**
 * The Media step's panel: the cover, the gallery and their forms.
 *
 * @param {Omit<EventMediaEditorProps, 'failure'>} props Component props.
 * @returns {JSX.Element} The panel.
 */
function MediaPanel({
  event,
  status,
  media = [],
  revision = 0,
  onRevision = () => {},
  onMediaChange,
  platform = false,
  onSittingEnded,
}) {
  // Owned by the editor shell when it passes a setter: this step unmounts
  // whenever another is chosen, and a copy kept here would come back as the
  // list the page first loaded, with a removed cover returned and new uploads
  // gone.
  const controlled = typeof onMediaChange === 'function'
  const [ownItems, setOwnItems] = useState(() => ordered(media))
  const items = controlled ? ordered(media) : ownItems
  const setItems = controlled ? onMediaChange : setOwnItems
  const [announcement, setAnnouncement] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // Where focus should go once the next render has put it on the page. Set by
  // a write's outcome and acted on in an effect, because the element it names
  // — a new picture, a refusal — does not exist until React has rendered it.
  const [focusRequest, setFocusRequest] = useState(null)
  const errorRef = useRef(null)
  const coverHeadingRef = useRef(null)
  const galleryHeadingRef = useRef(null)
  const itemRefs = useRef(new Map())
  // A write the server refused for want of a fresh second factor: asked for
  // here, then sent again (SPEC2-XI X-A).
  const stepUp = useStepUpRetry({
    action: 'save this change to the pictures',
    platform,
    onSittingEnded,
    onDeclined: () => refuse(STEP_UP_DECLINED_SENTENCE),
  })

  useEffect(() => {
    if (!focusRequest) return

    const targets = {
      error: () => errorRef.current,
      cover: () => coverHeadingRef.current,
      gallery: () => galleryHeadingRef.current,
      item: () => itemRefs.current.get(focusRequest.id),
      move: () => document.querySelector(focusRequest.selector),
    }

    targets[focusRequest.kind]?.()?.focus()
  }, [focusRequest])

  const canUpload = MEDIA_UPLOAD_STATUSES.has(status)
  const canArrange = MEDIA_ARRANGE_STATUSES.has(status)
  const canRemove = MEDIA_REMOVE_STATUSES.has(status)
  // Posted (live, finished or cancelled): a new picture is not reviewed with
  // the event but on its own, by the team at The Desi Events (SPEC2-XI X-3).
  const posted = canUpload && !EDITABLE_STATUSES.has(status)

  // The cover on the page, and a new one waiting beside it on a posted event:
  // the API keeps the current cover public until the new one is approved.
  const covers = items.filter((item) => item.kind === 'EVENT_COVER')
  const cover = covers.find((item) => !item.replacesMediaId) ?? covers[0] ?? null
  const replacement = covers.find((item) => item.replacesMediaId && item.id !== cover?.id) ?? null
  const gallery = items.filter((item) => item.kind === 'EVENT_GALLERY')
  const galleryFull = gallery.length >= MEDIA_LIMITS.galleryMax

  /**
   * Show a refusal, focused.
   *
   * @param {string} sentence What went wrong.
   * @returns {void}
   */
  function refuse(sentence) {
    setError(sentence)
    setAnnouncement('')
    setFocusRequest({ kind: 'error', at: Date.now() })
  }

  /**
   * Turn a refused response into the sentence to show.
   *
   * @param {Response} response The response.
   * @param {object|null} body Its parsed body.
   * @param {string} fallback What to say when the API said nothing usable.
   * @returns {string} The sentence.
   */
  function refusalOf(response, body, fallback) {
    if (body?.error?.code === 'STALE_REVISION') return STALE_SENTENCE

    return refusalSentence(response.status, body, fallback)
  }

  /**
   * Send one write that answers with the whole list, and fold the answer in.
   *
   * @param {string} path The path under the event.
   * @param {object} init Fetch options.
   * @param {string} fallback What to say when it is refused without a reason.
   * @returns {Promise<object|null>} The answer, or null when it was refused.
   */
  async function writeList(path, init, fallback) {
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}${path}`, init)
      const body = await bodyOf(response)

      if (!response.ok) {
        // Asked for a second factor: ask, and send the same write again.
        const retried = stepUp.refused(body, () => writeList(path, init, fallback))

        if (retried) return retried

        refuse(refusalOf(response, body, fallback))
        return null
      }

      if (Number.isInteger(body?.meta?.revision)) onRevision(body.meta.revision)

      return body
    } catch {
      refuse('The service is not responding. Nothing has been changed.')
      return null
    } finally {
      setBusy(false)
    }
  }

  /**
   * Fold in a picture that was just uploaded.
   *
   * @param {object} body The upload's answer.
   * @returns {void}
   */
  function uploaded(body) {
    const picture = body.data

    if (Number.isInteger(body.meta?.revision)) onRevision(body.meta.revision)

    setError(null)
    setItems((current) =>
      ordered([
        ...current.filter((item) => {
          if (picture.kind !== 'EVENT_COVER' || item.kind !== 'EVENT_COVER') return true
          // On a draft a new cover replaces the old one in the same write. On a
          // posted event it waits beside the current cover, which stays; a
          // replacement waiting from before is discarded by the same write.
          return posted && !item.replacesMediaId
        }),
        picture,
      ]),
    )

    const removed = body.meta?.removed ?? []

    setAnnouncement(
      [
        picture.kind === 'EVENT_COVER' ? 'Cover uploaded.' : 'Picture added to the gallery.',
        posted
          ? 'It appears on the public page once the team at The Desi Events approves it.'
          : 'It appears on the public page once a moderator approves the event.',
        posted && picture.replacesMediaId ? 'The current cover stays until then.' : null,
        removed.length > 0 ? `Removed before saving: ${removed.join(', ')}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
    )

    setFocusRequest({ kind: 'item', id: picture.id })
  }

  /**
   * Describe a picture again.
   *
   * @param {object} item The picture.
   * @param {string} altText The new description, already checked.
   * @returns {Promise<boolean>} Whether it was saved.
   */
  async function describe(item, altText) {
    const body = await writeList(
      `/media/${encodeURIComponent(item.id)}`,
      { method: 'PATCH', body: JSON.stringify({ revision, altText }) },
      'The description was not saved.',
    )

    if (!body) return false

    setItems((current) => current.map((row) => (row.id === item.id ? body.data : row)))
    setAnnouncement('Description saved.')

    return true
  }

  /**
   * Move a gallery picture one place.
   *
   * @param {object} item The picture.
   * @param {-1|1} step Earlier or later.
   * @returns {Promise<void>} Resolves when done.
   */
  async function move(item, step) {
    const ids = gallery.map((row) => row.id)
    const from = ids.indexOf(item.id)
    const to = from + step

    if (from < 0 || to < 0 || to >= ids.length) return

    ;[ids[from], ids[to]] = [ids[to], ids[from]]

    const body = await writeList(
      '/media/order',
      { method: 'PUT', body: JSON.stringify({ revision, galleryIds: ids }) },
      'The gallery order was not saved.',
    )

    if (!body) return

    setItems(ordered(body.data ?? []))
    setAnnouncement(`Moved to position ${to + 1} of ${ids.length}.`)

    // The button moved with its picture; keep focus on it, or on its partner
    // when it has become the end of the row and is disabled.
    const direction = step < 0 ? 'earlier' : 'later'
    const other = step < 0 ? 'later' : 'earlier'
    const edge = step < 0 ? to === 0 : to === ids.length - 1

    setFocusRequest({
      kind: 'move',
      selector: `[data-move="${edge ? other : direction}-${item.id}"]`,
    })
  }

  /**
   * Remove a picture and its bytes.
   *
   * @param {object} item The picture.
   * @returns {Promise<void>} Resolves when done.
   */
  async function remove(item) {
    const body = await writeList(
      `/media/${encodeURIComponent(item.id)}?revision=${encodeURIComponent(String(revision))}`,
      { method: 'DELETE' },
      'The picture was not removed.',
    )

    if (!body) return

    setItems(ordered(body.data ?? []))
    setAnnouncement(
      item.kind === 'EVENT_COVER' && item.replacesMediaId
        ? 'The waiting cover was removed. The current cover stays.'
        : item.kind === 'EVENT_COVER'
          ? 'Cover removed. The listing and the event page show the generated poster.'
          : 'Picture removed from the gallery.',
    )

    setFocusRequest({ kind: item.kind === 'EVENT_COVER' ? 'cover' : 'gallery', at: Date.now() })
  }

  /** Why some controls are absent, in one sentence. */
  const whatApplies = posted
    ? 'This event is posted, so each new picture waits for the team at The Desi Events: it appears on the public page once the team at The Desi Events approves it. A new cover waits beside the current one, which stays on the page until then.'
    : canUpload
      ? 'New pictures are reviewed with the event: each appears on the public page once a moderator approves it.'
      : canRemove
        ? 'Pictures on this event can be removed, which also frees your organisation’s storage, but not changed.'
        : status === 'APPROVED'
          ? 'This event is approved and waiting for you to publish it. Its pictures can be described again, reordered or removed once it is published.'
          : 'A moderator is looking at this version of the event, so its pictures cannot change until they decide or you withdraw it from review.'

  return (
    <section aria-labelledby="media-heading" className="space-y-8" data-slot="event-media-editor">
      <div className="space-y-3">
        <h2 id="media-heading" className="text-xl font-semibold text-ink">
          Media
        </h2>
        <p className="max-w-prose text-ink-muted">
          A cover across the top of the event page and on its listing card, and up to{' '}
          {MEDIA_LIMITS.galleryMax} pictures in a gallery below the description. Without a cover,
          the event shows its generated poster.
        </p>
        <p className="max-w-prose text-sm text-ink-muted">{whatApplies}</p>
        <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
          {announcement}
        </p>
        {stepUp.prompt}
        {error ? (
          <div ref={errorRef} tabIndex={-1} className="focus-visible:outline-none">
            <Alert variant="error" title="That did not work">
              <p>{error}</p>
            </Alert>
          </div>
        ) : null}
      </div>

      <section aria-labelledby="media-cover-heading" className="space-y-4">
        <h3
          id="media-cover-heading"
          ref={coverHeadingRef}
          tabIndex={-1}
          className="text-lg font-semibold text-ink focus-visible:outline-none"
        >
          Cover
        </h3>
        {cover ? (
          <ul className={`grid gap-4 ${replacement ? 'sm:grid-cols-2' : ''}`}>
            <MediaItem
              item={cover}
              label={
                cover.replacesMediaId
                  ? 'The new cover, waiting for approval'
                  : replacement
                    ? 'The current cover'
                    : 'The cover'
              }
              canArrange={canArrange}
              canRemove={canRemove}
              busy={busy}
              onDescribe={describe}
              onRemove={remove}
              registerRef={(node) => itemRefs.current.set(cover.id, node)}
              posted={posted}
            />
            {replacement ? (
              <MediaItem
                item={replacement}
                label={
                  replacement.moderationStatus === 'REJECTED'
                    ? 'The new cover, not approved'
                    : 'The new cover, waiting for approval'
                }
                canArrange={canArrange}
                canRemove={canRemove}
                busy={busy}
                onDescribe={describe}
                onRemove={remove}
                registerRef={(node) => itemRefs.current.set(replacement.id, node)}
                posted={posted}
              />
            ) : null}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            There is no cover. The listing and the event page show the generated poster.
          </p>
        )}
        {canUpload ? (
          <UploadForm
            eventId={event.id}
            kind="EVENT_COVER"
            title={cover ? 'Replace the cover' : 'Upload a cover'}
            hint={`JPEG, PNG or WebP, at most 10 MB, at least ${MEDIA_LIMITS.coverMinWidth} × ${MEDIA_LIMITS.coverMinHeight} pixels. A shared link shows a PNG or JPEG cover; a WebP cover, or a photo stored turned on its side, shows the generated poster there instead.`}
            revision={revision}
            busy={busy}
            setBusy={setBusy}
            onUploaded={uploaded}
            onRefused={(response, body, retry) => {
              if (!stepUp.refused(body, retry)) {
                refuse(refusalOf(response, body, 'The picture was not uploaded.'))
              }
            }}
            onUnreachable={() =>
              refuse('The service is not responding. Nothing has been uploaded.')
            }
          />
        ) : null}
      </section>

      <section aria-labelledby="media-gallery-heading" className="space-y-4">
        <h3
          id="media-gallery-heading"
          ref={galleryHeadingRef}
          tabIndex={-1}
          className="text-lg font-semibold text-ink focus-visible:outline-none"
        >
          Gallery
        </h3>
        <p className="text-sm text-ink-muted">
          {gallery.length} of {MEDIA_LIMITS.galleryMax} pictures, shown on the event page in this
          order.
        </p>
        {gallery.length > 0 ? (
          <ol className="grid gap-4 sm:grid-cols-2">
            {gallery.map((item, index) => (
              <MediaItem
                key={item.id}
                item={item}
                label={`Picture ${index + 1} of ${gallery.length}`}
                index={index}
                count={gallery.length}
                canArrange={canArrange}
                canRemove={canRemove}
                busy={busy}
                onDescribe={describe}
                onMove={move}
                onRemove={remove}
                registerRef={(node) => itemRefs.current.set(item.id, node)}
                posted={posted}
              />
            ))}
          </ol>
        ) : null}
        {canUpload && !galleryFull ? (
          <UploadForm
            eventId={event.id}
            kind="EVENT_GALLERY"
            title="Add a gallery picture"
            hint={`JPEG, PNG or WebP, at most 10 MB, at least ${MEDIA_LIMITS.galleryMinSide} pixels on its shorter side.`}
            revision={revision}
            busy={busy}
            setBusy={setBusy}
            onUploaded={uploaded}
            onRefused={(response, body, retry) => {
              if (!stepUp.refused(body, retry)) {
                refuse(refusalOf(response, body, 'The picture was not uploaded.'))
              }
            }}
            onUnreachable={() =>
              refuse('The service is not responding. Nothing has been uploaded.')
            }
          />
        ) : null}
        {canUpload && galleryFull ? (
          <p className="text-sm text-ink-muted">
            The gallery holds {MEDIA_LIMITS.galleryMax} pictures. Remove one to add another.
          </p>
        ) : null}
      </section>
    </section>
  )
}

/**
 * @typedef {object} UploadFormProps
 * @property {string} eventId The event.
 * @property {'EVENT_COVER'|'EVENT_GALLERY'} kind What the picture is for.
 * @property {string} title The form's heading.
 * @property {string} hint What the file must be.
 * @property {number} revision The revision to send.
 * @property {boolean} busy Whether another write is in flight.
 * @property {Function} setBusy Mark a write in flight.
 * @property {Function} onUploaded Given the answer to a successful upload.
 * @property {Function} onRefused Given the response and body of a refused one, and a function that sends the same upload again.
 * @property {Function} onUnreachable Called when no response arrived.
 */

/**
 * Choose a file, describe it, upload it.
 *
 * @param {UploadFormProps} props Component props.
 * @returns {JSX.Element} The form.
 */
function UploadForm({
  eventId,
  kind,
  title,
  hint,
  revision,
  busy,
  setBusy,
  onUploaded,
  onRefused,
  onUnreachable,
}) {
  const headingId = useId()
  const fileRef = useRef(null)
  const altRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [altText, setAltText] = useState('')
  const [fileError, setFileError] = useState(null)
  const [altError, setAltError] = useState(null)
  const [uploading, setUploading] = useState(false)

  // A local preview of the chosen file, never uploaded as such and released as
  // soon as it is replaced or the form goes away.
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') {
      setPreview(null)
      return undefined
    }

    const url = URL.createObjectURL(file)

    setPreview(url)

    return () => URL.revokeObjectURL?.(url)
  }, [file])

  /**
   * Check, then send.
   *
   * @param {Event} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function submit(submitted) {
    submitted.preventDefault()

    const described = altTextSchema.safeParse(altText)
    const altProblem = described.success
      ? null
      : (described.error.issues[0]?.message ?? 'Describe the picture.')
    const fileProblem = await precheckImageFile(file)

    setAltError(altProblem)
    setFileError(fileProblem)

    if (fileProblem) {
      fileRef.current?.focus()
      return
    }

    if (altProblem) {
      altRef.current?.focus()
      return
    }

    await send(file, described.data)
  }

  /**
   * Upload the checked file.
   *
   * Its own function so a refusal for want of a fresh second factor can send
   * the same file and description again once it is confirmed.
   *
   * @param {File} chosen The file.
   * @param {string} description Its description, already checked.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(chosen, description) {
    setUploading(true)
    setBusy(true)

    try {
      const declared = MEDIA_UPLOAD_CONTENT_TYPES.includes(chosen.type)
        ? chosen.type
        : 'application/octet-stream'
      const response = await apiFetch(
        uploadPath(eventId, { kind, altText: description, revision }),
        {
          method: 'POST',
          headers: { 'content-type': declared },
          body: chosen,
        },
      )
      const body = await bodyOf(response)

      if (!response.ok) {
        onRefused(response, body, () => send(chosen, description))
        return
      }

      setFile(null)
      setAltText('')
      if (fileRef.current) fileRef.current.value = ''
      onUploaded(body)
    } catch {
      onUnreachable()
    } finally {
      setUploading(false)
      setBusy(false)
    }
  }

  return (
    <form
      aria-labelledby={headingId}
      onSubmit={submit}
      noValidate
      className="space-y-4 rounded-card border border-line bg-surface-raised p-4"
    >
      <h4 id={headingId} className="font-semibold text-ink">
        {title}
      </h4>
      <FormField label="Picture file" description={hint} error={fileError} required>
        <Input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          onChange={(changed) => {
            setFile(changed.currentTarget.files?.[0] ?? null)
            setFileError(null)
          }}
        />
      </FormField>
      {preview ? (
        <figure className="space-y-1">
          {/* A preview of the local file, before anything is sent. Its
              description is the text box below, so the preview says nothing. */}
          <img src={preview} alt="" className="max-h-48 rounded-control object-contain" />
          <figcaption className="text-xs text-ink-muted">Preview of the chosen file</figcaption>
        </figure>
      ) : null}
      <FormField
        label="Describe the picture"
        description={`What it shows, for somebody who cannot see it. ${altText.length} of ${MEDIA_LIMITS.altTextMax} characters.`}
        error={altError}
        required
      >
        <Textarea
          ref={altRef}
          rows={3}
          maxLength={MEDIA_LIMITS.altTextMax}
          value={altText}
          onChange={(changed) => {
            setAltText(changed.currentTarget.value)
            setAltError(null)
          }}
        />
      </FormField>
      <Button type="submit" loading={uploading} disabled={busy && !uploading}>
        {uploading ? 'Uploading…' : 'Upload'}
      </Button>
    </form>
  )
}

/**
 * @typedef {object} MediaItemProps
 * @property {object} item The picture.
 * @property {string} label What to call it: "The cover", "Picture 2 of 3".
 * @property {number} [index] Its place in the gallery.
 * @property {number} [count] How many gallery pictures there are.
 * @property {boolean} canArrange Whether it may be described again or moved.
 * @property {boolean} canRemove Whether it may be removed.
 * @property {boolean} busy Whether another write is in flight.
 * @property {Function} onDescribe Given the picture and a new description.
 * @property {Function} [onMove] Given the picture and -1 or 1.
 * @property {Function} onRemove Given the picture.
 * @property {Function} registerRef Given the item's focus target.
 * @property {boolean} [posted] Whether the event is posted, so a waiting picture waits for approval by the team at The Desi Events rather than for a review.
 */

/**
 * One stored picture, with what can be done to it.
 *
 * @param {MediaItemProps} props Component props.
 * @returns {JSX.Element} The list item.
 */
function MediaItem({
  item,
  label,
  index,
  count,
  canArrange,
  canRemove,
  busy,
  onDescribe,
  onMove,
  onRemove,
  registerRef,
  posted = false,
}) {
  const headingId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.altText)
  const [draftError, setDraftError] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const draftRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const badge = reviewBadge(item, posted)
  const src = mediaSrc(item)
  const gallery = item.kind === 'EVENT_GALLERY'

  /**
   * Save the new description.
   *
   * @param {Event} submitted The submit event.
   * @returns {Promise<void>} Resolves when done.
   */
  async function saveDescription(submitted) {
    submitted.preventDefault()

    const parsed = altTextSchema.safeParse(draft)

    if (!parsed.success) {
      setDraftError(parsed.error.issues[0]?.message ?? 'Describe the picture.')
      draftRef.current?.focus()
      return
    }

    if (await onDescribe(item, parsed.data)) setEditing(false)
  }

  return (
    <li
      aria-labelledby={headingId}
      className="space-y-3 rounded-card border border-line bg-surface-raised p-4"
    >
      <h4
        id={headingId}
        ref={registerRef}
        tabIndex={-1}
        className="font-semibold text-ink focus-visible:outline-none"
      >
        {label}
      </h4>
      {src ? (
        // The organiser's own picture, fetched through this site with their
        // session: it is not public until a moderator approves it, so it does
        // not go through the image optimiser.
        <img
          src={src}
          alt={item.altText}
          width={item.width}
          height={item.height}
          loading="lazy"
          className="h-auto max-h-56 w-full rounded-control bg-surface-subtle object-contain"
        />
      ) : null}
      <p className="text-sm text-ink">
        <span className="font-semibold">Description: </span>
        {item.altText}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <span>
          {item.width} × {item.height} · {sizeLabel(item.byteSize)} ·{' '}
          {TYPE_LABELS[item.contentType] ?? item.contentType}
        </span>
      </p>
      {item.moderationStatus === 'REJECTED' && item.rejectionReason ? (
        <p className="text-sm text-ink">
          <span className="font-semibold">Moderator’s note: </span>
          {item.rejectionReason}
        </p>
      ) : null}

      {editing ? (
        <form onSubmit={saveDescription} noValidate className="space-y-3">
          <FormField
            label="New description"
            description={`${draft.length} of ${MEDIA_LIMITS.altTextMax} characters.`}
            error={draftError}
            required
          >
            <Textarea
              ref={draftRef}
              rows={3}
              maxLength={MEDIA_LIMITS.altTextMax}
              value={draft}
              onChange={(changed) => {
                setDraft(changed.currentTarget.value)
                setDraftError(null)
              }}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              Save description
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(false)
                setDraft(item.altText)
                setDraftError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {confirming ? (
        <div className="space-y-2 rounded-control border border-status-danger/25 bg-status-danger-soft p-3">
          <p className="text-sm text-ink">
            Remove this picture? It is deleted, not hidden, and cannot be brought back.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setConfirming(false)
                await onRemove(item)
              }}
            >
              Remove picture
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}

      {!editing && !confirming ? (
        <div className="flex flex-wrap gap-2">
          {canArrange ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(item.altText)
                setEditing(true)
                focusAfterRender(draftRef)
              }}
            >
              Edit description
            </Button>
          ) : null}
          {gallery && canArrange && count > 1 ? (
            <>
              <Button
                type="button"
                variant="secondary"
                data-move={`earlier-${item.id}`}
                disabled={busy || index === 0}
                onClick={() => onMove(item, -1)}
              >
                Move earlier<span className="sr-only">: {label.toLowerCase()}</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                data-move={`later-${item.id}`}
                disabled={busy || index === count - 1}
                onClick={() => onMove(item, 1)}
              >
                Move later<span className="sr-only">: {label.toLowerCase()}</span>
              </Button>
            </>
          ) : null}
          {canRemove ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Remove<span className="sr-only">: {label.toLowerCase()}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
