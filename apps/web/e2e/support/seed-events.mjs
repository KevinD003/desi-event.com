/**
 * Seed the database the event-lifecycle journeys run against.
 *
 * Two people and one place, which is the smallest cast the lifecycle needs: an
 * organiser who owns an organisation, a platform moderator who decides about
 * it, and a venue to put an event in. The journeys create the event themselves
 * — the point is that the authoring surface works, so seeding a ready-made
 * event would test the seed.
 *
 * Everything is tagged with a run suffix and removed afterwards. Nothing
 * touches a database that is not the disposable test one.
 *
 * @module e2e/support/seed-events
 */

import { createPrismaClient } from '@desi-event/db'
import { hashPassword, seal, totp } from '@desi-event/auth'

/** The connection these journeys use. Disposable by construction. */
export const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/** The password every seeded account uses. Test-only, and it says so. */
export const PASSWORD = 'e2e-test-password-not-a-real-secret'

/**
 * The TOTP secret every seeded account holds.
 *
 * Both parties are privileged — an `OWNER` membership and the `MODERATOR`
 * platform role — so finding NF-12 requires a confirmed second factor before
 * any guarded route. The journeys go through it rather than around it: faking
 * it by exempting the routes would test a system nobody runs.
 *
 * @type {string}
 */
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

/**
 * The sealing secret the API process in this suite runs with.
 *
 * Must match `AUTH_SECRET` in the Playwright config: a mismatch presents as an
 * invalid code rather than as a configuration error, which is a bad half-hour.
 *
 * @type {string}
 */
export const AUTH_SECRET = 'e2e-only-auth-secret-that-is-long-enough-32'

/**
 * A current one-time code for the seeded factor.
 *
 * @returns {string} Six digits.
 */
export function currentCode() {
  return totp(TOTP_SECRET)
}

/**
 * Let time pass, as far as the two rate limits are concerned.
 *
 * A code whose counter has been seen is refused, and a dozen sign-in attempts
 * in ninety seconds locks an account. Both controls are right. A real organiser
 * waits; a suite cannot, so this clears exactly that bookkeeping — the password
 * still has to be right, the code still has to be current, and the factor still
 * has to exist.
 *
 * @returns {Promise<void>} Resolves once cleared.
 */
export async function forgetCodeUse() {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  await prisma.mfaFactor.updateMany({ where: { type: 'TOTP' }, data: { lastUsedAt: null } })
  await prisma.loginAttempt.deleteMany({})
  await prisma.$disconnect()
}

/**
 * Create the organisation, its owner, a moderator and a venue.
 *
 * @param {string} tag A suffix unique to this run.
 * @returns {Promise<object>} The seeded ids and credentials.
 */
export async function seedEvents(tag) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })
  const passwordHash = await hashPassword(PASSWORD)

  /**
   * Give a user the second factor their role requires.
   *
   * @param {string} userId The user.
   * @returns {Promise<void>} Resolves when enrolled.
   */
  async function enrol(userId) {
    await prisma.mfaFactor.create({
      data: {
        userId,
        type: 'TOTP',
        secretSealed: seal(TOTP_SECRET, { secret: AUTH_SECRET, purpose: 'mfa-totp' }),
        confirmedAt: new Date(),
      },
    })
  }

  const organization = await prisma.organization.create({
    data: {
      name: `E2E Events ${tag}`,
      slug: `e2e-events-${tag}`,
      contactEmail: `events-${tag}@example.test`,
      // Verified, because an unverified organisation cannot publish at all and
      // fifteen of these twenty journeys are about what happens after that.
      verificationStatus: 'VERIFIED',
      verified: true,
    },
  })

  const organiser = await prisma.user.create({
    data: {
      email: `owner-${tag}@organiser.test`,
      passwordHash,
      displayName: `Owner ${tag}`,
      role: 'ORGANIZER',
      emailVerified: true,
    },
  })

  // OWNER rather than EVENT_MANAGER: cancelling an event is an owner's or an
  // administrator's decision, and two of these journeys cancel one.
  await prisma.membership.create({
    data: { userId: organiser.id, organizationId: organization.id, role: 'OWNER' },
  })
  await enrol(organiser.id)

  const moderator = await prisma.user.create({
    data: {
      email: `moderator-${tag}@platform.test`,
      passwordHash,
      displayName: `Moderator ${tag}`,
      role: 'MODERATOR',
      emailVerified: true,
    },
  })

  await enrol(moderator.id)

  const venue = await prisma.venue.create({
    data: {
      name: `Banyan Courtyard ${tag}`,
      slug: `banyan-courtyard-${tag}`,
      addressLine1: '1 Banyan Road',
      city: 'Mumbai',
      region: 'Maharashtra',
      postalCode: '400001',
      organizationId: organization.id,
      provenance: 'organizer',
      accessibility: { features: ['STEP_FREE_ENTRANCE'], note: 'The ramp is at Gate 3.' },
    },
  })

  await prisma.$disconnect()

  return {
    tag,
    organizationId: organization.id,
    organiserEmail: organiser.email,
    moderatorEmail: moderator.email,
    venueId: venue.id,
    venueName: venue.name,
    password: PASSWORD,
  }
}

/**
 * Remove everything a run created.
 *
 * Ordered so a foreign key never blocks a delete, and tolerant of a row a
 * trigger refuses — some of what these journeys create is meant to be
 * undeletable, and the teardown must not be what proves otherwise.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupEvents(tag) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  const organizations = await prisma.organization.findMany({
    where: { slug: { contains: tag } },
  })

  for (const organization of organizations) {
    const events = await prisma.event.findMany({ where: { organizationId: organization.id } })

    for (const event of events) {
      await prisma.notificationOutbox
        .deleteMany({ where: { dedupeKey: { contains: event.id } } })
        .catch(() => {})
      // `EventSeat` is keyed by the session, not the event: a seat belongs to
      // one performance, which is the whole reason reserved seating works.
      const sessions = await prisma.eventSession
        .findMany({ where: { eventId: event.id } })
        .catch(() => [])

      for (const session of sessions) {
        await prisma.eventSeat.deleteMany({ where: { eventSessionId: session.id } }).catch(() => {})
      }

      await prisma.ticketType.deleteMany({ where: { eventId: event.id } }).catch(() => {})
      await prisma.eventSession.deleteMany({ where: { eventId: event.id } }).catch(() => {})
      await prisma.eventModerationAction
        .deleteMany({ where: { eventId: event.id } })
        .catch(() => {})
      await prisma.auditLog.deleteMany({ where: { entityId: event.id } }).catch(() => {})
      await prisma.event.delete({ where: { id: event.id } }).catch(() => {})
    }

    await prisma.venue.deleteMany({ where: { organizationId: organization.id } }).catch(() => {})
  }

  const users = await prisma.user.findMany({ where: { email: { contains: tag } } })

  for (const user of users) {
    await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {})
    await prisma.mfaFactor.deleteMany({ where: { userId: user.id } }).catch(() => {})
    await prisma.membership.deleteMany({ where: { userId: user.id } }).catch(() => {})
    // The audit rows and the user row deliberately stay. `desi_audit_log_immutable`
    // refuses an UPDATE or a DELETE on `AuditLog`, and the actor foreign key is
    // ON DELETE SET NULL, so deleting this user would be an UPDATE of their audit
    // rows and is refused. That is the guarantee working, not a teardown bug: in
    // this system a person is redacted, never deleted. Every identifier above is
    // suffixed with a per-run tag, so what is left behind collides with nothing.
  }

  await prisma.organization.deleteMany({ where: { slug: { contains: tag } } }).catch(() => {})
  await prisma.$disconnect()
}
