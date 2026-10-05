/**
 * What a reviewer is told when somebody else on the Desi-Event team has to
 * decide.
 *
 * A reviewer who belongs to an organisation does not decide on its events,
 * its pictures or its verification, and nobody decides on an event they sent
 * for review themselves: the API refuses both (`CONFLICT_OF_INTEREST`,
 * `SELF_REVIEW`). The review pages know the first from the session, and say
 * this in place of the decision controls.
 *
 * A plain module, not a client one, so the server pages that decide whether
 * to say it and the client components that draw it read the same string.
 *
 * @module lib/review-independence
 */

/** What a reviewer who belongs to the organisation is told. */
export const CONFLICT_OF_INTEREST_NOTICE =
  'You belong to this organisation, so somebody else on the Desi-Event team has to decide this.'

/**
 * Whether this session belongs to an organisation, through its own membership.
 *
 * Membership only: a platform role is not a membership, and a platform
 * reviewer with no membership there is exactly the person who should decide.
 *
 * @param {object|null} session The session payload.
 * @param {string|null|undefined} organizationId The organisation.
 * @returns {boolean} True when one of the session's memberships is in it.
 */
export function belongsTo(session, organizationId) {
  if (!organizationId) return false

  return (session?.memberships ?? []).some(
    (membership) => membership.organizationId === organizationId,
  )
}
