'use client'

/**
 * Handing a ticket on, and taking one back.
 *
 * ## The invitation is not in the URL
 *
 * A transfer is authorised by a one-time code. When codes are not emailed
 * (`MANUAL`, how this site runs unless a mail server is configured), the API
 * returns the code exactly once, in the response to the offer, and the sender
 * passes it on themselves; the shared `OneTimeCodePanel` is the only place it
 * is drawn, it lives in this component's state and nowhere else, and
 * it is dropped on "I have handed it over", on leaving the page and on
 * unmount — not when the tab is hidden, so the sender can switch to a
 * messaging app and paste it. The recipient pastes it into the field below —
 * never a query parameter, because a secret in a URL is a secret in the browser
 * history, in the `Referer` header of the next request, in the proxy's access
 * log and in every screenshot of the address bar. The API keeps only its
 * digest, and a code alone takes nothing: the recipient must also be signed in
 * at the address it was offered to.
 *
 * A reserved seat is offered like any other ticket; the seat goes with it.
 *
 * When codes are emailed (`EMAIL`), the API sends the code to the address the
 * ticket is offered to and returns none, and the panel says so. What the
 * screen says about the code follows the delivery mode the session reports
 * (`deliveryMode`), so it is true in the deployment it is read in.
 *
 * The field is a password input for the same reason a password is: this screen
 * gets used on a train.
 *
 * ## A ticket booked to pay at the door
 *
 * Is offered on like any other (SPEC3-XI XT1): what is due stays with the
 * ticket, and whoever holds it pays at the door. The holder is told before
 * sending, above the address; the code panel says what to tell the person it
 * is for, because with codes not emailed nobody else will; and the person
 * accepting is told the amount once it is theirs.
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

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { useFocusAfterRender } from './focus-after-render.jsx'
import { Alert, Button, FormField, Input, Textarea } from './ui.jsx'
import { OneTimeCodePanel } from './one-time-code-panel.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { formatAmount } from '../lib/pricing.js'
import { owesAtDoor } from '../lib/wallet.js'

/**
 * What the offer form says, above the address, about a ticket whose price is
 * paid at the door (SPEC3-XI §12.7).
 *
 * @param {string} due The amount, formatted.
 * @returns {string} The sentence.
 */
export function transferDueSentence(due) {
  return `This ticket’s price, ${due}, is paid at the door. Whoever you pass it to pays it when they arrive, and you no longer do.`
}

/**
 * What the code panel adds for such a ticket: what to tell the person it is for.
 *
 * @param {string} due The amount, formatted.
 * @returns {string} The sentence.
 */
export function tellThemSentence(due) {
  return `Tell them: whoever holds this ticket pays ${due} at the door.`
}

/**
 * What accepting a ticket that owes its price at the door says (SPEC3-XI §12.7).
 *
 * @param {string} due The amount, formatted.
 * @returns {string} The sentence.
 */
export function acceptedDueSentence(due) {
  return `Ticket accepted. Pay ${due} at the door when you arrive: the steward takes it before letting you in.`
}

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
 * What the offer says about its code, per delivery mode. `MANUAL` keeps "shown
 * once … give them yourself"; `EMAIL` says the code goes to the address and the
 * sender does not see it; an unknown mode says neither.
 *
 * @type {Readonly<Record<string, {how: string, field: string}>>}
 */
export const TRANSFER_DELIVERY_COPY = Object.freeze({
  MANUAL: {
    how: 'You are shown a one-time code to give them yourself; they accept it signed in at the address you name.',
    field:
      'They must be signed in with this address to accept. Codes are not emailed from this site: after you offer it you are shown a one-time code to give them yourself.',
  },
  EMAIL: {
    how: 'A one-time code is emailed to the address you name, and they accept it signed in there. You will not see the code.',
    field:
      'They must be signed in with this address to accept. The code is emailed to that address. You will not see it.',
  },
  UNKNOWN: {
    how: 'They accept it with a one-time code, signed in at the address you name.',
    field: 'They must be signed in with this address to accept.',
  },
})

/**
 * @typedef {object} TicketTransferActionsProps
 * @property {object} ticket The ticket.
 * @property {Array<object>} transfers Its transfers, oldest first.
 * @property {boolean} holder Whether the caller is the person holding it.
 * @property {boolean} mayRevoke Whether the caller may withdraw it.
 * @property {'MANUAL'|'EMAIL'|null} [deliveryMode] How codes go out here, as the session says.
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
  deliveryMode = null,
}) {
  const words = TRANSFER_DELIVERY_COPY[deliveryMode] ?? TRANSFER_DELIVERY_COPY.UNKNOWN
  const router = useRouter()
  const [pending, setPending] = useState(null)
  const [toEmail, setToEmail] = useState('')
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // The one-time code from an offer, with who it is for and until when. In
  // state only; see the module doc for when it is dropped.
  const [issued, setIssued] = useState(null)
  const panelRef = useRef(null)
  const returnFocus = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  const outstanding = transfers.find((transfer) => transfer.status === 'PENDING') ?? null
  const offerable = holder && OFFERABLE.includes(ticket.status) && !outstanding
  const withdrawable = holder && Boolean(outstanding)
  // What is due at the door goes with the ticket to whoever holds it next.
  const due = owesAtDoor(ticket)
    ? formatAmount(ticket.venuePayment.dueCents, ticket.venuePayment.currency)
    : null

  // Leaving the page drops the code. Hiding the tab does not: the sender has
  // to be able to switch to a messaging app and paste it.
  useEffect(() => {
    const drop = () => setIssued(null)

    window.addEventListener('pagehide', drop)

    return () => window.removeEventListener('pagehide', drop)
  }, [])

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
    focusAfterRender(panelRef)
  }

  /**
   * Close the form and put focus back.
   *
   * @returns {void}
   */
  function dismiss() {
    setPending(null)
    setStepUp(false)
    focusAfterRender(returnFocus)
  }

  /**
   * Send one command.
   *
   * @param {string} path The path under `/v1`.
   * @param {object|null} body The payload, or null for none.
   * @param {string|function(object): string} said What to announce on success, or how to say it from the answer.
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
        const code = parsed?.data?.delivery?.invitationCode ?? null

        setPending(null)
        setToEmail('')
        setMessage('')
        setReason('')
        setAnnouncement(typeof said === 'function' ? said(parsed?.data ?? null) : said)

        if (code) {
          setIssued({
            code,
            recipient: parsed.data.toEmailMasked ?? null,
            expiresAt: parsed.data.expiresAt ?? null,
            // Read now: the page redraws once the offer is made.
            due,
          })
        }

        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setError(parsed?.error?.message ?? 'That was refused.')
      focusAfterRender(panelRef)
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

      {/* What the ticket owes at the door, or why it no longer does, is not an
          action: the ticket's page draws it under "Where it stands", in the
          event's own time zone (`VenuePaymentNote`). This panel says only what
          passing the ticket on means for that amount. */}

      {issued ? (
        <OneTimeCodePanel
          code={issued.code}
          heading="Give them this code"
          codeLabel="Ticket transfer code"
          recipient={issued.recipient}
          expiresAt={issued.expiresAt}
          acceptPath="/tickets/accept"
          acceptPlace="Your account → Transfers → Accept a ticket"
          lostAdvice="If you lose it, withdraw the offer and make a new one."
          // Inside the panel, with what to tell them and before its buttons
          // (SPEC3-XI §12.7, XT6).
          note={issued.due ? tellThemSentence(issued.due) : null}
          onDone={() => setIssued(null)}
        />
      ) : null}

      {pending === null ? (
        <ul className="mt-2 space-y-3">
          {offerable ? (
            <li>
              <Button type="button" onClick={(pressed) => begin('offer', pressed.currentTarget)}>
                Offer this ticket to somebody
              </Button>
              <p className="mt-1 text-sm text-ink-muted">
                {words.how} Until they do, the ticket stays yours and still admits you.
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

          {!offerable && !withdrawable && !mayRevoke ? (
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
          className="mt-3 rounded-card border border-line-strong bg-surface-raised p-5 shadow-card focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
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
              {due ? <p className="mt-2 text-sm text-ink">{transferDueSentence(due)}</p> : null}
              <div className="mt-3">
                <FormField
                  label="Their email address"
                  id="transfer-to"
                  required
                  description={words.field}
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
                      (data) =>
                        data?.delivery?.mode === 'EMAIL'
                          ? 'Offered. The invitation has been sent.'
                          : 'Offered. Give them the code shown below; it is shown only once.',
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
  const focusAfterRender = useFocusAfterRender()

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
      focusAfterRender(errorRef)
    } catch {
      setError('The service is not responding. Nothing has been recorded.')
    } finally {
      setBusy(false)
    }
  }

  if (accepted) {
    const owed = accepted.venuePayment ?? null

    return (
      <Alert variant="success" title="It is yours">
        {(owed?.dueCents ?? 0) > 0 ? (
          <p className="mb-2 font-medium">
            {acceptedDueSentence(formatAmount(owed.dueCents, owed.currency))}
          </p>
        ) : null}
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
