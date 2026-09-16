/**
 * Registration, sign-in, sessions, devices, and the second factor.
 *
 * Eighteen routes, and most of the interesting decisions in them are about what
 * the response *does not* say:
 *
 *   - "Forgot password", "resend verification" and sign-in answer identically
 *     for an address that has an account and one that does not, and pay the same
 *     hashing cost either way. An endpoint that answers faster for an unknown
 *     address is an account enumerator with extra steps.
 *   - A session or device belonging to somebody else answers 404, not 403.
 *     Answering 403 would confirm the id exists.
 *   - A first sign-in attempt at an account with a second factor answers 200
 *     with `mfaRequired`, not an error. An error would have to distinguish "wrong
 *     password" from "right password, now show me a code" — which tells an
 *     attacker exactly which passwords are correct.
 *
 * Every state change writes an `AuditLog` row. Not for completeness: a person
 * who is told "your password was changed" and did not change it needs somebody to
 * be able to find out from where.
 *
 * @module @desi-event/api/routes/auth
 */

import {
  LOGIN_OUTCOMES,
  REVOCATION_REASONS,
  THROTTLED_MESSAGE,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hashToken,
  issueToken,
  normalizeRecoveryCode,
  seal,
  sessionPolicyFor,
  stepUpSatisfied,
  tokensMatch,
  tokenExpiry,
  tokenUsable,
  totpUri,
  TOTP_PARAMETERS,
  unseal,
  verifyTotp,
} from '@desi-event/auth'
import { capabilitiesFor, orgCapabilitiesFor } from '@desi-event/permissions'
import { publicUserSchema } from '@desi-event/schemas'

import { recordAudit } from '../lib/audit.js'
import { conflict, notFound, tooManyRequests, unauthorized, unprocessable } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { KEY_PURPOSES } from '../plugins/auth.js'
import { authRateLimit } from '../plugins/rate-limit.js'
import {
  applyRevocationRule,
  callerAddress,
  deviceFingerprint,
  listDevices,
  listSessions,
  recogniseDevice,
  recordLoginAttempt,
  revokeAllSessions,
  revokeDevice,
  revokeSession,
  rotateSession,
  startSession,
  throttleLogin,
} from '../lib/sessions.js'

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = 'P2002'

/**
 * Whether an error is a unique-constraint violation.
 *
 * Checking for an existing email before inserting is a courtesy, not a
 * guarantee: two simultaneous sign-ups both pass the check. The database's
 * unique index is what actually prevents the duplicate.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True when the database refused a duplicate.
 */
function isUniqueViolation(error) {
  return /** @type {{code?: unknown}} */ (error)?.code === UNIQUE_VIOLATION
}

/**
 * The uniform body for every request that must not reveal whether an account
 * exists.
 *
 * @param {string} message What to tell the caller.
 * @returns {object} An `acceptedResponseSchema` payload.
 */
function accepted(message) {
  return { data: { accepted: true, message } }
}

/**
 * Register the `/v1/auth` routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.env The parsed API environment.
 * @param {{max?: number, timeWindow?: string|number}} [deps.authLimit] Overrides for the credential-endpoint rate limit.
 * @param {function(object): Promise<void>} [deps.deliver] Where an issued link is sent. Defaults to logging it, which is what a credential-free deployment can honestly do.
 * @returns {void} Nothing.
 */
export function registerAuthRoutes(app, { prisma, env, authLimit, deliver }) {
  const limit = { rateLimit: authRateLimit(authLimit) }
  const sealing = { secret: app.authKeys.sealingSecret, purpose: KEY_PURPOSES.mfa }

  /**
   * Rotate the caller's own session after a privilege change, and deliver it.
   *
   * Finding NF-10. The docstring on `@desi-event/auth/sessions` claimed rotation
   * on "sign-in, password change, MFA enrolment, step-up"; only the password
   * change rotated. A session opened before a second factor existed carried on
   * with the same secret afterwards, so a secret captured under the weaker
   * requirement stayed valid under the stronger one — which is most of the value
   * of adding the factor.
   *
   * Sibling sessions are revoked separately by `applyRevocationRule`. This one is
   * rotated rather than revoked: signing somebody out of the form they just
   * submitted teaches nothing except that securing your account is annoying.
   *
   * A bearer caller is deliberately *not* rotated. It has no channel to receive
   * the replacement, and rotating it would lock the holder out — the defect
   * `b37b242` fixed on the scheduled path, which would be reintroduced here if
   * this helper rotated unconditionally.
   *
   * @param {object} request The request, carrying the session and how it was presented.
   * @param {object} reply The reply, for the cookie.
   * @returns {Promise<boolean>} Whether the secret was replaced.
   */
  async function rotateAfterPrivilegeChange(request, reply) {
    if (!request.cookieAuthenticated) return false

    const { secret, rotated } = await rotateSession(prisma, request.session)

    if (rotated) app.setSessionCookies(reply, secret, request.session.expiresAt)

    return rotated
  }

  /**
   * Hand a single-use link to whoever is going to deliver it.
   *
   * With no mail provider configured, this logs that a link was issued — the
   * secret itself at debug level in development only, so a developer can follow
   * the flow, and never in production. Phase 2's notification outbox replaces the
   * default; the seam is here so that no route has to know which.
   *
   * @param {object} message What was issued.
   * @returns {Promise<void>} Resolves once delivery has been handed off.
   */
  async function handOff(message) {
    if (typeof deliver === 'function') {
      await deliver(message)

      return
    }

    app.log.info(
      { purpose: message.purpose, userId: message.userId ?? null },
      'issued a single-use link; no delivery provider is configured',
    )

    if (env.NODE_ENV === 'development') {
      app.log.debug({ purpose: message.purpose, token: message.token }, 'link token (development)')
    }
  }

  /**
   * Issue a single-use token for a purpose, revoking any outstanding one.
   *
   * Revoking first is what makes "I clicked the link twice" produce one working
   * link rather than two: a second request supersedes the first, so a link
   * captured from an inbox stops working as soon as the person asks again.
   *
   * @param {object} options Options.
   * @param {string} options.userId Whose token.
   * @param {string} options.purpose An `AuthTokenPurpose`.
   * @returns {Promise<string>} The secret, to deliver once.
   */
  async function issueSingleUseToken({ userId, purpose }) {
    const { secret, hash } = issueToken()

    await prisma.$transaction([
      prisma.authToken.updateMany({
        where: { userId, purpose, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.authToken.create({
        data: { userId, purpose, tokenHash: hash, expiresAt: tokenExpiry(purpose) },
      }),
    ])

    return secret
  }

  /**
   * Redeem a single-use token.
   *
   * Single use is enforced by the conditional update, not by the read: two
   * simultaneous redemptions both read an unused row, and only one of them
   * matches `usedAt: null` when it writes.
   *
   * @param {object} options Options.
   * @param {string} options.token The secret from the link.
   * @param {string} options.purpose The purpose it must have been issued for.
   * @returns {Promise<object>} The token row, now marked used.
   * @throws {Error} A 401 when the token cannot be redeemed.
   */
  async function redeemSingleUseToken({ token, purpose }) {
    const row = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } })
    const { usable, reason } = tokenUsable(row, { purpose })

    if (!usable) {
      // One message for every reason. "Already used" versus "expired" versus
      // "never existed" is useful to an attacker holding a list of guesses and
      // not useful to anybody else: the remedy is the same, ask for a new link.
      // The reason goes to the log, where support can see it and the caller
      // cannot.
      app.log.info({ purpose, reason }, 'refused a single-use link')

      throw unauthorized('This link is not valid any more. Request a new one.')
    }

    const { count } = await prisma.authToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    if (count !== 1) {
      throw unauthorized('This link has already been used. Request a new one.')
    }

    return row
  }

  /**
   * The confirmed second factors an account holds.
   *
   * @param {string} userId Whose factors.
   * @returns {Promise<object[]>} Confirmed, enabled factors.
   */
  function confirmedFactors(userId) {
    return prisma.mfaFactor.findMany({
      where: { userId, confirmedAt: { not: null }, disabledAt: null },
    })
  }

  /**
   * Check a one-time code against every factor an account holds.
   *
   * A TOTP code and a recovery code are accepted at the same field, told apart by
   * shape rather than by asking the person which they are using — somebody locked
   * out of their authenticator should not also have to work out which box to type
   * in.
   *
   * A recovery code is consumed on use: its row is marked used, so the same code
   * cannot be presented twice. A TOTP code is checked against the counter the
   * factor last accepted, so the same code cannot be replayed within its window.
   *
   * @param {object} options Options.
   * @param {string} options.userId Whose factors.
   * @param {string} options.code The code as typed.
   * @param {Date} [options.now] The current time.
   * @returns {Promise<{ok: boolean, factorId: string|null, kind: string|null}>} The outcome.
   */
  async function checkSecondFactor({ userId, code, now = new Date() }) {
    const factors = await confirmedFactors(userId)

    for (const factor of factors.filter((candidate) => candidate.type === 'TOTP')) {
      let secret

      try {
        secret = unseal(factor.secretSealed, sealing)
      } catch {
        app.log.error({ factorId: factor.id }, 'a sealed TOTP secret could not be opened')
        continue
      }

      const lastCounter = factor.lastUsedAt
        ? Math.floor(factor.lastUsedAt.getTime() / 1000 / TOTP_PARAMETERS.stepSeconds)
        : null
      const result = verifyTotp(secret, code, { at: now, lastCounter })

      if (!result.valid) continue

      // `lastUsedAt` is the replay guard, so it is written before the sign-in
      // proceeds rather than after: a crash between the two must not leave a
      // code reusable.
      await prisma.mfaFactor.update({
        where: { id: factor.id },
        data: { lastUsedAt: new Date(result.counter * TOTP_PARAMETERS.stepSeconds * 1000) },
      })

      return { ok: true, factorId: factor.id, kind: 'TOTP' }
    }

    const normalised = normalizeRecoveryCode(code)

    if (normalised.length >= 8) {
      const candidates = await prisma.mfaFactor.findMany({
        where: { userId, type: 'RECOVERY_CODE', usedAt: null, disabledAt: null },
      })

      // Compared by digest, not by opening a seal — finding NF-12, and what the
      // schema said all along ("For a recovery code, a SHA-256 of the code").
      // A sealed value is reversible with the server key: anybody who could read
      // the database *and* the key could print somebody's recovery codes. A
      // digest cannot be reversed, and a recovery code never needs to be read
      // back, only recognised.
      const digest = hashToken(normalised)

      for (const factor of candidates) {
        if (!tokensMatch(factor.secretSealed, digest)) continue

        const { count } = await prisma.mfaFactor.updateMany({
          where: { id: factor.id, usedAt: null },
          data: { usedAt: now, lastUsedAt: now },
        })

        if (count === 1) return { ok: true, factorId: factor.id, kind: 'RECOVERY_CODE' }
      }
    }

    return { ok: false, factorId: null, kind: null }
  }

  /**
   * Establish a session and put it on the reply.
   *
   * @param {object} options Options.
   * @param {object} options.request The incoming request.
   * @param {object} options.reply The reply.
   * @param {object} options.user The user row.
   * @param {object} options.actor The actor.
   * @param {boolean} options.mfaSatisfied Whether a second factor was proved.
   * @param {string|null} [options.deviceLabel] A label for this browser.
   * @returns {Promise<object>} A `signInResponseSchema` payload.
   */
  async function establishSession({ request, reply, user, actor, mfaSatisfied, deviceLabel }) {
    const device = await recogniseDevice(prisma, {
      userId: user.id,
      fingerprint: deviceFingerprint(request, app.authKeys.pseudonymize),
      label: deviceLabel ?? null,
    })

    const { session, secret } = await startSession(prisma, {
      actor,
      request,
      key: app.authKeys.pseudonymize,
      deviceId: device?.id ?? null,
      mfaSatisfied,
    })

    const csrfToken = app.setSessionCookies(reply, secret, session.expiresAt)

    return {
      token: secret,
      tokenType: 'Bearer',
      expiresAt: session.expiresAt.toISOString(),
      csrfToken,
      user: publicUserSchema.parse(user),
      mfaRequired: false,
      emailVerificationRequired: user.emailVerified !== true,
      sessionId: session.id,
    }
  }

  defineRoute(app, 'auth.register', {
    config: limit,
    handler: async (request, reply) => {
      const { email, password, displayName, phone, locale, role } = request.body

      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) throw conflict('An account with this email address already exists.')

      const passwordHash = await hashPassword(password)

      let user

      try {
        user = await prisma.user.create({
          data: { email, passwordHash, displayName, phone: phone ?? null, locale, role },
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('An account with this email address already exists.')
        }

        throw error
      }

      const token = await issueSingleUseToken({ userId: user.id, purpose: 'EMAIL_VERIFICATION' })
      await handOff({ purpose: 'EMAIL_VERIFICATION', userId: user.id, email, token })

      await recordAudit(prisma, {
        actorId: user.id,
        action: 'auth.account_created',
        entityType: 'User',
        entityId: user.id,
        metadata: { role: user.role },
      })

      request.log.info({ userId: user.id, role: user.role }, 'account created')

      return establishSession({
        request,
        reply,
        user,
        actor: { id: user.id, role: user.role, email: user.email, memberships: [] },
        mfaSatisfied: false,
      })
    },
  })

  defineRoute(app, 'auth.login', {
    config: limit,
    handler: async (request, reply) => {
      const { email, password, code, deviceLabel } = request.body
      const address = callerAddress(request)
      const key = app.authKeys.pseudonymize

      const throttle = await throttleLogin(prisma, { email, address, key })

      if (!throttle.allowed) {
        await recordLoginAttempt(prisma, {
          email,
          address,
          outcome: LOGIN_OUTCOMES.THROTTLED,
          key,
        })

        throw tooManyRequests(THROTTLED_MESSAGE, throttle.retryAfterSeconds)
      }

      const user = await prisma.user.findUnique({ where: { email } })

      // The hash comparison runs whether or not the account exists: an unknown
      // address pays the same ~100ms as a known one, so the response time does
      // not answer a question the response body refuses to.
      const valid = await app.verifyUserPassword(user, password)

      if (!user || !valid) {
        await recordLoginAttempt(prisma, {
          email,
          address,
          outcome: user ? LOGIN_OUTCOMES.BAD_PASSWORD : LOGIN_OUTCOMES.UNKNOWN_EMAIL,
          key,
        })

        throw unauthorized('Invalid email address or password.')
      }

      if (user.suspendedAt) {
        await recordLoginAttempt(prisma, { email, address, outcome: LOGIN_OUTCOMES.SUSPENDED, key })

        // Said plainly rather than hidden behind "invalid password": somebody
        // whose account was suspended needs to know to contact support, and
        // reaching this branch already required the correct password.
        throw unauthorized('This account is suspended. Contact support.')
      }

      const factors = await confirmedFactors(user.id)

      if (factors.length > 0) {
        if (!code) {
          await recordLoginAttempt(prisma, {
            email,
            address,
            outcome: LOGIN_OUTCOMES.MFA_REQUIRED,
            key,
          })

          // 200, not 401. An error here would separate "wrong password" from
          // "right password, code needed", which is the distinction an attacker
          // is looking for.
          return {
            token: null,
            tokenType: 'Bearer',
            mfaRequired: true,
            emailVerificationRequired: user.emailVerified !== true,
          }
        }

        const second = await checkSecondFactor({ userId: user.id, code })

        if (!second.ok) {
          await recordLoginAttempt(prisma, {
            email,
            address,
            outcome: LOGIN_OUTCOMES.MFA_FAILED,
            key,
          })

          throw unauthorized('That code is not valid. Try the next one your app shows.')
        }
      }

      await recordLoginAttempt(prisma, { email, address, outcome: LOGIN_OUTCOMES.SUCCESS, key })

      const memberships = await prisma.membership.findMany({ where: { userId: user.id } })
      const actor = {
        id: user.id,
        role: user.role,
        email: user.email,
        memberships: memberships.map((membership) => ({
          organizationId: membership.organizationId,
          role: membership.role,
        })),
      }

      const payload = await establishSession({
        request,
        reply,
        user,
        actor,
        mfaSatisfied: factors.length > 0,
        deviceLabel,
      })

      await recordAudit(prisma, {
        actorId: user.id,
        action: 'auth.signed_in',
        entityType: 'Session',
        entityId: payload.sessionId,
        metadata: { mfa: factors.length > 0 },
      })

      return payload
    },
  })

  defineRoute(app, 'auth.logout', {
    handler: async (request, reply) => {
      const { everywhere } = request.body

      await revokeSession(prisma, request.session.id, REVOCATION_REASONS.SIGNED_OUT)

      if (everywhere) {
        await revokeAllSessions(prisma, {
          userId: request.actor.id,
          reason: REVOCATION_REASONS.SIGNED_OUT_EVERYWHERE,
        })
      }

      app.clearSessionCookies(reply)

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: everywhere ? 'auth.signed_out_everywhere' : 'auth.signed_out',
        entityType: 'Session',
        entityId: request.session.id,
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'auth.me', {
    handler: async (request) => {
      const organizations = await prisma.organization.findMany({
        where: { id: { in: request.actor.memberships.map((m) => m.organizationId) } },
        select: { id: true, name: true },
      })
      const names = new Map(
        organizations.map((organization) => [organization.id, organization.name]),
      )
      const factors = await confirmedFactors(request.actor.id)
      const policy = sessionPolicyFor(request.actor)

      return {
        data: {
          user: publicUserSchema.parse(request.currentUser),
          capabilities: [...capabilitiesFor(request.actor)].sort(),
          memberships: request.actor.memberships.map((membership) => ({
            organizationId: membership.organizationId,
            organizationName: names.get(membership.organizationId) ?? null,
            role: membership.role,
            capabilities: [...orgCapabilitiesFor(request.actor, membership.organizationId)].sort(),
          })),
          session: {
            id: request.session.id,
            expiresAt: request.session.expiresAt.toISOString(),
            stepUpSatisfied: stepUpSatisfied(request.session),
            mfaRequired: policy.mfaRequired,
            mfaEnrolled: factors.length > 0,
          },
        },
      }
    },
  })

  defineRoute(app, 'auth.verifyEmail', {
    config: limit,
    handler: async (request) => {
      const row = await redeemSingleUseToken({
        token: request.body.token,
        purpose: 'EMAIL_VERIFICATION',
      })

      await prisma.user.update({ where: { id: row.userId }, data: { emailVerified: true } })

      await recordAudit(prisma, {
        actorId: row.userId,
        action: 'auth.email_verified',
        entityType: 'User',
        entityId: row.userId,
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'auth.resendVerification', {
    config: limit,
    handler: async (request) => {
      const { email } = request.body
      const user = await prisma.user.findUnique({ where: { email } })

      // Nothing about the branch taken here reaches the caller. An address with
      // no account, an address already verified and an address that gets a fresh
      // link all produce the same 202.
      if (user && !user.emailVerified) {
        const token = await issueSingleUseToken({
          userId: user.id,
          purpose: 'EMAIL_VERIFICATION',
        })

        await handOff({ purpose: 'EMAIL_VERIFICATION', userId: user.id, email, token })
      }

      request.log.info(
        { delivered: Boolean(user && !user.emailVerified) },
        'verification requested',
      )

      return accepted(
        'If that address needs verifying, a link is on its way. Check your inbox and your spam folder.',
      )
    },
  })

  defineRoute(app, 'auth.forgotPassword', {
    config: limit,
    handler: async (request) => {
      const { email } = request.body
      const user = await prisma.user.findUnique({ where: { email } })

      if (user && !user.suspendedAt) {
        const token = await issueSingleUseToken({ userId: user.id, purpose: 'PASSWORD_RESET' })

        await handOff({ purpose: 'PASSWORD_RESET', userId: user.id, email, token })

        await recordAudit(prisma, {
          actorId: user.id,
          action: 'auth.reset_requested',
          entityType: 'User',
          entityId: user.id,
        })
      }

      return accepted(
        'If that address has an account, a reset link is on its way. The link expires in thirty minutes.',
      )
    },
  })

  defineRoute(app, 'auth.resetPassword', {
    config: limit,
    handler: async (request, reply) => {
      const row = await redeemSingleUseToken({
        token: request.body.token,
        purpose: 'PASSWORD_RESET',
      })
      const passwordHash = await hashPassword(request.body.password)

      await prisma.user.update({ where: { id: row.userId }, data: { passwordHash } })

      // No exception: every session goes, including the one making this request
      // if there is one. A session established with the old password must stop
      // working, or resetting the password because somebody else knows it
      // accomplishes nothing.
      const revoked = await applyRevocationRule(prisma, {
        userId: row.userId,
        reason: REVOCATION_REASONS.PASSWORD_RESET,
        exceptSessionId: null,
      })

      app.clearSessionCookies(reply)

      await recordAudit(prisma, {
        actorId: row.userId,
        action: 'auth.password_reset',
        entityType: 'User',
        entityId: row.userId,
        metadata: { sessionsRevoked: revoked },
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'auth.changePassword', {
    config: limit,
    handler: async (request, reply) => {
      const { currentPassword, password } = request.body

      if (!(await app.verifyUserPassword(request.currentUser, currentPassword))) {
        throw unauthorized('That is not your current password.')
      }

      const passwordHash = await hashPassword(password)
      await prisma.user.update({ where: { id: request.actor.id }, data: { passwordHash } })

      // Every *other* session goes. This one is rotated rather than revoked:
      // signing somebody out of the form they just used teaches nothing except
      // that changing your password is annoying.
      const revoked = await applyRevocationRule(prisma, {
        userId: request.actor.id,
        reason: REVOCATION_REASONS.PASSWORD_CHANGED,
        exceptSessionId: request.session.id,
      })

      const rotated = await rotateAfterPrivilegeChange(request, reply)

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: request.actor.id,
        metadata: { sessionsRevoked: revoked, rotated },
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'auth.stepUp', {
    config: limit,
    handler: async (request) => {
      const { password, code } = request.body
      const factors = await confirmedFactors(request.actor.id)
      const policy = sessionPolicyFor(request.actor)

      let satisfied = false

      if (code) {
        satisfied = (await checkSecondFactor({ userId: request.actor.id, code })).ok
      } else if (password) {
        // A password alone will not do for an account whose roles require a
        // second factor. Finding NF-12: this used to be conditional on the
        // account *having* a factor — `policy.mfaRequired && factors.length > 0`
        // — so a finance administrator with none enrolled satisfied step-up by
        // retyping the password the session was already opened with. Step-up on
        // exactly the account most in need of a second factor was a re-typed
        // first one.
        //
        // With no factor there is nothing to step up *to*, so the answer is to
        // enrol, not to fall back.
        if (policy.mfaRequired) {
          throw unauthorized(
            factors.length > 0
              ? 'This account needs a one-time code to confirm a sensitive action.'
              : 'This account holds privileged roles and has no second factor. Enrol one at /v1/auth/mfa/totp before performing sensitive actions.',
            factors.length > 0 ? 'UNAUTHORIZED' : 'MFA_ENROLMENT_REQUIRED',
          )
        }

        satisfied = await app.verifyUserPassword(request.currentUser, password)
      }

      if (!satisfied) throw unauthorized('That did not confirm your identity. Try again.')

      await prisma.session.update({
        where: { id: request.session.id },
        data: { mfaSatisfiedAt: new Date() },
      })

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'auth.stepped_up',
        entityType: 'Session',
        entityId: request.session.id,
        metadata: { via: code ? 'code' : 'password' },
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'auth.listSessions', {
    handler: async (request) => {
      const sessions = await listSessions(prisma, request.actor.id)

      return {
        data: sessions.map((session) => ({
          id: session.id,
          current: session.id === request.session.id,
          createdAt: session.createdAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          userAgent: session.userAgent,
          deviceId: session.deviceId,
          deviceLabel: session.device?.label ?? null,
          mfaSatisfiedAt: session.mfaSatisfiedAt?.toISOString() ?? null,
        })),
      }
    },
  })

  defineRoute(app, 'auth.revokeSession', {
    handler: async (request, reply) => {
      // Scoped by userId in the same query that finds it, so a session belonging
      // to somebody else is indistinguishable from one that does not exist.
      const session = await prisma.session.findFirst({
        where: { id: request.params.id, userId: request.actor.id },
      })

      if (!session) throw notFound('No such session.')

      await revokeSession(prisma, session.id, REVOCATION_REASONS.SIGNED_OUT)

      if (session.id === request.session.id) app.clearSessionCookies(reply)

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'auth.session_revoked',
        entityType: 'Session',
        entityId: session.id,
        metadata: { reason: request.body?.reason ?? null, own: session.id === request.session.id },
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'auth.listDevices', {
    handler: async (request) => {
      const devices = await listDevices(prisma, request.actor.id)

      return {
        data: devices.map((device) => ({
          id: device.id,
          label: device.label,
          trusted: device.trustedAt !== null,
          firstSeenAt: device.firstSeenAt.toISOString(),
          lastSeenAt: device.lastSeenAt.toISOString(),
          activeSessions: device.activeSessions,
        })),
      }
    },
  })

  defineRoute(app, 'auth.revokeDevice', {
    handler: async (request, reply) => {
      const device = await prisma.device.findFirst({
        where: { id: request.params.id, userId: request.actor.id },
      })

      if (!device) throw notFound('No such device.')

      const { sessions } = await revokeDevice(prisma, {
        deviceId: device.id,
        userId: request.actor.id,
      })

      if (request.session.deviceId === device.id) app.clearSessionCookies(reply)

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'auth.device_revoked',
        entityType: 'Device',
        entityId: device.id,
        metadata: { sessionsRevoked: sessions, reason: request.body?.reason ?? null },
      })

      return { ok: true }
    },
  })

  defineRoute(app, 'auth.listFactors', {
    handler: async (request) => {
      const policy = sessionPolicyFor(request.actor)
      const factors = await prisma.mfaFactor.findMany({
        where: { userId: request.actor.id, disabledAt: null },
        orderBy: { createdAt: 'asc' },
      })
      const confirmed = factors.filter(
        (factor) => factor.confirmedAt !== null && factor.type !== 'RECOVERY_CODE',
      )

      return {
        data: {
          required: policy.mfaRequired,
          satisfied: confirmed.length > 0,
          // Recovery codes are factors in the schema and not in this list: ten
          // rows called "Recovery code" tell somebody nothing, and the count is
          // the only useful fact about them.
          factors: factors
            .filter((factor) => factor.type !== 'RECOVERY_CODE')
            .map((factor) => ({
              id: factor.id,
              type: factor.type,
              label: factor.label,
              confirmed: factor.confirmedAt !== null,
              createdAt: factor.createdAt.toISOString(),
              lastUsedAt: factor.lastUsedAt?.toISOString() ?? null,
            })),
        },
      }
    },
  })

  defineRoute(app, 'auth.enrollTotp', {
    config: limit,
    handler: async (request) => {
      const { secret } = generateTotpSecret()
      const factor = await prisma.mfaFactor.create({
        data: {
          userId: request.actor.id,
          type: 'TOTP',
          label: request.body?.label ?? null,
          secretSealed: seal(secret, sealing),
        },
      })

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'auth.mfa_enrolment_started',
        entityType: 'MfaFactor',
        entityId: factor.id,
        metadata: { type: 'TOTP' },
      })

      return {
        data: {
          factorId: factor.id,
          secret,
          uri: totpUri({
            secret,
            account: request.currentUser.email,
            issuer: 'Desi-Event',
          }),
          digits: TOTP_PARAMETERS.digits,
          periodSeconds: TOTP_PARAMETERS.stepSeconds,
          algorithm: TOTP_PARAMETERS.algorithm.toUpperCase(),
        },
      }
    },
  })

  defineRoute(app, 'auth.confirmTotp', {
    config: limit,
    handler: async (request, reply) => {
      const factor = await prisma.mfaFactor.findFirst({
        where: {
          id: request.body.factorId,
          userId: request.actor.id,
          type: 'TOTP',
          disabledAt: null,
        },
      })

      if (!factor) throw notFound('No such enrolment.')
      if (factor.confirmedAt) throw conflict('This factor is already confirmed.')

      const secret = unseal(factor.secretSealed, sealing)
      const result = verifyTotp(secret, request.body.code)

      if (!result.valid) {
        throw unauthorized('That code does not match. Check the time on your device and try again.')
      }

      const codes = generateRecoveryCodes()
      const now = new Date()

      await prisma.$transaction([
        prisma.mfaFactor.update({
          where: { id: factor.id },
          data: {
            confirmedAt: now,
            lastUsedAt: new Date(result.counter * TOTP_PARAMETERS.stepSeconds * 1000),
          },
        }),
        // Recovery codes are stored as digests, not sealed — finding NF-12, and
        // what the schema always said. A seal is reversible with the server key,
        // so anybody holding both the database and the key could print
        // somebody's codes. A digest cannot be reversed, and a recovery code
        // only ever needs to be recognised, never read back. The TOTP secret is
        // different: verification has to *use* it, so it stays sealed.
        ...codes.map((code) =>
          prisma.mfaFactor.create({
            data: {
              userId: request.actor.id,
              type: 'RECOVERY_CODE',
              secretSealed: hashToken(normalizeRecoveryCode(code)),
              confirmedAt: now,
            },
          }),
        ),
      ])

      // Adding a factor is a privilege change, so every other session goes: a
      // session opened before the factor existed was established under weaker
      // requirements than the account now has.
      const revoked = await applyRevocationRule(prisma, {
        userId: request.actor.id,
        reason: REVOCATION_REASONS.MFA_CHANGED,
        exceptSessionId: request.session.id,
      })

      await prisma.session.update({
        where: { id: request.session.id },
        data: { mfaSatisfiedAt: now },
      })

      // The account is now protected by something it was not protected by a
      // moment ago, so the secret established under the weaker requirement is
      // replaced — finding NF-10.
      const rotated = await rotateAfterPrivilegeChange(request, reply)

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'auth.mfa_confirmed',
        entityType: 'MfaFactor',
        entityId: factor.id,
        metadata: { recoveryCodes: codes.length, sessionsRevoked: revoked, rotated },
      })

      return { data: { factorId: factor.id, recoveryCodes: codes } }
    },
  })

  defineRoute(app, 'auth.disableFactor', {
    config: limit,
    handler: async (request, reply) => {
      if (!(await app.verifyUserPassword(request.currentUser, request.body.currentPassword))) {
        throw unauthorized('That is not your current password.')
      }

      const factor = await prisma.mfaFactor.findFirst({
        where: { id: request.params.id, userId: request.actor.id, disabledAt: null },
      })

      if (!factor) throw notFound('No such factor.')

      const policy = sessionPolicyFor(request.actor)
      const remaining = (await confirmedFactors(request.actor.id)).filter(
        (candidate) => candidate.id !== factor.id && candidate.type !== 'RECOVERY_CODE',
      )

      if (policy.mfaRequired && remaining.length === 0) {
        // Otherwise the account keeps its authority and loses its second factor,
        // which is the combination the requirement exists to prevent.
        throw unprocessable(
          'This account needs a second factor because of the roles it holds. Enrol another one before removing this.',
        )
      }

      const now = new Date()

      await prisma.$transaction([
        prisma.mfaFactor.update({ where: { id: factor.id }, data: { disabledAt: now } }),
        // The recovery codes go with the factor they were issued alongside. A set
        // of codes that outlives the authenticator is a set of codes nobody
        // remembers exists.
        ...(remaining.length === 0
          ? [
              prisma.mfaFactor.updateMany({
                where: { userId: request.actor.id, type: 'RECOVERY_CODE', disabledAt: null },
                data: { disabledAt: now },
              }),
            ]
          : []),
      ])

      const revoked = await applyRevocationRule(prisma, {
        userId: request.actor.id,
        reason: REVOCATION_REASONS.MFA_CHANGED,
        exceptSessionId: request.session.id,
      })

      const rotated = await rotateAfterPrivilegeChange(request, reply)

      await recordAudit(prisma, {
        actorId: request.actor.id,
        action: 'auth.mfa_disabled',
        entityType: 'MfaFactor',
        entityId: factor.id,
        metadata: {
          sessionsRevoked: revoked,
          recoveryCodesCleared: remaining.length === 0,
          rotated,
        },
      })

      return { ok: true }
    },
  })
}
