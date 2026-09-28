/**
 * The platform roles in words.
 *
 * Pure and import-free, because the client controls on the people and roles
 * screen need them and must not pull the permissions tables into the browser
 * (see `lib/browser-bundle.js`). The descriptions are read from the role table
 * in `packages/permissions/src/capabilities.js`; the test beside this file
 * holds every list here to the API's and the session policy's own.
 *
 * @module app/admin/users/platform-role-vocabulary
 */

/**
 * Every platform role, most powerful last.
 *
 * @type {ReadonlyArray<string>}
 */
export const PLATFORM_ROLES = Object.freeze([
  'ATTENDEE',
  'ORGANIZER',
  'SUPPORT',
  'MODERATOR',
  'FINANCE_ADMIN',
  'SUPER_ADMIN',
])

/**
 * Each platform role in words.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PLATFORM_ROLE_LABELS = Object.freeze({
  ATTENDEE: 'Attendee',
  ORGANIZER: 'Organiser',
  SUPPORT: 'Support',
  MODERATOR: 'Moderator',
  FINANCE_ADMIN: 'Finance administrator',
  SUPER_ADMIN: 'Super administrator',
})

/**
 * What each platform role may do, in a sentence.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PLATFORM_ROLE_DESCRIPTIONS = Object.freeze({
  ATTENDEE: 'Buys tickets. Holds nothing on the platform beyond their own account.',
  ORGANIZER:
    'The same as an attendee on the platform: what an organiser may do comes from their organisation roles.',
  SUPPORT: 'Reads orders to help people with them. Changes nothing.',
  MODERATOR: 'Reviews events and decides organisation verification.',
  FINANCE_ADMIN: 'Works payment reconciliation and the platform’s money records.',
  SUPER_ADMIN:
    'Everything on the platform, including changing anybody’s platform role and organisation membership.',
})

/**
 * The platform roles that need a second factor before they can work.
 *
 * @type {ReadonlyArray<string>}
 */
export const PRIVILEGED_PLATFORM_ROLES = Object.freeze([
  'SUPPORT',
  'MODERATOR',
  'FINANCE_ADMIN',
  'SUPER_ADMIN',
])

/**
 * Every organisation role, in the order a grant offers them: owner first,
 * because the direct grant exists above all for an organisation left without
 * one.
 *
 * @type {ReadonlyArray<string>}
 */
export const GRANTABLE_ORG_ROLES = Object.freeze([
  'OWNER',
  'ADMIN',
  'MANAGER',
  'EVENT_MANAGER',
  'FINANCE',
  'STAFF',
  'SCANNER',
  'VIEWER',
])

/**
 * The organisation roles that need a second factor before they can work.
 *
 * @type {ReadonlyArray<string>}
 */
export const PRIVILEGED_ORG_ROLES = Object.freeze([
  'OWNER',
  'ADMIN',
  'MANAGER',
  'EVENT_MANAGER',
  'FINANCE',
])

/**
 * A platform role in words.
 *
 * @param {string} role A platform role.
 * @returns {string} Its label.
 */
export function platformRoleLabel(role) {
  return PLATFORM_ROLE_LABELS[role] ?? role
}

/** The shortest and longest reason the API accepts for a platform change. */
export const REASON_LIMITS = Object.freeze({ min: 3, max: 500 })
