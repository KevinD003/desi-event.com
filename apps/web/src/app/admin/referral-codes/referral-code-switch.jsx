'use client'

/**
 * Switching a referral code off, or back on (SPEC3 §12.5).
 *
 * Off takes an optional reason (10 to 500 characters when one is given, for the
 * records of the team at The Desi Events) and no second factor: it only takes something off
 * offer. On asks for one (PAYMENT_TERMS) when the server says so, and a code
 * whose expiry has passed is refused (`REFERRAL_CODE_EXPIRED`) with the API's
 * sentence: change its expiry first. Orders already placed keep their waiver
 * either way.
 *
 * Every outcome is said once: a success in the polite region beside the
 * button, a refusal in an alert that takes focus. The page is then read again
 * from the server, which draws the code as it now stands. Switching draws the
 * other button in place of the one pressed, so focus moves to it rather than
 * falling to the page; the second factor's prompt takes focus when it opens.
 *
 * @module app/admin/referral-codes/referral-code-switch
 */

import { REASON_DESCRIPTION, REASON_LIMITS, reasonSchema } from '@desi-event/schemas/payment-terms'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { STEP_UP_DECLINED_SENTENCE, useStepUpRetry } from '../../../components/step-up-retry.jsx'
import { Alert, Button, FormField, Textarea } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'

/** The switch-off reason's description (SPEC2-XI §0.8), and that it may be left empty. */
export const SWITCH_OFF_REASON_HINT = `${REASON_DESCRIPTION} You may leave it empty; when you give one, at least 10 characters.`

/** What switching off says once it is done. */
export const SWITCHED_OFF =
  'Referral code switched off. Orders already placed with it keep their waiver.'

/** What switching on says once it is done. */
export const SWITCHED_ON = 'Referral code switched on.'

/**
 * @typedef {object} ReferralCodeSwitchProps
 * @property {{id: string, active: boolean}} code The code.
 */

/**
 * The switch.
 *
 * @param {ReferralCodeSwitchProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function ReferralCodeSwitch({ code }) {
  const router = useRouter()
  const id = useId()
  const focusAfterRender = useFocusAfterRender()
  const [active, setActive] = useState(code.active)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const refusalRef = useRef(null)
  const reasonRef = useRef(null)
  const offRef = useRef(null)
  const onRef = useRef(null)
  const stepUp = useStepUpRetry({
    action: 'switch this referral code on',
    takeFocus: true,
    onDeclined: () => {
      setRefusal(STEP_UP_DECLINED_SENTENCE)
      focusAfterRender(refusalRef)
    },
  })

  /**
   * Send the switch.
   *
   * @param {'switch-off'|'switch-on'} action Which way.
   * @param {object|null} body The body, for switching off.
   * @returns {Promise<object|null>} The code as it now stands, or null.
   */
  async function send(action, body) {
    setBusy(true)
    setRefusal(null)

    try {
      const response = await apiFetch(
        `/v1/platform/referral-codes/${encodeURIComponent(code.id)}/${action}`,
        { method: 'POST', body: JSON.stringify(body ?? {}) },
      )
      const parsed = await response.json().catch(() => null)

      if (response.ok && parsed?.data) return parsed.data

      const retried = stepUp.refused(parsed, () => send(action, body))

      if (retried) return retried

      setRefusal(
        refusalSentence(
          response.status,
          parsed,
          'The code was not changed.',
          parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
        ),
      )
      focusAfterRender(refusalRef)
      return null
    } catch {
      setRefusal('The service is not responding. The code was not changed.')
      focusAfterRender(refusalRef)
      return null
    } finally {
      setBusy(false)
    }
  }

  /**
   * Switch the code off.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves once the attempt is over.
   */
  async function switchOff(submitted) {
    submitted.preventDefault()
    setSaid('')

    const text = reason.trim()

    if (text) {
      const parsed = reasonSchema.safeParse(text)

      if (!parsed.success) {
        setReasonError(
          parsed.error.issues[0]?.message ?? 'Give a reason of at least 10 characters.',
        )
        focusAfterRender(reasonRef)
        return
      }
    }

    setReasonError(null)

    const answered = await send('switch-off', text ? { reason: text } : {})

    if (answered) {
      setActive(answered.active)
      setReason('')
      setSaid(SWITCHED_OFF)
      focusAfterRender(answered.active ? offRef : onRef)
      router.refresh()
    }
  }

  /**
   * Switch the code back on.
   *
   * @returns {Promise<void>} Resolves once the attempt is over.
   */
  async function switchOn() {
    setSaid('')

    const answered = await send('switch-on', null)

    if (answered) {
      setActive(answered.active)
      setSaid(SWITCHED_ON)
      focusAfterRender(answered.active ? offRef : onRef)
      router.refresh()
    }
  }

  return (
    <div className="space-y-4">
      {refusal ? (
        <div ref={refusalRef} tabIndex={-1} className="focus-visible:outline-none">
          <Alert variant="error" title="The code was not changed">
            <p>{refusal}</p>
          </Alert>
        </div>
      ) : null}

      {active ? (
        <form onSubmit={switchOff} noValidate className="max-w-2xl space-y-3">
          <FormField
            label="Reason (optional)"
            id={`${id}-reason`}
            description={`${SWITCH_OFF_REASON_HINT} ${reason.trim().length.toLocaleString('en-US')} of ${REASON_LIMITS.max.toLocaleString('en-US')} characters.`}
            {...(reasonError ? { error: reasonError } : {})}
          >
            <Textarea
              ref={reasonRef}
              rows={2}
              maxLength={REASON_LIMITS.max + 50}
              value={reason}
              disabled={busy}
              onChange={(changed) => setReason(changed.target.value)}
            />
          </FormField>
          <Button ref={offRef} type="submit" variant="secondary" loading={busy} disabled={busy}>
            Switch off
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          {stepUp.prompt}
          <Button
            ref={onRef}
            type="button"
            onClick={switchOn}
            loading={busy}
            disabled={busy || stepUp.waiting}
          >
            Switch on
          </Button>
        </div>
      )}

      {/* One region for both ways, so the sentence is said although the
          button beside it changed. */}
      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-ink">
        {said}
      </p>
    </div>
  )
}
