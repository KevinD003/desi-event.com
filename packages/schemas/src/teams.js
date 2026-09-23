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
import { orgRoleSchema } from './enums.js'
import { cuidSchema, emailSchema, nonEmptyStringSchema, timestampSchema } from './primitives.js'

/**
 * Roles that may be invited or assigned.
 *
 * `OWNER` is deliberately absent. Ownership transfers through a route of its
 * own, because "make this person an owner" and "stop being the owner" are one
 * action and doing half of it leaves an organisation with two owners who each
 * think the other is responsible.
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
      // The roles this caller may grant, computed from what they hold. A UI
      // that renders the full list and lets the server refuse is a UI that
      // teaches people the product is broken.
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

/** `POST /v1/organizations/:id/invitations`. */
export const invitationResponseSchema = z.object({ data: invitationSummarySchema })

/** `POST /v1/invitations/accept`. */
export const acceptedInvitationResponseSchema = z.object({
  data: z.object({
    organizationId: cuidSchema,
    organizationName: nonEmptyStringSchema,
    role: orgRoleSchema,
  }),
})
