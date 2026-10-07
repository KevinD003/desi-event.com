/**
 * Team management.
 *
 * Eight routes, and almost all of the code is about the four ways this is attacked.
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
 *      organisation whose record nobody can change. Closed by locking the owner
 *      rows and then counting them inside the transaction that would change one
 *      (`lib/memberships.js`) — counting without the lock let two concurrent
 *      demotions of two different owners each see two and both proceed.
 *   4. **Invitation replay and forwarding.** A code is used twice, or passed on to
 *      somebody else. Closed by a conditional update on `status: PENDING`, and by
 *      requiring the accepting session to be signed in as the invited address.
 *
 * The code itself is a bearer-ish secret bound to an address. In
 * `DELIVERY_MODE` MANUAL (the default) it is returned once, in the 201 that
 * minted it, to whoever issued it; in EMAIL (DELIVERY_MODE=EMAIL with an SMTP
 * server) it is emailed and never returned. Either way it is never logged,
 * audited or stored — only its digest is. `lib/delivery.js` holds that rule.
 *
 * A fifth, quieter one runs through every route: **cross-tenant access.** Every
 * query is scoped by `organizationId` in the same `where` clause that finds the
 * row, so a membership id from another organisation is not found rather than
 * found-and-refused. The difference matters: 403 confirms the id exists.
 *
 * And a sixth: **who posts events is decided by the Desi-Event team.** A role
 * that creates or publishes events (event manager, manager, administrator,
 * owner) is never offered by a team invitation, and a member is moved to one
 * only downwards, from a role that already posts. The new posters come from an
 * organiser invitation or a super administrator's direct grant. Every refusal
 * of that kind is 403 `POSTING_ROLE_NEEDS_PLATFORM`, decided again on locked
 * rows, and the database refuses a waiting team invitation for such a role.
 *
 * @module @desi-event/api/routes/teams
 */

import {
  hashToken,
  issueToken,
  sessionPolicyFor,
  stepUpSatisfied,
  stepUpWindowFor,
  tokenUsable,
} from '@desi-event/auth'
import {
  ORG_ROLE_ORDER,
  assertCan,
  canAssignOrgRole,
  canMoveOrgRole,
  orgCapabilitiesFor,
  orgRoleFor,
  postsEvents,
  CAPABILITIES,
  can,
} from '@desi-event/permissions'
import { withoutAddresses } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import {
  DELIVERY_MODES,
  addressCandidates,
  assertRecipientDailyCap,
  deliverOrWithdraw,
  isSameAddress,
} from '../lib/delivery.js'
import {
  POSTING_ROLE_SENTENCE,
  conflict,
  databaseErrorCode,
  forbidden,
  httpError,
  notFound,
} from '../lib/errors.js'
import { assertNotLastOwner, lockMembership, setScannerScopes } from '../lib/memberships.js'
import {
  revokeAllSessionsOf,
  revokeOtherSessionsOf,
  rotateOwnSession,
  secureSessionAfterGain,
  hasConfirmedFactor,
} from '../lib/privilege-change.js'
import { defineRoute } from '../lib/register.js'
import { authRateLimit } from '../plugins/rate-limit.js'

/**
 * The step-up policy that stands between a team manager and full addresses.
 *
 * Its window is in `@desi-event/auth`, with every other policy's.
 */
export const MEMBER_EMAIL_STEP_UP = 'MEMBER_EMAIL_VIEW'

/**
 * How much of each address a caller may see on the team list.
 *
 * `FULL` needs two things, and both are read on the server:
 *
 * 1. **Authority to manage the membership, held through the caller's own
 *    membership of this organisation.** That is `team:role_manage`, which
 *    ADMIN holds and OWNER inherits. It is read from the membership alone
 *    (`orgCapabilitiesFor`), not from `can`, because `can` also answers yes to
 *    a platform role that holds the capability everywhere. A platform
 *    administrator reading an organisation's team is not managing it, and this
 *    list is not the explicit, audited path such a person would need. MANAGER
 *    can invite, but does not manage who stays, so it is not enough either.
 * 2. **A second factor confirmed within the `MEMBER_EMAIL_VIEW` window.**
 *    Signing in with one counts. Without it the answer is `STEP_UP_REQUIRED`:
 *    the same list with no addresses, which a screen can follow with the
 *    step-up prompt and a second request.
 *
 * Everybody else who may read the list gets `HIDDEN`: no address field at
 * all. That is VIEWER, STAFF, EVENT_MANAGER, FINANCE and MANAGER, and a
 * platform super administrator who is not a member. A VIEWER or STAFF session needs
 * no second factor and lives longer than a privileged one, and a roster of
 * addresses is the most useful thing on this page to whoever takes one over.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId The organisation.
 * @param {object|null|undefined} session The request's session row.
 * @param {Date} [now] The current time.
 * @returns {'FULL'|'STEP_UP_REQUIRED'|'HIDDEN'} The visibility.
 */
export function emailVisibilityFor(actor, organizationId, session, now = new Date()) {
  const managesMembership = orgCapabilitiesFor(actor, organizationId).includes(
    CAPABILITIES.TEAM_ROLE_MANAGE,
  )

  if (!managesMembership) return 'HIDDEN'

  const confirmed = stepUpSatisfied(session, {
    now,
    windowMs: stepUpWindowFor(MEMBER_EMAIL_STEP_UP),
  })

  return confirmed ? 'FULL' : 'STEP_UP_REQUIRED'
}

/**
 * The address field of a member or invitation, at a visibility.
 *
 * The only place a team response decides whether an address is shown. At any
 * visibility but `FULL` it returns no field, not a stand-in: the list does not
 * need even the domain. The response schema enforces the decision again: the
 * hidden shapes have no field that could carry an address, and refuse a name
 * that does.
 *
 * @param {string} address The stored address.
 * @param {'FULL'|'STEP_UP_REQUIRED'|'HIDDEN'} visibility From {@link emailVisibilityFor}.
 * @returns {{email: string}|{}} The field, or nothing.
 */
function addressAt(address, visibility) {
  return visibility === 'FULL' ? { email: address } : {}
}

/**
 * A name shown on the team list, at a visibility.
 *
 * Names are free text, and somebody may have typed their address as theirs.
 * On a list whose addresses are hidden, that would hand back what the list
 * withholds, so any address in a name is replaced with `Hidden email` first.
 *
 * @param {string|null|undefined} name The stored name.
 * @param {'FULL'|'STEP_UP_REQUIRED'|'HIDDEN'} visibility From {@link emailVisibilityFor}.
 * @returns {string|null|undefined} The name to show.
 */
function nameAt(name, visibility) {
  return visibility === 'FULL' ? name : withoutAddresses(name)
}

/** How long an invitation stays acceptable. */
export const INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000

/**
 * An invitation as every team response shows it.
 *
 * One presenter for the list, the invite and the reissue, so how the code went
 * out (`deliveryMode`) is reported the same way everywhere. It never carries
 * the code or its digest: the code exists only in the one response that minted
 * it, added beside this by the route, and the digest is nobody's business.
 *
 * @param {object} invitation The invitation row, with `invitedBy` included.
 * @param {'FULL'|'STEP_UP_REQUIRED'|'HIDDEN'} visibility How much of an address the caller may see.
 * @returns {object} The summary.
 */
export function toInvitationSummary(invitation, visibility) {
  return {
    id: invitation.id,
    ...addressAt(invitation.email, visibility),
    role: invitation.role,
    status: invitation.status,
    invitedByName: nameAt(invitation.invitedBy?.displayName ?? null, visibility),
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    deliveryMode: invitation.deliveryMode ?? null,
  }
}

/**
 * Whether an error is the database refusing a second live invitation.
 *
 * `Invitation_one_pending_per_address` is a partial unique index, so the
 * refusal arrives as a unique violation — `P2002` from Prisma, or `23505`
 * straight from the driver.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True when it was a unique violation.
 */
function isUniqueViolation(error) {
  const code = databaseErrorCode(error)

  return code === 'P2002' || code === '23505'
}

/** The refusal for two invitations to one address issued at the same moment. */
const CONCURRENT_INVITATION =
  'Another invitation to that address was issued at the same moment. Reload the team page to see it.'

/** The refusal for an organiser invitation code typed where a team code goes. */
export const WRONG_INVITATION_KIND_SENTENCE =
  'That is an organiser invitation code. Enter it at Your account → Accept an organiser invitation (/account/organizations/new).'

/** The refusal for handing ownership to somebody who does not create events here. */
export const HEIR_MUST_POST_EVENTS_SENTENCE =
  'Ownership can go only to somebody who already creates events here — an event manager, manager or administrator.'

/**
 * The roles a caller may grant in an organisation by a team invitation.
 *
 * Computed rather than listed, from `canAssignOrgRole` — which answers the
 * question by capability containment, not by position in a seniority list. That
 * matters here because Phase 2's roles do not nest: `FINANCE` and `EVENT_MANAGER`
 * are peers with disjoint powers, and neither may grant the other. Roles that
 * create or publish events are never in it: those come from the Desi-Event
 * team, so an owner can offer exactly FINANCE, STAFF, SCANNER and VIEWER.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId Which organisation.
 * @returns {string[]} Grantable roles, most senior first.
 */
export function assignableRoles(actor, organizationId) {
  const held = orgRoleFor(actor, organizationId)

  if (!held) return []

  return ORG_ROLE_ORDER.filter(
    (role) => role !== 'OWNER' && !postsEvents(role) && canAssignOrgRole(held, role),
  ).reverse()
}

/**
 * The refusal for a role that creates or publishes events.
 *
 * @returns {Error} A 403 `POSTING_ROLE_NEEDS_PLATFORM`.
 */
function postingRoleRefusal() {
  return httpError(403, 'POSTING_ROLE_NEEDS_PLATFORM', POSTING_ROLE_SENTENCE)
}

/**
 * The roles a caller may move one member to.
 *
 * Empty for the caller themselves and for an owner (ownership is handed over,
 * not reassigned), and for a caller who does not manage roles here through
 * their own membership or has no power over the member's role. Otherwise every
 * role {@link canMoveOrgRole} allows: one the caller could grant, and a role
 * that posts events only downwards, for somebody who already posts. It includes
 * the member's current role, so a screen can show it selected.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId Which organisation.
 * @param {{userId: string, role: string}} membership The member.
 * @returns {string[]} The roles, most senior first.
 */
export function roleChoicesFor(actor, organizationId, membership) {
  if (membership.userId === actor.id || membership.role === 'OWNER') return []

  const held = orgRoleFor(actor, organizationId)

  if (!held) return []
  if (!orgCapabilitiesFor(actor, organizationId).includes(CAPABILITIES.TEAM_ROLE_MANAGE)) return []
  if (!canAssignOrgRole(held, membership.role)) return []

  return ORG_ROLE_ORDER.filter((role) => canMoveOrgRole(held, membership.role, role)).reverse()
}

/**
 * Refuse a move the caller may not make.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId Which organisation.
 * @param {string} fromRole The member's role now.
 * @param {string} toRole The role asked for.
 * @returns {void}
 * @throws {Error} 403 `POSTING_ROLE_NEEDS_PLATFORM` for a refused move to a role that posts events, a 403 otherwise.
 */
function assertMayMove(actor, organizationId, fromRole, toRole) {
  const held = orgRoleFor(actor, organizationId)

  if (held && canMoveOrgRole(held, fromRole, toRole)) return

  if (postsEvents(toRole)) throw postingRoleRefusal()

  throw forbidden(
    `Your role in this organisation cannot grant ${toRole}. You can grant: ` +
      `${assignableRoles(actor, organizationId).join(', ') || 'no roles'}.`,
  )
}

/**
 * Refuse a role the caller may not grant by invitation.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId Which organisation.
 * @param {string} role The role being granted.
 * @returns {void}
 * @throws {Error} 403 `POSTING_ROLE_NEEDS_PLATFORM` for a role that posts events; a 403 when the caller may not grant it.
 */
function assertMayGrant(actor, organizationId, role) {
  if (postsEvents(role)) throw postingRoleRefusal()

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
 * @param {function(object): Promise<void>} [deps.deliver] Where an invitation code is sent, in EMAIL mode.
 * @param {'MANUAL'|'EMAIL'} [deps.deliveryMode] How codes reach people, resolved once by `buildApp`.
 * @returns {void} Nothing.
 */
export function registerTeamRoutes(app, { prisma, authLimit, deliver, deliveryMode }) {
  // The credential budget, keyed on the signed-in account rather than the
  // address. Every one of these routes needs a session, and every browser
  // request reaches the API through the web app's same-origin proxy — so keyed
  // by address, the whole site shared one budget of ten invitations, new codes
  // or acceptances a minute, and one busy team could lock everybody else out.
  // Run at `preHandler`, after the session guard, so the account is known.
  const limit = {
    rateLimit: {
      ...authRateLimit(authLimit),
      hook: 'preHandler',
      keyGenerator: (request) =>
        request.actor?.id ? `team:actor:${request.actor.id}` : `team:ip:${request.ip}`,
    },
  }
  const mode = deliveryMode ?? app.deliveryMode ?? DELIVERY_MODES.MANUAL

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
   * Take back a team invitation whose code could not be emailed.
   *
   * @param {string} invitationId The invitation just issued.
   * @param {string} organizationId Its organisation.
   * @param {string} actorId Who issued it.
   * @returns {Promise<void>}
   */
  function withdrawAfterFailedDelivery(invitationId, organizationId, actorId) {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.invitation.updateMany({
        where: { id: invitationId, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      })

      if (count !== 1) return

      await recordAudit(tx, {
        actorId,
        action: AUDIT_ACTIONS.TEAM_INVITATION_DELIVERY_FAILED,
        entityType: 'Invitation',
        entityId: invitationId,
        metadata: { organizationId, deliveryMode: DELIVERY_MODES.EMAIL },
      })
    })
  }

  /**
   * Hand a freshly minted code to whoever should have it, and say how.
   *
   * In EMAIL mode a send the mail server refuses withdraws the invitation and
   * answers 503 `DELIVERY_FAILED`, so no live code is left that nobody holds.
   *
   * @param {object} options Options.
   * @param {object} options.request The request, for the log and the actor.
   * @param {string} options.secret The code, which exists only in memory.
   * @param {object} options.reply The reply, for the cache headers.
   * @param {object} options.organization The organisation, for the provider's message.
   * @param {object} options.invitation The invitation row.
   * @returns {Promise<{mode: string, invitationCode: string|null}>} The `delivery` block.
   */
  function handOver({ request, secret, reply, organization, invitation }) {
    return deliverOrWithdraw({
      mode,
      secret,
      reply,
      deliver,
      log: request.log,
      message: {
        purpose: 'TEAM_INVITATION',
        email: invitation.email,
        organizationName: organization.name,
        // The letter says so when the Desi-Event team has not verified the
        // organisation the invitation comes from.
        organizationVerified: organization.verificationStatus === 'VERIFIED',
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
      },
      withdraw: () => withdrawAfterFailedDelivery(invitation.id, organization.id, request.actor.id),
    })
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

      const emailVisibility = emailVisibilityFor(request.actor, organization.id, request.session)

      return {
        data: {
          emailVisibility,
          members: memberships.map((membership) => ({
            id: membership.id,
            userId: membership.userId,
            ...addressAt(membership.user.email, emailVisibility),
            displayName: nameAt(membership.user.displayName, emailVisibility),
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
            postsEvents: postsEvents(membership.role),
            roleChoices: roleChoicesFor(request.actor, organization.id, membership),
          })),
          invitations: invitations.map((invitation) =>
            toInvitationSummary(invitation, emailVisibility),
          ),
          assignableRoles: assignableRoles(request.actor, organization.id),
        },
      }
    },
  })

  defineRoute(app, 'teams.invite', {
    config: limit,
    handler: async (request, reply) => {
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

      const now = new Date()
      const { secret, hash } = issueToken()

      let invitation

      try {
        invitation = await prisma.$transaction(async (tx) => {
          // In EMAIL mode, one address is sent at most three codes a day, so
          // this form cannot be used to fill a stranger's inbox. Counted here,
          // under a lock on the address, so codes sent to it at the same
          // moment take turns rather than all reading a count below three.
          if (mode === DELIVERY_MODES.EMAIL) await assertRecipientDailyCap(tx, { email, now })

          // Supersede rather than accumulate: two live codes to the same address
          // is two ways in, and revoking one would leave the other working. The
          // database holds the same rule (`Invitation_one_pending_per_address`),
          // which is what decides between two invitations issued at once.
          // Case-insensitive, as the index is: a row written before addresses
          // were lower-cased is still the same address. The filter can also
          // find look-alikes (`_` matches any one character in it), so only
          // the rows that are this address are superseded.
          const waiting = await tx.invitation.findMany({
            where: {
              organizationId: organization.id,
              email: addressCandidates(email),
              status: 'PENDING',
            },
            select: { id: true, email: true },
          })
          const superseded = waiting
            .filter((row) => isSameAddress(row.email, email))
            .map((row) => row.id)

          if (superseded.length > 0) {
            await tx.invitation.updateMany({
              where: { id: { in: superseded }, status: 'PENDING' },
              data: { status: 'REVOKED', revokedAt: now },
            })
          }

          const created = await tx.invitation.create({
            data: {
              organizationId: organization.id,
              email,
              role,
              tokenHash: hash,
              invitedById: request.actor.id,
              expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
              deliveryMode: mode,
            },
            include: { invitedBy: true },
          })

          // The scopes cannot be attached yet — there is no membership until the
          // invitation is accepted — so they ride along on the audit record and
          // are applied by whoever sets the role next. How the code went out is
          // recorded; the code and its digest never are.
          await recordAudit(tx, {
            actorId: request.actor.id,
            action: AUDIT_ACTIONS.TEAM_INVITED,
            entityType: 'Invitation',
            entityId: created.id,
            metadata: {
              organizationId: organization.id,
              role,
              requestedEventIds: eventIds,
              deliveryMode: mode,
            },
          })

          return created
        })
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict(CONCURRENT_INVITATION)

        throw error
      }

      const delivery = await handOver({ request, secret, reply, organization, invitation })

      // Identifiers and the mode, never the code: this line is read by
      // whoever is on call, and a code in it would be a way in for them.
      request.log.info(
        { invitationId: invitation.id, organizationId: organization.id, deliveryMode: mode },
        'issued a team invitation',
      )

      return { data: { ...toInvitationSummary(invitation, 'FULL'), delivery } }
    },
  })

  defineRoute(app, 'teams.reissueInvitation', {
    config: limit,
    handler: async (request, reply) => {
      const organization = await organizationFor(request, CAPABILITIES.TEAM_INVITE)

      // Scoped by organisation in the query that finds it, so an invitation of
      // another organisation is not found rather than found-and-refused.
      const current = await prisma.invitation.findFirst({
        where: { id: request.params.memberId, organizationId: organization.id },
      })

      if (!current) throw notFound('No such invitation.')

      if (current.status !== 'PENDING') {
        throw conflict(
          'This invitation is no longer outstanding, so there is no code to replace. Invite the person again instead.',
        )
      }

      // Bounded exactly like issuing one: a MANAGER cannot obtain a code for an
      // ADMIN invitation an owner created, because holding the code is holding
      // the invitation.
      assertMayGrant(request.actor, organization.id, current.role)

      const now = new Date()
      const { secret, hash } = issueToken()

      let invitation

      try {
        invitation = await prisma.$transaction(async (tx) => {
          // The recipient cap, as for a first invitation: in the transaction
          // that writes the new code, under the address lock.
          if (mode === DELIVERY_MODES.EMAIL) {
            await assertRecipientDailyCap(tx, { email: current.email, now })
          }

          // The old code dies in the same transaction the new one is born in,
          // and only if the invitation is still outstanding at that moment:
          // an acceptance or a withdrawal that got there first wins.
          const { count } = await tx.invitation.updateMany({
            where: { id: current.id, status: 'PENDING' },
            data: { status: 'REVOKED', revokedAt: now },
          })

          if (count !== 1) {
            throw conflict(
              'This invitation changed while the new code was being issued. Reload the team page.',
            )
          }

          const created = await tx.invitation.create({
            data: {
              organizationId: organization.id,
              email: current.email,
              role: current.role,
              tokenHash: hash,
              invitedById: request.actor.id,
              expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
              deliveryMode: mode,
            },
            include: { invitedBy: true },
          })

          await recordAudit(tx, {
            actorId: request.actor.id,
            action: AUDIT_ACTIONS.TEAM_INVITATION_REISSUED,
            entityType: 'Invitation',
            entityId: created.id,
            metadata: {
              organizationId: organization.id,
              role: created.role,
              supersedes: current.id,
              deliveryMode: mode,
            },
          })

          return created
        })
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict(CONCURRENT_INVITATION)

        throw error
      }

      const delivery = await handOver({ request, secret, reply, organization, invitation })

      request.log.info(
        {
          invitationId: invitation.id,
          supersedes: current.id,
          organizationId: organization.id,
          deliveryMode: mode,
        },
        'reissued a team invitation',
      )

      // The address only for a caller who may see addresses on the team list.
      // Everybody else reissues by id and is told the code, not who it is for:
      // otherwise this route would be a way to read the addresses the list
      // withholds from them.
      const visibility = emailVisibilityFor(request.actor, organization.id, request.session)

      return {
        data: {
          ...toInvitationSummary(invitation, 'HIDDEN'),
          ...(visibility === 'FULL' ? { email: invitation.email } : {}),
          delivery,
        },
      }
    },
  })

  defineRoute(app, 'teams.accept', {
    config: limit,
    handler: async (request, reply) => {
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

      if (!invitation) {
        // An organiser invitation's code typed in the wrong place. Whoever
        // holds it learns only what they already have, and it is not spent.
        const organizerInvitation = await prisma.organizerInvitation.findUnique({
          where: { tokenHash: hashToken(request.body.token) },
          select: { id: true },
        })

        if (organizerInvitation) {
          throw forbidden(WRONG_INVITATION_KIND_SENTENCE, 'WRONG_INVITATION_KIND')
        }
      }

      if (!invitation || !usable || invitation.status !== 'PENDING') {
        throw forbidden('This invitation is not valid any more. Ask for a new one.')
      }

      // The forwarding defence. An invitation is addressed to a person, not
      // bearer-payable to whoever holds the code.
      if (invitation.email.toLowerCase() !== request.currentUser.email.toLowerCase()) {
        throw forbidden(
          // No part of the address. Whoever holds a code passed on to them is
          // by definition not the person it was issued for, and the address is
          // not theirs to learn. The right person does not need it repeated.
          'This invitation was sent to a different address. Sign in with the address it was sent to, then enter the code again.',
        )
      }

      // An invitation written before the database refused them, offering a
      // role that creates or publishes events: refused, and not spent. Such a
      // role comes from the Desi-Event team.
      if (postsEvents(invitation.role)) throw postingRoleRefusal()

      const now = new Date()

      /**
       * Spend the invitation and join, in one transaction.
       *
       * @param {object} tx The transaction client.
       * @returns {Promise<{membership: object, created: boolean, siblingsRevoked: number}>} What happened.
       */
      const join = async (tx) => {
        // Conditional on PENDING: two simultaneous acceptances both read a
        // pending row, and only one of them writes.
        const { count } = await tx.invitation.updateMany({
          where: { id: invitation.id, status: 'PENDING' },
          data: {
            status: 'ACCEPTED',
            acceptedAt: now,
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

        // Somebody invited to an organisation they already belong to. The
        // invitation is spent and the existing membership is left alone rather
        // than being silently changed — a role change is a different action
        // with a different capability behind it — so nothing was gained and no
        // session needs to end.
        const joined =
          already ??
          (await tx.membership.create({
            data: {
              userId: request.actor.id,
              organizationId: invitation.organizationId,
              role: invitation.role,
              invitationId: invitation.id,
            },
          }))

        // Finding NF-10: the caller now holds authority their other sessions
        // were not opened under. They end in the transaction that granted it.
        const revoked = already ? 0 : await revokeOtherSessionsOf(tx, request, now)

        await recordAudit(tx, {
          actorId: request.actor.id,
          action: AUDIT_ACTIONS.TEAM_INVITATION_ACCEPTED,
          entityType: 'Membership',
          entityId: joined.id,
          metadata: {
            organizationId: invitation.organizationId,
            role: joined.role,
            siblingsRevoked: revoked,
          },
        })

        return { membership: joined, created: !already, siblingsRevoked: revoked }
      }

      // A super administrator's direct grant can add this account to the same
      // organisation at the same moment. The database refuses the second
      // membership; the whole acceptance rolls back — the code stays usable —
      // and the caller is told why rather than handed a server error.
      const { membership, created, siblingsRevoked } = await prisma
        .$transaction(join)
        .catch((error) => {
          if (isUniqueViolation(error)) {
            throw conflict(
              'You were added to this organisation by another route at the same moment. Reload to see your role.',
            )
          }

          throw error
        })

      const session = created
        ? await secureSessionAfterGain(app, prisma, { request, reply, now })
        : {
            mfaRequired: sessionPolicyFor(request.actor).mfaRequired,
            mfaEnrolled: await hasConfirmedFactor(prisma, request.actor.id),
          }

      request.log.info(
        {
          organizationId: invitation.organizationId,
          membershipId: membership.id,
          siblingsRevoked,
        },
        'accepted a team invitation',
      )

      return {
        data: {
          organizationId: invitation.organizationId,
          organizationName: invitation.organization.name,
          role: membership.role,
          joined: created,
          session: { mfaRequired: session.mfaRequired, mfaEnrolled: session.mfaEnrolled },
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

      // The withdrawal and its audit row commit together, and the row is
      // written only when something was withdrawn: withdrawing an invitation
      // that was already used, withdrawn or superseded changes nothing, and an
      // audit trail that says otherwise is wrong.
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.invitation.updateMany({
          where: { id: invitation.id, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: new Date() },
        })

        if (count !== 1) return

        await recordAudit(tx, {
          actorId: request.actor.id,
          action: 'team.invitation_revoked',
          entityType: 'Invitation',
          entityId: invitation.id,
          metadata: { organizationId: organization.id },
        })
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

      // Answered from the committed row first, so a plain refusal opens no
      // transaction. The decision that counts is made again below, from the
      // row as it is once locked.
      assertMayActOn(request.actor, organization.id, membership.role)
      assertMayMove(request.actor, organization.id, membership.role, role)

      await prisma.$transaction(async (tx) => {
        // Locked, then read again: an ownership transfer that committed since
        // the read above may have made this member an owner.
        const current = await lockMembership(tx, organization.id, { id: membership.id })

        if (!current) throw notFound('No such member.')

        assertMayActOn(request.actor, organization.id, current.role)
        // Decided again from the locked row: a move that was downwards when
        // read may not be once another change has landed.
        assertMayMove(request.actor, organization.id, current.role, role)

        if (current.role === 'OWNER' && role !== 'OWNER') {
          // The owner rows are locked before they are counted. Counting alone,
          // under READ COMMITTED, let two concurrent demotions of two different
          // owners each see two owners and both proceed, leaving none.
          await assertNotLastOwner(tx, organization.id)
        }

        const updated = await tx.membership.update({
          where: { id: current.id },
          data: { role },
        })

        const scoped = await setScannerScopes(tx, {
          membership: updated,
          eventIds,
          organizationId: organization.id,
        })

        await recordAudit(tx, {
          actorId: request.actor.id,
          action: 'team.role_changed',
          entityType: 'Membership',
          entityId: current.id,
          metadata: {
            organizationId: organization.id,
            from: current.role,
            to: role,
            scopedEventIds: scoped,
          },
        })
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

      // Answered from the committed row first; decided again below from the
      // locked one.
      assertMayActOn(request.actor, organization.id, membership.role)

      await prisma.$transaction(async (tx) => {
        // The membership row is locked before its scopes are touched. A door
        // confirmation locks the same two rows in the same order — membership,
        // then scope — so the two cannot deadlock: whichever starts first
        // finishes, and the other sees what it did. The owners are locked
        // before the membership (`lockMembership`), and its role is read again
        // once it is locked: an ownership transfer that committed since the
        // read above may have made this member the only owner.
        const current = await lockMembership(tx, organization.id, { id: membership.id })

        if (!current) throw notFound('No such member.')

        assertMayActOn(request.actor, organization.id, current.role)

        // Locked, then counted — see `lib/memberships.js`.
        if (current.role === 'OWNER') await assertNotLastOwner(tx, organization.id)

        // Scopes go with the membership. Prisma's cascade would handle it, and
        // doing it explicitly means the behaviour does not depend on a schema
        // detail somebody could change.
        await tx.scannerScope.deleteMany({ where: { membershipId: current.id } })
        await tx.membership.delete({ where: { id: current.id } })

        // Every session that person holds keeps working: they still have an
        // account, they are simply no longer in this organisation. Their
        // capabilities are resolved per request, so the change takes effect on
        // their next one.
        await recordAudit(tx, {
          actorId: request.actor.id,
          action: 'team.member_removed',
          entityType: 'Membership',
          entityId: current.id,
          metadata: {
            organizationId: organization.id,
            role: current.role,
            userId: current.userId,
            reason: request.body?.reason ?? null,
          },
        })
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'teams.transferOwnership', {
    handler: async (request, reply) => {
      const organization = await organizationFor(request, CAPABILITIES.ORGANIZATION_MANAGE)

      // Held through the caller's own membership, not through a platform role
      // that answers yes everywhere. A platform super administrator moving ownership
      // uses the audited direct grant, which names its reason; this route is
      // an owner handing on what is theirs.
      if (
        !orgCapabilitiesFor(request.actor, organization.id).includes(
          CAPABILITIES.ORGANIZATION_MANAGE,
        )
      ) {
        throw forbidden('Only an owner of this organisation can hand ownership on.')
      }

      const target = await prisma.membership.findFirst({
        where: { id: request.body.toMemberId, organizationId: organization.id },
      })

      if (!target) throw notFound('No such member.')

      if (target.userId === request.actor.id) {
        throw forbidden('You already own this organisation. Name somebody else to hand it to.')
      }

      const now = new Date()

      const outcome = await prisma.$transaction(async (tx) => {
        // Every owner row is locked first, then the heir's, so a concurrent
        // transfer, demotion or removal waits and then sees what this one did.
        // The heir is read again once locked: a removal that committed since
        // the read above leaves nobody to hand ownership to, and that is a 404
        // with nothing changed rather than a failed write.
        const heir = await lockMembership(tx, organization.id, { id: target.id })

        if (!heir) throw notFound('No such member.')

        // Ownership goes only to somebody who already creates events here, so
        // a transfer never makes somebody new a poster of events. Decided from
        // the locked row.
        if (!postsEvents(heir.role)) {
          throw httpError(422, 'HEIR_MUST_POST_EVENTS', HEIR_MUST_POST_EVENTS_SENTENCE)
        }

        const mine = await tx.membership.findFirst({
          where: { userId: request.actor.id, organizationId: organization.id },
        })

        // The swap is conditional on the caller still being an owner at this
        // moment: a concurrent change that demoted them wins, and this one
        // changes nothing.
        const demoted = await tx.membership.updateMany({
          where: { id: mine?.id ?? '', organizationId: organization.id, role: 'OWNER' },
          data: { role: 'ADMIN' },
        })

        if (demoted.count !== 1) {
          throw conflict('You are no longer an owner of this organisation. Reload and try again.')
        }

        const promoted = await tx.membership.update({
          where: { id: heir.id },
          data: { role: 'OWNER' },
        })

        // An owner admits everywhere, so a door scope would mean nothing; the
        // previous owner, now an administrator, needs none either.
        await setScannerScopes(tx, {
          membership: promoted,
          eventIds: [],
          organizationId: organization.id,
        })

        // The new owner signs in again under the role they now hold, and must
        // then have a second factor before the workspace will answer them.
        const sessionsRevoked = await revokeAllSessionsOf(tx, heir.userId, now)

        await recordAudit(tx, {
          actorId: request.actor.id,
          action: AUDIT_ACTIONS.TEAM_OWNERSHIP_TRANSFERRED,
          entityType: 'Membership',
          entityId: promoted.id,
          metadata: {
            organizationId: organization.id,
            fromUserId: request.actor.id,
            toUserId: heir.userId,
            toMembershipId: promoted.id,
            previousRole: heir.role,
            sessionsRevoked,
          },
        })

        return { ownerMembershipId: promoted.id, previousOwnerMembershipId: mine.id }
      })

      // The caller lost authority, which is already effective — capabilities
      // are read per request. Their cookie secret is replaced anyway, so no
      // secret from before a privilege change survives it.
      await rotateOwnSession(app, prisma, { request, reply, now })

      return {
        data: {
          organizationId: organization.id,
          ownerMembershipId: outcome.ownerMembershipId,
          previousOwnerMembershipId: outcome.previousOwnerMembershipId,
          previousOwnerRole: 'ADMIN',
        },
      }
    },
  })
}
