/**
 * Sessions after a role changes — finding NF-10, carried to every route that
 * grants or moves a role.
 *
 * Capabilities are resolved per request (`lib/actor.js`), so a role that is
 * *lost* stops working on the very next request with nothing more to do. A
 * role that is *gained* is the dangerous direction: every session the account
 * already holds was opened under the old role, with its lifetime, its idle
 * timeout and its second-factor state, and a secret captured from one of them
 * would inherit the new authority. So:
 *
 *   - **Authority gained by the caller** (creating an organisation, accepting
 *     an invitation): every *other* session of theirs ends, the current one is
 *     shortened to the new role's absolute lifetime, and a cookie session is
 *     given a new secret. A bearer caller keeps its secret — it has no channel
 *     to learn a new one, and rotating it would lock it out — but is shortened
 *     all the same.
 *   - **Authority changed for somebody else** (a platform role, a direct
 *     membership grant, being handed ownership): every session of theirs ends,
 *     inside the transaction that changed it, so there is no moment at which
 *     the new role is live on an old session.
 *
 * @module @desi-event/api/lib/privilege-change
 */

import { REVOCATION_REASONS, sessionPolicyFor } from '@desi-event/auth'

import { loadActor } from './actor.js'
import { clampSessionExpiry, revokeAllSessions, rotateSession } from './sessions.js'

/**
 * End every session an account holds, because its role changed.
 *
 * For a change made to somebody other than the caller, and meant to be called
 * with the transaction client that made the change.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {string} userId Whose sessions.
 * @param {Date} [now] The current time.
 * @returns {Promise<number>} How many sessions ended.
 */
export function revokeAllSessionsOf(tx, userId, now = new Date()) {
  return revokeAllSessions(tx, { userId, reason: REVOCATION_REASONS.ROLE_CHANGED, now })
}

/**
 * End every session the caller holds except the one making this request.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {object} request The request, carrying the actor and the session.
 * @param {Date} [now] The current time.
 * @returns {Promise<number>} How many sessions ended.
 */
export function revokeOtherSessionsOf(tx, request, now = new Date()) {
  return revokeAllSessions(tx, {
    userId: request.actor.id,
    reason: REVOCATION_REASONS.ROLE_CHANGED,
    exceptSessionId: request.session?.id ?? null,
    now,
  })
}

/**
 * Whether an account has a confirmed second factor.
 *
 * The same rule the enrolment guard applies: recovery codes do not count, and
 * neither does a factor that was disabled or never confirmed.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} userId Whose factors.
 * @returns {Promise<boolean>} True when one is confirmed.
 */
export async function hasConfirmedFactor(prisma, userId) {
  const enrolled = await prisma.mfaFactor.count({
    where: {
      userId,
      type: { not: 'RECOVERY_CODE' },
      confirmedAt: { not: null },
      disabledAt: null,
    },
  })

  return enrolled > 0
}

/**
 * Bring the caller's own session into line with the role they now hold.
 *
 * Called after the change has committed. The actor is reloaded from the
 * database rather than taken from the request, because the request's actor
 * was built before the change.
 *
 * The absolute expiry is clamped to `now + ` the new policy's lifetime and
 * never extended: an attendee session carries thirty days, a privileged one
 * twelve hours, and a session that gained an owner's authority must not keep
 * the first. A cookie session is rotated in the same write; a bearer session
 * is only clamped.
 *
 * @param {object} app The Fastify instance, for the cookie helpers.
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {object} options.request The request.
 * @param {object} options.reply The reply, for a rotated cookie.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<{actor: object, rotated: boolean, clamped: boolean, expiresAt: Date, mfaRequired: boolean, mfaEnrolled: boolean}>} The actor as it now is, what happened, and what the session now needs.
 */
export async function secureSessionAfterGain(app, prisma, { request, reply, now = new Date() }) {
  const loaded = await loadActor(prisma, request.actor.id)
  const actor = loaded?.actor ?? request.actor
  const policy = sessionPolicyFor(actor)
  const session = request.session

  const ceiling = new Date(now.getTime() + policy.lifetimes.absoluteMs)
  const current = session.expiresAt instanceof Date ? session.expiresAt : ceiling
  const shorter = ceiling.getTime() < current.getTime()
  const expiresAt = shorter ? ceiling : current

  let rotated = false
  let clamped = false

  if (request.cookieAuthenticated) {
    const outcome = await rotateSession(prisma, session, now, shorter ? { expiresAt } : {})

    if (outcome.rotated) {
      rotated = true
      clamped = shorter
      app.setSessionCookies(reply, outcome.secret, expiresAt)
    }
  }

  if (!rotated && shorter) clamped = await clampSessionExpiry(prisma, session, expiresAt)

  return {
    actor,
    rotated,
    clamped,
    expiresAt,
    mfaRequired: policy.mfaRequired,
    mfaEnrolled: await hasConfirmedFactor(prisma, actor.id),
  }
}

/**
 * Give the caller's cookie session a new secret after their own role changed.
 *
 * For a loss of authority, where nothing needs shortening: capabilities are
 * resolved per request, so the loss is already effective, and the rotation is
 * for symmetry with every other privilege change — a secret from before a
 * change is never the secret after it. A bearer caller is not rotated, for the
 * reason `secureSessionAfterGain` gives.
 *
 * @param {object} app The Fastify instance.
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {object} options.request The request.
 * @param {object} options.reply The reply.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<boolean>} Whether the secret was replaced.
 */
export async function rotateOwnSession(app, prisma, { request, reply, now = new Date() }) {
  if (!request.cookieAuthenticated) return false

  const { secret, rotated } = await rotateSession(prisma, request.session, now)

  if (rotated) app.setSessionCookies(reply, secret, request.session.expiresAt)

  return rotated
}
