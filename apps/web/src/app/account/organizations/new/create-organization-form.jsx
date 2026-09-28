'use client'

/**
 * The form that creates an organisation.
 *
 * `POST /v1/organizations` with a name, a time zone, and optionally a web
 * address for its public page, a description and its website. Nothing else is
 * sent: the platform sets the verification state, the currency it is paid in
 * and its contact address itself, and this form has no field for any of them.
 *
 * Creating one makes the account an owner. When that account has no second
 * factor yet, every workspace page would refuse it, so the success panel sends
 * it to set one up first; otherwise to the new organisation's page.
 *
 * @file app/account/organizations/new/create-organization-form.jsx
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { Alert, Button, FormField, Input, Select, Textarea } from '../../../../components/ui.jsx'
import { apiFetch } from '../../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../../lib/refusal.js'
import { US_TIMEZONE_OPTIONS } from '../../../../lib/organization-vocabulary.js'

/** The longest description the API accepts. */
const DESCRIPTION_MAX = 2000

/**
 * Said when the name makes no web address and none was typed.
 *
 * The API's refusal names its `slug` field; this form calls that field the web
 * address, so the sentence does too.
 */
export const NO_ADDRESS_FROM_NAME =
  'We could not make a web address from that name, because it has no letters from A to Z or digits. Type one in the web address field.'

/** A link that reads as a link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * The create form.
 *
 * @returns {JSX.Element} The form, or what it created.
 */
export function CreateOrganizationForm() {
  const router = useRouter()
  const id = useId()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [timezone, setTimezone] = useState(US_TIMEZONE_OPTIONS[0].value)
  const [description, setDescription] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [created, setCreated] = useState(null)
  const [refusals, setRefusals] = useState(0)
  const refusalRef = useRef(null)
  const createdRef = useRef(null)

  // Focus goes to what replaced the form, and to each refusal, once they are
  // on screen: after the commit, not before it. Refusals are counted, so the
  // same sentence twice in a row is announced twice.
  useEffect(() => {
    if (created) createdRef.current?.focus()
  }, [created])

  useEffect(() => {
    if (refusals > 0) refusalRef.current?.focus()
  }, [refusals])

  /**
   * Send it.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function onSubmit(submitted) {
    submitted.preventDefault()
    setBusy(true)
    setRefused(null)

    // Only the fields the API takes from a person, and only those filled in.
    const body = {
      name: name.trim(),
      timezone,
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(websiteUrl.trim() ? { websiteUrl: websiteUrl.trim() } : {}),
    }

    try {
      const response = await apiFetch('/v1/organizations', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setCreated(parsed?.data ?? {})
        router.refresh()
        return
      }

      const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

      // The one 422 creation gives: no web address could be made from the
      // name, and none was typed.
      const noAddress = response.status === 422 && !body.slug

      setRefused(
        noAddress
          ? NO_ADDRESS_FROM_NAME
          : refusalSentence(
              response.status,
              parsed,
              'The organisation was not created.',
              retryAfterSeconds,
            ),
      )
      setRefusals((count) => count + 1)
    } catch {
      setRefused(describeApiRefusal(null).detail)
      setRefusals((count) => count + 1)
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    const needsFactor = Boolean(created.session?.mfaRequired && !created.session?.mfaEnrolled)
    const organizationPage = `/organizer/organization?organizationId=${encodeURIComponent(created.id ?? '')}`

    return (
      <div ref={createdRef} tabIndex={-1} className="mt-6 max-w-xl focus-visible:outline-none">
        <Alert variant="success" title={`${created.name ?? 'Your organisation'} exists`}>
          <p>
            You are its owner. It is unverified: draft your first event whenever you like, and ask
            for verification from its organisation page when you are ready to publish.
          </p>
          {needsFactor ? (
            <p className="mt-2">
              Owners must use two-step sign-in, and the workspace will not open for this account
              until it is set up.{' '}
              <Link href="/account/security" className={LINK}>
                Set up two-step sign-in
              </Link>
            </p>
          ) : (
            <p className="mt-2">
              <Link href={organizationPage} className={LINK}>
                Open its organisation page
              </Link>
            </p>
          )}
        </Alert>
      </div>
    )
  }

  const nameLength = name.trim().length

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mt-6 max-w-xl"
      aria-label="Create an organisation"
    >
      {refused ? (
        <div ref={refusalRef} tabIndex={-1} className="mb-3 focus-visible:outline-none">
          <Alert variant="error" title="Nothing was created">
            <p>{refused}</p>
          </Alert>
        </div>
      ) : null}

      <FormField
        label="Name"
        id={`${id}-name`}
        required
        description="As people will see it on its public page. Between 2 and 120 characters, and not an email address."
      >
        <Input
          type="text"
          autoComplete="organization"
          maxLength={120}
          value={name}
          onChange={(changed) => setName(changed.target.value)}
        />
      </FormField>

      <div className="mt-4">
        <FormField
          label="Time zone"
          id={`${id}-timezone`}
          description="Where its events mostly happen. Its public page shows the dates and times of its events in this zone; each event still sets its own."
        >
          <Select value={timezone} onChange={(changed) => setTimezone(changed.target.value)}>
            {US_TIMEZONE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="mt-4">
        <FormField
          label="Web address on this site (optional)"
          id={`${id}-slug`}
          description="Lower-case words joined by hyphens, as in bay-lights-garba. Left empty, one is made from the name."
        >
          <Input
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={140}
            value={slug}
            onChange={(changed) => setSlug(changed.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <FormField
          label="About it (optional)"
          id={`${id}-description`}
          description={`Up to ${DESCRIPTION_MAX} characters, shown on its public page.`}
        >
          <Textarea
            rows={4}
            maxLength={DESCRIPTION_MAX}
            value={description}
            onChange={(changed) => setDescription(changed.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <FormField
          label="Its website (optional)"
          id={`${id}-website`}
          description="A full address starting with https://."
        >
          <Input
            type="url"
            autoComplete="url"
            value={websiteUrl}
            onChange={(changed) => setWebsiteUrl(changed.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-6">
        <Button
          type="submit"
          className="min-h-11"
          disabled={busy || nameLength < 2 || nameLength > 120}
        >
          {busy ? 'Creating…' : 'Create the organisation'}
        </Button>
      </div>
    </form>
  )
}
