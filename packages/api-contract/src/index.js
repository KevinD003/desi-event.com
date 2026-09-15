/**
 * `@desi-event/api-contract` — the REST surface, described once.
 *
 * The Fastify server, the Next.js client and the generated OpenAPI document all
 * read from {@link apiRoutes}. Nothing else in the monorepo is allowed to
 * hard-code a URL, which is what keeps the server and the browser from drifting
 * apart in a repository with no compiler to notice.
 *
 * @module @desi-event/api-contract
 */

export * from './errors.js'
export * from './path.js'
export * from './routes.js'
export * from './openapi.js'
export * from './client.js'

// `validate.js` is deliberately NOT re-exported here. It is a build- and
// CI-time check over the whole contract, it is the only module in this package
// that reaches outside it, and anything importing this barrel is very often a
// browser. It lives at `@desi-event/api-contract/validate` so that reaching for
// it is a decision rather than a side effect of importing the client.
