/**
 * Organiser invitations: the only way anybody comes to post events here.
 *
 * The Desi-Event team (a platform administrator or super administrator,
 * holding `organizer:invite`) invites an address to start a new organisation.
 * The recipient accepts with the single-use code, signed in as that address,
 * and the organisation is created verified with them as its owner.
 *
 * Five routes:
 *
 *   - **list**, **revoke** and **reissue**, for the team's shared queue;
 *   - **create**, which issues the code;
 *   - **accept**, for the recipient.
 *
 * The defences, each of which is a specific line below:
 *
 *   1. **Self-dealing.** An administrator cannot invite their own address, and
 *      cannot invite an address that belongs to a staff account (reviewers do
 *      not run organisations). A staff account cannot accept one either, and the
 *      inviter cannot accept their own.
 *   2. **What goes public.** The organisation's name, description and website
 *      are the administrator's, written on the invitation. The acceptance body
 *      carries only the web address and the time zone; everything else is
 *      stripped by the schema.
 *   3. **The code.** Returned once (MANUAL), in the 201 that minted it, with
 *      `no-store`; or sent through the mail server (EMAIL) and never shown.
 *      Never logged, audited or stored: the database keeps its SHA-256 digest.
 *      A failed send withdraws the invitation, so a code nobody holds is never
 *      left live.
 *   4. **Replay and forwarding.** Acceptance is a conditional update on a
 *      waiting, unexpired row, and needs the signed-in account's address to be
 *      the invited one. One refusal sentence covers every unusable case, so a
 *      code passed on teaches its holder nothing.
 *   5. **Two of everything at once.** One waiting invitation per address is a
 *      partial unique index; two creates at the same moment produce one 201 and
 *      one 409. Two acceptances produce one organisation.
 *
 * @module @desi-event/api/routes/organizer-invitations
 */

import { PRIVILEGED_PLATFORM_ROLES, hashToken, issueToken } from '@desi-event/auth'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import {
  DELIVERY_MODES,
  addressCandidates,
  deliverOrWithdraw,
  isSameAddress,
  noStore,
} from '../lib/delivery.js'
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js'
import { disambiguateSlug } from '../lib/identifiers.js'
import { likeLiteral } from '../lib/like-pattern.js'
import {
  SLUG_TAKEN_SENTENCE,
  createInvitedOrganization,
  isUniqueViolation,
  resolveOrganizationSlug,
  toOrganizationProfile,
} from '../lib/organization-provisioning.js'
import { revokeOtherSessionsOf, secureSessionAfterGain } from '../lib/privilege-change.js'
import { defineRoute } from '../lib/register.js'
import { organizerAcceptRateLimit, organizerInviteRateLimit } from '../plugins/rate-limit.js'

/** How long an organiser invitation stays acceptable: fourteen days. */
export const ORGANIZER_INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000

/**
 * The refusals, each with its code and the sentence the caller reads.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ORGANIZER_INVITATION_SENTENCES = Object.freeze({
  SELF_INVITATION:
    'You cannot invite your own address. Another platform administrator has to invite you.',
  STAFF_ACCOUNT:
    'That address belongs to a Desi-Event staff account. Organiser invitations are for people outside the team; a super administrator can add a staff account to an organisation directly from People and roles.',
  STAFF_ACCOUNT_ACCEPT:
    'This account holds a Desi-Event staff role, so it cannot accept an organiser invitation. A super administrator can add a staff account to an organisation directly.',
  SELF_ACCEPT:
    'You sent this invitation, so you cannot accept it. It is for the person you invited.',
  INVITATION_OUTSTANDING:
    'An invitation to that address is already waiting. Issue a new code for it, or withdraw it first.',
  NOT_OUTSTANDING:
    'This invitation has been accepted or withdrawn, so there is no code to replace. Invite them again instead.',
  INVITATION_UNUSABLE:
    'That code cannot be used by this account. It may have expired, been withdrawn or used already, or it was sent to a different email address — sign in with the address the invitation was sent to.',
  WRONG_INVITATION_KIND:
    "That is a team invitation code. Enter it at Your account → Join an organisation's team (/account/invitations).",
  ALREADY_USED:
    'This invitation was used or withdrawn a moment ago, so nothing was created. Reload to see where it stands.',
  NO_FREE_SLUG: 'Could not find a free web address for that name. Supply one.',
})

/** What every invitation read carries along: the names, and the organisation once made. */
const INVITATION_INCLUDE = Object.freeze({
  invitedBy: { select: { displayName: true } },
  acceptedBy: { select: { displayName: true } },
  revokedBy: { select: { displayName: true } },
  organization: { select: { id: true, name: true, slug: true, verificationStatus: true } },
})

/**
 * The status an invitation is reported in: a waiting one past its expiry is
 * EXPIRED, whether or not the row has been moved there.
 *
 * @param {{status: string, expiresAt: Date}} row The invitation.
 * @param {Date} now The current time.
 * @returns {string} The effective status.
 */
export function effectiveStatus(row, now) {
  if (row.status === 'PENDING' && new Date(row.expiresAt).getTime() <= now.getTime()) {
    return 'EXPIRED'
  }

  return row.status
}

/**
 * The `where` for a status filter, in effective terms.
 *
 * @param {string} status One of the four states, or ALL.
 * @param {Date} now The current time.
 * @returns {object} A Prisma `where` fragment.
 */
function statusWhere(status, now) {
  if (status === 'PENDING') return { status: 'PENDING', expiresAt: { gt: now } }

  if (status === 'EXPIRED') {
    return { OR: [{ status: 'EXPIRED' }, { status: 'PENDING', expiresAt: { lte: now } }] }
  }

  if (status === 'ALL') return {}

  return { status }
}

/**
 * An invitation as the team's screens show it.
 *
 * An allow-list. It never carries the code or its digest; the code exists only
 * in the one response that minted it, added beside this by the route.
 *
 * @param {object} row The invitation, read with {@link INVITATION_INCLUDE}.
 * @param {Date} now The current time.
 * @returns {object} The summary.
 */
export function toOrganizerInvitationSummary(row, now) {
  const instant = (value) => (value ? new Date(value).toISOString() : null)

  return {
    id: row.id,
    email: row.email,
    organizationName: row.organizationName,
    organizationDescription: row.organizationDescription ?? null,
    organizationWebsiteUrl: row.organizationWebsiteUrl ?? null,
    organization: row.organization
      ? {
          id: row.organization.id,
          name: row.organization.name,
          slug: row.organization.slug,
          verificationStatus: row.organization.verificationStatus,
        }
      : null,
    note: row.note ?? null,
    status: effectiveStatus(row, now),
    deliveryMode: row.deliveryMode,
    invitedByName: row.invitedBy?.displayName ?? null,
    acceptedByName: row.acceptedBy?.displayName ?? null,
    revokedByName: row.revokedBy?.displayName ?? null,
    supersedesId: row.supersedesId ?? null,
    createdAt: instant(row.createdAt),
    expiresAt: instant(row.expiresAt),
    acceptedAt: instant(row.acceptedAt),
    revokedAt: instant(row.revokedAt),
  }
}

/**
 * Register the organiser invitation routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {function(object): Promise<void>} [deps.deliver] Where a code is sent, in EMAIL mode.
 * @param {'MANUAL'|'EMAIL'} [deps.deliveryMode] How codes reach people, resolved once by `buildApp`.
 * @param {{max?: number, timeWindow?: string|number}} [deps.authLimit] Overrides for the acceptance limit.
 * @param {{max?: number, timeWindow?: string|number}} [deps.organizerInviteLimit] Overrides for the issuing budget.
 * @returns {void} Nothing.
 */
export function registerOrganizerInvitationRoutes(
  app,
  { prisma, deliver, deliveryMode, authLimit, organizerInviteLimit },
) {
  const mode = deliveryMode ?? app.deliveryMode ?? DELIVERY_MODES.MANUAL
  // One budget for issuing and reissuing, per administrator.
  const issueBudget = organizerInviteRateLimit(organizerInviteLimit ?? {})

  /**
   * Refuse an address the caller may not invite.
   *
   * @param {object} request The request.
   * @param {string} email The recipient's address.
   * @returns {Promise<void>}
   * @throws {Error} 403 `SELF_INVITATION`, or 422 `STAFF_ACCOUNT`.
   */
  async function assertInvitable(request, email) {
    if (email.toLowerCase() === String(request.currentUser.email).toLowerCase()) {
      throw forbidden(ORGANIZER_INVITATION_SENTENCES.SELF_INVITATION, 'SELF_INVITATION')
    }

    // The filter can also find look-alikes (`_` matches any one character in
    // it); only the address itself decides.
    const candidates = await prisma.user.findMany({
      where: { email: addressCandidates(email) },
      select: { email: true, role: true },
    })
    const staff = candidates.some(
      (account) =>
        isSameAddress(account.email, email) && PRIVILEGED_PLATFORM_ROLES.has(account.role),
    )

    if (staff) {
      throw Object.assign(unprocessable(ORGANIZER_INVITATION_SENTENCES.STAFF_ACCOUNT), {
        code: 'STAFF_ACCOUNT',
      })
    }
  }

  /**
   * Take back an invitation whose code could not be emailed.
   *
   * @param {string} invitationId The invitation just issued.
   * @param {string} actorId Who issued it.
   * @returns {Promise<void>}
   */
  function withdrawAfterFailedDelivery(invitationId, actorId) {
    const now = new Date()

    return prisma.$transaction(async (tx) => {
      const { count } = await tx.organizerInvitation.updateMany({
        where: { id: invitationId, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: now, revokedById: actorId },
      })

      if (count !== 1) return

      await recordAudit(tx, {
        actorId,
        action: AUDIT_ACTIONS.ORGANIZER_INVITATION_DELIVERY_FAILED,
        entityType: 'OrganizerInvitation',
        entityId: invitationId,
        metadata: { deliveryMode: DELIVERY_MODES.EMAIL },
      })
    })
  }

  /**
   * Hand a freshly minted code to whoever should have it, and say how.
   *
   * @param {object} options Inputs.
   * @param {object} options.request The request.
   * @param {object} options.reply The reply, for the cache headers.
   * @param {object} options.invitation The invitation row.
   * @param {string} options.secret The code.
   * @returns {Promise<{mode: string, invitationCode: string|null}>} The `delivery` block.
   */
  function handOver({ request, reply, invitation, secret }) {
    return deliverOrWithdraw({
      mode,
      secret,
      reply,
      deliver,
      log: request.log,
      message: {
        purpose: 'ORGANIZER_INVITATION',
        email: invitation.email,
        organizationName: invitation.organizationName,
        note: invitation.note ?? null,
        inviterName: request.currentUser.displayName ?? null,
        expiresAt: new Date(invitation.expiresAt).toISOString(),
      },
      withdraw: () => withdrawAfterFailedDelivery(invitation.id, request.actor.id),
    })
  }

  defineRoute(app, 'organizerInvitations.list', {
    handler: async (request, reply) => {
      const { page, perPage, status, q } = request.query
      const now = new Date()
      const where = {
        AND: [
          statusWhere(status, now),
          q
            ? {
                OR: [
                  // As typed: an `_` or a `%` is a character, not a wildcard.
                  { organizationName: { contains: likeLiteral(q), mode: 'insensitive' } },
                  {
                    organization: { name: { contains: likeLiteral(q), mode: 'insensitive' } },
                  },
                ],
              }
            : {},
        ],
      }

      const [rows, total] = await Promise.all([
        prisma.organizerInvitation.findMany({
          where,
          include: INVITATION_INCLUDE,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake({ page, perPage }),
        }),
        prisma.organizerInvitation.count({ where }),
      ])

      // Addresses and notes: nothing here is for a cache.
      noStore(reply)

      return {
        data: rows.map((row) => toOrganizerInvitationSummary(row, now)),
        pagination: buildPaginationMeta({ page, perPage, total }),
        meta: { deliveryMode: mode },
      }
    },
  })

  defineRoute(app, 'organizerInvitations.create', {
    preHandler: [issueBudget],
    handler: async (request, reply) => {
      const {
        email,
        organizationName,
        organizationDescription = null,
        organizationWebsiteUrl = null,
        note = null,
      } = request.body

      await assertInvitable(request, email)

      const { secret, hash } = issueToken()
      const now = new Date()

      let invitation

      try {
        invitation = await prisma.$transaction(async (tx) => {
          // A waiting invitation past its expiry is moved to EXPIRED, so the
          // one-waiting-per-address index admits the new one. A live one is
          // left alone, and the index refuses the new one below. Compared
          // exactly: the table holds addresses in lower case only (its
          // CHECK), and an insensitive compare would run as an ILIKE in which
          // `_` matches any character.
          await tx.organizerInvitation.updateMany({
            where: {
              email: email.toLowerCase(),
              status: 'PENDING',
              expiresAt: { lte: now },
            },
            data: { status: 'EXPIRED' },
          })

          const created = await tx.organizerInvitation.create({
            data: {
              email,
              organizationName,
              organizationDescription,
              organizationWebsiteUrl,
              note,
              tokenHash: hash,
              invitedById: request.actor.id,
              deliveryMode: mode,
              expiresAt: new Date(now.getTime() + ORGANIZER_INVITATION_LIFETIME_MS),
              createdAt: now,
            },
            include: INVITATION_INCLUDE,
          })

          // How the code went out, and nothing that identifies the person or
          // opens the invitation: no address, no name, no note, no code.
          await recordAudit(tx, {
            actorId: request.actor.id,
            action: AUDIT_ACTIONS.ORGANIZER_INVITATION_ISSUED,
            entityType: 'OrganizerInvitation',
            entityId: created.id,
            metadata: { role: 'OWNER', deliveryMode: mode },
          })

          return created
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw Object.assign(conflict(ORGANIZER_INVITATION_SENTENCES.INVITATION_OUTSTANDING), {
            code: 'INVITATION_OUTSTANDING',
          })
        }

        throw error
      }

      const delivery = await handOver({ request, reply, invitation, secret })

      // Identifiers and the mode, never the code or the address.
      request.log.info(
        { invitationId: invitation.id, deliveryMode: mode },
        'issued an organiser invitation',
      )

      return { data: { ...toOrganizerInvitationSummary(invitation, now), delivery } }
    },
  })

  defineRoute(app, 'organizerInvitations.revoke', {
    handler: async (request, reply) => {
      const current = await prisma.organizerInvitation.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      })

      if (!current) throw notFound('No such invitation.')

      const now = new Date()

      // The withdrawal and its audit row commit together, and the row is
      // written only when something was withdrawn.
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.organizerInvitation.updateMany({
          where: { id: current.id, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: now, revokedById: request.actor.id },
        })

        if (count !== 1) return

        await recordAudit(tx, {
          actorId: request.actor.id,
          action: AUDIT_ACTIONS.ORGANIZER_INVITATION_REVOKED,
          entityType: 'OrganizerInvitation',
          entityId: current.id,
          metadata: {},
        })
      })

      const after = await prisma.organizerInvitation.findUnique({
        where: { id: current.id },
        include: INVITATION_INCLUDE,
      })

      noStore(reply)

      return { data: toOrganizerInvitationSummary(after, now) }
    },
  })

  defineRoute(app, 'organizerInvitations.reissue', {
    preHandler: [issueBudget],
    handler: async (request, reply) => {
      const current = await prisma.organizerInvitation.findUnique({
        where: { id: request.params.id },
      })

      if (!current) throw notFound('No such invitation.')

      const now = new Date()

      if (!['PENDING', 'EXPIRED'].includes(effectiveStatus(current, now))) {
        throw Object.assign(conflict(ORGANIZER_INVITATION_SENTENCES.NOT_OUTSTANDING), {
          code: 'NOT_OUTSTANDING',
        })
      }

      // The same rules as a new invitation: the address may have become a
      // staff account since, or be the caller's own.
      await assertInvitable(request, current.email)

      const { secret, hash } = issueToken()

      let invitation

      try {
        invitation = await prisma.$transaction(async (tx) => {
          // The old code dies in the same transaction the new one is born in,
          // and only if it was still outstanding at that moment: an
          // acceptance, a withdrawal or another reissue that got there first
          // wins.
          const { count } = await tx.organizerInvitation.updateMany({
            where: { id: current.id, status: { in: ['PENDING', 'EXPIRED'] } },
            data: { status: 'REVOKED', revokedAt: now, revokedById: request.actor.id },
          })

          if (count !== 1) {
            throw Object.assign(conflict(ORGANIZER_INVITATION_SENTENCES.NOT_OUTSTANDING), {
              code: 'NOT_OUTSTANDING',
            })
          }

          const created = await tx.organizerInvitation.create({
            data: {
              email: current.email,
              organizationName: current.organizationName,
              organizationDescription: current.organizationDescription ?? null,
              organizationWebsiteUrl: current.organizationWebsiteUrl ?? null,
              note: current.note ?? null,
              tokenHash: hash,
              invitedById: request.actor.id,
              deliveryMode: mode,
              expiresAt: new Date(now.getTime() + ORGANIZER_INVITATION_LIFETIME_MS),
              supersedesId: current.id,
              createdAt: now,
            },
            include: INVITATION_INCLUDE,
          })

          await recordAudit(tx, {
            actorId: request.actor.id,
            action: AUDIT_ACTIONS.ORGANIZER_INVITATION_REISSUED,
            entityType: 'OrganizerInvitation',
            entityId: created.id,
            metadata: { supersedes: current.id, deliveryMode: mode },
          })

          return created
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw Object.assign(conflict(ORGANIZER_INVITATION_SENTENCES.INVITATION_OUTSTANDING), {
            code: 'INVITATION_OUTSTANDING',
          })
        }

        throw error
      }

      const delivery = await handOver({ request, reply, invitation, secret })

      request.log.info(
        { invitationId: invitation.id, supersedes: current.id, deliveryMode: mode },
        'reissued an organiser invitation',
      )

      return { data: { ...toOrganizerInvitationSummary(invitation, now), delivery } }
    },
  })

  defineRoute(app, 'organizerInvitations.accept', {
    config: { rateLimit: organizerAcceptRateLimit(authLimit) },
    handler: async (request, reply) => {
      const { token, slug: requested, timezone } = request.body
      const tokenHash = hashToken(token)
      const now = new Date()

      const invitation = await prisma.organizerInvitation.findUnique({ where: { tokenHash } })

      if (!invitation) {
        // A team invitation's code typed in the wrong place. Whoever holds it
        // learns only what they already have, and the code is not spent.
        const teamInvitation = await prisma.invitation.findUnique({
          where: { tokenHash },
          select: { id: true },
        })

        if (teamInvitation) {
          throw forbidden(
            ORGANIZER_INVITATION_SENTENCES.WRONG_INVITATION_KIND,
            'WRONG_INVITATION_KIND',
          )
        }

        throw forbidden(ORGANIZER_INVITATION_SENTENCES.INVITATION_UNUSABLE, 'INVITATION_UNUSABLE')
      }

      // One sentence for every unusable case — expired, withdrawn, used, or
      // sent to another address — and no part of that address.
      const usable =
        invitation.status === 'PENDING' &&
        new Date(invitation.expiresAt).getTime() > now.getTime() &&
        invitation.email.toLowerCase() === String(request.currentUser.email).toLowerCase()

      if (!usable) {
        throw forbidden(ORGANIZER_INVITATION_SENTENCES.INVITATION_UNUSABLE, 'INVITATION_UNUSABLE')
      }

      if (invitation.invitedById === request.actor.id) {
        throw forbidden(ORGANIZER_INVITATION_SENTENCES.SELF_ACCEPT, 'SELF_INVITATION')
      }

      // Read again, not taken from the session: a role granted since sign-in
      // counts. Reviewers do not run organisations, and the code is not spent.
      const account = await prisma.user.findUnique({
        where: { id: request.actor.id },
        select: { role: true, email: true },
      })

      if (!account || PRIVILEGED_PLATFORM_ROLES.has(account.role)) {
        throw forbidden(ORGANIZER_INVITATION_SENTENCES.STAFF_ACCOUNT_ACCEPT, 'STAFF_ACCOUNT')
      }

      const first = await resolveOrganizationSlug(prisma, {
        requested,
        name: invitation.organizationName,
      })

      /**
       * Spend the invitation and make the organisation, in one transaction.
       *
       * @param {string} slug The web address to try.
       * @returns {Promise<{organization: object, membership: object, siblingsRevoked: number}>} What was made.
       */
      const accept = (slug) =>
        prisma.$transaction(async (tx) => {
          // Conditional on a waiting, unexpired row: two simultaneous
          // acceptances both read it, and only one writes.
          const { count } = await tx.organizerInvitation.updateMany({
            where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: now } },
            data: { status: 'ACCEPTED', acceptedAt: now, acceptedByUserId: request.actor.id },
          })

          if (count !== 1) throw conflict(ORGANIZER_INVITATION_SENTENCES.ALREADY_USED)

          const { organization, membership } = await createInvitedOrganization(tx, {
            invitation,
            actor: request.actor,
            email: account.email,
            profile: { timezone },
            slug,
            now,
          })

          await tx.organizerInvitation.update({
            where: { id: invitation.id },
            data: { organizationId: organization.id },
          })

          // Finding NF-10: the caller now owns an organisation, and their
          // other sessions were opened without that. They end with the
          // transaction that granted it.
          const siblingsRevoked = await revokeOtherSessionsOf(tx, request, now)

          await recordAudit(tx, {
            actorId: request.actor.id,
            action: AUDIT_ACTIONS.ORGANIZER_INVITATION_ACCEPTED,
            entityType: 'OrganizerInvitation',
            entityId: invitation.id,
            metadata: {
              organizationId: organization.id,
              membershipId: membership.id,
              invitedById: invitation.invitedById,
              siblingsRevoked,
            },
          })

          await recordAudit(tx, {
            actorId: request.actor.id,
            action: AUDIT_ACTIONS.ORGANIZATION_CREATED,
            entityType: 'Organization',
            entityId: organization.id,
            // The slug and the role; never the contact address.
            metadata: {
              slug: organization.slug,
              role: 'OWNER',
              membershipId: membership.id,
              via: 'ORGANIZER_INVITATION',
              invitationId: invitation.id,
              siblingsRevoked,
            },
          })

          // The administrator who sent the invitation vouched for it.
          await recordAudit(tx, {
            actorId: invitation.invitedById,
            action: AUDIT_ACTIONS.ORGANIZATION_VERIFIED_BY_INVITATION,
            entityType: 'Organization',
            entityId: organization.id,
            metadata: { invitationId: invitation.id, acceptedByUserId: request.actor.id },
          })

          return { organization, membership, siblingsRevoked }
        })

      let created

      try {
        created = await accept(first.slug)
      } catch (error) {
        if (!isUniqueViolation(error)) throw error

        // A slug somebody asked for is theirs to change; one the server
        // derived is the server's to make unique, once.
        if (first.requested) throw conflict(SLUG_TAKEN_SENTENCE)

        try {
          created = await accept(disambiguateSlug(first.slug))
        } catch (retryError) {
          if (isUniqueViolation(retryError)) {
            throw conflict(ORGANIZER_INVITATION_SENTENCES.NO_FREE_SLUG)
          }

          throw retryError
        }
      }

      const session = await secureSessionAfterGain(app, prisma, { request, reply, now })

      request.log.info(
        {
          invitationId: invitation.id,
          organizationId: created.organization.id,
          siblingsRevoked: created.siblingsRevoked,
          rotated: session.rotated,
        },
        'accepted an organiser invitation',
      )

      return {
        data: {
          organization: toOrganizationProfile(created.organization),
          role: 'OWNER',
          session: { mfaRequired: session.mfaRequired, mfaEnrolled: session.mfaEnrolled },
        },
      }
    },
  })
}
