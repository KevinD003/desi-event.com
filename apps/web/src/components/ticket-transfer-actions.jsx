'use client'

/**
 * Handing a ticket on, and taking one back.
 *
 * ## The invitation is not in the URL
 *
 * A transfer is authorised by a bearer token. It is delivered out of band, to
 * the address the sender typed, and it is pasted into the field below — it is
 * never a query parameter, because a secret in a URL is a secret in the browser
 * history, in the `Referer` header of the next request, in the proxy's access
 * log and in every screenshot of the address bar. The API compares the token's
 * digest; it has never held the token itself.
 *
 * The field is a password input for the same reason a password is: this screen
 * gets used on a train.
 *
 * ## Nothing here decides anything
 *
 * Whether a ticket may be handed on, whether an invitation is still live,
 * whether the ticket has since been revoked, refunded or checked in — all of it
 * is the server's, decided inside the transaction that writes. Two people
 * accepting the same invitation at the same moment produce one new ticket and
 * one conflict; the old credential stops admitting anybody the instant the
 * transfer completes, and that is a version bump on the row rather than a
 * promise made here.
 *
 * @module components/ticket-transfer-actions
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Alert, Button, FormField, Input, Textarea } from './ui.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { apiFetch } from '../lib/api-fetch.js'

/**
 * The states a ticket can be offered from.
 *
 * A mirror of the server's table, used to decide what to draw. A revoked,
 * refunded, cancelled, superseded or already-admitted ticket is not offerable,
 * and neither is one already out on offer.
 *
 * @type {ReadonlyArray<string>}
 */
const OFFERABLE = Object.freeze(['VALID'])

/**
 * @typedef {object} TicketTransferActionsProps
 * @property {object} ticket The ticket.
 * @property {Array<object>} transfers Its transfers, oldest first.
 * @property {boolean} holder Whether the caller is the person holding it.
 * @property {boolean} mayRevoke Whether the caller may withdraw it.
 * @property {string|null} [transferBlockedReason] The server's reason it may not be offered whatever its state.
 */

/**
 * The action panel.
 *
 * @param {TicketTransferActionsProps} props Component props.
 * @returns {JSX.Element} The rendered panel.
 */
export function TicketTransferActions({
  ticket,
  transfers,
  holder,
  mayRevoke,
  transferBlockedReason = null,
}) {
  const router = useRouter()
  const [pending, setPending] = useState(null)
  const [toEmail, setToEmail] = useState('')
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const panelRef = useRef(null)
  const returnFocus = useRef(null)

  const outstanding = transfers.find((transfer) => transfer.status === 'PENDING') ?? null
  // The server says when a ticket may not be offered whatever its state — a
  // reserved seat, until seated transfer exists. The button is not drawn, so
  // the screen does not offer something the server would refuse.
  const seatBlocked = transferBlockedReason === 'RESERVED_SEAT'
  const offerable = holder && OFFERABLE.includes(ticket.status) && !outstanding && !seatBlocked
  const withdrawable = holder && Boolean(outstanding)

  /**
   * Open one form.
   *
   * @param {string} key Which action.
   * @param {object} trigger The pressed element, so focus can come back.
   * @returns {void}
   */
  function begin(key, trigger) {
    returnFocus.current = trigger
    setPending(key)
    setError(null)
    queueMicrotask(() => panelRef.current?.focus())
  }

  /**
   * Close the form and put focus back.
   *
   * @returns {void}
   */
  function dismiss() {
    setPending(null)
    setStepUp(false)
    queueMicrotask(() => returnFocus.current?.focus())
  }

  /**
   * Send one command.
   *
   * @param {string} path The path under `/v1`.
   * @param {object|null} body The payload, or null for none.
   * @param {string} said What to announce on success.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(path, body, said) {
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })

      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setPending(null)
        setToEmail('')
        setMessage('')
        setReason('')
        setAnnouncement(said)
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setError(parsed?.error?.message ?? 'That was refused.')
      queueMicrotask(() => panelRef.current?.focus())
    } catch {
      setError('The service is not responding. Nothing has been recorded.')
    } finally {
      setBusy(false)
    }
  }

  const ticketPath = `/v1/tickets/${encodeURIComponent(ticket.id)}`

  return (
    <div className="mt-4">
      <p aria-live="polite" role="status" className="text-sm text-ink-muted">
        {announcement}
      </p>

      {pending === null ? (
        <ul className="mt-2 space-y-3">
          {offerable ? (
            <li>
              <Button type="button" onClick={(pressed) => begin('offer', pressed.currentTarget)}>
                Offer this ticket to somebody
              </Button>
              <p className="mt-1 text-sm text-ink-muted">
                They get an invitation at the address you give. Until they accept it the ticket
                stays yours and still admits you.
              </p>
            </li>
          ) : null}

          {withdrawable ? (
            <li>
              <Button
                type="button"
                variant="secondary"
                onClick={(pressed) => begin('withdraw', pressed.currentTarget)}
              >
                Withdraw the offer
              </Button>
              <p className="mt-1 text-sm text-ink-muted">
                Cancels the outstanding invitation. Whoever it went to can no longer accept it.
              </p>
            </li>
          ) : null}

          {mayRevoke ? (
            <li>
              <Button
                type="button"
                variant="danger"
                onClick={(pressed) => begin('revoke', pressed.currentTarget)}
              >
                Withdraw this ticket
              </Button>
              <p className="mt-1 text-sm text-ink-muted">
                Stops it admitting anybody, permanently. It does not give any money back — a refund
                is a separate decision with its own record.
              </p>
            </li>
          ) : null}

          {holder && seatBlocked && OFFERABLE.includes(ticket.status) && !outstanding ? (
            <li className="rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-muted">
              This ticket is for a reserved seat, and reserved-seat tickets cannot be handed on on
              this site. It stays yours and still admits you.{' '}
              <Link
                href="/limitations"
                className="rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Why seated tickets cannot be handed on
              </Link>
            </li>
          ) : null}

          {!offerable && !withdrawable && !mayRevoke && !(holder && seatBlocked) ? (
            <li className="rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-muted">
              There is nothing to do with this ticket. A ticket that has been handed on, withdrawn,
              refunded or already admitted cannot be offered again.
            </li>
          ) : null}
        </ul>
      ) : null}

      {pending ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-label={
            pending === 'offer'
              ? 'Offer this ticket'
              : pending === 'withdraw'
                ? 'Withdraw the offer'
                : 'Withdraw this ticket'
          }
          className="mt-3 rounded-card border border-line-strong bg-surface-raised p-4 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          {error ? (
            <div className="mb-3">
              <Alert variant="error" title="Refused">
                <p>{error}</p>
              </Alert>
            </div>
          ) : null}

          {stepUp ? (
            <div className="mb-3">
              <StepUpPrompt
                action="withdraw this ticket"
                onConfirmed={() => {
                  setStepUp(false)
                  void send(
                    `${ticketPath}/revoke`,
                    { reason: reason.trim() },
                    'Withdrawn. It admits nobody now.',
                  )
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          {pending === 'offer' ? (
            <>
              <h3 className="font-semibold text-ink">Offer this ticket</h3>
              <div className="mt-3">
                <FormField
                  label="Their email address"
                  id="transfer-to"
                  required
                  description="The invitation is addressed here and nowhere else. It expires, and until it is accepted the ticket stays yours. This site delivers no email, so the invitation is recorded but not sent."
                >
                  <Input
                    type="email"
                    value={toEmail}
                    onChange={(changed) => setToEmail(changed.target.value)}
                  />
                </FormField>
              </div>
              <div className="mt-3">
                <FormField
                  label="A message, if you like"
                  id="transfer-message"
                  description="Optional. Goes with the invitation."
                >
                  <Textarea
                    rows={3}
                    value={message}
                    onChange={(changed) => setMessage(changed.target.value)}
                  />
                </FormField>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy || !toEmail.includes('@')}
                  onClick={() =>
                    send(
                      `${ticketPath}/transfers`,
                      {
                        toEmail: toEmail.trim(),
                        ...(message.trim() ? { message: message.trim() } : {}),
                      },
                      'Offered. The invitation is recorded, and the ticket stays yours until it is accepted. This site delivers no email, so nothing has been sent to them.',
                    )
                  }
                >
                  {busy ? 'Working…' : 'Send the offer'}
                </Button>
                <Button type="button" variant="secondary" onClick={dismiss} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </>
          ) : null}

          {pending === 'withdraw' ? (
            <>
              <h3 className="font-semibold text-ink">Withdraw the offer</h3>
              <p className="mt-1 text-sm text-ink-muted">
                The invitation stops working. The ticket has been yours the whole time and stays
                yours.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    send(
                      `${ticketPath}/transfers/cancel`,
                      null,
                      'Withdrawn. The invitation no longer works.',
                    )
                  }
                >
                  {busy ? 'Working…' : 'Withdraw it'}
                </Button>
                <Button type="button" variant="secondary" onClick={dismiss} disabled={busy}>
                  Keep the offer open
                </Button>
              </div>
            </>
          ) : null}

          {pending === 'revoke' ? (
            <>
              <h3 className="font-semibold text-ink">Withdraw this ticket</h3>
              <p className="mt-1 text-sm text-ink-muted">
                Permanent. It will admit nobody, and whoever holds it is told. No money moves — a
                refund is a separate decision with its own record.
              </p>
              <div className="mt-3">
                <FormField
                  label="Why"
                  id="revoke-reason"
                  required
                  description="At least four characters. Kept with the ticket and with the audit record."
                >
                  <Textarea
                    rows={3}
                    value={reason}
                    onChange={(changed) => setReason(changed.target.value)}
                  />
                </FormField>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy || reason.trim().length < 4}
                  onClick={() =>
                    send(
                      `${ticketPath}/revoke`,
                      { reason: reason.trim() },
                      'Withdrawn. It admits nobody now.',
                    )
                  }
                >
                  {busy ? 'Working…' : 'Withdraw it'}
                </Button>
                <Button type="button" variant="secondary" onClick={dismiss} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Accepting or declining an invitation somebody sent you.
 *
 * Separate from the panel above because the person using it is a different
 * person, arriving from a different place, holding a secret rather than a
 * ticket. The token is typed or pasted — never carried in the URL — and the
 * field is a password input because this gets used on a train.
 *
 * @returns {JSX.Element} The rendered form.
 */
export function TicketTransferResponse() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [accepted, setAccepted] = useState(null)
  const errorRef = useRef(null)

  /**
   * Answer the invitation.
   *
   * @param {string} verb `accept` or `decline`.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function respond(verb) {
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(`/v1/ticket-transfers/${verb}`, {
        method: 'POST',
        body: JSON.stringify({ token: token.trim() }),
      })

      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        // Cleared immediately: it is spent, and a spent secret left in a form
        // is a spent secret in a browser's autofill store.
        setToken('')
        setAccepted(verb === 'accept' ? (parsed?.data?.ticket ?? null) : null)
        router.refresh()
        return
      }

      // One message for every refusal: expired, already used, withdrawn, never
      // existed. Telling them apart tells somebody feeding in guesses which of
      // their guesses was a real invitation.
      setError(
        'That invitation cannot be used. It may have expired, been withdrawn, or been used already.',
      )
      queueMicrotask(() => errorRef.current?.focus())
    } catch {
      setError('The service is not responding. Nothing has been recorded.')
    } finally {
      setBusy(false)
    }
  }

  if (accepted) {
    return (
      <Alert variant="success" title="It is yours">
        <p>
          The ticket is in your account now, and the pass the sender was holding has stopped
          working. Open it from your tickets to show it at the door.
        </p>
      </Alert>
    )
  }

  return (
    <div className="mt-4 max-w-xl">
      {error ? (
        <div ref={errorRef} tabIndex={-1} className="mb-3 focus-visible:outline-none">
          <Alert variant="error" title="That did not work">
            <p>{error}</p>
          </Alert>
        </div>
      ) : null}

      <FormField
        label="The invitation code you were sent"
        id="transfer-token"
        required
        description="Paste it here rather than opening it as a link. A code in a web address ends up in your history, in the next page’s referrer and in somebody’s server log."
      >
        <Input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(changed) => setToken(changed.target.value)}
        />
      </FormField>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || token.trim().length < 16}
          onClick={() => respond('accept')}
        >
          {busy ? 'Working…' : 'Accept the ticket'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || token.trim().length < 16}
          onClick={() => respond('decline')}
        >
          Decline it
        </Button>
      </div>
    </div>
  )
}
