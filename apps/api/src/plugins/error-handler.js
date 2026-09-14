/**
 * The single exit point for every failure.
 *
 * Whatever a route throws — a Zod validation failure, a `PermissionError`, an
 * `InventoryError` from a lost race, a declined card from the payment
 * provider, or an outright bug — leaves through here as the one envelope
 * described by `errorResponseSchema`.
 *
 * @module @desi-event/api/plugins/error-handler
 */

import { normaliseError, notFound, toErrorBody } from '../lib/errors.js'

/**
 * Install the error and not-found handlers.
 *
 * Anything 500 or above is logged with the request id and the full error (pino
 * serialises `err` with its stack); 4xx responses are logged at `info` because
 * they are ordinary traffic, not incidents. In production the response body for
 * a 5xx carries a fixed message, so an internal detail cannot escape even if a
 * dependency throws something chatty.
 *
 * @param {object} app The Fastify instance.
 * @param {object} options Handler options.
 * @param {string} options.nodeEnv The resolved `NODE_ENV`.
 * @returns {Promise<void>} Resolves once the handlers are installed.
 */
export async function registerErrorHandler(app, { nodeEnv }) {
  const exposeInternals = nodeEnv !== 'production'

  app.setErrorHandler((error, request, reply) => {
    const normalised = normaliseError(error, { exposeInternals })

    if (normalised.statusCode >= 500) {
      request.log.error(
        { err: error, requestId: request.id, url: request.url, method: request.method },
        'request failed',
      )
    } else {
      request.log.info(
        {
          requestId: request.id,
          url: request.url,
          method: request.method,
          statusCode: normalised.statusCode,
          code: normalised.code,
        },
        'request rejected',
      )
    }

    reply
      .code(normalised.statusCode)
      .type('application/json; charset=utf-8')
      .send(toErrorBody(normalised, request.id))
  })

  app.setNotFoundHandler((request, reply) => {
    const normalised = normaliseError(notFound(`Route ${request.method} ${request.url} not found.`))

    reply
      .code(normalised.statusCode)
      .type('application/json; charset=utf-8')
      .send(toErrorBody(normalised, request.id))
  })
}
