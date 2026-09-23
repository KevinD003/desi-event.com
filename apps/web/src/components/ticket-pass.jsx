'use client'

/**
 * The holder's entry pass, drawn as a QR code on request.
 *
 * ## What it is, and what that means for whoever holds the phone
 *
 * The pass is a bearer credential. Whoever presents it first is admitted, so a
 * screenshot of it is exactly as good as the screen it came from. This
 * component does not pretend otherwise and does not try to stop screenshots —
 * nothing on the web can — it says so, next to the code, in plain words.
 *
 * ## How little of it the page keeps
 *
 * - Nothing until the holder asks. The page renders on the server without the
 *   pass; it is fetched from `GET /v1/tickets/:id/pass`, holder-only and
 *   `no-store`, when the button is pressed.
 * - The credential string is encoded the moment it arrives and dropped. What
 *   the component keeps is the drawing — a path of dark squares. The text is
 *   never in the DOM: not in a title, a label, an
 *   attribute or a data URL, and not in React state after this function
 *   returns.
 * - Nothing is stored: no local storage, no session storage, no cache, no
 *   analytics event, no log line.
 * - It goes away when the holder hides it, when they leave the page, and when
 *   the page is hidden or put in the back-forward cache.
 * - It does not move. No animation, no pulsing, nothing that a reduced-motion
 *   setting would have to turn off.
 *
 * @module components/ticket-pass
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { Alert, Button } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { qrMatrix, qrPath } from '../lib/qr.js'

/**
 * What each refusal from the pass endpoint means to the holder.
 *
 * @type {Readonly<Record<number, string>>}
 */
const REFUSALS = Object.freeze({
  403: 'This pass is only available to the person holding the ticket.',
  404: 'This pass is not available.',
  409: 'This ticket no longer admits anybody, so it has no pass.',
  429: 'Too many requests for this pass. Wait a minute and try again.',
})

/**
 * @typedef {object} TicketPassProps
 * @property {string} ticketId The ticket.
 */

/**
 * The pass panel.
 *
 * @param {TicketPassProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function TicketPass({ ticketId }) {
  const titleId = useId()
  const [drawing, setDrawing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const showButton = useRef(null)
  const hideButton = useRef(null)
  // Set when the holder has just asked to see the pass, so focus moves to the
  // control that takes it away once it is drawn — not on every re-render.
  const justShown = useRef(false)
  // Set when the holder hid it themselves, so focus goes back to the button
  // that showed it. Not when the page hid it: nobody is looking then.
  const justHidden = useRef(false)

  useEffect(() => {
    if (drawing && justShown.current) {
      justShown.current = false
      hideButton.current?.focus()
    }

    if (!drawing && justHidden.current) {
      justHidden.current = false
      showButton.current?.focus()
    }
  }, [drawing])

  const hide = useCallback(() => {
    justHidden.current = true
    setDrawing(null)
  }, [])

  // Gone when the page is hidden or cached for back-forward navigation, and
  // gone on unmount — which is what leaving the page is.
  useEffect(() => {
    if (!drawing) return undefined

    const onHidden = () => {
      if (document.visibilityState === 'hidden') setDrawing(null)
    }
    const onPageHide = () => setDrawing(null)

    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [drawing])

  useEffect(() => () => setDrawing(null), [])

  /**
   * Fetch the pass, draw it, and let go of the text.
   *
   * @returns {Promise<void>}
   */
  async function show() {
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(`/v1/tickets/${encodeURIComponent(ticketId)}/pass`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        setError(REFUSALS[response.status] ?? 'The pass could not be loaded. Try again.')

        return
      }

      const { data } = await response.json()
      const matrix = qrMatrix(data.credential)

      // The only thing kept is the picture. `data` goes out of scope with this
      // function.
      justShown.current = true
      setDrawing({ size: matrix.size, path: qrPath(matrix) })
    } catch {
      setError('The pass could not be loaded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4">
      {drawing ? (
        <div className="rounded-card border border-line bg-surface-raised p-5 shadow-card sm:p-6">
          {/* The figure is the code and its caption, and nothing else: a
              `figcaption` has to be the figure's first or last child, so the
              control that takes the pass away sits after it, not inside. */}
          <figure className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
            {/* A white frame round the code, wider than the code's own quiet
                zone, so a scanner finds the edge even against a dark case or
                a screen protector's glare. White in both registers. */}
            <div className="mx-auto w-full max-w-[18rem] shrink-0 rounded-control border border-line bg-surface-raised p-3 sm:mx-0 sm:w-60">
              <svg
                role="img"
                aria-labelledby={titleId}
                viewBox={`0 0 ${drawing.size} ${drawing.size}`}
                className="block h-auto w-full"
                shapeRendering="crispEdges"
              >
                <title id={titleId}>Your entry pass, as a QR code for the door to scan</title>
                <rect width={drawing.size} height={drawing.size} fill="#ffffff" />
                <path d={drawing.path} fill="#000000" />
              </svg>
            </div>
            <figcaption className="min-w-0 flex-1 space-y-3 text-sm text-ink-muted">
              <p className="text-base text-ink">
                <strong className="font-semibold">Show this at the door.</strong> Turn your screen
                brightness up if the scanner struggles.
              </p>
              <p>
                Anybody holding this code — on a screen, printed, or as a screenshot — can use it to
                get in once. Do not post it or send it to anyone. If you want somebody else to use
                this ticket, offer it to them below instead: that gives them their own pass and
                cancels this one.
              </p>
            </figcaption>
          </figure>
          <Button
            ref={hideButton}
            type="button"
            variant="secondary"
            className="mt-5"
            onClick={() => hide()}
          >
            Hide pass
          </Button>
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-line-strong bg-surface-subtle p-5 sm:p-6">
          <Button ref={showButton} type="button" loading={busy} onClick={show}>
            Show my entry pass
          </Button>
          <p className="mt-3 text-sm text-ink-muted">
            Shown only on this device, only while this page is open. It is not stored anywhere.
          </p>
        </div>
      )}

      {error ? (
        <Alert variant="info" className="mt-3">
          {error}
        </Alert>
      ) : null}
    </div>
  )
}
