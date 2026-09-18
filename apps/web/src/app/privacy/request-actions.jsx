'use client'

/**
 * What somebody may do to one privacy request.
 *
 * Two commands: confirm it, or withdraw it. Both are consequential and one of
 * them is irreversible, so the shape of this component matters more than most.
 *
 * ## The confirmation phrase is typed, not held
 *
 * The server mints a phrase when the request is raised and stores only its
 * SHA-256 digest. It is returned **once**, in the create response, and never
 * again — `privacyRequestSchema` has no confirmation field, so this screen
 * cannot show it back and does not try. The operator types back what they were
 * given.
 *
 * That is the whole point. A confirmation the browser could read off the page
 * and resubmit would be a confirmation that an accidental replay could perform,
 * and the thing being performed is erasing a person. So there is no `confirmed`
 * boolean here, no `force`, no `skipHolds`, and no idempotency key: the request
 * body is the phrase and nothing else, exactly as `privacyRequestConfirmSchema`
 * allows. Anything more would be inventing authority the browser is not meant
 * to have.
 *
 * ## Why a mistyped phrase is not treated as an error to smooth over
 *
 * A 422 means the phrase did not match, and nothing was changed. The screen
 * says so plainly rather than clearing the field and letting somebody try
 * again blind — on an irreversible action, "that was not the phrase" is
 * information, not friction.
 *
 * ## Step-up
 *
 * The server decides when. Both commands name `PRIVACY_ERASURE`, whose window
 * is deliberately short and server-held, so a refusal arrives as
 * `STEP_UP_REQUIRED` and this component shows the prompt and retries. It never
 * decides for itself that a step-up is needed, because it cannot see the rule.
 *
 * @module app/privacy/request-actions
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { StepUpPrompt } from '../../components/step-up-prompt.jsx'
import { apiFetch } from '../../lib/api-fetch.js'
import { REQUEST_CANCEL_REASONS, describeRefusal } from '../../lib/privacy-vocabulary.js'

/**
 * @typedef {object} RequestActionsProps
 * @property {string} organizationId Whose request. Goes in the path, never the body.
 * @property {object} request The request as the API returned it.
 * @property {boolean} canConfirm Whether confirmation is the next step.
 * @property {boolean} canCancel Whether withdrawal is still possible.
 */

/**
 * The commands.
 *
 * @param {RequestActionsProps} props Component props.
 * @returns {JSX.Element} The rendered actions.
 */
export function RequestActions({ organizationId, request, canConfirm, canCancel }) {
  const router = useRouter()
  const [pending, setPending] = useState(null)
  const [phrase, setPhrase] = useState('')
  const [reasonCode, setReasonCode] = useState(REQUEST_CANCEL_REASONS[0].value)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const [stepUp, setStepUp] = useState(false)
  const [restoreTo, setRestoreTo] = useState(null)
  const panelRef = useRef(null)
  const confirmRef = useRef(null)
  const cancelRef = useRef(null)

  // Focus is restored by effect rather than by holding the node, because
  // opening a panel unmounts the trigger buttons — the element captured on the
  // way in is detached by the time anybody wants it back, and focusing a
  // detached node silently does nothing. Losing focus to the document body is
  // how a keyboard user gets stranded at the top of the page after backing out
  // of an irreversible action.
  useEffect(() => {
    if (pending !== null || restoreTo === null) return

    const target = restoreTo === 'confirm' ? confirmRef.current : cancelRef.current

    target?.focus()
    setRestoreTo(null)
  }, [pending, restoreTo])

  /**
   * Open one of the forms.
   *
   * @param {string} key Which command.
   * @returns {void}
   */
  function open(key) {
    setPending(key)
    setRefusal(null)
    setPhrase('')
    queueMicrotask(() => panelRef.current?.focus())
  }

  /**
   * Close the form and put focus back on the control that opened it.
   *
   * @returns {void}
   */
  function dismiss() {
    setRestoreTo(pending)
    setPending(null)
    setStepUp(false)
    setPhrase('')
  }

  /**
   * Send whichever command is open.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    if (!pending) return

    setBusy(true)
    setRefusal(null)

    const path =
      pending === 'confirm'
        ? `/v1/organizations/${encodeURIComponent(organizationId)}/privacy/requests/${encodeURIComponent(request.id)}/confirm`
        : `/v1/organizations/${encodeURIComponent(organizationId)}/privacy/requests/${encodeURIComponent(request.id)}/cancel`

    // The entire body. No organisation id — that is in the path, where the
    // capability guard reads it. No state, no policy version, no idempotency
    // key, no confirmation digest.
    const body = pending === 'confirm' ? { confirmationPhrase: phrase } : { reasonCode }

    try {
      const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setPending(null)
        setPhrase('')
        setAnnouncement(
          pending === 'confirm'
            ? 'Confirmed. The request is now queued to run.'
            : 'Withdrawn. Nothing was changed.',
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
        detail: 'Nothing has been recorded. The request is exactly as it was.',
        recoverable: true,
      })
      queueMicrotask(() => panelRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  if (!canConfirm && !canCancel) {
    return (
      <p className="mt-6 rounded-card border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        There is nothing to do here. This request has reached a state nothing moves it out of.
      </p>
    )
  }

  return (
    <section aria-labelledby="request-actions-heading" className="mt-8">
      <h2 id="request-actions-heading" className="text-lg font-semibold text-indigo-night-900">
        Actions
      </h2>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {pending === null ? (
        <div className="mt-3 flex flex-wrap gap-3">
          {canConfirm ? (
            <button
              type="button"
              ref={confirmRef}
              onClick={() => open('confirm')}
              className="rounded-sm bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Confirm erasure
            </button>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              ref={cancelRef}
              onClick={() => open('cancel')}
              className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-indigo-night-900 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Withdraw request
            </button>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="pending-heading"
          className="mt-4 rounded-card border border-slate-300 bg-white p-4 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
        >
          <h3 id="pending-heading" className="font-semibold text-indigo-night-900">
            {pending === 'confirm' ? 'Confirm this erasure' : 'Withdraw this request'}
          </h3>

          {refusal ? (
            <p
              role="alert"
              className="mt-3 rounded-card border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
            >
              <span className="font-medium">{refusal.title}.</span> {refusal.detail}
            </p>
          ) : null}

          {pending === 'confirm' ? (
            <>
              <p className="mt-2 text-sm text-slate-700">
                This cannot be undone. Type back the confirmation phrase you were given when this
                request was raised — it is not shown here, and it is not recoverable from this
                screen.
              </p>
              <div className="mt-3 flex flex-col gap-1">
                <label
                  htmlFor="confirmation-phrase"
                  className="text-sm font-medium text-indigo-night-900"
                >
                  Confirmation phrase
                </label>
                <input
                  id="confirmation-phrase"
                  name="confirmationPhrase"
                  type="text"
                  autoComplete="off"
                  spellCheck="false"
                  value={phrase}
                  onChange={(event) => setPhrase(event.target.value)}
                  className="rounded-sm border border-slate-300 px-3 py-2 font-mono text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                />
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-slate-700">
                Withdrawing changes nothing about the subject. It records that this request will not
                run.
              </p>
              <div className="mt-3 flex flex-col gap-1">
                <label htmlFor="reason-code" className="text-sm font-medium text-indigo-night-900">
                  Why
                </label>
                <select
                  id="reason-code"
                  name="reasonCode"
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  className="rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                >
                  {REQUEST_CANCEL_REASONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {stepUp ? (
            <div className="mt-4">
              <StepUpPrompt
                action={pending === 'confirm' ? 'confirm this erasure' : 'withdraw this request'}
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
                disabled={busy || (pending === 'confirm' && phrase.trim() === '')}
                className="rounded-sm bg-indigo-night-900 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-night-800 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Working…' : pending === 'confirm' ? 'Erase' : 'Withdraw'}
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
    </section>
  )
}
