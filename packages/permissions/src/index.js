/**
 * Role-based access control for Desi-Event.
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
  ORG_ROLE_CAPABILITIES,
  ORG_ROLE_INHERITS,
  ORG_ROLE_ORDER,
  PLATFORM_ONLY_CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  PLATFORM_ROLE_ORDER,
  assertAcyclic,
  canAssignOrgRole,
  findRoleCycle,
  isCapability,
  orgRoleRank,
  platformRoleRank,
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
  admissionAuthorityFor,
  assertAdmissionPolicy,
  requiresAdmissionScope,
} from './admission.js'
