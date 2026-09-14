/**
 * Integration tests for the shared Prisma wrapper.
 *
 * Anything that needs SQL runs against the dedicated test database so it can be
 * truncated freely. When that database is absent — a laptop without Postgres, a
 * CI job that only lints — those cases are skipped rather than failed, so the
 * suite stays green everywhere while still being a real integration test where
 * a database exists.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, it } from 'vitest'

import {
  createPrismaClient,
  disconnectPrisma,
  getPrisma,
  isDatabaseReachable,
  OrderStatus,
  OrgRole,
  PromoType,
  UserRole,
} from '../src/index.js'

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/**
 * Probe the test database once, up front, so every suite can decide whether to
 * run or skip without each test paying for its own connection attempt.
 *
 * @returns {Promise<{reachable: boolean, migrated: boolean}>} Probe result.
 */
async function probeTestDatabase() {
  let client
  try {
    client = createPrismaClient({ connectionString: TEST_DATABASE_URL })
  } catch {
    return { reachable: false, migrated: false }
  }

  try {
    const reachable = await isDatabaseReachable(client)
    if (!reachable) return { reachable: false, migrated: false }

    try {
      await client.organization.count()
      return { reachable: true, migrated: true }
    } catch {
      return { reachable: true, migrated: false }
    }
  } finally {
    await client.$disconnect()
  }
}

const { reachable, migrated } = await probeTestDatabase()

/** `it` when the test database answers, `it.skip` otherwise. */
const itLive = reachable ? it : it.skip
/** `it` when the test database also has the migrations applied. */
const itMigrated = migrated ? it : it.skip

describe('createPrismaClient', () => {
  it('throws a helpful error when no connection string is available', () => {
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL

    try {
      expect(() => createPrismaClient()).toThrow(/DATABASE_URL is not set/)
      expect(() => createPrismaClient()).toThrow(/\.env\.example/)
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original
    }
  })

  it('treats an empty connection string as missing rather than connecting to nothing', () => {
    expect(() => createPrismaClient({ connectionString: '' })).toThrow(/DATABASE_URL is not set/)
  })

  it('prefers an explicit connection string over the environment', () => {
    const original = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://ignored:ignored@127.0.0.1:1/ignored'

    try {
      const client = createPrismaClient({ connectionString: TEST_DATABASE_URL })
      expect(client).toBeDefined()
      expect(typeof client.$disconnect).toBe('function')
      return client.$disconnect()
    } finally {
      if (original === undefined) {
        delete process.env.DATABASE_URL
      } else {
        process.env.DATABASE_URL = original
      }
    }
  })

  it('returns a distinct client on every call', async () => {
    const first = createPrismaClient({ connectionString: TEST_DATABASE_URL })
    const second = createPrismaClient({ connectionString: TEST_DATABASE_URL })

    expect(first).not.toBe(second)

    await Promise.all([first.$disconnect(), second.$disconnect()])
  })
})

describe('getPrisma', () => {
  afterAll(async () => {
    await disconnectPrisma()
  })

  it('returns the same instance on repeated calls', async () => {
    await disconnectPrisma()

    const first = getPrisma({ connectionString: TEST_DATABASE_URL })
    const second = getPrisma()
    const third = getPrisma({ connectionString: 'postgresql://ignored:ignored@127.0.0.1:1/x' })

    expect(second).toBe(first)
    // Options are only honoured on first creation; a later call must not build
    // a second pool just because it passed different options.
    expect(third).toBe(first)

    await disconnectPrisma()
  })

  it('creates a fresh instance after disconnectPrisma clears the cache', async () => {
    const first = getPrisma({ connectionString: TEST_DATABASE_URL })
    await disconnectPrisma()
    const second = getPrisma({ connectionString: TEST_DATABASE_URL })

    expect(second).not.toBe(first)

    await disconnectPrisma()
  })

  it('caches on globalThis so hot reloads reuse one pool', async () => {
    await disconnectPrisma()

    const client = getPrisma({ connectionString: TEST_DATABASE_URL })
    expect(globalThis[Symbol.for('desi-event.prisma')]).toBe(client)

    await disconnectPrisma()
    expect(globalThis[Symbol.for('desi-event.prisma')]).toBeUndefined()
  })
})

describe('disconnectPrisma', () => {
  it('is a no-op when no client was ever created', async () => {
    await disconnectPrisma()
    await expect(disconnectPrisma()).resolves.toBeUndefined()
  })
})

describe('isDatabaseReachable', () => {
  itLive('returns true against the live test database', async () => {
    const client = createPrismaClient({ connectionString: TEST_DATABASE_URL })

    try {
      await expect(isDatabaseReachable(client)).resolves.toBe(true)
    } finally {
      await client.$disconnect()
    }
  })

  it('returns false instead of throwing when the server does not answer', async () => {
    // Port 1 is reserved and never accepts connections, so this exercises the
    // failure path the API health endpoint depends on.
    const client = createPrismaClient({
      connectionString: 'postgresql://desi:desi@127.0.0.1:1/desi_event_nope?schema=public',
    })

    try {
      await expect(isDatabaseReachable(client)).resolves.toBe(false)
    } finally {
      await client.$disconnect().catch(() => {})
    }
  })

  it('returns false for a database name that does not exist', async () => {
    const client = createPrismaClient({
      connectionString: `postgresql://desi:desi@127.0.0.1:5432/absent_${randomUUID().slice(0, 8)}?schema=public`,
    })

    try {
      await expect(isDatabaseReachable(client)).resolves.toBe(false)
    } finally {
      await client.$disconnect().catch(() => {})
    }
  })
})

describe('schema access through the wrapper', () => {
  itMigrated('round-trips a row through the driver adapter', async () => {
    const client = createPrismaClient({ connectionString: TEST_DATABASE_URL })
    const slug = `wrapper-test-${randomUUID()}`

    try {
      const created = await client.organization.create({
        data: {
          name: 'Wrapper Test Society',
          slug,
          contactEmail: 'wrapper-test@example.com',
          payoutCurrency: 'CAD',
        },
      })

      expect(created.id).toEqual(expect.any(String))
      expect(created.verified).toBe(false)
      expect(created.createdAt).toBeInstanceOf(Date)

      const found = await client.organization.findUnique({ where: { slug } })
      expect(found?.name).toBe('Wrapper Test Society')
      expect(found?.payoutCurrency).toBe('CAD')
    } finally {
      await client.organization.deleteMany({ where: { slug } })
      await client.$disconnect()
    }
  })

  itMigrated('rejects a duplicate value on a unique column', async () => {
    const client = createPrismaClient({ connectionString: TEST_DATABASE_URL })
    const slug = `wrapper-unique-${randomUUID()}`
    const data = {
      name: 'Duplicate Slug Society',
      slug,
      contactEmail: 'duplicate@example.com',
    }

    try {
      await client.organization.create({ data })
      await expect(client.organization.create({ data })).rejects.toMatchObject({ code: 'P2002' })
    } finally {
      await client.organization.deleteMany({ where: { slug } })
      await client.$disconnect()
    }
  })

  itMigrated('stores integer cents and string arrays without lossy conversion', async () => {
    const client = createPrismaClient({ connectionString: TEST_DATABASE_URL })
    const slug = `wrapper-event-${randomUUID()}`

    try {
      const org = await client.organization.create({
        data: { name: 'Money Test Org', slug: `${slug}-org`, contactEmail: 'money@example.com' },
      })
      const event = await client.event.create({
        data: {
          organizationId: org.id,
          title: 'Money Test Event',
          slug,
          summary: 'Checks that cents survive a round trip.',
          description: 'Checks that cents survive a round trip.',
          category: 'MUSIC_CONCERT',
          startsAt: new Date('2027-01-01T13:30:00.000Z'),
          endsAt: new Date('2027-01-01T17:30:00.000Z'),
          languages: ['Hindi', 'Tamil', 'English'],
        },
      })
      const ticketType = await client.ticketType.create({
        data: {
          eventId: event.id,
          name: 'General Admission',
          priceCents: 149900,
          quantityTotal: 100,
        },
      })

      expect(ticketType.priceCents).toBe(149900)
      expect(Number.isInteger(ticketType.priceCents)).toBe(true)
      expect(event.languages).toEqual(['Hindi', 'Tamil', 'English'])
      expect(event.status).toBe('DRAFT')
      expect(ticketType.status).toBe('DRAFT')
      expect(ticketType.quantitySold).toBe(0)
    } finally {
      await client.organization.deleteMany({ where: { slug: { startsWith: 'wrapper-event-' } } })
      await client.$disconnect()
    }
  })
})

describe('exported enums', () => {
  it('mirror the enum values declared in schema.prisma', () => {
    expect(Object.values(UserRole)).toEqual(['ATTENDEE', 'ORGANIZER', 'ADMIN'])
    expect(Object.values(OrgRole)).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'])
    expect(Object.values(OrderStatus)).toEqual([
      'PENDING',
      'PAID',
      'CANCELLED',
      'REFUNDED',
      'EXPIRED',
    ])
    expect(Object.values(PromoType)).toEqual(['PERCENTAGE', 'FIXED_AMOUNT'])
  })
})
