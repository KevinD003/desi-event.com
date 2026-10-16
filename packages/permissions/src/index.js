/**
 * Role-based access control for The Desi Events.
 *
 * Pure logic with no dependencies: every export is a frozen table or a function
 * over plain objects, so authorization can be unit tested without a database
 * and reused unchanged by the API, the worker and the web app.
 *
 * @module @desi-event/permissions
 */

export {
  CAPABILITIES,
  ALL_CAPABILITIES,
  EVENT_AUTHORITY_CAPABILITIES,
  EVENT_POSTING_CAPABILITIES,
  EVENT_POSTING_ORG_ROLES,
  ORG_ROLE_CAPABILITIES,
  ORG_ROLE_INHERITS,
  ORG_ROLE_ORDER,
  OWNER_GRANTABLE_ORG_ROLES,
  PLATFORM_ADMINISTRATOR_CAPABILITIES,
  PLATFORM_ONLY_CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  PLATFORM_ROLE_ORDER,
  SUPER_ADMIN_ONLY_CAPABILITIES,
  assertAcyclic,
  assertPlatformAdministratorBounds,
  assertPostingPolicy,
  canAssignOrgRole,
  canIssueOrgRole,
  canMoveOrgRole,
  findRoleCycle,
  isCapability,
  orgRoleRank,
  platformRoleRank,
  postsEvents,
} from './capabilities.js'

export {
  can,
  assertCan,
  assertCanGrantOrgRole,
  canGrantOrgRole,
  capabilitiesFor,
  orgCapabilitiesFor,
  orgRoleFor,
} from './can.js'

export { PermissionError } from './errors.js'

export {
  ADMISSION_AUTHORITIES,
  EVENT_SCOPED_ADMISSION_ROLES,
  ORGANIZATION_WIDE_ADMISSION_ROLES,
  PLATFORM_ADMISSION_ROLES,
  REFUSED_PLATFORM_ADMISSION_ROLES,
  admissionAuthorityFor,
  assertAdmissionPolicy,
  assertPlatformAdmissionPolicy,
  platformAdmissionAuthorityFor,
  requiresAdmissionScope,
} from './admission.js'
