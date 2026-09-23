/**
 * What a session may do, asked without touching the request.
 *
 * Pure functions of the payload `GET /v1/auth/me` returned. They lived in
 * `lib/session.js` beside `readSession`, which imports `next/headers`; that
 * made every one of them server-only by association, so no client component
 * could ask even "is this entry for me?". Split out, the layouts, the
 * navigation and a client control all ask the same question the same way.
 *
 * None of this is authorisation. The API decides every request again; these
 * decide only what a screen offers, so nobody is shown a door that will not
 * open for them.
 *
 * @module lib/capabilities
 */

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
 * The memberships that hold a capability in their own right.
 *
 * Membership-scoped, with no platform shortcut: the question is "which of my
 * organisations can I do this in", and a platform role is not an organisation.
 *
 * @param {object|null} session The session payload.
 * @param {string} capability The capability name.
 * @returns {Array<{organizationId: string, organizationName: string|null, role: string}>} The memberships.
 */
export function membershipsWith(session, capability) {
  return (session?.memberships ?? [])
    .filter((membership) => (membership.capabilities ?? []).includes(capability))
    .map((membership) => ({
      organizationId: membership.organizationId,
      organizationName: membership.organizationName ?? null,
      role: membership.role,
    }))
}
