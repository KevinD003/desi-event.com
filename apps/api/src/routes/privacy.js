/**
 * The record of redacting a person.
 *
 * Two reads, and deliberately only two. Phase 1 of this workstream builds the
 * authorization, the policy and the data model that an irreversible redaction
 * needs, and proves them end to end through the only routes that can exist
 * before the service does: a list and a single read. Nothing here redacts
 * anything, and no route on this surface has a side effect.
 *
 * ## Why a read needs the same capability as the destruction
 *
 * `privacy:redact` gates both. Reading who has asked to be removed from an
 * organisation is part of the same decision as removing them — a list of
 * subjects is a list of people who wanted to leave, and handing it to a wider
 * audience than the one trusted to act on it would defeat the point. The
 * capability is granted to the organisation owner and to nobody else.
 *
 * ## What this surface will not tell you
 *
 * Whether an identifier is real. A request belonging to another organisation
 * and a request that never existed answer the same 404 with the same sentence,
 * because a caller who can tell the difference has a way to confirm that a named
 * person is in the system — which is exactly the question a redaction exists to
 * stop answering.
 *
 * And it will not tell you a value. A subject is an opaque row id; the work is
 * counts by category. There is no field here carrying a name, an address, or
 * anything that was or will be redacted, before or after.
 *
 * @module @desi-event/api/routes/privacy
 */

import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { notFound } from '../lib/errors.js'
import { loadOrganizationForPrivacy, toPrivacyRequest } from '../lib/privacy.js'
import { defineRoute } from '../lib/register.js'

/**
 * Newest first.
 *
 * A privacy queue is read to answer "what has come in", not "what is oldest":
 * unlike the notification outbox there is no backlog to work through, because a
 * request either completed or is waiting on a person.
 *
 * @type {ReadonlyArray<object>}
 */
const REQUEST_ORDER = Object.freeze([{ createdAt: 'desc' }, { id: 'desc' }])

/**
 * Register the privacy routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerPrivacyRoutes(app, { prisma }) {
  defineRoute(app, 'privacy.listRequests', {
    handler: async (request) => {
      const organizationId = request.params.id
      const { page, perPage, state, subjectId } = request.query

      await loadOrganizationForPrivacy(prisma, organizationId)

      const { skip, take } = toSkipTake({ page, perPage })
      // The organisation is in the same `where` that finds the rows rather than
      // filtered afterwards, so another tenant's requests are not counted into
      // `pagination.total` — a total is a leak in its own right.
      const where = {
        organizationId,
        ...(state ? { state } : {}),
        ...(subjectId ? { subjectUserId: subjectId } : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.privacyRequest.findMany({ where, orderBy: REQUEST_ORDER, skip, take }),
        prisma.privacyRequest.count({ where }),
      ])

      return {
        data: rows.map(toPrivacyRequest),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'privacy.getRequest', {
    handler: async (request) => {
      const organizationId = request.params.id

      await loadOrganizationForPrivacy(prisma, organizationId)

      // Scoped in the lookup, not checked after it. A request that belongs to
      // another organisation is not found rather than found-and-refused, which
      // is the same answer a request that does not exist gets.
      const row = await prisma.privacyRequest.findFirst({
        where: { id: request.params.requestId, organizationId },
      })

      if (!row) throw notFound('No such redaction request.')

      return { data: toPrivacyRequest(row) }
    },
  })
}
