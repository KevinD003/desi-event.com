/**
 * The authentication surface, from the outside.
 *
 * `packages/auth` tests the rules; this tests the routes that apply them — which
 * is where the interesting mistakes live. A rule that says "revoke sibling
 * sessions on a password change" is easy to state and easy to forget to call, and
 * only a request can tell you which happened.
 *
 * Most of these are adversarial by construction: what a signed-in caller can do
 * to somebody else's session, what an unverified account can reach, what two
 * simultaneous redemptions of one link produce, and what the response says about
 * accounts that do not exist.
 *
 * @module @desi-event/api/tests/auth
 */

import { describe, expect, it } from 'vitest'

import { PASSWORD, legacyPasswordHash, makeWorld } from './helpers/fixtures.js'
import { bearer, createTestApp, mfaCodeFor, signIn } from './helpers/app.js'

/** A valid registration payload. */
const registration = {
  email: 'Nikhil@Example.com ',
  password: 'a-long-enough-password',
  displayName: 'Nikhil Menon',
}

/** The origin the test environment serves, for the CSRF origin check. */
const ORIGIN = 'https://desi-event.test'

/**
 * Sign in and keep everything the browser would keep.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email The account.
 * @param {object} [options] Options.
 * @param {string} [options.password] The password.
 * @param {string} [options.code] A one-time code.
 * @returns {Promise<object>} The body, plus the cookie header and CSRF header a browser would send back.
 */
/**
 * Apply a response's Set-Cookie headers to an existing header bag.
 *
 * A browser does this automatically. These tests carry their headers by hand, so
 * without it a response that rotates the session cookie — which the
 * privilege-changing routes now do, per finding NF-10 — leaves the test holding a
 * secret the server has already replaced.
 *
 * @param {object} headers The headers being carried between requests.
 * @param {object} response An inject result.
 * @returns {object} A new header bag with the response's cookies applied.
 */
function followCookies(headers, response) {
  const existing = Object.fromEntries(
    (headers.cookie ?? '')
      .split('; ')
      .filter(Boolean)
      .map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
  )

  for (const cookie of response.cookies ?? []) existing[cookie.name] = cookie.value

  // Rotation issues a fresh CSRF token alongside the session, and the double
  // submit only works if the header matches the cookie. A real client reads that
  // cookie — it is deliberately not httpOnly — and echoes it, so this does too.
  const csrf = existing['__Host-desi_csrf'] ?? existing.desi_csrf ?? headers['x-desi-csrf']

  return {
    ...headers,
    ...(csrf ? { 'x-desi-csrf': csrf } : {}),
    cookie: Object.entries(existing)
      .map(([name, value]) => `${name}=${value}`)
      .join('; '),
  }
}

async function signInAsBrowser(app, email, { password = PASSWORD, code } = {}) {
  // A privileged fixture account holds a confirmed factor — finding NF-12
  // requires one — so sign-in asks for a code unless the caller has supplied its
  // own. Tests that are *about* the MFA prompt pass `code` explicitly and are
  // unaffected.
  const second = code ?? mfaCodeFor(app, email)

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { origin: ORIGIN },
    payload: { email, password, ...(second ? { code: second } : {}) },
  })

  const body = response.json()
  const cookies = Object.fromEntries(
    (response.cookies ?? []).map((cookie) => [cookie.name, cookie.value]),
  )
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')

  return {
    status: response.statusCode,
    body,
    cookies,
    headers: {
      origin: ORIGIN,
      cookie: cookieHeader,
      'x-desi-csrf': body.csrfToken ?? '',
    },
  }
}

describe('POST /v1/auth/register', () => {
  it('creates an account, starts a session, and never returns the hash', async () => {
    const { app, prisma } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: registration,
    })

    expect(response.statusCode).toBe(201)

    const body = response.json()
    expect(body.tokenType).toBe('Bearer')
    expect(body.token).toBeTruthy()
    expect(body.sessionId).toBeTruthy()
    expect(body.user).not.toHaveProperty('passwordHash')
    // The schema normalises the address, so the stored row is lower-cased.
    expect(body.user.email).toBe('nikhil@example.com')
    expect(body.user.role).toBe('ATTENDEE')

    const stored = prisma._store.user.find((user) => user.email === 'nikhil@example.com')
    expect(stored.passwordHash).not.toBe(registration.password)
    // scrypt, not bcrypt: the format records its own parameters.
    expect(stored.passwordHash.startsWith('scrypt$1$')).toBe(true)

    await app.close()
  })

  it('stores a session as a digest, so the row cannot be used to sign in', async () => {
    const { app, prisma } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: registration,
    })
    const { token } = response.json()

    const [session] = prisma._store.session
    expect(session.tokenHash).not.toBe(token)
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(prisma._store.session)).not.toContain(token)

    await app.close()
  })

  it('says the address still needs verifying, and issues exactly one link', async () => {
    const { app, prisma } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: registration,
    })

    expect(response.json().emailVerificationRequired).toBe(true)

    const tokens = prisma._store.authToken.filter((token) => token.purpose === 'EMAIL_VERIFICATION')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now())

    await app.close()
  })

  it('lets a caller register as an organiser but not as a privileged role', async () => {
    const { app } = await createTestApp()

    const organiser = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...registration, role: 'ORGANIZER' },
    })
    expect(organiser.statusCode).toBe(201)
    expect(organiser.json().user.role).toBe('ORGANIZER')

    for (const role of ['SUPER_ADMIN', 'FINANCE_ADMIN', 'MODERATOR', 'SUPPORT']) {
      const escalation = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { ...registration, email: `${role}@example.com`, role },
      })

      // Refused by schema rather than by a handler remembering to check.
      expect(escalation.statusCode).toBe(400)
    }

    await app.close()
  })

  it('rejects a duplicate address with 409 and creates nothing', async () => {
    const { app, prisma } = await createTestApp()

    const before = prisma._store.user.length
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...registration, email: 'priya@example.com' },
    })

    expect(response.statusCode).toBe(409)
    expect(prisma._store.user).toHaveLength(before)

    await app.close()
  })
})

describe('POST /v1/auth/login', () => {
  it('returns a session for the right password, as a cookie and a token', async () => {
    const { app } = await createTestApp()

    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    expect(signedIn.status).toBe(200)
    expect(signedIn.body.token).toBeTruthy()
    expect(signedIn.body.csrfToken).toBeTruthy()
    expect(signedIn.cookies['__Host-desi_session']).toBe(signedIn.body.token)
    expect(signedIn.cookies['__Host-desi_csrf']).toBe(signedIn.body.csrfToken)

    await app.close()
  })

  it('answers identically for a wrong password and an unknown address', async () => {
    const { app } = await createTestApp()

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: 'not-the-password' },
    })
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'not-the-password' },
    })

    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.json()).toMatchObject(unknown.json().error ? {} : {})
    expect(wrong.json().error.message).toBe(unknown.json().error.message)
    expect(wrong.json().error.code).toBe(unknown.json().error.code)

    await app.close()
  })

  it('records every attempt without storing the address or the password', async () => {
    const { app, prisma } = await createTestApp()

    await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: 'not-the-password' },
    })
    await signInAsBrowser(app, 'priya@example.com')

    const attempts = prisma._store.loginAttempt
    expect(attempts).toHaveLength(2)
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(['bad_password', 'success'])

    const serialised = JSON.stringify(attempts)
    expect(serialised).not.toContain('priya@example.com')
    expect(serialised).not.toContain(PASSWORD)
    expect(serialised).not.toContain('not-the-password')
    for (const attempt of attempts) {
      expect(attempt.emailHash).toMatch(/^[0-9a-f]{64}$/)
      expect(attempt.ipHash).toMatch(/^[0-9a-f]{64}$/)
    }

    await app.close()
  })

  it('locks sign-in for an address after enough failures, and lets others through', async () => {
    const { app } = await createTestApp()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'priya@example.com', password: `wrong-${attempt}` },
      })
      expect(response.statusCode).toBe(401)
    }

    // The sixth attempt is refused before the password is even checked, and the
    // right password does not help.
    const throttled = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: PASSWORD },
    })
    expect(throttled.statusCode).toBe(429)
    expect(throttled.json().error.message).not.toMatch(/\d/)

    // A different account is unaffected: the counter is per address.
    const other = await signInAsBrowser(app, 'arun@rangoli.example')
    expect(other.status).toBe(200)

    await app.close()
  })

  it('clears the failure count after a success, rather than keeping somebody locked out', async () => {
    const { app } = await createTestApp()

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'priya@example.com', password: `wrong-${attempt}` },
      })
    }

    expect((await signInAsBrowser(app, 'priya@example.com')).status).toBe(200)

    // Four more failures would trip the threshold if the earlier four still
    // counted. They do not: the success reset the window.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'priya@example.com', password: `wrong-again-${attempt}` },
      })
    }

    expect((await signInAsBrowser(app, 'priya@example.com')).status).toBe(200)

    await app.close()
  })

  it('refuses a suspended account, and says so plainly', async () => {
    const world = await makeWorld()
    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })

    const user = prisma._store.user.find((candidate) => candidate.email === 'priya@example.com')
    user.suspendedAt = new Date()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: PASSWORD },
    })

    // Reaching this branch already required the correct password, so hiding the
    // reason would only stop somebody contacting support.
    expect(response.statusCode).toBe(401)
    expect(response.json().error.message).toMatch(/suspended/i)

    await app.close()
  })

  it('records a device, and reuses it for a second sign-in from the same browser', async () => {
    const { app, prisma } = await createTestApp()

    await signInAsBrowser(app, 'priya@example.com')
    await signInAsBrowser(app, 'priya@example.com')

    expect(prisma._store.device).toHaveLength(1)
    expect(prisma._store.session.filter((session) => session.revokedAt === null)).toHaveLength(2)
    expect(prisma._store.device[0].fingerprintHash).toMatch(/^[0-9a-f]{64}$/)

    await app.close()
  })
})

describe('Phase 1 passwords', () => {
  it('accepts a bcrypt hash and upgrades it on the way through', async () => {
    const world = await makeWorld()
    const legacy = await legacyPasswordHash()
    const user = world.seed.user.find((candidate) => candidate.email === 'priya@example.com')
    user.passwordHash = legacy

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })

    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    expect(signedIn.status).toBe(200)

    const stored = prisma._store.user.find((candidate) => candidate.email === 'priya@example.com')
    expect(stored.passwordHash).not.toBe(legacy)
    expect(stored.passwordHash.startsWith('scrypt$1$')).toBe(true)

    // And the upgraded hash still verifies the same password.
    expect((await signInAsBrowser(app, 'priya@example.com')).status).toBe(200)

    await app.close()
  })

  it('still refuses a wrong password against a bcrypt hash', async () => {
    const world = await makeWorld()
    const user = world.seed.user.find((candidate) => candidate.email === 'priya@example.com')
    user.passwordHash = await legacyPasswordHash()

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: 'wrong' },
    })

    expect(response.statusCode).toBe(401)
    // No upgrade on a failure: there is nothing to upgrade to.
    const stored = prisma._store.user.find((candidate) => candidate.email === 'priya@example.com')
    expect(stored.passwordHash.startsWith('$2')).toBe(true)

    await app.close()
  })
})

describe('GET /v1/auth/me', () => {
  it('resolves the session to its user, capabilities and memberships', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)

    const { data } = response.json()
    expect(data.user.email).toBe('arun@rangoli.example')
    expect(data.user).not.toHaveProperty('passwordHash')
    // The top-level list is what the platform role alone grants, which for an
    // organiser is nothing: their powers come from a membership, and are listed
    // against the organisation they apply in.
    expect(data.capabilities).toEqual([])
    expect(data.memberships[0].organizationId).toBe(ids.organization.id)
    expect(data.memberships[0].capabilities).toContain('event:create')
    expect(data.session.id).toBeTruthy()

    await app.close()
  })

  it('never returns a token or a credential of any kind', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(token),
    })

    expect(response.body).not.toContain(token)
    expect(response.body).not.toContain('tokenHash')
    expect(response.body).not.toContain('passwordHash')

    await app.close()
  })

  it.each([
    ['no credential', {}],
    ['a malformed bearer token', { authorization: 'Bearer not-a-real-session' }],
    ['an empty bearer token', { authorization: 'Bearer ' }],
    ['a bearer token from another system', { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x' }],
  ])('refuses %s', async (_label, headers) => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/auth/me', headers })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('refuses a session that has been revoked', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    prisma._store.session[0].revokedAt = new Date()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(token),
    })

    // The property Phase 1's JWT could not provide: a credential that was valid
    // a moment ago stops working now.
    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('refuses a session whose account has since been suspended', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    prisma._store.user.find((user) => user.email === 'priya@example.com').suspendedAt = new Date()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses a session whose account has since been deleted', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    const index = prisma._store.user.findIndex((user) => user.email === 'priya@example.com')
    prisma._store.user.splice(index, 1)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})

describe('cross-site request forgery', () => {
  it('refuses a cookie-authenticated write with no CSRF header', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { origin: ORIGIN, cookie: signedIn.headers.cookie },
      payload: {},
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses a cookie-authenticated write with the wrong CSRF token', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { ...signedIn.headers, 'x-desi-csrf': 'a'.repeat(43) },
      payload: {},
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses a write from another origin even with a matching CSRF token', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { ...signedIn.headers, origin: 'https://evil.example' },
      payload: {},
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses a cookie-authenticated write with no origin at all', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const { origin, ...withoutOrigin } = signedIn.headers

    expect(origin).toBe(ORIGIN)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: withoutOrigin,
      payload: {},
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('accepts a bearer-authenticated write with no origin', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(token),
      payload: {},
    })

    // A script that sets a header is not a CSRF risk, because a browser will not
    // set that header on somebody's behalf.
    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('accepts a cookie-authenticated write with both the origin and the token', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: signedIn.headers,
      payload: {},
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('does not check a read, so a signed-in page still renders', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: signedIn.headers.cookie },
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })
})

describe('POST /v1/auth/logout', () => {
  it('ends the session behind the request and clears its cookies', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: signedIn.headers,
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.session[0].revokedAt).toBeInstanceOf(Date)
    expect(prisma._store.session[0].revokedReason).toBe('signed_out')

    const cleared = (response.cookies ?? []).filter((cookie) => cookie.value === '')
    expect(cleared.map((cookie) => cookie.name).sort()).toEqual([
      '__Host-desi_csrf',
      '__Host-desi_session',
    ])

    // And the token no longer works.
    const after = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(signedIn.body.token),
    })
    expect(after.statusCode).toBe(401)

    await app.close()
  })

  it('leaves other sessions alone by default', async () => {
    const { app, prisma } = await createTestApp()
    const first = await signInAsBrowser(app, 'priya@example.com')
    const second = await signInAsBrowser(app, 'priya@example.com')

    await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: first.headers,
      payload: {},
    })

    expect(prisma._store.session.filter((session) => session.revokedAt === null)).toHaveLength(1)
    const stillWorks = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(second.body.token),
    })
    expect(stillWorks.statusCode).toBe(200)

    await app.close()
  })

  it('ends every session when asked to', async () => {
    const { app, prisma } = await createTestApp()
    const first = await signInAsBrowser(app, 'priya@example.com')
    const second = await signInAsBrowser(app, 'priya@example.com')

    await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: first.headers,
      payload: { everywhere: true },
    })

    expect(prisma._store.session.filter((session) => session.revokedAt === null)).toHaveLength(0)
    const gone = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(second.body.token),
    })
    expect(gone.statusCode).toBe(401)

    await app.close()
  })
})

describe('email verification', () => {
  /**
   * Register an account and recover the verification secret the way the mail
   * would carry it.
   *
   * The route only stores a digest, so the test cannot read the secret out of the
   * database — which is the property being relied on. It is captured from the
   * delivery seam instead.
   *
   * @returns {Promise<object>} The harness plus the captured token.
   */
  async function registerAndCapture() {
    const delivered = []
    const { app, prisma } = await createTestApp({
      deliver: async (message) => delivered.push(message),
    })

    await app.inject({ method: 'POST', url: '/v1/auth/register', payload: registration })

    return { app, prisma, delivered }
  }

  it('confirms an address with the link that was issued', async () => {
    const { app, prisma, delivered } = await registerAndCapture()

    expect(delivered).toHaveLength(1)
    expect(delivered[0].purpose).toBe('EMAIL_VERIFICATION')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: delivered[0].token },
    })

    expect(response.statusCode).toBe(200)
    expect(
      prisma._store.user.find((user) => user.email === 'nikhil@example.com').emailVerified,
    ).toBe(true)

    await app.close()
  })

  it('refuses the same link twice', async () => {
    const { app, delivered } = await registerAndCapture()

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: delivered[0].token },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: delivered[0].token },
    })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(401)

    await app.close()
  })

  it('lets only one of two simultaneous redemptions succeed', async () => {
    const { app, delivered } = await registerAndCapture()
    const payload = { token: delivered[0].token }

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/auth/verify-email', payload }),
      app.inject({ method: 'POST', url: '/v1/auth/verify-email', payload }),
    ])

    const statuses = [first.statusCode, second.statusCode].sort()
    expect(statuses).toEqual([200, 401])

    await app.close()
  })

  it('refuses a verification link at the reset endpoint', async () => {
    const { app, delivered } = await registerAndCapture()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { token: delivered[0].token, password: 'a-brand-new-password' },
    })

    // Otherwise a verification link would set a password without anybody
    // knowing the old one.
    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('answers the same for an unknown address, a verified one and a fresh link', async () => {
    const delivered = []
    const { app } = await createTestApp({ deliver: async (message) => delivered.push(message) })

    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/resend-verification',
      payload: { email: 'nobody@example.com' },
    })
    const known = await app.inject({
      method: 'POST',
      url: '/v1/auth/resend-verification',
      payload: { email: 'priya@example.com' },
    })

    expect(unknown.statusCode).toBe(202)
    expect(known.statusCode).toBe(202)
    expect(unknown.json()).toEqual(known.json())

    await app.close()
  })
})

describe('password reset', () => {
  it('issues a link, replaces the password, and ends every session', async () => {
    const delivered = []
    const { app, prisma } = await createTestApp({
      deliver: async (message) => delivered.push(message),
    })

    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    expect(signedIn.status).toBe(200)

    await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      payload: { email: 'priya@example.com' },
    })

    expect(delivered).toHaveLength(1)
    expect(delivered[0].purpose).toBe('PASSWORD_RESET')

    const reset = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { token: delivered[0].token, password: 'fake-new-password-for-a-test' },
    })
    expect(reset.statusCode).toBe(200)

    // Every session, including the one that existed before: a session
    // established with the old password must stop working.
    expect(prisma._store.session.every((session) => session.revokedAt !== null)).toBe(true)
    const dead = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(signedIn.body.token),
    })
    expect(dead.statusCode).toBe(401)

    // And the new password works while the old one does not.
    const withNew = await signInAsBrowser(app, 'priya@example.com', {
      password: 'fake-new-password-for-a-test',
    })
    expect(withNew.status).toBe(200)

    await app.close()
  })

  it('answers identically for an address with and without an account', async () => {
    const { app } = await createTestApp()

    const known = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      payload: { email: 'priya@example.com' },
    })
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      payload: { email: 'nobody@example.com' },
    })

    expect(known.statusCode).toBe(202)
    expect(unknown.statusCode).toBe(202)
    expect(known.json()).toEqual(unknown.json())

    await app.close()
  })

  it('supersedes an outstanding link when a second one is requested', async () => {
    const delivered = []
    const { app } = await createTestApp({ deliver: async (message) => delivered.push(message) })

    for (let request = 0; request < 2; request += 1) {
      await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email: 'priya@example.com' },
      })
    }

    expect(delivered).toHaveLength(2)

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { token: delivered[0].token, password: 'fake-password-from-the-first-link' },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { token: delivered[1].token, password: 'fake-password-from-the-second-link' },
    })

    // A link captured from an inbox stops working as soon as the person asks
    // again.
    expect(first.statusCode).toBe(401)
    expect(second.statusCode).toBe(200)

    await app.close()
  })

  it('issues no link for a suspended account', async () => {
    const world = await makeWorld()
    world.seed.user.find((user) => user.email === 'priya@example.com').suspendedAt = new Date()

    const delivered = []
    const { app } = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      deliver: async (message) => delivered.push(message),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      payload: { email: 'priya@example.com' },
    })

    expect(response.statusCode).toBe(202)
    expect(delivered).toHaveLength(0)

    await app.close()
  })
})

describe('POST /v1/auth/change-password', () => {
  it('requires the current password even from a signed-in caller', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: bearer(token),
      payload: { currentPassword: 'not-the-password', password: 'a-new-long-password' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('changes the password, ends other sessions, and keeps this one', async () => {
    const { app, prisma } = await createTestApp()
    const keeping = await signInAsBrowser(app, 'priya@example.com')
    const losing = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: keeping.headers,
      payload: { currentPassword: PASSWORD, password: 'a-new-long-password' },
    })

    expect(response.statusCode).toBe(200)

    const live = prisma._store.session.filter((session) => session.revokedAt === null)
    expect(live).toHaveLength(1)
    expect(live[0].rotatedAt).toBeInstanceOf(Date)

    const other = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(losing.body.token),
    })
    expect(other.statusCode).toBe(401)

    await app.close()
  })

  it('rotates the surviving session, so the old secret stops working', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: signedIn.headers,
      payload: { currentPassword: PASSWORD, password: 'a-new-long-password' },
    })

    const rotated = (response.cookies ?? []).find((cookie) => cookie.name === '__Host-desi_session')
    expect(rotated.value).not.toBe(signedIn.body.token)

    const withOld = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(signedIn.body.token),
    })
    expect(withOld.statusCode).toBe(401)

    const withNew = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(rotated.value),
    })
    expect(withNew.statusCode).toBe(200)

    await app.close()
  })
})

describe('scheduled rotation and the bearer client', () => {
  // The defect this covers: the secret was rotated on schedule however it was
  // presented, but the replacement was only ever written back as a Set-Cookie.
  // A bearer client was locked out at the first rotation window — an hour for a
  // privileged session — presenting a secret that resolved to nothing, with no
  // channel through which it could learn the new one.

  it('does not rotate a bearer session out from under its holder', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const [session] = prisma._store.session

    // Push the session past its rotation window without touching anything else.
    session.createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    session.rotatedAt = null
    session.lastSeenAt = new Date()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(signedIn.body.token),
    })

    expect(response.statusCode).toBe(200)

    // And the secret it is still holding is still the right one.
    const again = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(signedIn.body.token),
    })

    expect(again.statusCode).toBe(200)

    await app.close()
  })

  it('still rotates a cookie session, which can be told about it', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const [session] = prisma._store.session

    session.createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    session.rotatedAt = null
    session.lastSeenAt = new Date()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: signedIn.headers,
    })

    expect(response.statusCode).toBe(200)

    const rotated = (response.cookies ?? []).find((cookie) => cookie.name === '__Host-desi_session')

    expect(rotated?.value).toBeTruthy()
    expect(rotated.value).not.toBe(signedIn.body.token)

    await app.close()
  })
})

describe('sessions and devices', () => {
  it('lists this account sessions and flags the current one', async () => {
    const { app } = await createTestApp()
    const first = await signInAsBrowser(app, 'priya@example.com')
    await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/sessions',
      headers: { cookie: first.headers.cookie },
    })

    expect(response.statusCode).toBe(200)

    const { data } = response.json()
    expect(data).toHaveLength(2)
    expect(data.filter((session) => session.current)).toHaveLength(1)
    expect(response.body).not.toContain('tokenHash')
    expect(response.body).not.toContain('ipHash')

    await app.close()
  })

  it('does not list another account sessions', async () => {
    const { app } = await createTestApp()
    await signInAsBrowser(app, 'arun@rangoli.example')
    const mine = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/sessions',
      headers: { cookie: mine.headers.cookie },
    })

    expect(response.json().data).toHaveLength(1)

    await app.close()
  })

  it('ends one of my own sessions', async () => {
    const { app } = await createTestApp()
    const keeping = await signInAsBrowser(app, 'priya@example.com')
    const ending = await signInAsBrowser(app, 'priya@example.com')

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/auth/sessions',
      headers: { cookie: keeping.headers.cookie },
    })
    const target = listed.json().data.find((session) => !session.current)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/auth/sessions/${target.id}/revoke`,
      headers: keeping.headers,
      payload: {},
    })

    expect(response.statusCode).toBe(200)

    const dead = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(ending.body.token),
    })
    expect(dead.statusCode).toBe(401)

    await app.close()
  })

  it("answers 404 for another account's session, not 403", async () => {
    const { app, prisma } = await createTestApp()
    await signInAsBrowser(app, 'arun@rangoli.example')
    const mine = await signInAsBrowser(app, 'priya@example.com')

    const theirs = prisma._store.session.find((session) => session.id !== mine.body.sessionId)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/auth/sessions/${theirs.id}/revoke`,
      headers: mine.headers,
      payload: {},
    })

    // 403 would confirm the id exists.
    expect(response.statusCode).toBe(404)
    expect(prisma._store.session.find((session) => session.id === theirs.id).revokedAt).toBeNull()

    await app.close()
  })

  it('lists devices with their live session counts, and never the fingerprint', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/devices',
      headers: { cookie: signedIn.headers.cookie },
    })

    expect(response.statusCode).toBe(200)

    const { data } = response.json()
    expect(data).toHaveLength(1)
    expect(data[0].activeSessions).toBe(2)
    expect(response.body).not.toContain('fingerprint')

    await app.close()
  })

  it('revokes a device and every session established from it', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const second = await signInAsBrowser(app, 'priya@example.com')

    const devices = await app.inject({
      method: 'GET',
      url: '/v1/auth/devices',
      headers: { cookie: signedIn.headers.cookie },
    })
    const [device] = devices.json().data

    const response = await app.inject({
      method: 'POST',
      url: `/v1/auth/devices/${device.id}/revoke`,
      headers: signedIn.headers,
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.session.filter((session) => session.revokedAt === null)).toHaveLength(0)

    for (const token of [signedIn.body.token, second.body.token]) {
      const dead = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: bearer(token),
      })
      expect(dead.statusCode).toBe(401)
    }

    await app.close()
  })

  it("answers 404 for another account's device", async () => {
    const { app, prisma } = await createTestApp()
    await signInAsBrowser(app, 'arun@rangoli.example')
    const mine = await signInAsBrowser(app, 'priya@example.com')

    const theirs = prisma._store.device.find((device) => device.userId !== mine.body.user.id)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/auth/devices/${theirs.id}/revoke`,
      headers: mine.headers,
      payload: {},
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('does not silently un-revoke a device when it signs in again', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const [device] = prisma._store.device

    await app.inject({
      method: 'POST',
      url: `/v1/auth/devices/${device.id}/revoke`,
      headers: signedIn.headers,
      payload: {},
    })

    const again = await signInAsBrowser(app, 'priya@example.com')
    expect(again.status).toBe(200)

    // Signing in still works — revoking a device is not a ban. But the revoked
    // row stays revoked, so "this wasn't me" is not undone by typing the right
    // password.
    expect(prisma._store.device.find((row) => row.id === device.id).revokedAt).toBeInstanceOf(Date)
    expect(prisma._store.session.at(-1).deviceId).toBeNull()

    await app.close()
  })
})

describe('the second factor', () => {
  /**
   * A code from a later window than the one just spent.
   *
   * The replay guard refuses a counter it has already accepted, which is the
   * behaviour RFC 6238 asks for and which confirming an enrolment triggers: the
   * code that proved the authenticator works cannot then be used to sign in.
   * Thirty seconds later is what a person experiences; this is that, without the
   * wait. It is still within the acceptance window, so it is a code the server
   * genuinely takes.
   *
   * @param {string} secret The base32 secret.
   * @param {number} [steps] How many windows ahead.
   * @returns {Promise<string>} The code.
   */
  async function nextCode(secret, steps = 1) {
    const { totp, TOTP_PARAMETERS } = await import('@desi-event/auth')

    return totp(secret, {
      at: new Date(Date.now() + steps * TOTP_PARAMETERS.stepSeconds * 1000),
    })
  }

  /**
   * Enrol and confirm a TOTP factor.
   *
   * @param {object} app The Fastify instance.
   * @param {object} headers Headers carrying a session.
   * @returns {Promise<{secret: string, factorId: string, recoveryCodes: string[]}>} The enrolment.
   */
  async function enrol(app, headers) {
    const { totp } = await import('@desi-event/auth')

    const started = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp',
      headers,
      payload: {},
    })

    expect(started.statusCode).toBe(201)

    const { factorId, secret } = started.json().data
    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp/confirm',
      headers,
      payload: { factorId, code: totp(secret) },
    })

    expect(confirmed.statusCode).toBe(200)

    return {
      secret,
      factorId,
      recoveryCodes: confirmed.json().data.recoveryCodes,
      // Confirming a factor rotates the session, so the caller needs the
      // replacement — exactly as a browser would have it after the Set-Cookie.
      headers: followCookies(headers, confirmed),
    }
  }

  it('enrols, confirms, and returns recovery codes exactly once', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const { factorId, recoveryCodes, headers } = await enrol(app, signedIn.headers)

    expect(recoveryCodes).toHaveLength(10)
    expect(new Set(recoveryCodes).size).toBe(10)

    // Stored sealed, and the plaintext appears nowhere in the database.
    const stored = JSON.stringify(prisma._store.mfaFactor)
    for (const code of recoveryCodes) {
      expect(stored).not.toContain(code)
      expect(stored).not.toContain(code.replace(/-/g, ''))
    }

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/auth/mfa',
      headers: { cookie: headers.cookie },
    })

    expect(listed.json().data.satisfied).toBe(true)
    expect(listed.json().data.factors).toHaveLength(1)
    expect(listed.json().data.factors[0].id).toBe(factorId)
    // No secret, no codes, ever again.
    expect(listed.body).not.toContain('secret')

    await app.close()
  })

  it('never stores the TOTP secret in the clear', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const { secret } = await enrol(app, signedIn.headers)

    expect(JSON.stringify(prisma._store.mfaFactor)).not.toContain(secret)
    expect(prisma._store.mfaFactor[0].secretSealed.startsWith('aesgcm$1$')).toBe(true)

    await app.close()
  })

  it('refuses to confirm with a wrong code', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const started = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp',
      headers: signedIn.headers,
      payload: {},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp/confirm',
      headers: signedIn.headers,
      payload: { factorId: started.json().data.factorId, code: '000000' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it("refuses to confirm another account's enrolment", async () => {
    const { app } = await createTestApp()
    const mine = await signInAsBrowser(app, 'priya@example.com')
    const theirs = await signInAsBrowser(app, 'arun@rangoli.example')

    const started = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp',
      headers: theirs.headers,
      payload: {},
    })
    const { factorId, secret } = started.json().data
    const { totp } = await import('@desi-event/auth')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp/confirm',
      headers: mine.headers,
      payload: { factorId, code: totp(secret) },
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('then requires a code at sign-in, without saying the password was right', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const { secret } = await enrol(app, signedIn.headers)

    const withoutCode = await signInAsBrowser(app, 'priya@example.com')
    expect(withoutCode.status).toBe(200)
    expect(withoutCode.body.mfaRequired).toBe(true)
    expect(withoutCode.body.token).toBeFalsy()

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: 'wrong' },
    })
    expect(wrongPassword.statusCode).toBe(401)

    const withCode = await signInAsBrowser(app, 'priya@example.com', {
      code: await nextCode(secret),
    })
    expect(withCode.status).toBe(200)
    expect(withCode.body.token).toBeTruthy()

    await app.close()
  })

  it('refuses the same TOTP code twice', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const { secret } = await enrol(app, signedIn.headers)
    const code = await nextCode(secret)

    const first = await signInAsBrowser(app, 'priya@example.com', { code })
    const second = await signInAsBrowser(app, 'priya@example.com', { code })

    expect(first.status).toBe(200)
    // A code is valid for its whole window, so without a replay guard the same
    // code read off a screen works again.
    expect(second.status).toBe(401)

    await app.close()
  })

  it('accepts a recovery code once, and not twice', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const { recoveryCodes } = await enrol(app, signedIn.headers)

    const first = await signInAsBrowser(app, 'priya@example.com', { code: recoveryCodes[0] })
    expect(first.status).toBe(200)

    const second = await signInAsBrowser(app, 'priya@example.com', { code: recoveryCodes[0] })
    expect(second.status).toBe(401)

    // A different code still works.
    const third = await signInAsBrowser(app, 'priya@example.com', { code: recoveryCodes[1] })
    expect(third.status).toBe(200)

    await app.close()
  })

  it('accepts a recovery code typed without its hyphens', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const { recoveryCodes } = await enrol(app, signedIn.headers)

    const response = await signInAsBrowser(app, 'priya@example.com', {
      code: recoveryCodes[0].replace(/-/g, '').toLowerCase(),
    })

    expect(response.status).toBe(200)

    await app.close()
  })

  it('ends other sessions when a factor is added', async () => {
    const { app, prisma } = await createTestApp()
    const enrolling = await signInAsBrowser(app, 'priya@example.com')
    const other = await signInAsBrowser(app, 'priya@example.com')

    await enrol(app, enrolling.headers)

    const dead = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(other.body.token),
    })
    expect(dead.statusCode).toBe(401)
    expect(prisma._store.session.filter((session) => session.revokedAt === null)).toHaveLength(1)

    await app.close()
  })
})

describe('step-up authentication', () => {
  it('refuses to remove a factor without a recent step-up', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const started = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp',
      headers: signedIn.headers,
      payload: {},
    })
    const { factorId, secret } = started.json().data
    const { totp } = await import('@desi-event/auth')

    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp/confirm',
      headers: signedIn.headers,
      payload: { factorId, code: totp(secret) },
    })

    // Confirming rotates the session, so carry the replacement forward the way a
    // browser would.
    const headers = followCookies(signedIn.headers, confirmed)

    // Confirming counts as a step-up, so it is cleared here to reach the guard —
    // which is what an hour later looks like.
    for (const session of prisma._store.session) session.mfaSatisfiedAt = null

    const response = await app.inject({
      method: 'POST',
      url: `/v1/auth/mfa/${factorId}/disable`,
      headers,
      payload: { currentPassword: PASSWORD },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(prisma._store.mfaFactor.find((row) => row.id === factorId).disabledAt).toBeNull()

    // And with a step-up it goes through. A later window, because confirming
    // the enrolment already spent this one.
    const { TOTP_PARAMETERS } = await import('@desi-event/auth')
    const later = totp(secret, {
      at: new Date(Date.now() + TOTP_PARAMETERS.stepSeconds * 1000),
    })

    await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
      headers,
      payload: { code: later },
    })

    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/auth/mfa/${factorId}/disable`,
      headers,
      payload: { currentPassword: PASSWORD },
    })

    expect(allowed.statusCode).toBe(200)
    expect(prisma._store.mfaFactor.find((row) => row.id === factorId).disabledAt).toBeInstanceOf(
      Date,
    )

    await app.close()
  })

  it('marks the session as recently authenticated, and lets the action through', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const stepUp = await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
      headers: signedIn.headers,
      payload: { password: PASSWORD },
    })

    expect(stepUp.statusCode).toBe(200)
    expect(prisma._store.session[0].mfaSatisfiedAt).toBeInstanceOf(Date)

    await app.close()
  })

  it('refuses a step-up with the wrong password', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
      headers: signedIn.headers,
      payload: { password: 'not-the-password' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('refuses a step-up that supplies neither a password nor a code', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
      headers: signedIn.headers,
      payload: {},
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('refuses to remove a factor without the current password', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const factor = await prisma.mfaFactor.create({
      data: {
        userId: signedIn.body.user.id,
        type: 'TOTP',
        secretSealed: 'aesgcm$1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA$AAAA',
        confirmedAt: new Date(),
      },
    })

    await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
      headers: signedIn.headers,
      payload: { password: PASSWORD },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/auth/mfa/${factor.id}/disable`,
      headers: signedIn.headers,
      payload: { currentPassword: 'not-the-password' },
    })

    expect(response.statusCode).toBe(401)
    expect(prisma._store.mfaFactor.find((row) => row.id === factor.id).disabledAt).toBeNull()

    await app.close()
  })
})

describe('rotation on a privilege change, finding NF-10', () => {
  // The session module's docstring claimed rotation on "sign-in, password
  // change, MFA enrolment, step-up". Only the password change rotated. A secret
  // captured before a second factor existed stayed valid after it was added,
  // which is most of the value of adding one.

  /**
   * Enrol a factor and return what the caller holds afterwards.
   *
   * @param {object} app The instance.
   * @param {object} headers The signed-in headers.
   * @returns {Promise<object>} The confirm response and the post-rotation headers.
   */
  async function enrolFactor(app, headers) {
    const { totp } = await import('@desi-event/auth')
    const started = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp',
      headers,
      payload: {},
    })
    const { factorId, secret } = started.json().data

    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp/confirm',
      headers,
      payload: { factorId, code: totp(secret) },
    })

    expect(confirmed.statusCode).toBe(200)

    return { confirmed, factorId, secret, headers: followCookies(headers, confirmed) }
  }

  it('replaces the secret when a second factor is confirmed', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    const { confirmed } = await enrolFactor(app, signedIn.headers)
    const rotated = (confirmed.cookies ?? []).find((c) => c.name === '__Host-desi_session')

    expect(rotated?.value).toBeTruthy()
    expect(rotated.value).not.toBe(signedIn.body.token)

    await app.close()
  })

  it('stops the pre-enrolment secret working', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    await enrolFactor(app, signedIn.headers)

    const withOld = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(signedIn.body.token),
    })

    expect(withOld.statusCode).toBe(401)

    await app.close()
  })

  it('replaces the secret again when a factor is removed', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const { factorId, secret, headers } = await enrolFactor(app, signedIn.headers)
    const { TOTP_PARAMETERS, totp } = await import('@desi-event/auth')

    // A later window: confirming the enrolment already spent this one.
    const stepUp = await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
      headers,
      payload: {
        code: totp(secret, { at: new Date(Date.now() + TOTP_PARAMETERS.stepSeconds * 1000) }),
      },
    })

    expect(stepUp.statusCode).toBe(200)

    const before = headers.cookie
    const removed = await app.inject({
      method: 'POST',
      url: `/v1/auth/mfa/${factorId}/disable`,
      headers: followCookies(headers, stepUp),
      payload: { currentPassword: PASSWORD },
    })

    expect(removed.statusCode).toBe(200)
    expect(prisma._store.mfaFactor.find((row) => row.id === factorId).disabledAt).not.toBeNull()

    const rotated = (removed.cookies ?? []).find((c) => c.name === '__Host-desi_session')

    expect(rotated?.value).toBeTruthy()
    expect(before).not.toContain(rotated.value)

    await app.close()
  })

  it('does not lock out a bearer client that enrols a factor', async () => {
    // The other half of the requirement, and the one that is easy to break while
    // fixing the first: a bearer caller has no channel to receive a replacement,
    // so rotating it would leave the holder with a dead secret.
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const { totp } = await import('@desi-event/auth')

    const started = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp',
      headers: bearer(signedIn.body.token),
      payload: {},
    })

    expect(started.statusCode).toBe(201)

    const { factorId, secret } = started.json().data
    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp/confirm',
      headers: bearer(signedIn.body.token),
      payload: { factorId, code: totp(secret) },
    })

    expect(confirmed.statusCode).toBe(200)

    // The token it is still holding still works.
    const after = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(signedIn.body.token),
    })

    expect(after.statusCode).toBe(200)

    await app.close()
  })

  it('revokes the other sessions either way', async () => {
    // Rotation protects the session in front of you; revocation deals with the
    // ones you cannot see. Both are needed, and the bearer exception applies
    // only to the first.
    const { app, prisma } = await createTestApp()
    const keeping = await signInAsBrowser(app, 'priya@example.com')
    const losing = await signInAsBrowser(app, 'priya@example.com')

    await enrolFactor(app, keeping.headers)

    const other = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(losing.body.token),
    })

    expect(other.statusCode).toBe(401)
    expect(prisma._store.session.filter((s) => s.revokedAt === null)).toHaveLength(1)

    await app.close()
  })
})

describe('recovery codes are stored as digests, finding NF-12', () => {
  /**
   * Enrol a TOTP factor and return its recovery codes.
   *
   * @param {object} app The instance.
   * @param {object} headers Signed-in headers.
   * @returns {Promise<object>} The codes and the post-rotation headers.
   */
  async function enrol(app, headers) {
    const { totp } = await import('@desi-event/auth')
    const started = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp',
      headers,
      payload: {},
    })
    const { factorId, secret } = started.json().data

    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp/confirm',
      headers,
      payload: { factorId, code: totp(secret) },
    })

    expect(confirmed.statusCode).toBe(200)

    return {
      recoveryCodes: confirmed.json().data.recoveryCodes,
      headers: followCookies(headers, confirmed),
    }
  }

  it('stores a digest, not a reversible seal', async () => {
    // A seal can be opened with the server key, so anybody holding the database
    // and the key could print somebody's codes. A digest cannot be reversed.
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    await enrol(app, signedIn.headers)

    const stored = prisma._store.mfaFactor.filter((factor) => factor.type === 'RECOVERY_CODE')

    expect(stored.length).toBeGreaterThan(0)

    for (const factor of stored) {
      // 64 lower-case hex characters, and nothing that looks like a seal.
      expect(factor.secretSealed).toMatch(/^[0-9a-f]{64}$/)
      expect(factor.secretSealed.startsWith('seal')).toBe(false)
    }

    await app.close()
  })

  it('still accepts a recovery code at sign-in, and consumes it', async () => {
    const { app, prisma } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')
    const { recoveryCodes } = await enrol(app, signedIn.headers)
    const [code] = recoveryCodes

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'priya@example.com', password: PASSWORD, code },
    })

    expect(first.statusCode).toBe(200)
    expect(first.json().token).toBeTruthy()

    // Single use: the same code does not work twice.
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'priya@example.com', password: PASSWORD, code },
    })

    expect(second.statusCode).toBe(401)
    expect(
      prisma._store.mfaFactor.filter((f) => f.type === 'RECOVERY_CODE' && f.usedAt !== null),
    ).toHaveLength(1)

    await app.close()
  })

  it('refuses a code that was never issued', async () => {
    const { app } = await createTestApp()
    const signedIn = await signInAsBrowser(app, 'priya@example.com')

    await enrol(app, signedIn.headers)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'priya@example.com', password: PASSWORD, code: 'ABCD-EFGH-IJKL' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})
