'use client'

/**
 * Placing a hold, and lifting one.
 *
 * One component in two modes because the two commands share everything that
 * matters — the step-up handling, the refusal vocabulary, the focus discipline —
 * and duplicating that is how two screens end up disagreeing about what a 409
 * means.
 *
 * ## The warning above `matterReference` is the feature
 *
 * The field is where somebody will be tempted to type why the hold exists, and
 * why a hold exists is personal data about the person it blocks. The API bounds
 * it to 120 characters, which stops an essay but not a sentence, so the screen
 * says plainly what the field is for at the moment of typing. A warning shown
 * after submission is a warning that arrived after the data was written, and
 * this subsystem's whole point is that what gets written here stays clean.
 *
 * ## What the browser does not send
 *
 * No organisation id in the body — it is in the path, which is where the
 * capability guard reads it. No state, no `placedById`, no release timestamp.
 * The server decides who placed a hold and when; a browser that could say would
 * be a browser that could lie about accountability for an irreversible-adjacent
 * decision.
 *
 * @module app/privacy/hold-actions
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { StepUpPrompt } from '../../components/step-up-prompt.jsx'
import { apiFetch } from '../../lib/api-fetch.js'
import { HOLD_KINDS, HOLD_RELEASE_REASONS, describeRefusal } from '../../lib/privacy-vocabulary.js'

/**
 * @typedef {object} HoldActionsProps
 * @property {string} organizationId Whose holds. Path, never body.
 * @property {object} [hold] The hold to release, when releasing.
 * @property {boolean} [releaseOnly] Render only the release control.
 */

/**
 * The hold commands.
 *
 * @param {HoldActionsProps} props Component props.
 * @returns {JSX.Element} The rendered controls.
 */
export function HoldActions({ organizationId, hold, releaseOnly = false }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [subjectId, setSubjectId] = useState('')
  const [kind, setKind] = useState(HOLD_KINDS[0].value)
  const [matterReference, setMatterReference] = useState('')
  const [releaseReasonCode, setReleaseReasonCode] = useState(HOLD_RELEASE_REASONS[0].value)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const [stepUp, setStepUp] = useState(false)
  const [restore, setRestore] = useState(false)
  const panelRef = useRef(null)
  const triggerRef = useRef(null)

  // Restored by effect rather than by holding the node: opening the panel
  // unmounts the trigger, so the element captured on the way in is detached by
  // the time focus should go back to it, and focusing a detached node silently
  // drops focus to the document body.
  useEffect(() => {
    if (open || !restore) return

    triggerRef.current?.focus()
    setRestore(false)
  }, [open, restore])

  /**
   * Open the form.
   *
   * @returns {void}
   */
  function start() {
    setOpen(true)
    setRefusal(null)
    queueMicrotask(() => panelRef.current?.focus())
  }

  /**
   * Close and restore focus.
   *
   * @returns {void}
   */
  function dismiss() {
    setRestore(true)
    setOpen(false)
    setStepUp(false)
  }

  /**
   * Send the command.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    setBusy(true)
    setRefusal(null)

    const base = `/v1/organizations/${encodeURIComponent(organizationId)}/privacy/holds`
    const path = releaseOnly ? `${base}/${encodeURIComponent(hold.id)}/release` : base
    const body = releaseOnly
      ? { releaseReasonCode }
      : { subjectId: subjectId.trim(), kind, matterReference: matterReference.trim() }

    try {
      const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setOpen(false)
        setSubjectId('')
        setMatterReference('')
        setAnnouncement(
          releaseOnly
            ? 'Released. Erasures for this subject are no longer blocked by it.'
            : 'Placed. Erasures for this subject will now be refused.',
        )
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefusal(describeRefusal({ status: response.status, code: parsed?.error?.code ?? null }))
      queueMicrotask(() => panelRef.current?.focus())
    } catch {
      setRefusal({
        title: 'The service is not responding',
        detail: 'Nothing has been recorded.',
        recoverable: true,
      })
      queueMicrotask(() => panelRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  const complete = releaseOnly || (subjectId.trim() !== '' && matterReference.trim().length >= 3)

  return (
    <div className={releaseOnly ? '' : 'mt-6'}>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {!open ? (
        <button
          type="button"
          ref={triggerRef}
          onClick={start}
          className={
            releaseOnly
              ? 'rounded-sm border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-indigo-night-900 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none'
              : 'rounded-sm bg-indigo-night-900 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-night-800 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none'
          }
        >
          {releaseOnly ? 'Release' : 'Place a hold'}
        </button>
      ) : null}

      {open ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`hold-heading-${hold?.id ?? 'new'}`}
          className="mt-3 rounded-card border border-slate-300 bg-white p-4 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
        >
          <h3
            id={`hold-heading-${hold?.id ?? 'new'}`}
            className="font-semibold text-indigo-night-900"
          >
            {releaseOnly ? 'Release this hold' : 'Place a hold'}
          </h3>

          {refusal ? (
            <p
              role="alert"
              className="mt-3 rounded-card border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
            >
              <span className="font-medium">{refusal.title}.</span> {refusal.detail}
            </p>
          ) : null}

          {releaseOnly ? (
            <div className="mt-3 flex flex-col gap-1">
              <label
                htmlFor={`release-reason-${hold.id}`}
                className="text-sm font-medium text-indigo-night-900"
              >
                Why it is being released
              </label>
              <select
                id={`release-reason-${hold.id}`}
                value={releaseReasonCode}
                onChange={(event) => setReleaseReasonCode(event.target.value)}
                className="rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                {HOLD_RELEASE_REASONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-col gap-1">
                <label htmlFor="hold-subject" className="text-sm font-medium text-indigo-night-900">
                  Subject id
                </label>
                <input
                  id="hold-subject"
                  type="text"
                  autoComplete="off"
                  spellCheck="false"
                  value={subjectId}
                  onChange={(event) => setSubjectId(event.target.value)}
                  className="rounded-sm border border-slate-300 px-3 py-2 font-mono text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                />
              </div>

              <div className="mt-3 flex flex-col gap-1">
                <label htmlFor="hold-kind" className="text-sm font-medium text-indigo-night-900">
                  Kind
                </label>
                <select
                  id="hold-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                  className="rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                >
                  {HOLD_KINDS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3 flex flex-col gap-1">
                <label htmlFor="hold-matter" className="text-sm font-medium text-indigo-night-900">
                  Matter reference
                </label>
                <p id="hold-matter-hint" className="text-xs text-slate-600">
                  A reference that points at the matter — a case number, a ticket id. Not a
                  description of it. What the matter is about is personal data about the person this
                  hold blocks, and this is the last place it should be written down.
                </p>
                <input
                  id="hold-matter"
                  type="text"
                  autoComplete="off"
                  maxLength={120}
                  aria-describedby="hold-matter-hint"
                  value={matterReference}
                  onChange={(event) => setMatterReference(event.target.value)}
                  className="rounded-sm border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                />
              </div>
            </>
          )}

          {stepUp ? (
            <div className="mt-4">
              <StepUpPrompt
                action={releaseOnly ? 'release this hold' : 'place this hold'}
                onConfirmed={() => {
                  setStepUp(false)
                  send()
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={send}
                disabled={busy || !complete}
                className="rounded-sm bg-indigo-night-900 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-night-800 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Working…' : releaseOnly ? 'Release' : 'Place'}
              </button>
              <button
                type="button"
                onClick={dismiss}
                disabled={busy}
                className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-indigo-night-900 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Back
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
