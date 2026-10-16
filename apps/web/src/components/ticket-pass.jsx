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
 * - The code does not move. No animation, no pulsing, nothing over it. The
 *   panel it sits on is uncovered once, from the tear line, as it appears
 *   (`ticket-reveal`, a clip-path in `commerce.css`, only without a
 *   reduced-motion setting); the code itself is never scaled, faded or
 *   shifted, so a scanner can read it the moment it is there.
 *
 * ## A pass the API will not issue
 *
 * A 409 carries the API's own sentence (the door's, from the same function):
 * the order is not paid, the event was cancelled, the ticket has no pass. That
 * sentence is shown, and handed to the page's `TicketStanding`, so the page
 * stops saying the ticket admits while its pass says it does not.
 *
 * ## A ticket booked to pay at the door
 *
 * Still gets its pass — the door has to scan it to take the payment — and says
 * so beside it: `VenuePaymentNote` names what is due ("Pay at the door:
 * $40.00"), that a ticket cancelled because it was not paid for no longer
 * admits, and, to a holder who paid at the door for a ticket later refunded or
 * withdrawn, that the money is with the organiser (SPEC3 §12.7, SPEC3-XI §12.7).
 * It does not stop the ticket being passed on: what is due goes with it.
 *
 * @module components/ticket-pass
 */

import './commerce.css'

import { Icon } from '@desi-event/ui/icons'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { StatusChip } from '../app/account/orders/status-chip.jsx'
import { useTicketStanding } from './ticket-standing.jsx'
import { Alert, Button } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { qrMatrix, qrPath } from '../lib/qr.js'
import { venuePaymentChip, venuePaymentNotes } from '../lib/wallet.js'

/**
 * What a ticket booked to pay at the door says about it to its holder: the
 * chip, when it says more than the ticket's status, and the sentences.
 *
 * @param {object} props Component props.
 * @param {object} props.ticket The ticket, with `status` and `venuePayment`.
 * @param {string} [props.timeZone] The event's timezone, for a cancellation's date.
 * @returns {JSX.Element|null} The note, or nothing for a ticket that owes nothing at the door.
 */
export function VenuePaymentNote({ ticket, timeZone = 'UTC' }) {
  const chip = venuePaymentChip(ticket)
  const notes = venuePaymentNotes(ticket, timeZone)

  if (!chip && notes.length === 0) return null

  return (
    <div className="mt-3 space-y-2 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
      {chip ? <StatusChip meaning={chip} /> : null}
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  )
}

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

/** The longest API sentence a refusal shows; anything longer is not a sentence for a holder. */
const MAX_SENTENCE = 200

/**
 * What a 409 from the pass endpoint says: the API's own sentence when it sent
 * one (it is the door's, written for the holder), else the general one.
 *
 * @param {object|null} body The response body.
 * @returns {string} The sentence.
 */
export function conflictSentence(body) {
  const message = body?.error?.code === 'CONFLICT' ? body.error.message : null

  if (typeof message === 'string' && message.trim() && message.length <= MAX_SENTENCE) {
    return message.trim()
  }

  return REFUSALS[409]
}

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
  // Set when the API refused the pass for good (a 409): the button that asks
  // again is taken away, because asking again gets the same answer.
  const [refused, setRefused] = useState(false)
  const standing = useTicketStanding()
  const refuse = standing?.refuse
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
        if (response.status === 409) {
          const sentence = conflictSentence(await response.json().catch(() => null))

          setError(sentence)
          setRefused(true)
          refuse?.(sentence)

          return
        }

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
        <div className="ticket-reveal">
          {/* The figure is the code and its caption, and nothing else: a
              `figcaption` has to be the figure's first or last child, so the
              control that takes the pass away sits after it, not inside. */}
          <figure className="flex flex-col gap-4">
            {/* A white frame round the code, wider than the code's own quiet
                zone, so a scanner finds the edge even against a dark case or
                a screen protector's glare. White in both registers. */}
            <div className="mx-auto w-full max-w-[18rem] rounded-control border border-line bg-surface-raised p-3">
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
            <figcaption className="min-w-0 space-y-2 text-caption text-ink-muted">
              <p className="text-label text-ticket-ink">
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
            fullWidth
            className="mt-4"
            onClick={() => hide()}
          >
            Hide pass
          </Button>
        </div>
      ) : refused ? null : (
        <div className="flex flex-col gap-3">
          {/* Where the code will be: an empty, dashed square the size of the
              pass, so the stub reads as a stub before it is asked for.
              Decoration only. */}
          <div
            aria-hidden="true"
            className="mx-auto hidden aspect-square w-full max-w-[13rem] items-center justify-center rounded-control border-2 border-dashed border-line-strong text-ink-muted md:flex"
          >
            <Icon name="qr" className="size-10" />
          </div>
          <Button ref={showButton} type="button" fullWidth loading={busy} onClick={show}>
            Show my entry pass
          </Button>
          <p className="text-caption text-ink-muted">
            Shown only on this device, only while this page is open. It is not stored anywhere.
          </p>
        </div>
      )}

      {error ? (
        <Alert variant="info" className={refused ? '' : 'mt-3'}>
          {error}
        </Alert>
      ) : null}
    </div>
  )
}
