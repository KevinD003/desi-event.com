/**
 * Session lifetime: when a session is valid, when it must be rotated, and what
 * "log out everywhere" actually has to do.
 *
 * The policy lives here, apart from the database, for the reason that keeps
 * coming up in this repository: a rule expressed as a pure function can be tested
 * against every case, and a rule expressed as a query can only be tested against
 * the cases somebody thought to seed.
 *
 * Three ideas that are easy to conflate and are not the same thing:
 *
 *   - **Expiry.** A session stops working at a fixed time after it was created.
 *     Absolute, not sliding: a sliding expiry means a stolen cookie stays alive
 *     as long as the thief keeps using it, which is exactly backwards.
 *   - **Idle timeout.** A session that has not been seen for a while stops
 *     working sooner than its expiry. This is the one that limits the damage of
 *     an unattended browser, and it is checked against `lastSeenAt`.
 *   - **Rotation.** The session's *secret* is replaced while the session itself
 *     continues. Done on every privilege change — sign-in, password change, MFA
 *     enrolment, step-up — because a secret that was observed before the change
 *     must not carry the authority granted by it.
 *
 * @module @desi-event/auth/sessions
 */

/**
 * Session lifetimes.
 *
 * An attendee session lasts thirty days, which is what a consumer commerce site
 * needs to not be annoying. A session belonging to somebody who can move money or
 * publish an event lasts twelve hours and idles out in one, because the blast
 * radius is different and the people holding those roles are at a desk.
 *
 * @type {Readonly<{attendee: object, privileged: object}>}
 */
export const SESSION_LIFETIMES = Object.freeze({
  attendee: Object.freeze({
    absoluteMs: 30 * 24 * 60 * 60 * 1000,
    idleMs: 14 * 24 * 60 * 60 * 1000,
    rotateAfterMs: 24 * 60 * 60 * 1000,
  }),
  privileged: Object.freeze({
    absoluteMs: 12 * 60 * 60 * 1000,
    idleMs: 60 * 60 * 1000,
    rotateAfterMs: 60 * 60 * 1000,
  }),
})

/**
 * How long a step-up authentication satisfies a sensitive action.
 *
 * Fifteen minutes. Long enough to approve a batch of refunds without
 * re-authenticating for each one; short enough that walking away from the desk
 * does not leave the authority lying around.
 *
 * @type {number}
 */
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000

/**
 * Platform roles whose sessions get the short lifetime and require a second
 * factor.
 *
 * Membership in an organisation is handled separately — see
 * {@link sessionPolicyFor} — because an organiser's authority comes from a
 * membership rather than from a platform role.
 *
 * @type {Set<string>}
 */
export const PRIVILEGED_PLATFORM_ROLES = new Set([
  'SUPPORT',
  'MODERATOR',
  'FINANCE_ADMIN',
  'SUPER_ADMIN',
])

/**
 * Organisation roles whose sessions get the short lifetime and require a second
 * factor.
 *
 * `SCANNER` is deliberately absent. A scanner's session lives on a phone at a
 * venue door for a whole evening, and its authority is "admit this ticket" in one
 * event — locking it out after an hour idle would stop the queue, and requiring a
 * TOTP code from a volunteer at a gate is a policy that gets worked around by
 * sharing one logged-in phone. `VIEWER` and `STAFF` are absent for the plainer
 * reason that they cannot change anything.
 *
 * @type {Set<string>}
 */
export const PRIVILEGED_ORG_ROLES = new Set([
  'OWNER',
  'ADMIN',
  'MANAGER',
  'EVENT_MANAGER',
  'FINANCE',
])

/**
 * The session policy for an actor.
 *
 * @param {object|null|undefined} actor The actor, with `role` and `memberships`.
 * @returns {{privileged: boolean, lifetimes: object, mfaRequired: boolean}} The policy.
 */
export function sessionPolicyFor(actor) {
  const platform = PRIVILEGED_PLATFORM_ROLES.has(actor?.role)
  const organisational = (actor?.memberships ?? []).some((membership) =>
    PRIVILEGED_ORG_ROLES.has(membership.role),
  )
  const privileged = platform || organisational

  return {
    privileged,
    lifetimes: privileged ? SESSION_LIFETIMES.privileged : SESSION_LIFETIMES.attendee,
    // Required for anybody who can moderate, refund, pay out or publish. This is
    // a requirement on the *session*, not a claim that every such account has
    // enrolled: an account that must have a second factor and has not is told to
    // enrol, and cannot reach a privileged route until it has.
    mfaRequired: privileged,
  }
}

/**
 * Whether a session row may authenticate a request.
 *
 * Returns a reason rather than a boolean so the caller can tell the difference
 * between "sign in again" and "your session was ended on another device", and so
 * the audit record says which.
 *
 * @param {object|null|undefined} session A `Session` row.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The current time.
 * @param {object} [options.lifetimes] The lifetimes to apply, from {@link sessionPolicyFor}.
 * @returns {{valid: boolean, reason: string|null}} The outcome.
 */
export function sessionUsable(session, { now = new Date(), lifetimes = null } = {}) {
  if (!session) return { valid: false, reason: 'unknown' }
  if (session.revokedAt) return { valid: false, reason: 'revoked' }

  if (!(session.expiresAt instanceof Date)) return { valid: false, reason: 'malformed' }
  if (session.expiresAt.getTime() <= now.getTime()) return { valid: false, reason: 'expired' }

  const idleMs = lifetimes?.idleMs

  if (idleMs && session.lastSeenAt instanceof Date) {
    if (now.getTime() - session.lastSeenAt.getTime() > idleMs) {
      return { valid: false, reason: 'idle' }
    }
  }

  return { valid: true, reason: null }
}

/**
 * Whether a session's secret is old enough to replace.
 *
 * Rotation on a schedule, separate from rotation on a privilege change. Both
 * exist: the scheduled one limits how long a secret captured from a log or a
 * proxy stays useful, and the event-driven one stops an old secret inheriting new
 * authority.
 *
 * @param {object} session A `Session` row.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The current time.
 * @param {object} [options.lifetimes] The lifetimes to apply.
 * @returns {boolean} True when the secret should be replaced on this request.
 */
export function shouldRotate(session, { now = new Date(), lifetimes = null } = {}) {
  const after = lifetimes?.rotateAfterMs
  if (!after) return false

  const since = session?.rotatedAt ?? session?.createdAt
  if (!(since instanceof Date)) return true

  return now.getTime() - since.getTime() >= after
}

/**
 * Whether a session has satisfied step-up authentication recently enough.
 *
 * @param {object|null|undefined} session A `Session` row.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The current time.
 * @param {number} [options.windowMs] How long a step-up lasts.
 * @returns {boolean} True when a sensitive action may proceed without re-authenticating.
 */
export function stepUpSatisfied(session, { now = new Date(), windowMs = STEP_UP_WINDOW_MS } = {}) {
  const at = session?.mfaSatisfiedAt

  if (!(at instanceof Date)) return false

  return now.getTime() - at.getTime() <= windowMs
}

/**
 * Reasons a session was revoked.
 *
 * Recorded on the row, so that "why am I signed out" has an answer and so the
 * security-event log can distinguish a password change from an administrative
 * action.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const REVOCATION_REASONS = Object.freeze({
  SIGNED_OUT: 'signed_out',
  SIGNED_OUT_EVERYWHERE: 'signed_out_everywhere',
  PASSWORD_CHANGED: 'password_changed',
  PASSWORD_RESET: 'password_reset',
  MFA_CHANGED: 'mfa_changed',
  DEVICE_REVOKED: 'device_revoked',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ROTATED: 'rotated',
  ADMINISTRATIVE: 'administrative',
})

/**
 * The events that must end every other session an account has.
 *
 * "Log out everywhere" is the obvious one. The other three are the ones that get
 * forgotten, and they matter more: after a password change or reset, a session
 * established with the *old* password must stop working, or changing your password
 * because somebody else knows it accomplishes nothing. The same goes for a second
 * factor being added or removed.
 *
 * @type {string[]}
 */
export const REVOKE_ALL_REASONS = Object.freeze([
  REVOCATION_REASONS.SIGNED_OUT_EVERYWHERE,
  REVOCATION_REASONS.PASSWORD_CHANGED,
  REVOCATION_REASONS.PASSWORD_RESET,
  REVOCATION_REASONS.MFA_CHANGED,
  REVOCATION_REASONS.ACCOUNT_SUSPENDED,
])

/**
 * Whether an event must end every other session the account has.
 *
 * @param {string} reason One of {@link REVOCATION_REASONS}.
 * @returns {boolean} True when sibling sessions must be revoked.
 */
export function revokesSiblings(reason) {
  return REVOKE_ALL_REASONS.includes(reason)
}
