/**
 * Authentication: the guards every protected route runs, and the cookie policy
 * behind them.
 *
 * Authorization is *not* here. Once a guard has built the actor, every decision
 * about what that actor may do is delegated to `assertCan` from
 * `@desi-event/permissions`; this module never compares a role. It does read the
 * capability a route *declares*, which is the contract's business rather than
 * this module's opinion.
 *
 * What changed from Phase 1, and why:
 *
 *   - **A session is a row, not a claim.** Phase 1 issued a seven-day JWT, which
 *     cannot be revoked: signing out was a client-side gesture and "sign out
 *     everywhere" was not implementable. A session row can be revoked, listed,
 *     rotated and attributed to a device.
 *   - **Cookie first, bearer still accepted.** The browser gets an httpOnly
 *     cookie, which survives a reload and cannot be read by injected script. An
 *     API client sends the same secret as a bearer token. One session, two ways
 *     to present it, one thing to revoke.
 *   - **CSRF becomes a real problem, so it gets a real answer.** A bearer token
 *     was immune because a browser never attaches it unasked. A cookie is not, so
 *     every unsafe method is checked three ways — see `@desi-event/auth/cookies`.
 *
 * @module @desi-event/api/plugins/auth
 */

import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import bcrypt from 'bcryptjs'
import {
  allowedOriginsFrom,
  checkOrigin,
  clearCookieOptions,
  cookieNames,
  csrfCookieOptions,
  csrfTokenMatches,
  deriveSealingKey,
  hashPassword,
  issueCsrfToken,
  needsRehash,
  sessionCookieOptions,
  stepUpSatisfied,
  verifyPassword,
} from '@desi-event/auth'
import { assertCan, PLATFORM_ONLY_CAPABILITIES } from '@desi-event/permissions'

import { loadActor } from '../lib/actor.js'
import { forbidden, unauthorized } from '../lib/errors.js'
import { findSession, refreshSession } from '../lib/sessions.js'

/**
 * The header an API client puts its session secret in.
 *
 * `Authorization: Bearer <secret>` — the same scheme Phase 1 used, so a client
 * that held a JWT needs no change beyond signing in again.
 *
 * @type {string}
 */
export const BEARER_PREFIX = 'Bearer '

/** The header the browser echoes its CSRF token in. */
export const CSRF_HEADER = 'x-desi-csrf'

/** HKDF purpose labels. Distinct, so no two uses share a derived key. */
export const KEY_PURPOSES = Object.freeze({
  pseudonymize: 'pseudonymize',
  mfa: 'mfa-totp',
  recovery: 'mfa-recovery',
})

/**
 * Verify a Phase 1 bcrypt hash.
 *
 * Supplied to `verifyPassword` as its legacy verifier. `@desi-event/auth` does
 * not depend on bcryptjs — it has no reason to, beyond this one migration path —
 * so the dependency stays here, where it can be deleted once no bcrypt hash
 * remains.
 *
 * @param {string} password The plaintext password.
 * @param {string} stored The stored bcrypt hash.
 * @returns {Promise<boolean>} True when it matches.
 */
export async function verifyLegacyPassword(password, stored) {
  try {
    return await bcrypt.compare(password, stored)
  } catch {
    return false
  }
}

/**
 * Register cookie and JWT support, and decorate the instance with the guards.
 *
 * Adds:
 *   - `app.authKeys` — the derived keys the auth routes need.
 *   - `app.cookieNames`, `app.secureCookies`, `app.allowedOrigins`.
 *   - `app.setSessionCookies(reply, secret, expiresAt)` and `app.clearSessionCookies(reply)`.
 *   - `app.verifyUserPassword(user, password)` — verify and transparently upgrade.
 *   - `app.authenticate` / `app.optionalAuth` / `app.requireSession` — the guards.
 *   - `app.requireCapability(capability)` and `app.requireStepUp` — preHandlers
 *     the route registrar installs from the contract descriptor.
 *
 * @param {object} app The Fastify instance.
 * @param {object} options Auth options.
 * @param {object} options.prisma The Prisma client used to load users and sessions.
 * @param {object} options.env The parsed API environment.
 * @returns {Promise<void>} Resolves once the decorators are installed.
 */
export async function registerAuth(app, { prisma, env }) {
  await app.register(cookie, {})

  // Retained for the ticket QR credentials and the provider webhook signatures,
  // both of which are short-lived signed values rather than sessions. No session
  // is a JWT any more.
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  })

  const secureCookies = env.SECURE_COOKIES !== false
  const names = cookieNames(secureCookies)
  const allowedOrigins = allowedOriginsFrom([
    env.WEB_ORIGIN,
    env.NEXT_PUBLIC_SITE_URL,
    ...(env.CORS_ORIGIN && env.CORS_ORIGIN !== '*' ? env.CORS_ORIGIN.split(',') : []),
  ])

  const keys = Object.freeze({
    pseudonymize: deriveSealingKey(env.AUTH_SECRET, KEY_PURPOSES.pseudonymize).toString('hex'),
    sealingSecret: env.AUTH_SECRET,
  })

  app.decorate('authKeys', keys)
  app.decorate('cookieNames', names)
  app.decorate('secureCookies', secureCookies)
  app.decorate('allowedOrigins', allowedOrigins)

  app.decorateRequest('actor', null)
  app.decorateRequest('currentUser', null)
  app.decorateRequest('session', null)
  app.decorateRequest('cookieAuthenticated', false)

  /**
   * Put the session and CSRF cookies on a reply.
   *
   * @param {object} reply The reply.
   * @param {string} secret The session secret.
   * @param {Date} expiresAt When the session expires.
   * @returns {string} The CSRF token the client must echo.
   */
  function setSessionCookies(reply, secret, expiresAt) {
    const maxAgeSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    const csrfToken = issueCsrfToken()

    reply.setCookie(
      names.session,
      secret,
      sessionCookieOptions({ secure: secureCookies, maxAgeSeconds }),
    )
    reply.setCookie(
      names.csrf,
      csrfToken,
      csrfCookieOptions({ secure: secureCookies, maxAgeSeconds }),
    )

    return csrfToken
  }

  /**
   * Remove both cookies.
   *
   * @param {object} reply The reply.
   * @returns {void}
   */
  function clearSessionCookies(reply) {
    const options = clearCookieOptions(secureCookies)

    reply.clearCookie(names.session, options)
    reply.clearCookie(names.csrf, { ...options, httpOnly: false })
  }

  app.decorate('setSessionCookies', setSessionCookies)
  app.decorate('clearSessionCookies', clearSessionCookies)

  /**
   * Verify a password against a user row, upgrading the stored hash if needed.
   *
   * The upgrade happens here rather than in a route because a correct password is
   * the only moment the plaintext exists to rehash with, and every path that
   * checks a password wants the same behaviour.
   *
   * @param {object} user The `User` row.
   * @param {string} password The plaintext password supplied by the caller.
   * @returns {Promise<boolean>} True when the password is correct.
   */
  async function verifyUserPassword(user, password) {
    const result = await verifyPassword(password, user?.passwordHash, {
      verifyLegacy: verifyLegacyPassword,
    })

    if (result.valid && result.rehash && user?.id) {
      const passwordHash = await hashPassword(password)

      // Conditional on the hash we verified against, so a concurrent password
      // change is not overwritten by an upgrade of the hash it replaced.
      await prisma.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash },
      })
    }

    if (result.unusable && user?.id) {
      app.log.warn({ userId: user.id }, 'stored password hash is unreadable')
    }

    return result.valid
  }

  app.decorate('verifyUserPassword', verifyUserPassword)
  app.decorate('needsPasswordRehash', needsRehash)

  /**
   * The session secret a request presents, and how it presented it.
   *
   * A bearer token is preferred over a cookie when both are present: an explicit
   * credential should win over an ambient one, so a script that sets a header is
   * not silently overridden by whatever cookie the browser happened to keep.
   *
   * @param {object} request The incoming request.
   * @returns {{secret: string|null, fromCookie: boolean}} The secret and its source.
   */
  function presentedSecret(request) {
    const header = request.headers?.authorization

    if (typeof header === 'string' && header.startsWith(BEARER_PREFIX)) {
      const secret = header.slice(BEARER_PREFIX.length).trim()
      if (secret !== '') return { secret, fromCookie: false }
    }

    const fromCookie = request.cookies?.[names.session]

    if (typeof fromCookie === 'string' && fromCookie !== '') {
      return { secret: fromCookie, fromCookie: true }
    }

    return { secret: null, fromCookie: false }
  }

  /**
   * Resolve a presented secret to an actor and attach everything to the request.
   *
   * @param {object} request The incoming request.
   * @param {object} reply The reply, so a rotated secret can be set.
   * @returns {Promise<boolean>} True when a session was attached.
   * @throws {Error} A 401 when the credential is present but unusable.
   */
  async function attachSession(request, reply) {
    const { secret, fromCookie } = presentedSecret(request)

    if (!secret) return false

    const session = await findSession(prisma, secret)

    if (!session) {
      // A secret that resolves to nothing is indistinguishable from a revoked one
      // — the row may have been deleted — and both mean "sign in again".
      throw unauthorized('This session is no longer valid. Sign in again.')
    }

    const loaded = await loadActor(prisma, session.userId)

    if (!loaded) throw unauthorized('The account this session belongs to no longer exists.')

    if (loaded.user.suspendedAt) {
      // Checked on every request rather than only at sign-in: suspending an
      // account has to take effect now, not when its session happens to lapse.
      throw forbidden('This account is suspended.')
    }

    const { valid, reason, rotatedSecret, rotationDeferred } = await refreshSession(prisma, {
      session,
      actor: loaded.actor,
      // Only a cookie caller can be handed a replacement secret. A bearer client
      // has no channel to learn one, and rotating anyway locked it out at the
      // first rotation window — see the note on `refreshSession`.
      canDeliverSecret: fromCookie,
    })

    if (!valid) {
      if (fromCookie) clearSessionCookies(reply)

      throw unauthorized(
        reason === 'idle'
          ? 'This session was idle for too long. Sign in again.'
          : 'This session has ended. Sign in again.',
      )
    }

    if (rotatedSecret && fromCookie) {
      setSessionCookies(reply, rotatedSecret, session.expiresAt)
    }

    if (rotationDeferred) {
      request.log.debug(
        { sessionId: session.id },
        'a bearer session is due for rotation and has no channel to receive the new secret',
      )
    }

    Object.assign(request, {
      currentUser: loaded.user,
      actor: loaded.actor,
      session,
      cookieAuthenticated: fromCookie,
    })

    return true
  }

  /**
   * Check the CSRF defences for a state-changing request.
   *
   * Runs for every request that carries cookie authority, before the handler and
   * before the body is validated. A request authenticated by a bearer token skips
   * the token check — there is nothing a browser can be made to forge, because a
   * browser will not attach that header on its own — but is still origin-checked
   * if it sends an origin at all.
   *
   * @param {object} request The incoming request.
   * @returns {void}
   * @throws {Error} A 403 when the request could be forged.
   */
  function assertNotForged(request) {
    const cookieAuthenticated = request.cookieAuthenticated === true
    const origin = checkOrigin(
      { method: request.method, headers: request.headers, cookieAuthenticated },
      allowedOrigins,
    )

    if (!origin.allowed) {
      request.log.warn(
        { reason: origin.reason, origin: origin.origin, route: request.routeOptions?.url },
        'refused a possibly forged request',
      )

      throw forbidden(
        'This request did not come from a page this service serves. Reload and try again.',
      )
    }

    if (!cookieAuthenticated) return
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(request.method).toUpperCase())) return

    const header = request.headers?.[CSRF_HEADER]
    const supplied = Array.isArray(header) ? header[0] : header

    if (!csrfTokenMatches(request.cookies?.[names.csrf], supplied)) {
      throw forbidden(
        `This request is missing its ${CSRF_HEADER} token, or the token does not match the cookie.`,
      )
    }
  }

  app.decorate('assertNotForged', assertNotForged)

  app.decorate('requireSession', async function requireSession(request, reply) {
    const attached = await attachSession(request, reply)

    if (!attached) throw unauthorized('Sign in to use this endpoint.')

    assertNotForged(request)
  })

  app.decorate('authenticate', async function authenticate(request, reply) {
    // Bearer only: a cookie will not do. Reserved for routes that must not be
    // reachable by a browser carrying an ambient session.
    const header = request.headers?.authorization

    if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
      throw unauthorized('This endpoint requires a bearer token rather than a session cookie.')
    }

    const attached = await attachSession(request, reply)

    if (!attached) throw unauthorized('Sign in to use this endpoint.')

    assertNotForged(request)
  })

  app.decorate('optionalAuth', async function optionalAuth(request, reply) {
    const { secret } = presentedSecret(request)

    if (!secret) {
      Object.assign(request, {
        actor: null,
        currentUser: null,
        session: null,
        cookieAuthenticated: false,
      })
      assertNotForged(request)

      return
    }

    // A *malformed* credential is still refused. Silently downgrading a broken
    // one to anonymous turns an expired session into a mysteriously empty page.
    await attachSession(request, reply)
    assertNotForged(request)
  })

  /**
   * A preHandler asserting the capability a route declares.
   *
   * The scope is where the contract says it is, and nowhere else. That
   * explicitness is the whole point: a capability asserted with *no* organisation
   * is a platform-level check, so an organisation route whose scope cannot be
   * found does not become lenient — it becomes inverted, refusing every organiser
   * and passing every platform admin. That was finding NF-05.
   *
   * There used to be a fallback here that looked for an `organizationId` in the
   * body, then the query, then the params. It read as helpful and was the bug:
   * a route at `/v1/organizations/:id/members` spells it `params.id`, so the
   * fallback found nothing and asserted unscoped. The fallback is gone. The
   * contract checker now *requires* a `capabilityScope` for every
   * organisation-scoped capability and verifies the named key exists in that
   * route's own schema and is required, so by the time a route is registered
   * there is nothing left to guess.
   *
   * A route whose organisation is only known after a record is loaded (the
   * organisation that owns an event, say) declares no capability and asserts in
   * its handler, where the record exists.
   *
   * @param {string} capability The capability from the contract descriptor.
   * @param {string} [scope] Where to read the organisation, as `params.id`. Required unless the capability is platform-only.
   * @returns {Function} A Fastify preHandler.
   */
  function requireCapability(capability, scope) {
    const platformOnly = PLATFORM_ONLY_CAPABILITIES.includes(capability)

    return async function assertCapability(request) {
      if (!scope) {
        // Unreachable for an organisation-scoped capability once the contract
        // checker has run — but a guard that trusts a checker it cannot see is
        // one refactor away from being wrong, and the consequence here is a
        // silent authorization inversion rather than a crash.
        if (!platformOnly) {
          request.log.error(
            { capability },
            'a route asserted an organisation-scoped capability with no capabilityScope',
          )

          throw forbidden('This action is not available.', 'CAPABILITY_SCOPE_MISSING')
        }

        assertCan(request.actor, capability, {})

        return
      }

      const [part, key] = scope.split('.')
      const organizationId = request[part]?.[key] ?? null

      if (typeof organizationId !== 'string' || organizationId.length === 0) {
        // The contract says this field exists and is required, so reaching here
        // means the schema and the scope have drifted apart. Refuse rather than
        // assert unscoped: an unscoped assertion is the inversion itself.
        request.log.error(
          { capability, scope },
          'a capabilityScope named a field the request did not carry',
        )

        throw forbidden('This action is not available.', 'CAPABILITY_SCOPE_MISSING')
      }

      assertCan(request.actor, capability, { organizationId })
    }
  }

  app.decorate('requireCapability', requireCapability)

  app.decorate('requireStepUp', async function requireStepUp(request) {
    if (stepUpSatisfied(request.session)) return

    throw forbidden(
      'This action needs you to confirm your identity again. Authenticate at /v1/auth/step-up and retry.',
      'STEP_UP_REQUIRED',
    )
  })
}
