/**
 * The accounts and rows the organiser-onboarding journeys need.
 *
 * Organisers join Desi-Event only by an invitation from the Desi-Event team,
 * and every event they create is reviewed before it can be public. The
 * journeys in `detail-organiser-onboarding.spec.js` walk that path end to
 * end, and nearly every step of it changes somebody's privileges: an invited
 * owner gains an organisation, a super administrator gives somebody a posting
 * role, an owner moves an administrator down. A privilege change ends every
 * other session the account holds (NF-10), so none of these is an account
 * global setup signed in. Everything here is fresh, and carries the tag:
 *
 *   - **The administrator** (`onboard-admin-<tag>@desi-event.test`), a
 *     platform ADMIN with a confirmed second factor, as the role requires. It
 *     invites, reissues and reviews. It is given a VIEWER membership in Onboard
 *     Gamma only for the one journey about a reviewer who belongs to the
 *     organisation ({@link seatAdministratorInGamma}), and loses it again
 *     after ({@link unseatAdministratorFromGamma}), so its rail is the bare
 *     ADMIN's everywhere else.
 *   - **The owner**, an attendee with a second factor (an owner must use
 *     two-step sign-in), whom the administrator invites to start
 *     `Onboard Studio <tag>`.
 *   - **The stranger**, an attendee with no factor, who tries every way of
 *     making themselves an organiser and is refused each time.
 *   - **The joiner**, an attendee with a factor, whom the super administrator
 *     puts into Onboard Gamma as an event manager from People and roles.
 *   - **Onboard Gamma <tag>**, an existing VERIFIED organisation with its own
 *     owner (a factor), an administrator (a factor) and a viewer (none), and
 *     one event waiting for review. No other spec reads it, so nothing here
 *     moves a count another spec asserts.
 *
 * The organisation the owner starts is made by the product, in the browser,
 * when the invitation is accepted. {@link draftEventFor} then writes two
 * publishable drafts into it, the way an organiser's editor would leave
 * them, so the review journey starts from an event that lacks nothing but a
 * decision.
 *
 * ## Cleanup
 *
 * {@link cleanupOnboarding} removes the organiser invitations sent to this
 * file's addresses (every one starts `onboard-` and carries the tag), then the
 * two organisations whose names start `Onboard ` and carry the tag — Onboard
 * Studio, which the product made, and Onboard Gamma — with their events,
 * memberships and team invitations, then the venues it seeded, then the
 * fixture users' sessions and factors. Nothing else is matched: the detail and
 * sweep worlds name every organisation and address with the same tag, and
 * their specs are still running when this cleanup does.
 *
 * Every user row stays, and so do its audit rows.
 * The audit rows deliberately stay: `desi_audit_log_immutable` refuses an
 * UPDATE or a DELETE on `AuditLog`, and the actor foreign key is ON DELETE SET
 * NULL, so deleting an account would be an update of its audit rows and is
 * refused. Their sessions, factors and memberships go, which is what makes a
 * left-behind account inert.
 *
 * @module e2e/support/seed-onboarding
 */

import { randomBytes } from 'node:crypto'

import { createPrismaClient } from '@desi-event/db'

import { hashPassword, hashToken, seal } from '@desi-event/auth'

import { checkedTag } from './seed-feature-world.mjs'
import {
  AUTH_SECRET,
  CONNECTION,
  PASSWORD,
  TOTP_SECRET,
  currentCode,
  forgetCodeUse,
} from './seed-refusals.mjs'

export { currentCode, forgetCodeUse }

/** One day, in milliseconds. */
const DAY_MS = 86_400_000

/** Where the onboarding organisations run their nights. */
export const ONBOARDING_TIME_ZONE = 'America/Chicago'

/**
 * The journeys' addresses, names and titles.
 *
 * Pure, so a spec can name them before anything is seeded. The organisation
 * the owner is invited to start keeps a script other than Latin in its name:
 * letters and the organisation's page carry it as it was written, while its
 * web address is made from the Latin part.
 *
 * @param {string} tag The run suffix.
 * @returns {object} The names.
 */
export function onboardingNames(tag) {
  checkedTag(tag)

  return {
    adminEmail: `onboard-admin-${tag}@desi-event.test`,
    adminName: 'Onboard Administrator',
    ownerEmail: `onboard-owner-${tag}@organiser.test`,
    ownerName: 'Kavya Iyer',
    strangerEmail: `onboard-stranger-${tag}@attendee.test`,
    strangerName: 'Dev Malhotra',
    joinerEmail: `onboard-joiner-${tag}@organiser.test`,
    joinerName: 'Arjun Nair',
    gammaOwnerEmail: `onboard-gamma-owner-${tag}@organiser.test`,
    gammaOwnerName: 'Meera Pillai',
    gammaAdministratorEmail: `onboard-gamma-admin-${tag}@organiser.test`,
    gammaAdministratorName: 'Rahul Bose',
    gammaViewerEmail: `onboard-gamma-viewer-${tag}@attendee.test`,
    gammaViewerName: 'Sana Kapoor',
    gammaName: `Onboard Gamma ${tag}`,
    gammaSlug: `onboard-gamma-${tag}`,
    studioName: `Onboard Studio ${tag} ગરબા`,
    studioDescription:
      'Garba and dandiya nights in Houston since 2018, run by volunteers from the neighbourhood.',
    studioWebsite: `https://onboard-studio-${tag}.example.test/`,
    studioNote: 'नमस्ते! Your organiser invitation for the autumn season is below.',
    firstDraftTitle: `Onboard Studio Night ${tag}`,
    secondDraftTitle: `Onboard Studio Matinee ${tag}`,
    waitingTitle: `Onboard Gamma Evening ${tag}`,
  }
}

/**
 * The platform administrator alone, for a page that only needs somebody
 * holding that role — the accessibility sweep's People and roles refusal,
 * and the workspace rail's platform administrator case.
 *
 * By default the same account {@link seedOnboarding} makes, upserted the same
 * way, with the confirmed second factor the role requires;
 * {@link cleanupOnboarding} takes its sessions and factor away again. A spec
 * that runs beside the onboarding story names an account of its own, so
 * neither spends the other's credential budget or loses its sessions to the
 * other's cleanup; it removes that account's sessions itself.
 *
 * @param {string} tag The run suffix.
 * @param {object} [account] Another account to seed instead.
 * @param {string} [account.email] Its address.
 * @param {string} [account.displayName] Its name.
 * @returns {Promise<{id: string, email: string}>} The account.
 */
export async function seedAdministrator(tag, account = {}) {
  const names = onboardingNames(tag)
  const adminEmail = account.email ?? names.adminEmail
  const adminName = account.displayName ?? names.adminName
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const passwordHash = await hashPassword(PASSWORD)
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash, displayName: adminName, role: 'ADMIN', emailVerified: true },
      create: {
        email: adminEmail,
        passwordHash,
        displayName: adminName,
        role: 'ADMIN',
        emailVerified: true,
      },
    })
    const enrolled = await prisma.mfaFactor.findFirst({
      where: { userId: admin.id, type: 'TOTP', confirmedAt: { not: null } },
    })

    if (!enrolled) {
      await prisma.mfaFactor.create({
        data: {
          userId: admin.id,
          type: 'TOTP',
          secretSealed: seal(TOTP_SECRET, { secret: AUTH_SECRET, purpose: 'mfa-totp' }),
          confirmedAt: new Date(),
        },
      })
    }

    return { id: admin.id, email: admin.email }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Seed the accounts and Onboard Gamma.
 *
 * Upserted throughout, because a fixture user outlives a run and a re-run of
 * the same tag after a cleanup must find nothing in its way. Roles are reset
 * on every seed, so a re-run starts from the same people with the same
 * powers.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<object>} The ids the journeys navigate by.
 */
export async function seedOnboarding(tag) {
  const names = onboardingNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const passwordHash = await hashPassword(PASSWORD)

    /**
     * An account, upserted with the platform role it is about.
     *
     * @param {string} email The address.
     * @param {string} displayName The name.
     * @param {string} role The platform role.
     * @returns {Promise<object>} The user.
     */
    const account = (email, displayName, role) =>
      prisma.user.upsert({
        where: { email },
        update: { passwordHash, displayName, role, emailVerified: true, suspendedAt: null },
        create: { email, passwordHash, displayName, role, emailVerified: true },
      })

    /**
     * Give an account the confirmed second factor its role requires, once.
     *
     * Idempotent for the reason `seed-refusals.mjs` gives: `seal` picks a
     * fresh nonce each time, so a blind create would add a second factor to a
     * re-seeded account rather than fail.
     *
     * @param {string} userId The user.
     * @returns {Promise<void>} Resolves when enrolled.
     */
    async function enrol(userId) {
      const already = await prisma.mfaFactor.findFirst({
        where: { userId, type: 'TOTP', confirmedAt: { not: null } },
      })

      if (already) return

      await prisma.mfaFactor.create({
        data: {
          userId,
          type: 'TOTP',
          secretSealed: seal(TOTP_SECRET, { secret: AUTH_SECRET, purpose: 'mfa-totp' }),
          confirmedAt: new Date(),
        },
      })
    }

    const admin = await account(names.adminEmail, names.adminName, 'ADMIN')
    const owner = await account(names.ownerEmail, names.ownerName, 'ATTENDEE')
    const stranger = await account(names.strangerEmail, names.strangerName, 'ATTENDEE')
    const joiner = await account(names.joinerEmail, names.joinerName, 'ATTENDEE')
    const gammaOwner = await account(names.gammaOwnerEmail, names.gammaOwnerName, 'ORGANIZER')
    const gammaAdministrator = await account(
      names.gammaAdministratorEmail,
      names.gammaAdministratorName,
      'ORGANIZER',
    )
    const gammaViewer = await account(names.gammaViewerEmail, names.gammaViewerName, 'ATTENDEE')

    for (const user of [admin, owner, joiner, gammaOwner, gammaAdministrator]) {
      await enrol(user.id)
    }

    // The stranger and the viewer start with no factor, whatever an earlier
    // run of this tag enrolled, the way most people arrive.
    await prisma.mfaFactor.deleteMany({ where: { userId: { in: [stranger.id, gammaViewer.id] } } })

    // Nobody starts in an organisation they should not be in: an earlier
    // run's accept or grant is undone by its cleanup, and this makes sure.
    await prisma.membership.deleteMany({
      where: { userId: { in: [admin.id, owner.id, stranger.id, joiner.id] } },
    })

    const now = new Date()
    const gammaFields = {
      name: names.gammaName,
      contactEmail: `onboard-gamma-${tag}@example.test`,
      verificationStatus: 'VERIFIED',
      verified: true,
      verificationUpdatedAt: now,
      payoutCurrency: 'USD',
      timezone: ONBOARDING_TIME_ZONE,
      createdById: gammaOwner.id,
    }
    const gamma = await prisma.organization.upsert({
      where: { slug: names.gammaSlug },
      update: gammaFields,
      create: { slug: names.gammaSlug, ...gammaFields },
    })

    const gammaMemberships = {}

    for (const [key, user, role] of [
      ['owner', gammaOwner, 'OWNER'],
      ['administrator', gammaAdministrator, 'ADMIN'],
      ['viewer', gammaViewer, 'VIEWER'],
    ]) {
      gammaMemberships[key] = await prisma.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: gamma.id } },
        update: { role },
        create: { userId: user.id, organizationId: gamma.id, role },
      })
    }

    const gammaVenue = await venueFor(prisma, {
      organizationId: gamma.id,
      name: `Onboard Gamma Hall ${tag}`,
      slug: `onboard-gamma-hall-${tag}`,
    })

    // Waiting for review, as a submission leaves it: inserted, because the
    // review gate guards status changes and only a moderator's decision may
    // move an event out of review.
    const waiting = await publishableEvent(prisma, {
      organizationId: gamma.id,
      venueId: gammaVenue.id,
      title: names.waitingTitle,
      slug: `onboard-gamma-evening-${tag}`,
      status: 'REVIEW_PENDING',
      daysAhead: 52,
    })

    return {
      adminId: admin.id,
      ownerId: owner.id,
      strangerId: stranger.id,
      joinerId: joiner.id,
      gammaOwnerId: gammaOwner.id,
      gammaAdministratorId: gammaAdministrator.id,
      gammaViewerId: gammaViewer.id,
      gammaOrganizationId: gamma.id,
      gammaAdministratorMembershipId: gammaMemberships.administrator.id,
      gammaViewerMembershipId: gammaMemberships.viewer.id,
      waitingEventId: waiting.id,
      waitingEventRevision: waiting.revision,
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * A venue owned by an organisation, upserted by its slug.
 *
 * @param {object} prisma The client.
 * @param {object} fields What to call it.
 * @param {string} fields.organizationId Whose it is.
 * @param {string} fields.name Its name.
 * @param {string} fields.slug Its slug.
 * @returns {Promise<object>} The venue.
 */
function venueFor(prisma, { organizationId, name, slug }) {
  const fields = {
    name,
    addressLine1: '1 Test Plaza',
    city: 'Houston',
    region: 'TX',
    postalCode: '77002',
    country: 'US',
    timezone: ONBOARDING_TIME_ZONE,
    organizationId,
    provenance: 'organizer',
  }

  return prisma.venue.upsert({ where: { slug }, update: fields, create: { slug, ...fields } })
}

/**
 * An event with everything publishing asks for: its words, a category, a
 * venue, the three policies, one night with a capacity and one ticket type.
 *
 * Inserted in the status it is meant to be in, never moved there: the review
 * gate refuses any move into review's outcome that a moderator did not make.
 *
 * @param {object} prisma The client.
 * @param {object} fields The event.
 * @param {string} fields.organizationId Whose it is.
 * @param {string} fields.venueId Where.
 * @param {string} fields.title Its title.
 * @param {string} fields.slug Its slug.
 * @param {'DRAFT'|'REVIEW_PENDING'} fields.status Where it stands.
 * @param {number} fields.daysAhead How many days from now it starts.
 * @returns {Promise<{id: string, slug: string, title: string, revision: number}>} The event.
 */
async function publishableEvent(
  prisma,
  { organizationId, venueId, title, slug, status, daysAhead },
) {
  const day = new Date(Date.now() + daysAhead * DAY_MS)
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
  // Seven in the evening in Houston, five hours behind UTC in daylight time
  // and six in standard: midnight UTC plus a day, give or take, is evening.
  const startsAt = new Date(midnight + 24 * 3_600_000)
  const endsAt = new Date(startsAt.getTime() + 4 * 3_600_000)

  const existing = await prisma.event.findUnique({ where: { slug } })

  if (existing) {
    return { id: existing.id, slug, title, revision: existing.revision ?? 0 }
  }

  const event = await prisma.event.create({
    data: {
      organizationId,
      venueId,
      title,
      slug,
      summary: 'A night of garba under the lights, with a live dhol ensemble.',
      description:
        'Three hours of garba and dandiya raas on a sprung floor, with sticks lent at the door and vegetarian food from seven.',
      category: 'GARBA_DANDIYA',
      status,
      startsAt,
      endsAt,
      timezone: ONBOARDING_TIME_ZONE,
      policies: {
        entry: 'Doors open half an hour before. Bring the pass on your phone.',
        refund: 'Refunds up to seven days before the night.',
        conduct: 'Be kind to each other and to the floor.',
      },
    },
  })

  const session = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: ONBOARDING_TIME_ZONE,
      status: 'SCHEDULED',
      capacity: 120,
      sortOrder: 0,
    },
  })

  await prisma.ticketType.create({
    data: {
      eventId: event.id,
      eventSessionId: session.id,
      name: 'General admission',
      priceCents: 2_200,
      currency: 'USD',
      quantityTotal: 120,
      status: 'ON_SALE',
    },
  })

  return { id: event.id, slug, title, revision: event.revision ?? 0 }
}

/**
 * Two publishable drafts in the organisation the owner started.
 *
 * Written after the invitation is accepted, because the product makes the
 * organisation: the first goes through review and is published, the second
 * stays a draft to be refused publication.
 *
 * @param {string} organizationId The organisation the accepted invitation made.
 * @param {string} tag The run suffix.
 * @returns {Promise<{first: object, second: object}>} The two drafts.
 */
export async function draftEventFor(organizationId, tag) {
  const names = onboardingNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const venue = await venueFor(prisma, {
      organizationId,
      name: `Onboard Studio Hall ${tag}`,
      slug: `onboard-studio-hall-${tag}`,
    })
    const first = await publishableEvent(prisma, {
      organizationId,
      venueId: venue.id,
      title: names.firstDraftTitle,
      slug: `onboard-studio-night-${tag}`,
      status: 'DRAFT',
      daysAhead: 45,
    })
    const second = await publishableEvent(prisma, {
      organizationId,
      venueId: venue.id,
      title: names.secondDraftTitle,
      slug: `onboard-studio-matinee-${tag}`,
      status: 'DRAFT',
      daysAhead: 46,
    })

    return { first, second }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Where an event stands, read from the database rather than a page.
 *
 * @param {string} eventId The event.
 * @returns {Promise<{status: string, revision: number}|null>} Its status and revision.
 */
export async function eventState(eventId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true, revision: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The organisation an accepted invitation made for the owner, if there is one.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<{id: string, slug: string, name: string, description: string|null, verificationStatus: string}|null>} It.
 */
export async function studioOrganization(tag) {
  const { ownerEmail } = onboardingNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.organization.findFirst({
      where: { createdBy: { email: ownerEmail } },
      select: { id: true, slug: true, name: true, description: true, verificationStatus: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * An account's platform role and its memberships, as the database holds them.
 *
 * @param {string} email The account.
 * @returns {Promise<{role: string, memberships: Array<{organizationId: string, role: string}>}|null>} What it holds.
 */
export async function heldBy(email) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.user.findUnique({
      where: { email },
      select: { role: true, memberships: { select: { organizationId: true, role: true } } },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Make an account's last second-factor confirmation older than any step-up
 * window, in every session it holds.
 *
 * So the next privileged write is asked for a fresh confirmation for certain,
 * and a journey can assert the prompt rather than answer it only if it comes.
 * The confirmation is moved back, not cleared: a session that confirmed a
 * factor at sign-in still did.
 *
 * @param {string} email The account.
 * @returns {Promise<void>} Resolves once moved.
 */
export async function expireStepUp(email) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await prisma.session.updateMany({
      where: { user: { email }, revokedAt: null },
      data: { mfaSatisfiedAt: new Date(Date.now() - 3 * 3_600_000) },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Give the administrator a VIEWER membership in Onboard Gamma.
 *
 * For the one journey about a reviewer who belongs to the organisation whose
 * event is waiting. Written directly, as a super administrator's grant would
 * leave it; the administrator's own window is this spec's, never saved by
 * global setup, so no saved session is affected.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves once seated.
 */
export async function seatAdministratorInGamma(tag) {
  const { adminEmail, gammaSlug } = onboardingNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })
    const gamma = await prisma.organization.findUniqueOrThrow({ where: { slug: gammaSlug } })

    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: admin.id, organizationId: gamma.id } },
      update: { role: 'VIEWER' },
      create: { userId: admin.id, organizationId: gamma.id, role: 'VIEWER' },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Take the administrator's Onboard Gamma membership away again.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves once removed.
 */
export async function unseatAdministratorFromGamma(tag) {
  const { adminEmail, gammaSlug } = onboardingNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await prisma.membership.deleteMany({
      where: { user: { email: adminEmail }, organization: { slug: gammaSlug } },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * An organiser invitation waiting to be accepted, whose code nobody holds.
 *
 * For the accessibility sweep, which measures the invitations list with a
 * waiting row in it and must never draw a live code to do so: the code is
 * made here, hashed as the API hashes it, and dropped. Only its digest is
 * stored, so the row can be shown, reissued or withdrawn, and never accepted.
 *
 * @param {object} options Options.
 * @param {string} options.tag The run suffix.
 * @param {string} options.invitedById The administrator recorded as sending it.
 * @returns {Promise<{id: string, email: string, organizationName: string}>} The row.
 */
export async function seedWaitingInvitation({ tag, invitedById }) {
  checkedTag(tag)

  const prisma = createPrismaClient({ connectionString: CONNECTION })
  const email = `onboard-waiting-${tag}@organiser.test`
  const organizationName = `Waiting Collective ${tag}`

  try {
    const already = await prisma.organizerInvitation.findFirst({
      where: { email, status: 'PENDING' },
      select: { id: true },
    })

    if (already) return { id: already.id, email, organizationName }

    const row = await prisma.organizerInvitation.create({
      data: {
        email,
        organizationName,
        organizationDescription: 'Bhangra and garba nights for families in Dallas.',
        tokenHash: hashToken(randomBytes(32).toString('base64url')),
        invitedById,
        status: 'PENDING',
        deliveryMode: 'MANUAL',
        expiresAt: new Date(Date.now() + 14 * DAY_MS),
      },
      select: { id: true },
    })

    return { id: row.id, email, organizationName }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Remove what the journeys made.
 *
 * Safe to run twice, and safe after a journey that stopped part-way.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupOnboarding(tag) {
  const names = onboardingNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    // First, so no row points at an organisation about to go. Only this
    // file's addresses: they all start `onboard-`.
    await prisma.organizerInvitation
      .deleteMany({
        where: { AND: [{ email: { startsWith: 'onboard-' } }, { email: { contains: tag } }] },
      })
      .catch(() => {})

    // Only this file's organisations: their names all start `Onboard `.
    const organizations = await prisma.organization.findMany({
      where: { AND: [{ name: { startsWith: 'Onboard ' } }, { name: { contains: tag } }] },
      select: { id: true },
    })

    for (const organization of organizations) {
      await prisma.invitation
        .deleteMany({ where: { organizationId: organization.id } })
        .catch(() => {})
      await prisma.membership
        .deleteMany({ where: { organizationId: organization.id } })
        .catch(() => {})
      // Sessions, ticket types, moderation history and counted visits go with
      // each event, by cascade.
      await prisma.event.deleteMany({ where: { organizationId: organization.id } }).catch(() => {})
      // Verification history goes with it, by cascade.
      await prisma.organization.delete({ where: { id: organization.id } }).catch(() => {})
    }

    await prisma.venue
      .deleteMany({
        where: { slug: { in: [`onboard-gamma-hall-${tag}`, `onboard-studio-hall-${tag}`] } },
      })
      .catch(() => {})

    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [
            names.adminEmail,
            names.ownerEmail,
            names.strangerEmail,
            names.joinerEmail,
            names.gammaOwnerEmail,
            names.gammaAdministratorEmail,
            names.gammaViewerEmail,
          ],
        },
      },
      select: { id: true },
    })

    for (const user of users) {
      await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {})
      await prisma.mfaFactor.deleteMany({ where: { userId: user.id } }).catch(() => {})
      await prisma.membership.deleteMany({ where: { userId: user.id } }).catch(() => {})
      // The user row stays, and so do its audit rows: see the module note.
    }
  } finally {
    await prisma.$disconnect()
  }
}
