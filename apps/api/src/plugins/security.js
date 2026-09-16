/**
 * Transport-level hardening: security headers, CORS and the `httpErrors`
 * helpers.
 *
 * @module @desi-event/api/plugins/security
 */

import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'

/**
 * Parse the `CORS_ORIGIN` variable into a value `@fastify/cors` understands.
 *
 * `*` means "any origin", which is correct for a public read-mostly ticketing
 * API; anything else is treated as a comma-separated allow-list and compared
 * exactly, never by prefix, so `https://evil-desievent.com` cannot pass as
 * `https://desievent.com`.
 *
 * @param {string} value The raw `CORS_ORIGIN` value.
 * @returns {boolean|string[]} `true` for any origin, otherwise the allow-list.
 */
export function parseCorsOrigin(value) {
  const raw = String(value ?? '').trim()
  if (raw === '' || raw === '*') return true

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')
}

/**
 * Register helmet, CORS and sensible.
 *
 * The content security policy permits inline styles and scripts because the
 * bundled Swagger UI at `/docs` is built that way. The API itself only ever
 * returns JSON, so a relaxed CSP costs nothing here — there is no HTML of ours
 * for an injected script to run in.
 *
 * @param {object} app The Fastify instance.
 * @param {object} options Security options.
 * @param {string} options.corsOrigin The raw `CORS_ORIGIN` value.
 * @returns {Promise<void>} Resolves once all three plugins are registered.
 */
export async function registerSecurity(app, { corsOrigin }) {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })

  await app.register(cors, {
    origin: parseCorsOrigin(corsOrigin),
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  })

  await app.register(sensible)
}
