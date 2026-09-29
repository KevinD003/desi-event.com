'use client'

/**
 * Putting one account into an organisation, with a role.
 *
 * `POST /v1/platform/organizations/:id/members` with the account, the role and
 * a reason. It exists above all for an organisation whose only owner has left
 * and which nobody can now manage, so every role is on offer, owner included;
 * the organisation search says how many owners each result has, and "No owner"
 * is the case to look for.
 *
 * Organisations are found with `GET /v1/platform/organizations?q=`. Their
 * names are public, so unlike the account search the terms may travel in the
 * request's address.
 *
 * The API decides the rest inside its transaction: it refuses a suspended
 * account, a role the account already holds there, and demoting the last
 * owner. It ends every session the account holds, and this panel says so
 * before anything is saved. The route needs a recent second factor, so
 * `STEP_UP_REQUIRED` draws {@link StepUpPrompt} and the request is sent again
 * after.
 *
 * @module app/admin/users/grant-membership
 */

import Link from 'next/link'
import { useId, useRef, useState } from 'react'

import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { Alert, Button, FormField, Input, Select, Textarea } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { verificationReading } from '../../../lib/organization-vocabulary.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import { ROLE_DESCRIPTIONS, roleLabel } from '../../organizer/team/team-vocabulary.js'
import {
  GRANTABLE_ORG_ROLES,
  PRIVILEGED_ORG_ROLES,
  REASON_LIMITS,
} from './platform-role-vocabulary.js'

/** The shortest organisation search the API accepts. */
const QUERY_MIN = 2

/** The frame of the open panel. */
const PANEL =
  'mt-3 rounded-card border border-line-strong bg-surface p-4 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * What a refused request should say.
 *
 * @param {Response} response The refused response.
 * @param {object|null} body Its parsed body.
 * @param {string} fallback What to say when the API said nothing usable.
 * @returns {{sentence: string, enrol: boolean}} The sentence, and whether enrolment is the way forward.
 */
function refusedBecause(response, body, fallback) {
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

    return { sentence: describeApiRefusal({ status: 429, retryAfterSeconds }).detail, enrol: false }
  }

  return {
    sentence: refusalSentence(response.status, body, fallback),
    enrol: body?.error?.code === 'MFA_ENROLMENT_REQUIRED',
  }
}

/**
 * @typedef {object} GrantMembershipProps
 * @property {object} account The account, as the search answers it.
 * @property {Function} onChanged Called once the API has made the grant.
 */

/**
 * The control and its panel.
 *
 * @param {GrantMembershipProps} props Component props.
 * @returns {JSX.Element} The rendered control.
 */
export function GrantMembership({ account, onChanged }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [terms, setTerms] = useState('')
  const [searching, setSearching] = useState(false)
  const [organizations, setOrganizations] = useState(null)
  const [chosenId, setChosenId] = useState('')
  const [role, setRole] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [outcome, setOutcome] = useState('')
  const [found, setFound] = useState('')
  const panelRef = useRef(null)
  const openerRef = useRef(null)

  const name = account.displayName
  const trimmedTerms = terms.trim()
  const trimmedReason = reason.trim()
  const reasonValid =
    trimmedReason.length >= REASON_LIMITS.min && trimmedReason.length <= REASON_LIMITS.max
  const chosen = (organizations ?? []).find((organization) => organization.id === chosenId) ?? null
  const current = chosen
    ? (account.memberships.find((membership) => membership.organizationId === chosen.id) ?? null)
    : null
  const needsFactor = PRIVILEGED_ORG_ROLES.includes(role) && !account.mfaEnrolled
  const ready = Boolean(chosen) && role !== '' && role !== current?.role && reasonValid

  // The API refuses a super administrator's own account here (403), so the
  // control is shown disabled with the reason rather than offered to fail.
  if (account.self) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-ink">Organisation membership</h3>
        <Button
          type="button"
          variant="secondary"
          className="mt-2 min-h-11"
          disabled
          aria-describedby={`${id}-self`}
        >
          Put {name} into an organisation
        </Button>
        <p id={`${id}-self`} className="mt-2 text-sm text-ink-muted">
          This is your own account. Another super administrator must give you a role in an
          organisation.
        </p>
      </div>
    )
  }

  if (account.suspended) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-ink">Organisation membership</h3>
        <p className="mt-2 text-sm text-ink-muted">
          This account is suspended. Lift the suspension before giving it a role in an organisation.
        </p>
      </div>
    )
  }

  /**
   * Close the panel and put focus back on the control that opened it.
   *
   * @returns {void}
   */
  function close() {
    setOpen(false)
    setRefused(null)
    setStepUp(false)
    queueMicrotask(() => openerRef.current?.focus())
  }

  /**
   * Find organisations by name.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function findOrganizations(submitted) {
    submitted.preventDefault()

    if (trimmedTerms.length < QUERY_MIN) return

    setSearching(true)
    setRefused(null)
    setChosenId('')

    try {
      const response = await apiFetch(
        `/v1/platform/organizations?${new URLSearchParams({ q: trimmedTerms, perPage: '20' })}`,
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        const list = Array.isArray(body?.data) ? body.data : []

        setOrganizations(list)
        setFound(
          list.length === 0
            ? 'No organisation matches that name.'
            : list.length === 1
              ? 'One organisation found.'
              : `${list.length} organisations found.`,
        )
        return
      }

      setRefused(refusedBecause(response, body, 'The search was refused.'))
    } catch {
      setRefused({ sentence: describeApiRefusal(null).detail, enrol: false })
    } finally {
      setSearching(false)
    }
  }

  /**
   * Make the grant.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    if (!chosen) return

    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(
        `/v1/platform/organizations/${encodeURIComponent(chosen.id)}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ userId: account.id, role, reason: trimmedReason }),
        },
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        setOpen(false)
        setOutcome(
          `${name} is now ${roleLabel(role).toLowerCase()} of ${chosen.name}. They are signed out everywhere and sign in again with it.`,
        )
        queueMicrotask(() => openerRef.current?.focus())
        await onChanged?.()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefused(refusedBecause(response, body, 'The grant was refused.'))
      queueMicrotask(() => panelRef.current?.focus())
    } catch {
      setRefused({ sentence: describeApiRefusal(null).detail, enrol: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">Organisation membership</h3>
      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        {outcome}
      </p>

      {open ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-heading`}
          className={PANEL}
        >
          <h4 id={`${id}-heading`} className="font-semibold text-ink">
            Put {name} into an organisation
          </h4>

          <form
            onSubmit={findOrganizations}
            noValidate
            aria-label="Find an organisation"
            className="mt-3"
          >
            <FormField
              label="Organisation name or web address"
              id={`${id}-org`}
              required
              description="At least two characters."
            >
              <Input
                type="search"
                autoComplete="off"
                value={terms}
                onChange={(changed) => setTerms(changed.target.value)}
              />
            </FormField>
            <Button
              type="submit"
              variant="secondary"
              className="mt-2 min-h-11"
              disabled={searching || trimmedTerms.length < QUERY_MIN}
            >
              {searching ? 'Finding…' : 'Find organisations'}
            </Button>
          </form>

          <p role="status" aria-live="polite" className="mt-2 text-sm text-ink-muted">
            {found}
          </p>

          {organizations && organizations.length > 0 ? (
            <fieldset className="mt-2">
              <legend className="text-sm font-medium text-ink">Organisation</legend>
              <ul className="mt-1 space-y-1">
                {organizations.map((organization) => (
                  <li key={organization.id}>
                    <label className="flex min-h-11 items-start gap-2 text-sm text-ink">
                      <input
                        type="radio"
                        name={`${id}-organization`}
                        value={organization.id}
                        checked={chosenId === organization.id}
                        onChange={() => setChosenId(organization.id)}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium">{organization.name}</span>
                        <span className="block text-ink-muted">
                          {verificationReading(organization.verificationStatus).label} ·{' '}
                          {memberWords(organization.memberCount)} · {ownerWords(organization)}
                          {organization.suspended ? ' · Suspended' : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {chosen ? (
            <>
              <div className="mt-3">
                <FormField
                  label={`Role in ${chosen.name}`}
                  id={`${id}-role`}
                  required
                  description={
                    current
                      ? `${name} is ${roleLabel(current.role).toLowerCase()} there now.`
                      : `${name} is not a member there.`
                  }
                >
                  <Select value={role} onChange={(changed) => setRole(changed.target.value)}>
                    <option value="">Choose a role</option>
                    {GRANTABLE_ORG_ROLES.map((option) => (
                      <option key={option} value={option} disabled={option === current?.role}>
                        {roleLabel(option)}
                        {option === current?.role ? ' (now)' : ''}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {role ? (
                  <p className="mt-2 text-sm text-ink-muted">{ROLE_DESCRIPTIONS[role] ?? ''}</p>
                ) : null}
              </div>

              <div className="mt-3">
                <FormField
                  label="Reason"
                  id={`${id}-reason`}
                  required
                  description={`Kept on the audit record. ${REASON_LIMITS.min} to ${REASON_LIMITS.max} characters.`}
                >
                  <Textarea
                    rows={2}
                    maxLength={REASON_LIMITS.max}
                    value={reason}
                    onChange={(changed) => setReason(changed.target.value)}
                  />
                </FormField>
              </div>

              <p className="mt-3 text-sm text-ink">
                Saving signs {name} out everywhere, so they sign in again with the new role.
                {role === 'OWNER'
                  ? ` As an owner they can manage ${chosen.name} fully, including who else is on its team.`
                  : ''}
                {needsFactor
                  ? ` This role needs two-step sign-in, which ${name} has not set up: they will be asked to before they can work in it.`
                  : ''}
              </p>
            </>
          ) : null}

          {refused ? (
            <div className="mt-3">
              <Alert variant="error" title="Nothing was changed">
                <p>{refused.sentence}</p>
                {refused.enrol ? (
                  <p className="mt-2">
                    <Link
                      href="/account/security"
                      className="rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    >
                      Set up two-step sign-in
                    </Link>
                  </p>
                ) : null}
              </Alert>
            </div>
          ) : null}

          {stepUp ? (
            <div className="mt-3">
              <StepUpPrompt
                action={`give ${name} a role in ${chosen?.name ?? 'the organisation'}`}
                onConfirmed={() => {
                  setStepUp(false)
                  void send()
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" disabled={busy || !ready} onClick={send}>
              {busy ? 'Saving…' : 'Give them the role'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          ref={openerRef}
          type="button"
          variant="secondary"
          className="mt-2 min-h-11"
          aria-label={`Put ${name} into an organisation`}
          onClick={() => {
            setTerms('')
            setOrganizations(null)
            setChosenId('')
            setRole('')
            setReason('')
            setFound('')
            setRefused(null)
            setStepUp(false)
            setOutcome('')
            setOpen(true)
            queueMicrotask(() => panelRef.current?.focus())
          }}
        >
          Add to an organisation
        </Button>
      )}
    </div>
  )
}

/**
 * A member count in words.
 *
 * @param {number} count The count.
 * @returns {string} The words.
 */
function memberWords(count) {
  return count === 1 ? '1 member' : `${count} members`
}

/**
 * An owner count in words, with the case the grant exists for said plainly.
 *
 * @param {{ownerCount: number}} organization The organisation.
 * @returns {string} The words.
 */
function ownerWords(organization) {
  if (organization.ownerCount === 0) return 'No owner'

  return organization.ownerCount === 1 ? '1 owner' : `${organization.ownerCount} owners`
}
