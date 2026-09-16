/**
 * A coherent seed dataset shared by the suites.
 *
 * One organisation running one published event and one draft, a second
 * organisation that must never be able to touch the first, and a user for each
 * organisation role. Building the world once per test (rather than sharing a
 * mutable one) keeps the oversell and check-in tests independent.
 *
 * @module @desi-event/api/tests/helpers/fixtures
 */

import bcrypt from 'bcryptjs'
import {
  PRIVILEGED_ORG_ROLES,
  PRIVILEGED_PLATFORM_ROLES,
  SCRYPT_PARAMETERS,
  hashPassword,
  seal,
} from '@desi-event/auth'

import { cuid } from './prisma-stub.js'

/**
 * The chart of accounts, copied from the Phase 2 migration.
 *
 * Literal ids rather than generated ones, because the migration uses literal ids
 * and the point of a fixture is to be the same shape as the thing it stands in
 * for. A generated id here would make the ledger service's per-process account
 * cache wrong the moment a test and a real database were used in one run.
 *
 * @type {ReadonlyArray<{id: string, code: string, name: string, type: string}>}
 */
/**
 * The TOTP secret every enrolled fixture account shares.
 *
 * One secret for all of them because the tests only ever need *a* valid code;
 * distinct secrets would add bookkeeping and prove nothing extra.
 *
 * @type {string}
 */
export const MFA_TEST_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

/**
 * The sealing secret the test environment resolves to.
 *
 * `apiEnvSchema` fills `AUTH_SECRET` from `JWT_SECRET` when it is not supplied,
 * and the harness supplies only `JWT_SECRET`. Defined here rather than imported
 * from the app helper because that helper imports *this* module.
 *
 * @type {string}
 */
export const TEST_AUTH_SECRET = 'test-only-secret-that-is-long-enough-32'

/**
 * Give every privileged account in a seed a confirmed second factor.
 *
 * Derived from the seed rather than listed by hand, because finding NF-12 makes
 * enrolment a property of *holding a privileged role* — and tests create such
 * roles freely. A hardcoded list would be right until the next test added a
 * FINANCE member, and then it would be wrong in a way that looks like a
 * product bug.
 *
 * Accounts that already have a factor are left alone, so a test that enrols one
 * itself is not given a second.
 *
 * @param {object} seed The seed tables.
 * @returns {{seed: object, enrolled: Set<string>}} The seed, and the emails now holding a factor.
 */
export function enrolPrivilegedUsers(seed) {
  const users = seed.user ?? []
  const byId = new Map(users.map((row) => [row.id, row]))
  const privileged = new Set()

  for (const row of users) {
    if (PRIVILEGED_PLATFORM_ROLES.has(row.role)) privileged.add(row.id)
  }

  for (const membership of seed.membership ?? []) {
    if (PRIVILEGED_ORG_ROLES.has(membership.role)) privileged.add(membership.userId)
  }

  const existing = new Set(
    (seed.mfaFactor ?? [])
      .filter(
        (factor) => factor.type !== 'RECOVERY_CODE' && factor.confirmedAt && !factor.disabledAt,
      )
      .map((factor) => factor.userId),
  )

  const added = []
  const enrolled = new Set()

  for (const userId of privileged) {
    const user = byId.get(userId)

    if (!user) continue

    enrolled.add(user.email)

    if (existing.has(userId)) continue

    added.push({
      id: cuid(),
      userId,
      type: 'TOTP',
      label: 'Test authenticator',
      // A real sealed secret, not a placeholder: the suite has to produce a
      // working code, because a privileged account needs one at sign-in as well
      // as for step-up.
      secretSealed: sealTotpSecret(MFA_TEST_SECRET),
      confirmedAt: new Date(),
      lastUsedAt: null,
      usedAt: null,
      disabledAt: null,
      createdAt: new Date(),
    })
  }

  seed.mfaFactor = [...(seed.mfaFactor ?? []), ...added]

  return { seed, enrolled }
}

/**
 * Seal a TOTP secret the way the API does.
 *
 * Same key derivation and same purpose label, so a factor written by a fixture
 * is indistinguishable from one written by the enrolment route.
 *
 * @param {string} secret The base32 TOTP secret.
 * @returns {string} The sealed value.
 */
function sealTotpSecret(secret) {
  return seal(secret, { secret: TEST_AUTH_SECRET, purpose: 'mfa-totp' })
}

const LEDGER_ACCOUNTS = Object.freeze([
  {
    id: 'ledacc0000000processorclear',
    code: 'processor_clearing',
    name: 'Processor clearing',
    type: 'ASSET',
  },
  {
    id: 'ledacc0000000organizerpaybl',
    code: 'organizer_payable',
    name: 'Organiser payable',
    type: 'LIABILITY',
  },
  {
    id: 'ledacc0000000platformfeerev',
    code: 'platform_fee_revenue',
    name: 'Platform fee revenue',
    type: 'REVENUE',
  },
  {
    id: 'ledacc0000000taxpayable0000',
    code: 'tax_payable',
    name: 'Tax payable',
    type: 'LIABILITY',
  },
  {
    id: 'ledacc0000000refundclearing',
    code: 'refund_clearing',
    name: 'Refund clearing',
    type: 'LIABILITY',
  },
  {
    id: 'ledacc0000000disputeclearin',
    code: 'dispute_clearing',
    name: 'Dispute clearing',
    type: 'LIABILITY',
  },
  {
    id: 'ledacc0000000transferclearg',
    code: 'transfer_clearing',
    name: 'Transfer clearing',
    type: 'ASSET',
  },
  {
    id: 'ledacc0000000payoutclearing',
    code: 'payout_clearing',
    name: 'Payout clearing',
    type: 'ASSET',
  },
  {
    id: 'ledacc0000000promotionaldis',
    code: 'promotional_discount',
    name: 'Promotional discount',
    type: 'CONTRA_REVENUE',
  },
  {
    id: 'ledacc0000000paymentfeeexpe',
    code: 'payment_fee_expense',
    name: 'Payment processing fees',
    type: 'EXPENSE',
  },
])

/** The password every seeded user signs in with. */
export const PASSWORD = 'correct-horse-battery'

/**
 * scrypt parameters weak enough for a test suite.
 *
 * The production parameters cost ~100ms and 32 MiB per derivation, which is the
 * point of them and also several minutes across a suite that signs in on nearly
 * every test. The cost is the only thing turned down; the format, the salting and
 * the verification path are the real ones. `packages/auth` has the tests that pay
 * the real cost.
 *
 * @type {object}
 */
export const TEST_SCRYPT = Object.freeze({ ...SCRYPT_PARAMETERS, N: 1024 })

/**
 * Hashed once. The *promise* is cached rather than the value, so two callers
 * racing before the first resolves share one hash instead of computing two.
 *
 * @type {Promise<string>|null}
 */
let cachedHash = null

/** @type {Promise<string>|null} */
let cachedLegacyHash = null

/**
 * The stored hash of {@link PASSWORD}, in the current format.
 *
 * @returns {Promise<string>} The hash.
 */
export function passwordHash() {
  cachedHash ??= hashPassword(PASSWORD, TEST_SCRYPT)
  return cachedHash
}

/**
 * The same password in Phase 1's bcrypt format.
 *
 * Kept so the migration path has something real to migrate: a suite in which
 * every fixture is already scrypt would never execute the legacy branch.
 *
 * @returns {Promise<string>} A bcrypt hash of {@link PASSWORD}.
 */
export function legacyPasswordHash() {
  cachedLegacyHash ??= bcrypt.hash(PASSWORD, 10)
  return cachedLegacyHash
}

/**
 * An instant a fixed number of minutes from now.
 *
 * @param {number} minutes Offset in minutes; negative for the past.
 * @returns {Date} The shifted instant.
 */
export function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000)
}

/**
 * Build the seed dataset.
 *
 * @param {object} [overrides] Per-model row arrays appended to the defaults.
 * @returns {Promise<{seed: object, ids: object}>} Rows keyed by model, plus the ids the tests assert against.
 */
export async function makeWorld(overrides = {}) {
  const hash = await passwordHash()

  const organization = {
    id: cuid(),
    name: 'Rangoli Collective',
    slug: 'rangoli-collective',
    contactEmail: 'hello@rangoli.example',
    // Coherent by construction: the denormalised badge and the state it is
    // derived from agree. A fixture where they disagree would let a bug that
    // serves a stale badge pass unnoticed, so the one test that needs an
    // incoherent row builds it deliberately.
    verified: true,
    verificationStatus: 'VERIFIED',
    verificationNote: null,
    verificationUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
    legalName: null,
    timezone: 'Asia/Kolkata',
    refundPolicy: 'Refunds up to 48 hours before the event.',
    suspendedAt: null,
    suspendedReason: null,
    payoutCurrency: 'INR',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  }

  const otherOrganization = {
    ...organization,
    id: cuid(),
    name: 'Dhol Nation',
    slug: 'dhol-nation',
    contactEmail: 'hello@dhol.example',
  }

  const venue = {
    id: cuid(),
    name: 'Nehru Centre',
    addressLine1: '1 Worli Sea Face',
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400018',
    country: 'IN',
    // A shared venue: `organizationId` is null, so only platform staff may edit
    // it. The organisation-owned case is built by the tests that need it.
    slug: 'nehru-centre',
    organizationId: null,
    description: null,
    timezone: 'Asia/Kolkata',
    directions: null,
    policies: null,
    accessibility: { features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET'], note: null },
    provenance: 'moderator',
    mergedIntoVenueId: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  }

  const otherVenue = {
    ...venue,
    id: cuid(),
    name: 'Phoenix Hall',
    slug: 'phoenix-hall',
    city: 'Pune',
    accessibility: { features: ['HEARING_LOOP'], note: null },
  }

  /**
   * Build a user row.
   *
   * @param {string} email The address.
   * @param {string} displayName The display name.
   * @param {string} role The platform `UserRole`.
   * @returns {object} A `User` row.
   */
  const user = (email, displayName, role = 'ATTENDEE') => ({
    id: cuid(),
    email,
    passwordHash: hash,
    displayName,
    phone: null,
    locale: 'en-IN',
    role,
    emailVerified: true,
    createdAt: new Date('2025-01-02T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
  })

  const attendee = user('priya@example.com', 'Priya Sharma')
  const manager = user('arun@rangoli.example', 'Arun Rao', 'ORGANIZER')
  const staff = user('door@rangoli.example', 'Door Staff', 'ORGANIZER')
  const viewer = user('finance@rangoli.example', 'Finance', 'ORGANIZER')
  const outsider = user('rival@dhol.example', 'Rival Organiser', 'ORGANIZER')
  const platformAdmin = user('ops@desi-event.example', 'Platform Ops', 'SUPER_ADMIN')
  // Cancelling and archiving are ADMIN and OWNER only — a MANAGER can publish
  // but may not call off something people have paid for. The world needs an
  // owner to exercise that half of the lifecycle.
  const owner = user('owner@rangoli.example', 'Meera Owner', 'ORGANIZER')
  // A platform moderator, with no membership anywhere. Moderation is authority
  // over the platform's listings and not over any one organisation's, and an
  // account that holds both would prove nothing about which one was doing the
  // work.
  const moderator = user('maya@desi-event.example', 'Maya Moderator', 'MODERATOR')

  /**
   * Build a membership row.
   *
   * @param {object} member The user.
   * @param {object} org The organisation.
   * @param {string} role The `OrgRole`.
   * @returns {object} A `Membership` row.
   */
  const membership = (member, org, role) => ({
    id: cuid(),
    userId: member.id,
    organizationId: org.id,
    role,
    createdAt: new Date('2025-01-02T00:00:00.000Z'),
  })

  const publishedEvent = {
    id: cuid(),
    organizationId: organization.id,
    venueId: venue.id,
    title: 'Navratri Garba Night',
    slug: 'navratri-garba-night',
    summary: 'Nine nights of garba and dandiya in Mumbai.',
    description: 'A full description of the garba night, with live dhol and a food court.',
    category: 'GARBA_DANDIYA',
    status: 'PUBLISHED',
    startsAt: minutesFromNow(60 * 24 * 30),
    endsAt: minutesFromNow(60 * 24 * 30 + 300),
    timezone: 'Asia/Kolkata',
    coverImageUrl: null,
    isOnline: false,
    onlineUrl: null,
    languages: ['Gujarati', 'Hindi'],
    publishedAt: new Date('2025-02-01T00:00:00.000Z'),
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
    // Publication refuses an event with no entry, refund and conduct rules,
    // because they are snapshotted onto every order and a buyer has to have
    // agreed to something.
    policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    // The authoring editor's optimistic-concurrency precondition. Seeded rows
    // bypass the stub's column defaults, so it is spelled here.
    revision: 0,
  }

  const draftEvent = {
    ...publishedEvent,
    id: cuid(),
    title: 'Secret Bollywood Night',
    slug: 'secret-bollywood-night',
    summary: 'Not announced yet.',
    category: 'BOLLYWOOD_NIGHT',
    status: 'DRAFT',
    publishedAt: null,
    startsAt: minutesFromNow(60 * 24 * 60),
    endsAt: minutesFromNow(60 * 24 * 60 + 240),
  }

  // Three events in states a stranger must never see. Finding NF-19 was that
  // only DRAFT was checked, so everything between "submitted" and "published"
  // — including a rejection, which is somebody being told no — was served to
  // anonymous callers in full.
  const reviewPendingEvent = {
    ...publishedEvent,
    id: cuid(),
    title: 'Awaiting A Moderator',
    slug: 'awaiting-a-moderator',
    summary: 'Submitted, not yet ruled on.',
    status: 'REVIEW_PENDING',
    publishedAt: null,
    reviewSubmittedAt: new Date('2025-02-02T00:00:00.000Z'),
    startsAt: minutesFromNow(60 * 24 * 70),
    endsAt: minutesFromNow(60 * 24 * 70 + 240),
  }

  const rejectedEvent = {
    ...publishedEvent,
    id: cuid(),
    title: 'Turned Down',
    slug: 'turned-down',
    summary: 'A moderator said no.',
    status: 'REJECTED',
    publishedAt: null,
    moderationNote: 'Internal note a stranger must never read.',
    startsAt: minutesFromNow(60 * 24 * 80),
    endsAt: minutesFromNow(60 * 24 * 80 + 240),
  }

  const approvedEvent = {
    ...publishedEvent,
    id: cuid(),
    title: 'Approved Not Published',
    slug: 'approved-not-published',
    summary: 'Cleared by a moderator; the organiser has not gone live.',
    status: 'APPROVED',
    publishedAt: null,
    startsAt: minutesFromNow(60 * 24 * 90),
    endsAt: minutesFromNow(60 * 24 * 90 + 240),
  }

  const onlineEvent = {
    ...publishedEvent,
    id: cuid(),
    title: 'Classical Dance Masterclass',
    slug: 'classical-dance-masterclass',
    summary: 'A streamed bharatanatyam masterclass.',
    description: 'Two hours of adavu drills and abhinaya, streamed live from Pune.',
    category: 'CLASSICAL_DANCE',
    venueId: otherVenue.id,
    isOnline: true,
    onlineUrl: 'https://stream.example.com/masterclass',
    organizationId: otherOrganization.id,
    startsAt: minutesFromNow(60 * 24 * 10),
    endsAt: minutesFromNow(60 * 24 * 10 + 120),
  }

  const generalAdmission = {
    id: cuid(),
    eventId: publishedEvent.id,
    name: 'General Admission',
    description: 'Standing.',
    priceCents: 150_000,
    currency: 'INR',
    quantityTotal: 10,
    quantitySold: 0,
    minPerOrder: 1,
    maxPerOrder: 4,
    salesStartAt: null,
    salesEndAt: null,
    status: 'ON_SALE',
    sortOrder: 0,
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
  }

  const vip = {
    ...generalAdmission,
    id: cuid(),
    name: 'VIP Table',
    description: 'Seated, with dinner.',
    priceCents: 500_000,
    quantityTotal: 4,
    maxPerOrder: 2,
    sortOrder: 1,
  }

  const pausedTier = {
    ...generalAdmission,
    id: cuid(),
    name: 'Early Bird',
    priceCents: 90_000,
    quantityTotal: 5,
    status: 'PAUSED',
    sortOrder: 2,
  }

  const draftTier = {
    ...generalAdmission,
    id: cuid(),
    eventId: draftEvent.id,
    name: 'Draft Tier',
    status: 'DRAFT',
  }

  const promoCode = {
    id: cuid(),
    organizationId: organization.id,
    eventId: publishedEvent.id,
    code: 'GARBA10',
    type: 'PERCENTAGE',
    value: 1000,
    maxRedemptions: null,
    redemptionCount: 0,
    startsAt: null,
    endsAt: null,
    active: true,
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
  }

  /**
   * One general-admission session per event.
   *
   * Publication refuses an event with no session, which is right: an event
   * nobody can attend on any date is not an event. Every fixture event gets a
   * plain GA session so the suites are about the thing they are testing rather
   * than about the fixture being incomplete.
   *
   * @param {object} event The event the session belongs to.
   * @returns {object} The session row.
   */
  function sessionFor(event) {
    return {
      id: cuid(),
      eventId: event.id,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      doorsOpenAt: null,
      timezone: event.timezone,
      salesStartAt: null,
      salesEndAt: null,
      status: 'SCHEDULED',
      venueMapVersionId: null,
      capacity: 500,
      sortOrder: 0,
      createdAt: new Date('2025-02-01T00:00:00.000Z'),
      updatedAt: new Date('2025-02-01T00:00:00.000Z'),
    }
  }

  const seed = {
    user: [attendee, owner, manager, staff, viewer, outsider, platformAdmin, moderator],
    membership: [
      membership(owner, organization, 'OWNER'),
      membership(manager, organization, 'MANAGER'),
      membership(staff, organization, 'STAFF'),
      membership(viewer, organization, 'VIEWER'),
      membership(outsider, otherOrganization, 'OWNER'),
    ],
    organization: [organization, otherOrganization],
    venue: [venue, otherVenue],
    event: [
      publishedEvent,
      draftEvent,
      reviewPendingEvent,
      rejectedEvent,
      approvedEvent,
      onlineEvent,
    ],
    eventSession: [
      publishedEvent,
      draftEvent,
      reviewPendingEvent,
      rejectedEvent,
      approvedEvent,
      onlineEvent,
    ].map(sessionFor),
    ticketType: [generalAdmission, vip, pausedTier, draftTier],
    promoCode: [promoCode],
    // The chart of accounts, which a migration creates in a real database. The
    // ids are the literal ones from that migration, so a fixture and a
    // deployment name the same rows and the service's account cache is valid
    // across both.
    ledgerAccount: LEDGER_ACCOUNTS.map((account) => ({ ...account, createdAt: new Date() })),
  }

  for (const [model, rows] of Object.entries(overrides)) {
    seed[model] = [...(seed[model] ?? []), ...rows]
  }

  return {
    seed,
    ids: {
      organization,
      otherOrganization,
      venue,
      otherVenue,
      attendee,
      owner,
      manager,
      staff,
      viewer,
      outsider,
      platformAdmin,
      moderator,
      publishedEvent,
      draftEvent,
      reviewPendingEvent,
      rejectedEvent,
      approvedEvent,
      onlineEvent,
      generalAdmission,
      vip,
      pausedTier,
      draftTier,
      promoCode,
    },
  }
}
