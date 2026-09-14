/**
 * Registration, sign-in and session introspection.
 *
 * @module @desi-event/api/routes/auth
 */

import { publicUserSchema } from '@desi-event/schemas'

import { conflict, unauthorized } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { authRateLimit } from '../plugins/rate-limit.js'
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../plugins/auth.js'

/**
 * Prisma's unique-constraint violation code.
 *
 * Checking for an existing email before inserting is a courtesy, not a
 * guarantee: two simultaneous sign-ups both pass the check. The database's
 * unique index is what actually prevents the duplicate, and this is how that
 * outcome is recognised and turned into the same 409.
 */
const UNIQUE_VIOLATION = 'P2002'

/**
 * Whether an error is a unique-constraint violation.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True when the database refused a duplicate.
 */
function isUniqueViolation(error) {
  return /** @type {{code?: unknown}} */ (error)?.code === UNIQUE_VIOLATION
}

/**
 * Build the body of a successful authentication.
 *
 * @param {object} app The Fastify instance, for `issueToken`.
 * @param {object} user The `User` row.
 * @param {string} expiresIn The configured token lifetime.
 * @returns {object} A payload satisfying `authResponseSchema`.
 */
function toAuthResponse(app, user, expiresIn) {
  return {
    token: app.issueToken(user),
    tokenType: 'Bearer',
    expiresIn,
    user: publicUserSchema.parse(user),
  }
}

/**
 * Register the `/v1/auth` routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.env The parsed API environment.
 * @param {{max?: number, timeWindow?: string|number}} [deps.authLimit] Overrides for the credential-endpoint rate limit.
 * @returns {void} Nothing.
 */
export function registerAuthRoutes(app, { prisma, env, authLimit }) {
  const limit = { rateLimit: authRateLimit(authLimit) }

  defineRoute(app, 'auth.register', {
    config: limit,
    handler: async (request) => {
      const { email, password, displayName, phone, locale, role } = request.body

      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) {
        throw conflict('An account with this email address already exists.')
      }

      const passwordHash = await hashPassword(password)

      let user
      try {
        user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            displayName,
            phone: phone ?? null,
            locale,
            role,
          },
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('An account with this email address already exists.')
        }
        throw error
      }

      request.log.info({ userId: user.id, role: user.role }, 'account created')

      return toAuthResponse(app, user, env.JWT_EXPIRES_IN)
    },
  })

  defineRoute(app, 'auth.login', {
    config: limit,
    handler: async (request) => {
      const { email, password } = request.body

      const user = await prisma.user.findUnique({ where: { email } })

      // An unknown address and a wrong password answer identically, and the
      // hash comparison runs either way, so neither the response body nor the
      // response time reveals whether the account exists.
      const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH
      const valid = await verifyPassword(password, passwordHash)

      if (!user || !valid) {
        throw unauthorized('Invalid email address or password.')
      }

      return toAuthResponse(app, user, env.JWT_EXPIRES_IN)
    },
  })

  defineRoute(app, 'auth.me', {
    handler: async (request) => ({ data: publicUserSchema.parse(request.currentUser) }),
  })
}
