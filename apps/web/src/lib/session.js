/**
 * Reading the signed-in actor, on the server.
 *
 * Every organiser screen needs to know two things before it renders anything:
 * who this is, and what they may do. Both answers come from the API — never
 * from a cookie this application parses itself, and never from anything the
 * browser sent as a claim.
 *
 * That is the whole rule here. A session cookie is an opaque bearer secret to
 * this application; it forwards it and believes the answer. Decoding it locally
 * to save a request would mean the web app deciding who somebody is, which is
 * the API's job and the only place it can be done safely.
 *
 * @module lib/session
 */

import { cookies, headers } from 'next/headers'

import { getApiBaseUrl } from './api-client.js'

/** How long a session read may take before a screen gives up on it. */
const TIMEOUT_MS = 2500

/**
 * The current session: who this is, what they may do, and where.
 *
 * Returns null for every failure — no session, an expired one, an API that is
 * not answering — because every one of them means the same thing to a screen:
 * this person is not signed in, send them to sign in. Distinguishing them here
 * would only tempt a caller into rendering something for a case it cannot
 * actually serve.
 *
 * @returns {Promise<object|null>} The session payload, or null when there is none.
 */
export async function readSession() {
  const jar = await cookies()
  const cookieHeader = jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')

  if (!cookieHeader) return null

  try {
    const response = await fetch(`${getApiBaseUrl()}/v1/auth/me`, {
      headers: { cookie: cookieHeader, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })

    if (!response.ok) return null

    const body = await response.json()

    return body?.data ?? null
  } catch {
    return null
  }
}

/**
 * Whether this session holds a capability, optionally in one organisation.
 *
 * Used only to decide what a screen *offers*. Every action is authorised again
 * by the API, which is the check that counts — this one exists so a person is
 * not shown a button that will refuse them, not to keep anybody out.
 *
 * @param {object|null} session The session payload from {@link readSession}.
 * @param {string} capability The capability name.
 * @param {string} [organizationId] The organisation to check it in.
 * @returns {boolean} True when the session holds it.
 */
export function sessionCan(session, capability, organizationId) {
  if (!session) return false

  if (!organizationId) return (session.capabilities ?? []).includes(capability)

  const membership = (session.memberships ?? []).find(
    (candidate) => candidate.organizationId === organizationId,
  )

  return (
    (membership?.capabilities ?? []).includes(capability) ||
    (session.capabilities ?? []).includes('platform:admin')
  )
}

/**
 * The organisations this session may run privacy erasures in.
 *
 * Membership-scoped on purpose. `privacy:redact` is an organisation capability
 * held by OWNER alone, so asking the unscoped platform question would refuse
 * every owner and pass every platform administrator — backwards, in the one
 * area where being wrong erases somebody. The API authorises again, per
 * organisation, with a step-up window on top; this only decides what the screens
 * offer.
 *
 * @param {object|null} session The session payload.
 * @returns {Array<{organizationId: string, organizationName: string|null, role: string}>} The memberships.
 */
export function privacyOrganizations(session) {
  return (session?.memberships ?? [])
    .filter((membership) => (membership.capabilities ?? []).includes('privacy:redact'))
    .map((membership) => ({
      organizationId: membership.organizationId,
      organizationName: membership.organizationName ?? null,
      role: membership.role,
    }))
}

/**
 * The organisations this session may manage payout setup in.
 *
 * Membership-scoped for the reason `privacyOrganizations` gives, and the set is
 * wider than it looks: `connect:manage` is granted to FINANCE and inherited by
 * ADMIN and OWNER, so filtering on the capability rather than on a role is what
 * keeps an owner from being locked out of a screen they are the natural person
 * to use.
 *
 * This only decides what the screens offer. The API authorises again, per
 * organisation, with a step-up window on top.
 *
 * @param {object|null} session The session payload.
 * @returns {Array<{organizationId: string, organizationName: string|null, role: string}>} The memberships.
 */
export function connectOrganizations(session) {
  return (session?.memberships ?? [])
    .filter((membership) => (membership.capabilities ?? []).includes('connect:manage'))
    .map((membership) => ({
      organizationId: membership.organizationId,
      organizationName: membership.organizationName ?? null,
      role: membership.role,
    }))
}

/**
 * The organisations this session may author venues in.
 *
 * @param {object|null} session The session payload.
 * @returns {Array<{organizationId: string, organizationName: string|null, role: string}>} The memberships.
 */
export function authoringOrganizations(session) {
  return (session?.memberships ?? [])
    .filter((membership) => (membership.capabilities ?? []).includes('venue:manage'))
    .map((membership) => ({
      organizationId: membership.organizationId,
      organizationName: membership.organizationName ?? null,
      role: membership.role,
    }))
}

/**
 * The organisations this person may create an event in.
 *
 * Separate from {@link authoringOrganizations}, which asks about venues: the
 * two capabilities are genuinely different, and somebody who can add a hall is
 * not thereby somebody who can put an event on in it.
 *
 * Only decides what a screen *offers*. The API authorises the create again.
 *
 * @param {object|null} session The session as `GET /v1/auth/me` returned it.
 * @returns {Array<{organizationId: string, organizationName: string|null, role: string}>} The organisations.
 */
export function eventOrganizations(session) {
  return (session?.memberships ?? [])
    .filter((membership) => (membership.capabilities ?? []).includes('event:create'))
    .map((membership) => ({
      organizationId: membership.organizationId,
      organizationName: membership.organizationName ?? null,
      role: membership.role,
    }))
}

/**
 * The absolute origin this request arrived on.
 *
 * Used to build the same-origin API URL for a server-side read, so a screen
 * rendered behind a proxy still talks to itself rather than to a hard-coded
 * host.
 *
 * @returns {Promise<string>} The origin.
 */
export async function requestOrigin() {
  const list = await headers()
  const host = list.get('x-forwarded-host') ?? list.get('host') ?? '127.0.0.1:3000'
  const protocol = list.get('x-forwarded-proto') ?? 'http'

  return `${protocol}://${host}`
}
