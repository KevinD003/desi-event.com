/**
 * Organisations somebody creates for themselves, and the profile its members
 * read.
 *
 * Any signed-in account may create one, which is only safe because of what a
 * new organisation cannot do. It starts `UNVERIFIED`: it may draft events, and
 * cannot publish them or be paid until a moderator verifies it
 * (`lib/verification.js` `isEligible`). Nothing in the request can say
 * otherwise — the schema has no field for the verification state, the badge,
 * a suspension, the payout currency or the contact address, and the server
 * sets every one:
 *
 *   - the contact address is the creator's own account email. The platform
 *     writes to it; it is never shown publicly, and never sent to the browser
 *     by the form that creates it;
 *   - the payout currency is USD, the one this catalogue sells in;
 *   - the creator's platform role is left alone. `ORGANIZER` grants nothing;
 *     the `OWNER` membership is where the authority is.
 *
 * Two limits stop one account filling the table: five attempts an hour per
 * account (the route's rate limit) and three organisations a day per account,
 * counted with the creator's user row locked so two requests at once cannot
 * both see two.
 *
 * `OWNER` is a privileged role. Creating an organisation is therefore a
 * privilege change (finding NF-10), and a privileged account without a second
 * factor is refused by every guarded route until it enrols one — so the
 * response says whether it must.
 *
 * @module @desi-event/api/routes/organizations
 */

import { ORGANIZATIONS_PER_ACCOUNT_PER_DAY } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import {
  conflict,
  databaseErrorCode,
  notFound,
  tooManyRequests,
  unprocessable,
} from '../lib/errors.js'
import { disambiguateSlug, slugify } from '../lib/identifiers.js'
import { revokeOtherSessionsOf, secureSessionAfterGain } from '../lib/privilege-change.js'
import { defineRoute } from '../lib/register.js'
import { isEligible } from '../lib/verification.js'

/** The window the per-account creation cap counts over. */
export const ORGANIZATION_CAP_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The per-route rate limit on creation, per signed-in account.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const ORGANIZATION_CREATE_LIMIT = Object.freeze({ max: 5, timeWindow: '1 hour' })

/**
 * Build the per-route `config.rateLimit` object for creation.
 *
 * Keyed on the signed-in account, not the address. Every browser request
 * reaches the API through the web app's same-origin proxy, so keyed by address
 * the whole site shared one budget of five organisations an hour — the web
 * server's — and one person's attempts spent everybody's. Run at `preHandler`,
 * after the session guard, so the account is known; an anonymous request is
 * refused before it spends anything. The same reasoning as the pass and door
 * budgets in `plugins/rate-limit.js`.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, for tests.
 * @returns {object} The effective creation limit.
 */
export function organizationCreateRateLimit(overrides = {}) {
  return {
    ...ORGANIZATION_CREATE_LIMIT,
    ...overrides,
    hook: 'preHandler',
    keyGenerator: (request) =>
      request.actor?.id
        ? `organization-create:actor:${request.actor.id}`
        : `organization-create:ip:${request.ip}`,
  }
}

/** The currency a self-created organisation is paid in: the one this catalogue sells in. */
export const SELF_CREATED_PAYOUT_CURRENCY = 'USD'

/**
 * An organisation, as its own members read it.
 *
 * An allow-list. The contact address, payout currency, suspension reason and
 * creator are deliberately absent; the response schema would strip them too.
 *
 * @param {object} organization The organisation row.
 * @returns {object} The profile.
 */
export function toOrganizationProfile(organization) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    description: organization.description ?? null,
    websiteUrl: organization.websiteUrl ?? null,
    timezone: organization.timezone,
    legalName: organization.legalName ?? null,
    verificationStatus: organization.verificationStatus,
    eligible: isEligible(organization),
    createdAt: organization.createdAt,
  }
}

/**
 * Whether a thrown value is a unique-constraint violation.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True for `P2002` or `23505`.
 */
function isUniqueViolation(error) {
  const code = databaseErrorCode(error)

  return code === 'P2002' || code === '23505'
}

/**
 * The slug a name makes, or a refusal that talks about names.
 *
 * `slugify`'s own refusal talks about a title, which an organisation does not
 * have. A name written entirely outside the Latin alphabet is a reasonable
 * name that simply makes no web address; the caller supplies one.
 *
 * @param {string} name The organisation's name.
 * @returns {string} The slug.
 * @throws {Error} A 422 naming the field to supply.
 */
function slugFromName(name) {
  try {
    return slugify(name)
  } catch (error) {
    if (error?.statusCode !== 422) throw error

    throw unprocessable(
      'That name makes no web address, because it has no letters from A to Z or digits. Supply "slug".',
      { field: 'slug' },
    )
  }
}

/**
 * Register `POST /v1/organizations` and `GET /v1/organizations/:id`.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {{max?: number, timeWindow?: string|number}} [deps.organizationCreateLimit] Overrides for the creation rate limit, for tests.
 * @returns {void} Nothing.
 */
export function registerOrganizationRoutes(app, { prisma, organizationCreateLimit }) {
  /**
   * Create the organisation and its owner, in one transaction.
   *
   * @param {object} request The request.
   * @param {string} slug The slug to try.
   * @param {Date} now The current time.
   * @returns {Promise<{organization: object, siblingsRevoked: number}>} The new row.
   * @throws {Error} A 429 past the daily cap; the database's unique violation for a taken slug.
   */
  function createWithOwner(request, slug, now) {
    const { name, timezone, description, websiteUrl } = request.body

    return prisma.$transaction(async (tx) => {
      // Locked first, so two creations by one account at the same moment
      // count one after the other and the cap holds.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${request.actor.id} FOR UPDATE`

      const since = new Date(now.getTime() - ORGANIZATION_CAP_WINDOW_MS)
      const recent = await tx.organization.findMany({
        where: { createdById: request.actor.id, createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      })

      if (recent.length >= ORGANIZATIONS_PER_ACCOUNT_PER_DAY) {
        const oldest = recent[0].createdAt.getTime()
        const retryAfterSeconds = (oldest + ORGANIZATION_CAP_WINDOW_MS - now.getTime()) / 1000

        throw tooManyRequests(
          `An account can create ${ORGANIZATIONS_PER_ACCOUNT_PER_DAY} organisations a day, and this one has. Try again later.`,
          retryAfterSeconds,
        )
      }

      const organization = await tx.organization.create({
        data: {
          name,
          slug,
          description: description ?? null,
          websiteUrl: websiteUrl ?? null,
          timezone,
          // Set here and nowhere in the request: see the module comment.
          contactEmail: request.currentUser.email,
          payoutCurrency: SELF_CREATED_PAYOUT_CURRENCY,
          verificationStatus: 'UNVERIFIED',
          verified: false,
          createdById: request.actor.id,
        },
      })

      const membership = await tx.membership.create({
        data: { userId: request.actor.id, organizationId: organization.id, role: 'OWNER' },
      })

      // Finding NF-10: the caller's other sessions were opened without this
      // authority, and end with the transaction that granted it.
      const siblingsRevoked = await revokeOtherSessionsOf(tx, request, now)

      await recordAudit(tx, {
        actorId: request.actor.id,
        action: AUDIT_ACTIONS.ORGANIZATION_CREATED,
        entityType: 'Organization',
        entityId: organization.id,
        // The slug and the role; never the contact address.
        metadata: {
          slug: organization.slug,
          role: 'OWNER',
          membershipId: membership.id,
          siblingsRevoked,
        },
      })

      return { organization, siblingsRevoked }
    })
  }

  defineRoute(app, 'organizations.create', {
    config: { rateLimit: organizationCreateRateLimit(organizationCreateLimit ?? {}) },
    handler: async (request, reply) => {
      const requested = request.body.slug
      let derived = requested ?? slugFromName(request.body.name)

      // A courtesy check, so the common collision is answered before a
      // transaction is opened. The unique index is what actually decides, and
      // a collision it reports is handled below.
      const taken = await prisma.organization.findUnique({ where: { slug: derived } })

      if (taken && requested) {
        throw conflict('That web address is taken by another organisation. Choose another.')
      }

      if (taken) derived = disambiguateSlug(derived)

      const now = new Date()
      let created

      try {
        created = await createWithOwner(request, derived, now)
      } catch (error) {
        if (!isUniqueViolation(error)) throw error

        // A slug somebody asked for is theirs to change; one the server derived
        // is the server's to make unique, once.
        if (requested) {
          throw conflict('That web address is taken by another organisation. Choose another.')
        }

        try {
          created = await createWithOwner(request, disambiguateSlug(derived), now)
        } catch (retryError) {
          if (isUniqueViolation(retryError)) {
            throw conflict('Could not find a free web address for that name. Supply one.')
          }

          throw retryError
        }
      }

      const session = await secureSessionAfterGain(app, prisma, { request, reply, now })

      request.log.info(
        {
          organizationId: created.organization.id,
          siblingsRevoked: created.siblingsRevoked,
          rotated: session.rotated,
        },
        'created an organisation',
      )

      return {
        data: {
          ...toOrganizationProfile(created.organization),
          role: 'OWNER',
          session: { mfaRequired: session.mfaRequired, mfaEnrolled: session.mfaEnrolled },
        },
      }
    },
  })

  defineRoute(app, 'organizations.get', {
    handler: async (request) => {
      const organization = await prisma.organization.findUnique({
        where: { id: request.params.id },
      })

      if (!organization) throw notFound('No such organisation.')

      return { data: toOrganizationProfile(organization) }
    },
  })
}
