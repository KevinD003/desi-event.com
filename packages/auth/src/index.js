/**
 * Credential primitives.
 *
 * The parts of authentication that are pure functions over bytes and time:
 * hashing a password, issuing and digesting a bearer secret, sealing a shared
 * secret, computing a one-time password, deciding whether a session is still
 * valid, deciding whether somebody has guessed wrong too often, and the cookie
 * and origin policy that keeps a cookie-authenticated request from being forged.
 *
 * Nothing here touches the database, reads `process.env`, or knows what Fastify
 * is. That separation is the point: these are the rules that must be exhaustively
 * testable, and the API layer is where they are wired to rows and requests.
 *
 * @module @desi-event/auth
 */

export * from './password.js'
export * from './tokens.js'
export * from './sealing.js'
export * from './totp.js'
export * from './sessions.js'
export * from './throttle.js'
export * from './cookies.js'
