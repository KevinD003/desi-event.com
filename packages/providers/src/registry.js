/**
 * The registry: one frozen object carrying all four adapters.
 *
 * Everything downstream — API routes, worker jobs — takes the registry rather
 * than importing a provider directly, which is what lets a test swap the whole
 * outside world in one line. Construction validates every slot, so a
 * half-configured deployment fails at boot with a message naming the missing
 * adapter instead of at 2am on the first refund.
 *
 * @module @desi-event/providers/registry
 */

import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'
import { PROVIDER_KINDS, assertProvider } from './interfaces.js'
import { isPlainObject } from './internal.js'
import { createInMemoryPaymentProvider } from './payments.js'
import { createInMemoryEmailProvider } from './email.js'
import { createInMemorySmsProvider } from './sms.js'
import { createInMemoryStorageProvider } from './storage.js'

/**
 * Build a validated, frozen {@link ProviderRegistry}.
 *
 * @param {object} providers The four adapters.
 * @param {PaymentProvider} providers.payments Payment adapter.
 * @param {EmailProvider} providers.email Email adapter.
 * @param {SmsProvider} providers.sms SMS adapter.
 * @param {StorageProvider} providers.storage File storage adapter.
 * @returns {ProviderRegistry} A frozen registry; mutating it is a no-op in sloppy mode and throws in strict mode.
 * @throws {ProviderError} `INCOMPLETE_REGISTRY` when a slot is absent, listing every missing kind; `INVALID_PROVIDER` when a slot is filled but does not satisfy its interface.
 */
export function createProviderRegistry(providers) {
  if (!isPlainObject(providers)) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INCOMPLETE_REGISTRY,
      `Expected an object with ${PROVIDER_KINDS.join(', ')} providers`,
      {
        issues: PROVIDER_KINDS.map((kind) => ({
          path: kind,
          code: 'missing_provider',
          message: `${kind} provider is missing`,
        })),
        details: {
          missing: [...PROVIDER_KINDS],
          received: providers === null ? 'null' : typeof providers,
        },
      },
    )
  }

  const missing = PROVIDER_KINDS.filter(
    (kind) => providers[kind] === undefined || providers[kind] === null,
  )

  if (missing.length > 0) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INCOMPLETE_REGISTRY,
      `Provider registry is missing: ${missing.join(', ')}`,
      {
        issues: missing.map((kind) => ({
          path: kind,
          code: 'missing_provider',
          message: `${kind} provider is missing`,
        })),
        details: { missing },
      },
    )
  }

  for (const kind of PROVIDER_KINDS) assertProvider(kind, providers[kind])

  return /** @type {ProviderRegistry} */ (
    Object.freeze({
      payments: providers.payments,
      email: providers.email,
      sms: providers.sms,
      storage: providers.storage,
    })
  )
}

/**
 * @typedef {object} InMemoryRegistryOptions
 * @property {object} [payments] Options forwarded to {@link createInMemoryPaymentProvider}.
 * @property {object} [email] Options forwarded to {@link createInMemoryEmailProvider}.
 * @property {object} [sms] Options forwarded to {@link createInMemorySmsProvider}.
 * @property {object} [storage] Options forwarded to {@link createInMemoryStorageProvider}.
 * @property {(Date|number|string|function(): (Date|number|string))} [now] Clock shared by all four providers unless overridden per kind.
 */

/**
 * Build a registry of fresh in-memory providers — the default wiring for
 * development, and the one the API and worker suites run against.
 *
 * @param {InMemoryRegistryOptions} [options] Per-kind options, plus a shared `now`.
 * @returns {ProviderRegistry} A frozen registry of in-memory adapters.
 * @throws {ProviderError} `INVALID_OPTIONS` when a forwarded option is malformed.
 */
export function createInMemoryProviderRegistry(options = {}) {
  const { payments = {}, email = {}, sms = {}, storage = {}, now } = options

  /**
   * Fold the shared clock into a per-kind options bag.
   *
   * @param {object} kindOptions Options for one provider kind.
   * @returns {object} The same options with `now` defaulted.
   */
  const withClock = (kindOptions) => (now === undefined ? kindOptions : { now, ...kindOptions })

  return createProviderRegistry({
    payments: createInMemoryPaymentProvider(withClock(payments)),
    email: createInMemoryEmailProvider(withClock(email)),
    sms: createInMemorySmsProvider(withClock(sms)),
    storage: createInMemoryStorageProvider(withClock(storage)),
  })
}

/**
 * Clear every in-memory provider in a registry that supports it.
 *
 * Handy in a `beforeEach`: one call instead of four, and adapters that do not
 * expose `reset()` (a real one, say) are simply skipped.
 *
 * @param {ProviderRegistry} registry The registry to clear.
 * @returns {string[]} The kinds that were actually reset.
 * @throws {ProviderError} `INVALID_OPTIONS` when `registry` is not an object.
 */
export function resetProviderRegistry(registry) {
  if (registry === null || typeof registry !== 'object') {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      'resetProviderRegistry expects a provider registry',
      { details: { received: registry === null ? 'null' : typeof registry } },
    )
  }

  /** @type {string[]} */
  const reset = []
  for (const kind of PROVIDER_KINDS) {
    const provider = registry[kind]
    if (provider && typeof provider.reset === 'function') {
      provider.reset()
      reset.push(kind)
    }
  }
  return reset
}
