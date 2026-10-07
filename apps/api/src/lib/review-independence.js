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
 * One exemption (SPEC2-XI O5): an event imported into the platform-held
 * organisation that holds listed events (`Organization.platformHeldSource`),
 * and a picture copied by such an import, may be approved by the
 * administrator who imported it. For an event, only the importer of record
 * (`EventImportItem.importedById`, which every import submission names)
 * deciding their own latest submission is exempt: an account that only
 * withdrew the import and sent it back by hand is its submitter, not its
 * importer, and is refused as any submitter is. That organisation has no members (a trigger
 * refuses any), so `CONFLICT_OF_INTEREST` cannot arise there, and the import is
 * the Desi-Event team's own work, reviewed on the run page. The exemption is
 * `PLATFORM_HELD_IMPORT`, returned to the caller, which records it with who
 * imported and who approved. Once the event is moved to an organiser's own
 * organisation the exemption no longer applies.
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

/** The one exemption, as it is recorded. */
export const PLATFORM_HELD_IMPORT = 'PLATFORM_HELD_IMPORT'

/**
 * Whether what is being decided is the platform's own import: an event with an
 * import record, or a picture an import copied, in an organisation that holds
 * imported events.
 *
 * @param {object} prisma The Prisma client, or a transaction client.
 * @param {object} options Inputs.
 * @param {string} options.organizationId The organisation whose work is being decided.
 * @param {string|null} options.eventId The event, for an event decision.
 * @param {string|null} options.mediaAssetId The picture, for a picture decision.
 * @param {string|null} [options.submittedById] For an event decision: who sent it
 *   for review last. The exemption covers only the importer of record's own submission.
 * @returns {Promise<boolean>} True when the exemption applies.
 */
export async function isPlatformHeldImport(
  prisma,
  { organizationId, eventId, mediaAssetId, submittedById = null },
) {
  if (!eventId && !mediaAssetId) return false

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { platformHeldSource: true },
  })

  if (!organization?.platformHeldSource) return false

  if (mediaAssetId) {
    const copied = await prisma.eventImportImage.findFirst({
      where: { mediaAssetId, item: { reassignedAt: null } },
      select: { id: true },
    })

    return Boolean(copied)
  }

  const item = await prisma.eventImportItem.findUnique({
    where: { eventId },
    select: { id: true, reassignedAt: true, importedById: true },
  })

  return (
    Boolean(item) &&
    !item.reassignedAt &&
    Boolean(submittedById) &&
    item.importedById === submittedById
  )
}

/**
 * Whether the reviewer is independent, and if not, why.
 *
 * @param {object} prisma The Prisma client, or a transaction client.
 * @param {object} options Inputs.
 * @param {{id: string, memberships?: Array<{organizationId: string}>}} options.actor The reviewer.
 * @param {string} options.organizationId The organisation whose work is being decided.
 * @param {string|null} [options.eventId] The event, for the submitter check.
 * @param {string|null} [options.uploadedById] For a picture decision: who uploaded it.
 * @param {string|null} [options.mediaAssetId] For a picture decision: the picture, for the import exemption.
 * @returns {Promise<{independent: boolean, code: string|null, reason: string|null, exemption: string|null}>} The answer; `exemption` names the rule that let a self-review through.
 */
export async function reviewIndependence(
  prisma,
  { actor, organizationId, eventId = null, uploadedById = null, mediaAssetId = null },
) {
  const member = (actor?.memberships ?? []).some(
    (membership) => membership.organizationId === organizationId,
  )

  if (member) {
    const { code, message } = REVIEW_INDEPENDENCE.CONFLICT_OF_INTEREST

    return { independent: false, code, reason: message, exemption: null }
  }

  // The importer approving their own import is exempt (SPEC2-XI O5); looked
  // up only when a self-review would otherwise be refused.
  const exempt = (submittedById = null) =>
    isPlatformHeldImport(prisma, { organizationId, eventId, mediaAssetId, submittedById })

  if (uploadedById && actor?.id && uploadedById === actor.id) {
    if (mediaAssetId && (await exempt())) {
      return { independent: true, code: null, reason: null, exemption: PLATFORM_HELD_IMPORT }
    }

    const { code, message } = REVIEW_INDEPENDENCE.SELF_UPLOAD

    return { independent: false, code, reason: message, exemption: null }
  }

  if (eventId) {
    const submission = await prisma.eventModerationAction.findFirst({
      where: { eventId, toStatus: 'REVIEW_PENDING' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { actorId: true },
    })

    if (submission?.actorId && submission.actorId === actor?.id) {
      if (await exempt(submission.actorId)) {
        return { independent: true, code: null, reason: null, exemption: PLATFORM_HELD_IMPORT }
      }

      const { code, message } = REVIEW_INDEPENDENCE.SELF_REVIEW

      return { independent: false, code, reason: message, exemption: null }
    }
  }

  return { independent: true, code: null, reason: null, exemption: null }
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
 * @param {string|null} [options.mediaAssetId] For a picture decision: the picture.
 * @returns {Promise<{exemption: null|'PLATFORM_HELD_IMPORT'}>} The exemption that let a self-review through, or null when the reviewer is independent.
 * @throws {Error} 403 `CONFLICT_OF_INTEREST` or `SELF_REVIEW`.
 */
export async function assertIndependentReviewer(
  prisma,
  { actor, organizationId, eventId = null, uploadedById = null, mediaAssetId = null },
) {
  const { independent, code, reason, exemption } = await reviewIndependence(prisma, {
    actor,
    organizationId,
    eventId,
    uploadedById,
    mediaAssetId,
  })

  if (!independent) throw forbidden(reason, code)

  return { exemption }
}
