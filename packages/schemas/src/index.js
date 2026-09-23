/**
 * `@desi-event/schemas` — the single source of truth for validation.
 *
 * The API validates requests, responses, job payloads and its own environment
 * with these schemas; the worker validates the jobs it consumes; the web app
 * validates forms before they leave the browser; and `@desi-event/api-contract`
 * renders them to JSON Schema for the OpenAPI document. Because there is no
 * compiler in this repository, these schemas *are* the type system.
 *
 * Nothing here imports `@prisma/client`, so the browser bundle stays clean.
 *
 * @module @desi-event/schemas
 */

export * from './payments.js'
export * from './errors.js'
export * from './primitives.js'
export * from './addresses.js'
export * from './enums.js'
export * from './entities.js'
export * from './requests.js'
export * from './auth.js'
export * from './teams.js'
export * from './verification.js'
export * from './seating.js'
export * from './venues.js'
export * from './venue-maps.js'
export * from './payments-wire.js'
export * from './responses.js'
export * from './privacy.js'
export * from './retention.js'
export * from './connect.js'

// `env.js` and `jobs.js` are deliberately NOT re-exported here — finding NF-16.
//
// This barrel is imported by `@desi-event/api-contract/routes.js`, which is
// imported by the browser. Because a barrel is all-or-nothing, one named import
// of one request schema put the API and worker deployment contract into the
// client bundle: the PostgreSQL and Redis variable names, the 32-character
// floor on JWT_SECRET, the AUTH_SECRET-falls-back-to-JWT_SECRET rule, the fee
// constants, and the verbatim list of placeholder secrets the platform refuses
// in production — which is a precise statement of the check an attacker is
// probing against.
//
// Neither module was ever wanted in a browser. They live at
// `@desi-event/schemas/env` and `@desi-event/schemas/jobs`, where the servers
// and the worker ask for them by name.
