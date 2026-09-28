/**
 * How a single-use code reaches the person it is for.
 *
 * Two modes, and the difference is who holds the code on its way:
 *
 *   - `EMAIL` — a delivery provider sends it. Nobody at the API boundary ever
 *     sees it again; the response carries no code.
 *   - `MANUAL` — there is no provider, so the code is returned exactly once to
 *     whoever issued it, in the 201 that created it, and they hand it over
 *     themselves. The database keeps only its digest, so it cannot be shown a
 *     second time.
 *
 * This build wires no provider (`server.js`), so it runs `MANUAL`. Before this
 * module existed the same build issued team invitations whose code went to a
 * log line saying nobody could receive it — every invitation was unusable, and
 * nothing said so to the person who sent it.
 *
 * The mode is decided once, at boot. Naming `EMAIL` without a provider refuses
 * to start: an invitation silently dropped is worse than a deployment that
 * will not boot until somebody fixes its configuration.
 *
 * @module @desi-event/api/lib/delivery
 */

/**
 * The delivery modes, mirroring the Prisma `InvitationDelivery` enum.
 *
 * @type {Readonly<{MANUAL: 'MANUAL', EMAIL: 'EMAIL'}>}
 */
export const DELIVERY_MODES = Object.freeze({ MANUAL: 'MANUAL', EMAIL: 'EMAIL' })

/**
 * Decide the delivery mode for this process.
 *
 * | `DELIVERY_MODE` | provider | result |
 * |---|---|---|
 * | unset | none | `MANUAL` |
 * | unset | wired | `EMAIL` |
 * | `MANUAL` | either | `MANUAL` |
 * | `EMAIL` | wired | `EMAIL` |
 * | `EMAIL` | none | throws |
 *
 * @param {object} options Inputs.
 * @param {{DELIVERY_MODE?: string}} [options.env] The parsed API environment.
 * @param {unknown} [options.deliver] The delivery hook, when a provider is wired in.
 * @returns {'MANUAL'|'EMAIL'} The mode.
 * @throws {TypeError} When `EMAIL` is named and there is no provider to send with, or the mode is unknown.
 */
export function resolveDeliveryMode({ env = {}, deliver } = {}) {
  const requested = env?.DELIVERY_MODE
  const hasProvider = typeof deliver === 'function'

  if (requested === undefined || requested === null || requested === '') {
    return hasProvider ? DELIVERY_MODES.EMAIL : DELIVERY_MODES.MANUAL
  }

  if (requested === DELIVERY_MODES.MANUAL) return DELIVERY_MODES.MANUAL

  if (requested === DELIVERY_MODES.EMAIL) {
    if (!hasProvider) {
      throw new TypeError(
        'DELIVERY_MODE is EMAIL but no delivery provider is configured, so invitation codes ' +
          'could not reach anybody. Wire a provider into buildApp, or set DELIVERY_MODE=MANUAL ' +
          'so each code is shown once to whoever issues it.',
      )
    }

    return DELIVERY_MODES.EMAIL
  }

  throw new TypeError(`DELIVERY_MODE must be MANUAL or EMAIL, not ${JSON.stringify(requested)}.`)
}

/**
 * Mark a response as one no cache may keep.
 *
 * `private` as well as `no-store`, so a shared cache between the browser and
 * the API has two reasons to refuse it, and `pragma` for the HTTP/1.0 caches
 * that read nothing else. Used on every response that carries a show-once
 * code, and on the account search, whose results are personal data.
 *
 * @param {object} reply The Fastify reply.
 * @returns {object} The same reply.
 */
export function noStore(reply) {
  reply.header('cache-control', 'no-store, private')
  reply.header('pragma', 'no-cache')

  return reply
}

/**
 * The `delivery` block for a response, and the provider hand-off for `EMAIL`.
 *
 * The one place a route turns a freshly minted secret into what the caller
 * sees. In `MANUAL` the secret goes into the response; in `EMAIL` it goes to
 * the provider and the response carries `null`. Both are marked `no-store`,
 * and either way the caller logs and audits only the mode.
 *
 * @param {object} options Inputs.
 * @param {'MANUAL'|'EMAIL'} options.mode The resolved delivery mode.
 * @param {string} options.secret The code, which exists only in memory.
 * @param {object} options.reply The Fastify reply, for the cache headers.
 * @param {function(object): Promise<void>} [options.deliver] The provider hook, for `EMAIL`.
 * @param {object} [options.message] What the provider is told besides the code.
 * @returns {Promise<{mode: 'MANUAL'|'EMAIL', invitationCode: string|null}>} The block.
 */
export async function deliverCode({ mode, secret, reply, deliver, message = {} }) {
  // Both modes: an EMAIL response carries no code, but it is still the answer
  // to a request that minted one, and there is nothing in it worth caching.
  noStore(reply)

  if (mode === DELIVERY_MODES.EMAIL) {
    await deliver({ ...message, token: secret })

    return { mode: DELIVERY_MODES.EMAIL, invitationCode: null }
  }

  return { mode: DELIVERY_MODES.MANUAL, invitationCode: secret }
}
