/**
 * Seed the world the refusal journeys need.
 *
 * Four refusals need four things the lifecycle suite deliberately does not
 * have, because that suite is about an event succeeding:
 *
 *   - **Two organisations.** Cross-tenant refusal needs somebody to be on the
 *     outside, and "outside" has to be a real membership somewhere else rather
 *     than an account with no memberships at all — an account with none proves
 *     only that the route needs a membership.
 *   - **An unverified organisation** holding an event that is otherwise ready
 *     to publish. If the event were incomplete the refusal would be ambiguous:
 *     it has to fail *only* because the organisation is unverified.
 *   - **A draft venue map**, so a reserved-seat session can reference one and
 *     be refused for that reason and no other.
 *   - **A published event in organisation A** for the outsider to try to edit.
 *
 * Everything is tagged with a run suffix and removed afterwards. Nothing
 * touches a database that is not the disposable test one.
 *
 * @module e2e/support/seed-refusals
 */

import { createPrismaClient } from '@desi-event/db'
import { hashPassword, seal, totp } from '@desi-event/auth'

/** The connection these journeys use. Disposable by construction. */
export const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/** The password every seeded account uses. Test-only, and it says so. */
export const PASSWORD = 'e2e-test-password-not-a-real-secret'

/** The TOTP secret every seeded account holds. */
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

/** Must match `AUTH_SECRET` in the Playwright config. */
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
 * @returns {Promise<void>} Resolves once cleared.
 */
export async function forgetCodeUse() {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  await prisma.mfaFactor.updateMany({ where: { type: 'TOTP' }, data: { lastUsedAt: null } })
  await prisma.loginAttempt.deleteMany({})
  await prisma.$disconnect()
}

/**
 * Everything the four refusals need.
 *
 * @param {string} tag A suffix unique to this run.
 * @returns {Promise<object>} The seeded ids and credentials.
 */
export async function seedRefusals(tag) {
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

  /**
   * An organisation with an owner who holds a second factor.
   *
   * @param {string} name What to call it.
   * @param {string} slug Its slug fragment.
   * @param {boolean} verified Whether it has been verified.
   * @returns {Promise<object>} The organisation and its owner.
   */
  async function organisationWithOwner(name, slug, verified) {
    const organization = await prisma.organization.create({
      data: {
        name: `${name} ${tag}`,
        slug: `${slug}-${tag}`,
        contactEmail: `${slug}-${tag}@example.test`,
        verificationStatus: verified ? 'VERIFIED' : 'UNVERIFIED',
        verified,
      },
    })

    const owner = await prisma.user.create({
      data: {
        email: `${slug}-owner-${tag}@organiser.test`,
        passwordHash,
        displayName: `${name} Owner`,
        role: 'ORGANIZER',
        emailVerified: true,
      },
    })

    await prisma.membership.create({
      data: { userId: owner.id, organizationId: organization.id, role: 'OWNER' },
    })
    await enrol(owner.id)

    return { organization, owner }
  }

  const alpha = await organisationWithOwner('Alpha Collective', 'alpha', true)
  const beta = await organisationWithOwner('Beta Collective', 'beta', true)
  const unverified = await organisationWithOwner('Unverified Collective', 'unverified', false)

  /**
   * A venue for one organisation.
   *
   * @param {string} organizationId Whose it is.
   * @param {string} slug Its slug fragment.
   * @returns {Promise<object>} The venue.
   */
  const venueFor = (organizationId, slug) =>
    prisma.venue.create({
      data: {
        name: `${slug} Hall ${tag}`,
        slug: `${slug}-hall-${tag}`,
        addressLine1: '1 Test Road',
        city: 'Mumbai',
        region: 'Maharashtra',
        postalCode: '400001',
        organizationId,
        provenance: 'organizer',
      },
    })

  const alphaVenue = await venueFor(alpha.organization.id, 'alpha')
  const unverifiedVenue = await venueFor(unverified.organization.id, 'unverified')

  /**
   * An event complete enough to be publishable, but for one thing.
   *
   * Everything the readiness checklist asks for is here — description,
   * policies, a tier on sale — so that a refusal can only be about the one
   * thing being tested.
   *
   * @param {object} options Options.
   * @param {string} options.organizationId Whose event it is.
   * @param {string} options.venueId Where it is.
   * @param {string} options.slug Its slug fragment.
   * @param {string} options.title Its title.
   * @param {string} options.status Its lifecycle status.
   * @returns {Promise<object>} The event, with a tier.
   */
  async function publishableEvent({ organizationId, venueId, slug, title, status }) {
    const event = await prisma.event.create({
      data: {
        organizationId,
        venueId,
        title,
        slug: `${slug}-${tag}`,
        summary: 'An evening that exists only to be refused.',
        description:
          'Complete on purpose: everything the readiness checklist asks for is present, so a refusal can only be about the one thing under test.',
        category: 'MUSIC_CONCERT',
        status,
        startsAt: new Date(Date.now() + 45 * 86_400_000),
        endsAt: new Date(Date.now() + 45 * 86_400_000 + 3 * 3_600_000),
        timezone: 'Asia/Kolkata',
        policies: {
          entry: 'Doors open an hour before. Bring the pass on your phone.',
          refund: 'Refunds up to seven days before the event.',
          conduct: 'Be kind to the tree.',
        },
        ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
      },
    })

    await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'General admission',
        priceCents: 100_000,
        currency: 'INR',
        quantityTotal: 100,
        status: 'ON_SALE',
      },
    })

    return event
  }

  // Alpha's published event, for the outsider to try to edit and publish.
  const alphaEvent = await publishableEvent({
    organizationId: alpha.organization.id,
    venueId: alphaVenue.id,
    slug: 'alpha-event',
    title: `Alpha's Evening ${tag}`,
    status: 'PUBLISHED',
  })

  // Alpha's draft, for the outsider to try to submit for review.
  const alphaDraft = await publishableEvent({
    organizationId: alpha.organization.id,
    venueId: alphaVenue.id,
    slug: 'alpha-draft',
    title: `Alpha's Draft ${tag}`,
    status: 'DRAFT',
  })

  // The unverified organisation's event: approved by a moderator, ready in
  // every other respect, and still unpublishable.
  const unverifiedEvent = await publishableEvent({
    organizationId: unverified.organization.id,
    venueId: unverifiedVenue.id,
    slug: 'unverified-event',
    title: `Unverified Evening ${tag}`,
    status: 'APPROVED',
  })

  // A venue map that was never published, and a session that references it.
  const map = await prisma.venueMap.create({
    data: { venueId: alphaVenue.id, name: `Draft plan ${tag}` },
  })

  const draftVersion = await prisma.venueMapVersion.create({
    data: { venueMapId: map.id, version: 1, seatCount: 0 },
  })

  await prisma.$disconnect()

  return {
    tag,
    password: PASSWORD,
    alphaOwnerEmail: alpha.owner.email,
    alphaOwnerId: alpha.owner.id,
    alphaOrganizationId: alpha.organization.id,
    betaOrganizationId: beta.organization.id,
    betaOwnerEmail: beta.owner.email,
    unverifiedOwnerEmail: unverified.owner.email,
    alphaEventId: alphaEvent.id,
    alphaDraftId: alphaDraft.id,
    unverifiedEventId: unverifiedEvent.id,
    draftMapVersionId: draftVersion.id,
    draftMapName: map.name,
    alphaVenueId: alphaVenue.id,
  }
}

/**
 * Remove everything a run created.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupRefusals(tag) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  const organizations = await prisma.organization.findMany({ where: { slug: { contains: tag } } })

  for (const organization of organizations) {
    const events = await prisma.event.findMany({ where: { organizationId: organization.id } })

    for (const event of events) {
      // An event a posted ledger batch reaches through an order cannot be
      // deleted, and that is the append-only ledger working rather than a
      // cleanup fault. Skipped rather than attempted, so the log does not carry
      // a foreign-key error that reads like a failure.
      const pinned = await prisma.order.count({ where: { eventId: event.id } }).catch(() => 0)

      if (pinned > 0) continue

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

    const maps = await prisma.venueMap
      .findMany({ where: { name: { contains: tag } } })
      .catch(() => [])

    for (const map of maps) {
      await prisma.venueMapVersion.deleteMany({ where: { venueMapId: map.id } }).catch(() => {})
      await prisma.venueMap.delete({ where: { id: map.id } }).catch(() => {})
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

  // Any organisation the ledger still reaches stays, for the same reason.
  for (const organization of organizations) {
    const pinned = await prisma.event.count({ where: { organizationId: organization.id } })

    if (pinned > 0) continue

    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => {})
  }
  await prisma.$disconnect()
}
