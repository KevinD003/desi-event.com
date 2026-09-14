/**
 * Authentication: password hashing, token issue, and the two request guards.
 *
 * Authorization is *not* here. Once `authenticate` has built the actor, every
 * decision about what that actor may do is delegated to `assertCan` from
 * `@desi-event/permissions`; this module never compares a role.
 *
 * @module @desi-event/api/plugins/auth
 */

import jwt from '@fastify/jwt'
import bcrypt from 'bcryptjs'

import { loadActor } from '../lib/actor.js'
import { unauthorized } from '../lib/errors.js'

/**
 * bcrypt cost factor. Ten rounds is roughly 60ms on a modern server: slow
 * enough to make offline cracking expensive, fast enough that a login does not
 * become the slowest thing in the request.
 */
export const BCRYPT_ROUNDS = 10

/**
 * A real bcrypt hash of a throwaway string.
 *
 * Sign-in compares against this when the email is unknown, so an unregistered
 * address costs the same ~60ms as a registered one. Without it, a fast
 * rejection would tell an attacker which addresses have accounts.
 *
 * @type {string}
 */
export const DUMMY_PASSWORD_HASH =
  '$2b$10$ZqBKkLSqSsKxpy98eAsJ/uSKZ9oxWCHVmlEoxYrmU8iG.ukUu.kj2'

/**
 * Hash a plaintext password.
 *
 * @param {string} password The plaintext password.
 * @returns {Promise<string>} The bcrypt hash.
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

/**
 * Verify a plaintext password against a stored hash.
 *
 * @param {string} password The plaintext password supplied by the caller.
 * @param {string} passwordHash The stored bcrypt hash.
 * @returns {Promise<boolean>} True when the password matches.
 */
export async function verifyPassword(password, passwordHash) {
  if (typeof passwordHash !== 'string' || passwordHash === '') return false
  return bcrypt.compare(password, passwordHash)
}

/**
 * Register JWT support and decorate the instance with the auth guards.
 *
 * Adds:
 *  * `app.issueToken(user)` — mint a bearer token for a user row.
 *  * `app.authenticate` — a preHandler that rejects anonymous callers.
 *  * `app.optionalAuth` — a preHandler that populates the actor when a token is
 *    present and leaves it `null` otherwise. A *malformed* token is still
 *    rejected: silently downgrading a broken credential to anonymous would
 *    turn an expired session into a mysteriously empty page.
 *
 * @param {object} app The Fastify instance.
 * @param {object} options Auth options.
 * @param {object} options.prisma The Prisma client used to load users and memberships.
 * @param {object} options.env The parsed API environment.
 * @returns {Promise<void>} Resolves once the decorators are installed.
 */
export async function registerAuth(app, { prisma, env }) {
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  })

  app.decorateRequest('actor', null)
  app.decorateRequest('currentUser', null)

  /**
   * Mint a bearer token for a user.
   *
   * The payload deliberately carries only identity, never memberships: an
   * organiser demoted this morning must lose access this morning, not when
   * their seven-day token happens to lapse.
   *
   * @param {object} user A `User` row.
   * @returns {string} A signed JWT.
   */
  function issueToken(user) {
    return app.jwt.sign({ sub: user.id, role: user.role, email: user.email })
  }

  /**
   * Resolve the verified token to a user and attach the actor to the request.
   *
   * @param {object} request The incoming request.
   * @returns {Promise<void>} Resolves once `request.actor` is set.
   * @throws {Error} A 401 when the token names a user that no longer exists.
   */
  async function attachActor(request) {
    const subject = /** @type {{sub?: unknown}} */ (request.user ?? {}).sub

    if (typeof subject !== 'string' || subject === '') {
      throw unauthorized('The bearer token is missing its subject claim.')
    }

    const loaded = await loadActor(prisma, subject)

    if (!loaded) {
      throw unauthorized('The account this token belongs to no longer exists.')
    }

    // Assigned together so the request never carries a user without an actor.
    Object.assign(request, { currentUser: loaded.user, actor: loaded.actor })
  }

  app.decorate('issueToken', issueToken)

  app.decorate('authenticate', async function authenticate(request) {
    await request.jwtVerify()
    await attachActor(request)
  })

  app.decorate('optionalAuth', async function optionalAuth(request) {
    const header = request.headers.authorization

    if (typeof header !== 'string' || header.trim() === '') {
      Object.assign(request, { actor: null, currentUser: null })
      return
    }

    await request.jwtVerify()
    await attachActor(request)
  })
}
