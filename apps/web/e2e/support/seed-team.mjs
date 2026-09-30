/**
 * The two accounts the team-and-organisations journey adds to the detail world.
 *
 * Both are fresh, because both gain privileges the journey is about, and a
 * privilege gain ends every other session the account holds (NF-10): an
 * account global setup signed in would have its saved session rotated out from
 * under the specs after this one.
 *
 *   - **The creator** starts an organisation from the account page and so
 *     becomes its owner. An owner must use two-step sign-in, so the account is
 *     given the seeded factor now — enrolling one through the page is the
 *     security page's own journey, not this one's.
 *   - **The invitee** is invited as staff and joins with the code the creator
 *     hands over. Staff needs no second factor, so the account has none.
 *   - **The solo creator** is an attendee with no second factor, the way most
 *     people arrive, who makes an organisation of their own and is sent to set
 *     one up before the workspace opens. A re-seed takes away any factor an
 *     earlier run enrolled, so the journey always starts from none.
 *
 * The journey's other actors already exist: the platform reader (the seed's
 * super administrator) changes a platform role and grants a membership without
 * any change to its own, the taker tries a code that is not theirs and is
 * refused, and the feature world's role target is the account whose platform
 * role changes. None of them is created here.
 *
 * ## Cleanup
 *
 * Everything the journey made hangs from the organisation the creator made:
 * its memberships, invitations and verification history go with it by
 * cascade. The role target's platform role is put back to what the feature
 * world seeded, so nothing later in the run meets a moderator it did not
 * expect.
 *
 * Every user row stays, and so do its audit rows.
 * The audit rows deliberately stay: `desi_audit_log_immutable` refuses an
 * UPDATE or a DELETE on `AuditLog`, and the actor foreign key is ON DELETE SET
 * NULL, so deleting an account would be an update of its audit rows and is
 * refused. Their sessions, factors and
 * memberships go, which is what makes a left-behind account inert.
 *
 * @module e2e/support/seed-team
 */

import { createPrismaClient } from '@desi-event/db'

import { hashPassword, seal } from '@desi-event/auth'

import { checkedTag, featureAccounts } from './seed-feature-world.mjs'
import { AUTH_SECRET, CONNECTION, PASSWORD, TOTP_SECRET } from './seed-refusals.mjs'

/**
 * The journey's own addresses and names.
 *
 * Pure, so a spec can name them before anything is seeded.
 *
 * @param {string} tag The run suffix.
 * @returns {{creatorEmail: string, creatorName: string, inviteeEmail: string, inviteeName: string, organizationName: string, soloEmail: string, soloName: string, soloOrganizationName: string}} The names.
 */
export function teamAccounts(tag) {
  checkedTag(tag)

  return {
    creatorEmail: `team-creator-${tag}@organiser.test`,
    creatorName: 'Nandini Rao',
    inviteeEmail: `team-invitee-${tag}@attendee.test`,
    inviteeName: 'Farhan Qureshi',
    organizationName: `Team Journey ${tag}`,
    soloEmail: `team-solo-${tag}@attendee.test`,
    soloName: 'Ishita Vora',
    soloOrganizationName: `Solo Journey ${tag}`,
  }
}

/**
 * Seed the creator and the invitee.
 *
 * Upserted, because a fixture user outlives a run; their roles are reset on
 * every seed, so a re-run starts from an attendee with no organisation.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<{creatorEmail: string, creatorId: string, inviteeEmail: string, inviteeId: string, organizationName: string, soloEmail: string, soloId: string, soloOrganizationName: string}>} The ids.
 */
export async function seedTeam(tag) {
  const names = teamAccounts(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const passwordHash = await hashPassword(PASSWORD)

    /**
     * An attendee account, upserted.
     *
     * @param {string} email The address.
     * @param {string} displayName The name.
     * @returns {Promise<object>} The user.
     */
    const attendee = (email, displayName) =>
      prisma.user.upsert({
        where: { email },
        update: { passwordHash, displayName, role: 'ATTENDEE', emailVerified: true },
        create: { email, passwordHash, displayName, role: 'ATTENDEE', emailVerified: true },
      })

    const creator = await attendee(names.creatorEmail, names.creatorName)
    const invitee = await attendee(names.inviteeEmail, names.inviteeName)
    const solo = await attendee(names.soloEmail, names.soloName)

    // The solo creator starts with no second factor, whatever an earlier run
    // of this tag enrolled.
    await prisma.mfaFactor.deleteMany({ where: { userId: solo.id } })

    // Once: `seal` picks a fresh nonce each time, so a blind create would give
    // a re-seeded account a second factor rather than fail.
    const enrolled = await prisma.mfaFactor.findFirst({
      where: { userId: creator.id, type: 'TOTP', confirmedAt: { not: null } },
    })

    if (!enrolled) {
      await prisma.mfaFactor.create({
        data: {
          userId: creator.id,
          type: 'TOTP',
          secretSealed: seal(TOTP_SECRET, { secret: AUTH_SECRET, purpose: 'mfa-totp' }),
          confirmedAt: new Date(),
        },
      })
    }

    return {
      creatorEmail: creator.email,
      creatorId: creator.id,
      inviteeEmail: invitee.email,
      inviteeId: invitee.id,
      organizationName: names.organizationName,
      soloEmail: solo.email,
      soloId: solo.id,
      soloOrganizationName: names.soloOrganizationName,
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The organisation the creator made, if it exists yet.
 *
 * @param {string} tag The run suffix.
 * @param {object} [options] Options.
 * @param {'creator'|'solo'} [options.who] Whose organisation: the creator's, or the solo creator's.
 * @returns {Promise<{id: string, slug: string}|null>} Its id and slug.
 */
export async function createdOrganization(tag, { who = 'creator' } = {}) {
  const { creatorEmail, soloEmail } = teamAccounts(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.organization.findFirst({
      where: { createdBy: { email: who === 'solo' ? soloEmail : creatorEmail } },
      select: { id: true, slug: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * How many sessions an account holds that could still answer a request.
 *
 * @param {string} email The account.
 * @returns {Promise<number>} Live, unrevoked, unexpired sessions.
 */
export async function liveSessionsOf(email) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.session.count({
      where: { user: { email }, revokedAt: null, expiresAt: { gt: new Date() } },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * How many accounts hold the super administrator's platform role.
 *
 * @returns {Promise<number>} The count.
 */
export async function superAdministrators() {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.user.count({ where: { role: 'SUPER_ADMIN' } })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Remove what the journey made.
 *
 * Safe to run twice, and safe after a journey that stopped part-way.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupTeam(tag) {
  const names = teamAccounts(tag)
  const { roleTarget } = featureAccounts(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const organizations = await prisma.organization.findMany({
      where: { createdBy: { email: { in: [names.creatorEmail, names.soloEmail] } } },
      select: { id: true },
    })

    for (const organization of organizations) {
      await prisma.invitation
        .deleteMany({ where: { organizationId: organization.id } })
        .catch(() => {})
      await prisma.membership
        .deleteMany({ where: { organizationId: organization.id } })
        .catch(() => {})
      // Verification history goes with it, by cascade.
      await prisma.organization.delete({ where: { id: organization.id } }).catch(() => {})
    }

    const users = await prisma.user.findMany({
      where: { email: { in: [names.creatorEmail, names.inviteeEmail, names.soloEmail] } },
    })

    for (const user of users) {
      await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {})
      await prisma.mfaFactor.deleteMany({ where: { userId: user.id } }).catch(() => {})
      await prisma.membership.deleteMany({ where: { userId: user.id } }).catch(() => {})
      // The user row stays, and so do its audit rows: see the module note.
    }

    // As the feature world seeded it. Its factor stays: that world's cleanup
    // owns it.
    await prisma.user
      .updateMany({ where: { email: roleTarget }, data: { role: 'ATTENDEE' } })
      .catch(() => {})
    await prisma.session.deleteMany({ where: { user: { email: roleTarget } } }).catch(() => {})
  } finally {
    await prisma.$disconnect()
  }
}
