/**
 * Importing listed events, by the Desi-Event team (SPEC2-XI area I): the runs,
 * their plans, applying and approving them, copying pictures again, and moving
 * an imported event to an organiser's own organisation.
 *
 * Every route is held by `event:import` (ADMIN and SUPER_ADMIN); approving also
 * needs `moderation:review`, checked here because the contract names one
 * capability. Applying and retrying pictures need a second factor within the
 * MODERATION window, approving and moving one within the EVENT_PUBLISH window.
 * Previews, applies and retries share one budget per administrator. Nothing
 * here is cached.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/routes/event-imports
 */

import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'
import { IMPORT_LIMITS } from '@desi-event/schemas/imports'

import {
  applyImport,
  approveImported,
  importTargets,
  listRuns,
  loadRun,
  previewImport,
  reassignImportedEvent,
  retryRunImages,
  toRunView,
} from '../lib/event-import.js'
import { EVENT_MEDIA_INCLUDE } from '../lib/event-media.js'
import { httpError } from '../lib/errors.js'
import { IMPORTED_FROM_SELECT, toEventDetail } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'
import { WEBSITE_REDIRECT_INCLUDE, websiteViewFor } from '../lib/website-redirect.js'
import { eventImportRateLimit } from '../plugins/rate-limit.js'
import { feeConfigFor } from './orders.js'

/** What an event's detail is read with after a move. */
const DETAIL_INCLUDE = Object.freeze({
  venue: true,
  organization: true,
  ticketTypes: true,
  sessions: { orderBy: [{ startsAt: 'asc' }, { sortOrder: 'asc' }] },
  ...EVENT_MEDIA_INCLUDE,
  ...WEBSITE_REDIRECT_INCLUDE,
  importItem: IMPORTED_FROM_SELECT,
})

/**
 * Register the import routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.env The parsed API environment.
 * @param {object} [deps.mediaStorage] Where picture bytes live; PostgreSQL by default.
 * @param {Function} [deps.fetchImportImage] How one picture is copied; the SSRF-safe fetcher by default.
 * @param {{max?: number, timeWindow?: string|number}} [deps.eventImportLimit] Overrides for the import budget.
 * @returns {void} Nothing.
 */
export function registerEventImportRoutes(
  app,
  { prisma, env, mediaStorage, fetchImportImage, eventImportLimit },
) {
  const budget = eventImportRateLimit(eventImportLimit ?? {})
  const pricing = env ? { feeConfigFor: (currency) => feeConfigFor(env, currency) } : {}
  const storage = mediaStorage

  /**
   * The run as the page reads it, with how many pictures still wait.
   *
   * @param {string} runId The run.
   * @param {Date} now The moment.
   * @returns {Promise<object>} The response body.
   */
  async function runBody(runId, now) {
    const view = await toRunView(prisma, await loadRun(prisma, runId), now)

    return { data: view, meta: { picturesWaiting: view.pictures.waiting } }
  }

  defineRoute(app, 'eventImports.list', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const { page, perPage } = request.query
      const { rows, total } = await listRuns(prisma, toSkipTake({ page, perPage }), new Date())

      return { data: rows, pagination: buildPaginationMeta({ page, perPage, total }) }
    },
  })

  defineRoute(app, 'eventImports.preview', {
    // A file of up to 2 MiB; the API-wide limit is 1 MiB.
    bodyLimit: IMPORT_LIMITS.datasetBytes,
    preHandler: [budget],
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const now = new Date()
      const run = await previewImport(prisma, {
        fileName: request.body.fileName,
        dataset: request.body.dataset,
        actor: request.actor,
        via: 'web',
        now,
      })

      request.log.info(
        { runId: run.id, eventCount: run.eventCount, actorId: request.actor.id },
        'import previewed',
      )

      return { data: await toRunView(prisma, run, now) }
    },
  })

  defineRoute(app, 'eventImports.get', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      return runBody(request.params.runId, new Date())
    },
  })

  defineRoute(app, 'eventImports.apply', {
    preHandler: [budget],
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const run = await loadRun(prisma, request.params.runId)
      const { results, pictures } = await applyImport(prisma, storage, {
        run,
        actor: request.actor,
        planDigest: request.body.planDigest,
        updateFromSource: request.body.updateFromSource,
        via: 'web',
        env,
        fetchImage: fetchImportImage,
        log: request.log,
      })

      request.log.info(
        {
          runId: run.id,
          written: results.filter((result) => result.outcome === 'WRITTEN').length,
          refused: results.filter((result) => result.outcome === 'REFUSED').length,
          picturesStored: pictures.stored,
          picturesFailed: pictures.failed,
          actorId: request.actor.id,
        },
        'import applied',
      )

      return runBody(run.id, new Date())
    },
  })

  defineRoute(app, 'eventImports.retryImages', {
    preHandler: [budget],
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const run = await loadRun(prisma, request.params.runId)
      const pictures = await retryRunImages(prisma, storage, {
        run,
        actor: request.actor,
        eventIds: request.body?.eventIds ?? null,
        env,
        fetchImage: fetchImportImage,
        log: request.log,
      })

      request.log.info(
        { runId: run.id, ...pictures, actorId: request.actor.id },
        'import pictures retried',
      )

      return runBody(run.id, new Date())
    },
  })

  defineRoute(app, 'eventImports.approve', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      // Approving is a review decision: the importer's capability alone is not
      // enough.
      assertCan(request.actor, CAPABILITIES.MODERATION_REVIEW)

      const run = await loadRun(prisma, request.params.runId)

      if (run.status !== 'APPLIED') {
        throw httpError(
          409,
          'NOT_EDITABLE',
          'This plan has not been applied, so it has no events to approve.',
        )
      }

      const results = await approveImported(prisma, {
        run,
        items: request.body.items,
        actor: request.actor,
      })

      request.log.info(
        {
          runId: run.id,
          published: results.filter((result) => result.outcome === 'PUBLISHED').length,
          refused: results.filter((result) => result.outcome === 'REFUSED').length,
          actorId: request.actor.id,
        },
        'imported events approved',
      )

      return { data: { results } }
    },
  })

  defineRoute(app, 'eventImports.targets', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      return { data: await importTargets(prisma, request.query) }
    },
  })

  defineRoute(app, 'eventImports.reassign', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const { organizationId, reason, revision } = request.body
      const moved = await reassignImportedEvent(prisma, {
        eventId: request.params.eventId,
        organizationId,
        reason,
        revision,
        actor: request.actor,
      })

      request.log.info(
        { eventId: moved.id, organizationId, actorId: request.actor.id },
        'imported event moved',
      )

      const full = await prisma.event.findUnique({
        where: { id: moved.id },
        include: DETAIL_INCLUDE,
      })

      return {
        data: toEventDetail(full, {
          includeDraftTiers: true,
          includeOnlineUrl: true,
          website: websiteViewFor(request.actor, full),
          ...pricing,
        }),
      }
    },
  })
}
