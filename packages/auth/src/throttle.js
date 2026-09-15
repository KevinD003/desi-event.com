/**
 * How many times somebody may be wrong, and what happens next.
 *
 * Two counters, because there are two attacks and they look nothing alike:
 *
 *   - **Credential stuffing against one account.** Many guesses at one email
 *     address. Counted per email digest; the answer is to lock that account's
 *     sign-in for a while.
 *   - **Spraying across many accounts.** One or two guesses at each of a
 *     thousand addresses, which never trips a per-account counter. Counted per IP
 *     digest, with a much higher threshold, because an office or a mobile carrier
 *     NAT puts many legitimate people behind one address.
 *
 * Both counters are backed by the `LoginAttempt` table rather than by memory, so
 * a restart does not reset the lockout and two API instances share one count. The
 * cost is a query per sign-in, which is nothing next to the ~100ms the password
 * hash costs anyway.
 *
 * The lockout is deliberately *not* an account state. There is no `lockedAt`
 * column, because a lock that persists is a denial-of-service anybody can inflict
 * on anybody by guessing wrong ten times. It is a rate, computed from recent
 * attempts, and it lapses on its own.
 *
 * @module @desi-event/auth/throttle
 */

/**
 * Thresholds.
 *
 * `perEmail` is five failures in fifteen minutes. Low, because a person who has
 * genuinely forgotten their password has a reset link and does not need a sixth
 * guess; and because five is more than typos and fewer than a dictionary.
 *
 * `perIp` is fifty in fifteen minutes, which a shared address will not reach by
 * accident and a spray will.
 *
 * @type {Readonly<{perEmail: {max: number, windowMs: number, lockoutMs: number}, perIp: {max: number, windowMs: number, lockoutMs: number}}>}
 */
export const THROTTLE = Object.freeze({
  perEmail: { max: 5, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 },
  perIp: { max: 50, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 },
})

/**
 * Outcomes recorded on a `LoginAttempt`.
 *
 * Enumerated so the column is analysable, and deliberately coarse: the row must
 * never record *which* password was tried, or the address it was tried against
 * in a readable form.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const LOGIN_OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  BAD_PASSWORD: 'bad_password',
  UNKNOWN_EMAIL: 'unknown_email',
  SUSPENDED: 'suspended',
  UNVERIFIED: 'unverified',
  MFA_REQUIRED: 'mfa_required',
  MFA_FAILED: 'mfa_failed',
  THROTTLED: 'throttled',
})

/**
 * Whether a sign-in attempt may proceed, given recent failures.
 *
 * Takes counts rather than a database client, so the policy is testable without
 * one and the caller decides how to count. The caller must count *failures since
 * the last success* for the email, not failures in the window: a successful
 * sign-in is proof the person is who they say they are, and it clears the count.
 *
 * @param {object} counts Recent failure counts.
 * @param {number} counts.emailFailures Failures for this email since its last success, within the window.
 * @param {number} counts.ipFailures Failures from this address within the window.
 * @param {Date|null} [counts.lastEmailFailureAt] When the most recent email failure was, for the retry hint.
 * @param {Date} [counts.now] The current time. Passed in rather than read from the clock, so this decision is reproducible.
 * @param {object} [policy] Override the thresholds.
 * @returns {{allowed: boolean, scope: string|null, retryAfterSeconds: number}} The decision.
 */
export function checkLoginThrottle(
  { emailFailures = 0, ipFailures = 0, lastEmailFailureAt = null, now = new Date() },
  policy = THROTTLE,
) {
  if (emailFailures >= policy.perEmail.max) {
    const since =
      lastEmailFailureAt instanceof Date ? now.getTime() - lastEmailFailureAt.getTime() : 0
    const remaining = Math.max(0, policy.perEmail.lockoutMs - since)

    return {
      allowed: false,
      scope: 'email',
      retryAfterSeconds: Math.ceil(remaining / 1000) || 1,
    }
  }

  if (ipFailures >= policy.perIp.max) {
    return {
      allowed: false,
      scope: 'ip',
      retryAfterSeconds: Math.ceil(policy.perIp.lockoutMs / 1000),
    }
  }

  return { allowed: true, scope: null, retryAfterSeconds: 0 }
}

/**
 * The earliest attempt a window includes.
 *
 * @param {number} windowMs The window length.
 * @param {Date} [now] The current time.
 * @returns {Date} The cutoff.
 */
export function windowStart(windowMs, now = new Date()) {
  return new Date(now.getTime() - windowMs)
}

/**
 * What to tell a caller who has been throttled.
 *
 * One message for both scopes, and it names neither the account nor the count.
 * "Too many attempts for this address" would confirm the address exists; a
 * remaining-attempts count would tell an attacker exactly how much budget they
 * have left before they should rotate their source address.
 *
 * @type {string}
 */
export const THROTTLED_MESSAGE =
  'Too many sign-in attempts. Wait a few minutes and try again, or reset your password.'
