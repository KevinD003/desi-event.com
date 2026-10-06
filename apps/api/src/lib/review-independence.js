/**
 * Reviewers are independent of what they review.
 *
 * An event is public only after the Desi-Event team has reviewed it. That
 * means somebody other than the people running it: a platform account that is
 * also a member of the event's organisation, or the account that sent the
 * event for review, would be approving its own work. A super administrator
 * holds both `event:submit_review` and `moderation:review`, so without this
 * one person could submit, approve and publish an event on their own.
 *
 * Two refusals, both 403:
 *
 *   - `CONFLICT_OF_INTEREST` — the reviewer holds a membership in the
 *     organisation. Applies to event decisions, picture decisions and
 *     organisation verification decisions.
 *   - `SELF_REVIEW` — the reviewer is the account behind the event's latest move
 *     into review (event decisions), or the account that uploaded the picture
 *     being decided (picture decisions, SPEC2-XI X-3: nobody approves their
 *     own upload, which also closes the path of a Desi-Event administrator
 *     uploading in an editing sitting and approving it themselves).
 *
 * What this cannot see: one person using two accounts. Every acceptance of an
 * organiser invitation is audited with its inviter, so the platform can list
 * the organisations each administrator's invitations created.
 *
 * Implemented once, here, and called by `transitionEvent` for every moderator
 * move, by `availableTransitions` (which marks the moves and says why), by
 * `decideMedia` and by `organizers.moderateVerification`.
 *
 * @module @desi-event/api/lib/review-independence
 */

import { forbidden } from './errors.js'

/** The two refusal codes, and the sentence each one carries. */
export const REVIEW_INDEPENDENCE = Object.freeze({
  CONFLICT_OF_INTEREST: Object.freeze({
    code: 'CONFLICT_OF_INTEREST',
    message:
      'You belong to this organisation, so somebody else on the Desi-Event team has to decide this.',
  }),
  SELF_REVIEW: Object.freeze({
    code: 'SELF_REVIEW',
    message:
      'You sent this event for review, so somebody else on the Desi-Event team has to decide it.',
  }),
  SELF_UPLOAD: Object.freeze({
    code: 'SELF_REVIEW',
    message: 'You uploaded this picture, so somebody else on the Desi-Event team has to decide it.',
  }),
})

/**
 * Whether the reviewer is independent, and if not, why.
 *
 * @param {object} prisma The Prisma client, or a transaction client.
 * @param {object} options Inputs.
 * @param {{id: string, memberships?: Array<{organizationId: string}>}} options.actor The reviewer.
 * @param {string} options.organizationId The organisation whose work is being decided.
 * @param {string|null} [options.eventId] The event, for the submitter check.
 * @param {string|null} [options.uploadedById] For a picture decision: who uploaded it.
 * @returns {Promise<{independent: boolean, code: string|null, reason: string|null}>} The answer.
 */
export async function reviewIndependence(
  prisma,
  { actor, organizationId, eventId = null, uploadedById = null },
) {
  const member = (actor?.memberships ?? []).some(
    (membership) => membership.organizationId === organizationId,
  )

  if (member) {
    const { code, message } = REVIEW_INDEPENDENCE.CONFLICT_OF_INTEREST

    return { independent: false, code, reason: message }
  }

  if (uploadedById && actor?.id && uploadedById === actor.id) {
    const { code, message } = REVIEW_INDEPENDENCE.SELF_UPLOAD

    return { independent: false, code, reason: message }
  }

  if (eventId) {
    const submission = await prisma.eventModerationAction.findFirst({
      where: { eventId, toStatus: 'REVIEW_PENDING' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { actorId: true },
    })

    if (submission?.actorId && submission.actorId === actor?.id) {
      const { code, message } = REVIEW_INDEPENDENCE.SELF_REVIEW

      return { independent: false, code, reason: message }
    }
  }

  return { independent: true, code: null, reason: null }
}

/**
 * Refuse a reviewer who is not independent of what they are deciding.
 *
 * @param {object} prisma The Prisma client, or a transaction client.
 * @param {object} options Inputs.
 * @param {{id: string, memberships?: Array<{organizationId: string}>}} options.actor The reviewer.
 * @param {string} options.organizationId The organisation whose work is being decided.
 * @param {string|null} [options.eventId] The event, for the submitter check.
 * @param {string|null} [options.uploadedById] For a picture decision: who uploaded it.
 * @returns {Promise<{exemption: null}>} Nothing to note when the reviewer is independent.
 * @throws {Error} 403 `CONFLICT_OF_INTEREST` or `SELF_REVIEW`.
 */
export async function assertIndependentReviewer(
  prisma,
  { actor, organizationId, eventId = null, uploadedById = null },
) {
  const { independent, code, reason } = await reviewIndependence(prisma, {
    actor,
    organizationId,
    eventId,
    uploadedById,
  })

  if (!independent) throw forbidden(reason, code)

  return { exemption: null }
}
