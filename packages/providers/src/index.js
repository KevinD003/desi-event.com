/**
 * `@desi-event/providers` — the seam between Desi-Event and the outside world.
 *
 * Four capabilities the platform cannot implement itself: taking money, sending
 * email, sending SMS, and storing files. Each is described here as an interface
 * (a JSDoc `@typedef` plus a Zod schema), shipped with an in-memory
 * implementation, and reached through a registry that validates every slot at
 * construction.
 *
 * Nothing in this package performs I/O. The in-memory providers are not throwaway
 * mocks — they are the substrate the API and worker suites run against, so they
 * model real lifecycles (authorise → capture → refund) and fail in the same
 * shapes a real adapter would, with a distinct `ProviderError.code` per failure.
 *
 * ```js
 * import { createInMemoryProviderRegistry } from '@desi-event/providers'
 *
 * const providers = createInMemoryProviderRegistry()
 * const intent = providers.payments.createIntent({ amountCents: 2500, currency: 'INR' })
 * providers.payments.capture(intent.id)      // -> status SUCCEEDED
 * providers.email.sent                       // -> every message the system tried to send
 * ```
 *
 * @module @desi-event/providers
 */

export {
  ProviderError,
  PROVIDER_ERROR_CODES,
  DEFAULT_PROVIDER_ERROR_STATUS,
  isProviderError,
  statusForProviderErrorCode,
} from './errors.js'

export {
  PROVIDER_KINDS,
  PROVIDER_METHODS,
  paymentProviderSchema,
  emailProviderSchema,
  smsProviderSchema,
  storageProviderSchema,
  assertPaymentProvider,
  assertEmailProvider,
  assertSmsProvider,
  assertStorageProvider,
  inspectProvider,
} from './interfaces.js'

export {
  createInMemoryPaymentProvider,
  PAYMENT_INTENT_STATUS,
  PAYMENT_DECLINE_AMOUNT_CENTS,
  PAYMENT_TIMEOUT_AMOUNT_CENTS,
  DEFAULT_DECLINE_CODE,
  toPaymentStatus,
} from './payments.js'

export { createInMemoryEmailProvider, EMAIL_BOUNCE_ADDRESS, DEFAULT_EMAIL_FROM } from './email.js'

export { createInMemorySmsProvider, SMS_FAILURE_NUMBER, DEFAULT_SMS_SENDER } from './sms.js'

export {
  createInMemoryStorageProvider,
  DEFAULT_STORAGE_BASE_URL,
  DEFAULT_STORAGE_BUCKET,
  DEFAULT_CONTENT_TYPE,
} from './storage.js'

export {
  createProviderRegistry,
  createInMemoryProviderRegistry,
  resetProviderRegistry,
} from './registry.js'
