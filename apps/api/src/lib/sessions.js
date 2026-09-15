/**
 * Sessions, devices and login attempts, as rows.
 *
 * `@desi-event/auth` decides *when* a session is valid, when it rotates, and
 * when somebody has guessed wrong too often. This module is where those
 * decisions meet the database — creating the row, rotating its secret, revoking
 * its siblings, recognising a browser as one seen before.
 *
 * The division matters because the interesting failures live on this side. A
 * rotation that writes a new digest and returns the old secret signs everybody
 * out. A "revoke everything else" that forgets to exclude the current session
 * signs the person out of the request they just made. A device fingerprint that
 * includes the IP address makes every roaming phone a new device. None of those
 * are visible in a pure function.
 *
 * @module @desi-event/api/lib/sessions
 */

import {
  LOGIN_OUTCOMES,
  REVOCATION_REASONS,
  THROTTLE,
  checkLoginThrottle,
  hashToken,
  issueToken,
  pseudonymize,
  revokesSiblings,
  sessionPolicyFor,
  sessionUsable,
  shouldRotate,
  windowStart,
} from '@desi-event/auth'

/**
 * Joins the parts of a device fingerprint.
 *
 * A unit separator, spelled as a character code rather than as a literal so it
 * is visible in the source. It cannot appear in an HTTP header value, which is
 * the point: without a separator ('ab', 'c') and ('a', 'bc') concatenate to the
 * same string and are one device.
 *
 * @type {string}
 */
const SEPARATOR = String.fromCharCode(31)

/**
 * How a browser is recognised as one seen before.
 *
 * The user agent and the accepted languages, and deliberately **not** the IP
 * address: a phone changes address every time it moves between wifi and mobile
 * data, and including it would make each move a new device and each device list
 * a hundred rows of noise. What is left is weak — many browsers produce the same
 * two headers — which is the honest position. A device row is a convenience for
 * somebody reviewing their own account, not an authentication factor, and
 * nothing in this system treats it as one.
 *
 * @param {object} request The incoming request.
 * @param {string} key The deployment's pseudonymisation key.
 * @returns {string} A digest identifying this browser as well as headers can.
 */
export function deviceFingerprint(request, key) {
  const headers = request.headers ?? {}
  const parts = [
    String(headers['user-agent'] ?? ''),
    String(headers['accept-language'] ?? ''),
    String(headers['sec-ch-ua-platform'] ?? ''),
  ]

  return pseudonymize(parts.join(SEPARATOR), key)
}

/**
 * The caller's address, as far as the deployment can tell.
 *
 * Fastify's `request.ip` already accounts for `trustProxy`, so this is either
 * the socket address or the forwarded one depending on how the server was
 * configured — a decision made once, at boot, rather than per call site.
 *
 * @param {object} request The incoming request.
 * @returns {string} The address, or an empty string.
 */
export function callerAddress(request) {
  return String(request.ip ?? '')
}

/**
 * Record one sign-in attempt.
 *
 * Both identifying values are digested with the deployment's key before they are
 * written, so the table can answer "the same address again" without holding
 * anybody's address or email. The outcome is one of a small enumerated set: this
 * row is analysable, and it can never carry the password that was tried.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.email The address that was tried.
 * @param {string} options.address The caller's address.
 * @param {string} options.outcome One of `LOGIN_OUTCOMES`.
 * @param {string} options.key The deployment's pseudonymisation key.
 * @returns {Promise<void>} Resolves once the attempt is recorded.
 */
export async function recordLoginAttempt(prisma, { email, address, outcome, key }) {
  await prisma.loginAttempt.create({
    data: {
      emailHash: pseudonymize(String(email ?? '').toLowerCase(), key),
      ipHash: pseudonymize(address, key),
      succeeded: outcome === LOGIN_OUTCOMES.SUCCESS,
      outcome,
    },
  })
}

/**
 * Whether this sign-in attempt may proceed.
 *
 * Counts failures *since the last success* for the address, not failures in the
 * window: a successful sign-in is proof the person is who they say they are, and
 * it clears the count. Counting the window alone would keep somebody locked out
 * for fifteen minutes after they had already got in.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.email The address being tried.
 * @param {string} options.address The caller's address.
 * @param {string} options.key The deployment's pseudonymisation key.
 * @param {Date} [options.now] The current time.
 * @param {object} [options.policy] Override the thresholds.
 * @returns {Promise<{allowed: boolean, scope: string|null, retryAfterSeconds: number}>} The decision.
 */
export async function throttleLogin(
  prisma,
  { email, address, key, now = new Date(), policy = THROTTLE },
) {
  const emailHash = pseudonymize(String(email ?? '').toLowerCase(), key)
  const ipHash = pseudonymize(address, key)

  const [lastSuccess, ipFailures] = await Promise.all([
    prisma.loginAttempt.findFirst({
      where: { emailHash, succeeded: true },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.loginAttempt.count({
      where: {
        ipHash,
        succeeded: false,
        createdAt: { gte: windowStart(policy.perIp.windowMs, now) },
      },
    }),
  ])

  const since = [windowStart(policy.perEmail.windowMs, now), lastSuccess?.createdAt]
    .filter(Boolean)
    .reduce((latest, candidate) => (candidate > latest ? candidate : latest))

  const [emailFailures, lastFailure] = await Promise.all([
    prisma.loginAttempt.count({
      where: { emailHash, succeeded: false, createdAt: { gt: since } },
    }),
    prisma.loginAttempt.findFirst({
      where: { emailHash, succeeded: false },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ])

  return checkLoginThrottle(
    { emailFailures, ipFailures, lastEmailFailureAt: lastFailure?.createdAt ?? null, now },
    policy,
  )
}

/**
 * Find or create the device row for this browser.
 *
 * Upserted on `(userId, fingerprintHash)`, which the database holds unique, so
 * two simultaneous sign-ins from the same browser produce one device rather than
 * two or a crash.
 *
 * A device that was revoked and then signs in again is *not* silently
 * resurrected with its old row: revocation is a statement about a device, and
 * un-revoking it because somebody typed the right password would make the
 * feature meaningless. Instead the row stays revoked and the label is left
 * alone; the new session simply carries no device.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.userId Whose device it is.
 * @param {string} options.fingerprint The fingerprint digest.
 * @param {string|null} [options.label] A label the person supplied.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<object|null>} The device row, or null when it is revoked.
 */
export async function recogniseDevice(
  prisma,
  { userId, fingerprint, label = null, now = new Date() },
) {
  const existing = await prisma.device.findUnique({
    where: { userId_fingerprintHash: { userId, fingerprintHash: fingerprint } },
  })

  if (existing?.revokedAt) return null

  if (existing) {
    return prisma.device.update({
      where: { id: existing.id },
      data: { lastSeenAt: now, ...(label ? { label } : {}) },
    })
  }

  try {
    return await prisma.device.create({
      data: { userId, fingerprintHash: fingerprint, label, firstSeenAt: now, lastSeenAt: now },
    })
  } catch {
    // Lost the race with a simultaneous sign-in from the same browser. The row
    // the other request created is the right answer.
    return prisma.device.findUnique({
      where: { userId_fingerprintHash: { userId, fingerprintHash: fingerprint } },
    })
  }
}

/**
 * Start a session.
 *
 * Returns the secret exactly once. What is stored is its digest, so the row this
 * creates cannot be used to sign in as anybody — which is the property that makes
 * a database dump survivable.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {object} options.actor The actor, used to choose the lifetime policy.
 * @param {object} options.request The incoming request.
 * @param {string} options.key The deployment's pseudonymisation key.
 * @param {string|null} [options.deviceId] The device this session belongs to.
 * @param {boolean} [options.mfaSatisfied] Whether a second factor was proved during sign-in.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<{session: object, secret: string, policy: object}>} The row, the secret, and the policy applied.
 */
export async function startSession(
  prisma,
  { actor, request, key, deviceId = null, mfaSatisfied = false, now = new Date() },
) {
  const policy = sessionPolicyFor(actor)
  const { secret, hash } = issueToken()

  const session = await prisma.session.create({
    data: {
      userId: actor.id,
      tokenHash: hash,
      deviceId,
      userAgent: String(request.headers?.['user-agent'] ?? '').slice(0, 400) || null,
      ipHash: pseudonymize(callerAddress(request), key),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + policy.lifetimes.absoluteMs),
      mfaSatisfiedAt: mfaSatisfied ? now : null,
    },
  })

  return { session, secret, policy }
}

/**
 * Resolve a session secret to its row.
 *
 * The lookup is by digest, so the secret never reaches the query log.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} secret The secret from the cookie or the bearer token.
 * @returns {Promise<object|null>} The session row with its user, or null.
 */
export async function findSession(prisma, secret) {
  if (typeof secret !== 'string' || secret === '') return null

  return prisma.session.findUnique({
    where: { tokenHash: hashToken(secret) },
    include: { user: true, device: true },
  })
}

/**
 * Replace a session's secret, keeping the session.
 *
 * The update is conditional on the digest that is being replaced, so two
 * concurrent requests cannot both rotate: the second one's update matches
 * nothing, and it keeps using the secret it already has rather than handing the
 * browser a secret that has already been superseded.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} session The session row to rotate.
 * @param {Date} [now] The current time.
 * @returns {Promise<{secret: string, rotated: boolean}>} The new secret, or `rotated: false` when another request won.
 */
export async function rotateSession(prisma, session, now = new Date()) {
  const { secret, hash } = issueToken()

  const { count } = await prisma.session.updateMany({
    where: { id: session.id, tokenHash: session.tokenHash, revokedAt: null },
    data: { tokenHash: hash, rotatedAt: now, lastSeenAt: now },
  })

  return count === 1 ? { secret, rotated: true } : { secret: null, rotated: false }
}

/**
 * Note that a session was used.
 *
 * Deliberately not awaited by the request path in the common case: this is a
 * write on every authenticated request, and a buyer should not wait for it. It
 * is skipped entirely when the stored value is recent, so a burst of requests
 * produces one write rather than fifty.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} session The session row.
 * @param {Date} [now] The current time.
 * @param {number} [granularityMs] How stale `lastSeenAt` must be before it is worth a write.
 * @returns {Promise<void>} Resolves once the write is done or skipped.
 */
export async function touchSession(prisma, session, now = new Date(), granularityMs = 60_000) {
  const last = session.lastSeenAt instanceof Date ? session.lastSeenAt.getTime() : 0

  if (now.getTime() - last < granularityMs) return

  await prisma.session.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { lastSeenAt: now },
  })
}

/**
 * End one session.
 *
 * Idempotent: the filter excludes an already-revoked session, so a second call
 * writes nothing and does not overwrite the reason the first one recorded.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} sessionId The session to end.
 * @param {string} reason One of `REVOCATION_REASONS`.
 * @param {Date} [now] The current time.
 * @returns {Promise<number>} How many rows were revoked: 1, or 0 if it already was.
 */
export async function revokeSession(prisma, sessionId, reason, now = new Date()) {
  const { count } = await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  })

  return count
}

/**
 * End every session an account holds, optionally except one.
 *
 * The exception exists because the common case is "sign me out everywhere else"
 * — a person changing their password should not be signed out of the form they
 * are using. Where the reason is a password *reset*, the caller passes no
 * exception, because there the point is that a session established with the old
 * password stops working, and that includes the one making the request.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.userId Whose sessions.
 * @param {string} options.reason One of `REVOCATION_REASONS`.
 * @param {string|null} [options.exceptSessionId] A session to leave alone.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<number>} How many sessions were ended.
 */
export async function revokeAllSessions(
  prisma,
  { userId, reason, exceptSessionId = null, now = new Date() },
) {
  const { count } = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: now, revokedReason: reason },
  })

  return count
}

/**
 * Apply the sibling-revocation rule for a privilege change.
 *
 * The rule itself lives in `@desi-event/auth`; this is where it is enforced, so
 * that a handler changing a password cannot forget it by writing the update and
 * stopping there.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.userId Whose sessions.
 * @param {string} options.reason One of `REVOCATION_REASONS`.
 * @param {string|null} [options.exceptSessionId] A session to leave alone.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<number>} How many sessions were ended.
 */
export async function applyRevocationRule(prisma, { userId, reason, exceptSessionId, now }) {
  if (!revokesSiblings(reason)) return 0

  return revokeAllSessions(prisma, { userId, reason, exceptSessionId, now })
}

/**
 * Revoke a device and everything established from it.
 *
 * Both writes happen because revoking the device alone would leave its sessions
 * working, which is the opposite of what somebody clicking "this wasn't me"
 * expects.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.deviceId The device to revoke.
 * @param {string} options.userId Whose device it must be.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<{device: number, sessions: number}>} How many rows each write touched.
 */
export async function revokeDevice(prisma, { deviceId, userId, now = new Date() }) {
  const device = await prisma.device.updateMany({
    where: { id: deviceId, userId, revokedAt: null },
    data: { revokedAt: now },
  })

  const sessions = await prisma.session.updateMany({
    where: { deviceId, userId, revokedAt: null },
    data: { revokedAt: now, revokedReason: REVOCATION_REASONS.DEVICE_REVOKED },
  })

  return { device: device.count, sessions: sessions.count }
}

/**
 * The sessions an account currently holds.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} userId Whose sessions.
 * @param {Date} [now] The current time.
 * @returns {Promise<object[]>} Live sessions, newest first, each with its device.
 */
export async function listSessions(prisma, userId, now = new Date()) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { lastSeenAt: 'desc' },
    include: { device: true },
  })
}

/**
 * The devices an account has signed in from, with their live session counts.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} userId Whose devices.
 * @param {Date} [now] The current time.
 * @returns {Promise<object[]>} Devices, most recently seen first.
 */
export async function listDevices(prisma, userId, now = new Date()) {
  const devices = await prisma.device.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: 'desc' },
  })

  if (devices.length === 0) return []

  // One grouped query rather than one per device: a person with twenty devices
  // should not cost twenty round trips.
  const counts = await prisma.session.groupBy({
    by: ['deviceId'],
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: now },
      deviceId: { in: devices.map((device) => device.id) },
    },
    _count: { _all: true },
  })

  const byDevice = new Map(counts.map((row) => [row.deviceId, row._count._all]))

  return devices.map((device) => ({ ...device, activeSessions: byDevice.get(device.id) ?? 0 }))
}

/**
 * Validate a session and rotate its secret when it is due.
 *
 * The one place the whole session lifecycle is applied, so that no route can
 * accidentally accept an idle session or skip a rotation.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {object} options.session The session row.
 * @param {object} options.actor The actor it belongs to.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<{valid: boolean, reason: string|null, rotatedSecret: string|null, policy: object}>} The outcome.
 */
export async function refreshSession(prisma, { session, actor, now = new Date() }) {
  const policy = sessionPolicyFor(actor)
  const { valid, reason } = sessionUsable(session, { now, lifetimes: policy.lifetimes })

  if (!valid) return { valid: false, reason, rotatedSecret: null, policy }

  let rotatedSecret = null

  if (shouldRotate(session, { now, lifetimes: policy.lifetimes })) {
    const { secret, rotated } = await rotateSession(prisma, session, now)
    if (rotated) rotatedSecret = secret
  } else {
    await touchSession(prisma, session, now)
  }

  return { valid: true, reason: null, rotatedSecret, policy }
}
