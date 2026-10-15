/**
 * Team management: who is in an organisation, and how they got there.
 *
 * The shapes are small; the rules they carry are not, and every one of them
 * exists because of a specific way this goes wrong:
 *
 *   - An invitation names a **role**, and the role a member may grant is bounded
 *     by what they themselves hold. Without that, a `MANAGER` invites somebody as
 *     `OWNER` and then asks them for the keys.
 *   - An invitation is addressed to an **email**, and accepting it requires being
 *     signed in as that address. Without that, a link forwarded to a colleague
 *     puts the wrong person in the organisation.
 *   - A member's role can be changed and their membership removed, and both are
 *     bounded the same way, plus one more: the last `OWNER` cannot be demoted or
 *     removed. An organisation with no owner is an organisation nobody can fix.
 *
 * @module @desi-event/schemas/teams
 */

import { z } from 'zod'

import { addressFree } from './addresses.js'
import { invitationDeliveryModeSchema, orgRoleSchema } from './enums.js'
import { cuidSchema, emailSchema, nonEmptyStringSchema, timestampSchema } from './primitives.js'

/**
 * Roles that may be invited or assigned.
 *
 * `OWNER` is deliberately absent. Ownership moves through
 * `teams.transferOwnership`, because "make this person an owner" and "stop
 * being the owner" are one action and doing half of it leaves an organisation
 * with two owners who each think the other is responsible. The only other ways
 * to an `OWNER` membership are creating an organisation, and an audited grant
 * by a platform super administrator (`platform.grantMembership`), which names
 * its reason. Accepting an organiser invitation from the team at The Desi Events makes
 * somebody the owner of a new organisation.
 *
 * The schema still accepts a role that posts events (event manager and up), so
 * an API client is told plainly why it cannot have one — 403
 * `POSTING_ROLE_NEEDS_PLATFORM` — rather than handed a validation error.
 *
 * @type {object}
 */
export const assignableOrgRoleSchema = orgRoleSchema.exclude(['OWNER'])

/** `POST /v1/organizations/:id/invitations`. */
export const inviteMemberRequestSchema = z.object({
  email: emailSchema,
  role: assignableOrgRoleSchema,
  // Door scopes. Only meaningful for MANAGER, STAFF and SCANNER, who may admit
  // only to the events a scope names; see `@desi-event/permissions/admission`.
  //
  // Recorded on the invitation's audit row and not yet applied on acceptance —
  // an invited door role starts with no scope, which admits nobody, and is
  // scoped by a role change afterwards. Known, and listed in the Phase 4
  // report's limitations.
  eventIds: z.array(cuidSchema).max(200).optional(),
})

/** `POST /v1/invitations/accept`. */
export const acceptInvitationRequestSchema = z.object({
  token: z
    .string()
    .min(16)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/, 'Expected a url-safe token'),
})

/** `PATCH /v1/organizations/:id/members/:memberId`. */
export const updateMemberRequestSchema = z.object({
  role: assignableOrgRoleSchema,
  // Replaces the member's door scopes. Kept for MANAGER, STAFF and SCANNER;
  // cleared for every other role. An id that is not this organisation's event
  // refuses the whole change with a 422.
  eventIds: z.array(cuidSchema).max(200).optional(),
})

/** `POST /v1/organizations/:id/members/:memberId/remove`. */
export const removeMemberRequestSchema = z.object({
  reason: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z.string().min(1).max(200),
    )
    .optional(),
})

/**
 * A member, as somebody who manages the team sees them.
 *
 * Carries the person's name and address because managing a team without them
 * is unworkable, and nothing else about their account: not their phone number,
 * not their platform role, not when they last signed in. Somebody who can
 * manage a team can see who is on it, which is not the same as being able to
 * read their profile. Everybody else gets `hiddenMemberSummarySchema`.
 */
export const memberSummarySchema = z.object({
  id: cuidSchema,
  userId: cuidSchema,
  email: emailSchema,
  displayName: nonEmptyStringSchema,
  role: orgRoleSchema,
  capabilities: z.array(z.string().min(1)),
  scopedEventIds: z.array(cuidSchema),
  joinedAt: timestampSchema,
  // True for the caller's own membership, so a UI can grey out the controls
  // that would remove them from their own organisation.
  self: z.boolean(),
  /**
   * Whether this member's role creates or publishes events (event manager,
   * manager, administrator, owner). Those roles are given by the team at
   * The Desi Events, not by the organisation.
   */
  postsEvents: z.boolean(),
  /**
   * The roles this caller may move this member to, decided by the server: a
   * role the caller could grant, never OWNER, and a role that posts events
   * only downwards, for somebody who already posts. Empty for the caller
   * themselves and for an owner. A screen offers exactly these.
   */
  roleChoices: z.array(orgRoleSchema),
})

/** An invitation that has not yet been accepted. */
export const invitationSummarySchema = z.object({
  id: cuidSchema,
  email: emailSchema,
  role: orgRoleSchema,
  status: z.string().min(1),
  invitedByName: nonEmptyStringSchema.nullish(),
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
  /**
   * How the invitation's code went out.
   *
   * `MANUAL`: shown once to whoever issued it, to hand over themselves.
   * `EMAIL`: sent by the delivery provider; nobody on the team saw it.
   * `null`: issued before delivery modes existed, which in this build means
   * nobody ever received a code. A screen says so and offers a new one.
   */
  deliveryMode: invitationDeliveryModeSchema.nullable(),
})

/**
 * How much of an address a team list carries.
 *
 * - `FULL`: the caller holds `team:role_manage` in this organisation through
 *   their own membership (ADMIN, OWNER) **and** confirmed their second factor
 *   within the `MEMBER_EMAIL_VIEW` window.
 * - `STEP_UP_REQUIRED`: the same caller, without the recent confirmation. No
 *   addresses; a screen can offer the step-up and ask again.
 * - `HIDDEN`: everybody else who may read the list. That is VIEWER, STAFF,
 *   EVENT_MANAGER, FINANCE and MANAGER, and a platform administrator reading
 *   another organisation's team. No addresses, and no way to get them here.
 *
 * SCANNER cannot read the list at all.
 *
 * @type {ReadonlyArray<string>}
 */
export const EMAIL_VISIBILITIES = Object.freeze(['FULL', 'STEP_UP_REQUIRED', 'HIDDEN'])

/**
 * A member, on a list whose addresses are hidden.
 *
 * `memberSummarySchema` without `email`, and with no stand-in in its place: the
 * default for a view that does not need an address is no field at all. The
 * object schema strips unknown keys, so an `email` or `emailMasked` a presenter
 * left in is removed before the response is written. The display name must not
 * carry an address either, because a name somebody typed their address into
 * would otherwise put back exactly what the list withholds.
 */
export const hiddenMemberSummarySchema = memberSummarySchema
  .omit({ email: true })
  .extend({ displayName: addressFree(nonEmptyStringSchema) })

/** An invitation, on a list whose addresses are hidden. The same rules. */
export const hiddenInvitationSummarySchema = invitationSummarySchema
  .omit({ email: true })
  .extend({ invitedByName: addressFree(nonEmptyStringSchema).nullish() })

/**
 * `GET /v1/organizations/:id/members`.
 *
 * Three shapes, told apart by `emailVisibility`. Which one a caller gets is
 * decided by the server and enforced by this schema, not by a stylesheet
 * hiding a column: the two without addresses have no field that could carry
 * one.
 */
export const memberListResponseSchema = z.object({
  data: z.discriminatedUnion('emailVisibility', [
    z.object({
      emailVisibility: z.literal('FULL'),
      members: z.array(memberSummarySchema),
      invitations: z.array(invitationSummarySchema),
      // The roles this caller may grant by invitation, computed from what they
      // hold: only roles that neither create nor publish events. A UI that
      // renders the full list and lets the server refuse is a UI that teaches
      // people the product is broken.
      assignableRoles: z.array(orgRoleSchema),
    }),
    z.object({
      emailVisibility: z.literal('STEP_UP_REQUIRED'),
      members: z.array(hiddenMemberSummarySchema),
      invitations: z.array(hiddenInvitationSummarySchema),
      assignableRoles: z.array(orgRoleSchema),
    }),
    z.object({
      emailVisibility: z.literal('HIDDEN'),
      members: z.array(hiddenMemberSummarySchema),
      invitations: z.array(hiddenInvitationSummarySchema),
      assignableRoles: z.array(orgRoleSchema),
    }),
  ]),
})

/**
 * A single-use code, exactly as `issueToken` mints it.
 *
 * Thirty-two random bytes in base64url: forty-three characters from the
 * url-safe alphabet. Pinned to that shape so a response can never carry
 * anything longer, shorter or differently encoded under this name — a digest,
 * say — by mistake.
 *
 * @type {object}
 */
export const invitationCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a 43-character url-safe code')

/**
 * How an invitation's code reached the person, as the one response that
 * carries it says.
 *
 * `MANUAL` (the default) carries the code, once: nothing sends it, so the
 * only way the invitee can get it is from whoever issued it. `EMAIL`
 * (DELIVERY_MODE=EMAIL with an SMTP server) carries `null` and cannot carry
 * anything else — the mail server delivered it,
 * and handing it to the inviter as well would make them a second holder for no
 * reason. A presenter that put a code on the EMAIL branch makes the response
 * fail its contract rather than leak.
 *
 * The same shape is returned by any route that issues a show-once code, so a
 * screen can handle all of them the same way.
 */
export const invitationDeliverySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('EMAIL'), invitationCode: z.null() }),
  z.object({ mode: z.literal('MANUAL'), invitationCode: invitationCodeSchema }),
])

/**
 * `POST /v1/organizations/:id/invitations` and its reissue.
 *
 * The only responses that ever carry an invitation code. It is sent with
 * `cache-control: no-store, private`, is never logged or audited, and only its
 * digest is stored, so it cannot be shown again.
 */
export const invitationResponseSchema = z.object({
  data: invitationSummarySchema.extend({ delivery: invitationDeliverySchema }),
})

/**
 * `POST /v1/organizations/:id/invitations/:memberId/reissue`.
 *
 * The same delivery block as an invitation, and the address only when the
 * caller may see addresses on the team list (`FULL`). A caller who reissues by
 * id without that visibility is told the new code and not who it is for —
 * otherwise reissuing would be a way to read the addresses the list withholds.
 * The inviter's name is address-free for the same reason.
 */
export const reissuedInvitationResponseSchema = z.object({
  data: invitationSummarySchema.omit({ email: true }).extend({
    email: emailSchema.optional(),
    invitedByName: addressFree(nonEmptyStringSchema).nullish(),
    delivery: invitationDeliverySchema,
  }),
})

/**
 * What the caller's session now requires, after they gained authority.
 *
 * Accepting a team or organiser invitation can make an account
 * privileged, and a privileged account must hold a second factor before any
 * guarded route will answer it. Saying so here lets a screen send the person to
 * set one up, rather than letting the next page refuse them without context.
 */
export const privilegeSessionSchema = z.object({
  mfaRequired: z.boolean(),
  mfaEnrolled: z.boolean(),
})

/** `POST /v1/invitations/accept`. */
export const acceptedInvitationResponseSchema = z.object({
  data: z.object({
    organizationId: cuidSchema,
    organizationName: nonEmptyStringSchema,
    role: orgRoleSchema,
    /**
     * False when the account already belonged to the organisation. The code
     * is spent either way; when this is false the existing role is unchanged,
     * nothing was gained, and no other session ended.
     */
    joined: z.boolean(),
    session: privilegeSessionSchema,
  }),
})

/** `POST /v1/organizations/:id/ownership`. */
export const transferOwnershipRequestSchema = z.object({
  /** The membership, in this organisation, that becomes its owner. */
  toMemberId: cuidSchema,
})

/**
 * The outcome of an ownership transfer: one owner in, one owner out.
 *
 * The previous owner is always an administrator afterwards. Keeping them on as
 * a second owner would be a different action — and this route exists because
 * doing half of "hand it over" leaves two owners who each think the other is
 * responsible.
 */
export const ownershipTransferredResponseSchema = z.object({
  data: z.object({
    organizationId: cuidSchema,
    ownerMembershipId: cuidSchema,
    previousOwnerMembershipId: cuidSchema,
    previousOwnerRole: z.literal('ADMIN'),
  }),
})
