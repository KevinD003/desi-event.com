import { describe, expect, it } from 'vitest'

import { PASSWORD } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'

/** A valid registration payload. */
const registration = {
  email: 'Nikhil@Example.com ',
  password: 'a-long-enough-password',
  displayName: 'Nikhil Menon',
}

describe('POST /v1/auth/register', () => {
  it('creates an account, signs the caller in and never returns the hash', async () => {
    const { app, prisma } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: registration,
    })

    expect(response.statusCode).toBe(201)

    const body = response.json()
    expect(body.tokenType).toBe('Bearer')
    expect(body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(body.user).not.toHaveProperty('passwordHash')
    // The schema normalises the address, so the stored row is lower-cased.
    expect(body.user.email).toBe('nikhil@example.com')
    expect(body.user.role).toBe('ATTENDEE')

    const stored = prisma._store.user.find((user) => user.email === 'nikhil@example.com')
    expect(stored.passwordHash).not.toBe(registration.password)
    expect(stored.passwordHash.startsWith('$2')).toBe(true)

    await app.close()
  })

  it('lets a caller register as an organiser but not as a platform admin', async () => {
    const { app } = await createTestApp()

    const organizer = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...registration, role: 'ORGANIZER' },
    })
    expect(organizer.statusCode).toBe(201)
    expect(organizer.json().user.role).toBe('ORGANIZER')

    const admin = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...registration, email: 'sneaky@example.com', role: 'ADMIN' },
    })
    expect(admin.statusCode).toBe(400)
    expect(admin.json().error.code).toBe('VALIDATION_ERROR')

    await app.close()
  })

  it('rejects a duplicate email with 409', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...registration, email: 'priya@example.com' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toMatchObject({ code: 'CONFLICT', statusCode: 409 })

    await app.close()
  })

  it('still answers 409 when the database wins the race to the unique index', async () => {
    const { app, prisma } = await createTestApp()

    // Simulates two simultaneous sign-ups: the pre-flight check passes for
    // both, and only the insert notices the duplicate.
    prisma.user.findUnique = async () => null

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...registration, email: 'priya@example.com' },
    })

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('reports every field problem at once', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'not-an-email', password: 'short', displayName: '' },
    })

    expect(response.statusCode).toBe(400)

    const { error } = response.json()
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.issues.map((issue) => issue.path).sort()).toEqual([
      'displayName',
      'email',
      'password',
    ])

    await app.close()
  })
})

describe('POST /v1/auth/login', () => {
  it('returns a token for the right password', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: PASSWORD },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().user.email).toBe('priya@example.com')

    await app.close()
  })

  it('answers identically for a wrong password and an unknown address', async () => {
    const { app } = await createTestApp()

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: 'not-the-password' },
    })

    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'nobody@example.com', password: PASSWORD },
    })

    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownEmail.statusCode).toBe(401)
    expect(wrongPassword.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: 'UNAUTHORIZED' }) }),
    )
    // Identical wording: the endpoint must not become an account oracle.
    expect(unknownEmail.json().error.message).toBe(wrongPassword.json().error.message)

    await app.close()
  })
})

describe('GET /v1/auth/me', () => {
  it('resolves the token to its user', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      email: 'arun@rangoli.example',
      role: 'ORGANIZER',
    })
    expect(response.json().data).not.toHaveProperty('passwordHash')

    await app.close()
  })

  it('rejects an anonymous caller', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/auth/me' })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('UNAUTHORIZED')

    await app.close()
  })

  it('rejects a malformed token and a token signed with another secret', async () => {
    const { app } = await createTestApp()
    const { app: otherApp } = await createTestApp({
      env: { JWT_SECRET: 'a-completely-different-secret-32-chars' },
    })
    const foreignToken = await signIn(otherApp, 'priya@example.com')

    const garbage = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer('not.a.token'),
    })
    const foreign = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(foreignToken),
    })

    expect(garbage.statusCode).toBe(401)
    expect(foreign.statusCode).toBe(401)

    await app.close()
    await otherApp.close()
  })

  it('rejects a token whose account has since been deleted', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    prisma._store.user = prisma._store.user.filter((user) => user.email !== 'priya@example.com')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})

describe('credential rate limiting', () => {
  it('throttles repeated sign-in attempts with the shared error envelope', async () => {
    const { app } = await createTestApp({ rateLimit: { auth: { max: 2, timeWindow: '1 minute' } } })

    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'priya@example.com', password: 'wrong' },
      })

    expect((await attempt()).statusCode).toBe(401)
    expect((await attempt()).statusCode).toBe(401)

    const throttled = await attempt()
    expect(throttled.statusCode).toBe(429)
    expect(throttled.json().error).toMatchObject({ code: 'RATE_LIMITED', statusCode: 429 })

    await app.close()
  })

  it('leaves ordinary browsing unthrottled by the credential budget', async () => {
    const { app } = await createTestApp({ rateLimit: { auth: { max: 1, timeWindow: '1 minute' } } })

    await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: 'x' },
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await app.inject({ method: 'GET', url: '/v1/events' })).statusCode).toBe(200)
    }

    await app.close()
  })
})
