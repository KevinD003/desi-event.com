'use client'

/**
 * The buttons that move the simulation, and the confirmation in front of them.
 *
 * ## Focus restoration
 *
 * By effect against a live node, never against one captured on the way in.
 * Opening the panel unmounts the trigger buttons, so an element held from
 * before is detached by the time anybody wants it back — and focusing a
 * detached node silently does nothing, which strands a keyboard user at the top
 * of the page after backing out. `app/privacy/request-actions.jsx:77-90` is the
 * version that gets this right; the finance components hold the node and get it
 * wrong, and that is a pre-existing defect rather than a pattern to copy.
 *
 * ## Recovering a lapsed step-up
 *
 * `StepUpPrompt` then `router.refresh()`, the pair already used by
 * `components/reconciliation-actions.jsx` and `app/privacy/request-actions.jsx`.
 * The refresh re-runs the server component, so the state the page shows after
 * an action is the state the server has, not one this component guessed.
 *
 * ## There is no loading screen
 *
 * Every screen here is `force-dynamic` and server-rendered, so there is no
 * page-level pending state to render and the shared `Loading` component is dead
 * code. The loading state is the button's own disabled-and-busy label, and the
 * finished transition is announced through a polite live region — not through a
 * spinner nobody hears.
 *
 * @module app/finance/connect/connect-actions
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { connectActionsFor, describeConnectRefusal } from '../../../lib/connect-vocabulary.js'

/**
 * @typedef {object} ConnectActionsProps
 * @property {string} organizationId Whose simulation.
 * @property {string} state The state the server last reported.
 */

/**
 * The actions.
 *
 * @param {ConnectActionsProps} props Component props.
 * @returns {JSX.Element} The rendered actions.
 */
export function ConnectActions({ organizationId, state }) {
  const router = useRouter()
  const available = connectActionsFor(state)
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const [stepUp, setStepUp] = useState(false)
  const [restoreTo, setRestoreTo] = useState(null)
  const panelRef = useRef(null)
  const triggerRefs = useRef(new Map())

  useEffect(() => {
    if (pending !== null || restoreTo === null) return

    triggerRefs.current.get(restoreTo)?.focus()
    setRestoreTo(null)
  }, [pending, restoreTo])

  /**
   * Open the confirmation for one action.
   *
   * @param {string} action Which action.
   * @returns {void} Nothing.
   */
  function open(action) {
    setPending(action)
    setRefusal(null)
    queueMicrotask(() => panelRef.current?.focus())
  }

  /**
   * Close the confirmation and put focus back where it was.
   *
   * @returns {void} Nothing.
   */
  function dismiss() {
    setRestoreTo(pending)
    setPending(null)
    setStepUp(false)
    setRefusal(null)
  }

  /**
   * Send the open action.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    if (!pending) return

    setBusy(true)
    setRefusal(null)

    try {
      const response = await apiFetch(
        `/v1/organizations/${encodeURIComponent(organizationId)}/connect/start`,
        // The entire body. No organisation id — that is in the path, where the
        // capability guard reads it, and a second copy here is how a guard on
        // one and a writer on the other becomes a cross-tenant write. No state,
        // no reason, no idempotency key.
        { method: 'POST', body: JSON.stringify({ action: pending }) },
      )
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setPending(null)
        setAnnouncement(
          'Recorded. The simulated state has moved. No payment provider was contacted.',
        )
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefusal(
        describeConnectRefusal({ status: response.status, code: parsed?.error?.code ?? null }),
      )
      queueMicrotask(() => panelRef.current?.focus())
    } catch {
      setRefusal({
        title: 'The service is not responding',
        detail: 'Nothing has been recorded. The simulation is exactly as it was.',
        recoverable: true,
      })
      queueMicrotask(() => panelRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  const open_ = available.find((button) => button.action === pending) ?? null

  return (
    <section aria-labelledby="connect-actions-heading" className="mt-8">
      <h2 id="connect-actions-heading" className="text-lg font-semibold text-indigo-night-900">
        Move the simulation
      </h2>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {available.length === 0 ? (
        <p className="mt-3 max-w-3xl rounded-card border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          There is nothing to do here. The simulation has reached the last step this deployment
          offers, and nothing moves it out of that.
        </p>
      ) : null}

      {pending === null && available.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-3">
          {available.map((button) => (
            <button
              key={button.action}
              type="button"
              ref={(node) => {
                if (node) triggerRefs.current.set(button.action, node)
                else triggerRefs.current.delete(button.action)
              }}
              onClick={() => open(button.action)}
              className={`rounded-sm px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
                button.destructive
                  ? 'bg-rose-700 text-white hover:bg-rose-800'
                  : 'border border-slate-300 bg-white text-indigo-night-900 hover:bg-slate-50'
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
      ) : null}

      {open_ ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="connect-pending-heading"
          className="mt-4 rounded-card border border-slate-300 bg-white p-4 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
        >
          <h3 id="connect-pending-heading" className="font-semibold text-indigo-night-900">
            {open_.label}
          </h3>

          {refusal ? (
            <p
              role="alert"
              className="mt-3 rounded-card border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
            >
              <span className="font-medium">{refusal.title}.</span> {refusal.detail}
            </p>
          ) : null}

          <p className="mt-2 max-w-2xl text-sm text-slate-700">{open_.confirmation}</p>

          {stepUp ? (
            <div className="mt-4">
              <StepUpPrompt
                action={open_.label.toLowerCase()}
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
                disabled={busy}
                className="rounded-sm bg-indigo-night-900 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-night-800 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Record it'}
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
