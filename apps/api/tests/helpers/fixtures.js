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

import { cuid } from './prisma-stub.js'

/** The password every seeded user signs in with. */
export const PASSWORD = 'correct-horse-battery'

/**
 * Hashed once. bcrypt at cost 10 is deliberately slow and every suite seeds
 * six users, so the *promise* is cached rather than the value: two callers
 * racing before the first resolves share one hash instead of computing two.
 *
 * @type {Promise<string>|null}
 */
let cachedHash = null

/**
 * The bcrypt hash of {@link PASSWORD}.
 *
 * @returns {Promise<string>} The hash.
 */
export function passwordHash() {
  cachedHash ??= bcrypt.hash(PASSWORD, 10)
  return cachedHash
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
    verified: true,
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
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  }

  const otherVenue = { ...venue, id: cuid(), name: 'Phoenix Hall', city: 'Pune' }

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

  const seed = {
    user: [attendee, manager, staff, viewer, outsider, platformAdmin],
    membership: [
      membership(manager, organization, 'MANAGER'),
      membership(staff, organization, 'STAFF'),
      membership(viewer, organization, 'VIEWER'),
      membership(outsider, otherOrganization, 'OWNER'),
    ],
    organization: [organization, otherOrganization],
    venue: [venue, otherVenue],
    event: [publishedEvent, draftEvent, onlineEvent],
    ticketType: [generalAdmission, vip, pausedTier, draftTier],
    promoCode: [promoCode],
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
      manager,
      staff,
      viewer,
      outsider,
      platformAdmin,
      publishedEvent,
      draftEvent,
      onlineEvent,
      generalAdmission,
      vip,
      pausedTier,
      draftTier,
      promoCode,
    },
  }
}
