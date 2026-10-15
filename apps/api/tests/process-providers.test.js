/**
 * A restarted API does not reuse its simulated provider's ids.
 *
 * The in-memory payment provider numbers what it creates from one, and the
 * database it writes to outlives the process. `Payment(provider, providerRef)`
 * is unique, so a process that handed out `pi_000001` again after a restart had
 * its first simulated checkout refused with a server error. The browser suite
 * found it: a second run of the purchase journey against the same database.
 *
 * Each process now draws its own id space. These cases start two "processes"'
 * worth of providers the way `server.js` does and compare what they hand out.
 */

import { describe, expect, it } from 'vitest'
import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { createProcessProviders } from '../src/server.js'

/** One simulated payment, as checkout asks for it. */
const INTENT = { amountCents: 149_900, currency: 'INR' }

describe('the providers a process starts with', () => {
  it('shows the defect it exists for: two default registries hand out the same first id', () => {
    const before = createInMemoryProviderRegistry().payments.createIntent(INTENT)
    const after = createInMemoryProviderRegistry().payments.createIntent(INTENT)

    expect(after.id).toBe(before.id)
  })

  it('gives a restarted process intent ids the last one never used', () => {
    const before = createProcessProviders().payments.createIntent(INTENT)
    const after = createProcessProviders().payments.createIntent(INTENT)

    expect(after.id).not.toBe(before.id)
  })

  it('gives refunds their own id space per process too', () => {
    const refundOnce = () => {
      const { payments } = createProcessProviders()
      const intent = payments.createIntent(INTENT)

      payments.capture(intent.id)

      return payments.refund(intent.id, { amountCents: 100 }).refundId
    }

    const first = refundOnce()

    expect(first).toMatch(/^re_pi[0-9a-f]{8}_\d{6}$/u)
    expect(refundOnce()).not.toBe(first)
  })

  it('keeps the provider simulated: the ids still read as the stand-in’s', () => {
    const { payments } = createProcessProviders()
    const intent = payments.createIntent(INTENT)

    expect(intent.id).toMatch(/^pi[0-9a-f]{8}_\d{6}$/u)
    expect(payments.name).toBe('in-memory-payments')
  })
})
