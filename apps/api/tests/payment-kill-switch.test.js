/**
 * No card can be charged from here.
 *
 * Desi-Event has no payment integration, and the claim these tests hold is the
 * strong form of that: not "we have not configured one", but "there is nothing
 * a deployment, an operator or a buyer can do that reaches a payment service
 * provider". A deployment that believes otherwise is refused at boot rather
 * than quietly downgraded, because somebody who thinks they have enabled card
 * payments must find out from the boot log rather than from a customer.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createInMemoryProviderRegistry,
  PAYMENT_MODES,
  PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
} from '@desi-event/providers'

import { buildApp } from '../src/app.js'
import { createTestApp, testEnv } from './helpers/app.js'
import { createPrismaStub } from './helpers/prisma-stub.js'
import { makeWorld } from './helpers/fixtures.js'

/** The repository root, for the checks that look at what actually ships. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Live-looking and obviously fabricated, so the secret scanner leaves it alone. */
const FAKE_LIVE_KEY = 'sk_live_NOT_A_REAL_KEY_THIS_IS_A_TEST_FIXTURE_0000'

/** Sandbox-looking, equally fabricated. */
const FAKE_TEST_KEY = 'sk_test_NOT_A_REAL_KEY_THIS_IS_A_TEST_FIXTURE_0000'

/**
 * Build the app with a specific process environment for the kill switch.
 *
 * @param {Record<string, string>} processEnv What the kill switch sees.
 * @param {object} [options] Extra build options.
 * @returns {Promise<object>} The Fastify instance.
 */
async function buildWith(processEnv, options = {}) {
  const world = await makeWorld()

  return buildApp({
    prisma: createPrismaStub(world.seed),
    providers: createInMemoryProviderRegistry(),
    env: testEnv(),
    docs: false,
    processEnv,
    ...options,
  })
}

describe('a deployment that thinks it has card payments', () => {
  it('is refused before the app is built', async () => {
    await expect(buildWith({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY })).rejects.toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it('is refused for asking, even with no credential at all', async () => {
    await expect(buildWith({ ENABLE_PRODUCTION_PAYMENTS: 'true' })).rejects.toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
    await expect(buildWith({ PAYMENT_PROVIDER: 'stripe' })).rejects.toThrow(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    )
  })

  it('never has its credential printed in the refusal', async () => {
    await expect(buildWith({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY })).rejects.toThrow(
      /STRIPE_SECRET_KEY/,
    )
    await expect(buildWith({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY })).rejects.not.toThrow(
      new RegExp(FAKE_LIVE_KEY),
    )
  })
})

describe('a sandbox credential somebody left in the environment', () => {
  it('does not stop the API, and does not activate anything either', async () => {
    const app = await buildWith({ STRIPE_SECRET_KEY: FAKE_TEST_KEY })

    expect(app.payments.mode).toBe(PAYMENT_MODES.MOCK)
    expect(app.payments.notices.join(' ')).toContain('STRIPE_SECRET_KEY')
    expect(app.providers.payments.name).toBe('in-memory-payments')

    await app.close()
  })
})

describe('what the API says about itself', () => {
  it('reports the payment mode on its liveness probe', async () => {
    const { app } = await createTestApp()
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json().payments).toEqual({
      mode: 'MOCK',
      demo: true,
      live: false,
      label: 'DEMO',
      message: PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    })

    await app.close()
  })
})

describe('what a browser can ask for', () => {
  it('cannot choose a payment provider', async () => {
    const { app, ids, prisma } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
        // Everything a caller might try. None of it is a field the API has.
        provider: 'stripe',
        paymentProvider: 'stripe',
        paymentMethod: 'card',
        mode: 'live',
      },
    })

    expect(response.statusCode).toBeLessThan(500)

    const payments = await prisma.payment.findMany({})
    for (const payment of payments) {
      expect(payment.provider).toBe('in-memory-payments')
    }

    await app.close()
  })
})

describe('the network', () => {
  const restore = []

  afterEach(() => {
    while (restore.length > 0) restore.pop()()
  })

  it('is never reached for a payment during a whole checkout', async () => {
    /** @type {string[]} */
    const attempts = []

    const realConnect = net.Socket.prototype.connect
    net.Socket.prototype.connect = function guarded(...args) {
      attempts.push(`net:${JSON.stringify(args[0])}`)

      return realConnect.apply(this, args)
    }
    restore.push(() => {
      net.Socket.prototype.connect = realConnect
    })

    const realTlsConnect = tls.connect
    tls.connect = (...args) => {
      attempts.push(`tls:${JSON.stringify(args[0])}`)

      return realTlsConnect(...args)
    }
    restore.push(() => {
      tls.connect = realTlsConnect
    })

    const realFetch = globalThis.fetch
    globalThis.fetch = (...args) => {
      attempts.push(`fetch:${String(args[0])}`)

      throw new Error('the API must not make an outbound request during checkout')
    }
    restore.push(() => {
      globalThis.fetch = realFetch
    })

    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(attempts).toEqual([])

    await app.close()
  })
})

describe('the repository', () => {
  /** Every file git is tracking, which is the set that ships. */
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter((file) => /\.(js|mjs|cjs|jsx|json)$/.test(file))
    .filter((file) => !file.includes('/tests/') && !file.endsWith('.test.js'))

  /**
   * Payment SDKs this repository is allowed to depend on.
   *
   * Phase 1 depended on none, because Phase 1 took no payments. Phase 2 takes
   * them in Stripe's sandbox, so the guard changes shape rather than going away:
   * the official Stripe SDKs are permitted and every other payment SDK is still
   * refused. A second processor arriving unnoticed is exactly what this test is
   * for, and it is a more likely mistake now than it was before.
   *
   * @type {Set<string>}
   */
  const ALLOWED_PAYMENT_SDKS = new Set(['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'])

  it('depends on no payment SDK other than the official Stripe ones', () => {
    const manifests = tracked.filter((file) => file.endsWith('package.json'))
    const offenders = []

    for (const file of manifests) {
      const manifest = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'))
      const names = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      })

      for (const name of names) {
        if (ALLOWED_PAYMENT_SDKS.has(name)) continue

        if (/^(stripe|razorpay|braintree|square|adyen|@stripe\/|@adyen\/|paypal)/.test(name)) {
          offenders.push(`${file}: ${name}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('pins the Stripe SDK rather than floating it', () => {
    // A webhook payload is only interpretable against the API version that
    // produced it, and an unpinned SDK is an API version that moves on its own.
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages/providers/package.json'), 'utf8'),
    )

    expect(manifest.dependencies.stripe).toMatch(/^\^?\d+\.\d+\.\d+$/)
  })

  it('pins the Stripe API version in code, not in an environment variable alone', () => {
    const source = readFileSync(path.join(repoRoot, 'packages/schemas/src/payments.js'), 'utf8')

    expect(source).toMatch(/STRIPE_API_VERSION\s*=\s*'\d{4}-\d{2}-\d{2}/)
  })

  it('names no payment-provider endpoint in code that ships', () => {
    // Still no hard-coded endpoints. The Stripe SDK knows its own base URL, and
    // a URL written into this repository is a URL somebody can point elsewhere.
    const offenders = []

    for (const file of tracked) {
      if (file.endsWith('package.json') || file.endsWith('pnpm-lock.yaml')) continue

      const source = readFileSync(path.join(repoRoot, file), 'utf8')
      // `connect.stripe.com`, `dashboard.stripe.com` and the two asset hosts are
      // here because a Connect onboarding phase is exactly where a hosted link
      // gets pasted in — the mock-mode design forbids one, and this is what
      // makes the promise enforceable rather than written down. All four are
      // clean today, so the rule only ever fails on a new offender.
      if (
        /api\.stripe\.com|api\.razorpay\.com|checkout\.stripe\.com|api\.adyen\.com|connect\.stripe\.com|dashboard\.stripe\.com|js\.stripe\.com|files\.stripe\.com/.test(
          source,
        )
      ) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('never calls the Stripe SDK outside the adapter', () => {
    // One module imports `stripe`. Everything else goes through the adapter,
    // which is where the amount, the idempotency key and the API version are
    // decided — a second import site is a second set of those decisions.
    const importers = tracked.filter((file) => {
      if (!/\.(js|mjs|cjs|jsx)$/.test(file)) return false

      // The browser SDKs count too. `@stripe/stripe-js` and
      // `@stripe/react-stripe-js` sit on the permitted-dependency allow-list, so
      // before this widening `import { loadStripe } from '@stripe/stripe-js'` in
      // a web component was caught by no guard at all while the phase scope said
      // "no Stripe SDK import".
      return /from '(stripe|@stripe\/[a-z-]+)'|import\('(stripe|@stripe\/[a-z-]+)'\)|require\('(stripe|@stripe\/[a-z-]+)'\)/.test(
        readFileSync(path.join(repoRoot, file), 'utf8'),
      )
    })

    expect(importers).toEqual(['packages/providers/src/stripe.js'])
  })
})
