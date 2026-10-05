/**
 * Platform staff administration: finding an account, changing its platform
 * role, and putting somebody into an organisation directly.
 *
 * Everything here is held by `platform:admin`, which only `SUPER_ADMIN` has —
 * the organisation search included. A narrower capability was considered and
 * rejected: whoever can grant `SUPER_ADMIN` effectively holds everything, so a
 * smaller name would be a false promise about how much this surface can do.
 * The platform administrator (`ADMIN`) holds none of it: it invites organisers
 * (`routes/organizer-invitations.js`, on `organizer:invite`) and reviews, and
 * cannot change roles, search accounts or put anybody into an organisation.
 *
 * `platform.setUserRole` takes any of the seven platform roles: ATTENDEE,
 * ORGANIZER, SUPPORT, MODERATOR, FINANCE_ADMIN, ADMIN and SUPER_ADMIN.
 *
 * The two writes share the same guard rails, and each is there for a reason:
 *
 *   - **A second factor within the `SECURITY_ROLE` window** (two minutes), from
 *     the contract, before the handler runs.
 *   - **A written reason**, recorded on the audit row, because a role change
 *     nobody can explain is one nobody can review.
 *   - **Never the caller's own account.** Promoting yourself is the attack, and
 *     demoting yourself is how a platform ends up with nobody at the top.
 *   - **Every session the target holds ends in the same transaction** (finding
 *     NF-10), so the new role is never live on a session opened under the old
 *     one — and a newly privileged account must enrol a second factor at its
 *     next sign-in before any guarded route will answer it (finding NF-12).
 *   - **The last of something is never removed.** The last super administrator
 *     and an organisation's last owner are both refused, decided with the rows
 *     that could change underneath locked first.
 *
 * Searching for an account takes its query in the request body, not the URL:
 * the query is usually an address, and URLs are written to access logs.
 *
 * @module @desi-event/api/routes/platform
 */

import { assertCanGrantOrgRole } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { noStore } from '../lib/delivery.js'
import {
  conflict,
  databaseErrorCode,
  forbidden,
  httpError,
  notFound,
  unprocessable,
} from '../lib/errors.js'
import { assertNotLastOwner, lockMembership, setScannerScopes } from '../lib/memberships.js'
import { revokeAllSessionsOf } from '../lib/privilege-change.js'
import { defineRoute } from '../lib/register.js'

/**
 * Whether a thrown value is a unique-constraint violation.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True for `P2002` or `23505`.
 */
function isUniqueViolation(error) {
  const code = databaseErrorCode(error)

  return code === 'P2002' || code === '23505'
}

/** The platform role this surface exists to protect the last of. */
const SUPER_ADMIN = 'SUPER_ADMIN'

/**
 * Refuse the caller's own account.
 *
 * @param {object} request The request.
 * @param {string} userId The account being changed.
 * @param {string} message What to say.
 * @returns {void}
 * @throws {Error} A 403 when it is the caller's own.
 */
function assertNotSelf(request, userId, message) {
  if (userId === request.actor.id) throw forbidden(message)
}

/**
 * Register the `/v1/platform` routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerPlatformRoutes(app, { prisma }) {
  defineRoute(app, 'platform.searchUsers', {
    handler: async (request, reply) => {
      const { q, role, page, perPage } = request.body

      // Search results are personal data: never kept by a cache between here
      // and the screen.
      noStore(reply)

      const where = {
        AND: [
          {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
              { id: q },
            ],
          },
          ...(role ? [{ role }] : []),
        ],
      }

      const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          orderBy: [{ email: 'asc' }, { id: 'asc' }],
          ...toSkipTake({ page, perPage }),
        }),
      ])

      const ids = users.map((user) => user.id)
      const [factors, memberships] = ids.length
        ? await Promise.all([
            prisma.mfaFactor.findMany({
              where: {
                userId: { in: ids },
                type: { not: 'RECOVERY_CODE' },
                confirmedAt: { not: null },
                disabledAt: null,
              },
              select: { userId: true },
            }),
            prisma.membership.findMany({
              where: { userId: { in: ids } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              include: { organization: true },
            }),
          ])
        : [[], []]
      const enrolled = new Set(factors.map((factor) => factor.userId))
      const membershipsOf = (userId) =>
        memberships.filter((membership) => membership.userId === userId).slice(0, 50)

      return {
        data: users.map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          suspended: Boolean(user.suspendedAt),
          mfaEnrolled: enrolled.has(user.id),
          self: user.id === request.actor.id,
          createdAt: user.createdAt,
          memberships: membershipsOf(user.id).map((membership) => ({
            organizationId: membership.organizationId,
            organizationName: membership.organization?.name ?? null,
            role: membership.role,
          })),
        })),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'platform.setUserRole', {
    handler: async (request) => {
      const { role, reason } = request.body
      const userId = request.params.id

      assertNotSelf(
        request,
        userId,
        'You cannot change your own platform role. Ask another super administrator.',
      )

      const target = await prisma.user.findUnique({ where: { id: userId } })

      if (!target) throw notFound('No such account.')

      const now = new Date()

      const outcome = await prisma.$transaction(async (tx) => {
        // Every super administrator, the caller and the target, locked in one
        // order. Two administrators demoting each other at the same moment then
        // take turns, and the second sees what the first did — including that
        // it is no longer a super administrator itself.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "role" = 'SUPER_ADMIN' OR "id" IN (${request.actor.id}, ${userId}) ORDER BY "id" FOR UPDATE`

        const actor = await tx.user.findUnique({ where: { id: request.actor.id } })

        if (actor?.role !== SUPER_ADMIN || actor.suspendedAt) {
          throw forbidden('Your account can no longer change platform roles.')
        }

        const current = await tx.user.findUnique({ where: { id: userId } })

        if (!current) throw notFound('No such account.')

        if (current.role === role) {
          throw conflict(`This account already holds the ${role} platform role.`)
        }

        if (current.role === SUPER_ADMIN && role !== SUPER_ADMIN) {
          const remaining = await tx.user.count({ where: { role: SUPER_ADMIN } })

          if (remaining <= 1) {
            throw httpError(
              422,
              'LAST_SUPER_ADMIN',
              'This is the only super administrator. Make somebody else one first.',
            )
          }
        }

        await tx.user.update({ where: { id: userId }, data: { role } })

        const sessionsRevoked = await revokeAllSessionsOf(tx, userId, now)

        await recordAudit(tx, {
          actorId: request.actor.id,
          action: AUDIT_ACTIONS.PLATFORM_ROLE_CHANGED,
          entityType: 'User',
          entityId: userId,
          metadata: { from: current.role, to: role, reason, sessionsRevoked },
        })

        return { from: current.role, sessionsRevoked }
      })

      request.log.info(
        { userId, from: outcome.from, to: role, sessionsRevoked: outcome.sessionsRevoked },
        'changed a platform role',
      )

      return {
        data: { userId, from: outcome.from, role, sessionsRevoked: outcome.sessionsRevoked },
      }
    },
  })

  defineRoute(app, 'platform.searchOrganizations', {
    handler: async (request) => {
      const { q, page, perPage } = request.query

      const where = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q.toLowerCase() } },
        ],
      }

      const [total, organizations] = await Promise.all([
        prisma.organization.count({ where }),
        prisma.organization.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          ...toSkipTake({ page, perPage }),
        }),
      ])

      const ids = organizations.map((organization) => organization.id)
      const [members, owners] = ids.length
        ? await Promise.all([
            prisma.membership.groupBy({
              by: ['organizationId'],
              where: { organizationId: { in: ids } },
              _count: { _all: true },
            }),
            prisma.membership.groupBy({
              by: ['organizationId'],
              where: { organizationId: { in: ids }, role: 'OWNER' },
              _count: { _all: true },
            }),
          ])
        : [[], []]

      const toMap = (rows) => new Map(rows.map((row) => [row.organizationId, row._count._all]))
      const memberCounts = toMap(members)
      const ownerCounts = toMap(owners)

      return {
        data: organizations.map((organization) => ({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          verificationStatus: organization.verificationStatus,
          suspended: Boolean(organization.suspendedAt),
          memberCount: memberCounts.get(organization.id) ?? 0,
          ownerCount: ownerCounts.get(organization.id) ?? 0,
        })),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'platform.grantMembership', {
    handler: async (request) => {
      const { userId, role, reason } = request.body
      const organizationId = request.params.id

      const organization = await prisma.organization.findUnique({ where: { id: organizationId } })

      if (!organization) throw notFound('No such organisation.')

      assertNotSelf(
        request,
        userId,
        'You cannot change your own membership here. Ask another super administrator.',
      )

      const user = await prisma.user.findUnique({ where: { id: userId } })

      if (!user) throw notFound('No such account.')

      if (user.suspendedAt) {
        throw unprocessable(
          'That account is suspended. Lift the suspension before granting it a role.',
        )
      }

      // The permissions package's own rule, as well as the contract's
      // capability: a grant goes through the one place that decides who may
      // grant what, rather than a comparison written here.
      assertCanGrantOrgRole(request.actor, role, { organizationId })

      const now = new Date()

      /**
       * Grant or change the membership, in one transaction.
       *
       * @param {object} tx The transaction client.
       * @returns {Promise<{membership: object, previousRole: string|null, sessionsRevoked: number}>} What changed.
       */
      const grant = async (tx) => {
        // The owners, then this account's membership, locked and read as they
        // are now: a removal, transfer or role change that committed a moment
        // ago is what this decides from, never a read taken before it.
        const existing = await lockMembership(tx, organizationId, { userId })

        if (existing?.role === role) {
          throw conflict(`That account already holds the ${role} role in this organisation.`)
        }

        // Taking OWNER away from somebody is a last-owner question, decided
        // with the owners locked.
        if (existing?.role === 'OWNER' && role !== 'OWNER') {
          await assertNotLastOwner(tx, organizationId)
        }

        const membership = existing
          ? await tx.membership.update({ where: { id: existing.id }, data: { role } })
          : await tx.membership.create({ data: { userId, organizationId, role } })

        // A door role keeps the scopes it already has; any other role keeps
        // none. Nothing new is scoped here — that is the team's decision.
        const keep = existing
          ? (await tx.scannerScope.findMany({ where: { membershipId: membership.id } })).map(
              (scope) => scope.eventId,
            )
          : []

        await setScannerScopes(tx, { membership, eventIds: keep, organizationId })

        const sessionsRevoked = await revokeAllSessionsOf(tx, userId, now)

        await recordAudit(tx, {
          actorId: request.actor.id,
          action: AUDIT_ACTIONS.PLATFORM_MEMBERSHIP_GRANTED,
          entityType: 'Membership',
          entityId: membership.id,
          metadata: {
            organizationId,
            userId,
            role,
            previousRole: existing?.role ?? null,
            reason,
            sessionsRevoked,
          },
        })

        return { membership, previousRole: existing?.role ?? null, sessionsRevoked }
      }

      // Nothing to lock when the account is not a member yet, so two grants to
      // the same newcomer at once — or a grant racing the newcomer accepting
      // an invitation — both try to create the membership. The database
      // refuses the second; that is a conflict to reload over, not a server
      // error.
      const outcome = await prisma.$transaction(grant).catch((error) => {
        if (isUniqueViolation(error)) {
          throw conflict(
            'That account was added to this organisation at the same moment by another request. Reload and check its role.',
          )
        }

        throw error
      })

      request.log.info(
        {
          organizationId,
          userId,
          role,
          previousRole: outcome.previousRole,
          sessionsRevoked: outcome.sessionsRevoked,
        },
        'granted a membership directly',
      )

      return {
        data: {
          membershipId: outcome.membership.id,
          organizationId,
          userId,
          role,
          previousRole: outcome.previousRole,
          created: outcome.previousRole === null,
          sessionsRevoked: outcome.sessionsRevoked,
        },
      }
    },
  })
}
