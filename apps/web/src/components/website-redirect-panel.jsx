'use client'

/**
 * The website link's switch on an event's review page, for the team at
 * The Desi Events.
 *
 * Whether the event's public page shows "Visit the organiser's website", in
 * any state of the event but deleted, at any time. Only platform administrators
 * turn it on or off; the page says whether this reader may (`canDecide`,
 * decided on the server from the session), and the API refuses everybody else
 * all the same. A deleted event's switch is kept as it is (the API answers
 * `NOT_EDITABLE`), so the panel shows it and offers nobody controls
 * (`deleted`). A decision names the address on this screen, so an address the
 * organiser changed since cannot be turned on unseen: the API answers
 * `WEBSITE_CHANGED` and nothing is written.
 *
 * A decision needs a reason, which the organiser sees with the administrator's
 * name, and a second factor confirmed recently (the MODERATION window); when
 * the API asks for one, the step-up prompt is shown and the decision sent again.
 * Turning a link on also needs the box saying the address was opened and is
 * the organiser's own site: the API cannot check that, so the box is this
 * screen's, said honestly.
 *
 * @module components/website-redirect-panel
 */

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Badge, Button, FormField, Textarea } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { WEBSITE_LIMITS } from '../lib/website.js'
import { administratorSummary, formatDecisionInstant } from '../lib/website-redirect.js'

/** What a reader who may not decide is told, in place of the controls. */
export const CANNOT_DECIDE = 'Only a platform administrator can turn the website link on or off.'

/** What everybody is told about a deleted event, in place of the controls. */
export const DELETED_EVENT_FROZEN =
  'This event was deleted, so its website link cannot be turned on or off. The switch is kept as it is, and a restored event has it back as it was.'

/** The box an administrator ticks before turning a link on. */
export const CHECKED_LABEL = 'I have opened this address and it is the organiser’s own site.'

/** The codes after which the page has to be read again. */
const RELOAD_CODES = new Set(['WEBSITE_CHANGED', 'WEBSITE_REDIRECT_UNCHANGED', 'NOT_EDITABLE'])

/**
 * An address written out, opening in a new tab, said so in text.
 *
 * @param {object} props Component props.
 * @param {string} props.href The address.
 * @returns {JSX.Element} The link.
 */
function AddressLink({ href }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="font-medium break-all text-accent-strong underline underline-offset-4"
    >
      {href} <span className="text-ink-muted">(opens in a new tab)</span>
    </a>
  )
}

/**
 * @typedef {object} WebsiteRedirectPanelProps
 * @property {string} eventId The event.
 * @property {string|null} websiteUrl The organiser's current address.
 * @property {object|null} state The switch, as the API's `websiteRedirect`.
 * @property {boolean} pagePublic Whether the event's page is public now.
 * @property {boolean} canDecide Whether this reader may turn the link on or off.
 * @property {boolean} [deleted] Whether the event is deleted: its switch is
 *   then kept as it is, and nobody may turn it on or off.
 */

/**
 * The panel.
 *
 * @param {WebsiteRedirectPanelProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function WebsiteRedirectPanel({
  eventId,
  websiteUrl,
  state,
  pagePublic,
  canDecide,
  deleted = false,
}) {
  const router = useRouter()
  const ids = useId()
  const [current, setCurrent] = useState(state ?? null)
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const [problems, setProblems] = useState([])
  const [stepUp, setStepUp] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  // What the server said last. `router.refresh()` keeps this component's state,
  // so the switch as read again from the server ("Reload" after a refusal, or
  // the read after a decision) replaces the one held here whenever it differs
  // from what was last received: a link another administrator turned on must
  // not go on showing as off with "Turn the link on" still offered.
  const received = JSON.stringify([websiteUrl ?? null, state ?? null])
  const [lastReceived, setLastReceived] = useState(received)

  if (lastReceived !== received) {
    setLastReceived(received)
    setCurrent(state ?? null)

    if (refusal) {
      // The refusal was about the page as it was; it is read again now.
      setRefusal(null)
      setProblems([])
      setAnnouncement(`Read again. The website link is ${state?.enabled === true ? 'on' : 'off'}.`)
    }
  }

  const address = typeof websiteUrl === 'string' && websiteUrl !== '' ? websiteUrl : null
  const summary = administratorSummary(current, { websiteUrl: address })
  const enabled = current?.enabled === true
  const pending = current?.pending === true
  const decidedUrl = current?.decidedUrl ?? null
  const problem = current?.websiteProblem ?? null
  // Turning on is a change unless the link already goes to this address.
  const canTurnOn = Boolean(address) && !problem && (!enabled || decidedUrl !== address)
  const canTurnOff = enabled || pending
  const reasonId = `${ids}-reason`
  const checkedId = `${ids}-checked`

  /**
   * Send a decision.
   *
   * @param {boolean} turnOn On or off.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function decide(turnOn) {
    const text = reason.trim()
    /** @type {string[]} */
    const missing = []

    if (turnOn && !checked) missing.push('Tick the box to say you have looked at the address.')
    if (text.length < WEBSITE_LIMITS.reasonMin) {
      missing.push('Give a reason of at least 3 characters.')
    }

    setRefusal(null)
    setProblems(missing)

    if (missing.length > 0) return

    setBusy(true)

    try {
      const response = await apiFetch(
        `/v1/moderation/events/${encodeURIComponent(eventId)}/website-redirect`,
        {
          method: 'POST',
          body: JSON.stringify({ enabled: turnOn, reason: text, websiteUrl: address }),
        },
      )
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        setCurrent(body.data.redirect)
        setReason('')
        setChecked(false)
        setStepUp(null)
        setAnnouncement(
          body.data.redirect?.enabled ? 'The website link is on.' : 'The website link is off.',
        )
        router.refresh()
        return
      }

      const code = body?.error?.code ?? null

      if (code === 'STEP_UP_REQUIRED') {
        // The server decides when; asking before being told would be guessing.
        setStepUp(turnOn ? 'on' : 'off')
        return
      }

      const details = body?.error?.details ?? null

      setRefusal({
        code,
        title: code === 'WEBSITE_CHANGED' ? 'The address changed' : 'That did not work',
        message: body?.error?.message ?? 'The decision was refused. Nothing was changed.',
        // The address stored now, when the API named it (null: removed).
        currentWebsiteUrl:
          code === 'WEBSITE_CHANGED' && details && 'currentWebsiteUrl' in details
            ? details.currentWebsiteUrl
            : undefined,
      })
      setProblems(body?.error?.problems ?? [])
    } catch {
      setRefusal({
        code: null,
        title: 'That did not work',
        message: 'The service is not responding. Nothing was changed.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      id="website-link"
      aria-labelledby="website-link-heading"
      className="rounded-card border border-line bg-surface-raised p-4"
    >
      <h2 id="website-link-heading" className="text-lg font-semibold text-ink">
        Website link
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Whether this event’s public page shows “Visit the organiser’s website”. Only platform
        administrators turn it on or off, in any state of the event but deleted. Visitors go through
        an address at The Desi Events that counts the visit and then sends them to the address the
        link was turned on for.
      </p>

      <p role="status" aria-live="polite" className="mt-2 text-sm font-medium text-ink">
        {announcement}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant={summary.tone} srLabel="Website link:">
          {summary.label}
        </Badge>
        {pending ? <Badge variant="warning">Waiting for a decision</Badge> : null}
      </div>
      {summary.sentences.map((sentence) => (
        <p key={sentence} className="mt-2 text-sm text-ink-muted">
          {sentence}
        </p>
      ))}

      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="font-medium text-ink">The organiser’s address</dt>
          <dd>
            {address ? (
              <AddressLink href={address} />
            ) : (
              <span className="text-ink-muted">
                The organiser has not given a website address, so there is nothing to link to.
              </span>
            )}
          </dd>
        </div>
        {decidedUrl ? (
          <div>
            <dt className="font-medium text-ink">The address last decided on</dt>
            <dd>
              <AddressLink href={decidedUrl} />
            </dd>
          </div>
        ) : null}
        {pending && current?.submittedAt ? (
          <div>
            <dt className="font-medium text-ink">Waiting since</dt>
            <dd className="text-ink-muted">{formatDecisionInstant(current.submittedAt)}</dd>
          </div>
        ) : null}
      </dl>

      {problem ? (
        <Alert
          variant="warning"
          title="This address does not pass the address rules"
          className="mt-3"
        >
          <p>{problem} The link cannot be turned on until the organiser changes it.</p>
        </Alert>
      ) : null}

      {!pagePublic ? (
        <p className="mt-3 text-sm text-ink-muted">
          The link shows on the public page only while the event’s page is public.
        </p>
      ) : null}

      {deleted ? (
        <p className="mt-3 text-sm text-ink-muted">{DELETED_EVENT_FROZEN}</p>
      ) : !canDecide ? (
        <p className="mt-3 text-sm text-ink-muted">{CANNOT_DECIDE}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {refusal ? (
            <Alert variant="error" title={refusal.title}>
              <p>{refusal.message}</p>
              {refusal.currentWebsiteUrl === null ? (
                <p className="mt-1">The organiser removed the address.</p>
              ) : typeof refusal.currentWebsiteUrl === 'string' ? (
                <p className="mt-1 break-all">The address now: {refusal.currentWebsiteUrl}</p>
              ) : null}
              {RELOAD_CODES.has(refusal.code) ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => router.refresh()}
                >
                  Reload
                </Button>
              ) : null}
            </Alert>
          ) : null}

          {problems.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-status-danger">
              {problems.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          ) : null}

          {canTurnOn ? (
            <div className="flex items-start gap-2">
              <input
                id={checkedId}
                type="checkbox"
                checked={checked}
                onChange={(change) => setChecked(change.target.checked)}
                className="mt-1 size-4 accent-[var(--color-accent-strong)]"
              />
              <label htmlFor={checkedId} className="text-sm text-ink">
                {CHECKED_LABEL}
              </label>
            </div>
          ) : null}

          <FormField
            label="Reason"
            id={reasonId}
            required
            description="Shown to the organiser with your name, and recorded in the audit log."
          >
            <Textarea
              rows={3}
              maxLength={WEBSITE_LIMITS.reason}
              value={reason}
              onChange={(change) => setReason(change.target.value)}
            />
          </FormField>

          {stepUp ? (
            <StepUpPrompt
              action={`turn this website link ${stepUp}`}
              onConfirmed={() => {
                const turnOn = stepUp === 'on'

                setStepUp(null)
                decide(turnOn)
              }}
              onCancel={() => setStepUp(null)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy || !canTurnOn} onClick={() => decide(true)}>
                {enabled && address ? 'Approve the new address' : 'Turn the link on'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !canTurnOff}
                onClick={() => decide(false)}
              >
                Turn the link off
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
