/**
 * Seed the database the organiser journeys run against.
 *
 * These journeys need what no other suite here needs: a real API, a real
 * database, and a real signed-in organiser. The public suites deliberately run
 * with the API down, because that is the state the fallback catalogue exists
 * for; an organiser journey has no such fallback, and a screen that invented
 * one would be the defect.
 *
 * Everything created here is tagged with a run suffix and removed afterwards.
 * Nothing touches a database that is not the disposable test one.
 *
 * @module e2e/support/seed-organizer
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
 * The TOTP secret every seeded organiser holds.
 *
 * `EVENT_MANAGER` is a privileged organisation role, so finding NF-12 requires
 * a confirmed second factor before any guarded route — including creating a
 * venue. An organiser without one is refused, which is the control working.
 *
 * So the seed gives them a real factor and the journeys sign in with a real
 * code. Faking it by exempting the route, or by seeding a session that skipped
 * the check, would test a system nobody runs.
 *
 * @type {string}
 */
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

/**
 * The sealing secret the organiser E2E API process runs with.
 *
 * Must match `AUTH_SECRET` in `playwright.organizer.config.js`: the API unseals
 * the stored factor with it, and a mismatch presents as an invalid code rather
 * than as a configuration error.
 *
 * @type {string}
 */
export const AUTH_SECRET = 'e2e-only-auth-secret-that-is-long-enough-32'

/**
 * A current one-time code for the seeded factor.
 *
 * @returns {string} A six-digit code.
 */
export function currentCode() {
  return totp(TOTP_SECRET)
}

/**
 * Let time pass, as far as the two rate limits are concerned.
 *
 * Two controls make a dozen sign-ins in ninety seconds look like an attack,
 * and both are right to:
 *
 *   - **TOTP replay.** A code whose counter has been seen is refused, so every
 *     sign-in after the first inside one thirty-second window fails.
 *   - **Login throttling.** Every attempt is recorded, and "right password,
 *     code needed" is an attempt like any other. A dozen of them locks the
 *     account — which is exactly what should happen to a dozen of them.
 *
 * A real organiser waits. A suite cannot, so this clears the two pieces of
 * bookkeeping and nothing else: the password still has to be right, the code
 * still has to be current, and the factor still has to exist. It stands for
 * "time has passed", not for "the check is off".
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
 * Create two organisations, an organiser in each, and a shared venue.
 *
 * Two organisations rather than one, because half the journeys are about what
 * an organiser must *not* be able to reach.
 *
 * @param {string} tag A suffix unique to this run.
 * @returns {Promise<object>} The seeded ids and credentials.
 */
export async function seedOrganizer(tag) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })
  const passwordHash = await hashPassword(PASSWORD)

  /**
   * One organisation with an EVENT_MANAGER who can author venues.
   *
   * @param {string} label Distinguishes it.
   * @returns {Promise<object>} The organisation and its member.
   */
  async function organisation(label) {
    const org = await prisma.organization.create({
      data: {
        name: `E2E ${label} ${tag}`,
        slug: `e2e-${label}-${tag}`,
        contactEmail: `${label}-${tag}@example.test`,
        verificationStatus: 'VERIFIED',
        verified: true,
      },
    })

    // Upserted rather than created, because a fixture user is no longer
    // deletable: `desi_audit_log_immutable` refuses the `SET NULL` update that
    // deleting an actor would make to their audit rows, so `cleanup*` leaves
    // the row behind. Playwright starts a fresh worker after a failure and
    // re-runs `beforeAll`, which re-seeds the same tag — and a `create` there
    // turns one failing test into a suite that cannot continue. Seeding is
    // idempotent instead, which is a better contract than one that depended on
    // deletion.
    const identity = {
      passwordHash,
      displayName: `${label} organiser`,
      role: 'ORGANIZER',
      emailVerified: true,
    }
    const user = await prisma.user.upsert({
      where: { email: `${label}-${tag}@organiser.test` },
      update: identity,
      create: { email: `${label}-${tag}@organiser.test`, ...identity },
    })

    await prisma.membership.create({
      data: { userId: user.id, organizationId: org.id, role: 'EVENT_MANAGER' },
    })

    // The second factor a privileged role requires. Sealed exactly as the API
    // seals it, so the API can unseal and verify a real code.
    await prisma.mfaFactor.create({
      data: {
        userId: user.id,
        type: 'TOTP',
        secretSealed: seal(TOTP_SECRET, { secret: AUTH_SECRET, purpose: 'mfa-totp' }),
        confirmedAt: new Date(),
      },
    })

    return { organizationId: org.id, userId: user.id, email: user.email }
  }

  const mine = await organisation('mine')
  const theirs = await organisation('theirs')

  // A shared venue: no organisation owns it, so an organiser may select it for
  // an event and may not edit it.
  const shared = await prisma.venue.create({
    data: {
      name: `Shared Hall ${tag}`,
      slug: `shared-hall-${tag}`,
      addressLine1: '1 Shared Road',
      city: 'Mumbai',
      region: 'Maharashtra',
      postalCode: '400001',
      organizationId: null,
      provenance: 'moderator',
    },
  })

  // A venue belonging to the *other* organisation, for the refusal journey.
  const theirVenue = await prisma.venue.create({
    data: {
      name: `Their Hall ${tag}`,
      slug: `their-hall-${tag}`,
      addressLine1: '2 Their Road',
      city: 'Pune',
      region: 'Maharashtra',
      postalCode: '411001',
      organizationId: theirs.organizationId,
      provenance: 'organizer',
    },
  })

  await prisma.$disconnect()

  return {
    tag,
    mine,
    theirs,
    sharedVenueId: shared.id,
    theirVenueId: theirVenue.id,
    password: PASSWORD,
  }
}

/**
 * Remove everything a run created.
 *
 * Ordered so a foreign key never blocks a delete, and tolerant of rows that a
 * trigger refuses — a published map version is meant to be undeletable, and the
 * teardown must not be the thing that proves otherwise.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupOrganizer(tag) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  const venues = await prisma.venue.findMany({ where: { slug: { contains: tag } } })

  for (const venue of venues) {
    const maps = await prisma.venueMap.findMany({ where: { venueId: venue.id } })

    for (const map of maps) {
      const versions = await prisma.venueMapVersion.findMany({ where: { venueMapId: map.id } })

      for (const version of versions) {
        // A published version is undeletable by design: `BEFORE` triggers on
        // every layout table refuse the write, and one of the journeys exists
        // to prove that. So the teardown does not try. Attempting it and
        // swallowing the error would work too, but it fills the run log with
        // database errors that look like failures and are in fact the
        // guarantee holding.
        if (version.publishedAt) continue

        await prisma.seat.deleteMany({ where: { venueMapVersionId: version.id } }).catch(() => {})
        await prisma.seatRow
          .deleteMany({ where: { venueMapVersionId: version.id } })
          .catch(() => {})
        await prisma.section
          .deleteMany({ where: { venueMapVersionId: version.id } })
          .catch(() => {})
        await prisma.priceZone
          .deleteMany({ where: { venueMapVersionId: version.id } })
          .catch(() => {})
        await prisma.venueMapVersion.delete({ where: { id: version.id } }).catch(() => {})
      }

      // Refused above, so this is refused too, and so is the venue below. The
      // rows stay in the disposable test database, which is what disposable
      // means; `db:verify:fresh` is what removes them.
      await prisma.venueMap.delete({ where: { id: map.id } }).catch(() => {})
    }

    await prisma.venue.delete({ where: { id: venue.id } }).catch(() => {})
  }

  // Login attempts are keyed by a pseudonymised email, deliberately — the
  // table holds no user id to scope a delete by, which is the privacy property
  // working. `forgetCodeUse` clears the table wholesale on the disposable test
  // database instead; there is nothing tag-scoped to remove here.
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
