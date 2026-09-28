/**
 * Event pictures: the organiser's list, the upload, the three arranging
 * writes, and the bytes.
 *
 * Registered in their own scope, like the webhooks, because the upload's body
 * is a picture rather than JSON: the scope installs a buffer parser for the
 * three picture types and `application/octet-stream` with a 10 MiB limit, and
 * the rest of the API keeps its 1 MiB JSON limit. The scope still inherits the
 * API's JSON and plain-text parsers, which the arranging writes need, so the
 * upload carries its own `onRequest` check: any other Content-Type on it is a
 * 415 before a byte is read.
 *
 * The upload is refused as early as it can be. After the session guard, an
 * `onRequest` gate loads the event and asserts everything that does not need
 * the body — who may edit it, whether its status takes new pictures, gallery
 * room and the organisation's quota — so a caller who would be refused is
 * refused before ten megabytes arrive. The handler asserts all of it again
 * inside the transaction.
 *
 * `@file` rather than `@module`, for the same reason as the event routes.
 *
 * @file @desi-event/api/routes/media
 */

import {
  MEDIA_UPLOAD_CONTENT_TYPES,
  MEDIA_LIMITS,
  PUBLIC_MEDIA_MAX_AGE_SECONDS,
} from '@desi-event/schemas/media'

import { notFound } from '../lib/errors.js'
import {
  addEventMedia,
  describeEventMedia,
  gateUpload,
  isPubliclyServable,
  listEventMedia,
  loadEventForMedia,
  assertMediaChange,
  maySeePrivateMedia,
  removeEventMedia,
  reorderEventMedia,
} from '../lib/event-media.js'
import { MediaRefusal } from '../lib/media/refusal.js'
import { sanitiseImage } from '../lib/media/sanitise.js'
import { createPostgresMediaStorage } from '../lib/media-storage.js'
import { defineRoute } from '../lib/register.js'
import { mediaReadRateLimit, mediaUploadRateLimit } from '../plugins/rate-limit.js'

/** File extension per stored type, for `Content-Disposition`. */
const EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
})

/**
 * The policy a picture response carries: it is an image and nothing else.
 *
 * `sandbox` with no allowances means that even a browser tricked into
 * rendering these bytes as a document would run nothing and reach nothing.
 */
const MEDIA_CSP = "default-src 'none'; sandbox"

/**
 * Install the upload's body parser on a scope.
 *
 * `parseAs: 'buffer'` hands the bytes through untouched; nothing here trusts
 * the declared type, which only decides whether Fastify reads the body at all.
 *
 * @param {object} scope A Fastify instance scoped to the media routes.
 * @returns {void}
 */
export function installImageBodyParser(scope) {
  scope.addContentTypeParser(
    [...MEDIA_UPLOAD_CONTENT_TYPES],
    { parseAs: 'buffer', bodyLimit: MEDIA_LIMITS.maxBytes },
    (_request, body, done) => {
      done(null, body)
    },
  )
}

/**
 * The upload's Content-Type check, as an `onRequest` hook.
 *
 * The media scope inherits the API's JSON and plain-text parsers, because the
 * arranging writes send JSON. Without this check an upload declared as
 * `application/json` or `text/plain` would be read and parsed into an object,
 * an array or a string, and handed to the sanitiser as if it were a picture.
 * Only the four types the scope's own parser takes are let through to the
 * body; a request with no Content-Type is left to Fastify, which reads no body
 * when there is none and refuses one it has no parser for.
 *
 * @param {object} request The Fastify request.
 * @returns {Promise<void>} Resolves when the declared type is one the upload reads.
 * @throws {MediaRefusal} A 415 `UNSUPPORTED_MEDIA_TYPE` for any other declared type.
 */
export async function refuseNonPictureBody(request) {
  const header = request.headers['content-type']

  if (header === undefined) return

  const mediaType = String(header).split(';')[0].trim().toLowerCase()

  if (!MEDIA_UPLOAD_CONTENT_TYPES.includes(mediaType)) {
    throw new MediaRefusal(
      'UNSUPPORTED_MEDIA_TYPE',
      'Send the picture itself as the request body, declared as image/jpeg, image/png, image/webp or application/octet-stream.',
    )
  }
}

/**
 * The `Cache-Control` a served picture carries.
 *
 * @param {boolean} isPublic Whether the picture is public.
 * @param {boolean} withCookie Whether the request carried the session cookie.
 * @returns {string} The header value.
 */
export function cachePolicy(isPublic, withCookie) {
  if (!isPublic) return 'private, no-store'

  return `${withCookie ? 'private' : 'public'}, max-age=${PUBLIC_MEDIA_MAX_AGE_SECONDS}`
}

/**
 * Whether an `If-None-Match` header matches an entity tag.
 *
 * @param {string|string[]|undefined} header The request header.
 * @param {string} etag The strong tag, quoted.
 * @returns {boolean} True on a match.
 */
function matchesEtag(header, etag) {
  const value = Array.isArray(header) ? header.join(',') : header

  if (typeof value !== 'string' || value.length === 0) return false
  if (value.trim() === '*') return true

  return value
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//u, ''))
    .includes(etag)
}

/**
 * Register the picture routes.
 *
 * @param {object} app A Fastify instance, normally the scope that {@link installImageBodyParser} ran on.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} [deps.mediaStorage] The `MediaStorage` adapter. Defaults to PostgreSQL.
 * @param {{max?: number, timeWindow?: string|number}} [deps.mediaUploadLimit] Overrides for the upload rate limit.
 * @param {{max?: number, timeWindow?: string|number}} [deps.mediaReadLimit] Overrides for the read rate limit.
 * @returns {void} Nothing.
 */
export function registerMediaRoutes(
  app,
  { prisma, mediaStorage, mediaUploadLimit, mediaReadLimit },
) {
  const storage = mediaStorage ?? createPostgresMediaStorage(prisma)

  /**
   * The upload's `onRequest` gate: everything that can be refused before the
   * body is read.
   *
   * @param {object} request The Fastify request.
   * @returns {Promise<void>} Resolves when the body may be read.
   */
  async function uploadGate(request) {
    const declared = Number(request.headers['content-length'])

    await gateUpload(prisma, {
      eventId: request.params.id,
      actor: request.actor,
      kind: request.query?.kind,
      declaredBytes: Number.isFinite(declared) ? declared : 0,
    })
  }

  defineRoute(app, 'events.media', {
    handler: async (request) => {
      const event = await loadEventForMedia(prisma, request.params.id)

      // A 404 rather than a 403: whether an organiser has an unannounced
      // event is not a stranger's question to ask.
      if (!maySeePrivateMedia(event, request.actor)) throw notFound('No such event.')

      return { data: await listEventMedia(prisma, event), meta: { revision: event.revision } }
    },
  })

  defineRoute(app, 'events.addMedia', {
    config: { rateLimit: mediaUploadRateLimit(mediaUploadLimit) },
    // MFA enrolment is asserted here as well as in the declared preHandlers,
    // so an un-enrolled privileged account is refused before its body is read.
    // The Content-Type check comes after the gate, so a caller who may not
    // upload at all learns that first; both run before the body is read.
    onRequest: [app.requireMfaEnrolment, uploadGate, refuseNonPictureBody],
    handler: async (request) => {
      const { kind, altText, revision } = request.query
      const event = await loadEventForMedia(prisma, request.params.id)

      // Again, now that the body is here: the gate ran before the body was
      // read, and the event may have moved while it arrived.
      assertMediaChange(event, request.actor, 'upload')

      const upload = sanitiseImage(request.body, { kind })

      const { asset, event: updated } = await addEventMedia(prisma, storage, {
        event,
        actor: request.actor,
        revision,
        kind,
        altText,
        upload,
      })

      request.log.info(
        { eventId: event.id, mediaId: asset.id, kind, byteSize: upload.byteSize },
        'event picture uploaded',
      )

      return {
        data: asset,
        meta: { revision: updated.revision, removed: upload.removed },
      }
    },
  })

  defineRoute(app, 'events.updateMedia', {
    handler: async (request) => {
      const event = await loadEventForMedia(prisma, request.params.id)
      const { asset, event: updated } = await describeEventMedia(prisma, {
        event,
        actor: request.actor,
        revision: request.body.revision,
        mediaId: request.params.mediaId,
        altText: request.body.altText,
      })

      return { data: asset, meta: { revision: updated.revision } }
    },
  })

  defineRoute(app, 'events.reorderMedia', {
    handler: async (request) => {
      const event = await loadEventForMedia(prisma, request.params.id)
      const { event: updated } = await reorderEventMedia(prisma, {
        event,
        actor: request.actor,
        revision: request.body.revision,
        galleryIds: request.body.galleryIds,
      })

      return { data: await listEventMedia(prisma, updated), meta: { revision: updated.revision } }
    },
  })

  defineRoute(app, 'events.removeMedia', {
    handler: async (request) => {
      const event = await loadEventForMedia(prisma, request.params.id)
      const { event: updated } = await removeEventMedia(prisma, storage, {
        event,
        actor: request.actor,
        revision: request.query.revision,
        mediaId: request.params.mediaId,
      })

      return { data: await listEventMedia(prisma, updated), meta: { revision: updated.revision } }
    },
  })

  defineRoute(app, 'media.get', {
    config: { rateLimit: mediaReadRateLimit(mediaReadLimit) },
    handler: async (request, reply) => {
      // Before anything can throw: a refusal is never cacheable.
      reply.header('cache-control', 'no-store')

      const asset = await prisma.mediaAsset.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          contentType: true,
          checksum: true,
          storageKey: true,
          moderationStatus: true,
          scanStatus: true,
          sanitisedAt: true,
          updatedAt: true,
          event: { select: { id: true, status: true, organizationId: true } },
        },
      })

      if (!asset || !asset.event || !EXTENSIONS[asset.contentType] || !asset.checksum) {
        throw notFound('No such picture.')
      }

      const isPublic = isPubliclyServable(asset, asset.event.status)

      // Authorisation before the entity tag: a 304 for a private picture
      // would confirm to a stranger that it exists.
      if (!isPublic && !maySeePrivateMedia(asset.event, request.actor)) {
        throw notFound('No such picture.')
      }

      const etag = `"sha256-${asset.checksum}"`

      /**
       * The headers only a picture actually being served carries. Applied
       * after the last point that can refuse, so a refusal leaves with
       * `no-store` and no entity tag: a 404 pinned in a cache for a day, and
       * later revalidated to a 304, would outlive the fault that caused it.
       *
       * A public picture read with the session cookie is `private`, because
       * the optional session guard may have rotated that session and put a
       * fresh secret in `Set-Cookie` on this very response; a shared cache
       * must never store that. Only a cookieless read — a visitor, the image
       * optimiser — is labelled `public`.
       *
       * @returns {object} The reply.
       */
      const servingHeaders = () =>
        reply
          .header('cache-control', cachePolicy(isPublic, request.cookieAuthenticated === true))
          .header('etag', etag)
          .header('last-modified', new Date(asset.updatedAt).toUTCString())
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', MEDIA_CSP)
          .header('cross-origin-resource-policy', 'same-origin')
          .header(
            'content-disposition',
            `inline; filename="${asset.id}.${EXTENSIONS[asset.contentType]}"`,
          )

      if (matchesEtag(request.headers['if-none-match'], etag)) {
        return servingHeaders().code(304).send()
      }

      const blob = await storage.read(asset.storageKey)

      if (!blob) {
        // An asset whose bytes are missing is an integrity fault, not the
        // caller's problem; it is logged by id and answered like any absence,
        // with the `no-store` set at the top and nothing else.
        request.log.error({ mediaId: asset.id }, 'a picture has no stored bytes')

        throw notFound('No such picture.')
      }

      return servingHeaders()
        .type(asset.contentType)
        .header('content-length', blob.bytes.length)
        .send(blob.bytes)
    },
  })
}
