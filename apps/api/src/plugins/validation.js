/**
 * Wire Zod into Fastify as both validator and serializer.
 *
 * @module @desi-event/api/plugins/validation
 */

import { zodSerializerCompiler, zodValidatorCompiler } from '../lib/validation.js'

/**
 * Install the Zod validator and serializer compilers on an instance.
 *
 * Applied at the root so every route inherits them; route schemas are then
 * plain Zod objects taken straight from `@desi-event/api-contract`.
 *
 * @param {object} app The Fastify instance.
 * @returns {Promise<void>} Resolves once both compilers are installed.
 */
export async function registerValidation(app) {
  app.setValidatorCompiler(zodValidatorCompiler)
  app.setSerializerCompiler(zodSerializerCompiler)
}
