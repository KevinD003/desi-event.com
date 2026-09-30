'use client'

/**
 * An order's group pass: one QR that lets in every ticket on the order the
 * buyer still holds, drawn on request.
 *
 * Built exactly like a ticket's own pass (`./ticket-pass.jsx`), because it is
 * the same kind of thing — a bearer credential, for more people at once:
 *
 * - Nothing until the buyer asks. It is fetched from
 *   `GET /v1/orders/:reference/group-pass`, buyer-only and `no-store`, when the
 *   button is pressed.
 * - The QR content is encoded the moment it arrives and dropped: what the
 *   component keeps is the drawing. The printed group code is kept only while
 *   the pass is shown, because a steward may have to type it; it is drawn as
 *   text inside the shown panel and nowhere else — not in a title, a label, an
 *   attribute, storage or the address bar.
 * - It goes away when the buyer hides it, when the page is hidden or left, and
 *   on unmount.
 * - Replacing it, after a screenshot went somewhere it should not, stops the
 *   old QR and code working and leaves each ticket's own pass alone.
 *
 * @module components/group-pass
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { Alert, Button } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { qrMatrix, qrPath } from '../lib/qr.js'

/**
 * What a refusal means to the buyer, by status, and for a 409 by reason.
 *
 * @param {number} status The HTTP status.
 * @param {string|null} reason The closed reason, for a 409.
 * @returns {string} The sentence.
 */
function refusal(status, reason) {
  if (status === 404) return 'This group pass is not available.'
  if (status === 429) return 'Too many requests. Wait a minute and try again.'

  if (status === 409) {
    switch (reason) {
      case 'TOO_FEW_TICKETS':
        return 'Too few tickets on this order still admit: a new group pass needs two, and one already taken out needs one.'
      case 'TOO_MANY_TICKETS':
        return 'This order has more than 50 tickets; use each ticket’s own pass.'
      case 'ORDER_NOT_PAID':
        return 'This order is not paid, so it has no group pass.'
      case 'EVENT_CANCELLED':
        return 'This event was cancelled, so nobody is admitted to it.'
      default:
        return 'This group pass cannot be shown right now. Try again.'
    }
  }

  return 'The group pass could not be loaded. Try again.'
}

/**
 * A seat in words.
 *
 * @param {{section: string|null, row: string|null, label: string}|null} seat The seat.
 * @returns {string|null} The words, or null for general admission.
 */
function seatWords(seat) {
  if (!seat) return null

  return [seat.section, seat.row ? `row ${seat.row}` : null, `seat ${seat.label}`]
    .filter(Boolean)
    .join(', ')
}

/**
 * @typedef {object} GroupPassProps
 * @property {string} reference The order reference.
 * @property {number} admits How many tickets the order page says it admits.
 */

/**
 * The group pass panel.
 *
 * @param {GroupPassProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function GroupPass({ reference, admits }) {
  const titleId = useId()
  const [shown, setShown] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const showButton = useRef(null)
  const hideButton = useRef(null)
  const confirmHeading = useRef(null)
  const replaceButton = useRef(null)
  const justShown = useRef(false)
  const justHidden = useRef(false)
  const justKept = useRef(false)

  useEffect(() => {
    if (shown && justShown.current) {
      justShown.current = false
      hideButton.current?.focus()
    }

    if (!shown && justHidden.current) {
      justHidden.current = false
      showButton.current?.focus()
    }
  }, [shown])

  useEffect(() => {
    if (confirming) {
      confirmHeading.current?.focus()
    } else if (justKept.current) {
      // "Keep it" goes with the question it answered; focus goes back to the
      // button that asked it, rather than falling to the page.
      justKept.current = false
      replaceButton.current?.focus()
    }
  }, [confirming])

  const hide = useCallback(() => {
    justHidden.current = true
    setConfirming(false)
    setShown(null)
  }, [])

  // Gone when the page is hidden or cached for back-forward navigation.
  useEffect(() => {
    if (!shown) return undefined

    const onHidden = () => {
      if (document.visibilityState === 'hidden') setShown(null)
    }
    const onPageHide = () => setShown(null)

    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [shown])

  useEffect(() => () => setShown(null), [])

  const path = `/v1/orders/${encodeURIComponent(reference)}/group-pass`

  /**
   * Fetch the pass, draw it, and let go of the QR content.
   *
   * @returns {Promise<void>}
   */
  async function show() {
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(path, { cache: 'no-store' })

      if (!response.ok) {
        const body = await response.json().catch(() => null)

        setError(refusal(response.status, body?.error?.reason ?? null))

        return
      }

      const { data } = await response.json()
      const matrix = qrMatrix(data.credential)

      // The picture, the printed code and what it admits are kept; the QR
      // content goes out of scope with this function.
      justShown.current = true
      setShown({
        size: matrix.size,
        path: qrPath(matrix),
        code: data.groupCode,
        admits: data.admits,
        tickets: data.tickets.map((ticket) => ({
          key: ticket.id,
          tier: ticket.tier?.name ?? null,
          seat: seatWords(ticket.seat),
          offered: ticket.offered,
        })),
      })
    } catch {
      setError('The group pass could not be loaded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Replace the pass, then draw the new one.
   *
   * @returns {Promise<void>}
   */
  async function replace() {
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(`${path}/rotate`, { method: 'POST' })

      if (!response.ok) {
        const body = await response.json().catch(() => null)

        setError(refusal(response.status, body?.error?.reason ?? null))

        return
      }

      setConfirming(false)
      setShown(null)
      setAnnouncement('Replaced. The old group QR and code no longer work.')
    } catch {
      setError('The group pass could not be replaced. Check your connection and try again.')

      return
    } finally {
      setBusy(false)
    }

    await show()
  }

  const count = shown?.admits ?? admits

  return (
    <div className="mt-4">
      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        {announcement}
      </p>

      {shown ? (
        <div className="rounded-card border border-line bg-surface-raised p-5 shadow-card sm:p-6">
          <figure className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
            <div className="mx-auto w-full max-w-[18rem] shrink-0 rounded-control border border-line bg-surface-raised p-3 sm:mx-0 sm:w-60">
              <svg
                role="img"
                aria-labelledby={titleId}
                viewBox={`0 0 ${shown.size} ${shown.size}`}
                className="block h-auto w-full"
                shapeRendering="crispEdges"
              >
                <title id={titleId}>
                  {`Group entry pass for ${count} ${count === 1 ? 'person' : 'people'}, as a QR code`}
                </title>
                <rect width={shown.size} height={shown.size} fill="#ffffff" />
                <path d={shown.path} fill="#000000" />
              </svg>
            </div>
            <figcaption className="min-w-0 flex-1 space-y-3 text-sm text-ink-muted">
              <p className="text-base text-ink">
                <strong className="font-semibold">Admits {count}.</strong> Show this at the door
                when your group arrives; the steward chooses who is there.
              </p>
              <div>
                <p>If the QR will not scan, the steward can type this group code.</p>
                <p className="mt-1 font-mono text-lg font-semibold tracking-wide break-all text-ink">
                  {shown.code}
                </p>
              </div>
              <ul className="space-y-1">
                {shown.tickets.map((ticket) => (
                  <li key={ticket.key}>
                    {[ticket.tier ?? 'Ticket', ticket.seat].filter(Boolean).join(' · ')}
                    {ticket.offered ? ' — offered to somebody; admits until they accept' : ''}
                  </li>
                ))}
              </ul>
              <p>
                Anybody holding this code or a screenshot of it can use it to let in everybody on
                it. Do not post it. If it went somewhere it should not, replace it.
              </p>
            </figcaption>
          </figure>

          {confirming ? (
            <div
              role="group"
              aria-labelledby={`${titleId}-replace`}
              className="mt-5 rounded-card border border-line-strong bg-surface-subtle p-4"
            >
              <h3
                id={`${titleId}-replace`}
                ref={confirmHeading}
                tabIndex={-1}
                className="font-semibold text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Replace the group pass?
              </h3>
              <p className="mt-1 text-sm text-ink-muted">
                The current group QR and code stop working. Each ticket’s own pass keeps working.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" loading={busy} onClick={replace}>
                  Replace it
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    justKept.current = true
                    setConfirming(false)
                  }}
                >
                  Keep it
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button ref={hideButton} type="button" variant="secondary" onClick={() => hide()}>
              Hide group pass
            </Button>
            {!confirming ? (
              <Button
                ref={replaceButton}
                type="button"
                variant="outline"
                onClick={() => setConfirming(true)}
              >
                Replace group pass
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-line-strong bg-surface-subtle p-5 sm:p-6">
          <Button ref={showButton} type="button" loading={busy} onClick={show}>
            Show group pass
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
