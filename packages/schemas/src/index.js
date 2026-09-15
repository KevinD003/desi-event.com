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
export * from './enums.js'
export * from './entities.js'
export * from './requests.js'
export * from './auth.js'
export * from './teams.js'
export * from './responses.js'
export * from './env.js'
export * from './jobs.js'
