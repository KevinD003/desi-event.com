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
  issueToken,
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

export const LEDGER_ACCOUNTS = Object.freeze([
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

  // An organisation made from the site before organisers joined by invitation:
  // never verified, no members of its own in this world. Kept so the
  // verification flow, which grandfathered organisations still use, has one.
  const grandfatheredOrganization = {
    ...organization,
    id: cuid(),
    name: 'Saffron Steps',
    slug: 'saffron-steps',
    contactEmail: 'hello@saffron.example',
    verified: false,
    verificationStatus: 'UNVERIFIED',
    verificationUpdatedAt: null,
    refundPolicy: null,
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
  // The platform administrator (ADMIN): invites organisers, reviews, switches
  // website links and reads every event's figures. No membership anywhere, and
  // not `platformAdmin` above, which is the SUPER_ADMIN. Privileged, so the
  // harness gives it a confirmed second factor like every other staff account.
  const platformAdministrator = user('anil@desi-event.example', 'Anil Administrator', 'ADMIN')

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
    isOnline: false,
    onlineUrl: null,
    languages: ['Gujarati', 'Hindi'],
    publishedAt: new Date('2025-02-01T00:00:00.000Z'),
    // Spelled out because seeded rows bypass the stub's defaults, and a query
    // for events that are not cancelled asks for exactly this column to be null.
    cancelledAt: null,
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
    // Publication refuses an event with no entry, refund and conduct rules,
    // because they are snapshotted onto every order and a buyer has to have
    // agreed to something.
    policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    // The authoring editor's optimistic-concurrency precondition. Seeded rows
    // bypass the stub's column defaults, so it is spelled here.
    revision: 0,
    // The website link: no address and the switch off, as the database's
    // defaults leave a new row. Spelled out for the same reason as `revision`.
    websiteUrl: null,
    websiteRedirectEnabled: false,
    websiteDecidedUrl: null,
    websiteDecisionPending: false,
    websiteSubmittedAt: null,
    websiteRedirectChangedAt: null,
    websiteRedirectChangedById: null,
    websiteRedirectReason: null,
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
    // NOT NULL with a default in the schema; seeded rows bypass the stub's
    // defaults, so it is spelled here and inherited by the tiers below.
    visibility: 'PUBLIC',
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

  // Door staff admit only where a scope says so. The published event is the
  // one every door test scans at; the manager deliberately has no scope, so the
  // world holds a door role that the policy refuses as well as one it admits.
  const staffMembership = membership(staff, organization, 'STAFF')

  const seed = {
    user: [
      attendee,
      owner,
      manager,
      staff,
      viewer,
      outsider,
      platformAdmin,
      moderator,
      platformAdministrator,
    ],
    membership: [
      membership(owner, organization, 'OWNER'),
      membership(manager, organization, 'MANAGER'),
      staffMembership,
      membership(viewer, organization, 'VIEWER'),
      membership(outsider, otherOrganization, 'OWNER'),
    ],
    scannerScope: [
      {
        id: cuid(),
        membershipId: staffMembership.id,
        eventId: publishedEvent.id,
        createdAt: new Date('2025-02-01T00:00:00.000Z'),
      },
    ],
    organization: [organization, otherOrganization, grandfatheredOrganization],
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
      grandfatheredOrganization,
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
      platformAdministrator,
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

/** How long an organiser invitation lasts: fourteen days, like a team invitation. */
const ORGANIZER_INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000

/**
 * A waiting organiser invitation row, and the code that opens it.
 *
 * The code is made at run time and only its digest goes into the row, as the
 * issuing route stores it: no code is written into the repository, and a test
 * that needs to accept the invitation types the code it was handed here.
 *
 * @param {object} options What the invitation is.
 * @param {string} options.invitedById The inviting administrator's user id.
 * @param {string} [options.email] The recipient's address, stored lower-cased.
 * @param {string} [options.organizationName] The organisation it starts.
 * @param {object} [options.overrides] Any other column.
 * @returns {{row: object, code: string}} The row to seed, and the code.
 */
export function organizerInvitationFixture({
  invitedById,
  email = 'new-organiser@example.com',
  organizationName = 'Kathiawar Folk Nights',
  ...overrides
}) {
  const { secret, hash } = issueToken()
  const createdAt = new Date()

  return {
    code: secret,
    row: {
      id: cuid(),
      email: email.toLowerCase(),
      organizationName,
      organizationDescription: null,
      organizationWebsiteUrl: null,
      note: null,
      organizationId: null,
      tokenHash: hash,
      invitedById,
      status: 'PENDING',
      deliveryMode: 'MANUAL',
      expiresAt: new Date(createdAt.getTime() + ORGANIZER_INVITATION_LIFETIME_MS),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      revokedById: null,
      supersedesId: null,
      createdAt,
      ...overrides,
    },
  }
}

// ---------------------------------------------------------------------------
// SPEC2-XI §4.9: full control of posted events and the Sulekha import.
//
// Not in the default world. Each builder takes the world's ids and returns the
// rows to add (`addRows(seed, fixture.rows)`) and the ones a test asserts
// against, so the suites that count events, orders or organisations see the
// world they were written for, and the ones about deletion, nights and imports
// opt in to exactly the rows they need.
// ---------------------------------------------------------------------------

/** A reason of the length every SPEC2-XI reason box asks for (10-500 characters). */
const FIXTURE_REASON = 'The venue withdrew the booking before any ticket was sold.'

/**
 * Append fixture rows to a world's seed, model by model.
 *
 * @param {object} seed `makeWorld().seed`.
 * @param {Record<string, object[]>} rows Rows keyed by model.
 * @returns {object} The same seed.
 */
export function addRows(seed, rows) {
  for (const [model, list] of Object.entries(rows)) {
    seed[model] = [...(seed[model] ?? []), ...list]
  }

  return seed
}

/**
 * One general-admission night of an event.
 *
 * @param {object} event The event.
 * @param {object} [overrides] Column overrides.
 * @returns {object} An `EventSession` row with every column spelled out.
 */
function nightOf(event, overrides = {}) {
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
    label: null,
    cancelledAt: null,
    cancellationReason: null,
    endTimeListed: true,
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
    ...overrides,
  }
}

/**
 * A deleted event: deleted from ON_SALE with outcome REMOVED, its slug kept
 * retired (it was public), as `lib/event-deletion.js` leaves one. The columns
 * satisfy `event_deletion_consistency`.
 *
 * @param {object} ids `makeWorld().ids`.
 * @param {object} [options] Options.
 * @param {object} [options.deletedBy] Who deleted it; the organisation's owner by default.
 * @param {'ORGANIZATION'|'PLATFORM'} [options.authority] Whose authority.
 * @param {object} [options.overrides] Event column overrides.
 * @returns {object} `{rows, event, session}`: the rows keyed by model, and the two named.
 */
export function deletedEventFixture(
  ids,
  { deletedBy = ids.owner, authority = 'ORGANIZATION', overrides = {} } = {},
) {
  const event = {
    ...ids.publishedEvent,
    id: cuid(),
    title: 'Diwali Mela on the Lawn',
    slug: 'diwali-mela-on-the-lawn',
    summary: 'Stalls, lights and a dance floor under the stars.',
    status: 'DELETED',
    publishedAt: new Date('2025-02-03T00:00:00.000Z'),
    startsAt: minutesFromNow(60 * 24 * 45),
    endsAt: minutesFromNow(60 * 24 * 45 + 240),
    revision: 3,
    deletedAt: new Date('2025-03-01T00:00:00.000Z'),
    deletedById: deletedBy.id,
    deletionReason: FIXTURE_REASON,
    deletionOutcome: 'REMOVED',
    deletionAuthority: authority,
    statusBeforeDeletion: 'ON_SALE',
    deletedSlug: null,
    ...overrides,
  }
  const session = nightOf(event)

  return { rows: { event: [event], eventSession: [session] }, event, session }
}

/**
 * A paid order of one line, its payment and its tickets, as settlement leaves
 * them.
 *
 * @param {object} options What the order is.
 * @param {object} options.event The event.
 * @param {object} options.tier The ticket type bought.
 * @param {object} options.buyer The buying user.
 * @param {string|null} options.eventSessionId The night, for a single-night order.
 * @param {number} options.quantity Tickets.
 * @param {string} options.reference The order reference.
 * @returns {{order: object, item: object, payment: object, tickets: object[]}} The rows.
 */
function paidOrderRows({ event, tier, buyer, eventSessionId, quantity, reference }) {
  const paidAt = new Date('2025-02-10T10:00:00.000Z')
  const totalCents = tier.priceCents * quantity
  const order = {
    id: cuid(),
    reference,
    idempotencyKey: null,
    eventId: event.id,
    eventSessionId,
    userId: buyer.id,
    buyerEmail: buyer.email,
    buyerName: buyer.displayName,
    status: 'PAID',
    currency: tier.currency,
    subtotalCents: totalCents,
    discountCents: 0,
    feesCents: 0,
    taxCents: 0,
    totalCents,
    promoCodeId: null,
    refundedCents: 0,
    refundPendingCents: 0,
    expiresAt: null,
    paidAt,
    cancelledAt: null,
    createdAt: paidAt,
    updatedAt: paidAt,
  }
  const item = {
    id: cuid(),
    orderId: order.id,
    ticketTypeId: tier.id,
    quantity,
    unitPriceCents: tier.priceCents,
    subtotalCents: totalCents,
    refundedQuantity: 0,
    refundedCents: 0,
    attendeeNames: [],
  }
  const payment = {
    id: cuid(),
    orderId: order.id,
    provider: 'in-memory-payments',
    providerRef: `pi_${reference.toLowerCase().replace(/[^a-z0-9]/gu, '')}`,
    status: 'SUCCEEDED',
    amountCents: totalCents,
    currency: tier.currency,
    createdAt: paidAt,
    updatedAt: paidAt,
  }
  const tickets = Array.from({ length: quantity }, (_, index) => ({
    id: cuid(),
    orderItemId: item.id,
    code: `${reference}-${index + 1}`,
    credentialHash: `${reference.toLowerCase()}-credential-${index + 1}`,
    credentialVersion: 1,
    credentialIssuedAt: paidAt,
    attendeeName: null,
    ownerUserId: buyer.id,
    eventSeatId: null,
    status: 'VALID',
    checkedInAt: null,
    revokedAt: null,
    revokedReason: null,
    supersedesTicketId: null,
    createdAt: paidAt,
    updatedAt: paidAt,
  }))

  return { order, item, payment, tickets }
}

/**
 * A live three-night event of the world's organisation: a tier per night, an
 * every-night pass, a paid order per night and one for the pass, all bought
 * by the world's attendee.
 *
 * @param {object} ids `makeWorld().ids`.
 * @param {object} [options] Options.
 * @param {object} [options.overrides] Event column overrides.
 * @returns {object} `{rows, event, nights, tiers, pass, orders, passOrder}`: the rows keyed by model, and the ones a test names.
 */
export function threeNightEventFixture(ids, { overrides = {} } = {}) {
  const firstNight = minutesFromNow(60 * 24 * 20)
  const event = {
    ...ids.publishedEvent,
    id: cuid(),
    title: 'Navratri Nights at the Pavilion',
    slug: 'navratri-nights-at-the-pavilion',
    summary: 'Three nights of garba with a live band.',
    status: 'ON_SALE',
    publishedAt: new Date('2025-02-05T00:00:00.000Z'),
    salesOpenedAt: new Date('2025-02-06T00:00:00.000Z'),
    startsAt: firstNight,
    endsAt: new Date(firstNight.getTime() + 2 * 86_400_000 + 4 * 3_600_000),
    ...EVENT_DELETION_FIXTURE_COLUMNS,
    ...overrides,
  }
  const nights = [0, 1, 2].map((day) => {
    const startsAt = new Date(firstNight.getTime() + day * 86_400_000)

    return nightOf(event, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      sortOrder: day,
      label: `Night ${day + 1}`,
    })
  })
  const tier = (name, eventSessionId, sortOrder) => ({
    id: cuid(),
    eventId: event.id,
    eventSessionId,
    priceZoneId: null,
    reserved: false,
    complimentary: false,
    name,
    description: null,
    priceCents: 80_000,
    currency: 'INR',
    quantityTotal: 50,
    quantitySold: 1,
    minPerOrder: 1,
    maxPerOrder: 4,
    salesStartAt: null,
    salesEndAt: null,
    status: 'ON_SALE',
    sortOrder,
    visibility: 'PUBLIC',
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
  })
  const tiers = nights.map((night, index) => tier(`Night ${index + 1}`, night.id, index))
  const pass = { ...tier('Every night', null, 3), priceCents: 200_000 }
  const bought = [
    ...tiers.map((nightTier, index) =>
      paidOrderRows({
        event,
        tier: nightTier,
        buyer: ids.attendee,
        eventSessionId: nights[index].id,
        quantity: 1,
        reference: `DE-3N0${index + 1}`,
      }),
    ),
    paidOrderRows({
      event,
      tier: pass,
      buyer: ids.attendee,
      eventSessionId: null,
      quantity: 1,
      reference: 'DE-3NPASS',
    }),
  ]

  return {
    rows: {
      event: [event],
      eventSession: nights,
      ticketType: [...tiers, pass],
      order: bought.map((rows) => rows.order),
      orderItem: bought.map((rows) => rows.item),
      payment: bought.map((rows) => rows.payment),
      ticket: bought.flatMap((rows) => rows.tickets),
    },
    event,
    nights,
    tiers,
    pass,
    orders: bought.slice(0, 3).map((rows) => rows.order),
    passOrder: bought[3].order,
  }
}

/** The deletion columns of an event nobody has deleted. */
const EVENT_DELETION_FIXTURE_COLUMNS = Object.freeze({
  deletedAt: null,
  deletedById: null,
  deletionReason: null,
  deletionOutcome: null,
  deletionAuthority: null,
  statusBeforeDeletion: null,
  deletedSlug: null,
})

/** The Sulekha listing the import fixture copies. */
const FIXTURE_LISTING = Object.freeze({
  sourceId: '402059',
  sourceUrl: 'https://events.sulekha.com/navratri-dandiya-night_event-in_irving-tx_402059',
  imageUrl: 'https://usimg.sulekha.io/cdn/events/images/navratri-dandiya-night-cover.webp',
})

/**
 * The platform-held organisation "Sulekha Events" with one imported event, as
 * an import run leaves them: VERIFIED, no member, `platformHeldSource` SULEKHA;
 * the event's one night has no listed end (stored as start + 3 hours); its
 * import record carries the listed prices and the curator's notes; its cover
 * is still waiting to be copied.
 *
 * @param {object} ids `makeWorld().ids`.
 * @param {object} [options] Options.
 * @param {string} [options.status] The imported event's status; REVIEW_PENDING by default.
 * @param {object} [options.importedBy] The importing administrator; the world's ADMIN by default.
 * @returns {object} `{rows, organization, venue, event, session, run, item, image}`: the rows keyed by model, and the ones a test names.
 */
export function platformHeldImportFixture(
  ids,
  { status = 'REVIEW_PENDING', importedBy = ids.platformAdministrator } = {},
) {
  const created = new Date('2026-09-30T12:00:00.000Z')
  const organization = {
    ...ids.organization,
    id: cuid(),
    name: 'Sulekha Events',
    slug: 'sulekha-events',
    description:
      'Events listed on Sulekha.com and shown on Desi-Event by the Desi-Event team. Each event page names the organiser who runs it. Tickets for these events are sold on Sulekha.',
    contactEmail: 'imports@desi-event.example',
    websiteUrl: null,
    verified: true,
    verificationStatus: 'VERIFIED',
    verificationNote: 'Held by the Desi-Event team for imported events',
    verificationUpdatedAt: created,
    refundPolicy: null,
    payoutCurrency: 'USD',
    timezone: 'America/Chicago',
    createdById: null,
    platformHeldSource: 'SULEKHA',
    createdAt: created,
    updatedAt: created,
  }
  const venue = {
    ...ids.venue,
    id: cuid(),
    name: 'Irving Convention Center',
    addressLine1: '500 W Las Colinas Blvd',
    city: 'Irving',
    region: 'TX',
    postalCode: '75039',
    country: 'US',
    slug: null,
    timezone: 'America/Chicago',
    accessibility: null,
    provenance: 'import:sulekha',
    organizationId: organization.id,
  }
  const startsAt = minutesFromNow(60 * 24 * 12)
  // No listed end: start + 3 hours, never shown (SPEC2-XI §0.9).
  const endsAt = new Date(startsAt.getTime() + 3 * 3_600_000)
  const event = {
    ...ids.publishedEvent,
    ...EVENT_DELETION_FIXTURE_COLUMNS,
    id: cuid(),
    organizationId: organization.id,
    venueId: venue.id,
    title: 'Navratri Dandiya Night in Irving',
    slug: 'navratri-dandiya-night-in-irving',
    summary: 'A night of dandiya and garba with a live band.',
    description: 'Dandiya and garba until late, with a live band and food stalls.',
    status,
    publishedAt: null,
    reviewSubmittedAt: created,
    startsAt,
    endsAt,
    timezone: 'America/Chicago',
    languages: ['Gujarati', 'Hindi'],
    policies: {
      entry: 'Entry is run by the organiser. Check the Sulekha listing for their rules.',
      refund:
        "Tickets for this event are sold on Sulekha, not on Desi-Event. Refunds follow Sulekha's and the organiser's terms.",
      conduct: "The organiser's and the venue's rules apply.",
    },
    websiteUrl: FIXTURE_LISTING.sourceUrl,
    websiteDecisionPending: true,
    websiteSubmittedAt: created,
    createdAt: created,
    updatedAt: created,
  }
  const session = nightOf(event, { endTimeListed: false, timezone: 'America/Chicago' })
  const run = {
    id: cuid(),
    source: 'SULEKHA',
    status: 'APPLIED',
    fileName: 'sulekha-texas-2026.json',
    datasetSha256: 'a'.repeat(64),
    dataset: { format: 'desi-event-import/1', source: 'SULEKHA' },
    plan: [{ sourceId: FIXTURE_LISTING.sourceId, action: 'CREATE' }],
    planDigest: 'b'.repeat(64),
    eventCount: 1,
    createdById: importedBy.id,
    createdAt: created,
    expiresAt: new Date(created.getTime() + 3_600_000),
    appliedAt: created,
    appliedById: importedBy.id,
    summary: { created: 1 },
  }
  const item = {
    id: cuid(),
    source: 'SULEKHA',
    sourceId: FIXTURE_LISTING.sourceId,
    sourceUrl: FIXTURE_LISTING.sourceUrl,
    eventId: event.id,
    lastRunId: run.id,
    importedById: importedBy.id,
    importedAt: created,
    lastSyncedAt: created,
    scrapedAt: new Date('2026-09-29T21:25:00.000Z'),
    presentedBy: 'DFW Garba Collective',
    prices: [
      { name: 'Early Bird', priceCents: 2000, currency: 'USD', note: null },
      { name: 'Child', priceCents: 0, currency: 'USD', note: 'Under 5' },
    ],
    priceText: '$20',
    importNotes: ['Sulekha lists this event twice (402059 and 402060); only 402059 is imported.'],
    approvedById: null,
    approvedAt: null,
    reassignedAt: null,
    reassignedById: null,
    reassignedFromOrganizationId: null,
    reassignedToOrganizationId: null,
  }
  const image = {
    id: cuid(),
    itemId: item.id,
    url: FIXTURE_LISTING.imageUrl,
    role: 'COVER',
    alt: 'Navratri Dandiya Night in Irving poster',
    position: 0,
    status: 'WAITING',
    failureCode: null,
    attempts: 0,
    lastTriedAt: null,
    mediaAssetId: null,
  }

  return {
    rows: {
      organization: [organization],
      venue: [venue],
      event: [event],
      eventSession: [session],
      eventImportRun: [run],
      eventImportItem: [item],
      eventImportImage: [image],
    },
    organization,
    venue,
    event,
    session,
    run,
    item,
    image,
  }
}

// ---------------------------------------------------------------------------
// SPEC3 §4.7: booking fees, referral codes and paying at the venue.
//
// Not in the default world, for the reason SPEC2-XI's builders are not: the
// suites that count the team, the door's people or the platform's staff see
// the world they were written for, and the ones about the booking fee, the
// referral codes and the door opt in (`addRows(seed, fixture.rows)`).
// ---------------------------------------------------------------------------

/**
 * The accounts SPEC3's suites need beside the default world's ADMIN
 * (`anil@desi-event.example`) and SUPER_ADMIN (`ops@desi-event.example`):
 *
 *   - a FINANCE_ADMIN, `farah-finance@desi-event.example`, who refunds a
 *     booking fee by hand (`platform_fee:refund`) and sets nothing;
 *   - a FINANCE member of the first organisation, who reads its payments at
 *     the venue (`finance:view`);
 *   - a SCANNER of the first organisation with a scope on the published event,
 *     who takes payments at its door (authority `EVENT_SCOPE`);
 *   - a platform ADMIN who is also a member of the first organisation, whom
 *     the booking fee, the switch and a fee refund refuse with 403
 *     `CONFLICT_OF_INTEREST`.
 *
 * The staff accounts are privileged, so the harness gives them a confirmed
 * second factor like every other (`enrolPrivilegedUsers`).
 *
 * @param {object} ids `makeWorld().ids`.
 * @returns {{rows: Record<string, object[]>, financeAdministrator: object, organizationFinance: object, scanner: object, scannerMembership: object, memberAdministrator: object}} The rows to add, and the accounts.
 */
export function paymentTermsAccountsFixture(ids) {
  const createdAt = new Date('2025-01-02T00:00:00.000Z')
  const user = (email, displayName, role) => ({
    id: cuid(),
    email,
    passwordHash: ids.attendee.passwordHash,
    displayName,
    phone: null,
    locale: 'en-IN',
    role,
    emailVerified: true,
    createdAt,
    updatedAt: createdAt,
  })
  const membership = (member, role) => ({
    id: cuid(),
    userId: member.id,
    organizationId: ids.organization.id,
    role,
    createdAt,
  })

  const financeAdministrator = user(
    'farah-finance@desi-event.example',
    'Farah Finance',
    'FINANCE_ADMIN',
  )
  const organizationFinance = user('fatima-finance@rangoli.example', 'Fatima Finance', 'ORGANIZER')
  const scanner = user('sam-scanner@rangoli.example', 'Sam Scanner', 'ORGANIZER')
  const memberAdministrator = user('neha-admin@desi-event.example', 'Neha Administrator', 'ADMIN')
  const scannerMembership = membership(scanner, 'SCANNER')

  return {
    rows: {
      user: [financeAdministrator, organizationFinance, scanner, memberAdministrator],
      membership: [
        membership(organizationFinance, 'FINANCE'),
        scannerMembership,
        membership(memberAdministrator, 'VIEWER'),
      ],
      scannerScope: [
        {
          id: cuid(),
          membershipId: scannerMembership.id,
          eventId: ids.publishedEvent.id,
          createdAt,
        },
      ],
    },
    financeAdministrator,
    organizationFinance,
    scanner,
    scannerMembership,
    memberAdministrator,
  }
}
