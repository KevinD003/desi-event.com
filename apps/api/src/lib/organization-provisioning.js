/**
 * Making an organisation.
 *
 * There is one way an organisation comes into being through the API: somebody
 * accepts an organiser invitation the Desi-Event team sent them
 * (`routes/organizer-invitations.js`). Self-service creation is gone —
 * `organizations.create` answers 403 to everybody — so this module is where
 * the writes it used to do now live, shaped for the invitation:
 *
 *   - the organisation's **name, public description and website** are the ones
 *     the administrator wrote on the invitation. The recipient chooses only its
 *     web address and time zone, so what goes public under a Verified badge is
 *     what the team vouched for;
 *   - it starts **VERIFIED**, with the inviting administrator recorded as the
 *     actor of its first verification event;
 *   - the **contact address** is the accepting account's own email, recorded
 *     for the platform and never shown publicly, and the **payout currency** is
 *     USD, the one this catalogue sells in;
 *   - the accepting account becomes its **OWNER**, a membership that records
 *     which invitation made it.
 *
 * The one other organisation that comes into being is made by the platform,
 * not by a person: the **platform-held** organisation an import puts listed
 * events in ({@link ensurePlatformHeldOrganization}, SPEC2-XI I-B). It is
 * VERIFIED by the importing administrator and has no members; the database
 * refuses any (trigger `desi_platform_held_has_no_members`).
 *
 * @module @desi-event/api/lib/organization-provisioning
 */

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { conflict, databaseErrorCode, unprocessable } from './errors.js'
import { disambiguateSlug, slugify } from './identifiers.js'
import { isEligible } from './verification.js'

/** The currency an invited organisation is paid in: the one this catalogue sells in. */
export const ORGANIZATION_PAYOUT_CURRENCY = 'USD'

/** The reason recorded on an invited organisation's first verification event. */
export const INVITED_ORGANIZATION_VERIFICATION_REASON =
  'Created from an organiser invitation sent by the Desi-Event team.'

/** What a caller is told when the web address they asked for is somebody else's. */
export const SLUG_TAKEN_SENTENCE =
  'That web address is taken by another organisation. Choose another.'

/**
 * An organisation, as its own members read it.
 *
 * An allow-list. The contact address, payout currency, suspension reason and
 * creator are deliberately absent; the response schema would strip them too.
 *
 * @param {object} organization The organisation row.
 * @returns {object} The profile.
 */
export function toOrganizationProfile(organization) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    description: organization.description ?? null,
    websiteUrl: organization.websiteUrl ?? null,
    timezone: organization.timezone,
    legalName: organization.legalName ?? null,
    verificationStatus: organization.verificationStatus,
    eligible: isEligible(organization),
    createdAt: organization.createdAt,
  }
}

/**
 * Whether a thrown value is a unique-constraint violation.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True for `P2002` or `23505`.
 */
export function isUniqueViolation(error) {
  const code = databaseErrorCode(error)

  return code === 'P2002' || code === '23505'
}

/**
 * The slug a name makes, or a refusal that talks about names.
 *
 * `slugify`'s own refusal talks about a title, which an organisation does not
 * have. A name written entirely outside the Latin alphabet is a reasonable
 * name that simply makes no web address; the caller supplies one.
 *
 * @param {string} name The organisation's name.
 * @returns {string} The slug.
 * @throws {Error} A 422 naming the field to supply.
 */
export function slugFromName(name) {
  try {
    return slugify(name)
  } catch (error) {
    if (error?.statusCode !== 422) throw error

    throw unprocessable(
      'That name makes no web address, because it has no letters from A to Z or digits. Supply "slug".',
      { field: 'slug' },
    )
  }
}

/**
 * Choose the web address to try first.
 *
 * A courtesy check, so the common collision is answered before a transaction
 * is opened. The unique index is what actually decides, and the caller handles
 * a collision it reports: a slug somebody asked for is theirs to change, and
 * one the server derived is the server's to make unique.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Inputs.
 * @param {string|undefined} options.requested The slug the caller asked for, if any.
 * @param {string} options.name The organisation's name.
 * @returns {Promise<{slug: string, requested: boolean}>} The slug, and whether it was asked for.
 * @throws {Error} 409 when a requested slug is taken; 422 when the name makes none.
 */
export async function resolveOrganizationSlug(prisma, { requested, name }) {
  const slug = requested ?? slugFromName(name)
  const taken = await prisma.organization.findUnique({ where: { slug }, select: { id: true } })

  if (taken && requested) throw conflict(SLUG_TAKEN_SENTENCE)

  return { slug: taken ? disambiguateSlug(slug) : slug, requested: Boolean(requested) }
}

/**
 * Write the organisation an accepted invitation starts, its first verification
 * event, and its owner's membership.
 *
 * Runs inside the caller's transaction, after the invitation has been marked
 * accepted, so all of it commits or none of it does.
 *
 * @param {object} tx The transaction client.
 * @param {object} options Inputs.
 * @param {object} options.invitation The organiser invitation row.
 * @param {{id: string}} options.actor The accepting account.
 * @param {string} options.email The accepting account's address, kept as the contact address.
 * @param {{timezone: string}} options.profile What the recipient chose.
 * @param {string} options.slug The web address.
 * @param {Date} options.now The current time.
 * @returns {Promise<{organization: object, membership: object}>} The new rows.
 */
export async function createInvitedOrganization(
  tx,
  { invitation, actor, email, profile, slug, now },
) {
  const organization = await tx.organization.create({
    data: {
      name: invitation.organizationName,
      slug,
      description: invitation.organizationDescription ?? null,
      websiteUrl: invitation.organizationWebsiteUrl ?? null,
      timezone: profile.timezone,
      contactEmail: email,
      payoutCurrency: ORGANIZATION_PAYOUT_CURRENCY,
      verificationStatus: 'VERIFIED',
      verified: true,
      verificationUpdatedAt: now,
      createdById: actor.id,
    },
  })

  await tx.organizationVerificationEvent.create({
    data: {
      organizationId: organization.id,
      fromStatus: null,
      toStatus: 'VERIFIED',
      // The administrator who sent the invitation vouched for it.
      actorId: invitation.invitedById,
      reason: INVITED_ORGANIZATION_VERIFICATION_REASON,
      createdAt: now,
    },
  })

  const membership = await tx.membership.create({
    data: {
      userId: actor.id,
      organizationId: organization.id,
      role: 'OWNER',
      organizerInvitationId: invitation.id,
    },
  })

  return { organization, membership }
}

/**
 * The platform-held organisation each import source's events belong to, as it
 * is created the first time.
 */
export const PLATFORM_HELD_ORGANIZATIONS = Object.freeze({
  SULEKHA: Object.freeze({
    name: 'Sulekha Events',
    slug: 'sulekha-events',
    description:
      'Events listed on Sulekha.com and shown on Desi-Event by the Desi-Event team. Each event page names the organiser who runs it. Tickets for these events are sold on Sulekha.',
    // The listings imported are Texas events.
    timezone: 'America/Chicago',
  }),
})

/** The note on a platform-held organisation's verification. */
export const PLATFORM_HELD_VERIFICATION_NOTE = 'Held by the Desi-Event team for imported events'

/**
 * Find the platform-held organisation for an import source, creating it the
 * first time (SPEC2-XI I-B).
 *
 * Created VERIFIED, with its first verification event by the importing
 * administrator; `websiteUrl` null; paid in USD; `platformHeldSource` set,
 * which the unique index keeps to one organisation per source; no membership,
 * not even the importer's (the database refuses one). Its contact address is
 * the importing administrator's own, recorded for the platform and never shown
 * publicly. It is not made through `organizations.create`, which stays 403.
 * Audited `organization.platform_held_created`.
 *
 * Runs in the caller's transaction. Two imports creating it at once meet the
 * unique index: the loser's transaction fails with `P2002`, and the caller
 * reads the winner's (see `lib/event-import.js`).
 *
 * @param {object} tx A transaction client.
 * @param {object} options Inputs.
 * @param {'SULEKHA'} options.source The import source.
 * @param {{id: string}} options.actor The importing administrator.
 * @param {Date} options.now The moment.
 * @returns {Promise<{organization: object, created: boolean}>} The organisation, and whether this call made it.
 */
export async function ensurePlatformHeldOrganization(tx, { source, actor, now }) {
  const shape = PLATFORM_HELD_ORGANIZATIONS[source]

  if (!shape) throw new TypeError(`No platform-held organisation is defined for ${source}.`)

  const existing = await tx.organization.findUnique({ where: { platformHeldSource: source } })

  if (existing) return { organization: existing, created: false }

  const taken = await tx.organization.findUnique({
    where: { slug: shape.slug },
    select: { id: true },
  })
  const slug = taken ? disambiguateSlug(shape.slug) : shape.slug
  const importer = await tx.user.findUnique({ where: { id: actor.id }, select: { email: true } })

  if (!importer?.email) throw new TypeError('The importing administrator has no account.')

  const organization = await tx.organization.create({
    data: {
      name: shape.name,
      slug,
      description: shape.description,
      websiteUrl: null,
      timezone: shape.timezone,
      contactEmail: importer.email,
      payoutCurrency: ORGANIZATION_PAYOUT_CURRENCY,
      verificationStatus: 'VERIFIED',
      verified: true,
      verificationNote: PLATFORM_HELD_VERIFICATION_NOTE,
      verificationUpdatedAt: now,
      createdById: actor.id,
      platformHeldSource: source,
    },
  })

  await tx.organizationVerificationEvent.create({
    data: {
      organizationId: organization.id,
      fromStatus: null,
      toStatus: 'VERIFIED',
      actorId: actor.id,
      reason: PLATFORM_HELD_VERIFICATION_NOTE,
      createdAt: now,
    },
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.ORGANIZATION_PLATFORM_HELD_CREATED,
    entityType: 'Organization',
    entityId: organization.id,
    actorId: actor.id,
    metadata: { source, slug, verificationStatus: 'VERIFIED' },
  })

  return { organization, created: true }
}
