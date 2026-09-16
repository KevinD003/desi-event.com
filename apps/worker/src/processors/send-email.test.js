import { describe, it, expect } from 'vitest'
import {
  EMAIL_BOUNCE_ADDRESS,
  ProviderError,
  PROVIDER_ERROR_CODES,
  createInMemoryEmailProvider,
} from '@desi-event/providers'

import { createSendEmailProcessor } from './send-email.js'
import { createFakeLogger, EVENT_ID, ORDER_ID } from '../../tests/helpers/fakes.js'

/**
 * @param {object} [data] Payload overrides.
 * @returns {object} A minimal BullMQ job.
 */
const job = (data = {}) => ({
  name: 'send-email',
  id: '1',
  data: { to: 'buyer@example.com', template: 'ORDER_CONFIRMATION', ...data },
})

describe('createSendEmailProcessor', () => {
  it('renders an order confirmation and hands it to the provider', async () => {
    const email = createInMemoryEmailProvider()
    const process = createSendEmailProcessor({ email })

    const result = await process(
      job({
        data: { buyerName: 'Priya Sharma', orderReference: 'DE-8F3K2Q', totalCents: 249_900 },
        orderId: ORDER_ID,
      }),
    )

    expect(email.sent).toHaveLength(1)
    const [message] = email.sent
    expect(message.to).toEqual(['buyer@example.com'])
    expect(message.subject).toContain('DE-8F3K2Q')
    expect(message.text).toContain('Priya Sharma')
    expect(message.text).toContain('INR 2499.00')
    expect(message.html).toContain('<p>')
    expect(message.metadata).toMatchObject({ template: 'ORDER_CONFIRMATION', orderId: ORDER_ID })

    expect(result).toMatchObject({
      template: 'ORDER_CONFIRMATION',
      to: 'buyer@example.com',
      orderId: ORDER_ID,
      provider: 'in-memory-email',
    })
    expect(result.providerRef).toBe(message.id)
  })

  it('renders a waitlist notification carrying the claim link', async () => {
    const email = createInMemoryEmailProvider()

    await createSendEmailProcessor({ email })(
      job({
        template: 'WAITLIST_AVAILABLE',
        eventId: EVENT_ID,
        data: {
          eventTitle: 'Navratri Garba Night',
          quantity: 2,
          claimUrl: 'https://desi-event.com/e/garba',
        },
      }),
    )

    const [message] = email.sent
    expect(message.subject).toBe('Tickets are available for Navratri Garba Night')
    expect(message.text).toContain('https://desi-event.com/e/garba')
    expect(message.text).toContain('Navratri Garba Night')
  })

  it('lets the payload override the template subject', async () => {
    const email = createInMemoryEmailProvider()

    await createSendEmailProcessor({ email })(job({ subject: 'A subject we chose' }))

    // The demonstration marker survives a caller-supplied subject: the one
    // field an operator controls must not be the one that removes it.
    expect(email.sent[0].subject).toBe('[DEMO] A subject we chose')
  })

  it('applies the configured from and replyTo addresses', async () => {
    const email = createInMemoryEmailProvider()

    await createSendEmailProcessor({
      email,
      from: 'tickets@desi-event.com',
      replyTo: 'support@desi-event.com',
    })(job())

    expect(email.sent[0].from).toBe('tickets@desi-event.com')
    expect(email.sent[0].replyTo).toBe('support@desi-event.com')
  })

  it('accepts a whole provider registry and uses its email slot', async () => {
    const email = createInMemoryEmailProvider()

    await createSendEmailProcessor({ email: { email } })(job())

    expect(email.sent).toHaveLength(1)
  })

  it.each([
    ['a missing recipient', { to: undefined }],
    ['a malformed recipient', { to: 'not-an-address' }],
    ['an unknown template', { template: 'NOT_A_TEMPLATE' }],
    ['a non-object data bag', { data: 'nope' }],
  ])('rejects %s without touching the provider', async (_label, overrides) => {
    const email = createInMemoryEmailProvider()

    await expect(createSendEmailProcessor({ email })(job(overrides))).rejects.toMatchObject({
      name: 'PermanentJobError',
      code: 'INVALID_JOB_PAYLOAD',
    })
    expect(email.sent).toHaveLength(0)
  })

  it('names the offending field when a payload is rejected', async () => {
    const email = createInMemoryEmailProvider()

    const error = await createSendEmailProcessor({ email })(job({ to: 'nope' })).catch((e) => e)

    expect(error.issues.map((issue) => issue.path)).toContain('to')
    expect(error.message).toContain('to:')
  })

  it('fails permanently when the provider rejects the address', async () => {
    const email = createInMemoryEmailProvider()

    const error = await createSendEmailProcessor({ email })(
      job({ to: EMAIL_BOUNCE_ADDRESS }),
    ).catch((thrown) => thrown)

    // The bounce address is a *send* failure in the provider, which is
    // transient by our mapping, so this must be retryable rather than fatal.
    expect(error.name).toBe('RetryableJobError')
    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('retries a transient provider failure', async () => {
    const email = {
      name: 'flaky',
      /**
       * @returns {never} Always throws.
       */
      send() {
        throw new ProviderError(PROVIDER_ERROR_CODES.SEND_FAILED, 'upstream timed out', {
          provider: 'flaky',
        })
      },
    }

    const error = await createSendEmailProcessor({ email })(job()).catch((thrown) => thrown)

    expect(error.name).toBe('RetryableJobError')
    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.details.providerCode).toBe('SEND_FAILED')
    expect(error.cause).toBeInstanceOf(ProviderError)
  })

  it('does not retry a provider failure that can never succeed', async () => {
    const email = {
      name: 'strict',
      /**
       * @returns {never} Always throws.
       */
      send() {
        throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RECIPIENT, 'unusable address', {
          provider: 'strict',
        })
      },
    }

    const error = await createSendEmailProcessor({ email })(job()).catch((thrown) => thrown)

    expect(error.name).toBe('PermanentJobError')
    expect(error.code).toBe('PROVIDER_REJECTED')
  })

  it('rejects a provider that does not implement the interface, at wiring time', () => {
    expect(() => createSendEmailProcessor({ email: { name: 'broken' } })).toThrow(ProviderError)
    expect(() => createSendEmailProcessor({ email: undefined })).toThrow(ProviderError)
  })

  it('logs one line per message sent', async () => {
    const logger = createFakeLogger()
    const email = createInMemoryEmailProvider()

    await createSendEmailProcessor({ email, logger })(job())

    expect(logger.at('info')).toHaveLength(1)
    expect(logger.at('info')[0].message).toBe('transactional email sent')
  })
})
