'use client'

/**
 * Finding an account, and what can be done to it.
 *
 * ## The search travels in a request body, never in a web address
 *
 * `POST /v1/platform/users/search` with `{ q }`. A search for an email
 * address is itself personal data, and a web address is the one place a
 * browser, a proxy and an access log all keep. So this is a form that posts,
 * not a link with a query string, and the terms are held in this component's
 * memory alone — not in the address bar and not in browser storage. Reloading
 * the page forgets them, which is the point.
 *
 * ## What is shown per account
 *
 * The name, the address, the platform role in words, whether the account is
 * suspended, whether it has a second factor, and every organisation it belongs
 * to with its role there. Under each, the two changes this screen makes:
 * {@link PlatformRoleChange} and {@link GrantMembership}. The caller's own row
 * carries `self`, and neither its role nor its memberships can be changed from
 * here — the API refuses both too.
 *
 * After a change the same search is sent again, so the row shows what the
 * API now holds rather than what this screen guessed.
 *
 * @module app/admin/users/user-search
 */

import { useId, useRef, useState } from 'react'

import { Alert, Badge, Button, FormField, Input } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import { roleLabel } from '../../organizer/team/team-vocabulary.js'
import { GrantMembership } from './grant-membership.jsx'
import { PlatformRoleChange } from './platform-role-change.jsx'
import { PRIVILEGED_PLATFORM_ROLES, platformRoleLabel } from './platform-role-vocabulary.js'

/** The shortest search the API accepts. */
const QUERY_MIN = 3

/** How many accounts one page of results holds. */
const PER_PAGE = 20

/**
 * @typedef {object} Found
 * @property {object[]} accounts The accounts on this page.
 * @property {object} pagination The API's pagination block.
 * @property {string} terms What was searched for.
 */

/**
 * The search, and the accounts it found.
 *
 * @returns {JSX.Element} The rendered search.
 */
export function UserSearch() {
  const id = useId()
  const [terms, setTerms] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState(/** @type {Found|null} */ (null))
  const [refused, setRefused] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const refusalRef = useRef(null)

  const trimmed = terms.trim()

  /**
   * Ask the API.
   *
   * @param {string} query What to search for.
   * @param {number} page Which page.
   * @param {boolean} quiet Whether to leave the announcement as it is (a refresh after a change).
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function search(query, page, quiet = false) {
    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch('/v1/platform/users/search', {
        method: 'POST',
        body: JSON.stringify({ q: query, page, perPage: PER_PAGE }),
      })
      const body = await response.json().catch(() => null)

      if (response.ok) {
        const accounts = Array.isArray(body?.data) ? body.data : []
        const pagination = body?.pagination ?? null

        setFound({ accounts, pagination, terms: query })

        if (!quiet) setAnnouncement(countSentence(pagination?.total ?? accounts.length))
        return
      }

      const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

      setRefused(
        response.status === 429
          ? describeApiRefusal({ status: 429, retryAfterSeconds }).detail
          : refusalSentence(response.status, body, 'The search was refused.'),
      )
      queueMicrotask(() => refusalRef.current?.focus())
    } catch {
      setRefused(describeApiRefusal(null).detail)
      queueMicrotask(() => refusalRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  /**
   * Send the search.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function onSubmit(submitted) {
    submitted.preventDefault()

    if (trimmed.length < QUERY_MIN) return

    await search(trimmed, 1)
  }

  /**
   * Read the current page again after a change, so each row is what the API holds.
   *
   * @returns {Promise<void>} Resolves when read.
   */
  async function reread() {
    if (found) await search(found.terms, found.pagination?.page ?? 1, true)
  }

  return (
    <div className="mt-8">
      <form onSubmit={onSubmit} noValidate aria-label="Find an account" className="max-w-xl">
        <FormField
          label="Email address, name or account id"
          id={`${id}-q`}
          required
          description="At least three characters. The search is sent in the request, never in the address bar, and is forgotten when you leave."
        >
          <Input
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={terms}
            onChange={(changed) => setTerms(changed.target.value)}
          />
        </FormField>
        <div className="mt-4">
          <Button type="submit" className="min-h-11" disabled={busy || trimmed.length < QUERY_MIN}>
            {busy ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </form>

      <p role="status" aria-live="polite" className="mt-4 text-sm text-ink-muted">
        {announcement}
      </p>

      {refused ? (
        <div ref={refusalRef} tabIndex={-1} className="mt-3 max-w-xl focus-visible:outline-none">
          <Alert variant="error" title="The search did not run">
            <p>{refused}</p>
          </Alert>
        </div>
      ) : null}

      {found && found.accounts.length > 0 ? (
        <>
          <ul className="mt-4 space-y-4" aria-label="Accounts found">
            {found.accounts.map((account) => (
              <li key={account.id}>
                <AccountCard account={account} onChanged={reread} />
              </li>
            ))}
          </ul>
          <Pager
            pagination={found.pagination}
            busy={busy}
            onPage={(page) => search(found.terms, page)}
          />
        </>
      ) : null}
    </div>
  )
}

/**
 * How many accounts were found, in words.
 *
 * @param {number} total The count.
 * @returns {string} The sentence.
 */
function countSentence(total) {
  if (total === 0) return 'No account matches that search.'
  if (total === 1) return 'One account found.'

  return `${total} accounts found.`
}

/**
 * @typedef {object} AccountCardProps
 * @property {object} account One account as the search answers it.
 * @property {Function} onChanged Called after a change, to read the account again.
 */

/**
 * One account, and the changes that can be made to it.
 *
 * @param {AccountCardProps} props Component props.
 * @returns {JSX.Element} The card.
 */
function AccountCard({ account, onChanged }) {
  const headingId = useId()
  const privileged = PRIVILEGED_PLATFORM_ROLES.includes(account.role)

  return (
    <article
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface-raised p-5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold text-ink">
          {account.displayName}
          {account.self ? <span className="ml-2 text-sm text-ink-muted">(you)</span> : null}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant={privileged ? 'info' : 'neutral'} srLabel="Platform role:">
            {platformRoleLabel(account.role)}
          </Badge>
          {account.suspended ? <Badge variant="danger">Suspended</Badge> : null}
        </div>
      </div>
      <p className="mt-1 text-sm break-all text-ink-muted">{account.email}</p>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-ink">Two-step sign-in</dt>
        <dd className="text-ink-muted">
          {account.mfaEnrolled
            ? 'Set up'
            : privileged
              ? 'Not set up — this role cannot work until it is'
              : 'Not set up'}
        </dd>
        <dt className="font-medium text-ink">Account id</dt>
        <dd className="font-mono text-ink-muted">{account.id}</dd>
      </dl>

      <h3 className="mt-4 text-sm font-semibold text-ink">Organisations</h3>
      {account.memberships.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">None.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm text-ink-muted">
          {account.memberships.map((membership) => (
            <li key={membership.organizationId}>
              {membership.organizationName ?? membership.organizationId} ·{' '}
              {roleLabel(membership.role)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PlatformRoleChange account={account} onChanged={onChanged} />
        <GrantMembership account={account} onChanged={onChanged} />
      </div>
    </article>
  )
}

/**
 * @typedef {object} PagerProps
 * @property {object|null} pagination The API's pagination block.
 * @property {boolean} busy Whether a search is in flight.
 * @property {Function} onPage Called with the page to read.
 */

/**
 * Previous and next, when there is more than one page.
 *
 * @param {PagerProps} props Component props.
 * @returns {JSX.Element|null} The pager.
 */
function Pager({ pagination, busy, onPage }) {
  if (!pagination || pagination.totalPages <= 1) return null

  return (
    <nav aria-label="Result pages" className="mt-4 flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        disabled={busy || !pagination.hasPreviousPage}
        onClick={() => onPage(pagination.page - 1)}
      >
        Previous page
      </Button>
      <span className="text-sm text-ink-muted">
        Page {pagination.page} of {pagination.totalPages}
      </span>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        disabled={busy || !pagination.hasNextPage}
        onClick={() => onPage(pagination.page + 1)}
      >
        Next page
      </Button>
    </nav>
  )
}
