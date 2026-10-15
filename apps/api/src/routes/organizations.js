/**
 * Organisations: the profile their members read, and the route that no longer
 * creates one.
 *
 * Organisations are not created from an account. Organisers join The Desi
 * Events by invitation from its team: an organiser invitation starts a new
 * organisation, verified, when its recipient accepts it
 * (`routes/organizer-invitations.js`, with the writes in
 * `lib/organization-provisioning.js`).
 *
 * `POST /v1/organizations` stays in the contract with the same id, method and
 * path, so a client that still calls it is told where to go rather than handed
 * a 404. It answers 403 `ORGANIZER_INVITATION_REQUIRED` to every signed-in
 * caller — platform staff included, who invite rather than create, so a
 * platform account never ends up owning an organisation it reviews — whatever
 * the body says, and writes nothing.
 *
 * Organisations made from the site before invitations are untouched: they
 * keep their memberships, and the unverified ones keep using the verification
 * queue.
 *
 * @module @desi-event/api/routes/organizations
 */

import { forbidden, notFound } from '../lib/errors.js'
import { toOrganizationProfile } from '../lib/organization-provisioning.js'
import { defineRoute } from '../lib/register.js'

// Re-exported for the modules that read a profile from here.
export { toOrganizationProfile }

/** What a caller who tries to create an organisation is told. */
export const ORGANIZER_INVITATION_REQUIRED_SENTENCE =
  'Organisations are not created from an account here. Organisers join The Desi Events by invitation from its team; if they have sent you an organiser invitation code, enter it at Your account → Accept an organiser invitation (/account/organizations/new).'

/**
 * Register `POST /v1/organizations` and `GET /v1/organizations/:id`.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerOrganizationRoutes(app, { prisma }) {
  defineRoute(app, 'organizations.create', {
    handler: async (request) => {
      // The account, not what it sent: the body is never read.
      request.log.info({ actorId: request.actor.id }, 'refused a self-service organisation')

      throw forbidden(ORGANIZER_INVITATION_REQUIRED_SENTENCE, 'ORGANIZER_INVITATION_REQUIRED')
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
