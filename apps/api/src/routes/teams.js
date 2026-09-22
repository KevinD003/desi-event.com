/**
 * Team management.
 *
 * Six routes, and almost all of the code is about the four ways this is attacked.
 * Stating them plainly, because each one is a specific defence below:
 *
 *   1. **Self-escalation.** A `MANAGER` who can invite people invites themselves
 *      as `ADMIN`, or edits their own membership. Closed by bounding the role a
 *      caller may grant to what they already hold, and by refusing any change to
 *      the caller's own membership.
 *   2. **Escalation through a third party.** The same `MANAGER` invites an
 *      accomplice as `OWNER`. Closed by the same bound: the grantable set comes
 *      from `canAssignOrgRole`, which compares capability sets rather than a
 *      seniority number.
 *   3. **Last-owner removal.** The only `OWNER` is demoted or removed, leaving an
 *      organisation whose record nobody can change. Closed by counting owners
 *      inside the transaction that would change one.
 *   4. **Invitation replay and forwarding.** A link is used twice, or forwarded to
 *      somebody else. Closed by a conditional update on `status: PENDING`, and by
 *      requiring the accepting session to be signed in as the invited address.
 *
 * A fifth, quieter one runs through every route: **cross-tenant access.** Every
 * query is scoped by `organizationId` in the same `where` clause that finds the
 * row, so a membership id from another organisation is not found rather than
 * found-and-refused. The difference matters: 403 confirms the id exists.
 *
 * @module @desi-event/api/routes/teams
 */

import { hashToken, issueToken, tokenUsable } from '@desi-event/auth'
import {
  ORG_ROLE_ORDER,
  assertCan,
  canAssignOrgRole,
  orgRoleFor,
  CAPABILITIES,
  can,
  requiresAdmissionScope,
} from '@desi-event/permissions'

import { recordAudit } from '../lib/audit.js'
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js'
import { maskRecipient } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'
import { authRateLimit } from '../plugins/rate-limit.js'

/**
 * How much of each address a caller may see on the team list.
 *
 * Full addresses go to the people who manage the team — whoever holds
 * `team:invite` in this organisation (MANAGER, ADMIN, OWNER), and a platform
 * super-administrator, whose capabilities are unscoped. Everybody else who may
 * read the list (VIEWER, STAFF, EVENT_MANAGER, FINANCE) sees them masked. A
 * VIEWER or STAFF session needs no second factor and lives longer than a
 * privileged one; the whole roster's addresses were the most useful thing in it
 * for anybody who took one over.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId The organisation.
 * @returns {'FULL'|'MASKED'} The visibility.
 */
export function emailVisibilityFor(actor, organizationId) {
  return can(actor, CAPABILITIES.TEAM_INVITE, { organizationId }) ? 'FULL' : 'MASKED'
}

/**
 * The address field of a member or invitation, at a visibility.
 *
 * The only place a team response decides whether an address is shown. The
 * response schema enforces the decision again: a masked entry has no `email`
 * key, and its `emailMasked` must contain a `*`.
 *
 * @param {string} address The stored address.
 * @param {'FULL'|'MASKED'} visibility From {@link emailVisibilityFor}.
 * @returns {{email: string}|{emailMasked: string}} The field.
 */
function addressAt(address, visibility) {
  return visibility === 'FULL' ? { email: address } : { emailMasked: maskRecipient(address) }
}

/** How long an invitation stays acceptable. */
export const INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000

/**
 * The roles a caller may grant in an organisation.
 *
 * Computed rather than listed, from `canAssignOrgRole` — which answers the
 * question by capability containment, not by position in a seniority list. That
 * matters here because Phase 2's roles do not nest: `FINANCE` and `EVENT_MANAGER`
 * are peers with disjoint powers, and neither may grant the other.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId Which organisation.
 * @returns {string[]} Grantable roles, most senior first.
 */
export function assignableRoles(actor, organizationId) {
  const held = orgRoleFor(actor, organizationId)

  if (!held) return []

  return ORG_ROLE_ORDER.filter((role) => role !== 'OWNER' && canAssignOrgRole(held, role)).reverse()
}

/**
 * Refuse a role the caller may not grant.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId Which organisation.
 * @param {string} role The role being granted.
 * @returns {void}
 * @throws {Error} A 403 when the caller may not grant it.
 */
function assertMayGrant(actor, organizationId, role) {
  if (assignableRoles(actor, organizationId).includes(role)) return

  throw forbidden(
    `Your role in this organisation cannot grant ${role}. You can grant: ` +
      `${assignableRoles(actor, organizationId).join(', ') || 'no roles'}.`,
  )
}

/**
 * Refuse an action against somebody whose role outranks the caller's grant.
 *
 * Distinct from {@link assertMayGrant}, and both are needed: granting `STAFF` is
 * a power the caller might have, and using it on the organisation's `ADMIN` is
 * not. Without this check a `MANAGER` could demote an `ADMIN` to `STAFF` and then
 * grant themselves whatever they liked.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId Which organisation.
 * @param {string} targetRole The role the target currently holds.
 * @returns {void}
 * @throws {Error} A 403 when the caller has no power over the target.
 */
function assertMayActOn(actor, organizationId, targetRole) {
  const held = orgRoleFor(actor, organizationId)

  if (held && canAssignOrgRole(held, targetRole)) return

  throw forbidden(`Your role in this organisation cannot act on a ${targetRole}.`)
}

/**
 * Register the `/v1/organizations/:id/members` and invitation routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {{max?: number, timeWindow?: string|number}} [deps.authLimit] Overrides for the invitation rate limit.
 * @param {function(object): Promise<void>} [deps.deliver] Where an invitation link is sent.
 * @returns {void} Nothing.
 */
export function registerTeamRoutes(app, { prisma, authLimit, deliver }) {
  const limit = { rateLimit: authRateLimit(authLimit) }

  /**
   * Load the organisation, refusing a caller who has no business in it.
   *
   * The capability check runs against this organisation specifically, so holding
   * `team:invite` somewhere else is not holding it here. That is the whole of
   * tenant isolation for these routes, and it is one line because the permissions
   * package takes a scope.
   *
   * @param {object} request The incoming request.
   * @param {string} capability The capability required.
   * @returns {Promise<object>} The organisation row.
   * @throws {Error} A 404 when it does not exist, a 403 when the caller may not act in it.
   */
  async function organizationFor(request, capability) {
    const organizationId = request.params.id
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } })

    if (!organization) throw notFound('No such organisation.')

    assertCan(request.actor, capability, { organizationId })

    return organization
  }

  /**
   * How many owners an organisation has.
   *
   * @param {object} tx A Prisma client or transaction client.
   * @param {string} organizationId Which organisation.
   * @returns {Promise<number>} The count.
   */
  function ownerCount(tx, organizationId) {
    return tx.membership.count({ where: { organizationId, role: 'OWNER' } })
  }

  /**
   * Replace a member's event scopes.
   *
   * Scopes are kept for the event-scoped door roles — MANAGER, STAFF and
   * SCANNER — and for nobody else. Those three may admit only to the events a
   * scope names; OWNER and ADMIN admit across the organisation and need none;
   * every other role cannot admit at all. So a promotion to ADMIN, or a demotion
   * to VIEWER, leaves no scopes behind to be re-inherited later. See
   * `@desi-event/permissions/admission` for the policy.
   *
   * Until the admission work only SCANNER kept scopes, which was harmless while
   * nothing read them. Now that the door enforces them, STAFF and MANAGER would
   * otherwise have been unable to admit anybody at all.
   *
   * ## A requested event that is not this organisation's is refused
   *
   * It used to be dropped without a word and the route answered `{ ok: true }`,
   * so an administrator could believe a scanner was scoped to an event it was
   * not — and find out at the door. The table now refuses such a row too
   * (`desi_scanner_scope_same_organization`); this is the readable version of
   * that refusal.
   *
   * @param {object} tx A transaction client.
   * @param {object} options Options.
   * @param {object} options.membership The membership row, already updated.
   * @param {string[]} options.eventIds Events to scope to.
   * @param {string} options.organizationId The organisation, for scoping the event lookup.
   * @returns {Promise<string[]>} The event ids scoped.
   * @throws {Error} A 422 when a requested event is not one of this organisation's.
   */
  async function setScannerScopes(tx, { membership, eventIds, organizationId }) {
    const wanted = requiresAdmissionScope(membership.role) ? [...new Set(eventIds)] : []

    const events = wanted.length
      ? await tx.event.findMany({
          where: { id: { in: wanted }, organizationId },
          select: { id: true },
        })
      : []

    if (events.length !== wanted.length) {
      throw unprocessable(
        `${wanted.length - events.length} of the requested events are not events of this organisation. ` +
          'A door scope can only name one of your own events.',
      )
    }

    await tx.scannerScope.deleteMany({ where: { membershipId: membership.id } })

    for (const event of events) {
      await tx.scannerScope.create({ data: { membershipId: membership.id, eventId: event.id } })
    }

    return events.map((event) => event.id)
  }

  defineRoute(app, 'teams.list', {
    handler: async (request) => {
      const organization = await organizationFor(request, CAPABILITIES.ORGANIZATION_VIEW_MEMBERS)

      const [memberships, invitations] = await Promise.all([
        prisma.membership.findMany({
          where: { organizationId: organization.id },
          include: { user: true, scannerScopes: true },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.invitation.findMany({
          where: { organizationId: organization.id, status: 'PENDING' },
          include: { invitedBy: true },
          orderBy: { createdAt: 'desc' },
        }),
      ])

      const emailVisibility = emailVisibilityFor(request.actor, organization.id)

      return {
        data: {
          emailVisibility,
          members: memberships.map((membership) => ({
            id: membership.id,
            userId: membership.userId,
            ...addressAt(membership.user.email, emailVisibility),
            displayName: membership.user.displayName,
            role: membership.role,
            capabilities: [
              ...new Set(
                Object.values(CAPABILITIES).filter((capability) =>
                  can(
                    { id: membership.userId, role: 'ATTENDEE', memberships: [membership] },
                    capability,
                    { organizationId: organization.id },
                  ),
                ),
              ),
            ].sort(),
            scopedEventIds: (membership.scannerScopes ?? []).map((scope) => scope.eventId),
            joinedAt: membership.createdAt.toISOString(),
            self: membership.userId === request.actor.id,
          })),
          invitations: invitations.map((invitation) => ({
            id: invitation.id,
            ...addressAt(invitation.email, emailVisibility),
            role: invitation.role,
            status: invitation.status,
            invitedByName: invitation.invitedBy?.displayName ?? null,
            expiresAt: invitation.expiresAt.toISOString(),
            createdAt: invitation.createdAt.toISOString(),
          })),
          assignableRoles: assignableRoles(request.actor, organization.id),
        },
      }
    },
  })

  defineRoute(app, 'teams.invite', {
    config: limit,
    handler: async (request) => {
      const organization = await organizationFor(request, CAPABILITIES.TEAM_INVITE)
      const { email, role, eventIds = [] } = request.body

      assertMayGrant(request.actor, organization.id, role)

      const existing = await prisma.user.findUnique({ where: { email } })

      if (existing) {
        const member = await prisma.membership.findUnique({
          where: {
            userId_organizationId: { userId: existing.id, organizationId: organization.id },
          },
        })

        if (member) throw conflict('That person is already in this organisation.')
      }

      const { secret, hash } = issueToken()
      const now = new Date()

      // Supersede rather than accumulate: two live links to the same address is
      // two ways in, and revoking one would leave the other working.
      const invitation = await prisma.$transaction(async (tx) => {
        await tx.invitation.updateMany({
          where: { organizationId: organization.id, email, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: now },
        })

        return tx.invitation.create({
          data: {
            organizationId: organization.id,
            email,
            role,
            tokenHash: hash,
            invitedById: request.actor.id,
            expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
          },
          include: { invitedBy: true },
        })
      })

      // The scopes cannot be attached yet — there is no membership until the
      // invitation is accepted — so they ride along on the audit record and are
      // applied by whoever sets the role next. Recorded rather than dropped, so
      // the intent is not lost silently.
      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'team.invited',
        entityType: 'Invitation',
        entityId: invitation.id,
        metadata: { organizationId: organization.id, role, requestedEventIds: eventIds },
      })

      if (typeof deliver === 'function') {
        await deliver({
          purpose: 'TEAM_INVITATION',
          email,
          token: secret,
          organizationName: organization.name,
          role,
        })
      } else {
        app.log.info(
          { invitationId: invitation.id, organizationId: organization.id },
          'issued a team invitation; no delivery provider is configured',
        )
      }

      return {
        data: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          invitedByName: invitation.invitedBy?.displayName ?? null,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
        },
      }
    },
  })

  defineRoute(app, 'teams.accept', {
    config: limit,
    handler: async (request) => {
      const invitation = await prisma.invitation.findUnique({
        where: { tokenHash: hashToken(request.body.token) },
        include: { organization: true },
      })

      // `tokenUsable` reads `usedAt`; an invitation records acceptance in
      // `acceptedAt` and `status`, so the shape is adapted rather than the
      // helper being taught about a second table.
      const { usable } = tokenUsable(
        invitation && {
          purpose: 'TEAM_INVITATION',
          expiresAt: invitation.expiresAt,
          usedAt: invitation.acceptedAt,
          revokedAt: invitation.revokedAt,
        },
        { purpose: 'TEAM_INVITATION' },
      )

      if (!invitation || !usable || invitation.status !== 'PENDING') {
        throw forbidden('This invitation is not valid any more. Ask for a new one.')
      }

      // The forwarding defence. An invitation is addressed to a person, not
      // bearer-payable to whoever holds the link.
      if (invitation.email.toLowerCase() !== request.currentUser.email.toLowerCase()) {
        throw forbidden(
          // Masked: whoever holds a forwarded link is by definition not the
          // person it was addressed to, and the address is not theirs to learn.
          // Enough of it survives for the right person to recognise which of
          // their accounts to use.
          `This invitation was sent to a different address. Sign in as ${maskRecipient(invitation.email)} to accept it.`,
        )
      }

      const membership = await prisma.$transaction(async (tx) => {
        // Conditional on PENDING: two simultaneous acceptances both read a
        // pending row, and only one of them writes.
        const { count } = await tx.invitation.updateMany({
          where: { id: invitation.id, status: 'PENDING' },
          data: {
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            acceptedByUserId: request.actor.id,
          },
        })

        if (count !== 1) throw conflict('This invitation has already been accepted.')

        const already = await tx.membership.findUnique({
          where: {
            userId_organizationId: {
              userId: request.actor.id,
              organizationId: invitation.organizationId,
            },
          },
        })

        if (already) {
          // Somebody invited to an organisation they already belong to. The
          // invitation is spent and the existing membership is left alone rather
          // than being silently changed — a role change is a different action
          // with a different capability behind it.
          return already
        }

        return tx.membership.create({
          data: {
            userId: request.actor.id,
            organizationId: invitation.organizationId,
            role: invitation.role,
            invitationId: invitation.id,
          },
        })
      })

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'team.invitation_accepted',
        entityType: 'Membership',
        entityId: membership.id,
        metadata: { organizationId: invitation.organizationId, role: membership.role },
      })

      return {
        data: {
          organizationId: invitation.organizationId,
          organizationName: invitation.organization.name,
          role: membership.role,
        },
      }
    },
  })

  defineRoute(app, 'teams.revokeInvitation', {
    handler: async (request) => {
      const organization = await organizationFor(request, CAPABILITIES.TEAM_INVITE)

      const invitation = await prisma.invitation.findFirst({
        where: { id: request.params.memberId, organizationId: organization.id },
      })

      if (!invitation) throw notFound('No such invitation.')

      await prisma.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      })

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'team.invitation_revoked',
        entityType: 'Invitation',
        entityId: invitation.id,
        metadata: { organizationId: organization.id },
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'teams.updateMember', {
    handler: async (request) => {
      const organization = await organizationFor(request, CAPABILITIES.TEAM_ROLE_MANAGE)
      const { role, eventIds = [] } = request.body

      const membership = await prisma.membership.findFirst({
        where: { id: request.params.memberId, organizationId: organization.id },
      })

      if (!membership) throw notFound('No such member.')

      // The self-escalation defence, and it is deliberately not a capability
      // check: somebody who can change roles can change roles, and the thing
      // they must not do is change their own.
      if (membership.userId === request.actor.id) {
        throw forbidden(
          'You cannot change your own role. Ask somebody else in the organisation to do it.',
        )
      }

      assertMayActOn(request.actor, organization.id, membership.role)
      assertMayGrant(request.actor, organization.id, role)

      const scoped = await prisma.$transaction(async (tx) => {
        if (membership.role === 'OWNER' && role !== 'OWNER') {
          // Counted inside the transaction, so two concurrent demotions cannot
          // both see two owners and both proceed.
          if ((await ownerCount(tx, organization.id)) <= 1) {
            throw unprocessable(
              'This is the only owner of the organisation. Make somebody else an owner first.',
            )
          }
        }

        const updated = await tx.membership.update({
          where: { id: membership.id },
          data: { role },
        })

        return setScannerScopes(tx, {
          membership: updated,
          eventIds,
          organizationId: organization.id,
        })
      })

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'team.role_changed',
        entityType: 'Membership',
        entityId: membership.id,
        metadata: {
          organizationId: organization.id,
          from: membership.role,
          to: role,
          scopedEventIds: scoped,
        },
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'teams.removeMember', {
    handler: async (request) => {
      const organization = await organizationFor(request, CAPABILITIES.TEAM_REMOVE)

      const membership = await prisma.membership.findFirst({
        where: { id: request.params.memberId, organizationId: organization.id },
      })

      if (!membership) throw notFound('No such member.')

      if (membership.userId === request.actor.id) {
        // Leaving an organisation is a reasonable thing to want and a different
        // action: it needs no capability, and it should not be reachable from the
        // route that removes other people.
        throw forbidden('You cannot remove yourself from an organisation here.')
      }

      assertMayActOn(request.actor, organization.id, membership.role)

      await prisma.$transaction(async (tx) => {
        if (membership.role === 'OWNER' && (await ownerCount(tx, organization.id)) <= 1) {
          throw unprocessable(
            'This is the only owner of the organisation. Make somebody else an owner first.',
          )
        }

        // The membership row is locked before its scopes are touched. A door
        // confirmation locks the same two rows in the same order — membership,
        // then scope — so the two cannot deadlock: whichever starts first
        // finishes, and the other sees what it did.
        await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "id" = ${membership.id} FOR UPDATE`

        // Scopes go with the membership. Prisma's cascade would handle it, and
        // doing it explicitly means the behaviour does not depend on a schema
        // detail somebody could change.
        await tx.scannerScope.deleteMany({ where: { membershipId: membership.id } })
        await tx.membership.delete({ where: { id: membership.id } })
      })

      // Every session that person holds keeps working: they still have an
      // account, they are simply no longer in this organisation. Their
      // capabilities are resolved per request, so the change takes effect on
      // their next one.
      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'team.member_removed',
        entityType: 'Membership',
        entityId: membership.id,
        metadata: {
          organizationId: organization.id,
          role: membership.role,
          userId: membership.userId,
          reason: request.body?.reason ?? null,
        },
      })

      return { ok: true }
    },
  })
}
