#!/usr/bin/env node
/**
 * Idempotent development seed for Desi-Event.
 *
 * Running this twice must leave the database in exactly the same shape as
 * running it once, so every write is an `upsert` keyed on a natural unique
 * column (`User.email`, `Organization.slug`, `Event.slug`, `Order.reference`,
 * `Ticket.code`, `Payment[provider, providerRef]`, …). Models that have no
 * natural key — `Venue`, `TicketType`, `OrderItem`, `TicketHold`, `AuditLog` —
 * are keyed through {@link seedId}, which hashes a readable key such as
 * `seed-venue-lamplight-expo-hall` into a stable CUID-shaped id, so the same row is
 * targeted on every run and seeded rows are shaped like real ones. There are
 * no blind `create` calls.
 *
 * The dataset is built by {@link buildSeedData}, a pure function of "now".
 * Keeping it pure means the arithmetic (order totals, `quantitySold`, promo
 * redemption counts) can be verified by unit tests without a database, and it
 * guarantees the counters we write are derived from the orders we write rather
 * than hand-maintained alongside them.
 *
 * Usage:
 *   DATABASE_URL=postgresql://… node scripts/seed.mjs
 *
 * @module @desi-event/db/scripts/seed
 */

import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

import { config as loadDotenv } from 'dotenv'
import { hashPasswordSync } from '@desi-event/auth'

import { createPrismaClient } from '../src/index.js'

/**
 * A deterministic guest-ownership digest for a seeded hold.
 *
 * Real guest tokens are random and returned to the caller once; a seed has
 * nobody to return one to, and re-running it must not rewrite the row. Hashing
 * the order key gives a stable digest that matches no token anyone can present,
 * so seeded guest holds can only lapse or be released by an audited override.
 *
 * @param {string} key The order's stable seed key.
 * @returns {string} A hex SHA-256 digest.
 */
function seedGuestTokenHash(key) {
  return createHash('sha256').update(`seed-guest-hold:${key}`).digest('hex')
}

/**
 * Derive a stable, CUID-shaped primary key from a human-readable seed key.
 *
 * Models without a natural unique column still need the same row targeted on
 * every run, which argues for hand-written keys like `seed-venue-lamplight-expo-hall`.
 * But a literal like that is not the shape `@default(cuid())` produces, and
 * seeded rows that look different from real ones hide bugs: response
 * validation rejecting a seeded id is a failure nobody sees until the API is
 * pointed at a seeded database.
 *
 * Hashing the readable key keeps the idempotency — same key, same id, every
 * run — while producing an identifier indistinguishable in shape from one
 * Prisma generates.
 *
 * @param {string} key Stable human-readable key, e.g. `seed-venue-lamplight-expo-hall`.
 * @returns {string} A deterministic 25-character CUID-shaped identifier.
 */
function seedId(key) {
  const digest = createHash('sha256').update(key).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

// Seeding is a developer task, so `.env` at the repository root is the source
// of truth — but an explicitly exported DATABASE_URL always wins so that the
// same script can target the test database from CI.
loadDotenv({ path: path.join(REPO_ROOT, '.env'), override: false, quiet: true })

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * scrypt parameters for seeded password hashes.
 *
 * Deliberately far below what a deployment uses. The seed hashes one password
 * for every seeded account and guards nothing: at the real cost this would add a
 * second and a half of CPU and 32 MiB of working set to every run, for a
 * credential printed at the end of the same script.
 *
 * The *format* is the real one, which is the part that matters — a fresh
 * database is seeded with hashes in the current encoding rather than in Phase
 * 1's bcrypt, so nothing arrives already needing migration.
 */
const SEED_SCRYPT = Object.freeze({ N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 })

/** Shared password for every seeded account. Development only. */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'DesiEvent!2026'

/** Platform fee, mirroring `PLATFORM_FEE_BPS` / `PLATFORM_FEE_FLAT_CENTS`. */
const PLATFORM_FEE_BPS = 590
const PLATFORM_FEE_FLAT_CENTS = 99

/**
 * Tax on an order, by the country the venue is in — tax follows where the
 * supply happens, not the currency it is priced in. Mirrors the `US` entry of
 * `DEMO_TAX_POLICIES` in `@desi-event/pricing`: deliberately zero, because US
 * sales tax on admissions varies by state, county and city and cannot be one
 * national rate. A DEMO figure, not a tax determination.
 */
const TAX_BPS_BY_COUNTRY = { US: 0 }

/** US Eastern: New Jersey, New York, Pennsylvania, Georgia. */
const EASTERN = 'America/New_York'

/** US Central: Texas, Illinois. */
const CENTRAL = 'America/Chicago'

/** US Pacific: California, Washington. */
const PACIFIC = 'America/Los_Angeles'

/** How long after an event starts a seeded check-in happens. */
const CHECK_IN_AFTER_START_MINUTES = 20

/** Order statuses that consume a promo code redemption. */
const REDEEMING_STATUSES = new Set(['PAID', 'PENDING', 'REFUNDED'])

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Round the given instant down to midnight UTC.
 *
 * Event and sales-window timestamps are expressed as offsets from this anchor
 * so that re-running the seed on the same day rewrites identical values.
 *
 * @param {Date} date Any instant.
 * @returns {Date} Midnight UTC on the same calendar day.
 */
export function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/**
 * Offset an anchor instant by whole days, hours and minutes.
 *
 * @param {Date} anchor Base instant, normally midnight UTC.
 * @param {number} days Days to add; may be negative for past events.
 * @param {number} [hours] Hours to add, in UTC.
 * @param {number} [minutes] Minutes to add, in UTC.
 * @returns {Date} The offset instant.
 */
export function offset(anchor, days, hours = 0, minutes = 0) {
  return new Date(anchor.getTime() + days * DAY_MS + hours * HOUR_MS + minutes * MINUTE_MS)
}

/**
 * How far a zone's wall clock is ahead of UTC at an instant, in minutes.
 *
 * @param {Date} instant The moment to measure at.
 * @param {string} timeZone An IANA zone name.
 * @returns {number} Minutes to add to UTC to get local time; negative west of Greenwich.
 */
function zoneOffsetMinutes(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const read = (type) => Number(parts.find((part) => part.type === type)?.value)
  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  )

  return Math.round((asIfUtc - instant.getTime()) / MINUTE_MS)
}

/**
 * The instant a local wall-clock time happens, a whole number of days from
 * the anchor, in an event's own zone.
 *
 * Why not a fixed UTC hour: a 7:30 PM Eastern start is 23:30 UTC in October
 * and 00:30 UTC the next day in December, so a catalogue built on UTC hours
 * drifts by an hour every time the clocks change. The calendar day is the
 * anchor's UTC date plus `days`, which for an evening in the Americas is the
 * local date too.
 *
 * @param {Date} anchor Midnight UTC, from {@link startOfUtcDay}.
 * @param {number} days Days from the anchor; may be negative for past events.
 * @param {string} timeZone IANA zone the wall-clock time is in.
 * @param {number} hour Local hour, 0–23.
 * @param {number} [minute] Local minute.
 * @returns {Date} The UTC instant.
 */
export function localTime(anchor, days, timeZone, hour, minute = 0) {
  const day = offset(anchor, days)
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute)
  const firstGuess = new Date(wall - zoneOffsetMinutes(new Date(wall), timeZone) * MINUTE_MS)

  // One correction: the first guess can land on the other side of a
  // daylight-saving boundary, where the offset is an hour different.
  return new Date(wall - zoneOffsetMinutes(firstGuess, timeZone) * MINUTE_MS)
}

/**
 * The first day offset, at or after `days`, that falls on a given weekday.
 *
 * For the one event whose title names its day: "Peachtree Garba Saturday"
 * has to be on a Saturday whichever day the seed runs.
 *
 * @param {Date} anchor Midnight UTC.
 * @param {number} days Earliest offset in days.
 * @param {number} weekday 0 for Sunday through 6 for Saturday.
 * @returns {number} An offset between `days` and `days + 6`.
 */
export function onOrAfterWeekday(anchor, days, weekday) {
  const from = offset(anchor, days).getUTCDay()

  return days + ((weekday - from + 7) % 7)
}

/**
 * Apply a basis-point rate to an integer cent amount.
 *
 * Rounding rule: half-up on the exact product, so 10 000 cents at 590 bps is
 * 590 cents and 169 830 cents at 590 bps is 10 020 cents (10 019.97 rounded).
 * All money in this repository is integer cents; no float ever reaches the
 * database.
 *
 * @param {number} cents Integer cent amount to take a share of.
 * @param {number} bps Rate in basis points (10 000 bps = 100%).
 * @returns {number} The share, in whole cents.
 */
export function applyBps(cents, bps) {
  return Math.round((cents * bps) / 10_000)
}

/**
 * @typedef {object} SeedOrderLine
 * @property {string} ticketTypeKey Key of the ticket type being bought.
 * @property {number} quantity Number of tickets on this line.
 * @property {number} unitPriceCents Face value per ticket, integer cents.
 */

/**
 * @typedef {object} SeedPromo
 * @property {'PERCENTAGE'|'FIXED_AMOUNT'} type Discount kind.
 * @property {number} value Basis points for PERCENTAGE, cents for FIXED_AMOUNT.
 * @property {string} [currency] Required for FIXED_AMOUNT; null for PERCENTAGE.
 */

/**
 * @typedef {object} SeedOrderTotals
 * @property {number} quantity Total tickets across all lines.
 * @property {number} subtotalCents Sum of line subtotals before discount.
 * @property {number} discountCents Discount applied, never above the subtotal.
 * @property {number} feesCents Platform fee on the discounted subtotal.
 * @property {number} taxCents Tax on discounted subtotal plus fees.
 * @property {number} totalCents Amount the buyer is charged.
 */

/**
 * Compute order money columns from its lines, mirroring `@desi-event/pricing`.
 *
 * Fees are charged on the discounted subtotal (a discount reduces what the
 * platform earns, which is what the pricing contract specifies), and tax is
 * charged on the discounted subtotal plus fees.
 *
 * @param {object} input Order inputs.
 * @param {SeedOrderLine[]} input.lines Lines on the order; must be non-empty.
 * @param {SeedPromo|null} [input.promo] Promo code applied, if any.
 * @param {number} input.taxBps Tax rate in basis points.
 * @returns {SeedOrderTotals} Integer-cent totals for the order.
 * @throws {Error} If the order has no lines.
 */
export function computeSeedOrderTotals({ lines, promo = null, taxBps }) {
  if (!lines || lines.length === 0) {
    throw new Error('An order needs at least one line')
  }

  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0)
  const subtotalCents = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0)

  let discountCents = 0
  if (promo) {
    discountCents = promo.type === 'PERCENTAGE' ? applyBps(subtotalCents, promo.value) : promo.value
    discountCents = Math.min(discountCents, subtotalCents)
  }

  const discountedCents = subtotalCents - discountCents
  const feesCents = applyBps(discountedCents, PLATFORM_FEE_BPS) + PLATFORM_FEE_FLAT_CENTS * quantity
  const taxCents = applyBps(discountedCents + feesCents, taxBps)
  const totalCents = discountedCents + feesCents + taxCents

  return { quantity, subtotalCents, discountCents, feesCents, taxCents, totalCents }
}

// ---------------------------------------------------------------------------
// Static dataset
// ---------------------------------------------------------------------------

/** Users: one platform admin, the owners and staff of ten organisations, and attendees. */
const USERS = [
  {
    key: 'admin',
    email: 'admin@desi-event.example',
    displayName: 'Desi-Event Platform Admin',
    role: 'SUPER_ADMIN',
    locale: 'en-US',
    phone: '+1 201 555 0100',
    emailVerified: true,
  },
  // Mirrorwork Events, staffed on every role but VIEWER.
  {
    key: 'nisha',
    email: 'nisha.patel@mirrorwork.example',
    displayName: 'Nisha Patel',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 732 555 0111',
    emailVerified: true,
  },
  {
    key: 'rohan',
    email: 'rohan.mehta@mirrorwork.example',
    displayName: 'Rohan Mehta',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 732 555 0112',
    emailVerified: true,
  },
  {
    key: 'kavya',
    email: 'kavya.shah@mirrorwork.example',
    displayName: 'Kavya Shah',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 732 555 0113',
    emailVerified: true,
  },
  {
    key: 'dev',
    email: 'dev.trivedi@mirrorwork.example',
    displayName: 'Dev Trivedi',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 732 555 0114',
    emailVerified: false,
  },
  // Chaniya Collective, staffed on every role but ADMIN — the two together
  // cover every OrgRole.
  {
    key: 'anjali',
    email: 'anjali.desai@chaniya.example',
    displayName: 'Anjali Desai',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 713 555 0121',
    emailVerified: true,
  },
  {
    key: 'hetal',
    email: 'hetal.joshi@chaniya.example',
    displayName: 'Hetal Joshi',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 713 555 0122',
    emailVerified: true,
  },
  {
    key: 'jay',
    email: 'jay.mistry@chaniya.example',
    displayName: 'Jay Mistry',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 713 555 0123',
    emailVerified: true,
  },
  {
    key: 'accounts',
    email: 'accounts@chaniya.example',
    displayName: 'Chaniya Collective Accounts',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: null,
    emailVerified: true,
  },
  // One owner for each of the other eight organisations.
  {
    key: 'priti',
    email: 'priti.amin@lakeshore.example',
    displayName: 'Priti Amin',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 847 555 0131',
    emailVerified: true,
  },
  {
    key: 'sameer',
    email: 'sameer.bhatt@baylightsgarba.example',
    displayName: 'Sameer Bhatt',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 408 555 0132',
    emailVerified: true,
  },
  {
    key: 'meera',
    email: 'meera.pandya@peachtreeraas.example',
    displayName: 'Meera Pandya',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 404 555 0133',
    emailVerified: true,
  },
  {
    key: 'kiran',
    email: 'kiran.doshi@libertybell.example',
    displayName: 'Kiran Doshi',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 215 555 0134',
    emailVerified: true,
  },
  {
    key: 'arjun',
    email: 'arjun.nair@rainierraas.example',
    displayName: 'Arjun Nair',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 425 555 0135',
    emailVerified: true,
  },
  {
    key: 'tara',
    email: 'tara.kapadia@pacificdandiya.example',
    displayName: 'Tara Kapadia',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 562 555 0136',
    emailVerified: true,
  },
  {
    key: 'vikram',
    email: 'vikram.kothari@fiveboroughsgarba.example',
    displayName: 'Vikram Kothari',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 718 555 0137',
    emailVerified: true,
  },
  {
    key: 'riya',
    email: 'riya.thakkar@lonestarnavratri.example',
    displayName: 'Riya Thakkar',
    role: 'ORGANIZER',
    locale: 'en-US',
    phone: '+1 972 555 0138',
    emailVerified: true,
  },
  // Attendees.
  {
    key: 'aarav',
    email: 'aarav.shah@mail.example',
    displayName: 'Aarav Shah',
    role: 'ATTENDEE',
    locale: 'en-US',
    phone: '+1 201 555 0141',
    emailVerified: true,
  },
  {
    key: 'diya',
    email: 'diya.patel@mail.example',
    displayName: 'Diya Patel',
    role: 'ATTENDEE',
    locale: 'en-US',
    phone: '+1 408 555 0142',
    emailVerified: true,
  },
  {
    key: 'sneha',
    email: 'sneha.reddy@mail.example',
    displayName: 'Sneha Reddy',
    role: 'ATTENDEE',
    locale: 'en-US',
    phone: '+1 650 555 0143',
    emailVerified: true,
  },
  {
    key: 'karan',
    email: 'karan.vora@mail.example',
    displayName: 'Karan Vora',
    role: 'ATTENDEE',
    locale: 'en-US',
    phone: '+1 404 555 0144',
    emailVerified: true,
  },
  {
    key: 'ishaan',
    email: 'ishaan.gupta@mail.example',
    displayName: 'Ishaan Gupta',
    role: 'ATTENDEE',
    locale: 'en-US',
    phone: '+1 718 555 0145',
    emailVerified: true,
  },
  {
    key: 'maya',
    email: 'maya.chokshi@mail.example',
    displayName: 'Maya Chokshi',
    role: 'ATTENDEE',
    locale: 'en-US',
    phone: '+1 281 555 0146',
    emailVerified: false,
  },
]

/** Refund wording several organisers share. */
const STANDARD_REFUNDS =
  'Full refund up to seven days before the event. After that, tickets cannot be refunded but may be transferred to someone else.'

/**
 * The ten organisations of the USA catalogue. All invented, all on `.example`
 * domains, all paid out in US dollars. Mirrorwork Events and Chaniya
 * Collective carry full teams so that every OrgRole is exercised; the rest
 * have an owner each. Liberty Bell Navratri is deliberately unverified, so the
 * public pages have an organiser without a badge to show honestly.
 */
const ORGANIZATIONS = [
  {
    key: 'mirrorwork',
    id: seedId('seed-org-mirrorwork-events'),
    slug: 'mirrorwork-events',
    name: 'Mirrorwork Events',
    description:
      'Navratri nights, beginner garba classes and live-band concerts in central New Jersey.',
    contactEmail: 'hello@mirrorwork.example',
    websiteUrl: 'https://mirrorwork.example',
    verificationStatus: 'VERIFIED',
    timezone: EASTERN,
    refundPolicy: STANDARD_REFUNDS,
    members: [
      { userKey: 'nisha', role: 'OWNER' },
      { userKey: 'rohan', role: 'ADMIN' },
      { userKey: 'kavya', role: 'MANAGER' },
      { userKey: 'dev', role: 'STAFF' },
    ],
  },
  {
    key: 'chaniya',
    id: seedId('seed-org-chaniya-collective'),
    slug: 'chaniya-collective',
    name: 'Chaniya Collective',
    description:
      'Houston dancers and volunteers running dandiya nights and free children’s classes.',
    contactEmail: 'team@chaniya.example',
    websiteUrl: 'https://chaniya.example',
    verificationStatus: 'VERIFIED',
    timezone: CENTRAL,
    refundPolicy:
      'Refunds up to 72 hours before doors open. After that, tickets can be transferred but not refunded.',
    members: [
      { userKey: 'anjali', role: 'OWNER' },
      { userKey: 'hetal', role: 'MANAGER' },
      { userKey: 'jay', role: 'STAFF' },
      { userKey: 'accounts', role: 'VIEWER' },
    ],
  },
  {
    key: 'lakeshore',
    id: seedId('seed-org-lakeshore-raas'),
    slug: 'lakeshore-raas',
    name: 'Lakeshore Raas',
    description: 'Navratri garba and raas in the northwest suburbs of Chicago.',
    contactEmail: 'raas@lakeshore.example',
    websiteUrl: 'https://lakeshore.example',
    verificationStatus: 'VERIFIED',
    timezone: CENTRAL,
    refundPolicy: STANDARD_REFUNDS,
    members: [{ userKey: 'priti', role: 'OWNER' }],
  },
  {
    key: 'bay-lights',
    id: seedId('seed-org-bay-lights-garba-co'),
    slug: 'bay-lights-garba-co',
    name: 'Bay Lights Garba Co.',
    description: 'Garba and dandiya nights in the South Bay, with live bands every night.',
    contactEmail: 'tickets@baylightsgarba.example',
    websiteUrl: 'https://baylightsgarba.example',
    verificationStatus: 'VERIFIED',
    timezone: PACIFIC,
    refundPolicy:
      'Full refund up to fourteen days before the event, half the face value up to seven days before, and transfers at any time.',
    members: [{ userKey: 'sameer', role: 'OWNER' }],
  },
  {
    key: 'peachtree',
    id: seedId('seed-org-peachtree-raas-club'),
    slug: 'peachtree-raas-club',
    name: 'Peachtree Raas Club',
    description: 'A volunteer-run garba club in Atlanta, with family-friendly Navratri nights.',
    contactEmail: 'club@peachtreeraas.example',
    websiteUrl: 'https://peachtreeraas.example',
    verificationStatus: 'VERIFIED',
    timezone: EASTERN,
    refundPolicy: STANDARD_REFUNDS,
    members: [{ userKey: 'meera', role: 'OWNER' }],
  },
  {
    key: 'liberty-bell',
    id: seedId('seed-org-liberty-bell-navratri'),
    slug: 'liberty-bell-navratri',
    name: 'Liberty Bell Navratri',
    description: 'Community evenings of aarti and garba in Philadelphia.',
    contactEmail: 'navratri@libertybell.example',
    websiteUrl: 'https://libertybell.example',
    verificationStatus: 'UNVERIFIED',
    timezone: EASTERN,
    refundPolicy:
      'Refunds up to 48 hours before the event. If an event is postponed, tickets stay valid for the new date or can be refunded in full.',
    members: [{ userKey: 'kiran', role: 'OWNER' }],
  },
  {
    key: 'rainier',
    id: seedId('seed-org-rainier-raas'),
    slug: 'rainier-raas',
    name: 'Rainier Raas',
    description: 'Family garba evenings on the Eastside of Seattle.',
    contactEmail: 'hello@rainierraas.example',
    websiteUrl: 'https://rainierraas.example',
    verificationStatus: 'VERIFIED',
    timezone: PACIFIC,
    refundPolicy: STANDARD_REFUNDS,
    members: [{ userKey: 'arjun', role: 'OWNER' }],
  },
  {
    key: 'pacific',
    id: seedId('seed-org-pacific-dandiya-society'),
    slug: 'pacific-dandiya-society',
    name: 'Pacific Dandiya Society',
    description: 'Dandiya raas nights in Southern California, always to a live band.',
    contactEmail: 'society@pacificdandiya.example',
    websiteUrl: 'https://pacificdandiya.example',
    verificationStatus: 'VERIFIED',
    timezone: PACIFIC,
    refundPolicy:
      'Refunds up to ten days before the event. VIP Lounge tickets can be exchanged for general admission at any time.',
    members: [{ userKey: 'tara', role: 'OWNER' }],
  },
  {
    key: 'five-boroughs',
    id: seedId('seed-org-five-boroughs-garba'),
    slug: 'five-boroughs-garba',
    name: 'Five Boroughs Garba',
    description: 'Garba across New York City, from mela evenings to an all-night marathon.',
    contactEmail: 'info@fiveboroughsgarba.example',
    websiteUrl: 'https://fiveboroughsgarba.example',
    verificationStatus: 'VERIFIED',
    timezone: EASTERN,
    refundPolicy: STANDARD_REFUNDS,
    members: [{ userKey: 'vikram', role: 'OWNER' }],
  },
  {
    key: 'lone-star',
    id: seedId('seed-org-lone-star-navratri'),
    slug: 'lone-star-navratri',
    name: 'Lone Star Navratri',
    description: 'Navratri, Sharad Poonam and student showcase nights in Dallas–Fort Worth.',
    contactEmail: 'contact@lonestarnavratri.example',
    websiteUrl: 'https://lonestarnavratri.example',
    verificationStatus: 'VERIFIED',
    timezone: CENTRAL,
    refundPolicy:
      'Full refund up to five days before the event. If an event is cancelled, every ticket is refunded in full.',
    members: [{ userKey: 'riya', role: 'OWNER' }],
  },
]

/**
 * Venues in eleven US cities. The cities are real; the buildings, the street
 * addresses and their names are invented, which is why no venue carries
 * coordinates — a latitude for an invented building would be published in the
 * venue page's structured data as a claim about a real place.
 */
const VENUES = [
  {
    key: 'lamplight',
    slug: 'lamplight-expo-hall',
    id: seedId('seed-venue-lamplight-expo-hall'),
    name: 'Lamplight Expo Hall',
    addressLine1: '450 Festival Plaza',
    city: 'Edison',
    region: 'NJ',
    postalCode: '08837',
    capacity: 5000,
    timezone: EASTERN,
    accessibility: [
      'STEP_FREE_ENTRANCE',
      'ACCESSIBLE_TOILET',
      'ACCESSIBLE_PARKING',
      'WHEELCHAIR_SPACES',
    ],
  },
  {
    key: 'hudson',
    slug: 'hudson-riverside-pavilion',
    id: seedId('seed-venue-hudson-riverside-pavilion'),
    name: 'Hudson Riverside Pavilion',
    addressLine1: '12 Harborview Walk',
    city: 'Jersey City',
    region: 'NJ',
    postalCode: '07310',
    capacity: 900,
    timezone: EASTERN,
    accessibility: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'LIFT_ACCESS'],
  },
  {
    key: 'lantern-row',
    slug: 'lantern-row-event-hall',
    id: seedId('seed-venue-lantern-row-event-hall'),
    name: 'Lantern Row Event Hall',
    addressLine1: '8800 Lantern Row',
    city: 'Houston',
    region: 'TX',
    postalCode: '77036',
    capacity: 4000,
    timezone: CENTRAL,
    accessibility: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'ACCESSIBLE_PARKING'],
  },
  {
    key: 'trinity',
    slug: 'trinity-convention-hall',
    id: seedId('seed-venue-trinity-convention-hall'),
    name: 'Trinity Convention Hall',
    addressLine1: '2100 Garland Commons',
    city: 'Irving',
    region: 'TX',
    postalCode: '75038',
    capacity: 3500,
    timezone: CENTRAL,
    accessibility: [
      'STEP_FREE_ENTRANCE',
      'ACCESSIBLE_TOILET',
      'WHEELCHAIR_SPACES',
      'ACCESSIBLE_PARKING',
    ],
  },
  {
    key: 'lakeshore',
    slug: 'lakeshore-pavilion',
    id: seedId('seed-venue-lakeshore-pavilion'),
    name: 'Lakeshore Pavilion',
    addressLine1: '1500 Meadow Circle',
    city: 'Schaumburg',
    region: 'IL',
    postalCode: '60173',
    capacity: 3000,
    timezone: CENTRAL,
    accessibility: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET'],
  },
  {
    key: 'santa-clara',
    slug: 'santa-clara-valley-expo',
    id: seedId('seed-venue-santa-clara-valley-expo'),
    name: 'Santa Clara Valley Expo',
    addressLine1: '300 Orchard Commons',
    city: 'Santa Clara',
    region: 'CA',
    postalCode: '95054',
    capacity: 4500,
    timezone: PACIFIC,
    accessibility: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'ACCESSIBLE_PARKING', 'QUIET_SPACE'],
  },
  {
    key: 'midtown',
    slug: 'midtown-grand-hall',
    id: seedId('seed-venue-midtown-grand-hall'),
    name: 'Midtown Grand Hall',
    addressLine1: '77 Peach Blossom Ave',
    city: 'Atlanta',
    region: 'GA',
    postalCode: '30308',
    capacity: 2500,
    timezone: EASTERN,
    accessibility: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'LIFT_ACCESS'],
  },
  {
    key: 'delaware',
    slug: 'delaware-river-pavilion',
    id: seedId('seed-venue-delaware-river-pavilion'),
    name: 'Delaware River Pavilion',
    addressLine1: '40 Wharf Street',
    city: 'Philadelphia',
    region: 'PA',
    postalCode: '19106',
    capacity: 1800,
    timezone: EASTERN,
    accessibility: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET'],
  },
  {
    key: 'cedar-lane',
    slug: 'cedar-lane-hall',
    id: seedId('seed-venue-cedar-lane-hall'),
    name: 'Cedar Lane Hall',
    addressLine1: '600 Cedar Lane',
    city: 'Bellevue',
    region: 'WA',
    postalCode: '98004',
    capacity: 1200,
    timezone: PACIFIC,
    accessibility: [
      'STEP_FREE_ENTRANCE',
      'STEP_FREE_TO_SEATING',
      'ACCESSIBLE_TOILET',
      'QUIET_SPACE',
    ],
  },
  {
    key: 'cerritos',
    slug: 'cerritos-garden-pavilion',
    id: seedId('seed-venue-cerritos-garden-pavilion'),
    name: 'Cerritos Garden Pavilion',
    addressLine1: '18000 Lotus Court',
    city: 'Cerritos',
    region: 'CA',
    postalCode: '90703',
    capacity: 2200,
    timezone: PACIFIC,
    accessibility: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'ACCESSIBLE_PARKING'],
  },
  {
    key: 'queens',
    slug: 'queens-community-arena',
    id: seedId('seed-venue-queens-community-arena'),
    name: 'Queens Community Arena',
    addressLine1: '92-10 Utsav Plaza',
    city: 'Queens',
    region: 'NY',
    postalCode: '11355',
    capacity: 3000,
    timezone: EASTERN,
    accessibility: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'LIFT_ACCESS', 'WHEELCHAIR_SPACES'],
  },
]

/**
 * Events with their ticket types: the twenty-event USA catalogue the web app
 * also falls back to, plus three rows only a database needs — an online
 * workshop (a joining URL and no venue) and two drafts nobody can see yet.
 *
 * `days` is an offset in whole days from midnight UTC today, so the mix of past
 * and future events stays correct however long the repository sits unused.
 * `localStart` is the wall-clock start in the event's own `timezone`, converted
 * to UTC for that zone's offset on that date by {@link localTime} — a 7:30 PM
 * start stays 7:30 PM either side of a daylight-saving change.
 *
 * Some allocations are small on purpose. `quantitySold` is derived from the
 * orders below and nothing else, so a tier that is sold out here has to be
 * bought out by seeded orders: the Early Bird at Bay Lights Garba's opening
 * night and the whole of the Five Boroughs Garba Marathon. For the same reason
 * a tier with only a few left has to be allocated only a few: Night One's VIP
 * Circle (12) and the Nine Nights Season Pass (19) are sized so that the event
 * page's "Only N left" shows against a live database, with the same N the web
 * catalogue's fallback shows (150 less 138 sold, and 300 less 281).
 *
 * The web catalogue's seated balcony tier is not seeded. A reserved tier sells
 * named seats from a seating map and a price zone, which this seed does not
 * build; the end-to-end seeds cover reserved seating properly.
 */
const EVENTS = [
  {
    key: 'warm-up',
    id: seedId('seed-event-garba-warm-up-night-atlanta'),
    slug: 'garba-warm-up-night-atlanta',
    orgKey: 'peachtree',
    venueKey: 'midtown',
    title: 'Garba Warm-Up Night',
    summary:
      'A relaxed warm-up garba at Midtown Grand Hall before Navratri, for anyone who has not danced since last year.',
    description: [
      'Before Navratri begins, Peachtree Raas Club holds a warm-up night at Midtown Grand Hall for everyone who has not danced since last season. The music is recorded, the pace is gentle, and the evening opens with a teaching round for anyone who has forgotten which foot goes first.',
      'It is also the easiest way to meet the volunteers who run the club’s Navratri nights, ask them anything, and pick up a pair of dandiya sticks before the season starts in earnest.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'COMPLETED',
    days: -9,
    localStart: [19, 30],
    durationHours: 4,
    timezone: EASTERN,
    languages: ['Gujarati', 'English'],
    isOnline: false,
    publishedDays: -40,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'warm-up-general',
        name: 'General Admission',
        description: 'Entry for the evening, teaching round included.',
        priceCents: 1500,
        quantityTotal: 800,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -40,
        salesEndDays: -9,
        status: 'CLOSED',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'beginner-workshop',
    id: seedId('seed-event-beginner-garba-workshop-jersey-city'),
    slug: 'beginner-garba-workshop-jersey-city',
    orgKey: 'mirrorwork',
    venueKey: 'hudson',
    title: 'Beginner Garba Workshop: Two-Taali, Three-Taali and Dodhiyu',
    summary:
      'A two-hour class in Jersey City for complete beginners, covering the three steps you will meet most over Navratri.',
    description: [
      'If you have ever stood at the edge of a garba circle trying to work out when to clap, this class is for you. In two hours at Hudson Riverside Pavilion, a Mirrorwork Events teacher takes a small group through the three steps you will see most over the nine nights.',
      'Two-taali comes first, then three-taali, then dodhiyu — the travelling step with the turn that catches most people out. Each one is taught slowly, then to music, then in a practice circle where getting it wrong is the point.',
      'No partner and no experience needed. Wear comfortable shoes and clothes you can turn in; the floor is sprung wood and the room is step-free.',
    ].join('\n\n'),
    category: 'WORKSHOP',
    status: 'ON_SALE',
    days: 10,
    localStart: [19, 0],
    durationHours: 2,
    timezone: EASTERN,
    languages: ['English', 'Gujarati'],
    isOnline: false,
    publishedDays: -30,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'beginner-class',
        name: 'Class Ticket',
        description: 'One place in the two-hour class.',
        priceCents: 2000,
        quantityTotal: 60,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -30,
        salesEndDays: 10,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'kids-hour',
    id: seedId('seed-event-dandiya-kids-hour-houston'),
    slug: 'dandiya-kids-hour-houston',
    orgKey: 'chaniya',
    venueKey: 'lantern-row',
    title: 'Dandiya Kids’ Hour',
    summary:
      'A free hour of dandiya for children at Lantern Row Event Hall, with soft practice sticks and patient teachers.',
    description: [
      'Dandiya Kids’ Hour is Chaniya Collective’s way of making sure the youngest dancers arrive at Navratri knowing what to do with their sticks. For one hour the side hall at Lantern Row Event Hall belongs to children and the grown-ups who brought them.',
      'Teachers start with rhythm games and clapping patterns, then hand out soft foam practice sticks for the first raas lines. The hour ends with one short raas for the whole room, parents included.',
      'Entry is free, but each child needs a ticket so the teachers know how many to plan for. Best for ages four to eleven, and an adult stays with every child.',
    ].join('\n\n'),
    category: 'WORKSHOP',
    status: 'ON_SALE',
    days: 12,
    localStart: [19, 0],
    durationHours: 1,
    timezone: CENTRAL,
    languages: ['English', 'Gujarati', 'Hindi'],
    isOnline: false,
    publishedDays: -28,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'kids-hour-free',
        name: 'Child Place (free)',
        description: 'Free. One ticket per child; accompanying adults do not need one.',
        priceCents: 0,
        quantityTotal: 80,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -28,
        salesEndDays: 12,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'night-one',
    id: seedId('seed-event-navratri-night-one-edison'),
    slug: 'navratri-night-one-edison',
    orgKey: 'mirrorwork',
    venueKey: 'lamplight',
    title: 'Navratri Night One: Garba Under the Lights',
    summary:
      'The first night of Navratri at Lamplight Expo Hall: a live band, a lit garbo at the centre of the floor, and room for every circle.',
    description: [
      'Navratri opens the way it should — an aarti at the garbo, a moment of quiet, and then the first beat of the dhol. Mirrorwork Events lays out the Lamplight Expo Hall floor as one great ring around a lit garbo, with room for slow circles at the edge and fast ones towards the middle.',
      'The music is live all night: a Gujarati folk band with dhol, shehnai and two singers, moving from slow garba through two-taali and three-taali, then into dandiya raas after the break. Sticks are sold at the door if you forget yours.',
      'Couple Entry admits two. VIP Circle holders have a reserved area beside the band and a separate entrance. Traditional dress is welcome and never required; comfortable shoes are strongly advised.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 18,
    localStart: [19, 30],
    durationHours: 5,
    timezone: EASTERN,
    languages: ['Gujarati', 'English'],
    isOnline: false,
    publishedDays: -42,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'night-one-general',
        name: 'General Admission',
        description: 'Entry to the main floor for the night.',
        priceCents: 3500,
        quantityTotal: 3000,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -42,
        salesEndDays: 18,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'night-one-couple',
        name: 'Couple Entry',
        description: 'Admits two to the main floor.',
        priceCents: 6000,
        quantityTotal: 600,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -42,
        salesEndDays: 17,
        status: 'ON_SALE',
        sortOrder: 1,
      },
      {
        key: 'night-one-vip-circle',
        name: 'VIP Circle',
        description: 'A reserved area beside the band, and a separate entrance.',
        priceCents: 8500,
        // Few left, and genuinely so: see the note above EVENTS.
        quantityTotal: 12,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -35,
        salesEndDays: 18,
        status: 'ON_SALE',
        sortOrder: 2,
      },
    ],
  },
  {
    key: 'nine-nights',
    id: seedId('seed-event-mirrorwork-nine-nights-pass'),
    slug: 'mirrorwork-nine-nights-pass',
    orgKey: 'mirrorwork',
    venueKey: 'lamplight',
    title: 'Mirrorwork Navratri: Nine Nights Season Pass',
    summary:
      'One pass for all nine nights of Mirrorwork’s Navratri at Lamplight Expo Hall, from the opening aarti to the last raas.',
    description: [
      'If you already know you will be back every night, this is the pass for it. One wristband covers all nine nights of Mirrorwork Events’ Navratri at Lamplight Expo Hall, from the opening aarti to the final dandiya raas.',
      'Each night keeps the same shape: aarti at the garbo, garba until the break, dandiya after it, all to a live band. The wristband is collected once, on your first night, with photo ID matching the name on the order.',
      'The Family Pass covers four people from one household for all nine nights. Wristbands are not swapped between people on different nights; each one stays with the person wearing it.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 18,
    localStart: [19, 30],
    durationHours: 8 * 24 + 5,
    timezone: EASTERN,
    languages: ['Gujarati', 'English'],
    isOnline: false,
    publishedDays: -42,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'nine-nights-season',
        name: 'Season Pass — All Nine Nights',
        description: 'One wristband, every night.',
        priceCents: 22000,
        // Few left, and genuinely so: see the note above EVENTS.
        quantityTotal: 19,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -42,
        salesEndDays: 18,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'nine-nights-family',
        name: 'Family Pass (4 people)',
        description: 'Four wristbands for one household, every night.',
        priceCents: 64000,
        quantityTotal: 80,
        minPerOrder: 1,
        maxPerOrder: 2,
        salesStartDays: -42,
        salesEndDays: 18,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'lakeshore-opening',
    id: seedId('seed-event-lakeshore-raas-opening-night'),
    slug: 'lakeshore-raas-opening-night',
    orgKey: 'lakeshore',
    venueKey: 'lakeshore',
    title: 'Lakeshore Raas: Opening Night',
    summary:
      'The first night of Lakeshore Raas’s Navratri season at Lakeshore Pavilion in Schaumburg, with a live band and an aarti at the garbo.',
    description: [
      'Opening night at Lakeshore Pavilion is the start of Lakeshore Raas’s Navratri season: an aarti at the garbo, a live band on the stage, and a floor laid out as one wide circle so that nobody dances with their back to the lamp.',
      'The band plays traditional garba for the first half and moves into dandiya after the break. The pavilion is heated, the floor is sprung, and there is a coat check by the main doors — useful in a Chicago October.',
      'VIP tickets include a reserved table at the edge of the floor and priority entry. Traditional dress is welcome and never required.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 18,
    localStart: [19, 30],
    durationHours: 4.5,
    timezone: CENTRAL,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: -38,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'lakeshore-general',
        name: 'General Admission',
        description: 'Entry to the floor for the night.',
        priceCents: 3200,
        quantityTotal: 2200,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -38,
        salesEndDays: 18,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'lakeshore-vip',
        name: 'VIP',
        description: 'A reserved table at the edge of the floor, and priority entry.',
        priceCents: 7500,
        quantityTotal: 100,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -38,
        salesEndDays: 18,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'bay-lights-opening',
    id: seedId('seed-event-bay-lights-garba-opening'),
    slug: 'bay-lights-garba-opening',
    orgKey: 'bay-lights',
    venueKey: 'santa-clara',
    title: 'Bay Lights Garba: Opening Night',
    summary:
      'Bay Lights Garba Co. opens Navratri at Santa Clara Valley Expo with a live band, a lit garbo and dandiya after the break.',
    description: [
      'Bay Lights Garba Co. opens its Navratri at Santa Clara Valley Expo with everything a first night needs: an aarti at the garbo, a live band, and a floor wide enough for the slow circles and the fast ones at the same time.',
      'The first half is garba, from the gentle opening rounds to three-taali at full speed. After the break the lights come up a little for dandiya raas. Sticks are available at the merchandise table if you would rather not bring your own.',
      'The Early Bird allocation has gone; General Admission and VIP remain. VIP includes a reserved lounge with seating, a separate entrance and water all evening.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 18,
    localStart: [19, 30],
    durationHours: 4.5,
    timezone: PACIFIC,
    languages: ['Gujarati', 'English'],
    isOnline: false,
    publishedDays: -45,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'bay-lights-early',
        name: 'Early Bird',
        description: 'General admission at the early price.',
        priceCents: 2800,
        quantityTotal: 6,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -45,
        salesEndDays: 18,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'bay-lights-general',
        name: 'General Admission',
        description: 'Entry to the floor for the night.',
        priceCents: 4000,
        quantityTotal: 3200,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -45,
        salesEndDays: 18,
        status: 'ON_SALE',
        sortOrder: 1,
      },
      {
        key: 'bay-lights-vip',
        name: 'VIP',
        description: 'Reserved lounge with seating, a separate entrance and water all evening.',
        priceCents: 9500,
        quantityTotal: 150,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -45,
        salesEndDays: 18,
        status: 'ON_SALE',
        sortOrder: 2,
      },
    ],
  },
  {
    key: 'dandiya-dhol',
    id: seedId('seed-event-dandiya-dhol-houston'),
    slug: 'dandiya-dhol-houston',
    orgKey: 'chaniya',
    venueKey: 'lantern-row',
    title: 'Dandiya Raas with a Live Dhol Ensemble',
    summary:
      'Chaniya Collective brings a full dhol ensemble to Lantern Row Event Hall for a night that is all dandiya, all live.',
    description: [
      'Some nights are garba nights. This one is for dandiya. Chaniya Collective clears the Lantern Row Event Hall floor for raas lines, and a live dhol ensemble keeps the tempo climbing from the first pair of sticks to the last.',
      'The evening opens with a short aarti and a slow warm-up round so newcomers can find the pattern before the pace picks up. Volunteers in the Collective’s green sashes will happily partner anyone who arrives without one.',
      'Student tickets need a current student ID at the door. VIP includes seating off the floor for when your arms give out, and bottled water all night.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 19,
    localStart: [19, 30],
    durationHours: 5,
    timezone: CENTRAL,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: -40,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'dhol-general',
        name: 'General Admission',
        description: 'Entry to the floor for the night.',
        priceCents: 3000,
        quantityTotal: 2500,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -40,
        salesEndDays: 19,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'dhol-student',
        name: 'Student',
        description: 'General admission with a current student ID, checked at the door.',
        priceCents: 1800,
        quantityTotal: 400,
        minPerOrder: 1,
        maxPerOrder: 2,
        salesStartDays: -40,
        salesEndDays: 19,
        status: 'ON_SALE',
        sortOrder: 1,
      },
      {
        key: 'dhol-vip',
        name: 'VIP',
        description: 'Seating off the floor and bottled water all night.',
        priceCents: 7000,
        quantityTotal: 120,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -40,
        salesEndDays: 19,
        status: 'ON_SALE',
        sortOrder: 2,
      },
    ],
  },
  {
    key: 'delaware-aarti',
    id: seedId('seed-event-garba-and-aarti-on-the-delaware'),
    slug: 'garba-and-aarti-on-the-delaware',
    orgKey: 'liberty-bell',
    venueKey: 'delaware',
    title: 'Garba & Aarti on the Delaware',
    summary:
      'An unhurried evening of aarti and garba at Delaware River Pavilion in Philadelphia, gentle on beginners and open to all.',
    description: [
      'Liberty Bell Navratri keeps its evening simple: a full aarti at the start, then garba in the round at Delaware River Pavilion, with the river outside the windows and a pace that suits people who have never joined a circle before.',
      'The music is recorded rather than live, and the first few rounds are slowed down on purpose so that everyone can find the steps. Experienced dancers are asked to form an outer ring once the tempo picks up.',
      'Prasad is shared after the closing aarti.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 21,
    localStart: [19, 0],
    durationHours: 4,
    timezone: EASTERN,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: -30,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'delaware-general',
        name: 'General Admission',
        description: 'Entry for the evening, aarti included.',
        priceCents: 2000,
        quantityTotal: 1200,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -30,
        salesEndDays: 21,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'live-band',
    id: seedId('seed-event-mirrorwork-live-band-night'),
    slug: 'mirrorwork-live-band-night',
    orgKey: 'mirrorwork',
    venueKey: 'lamplight',
    title: 'Live Garba Band Night with the Mirrorwork Ensemble',
    summary:
      'The Mirrorwork Ensemble plays a concert of garba and Gujarati folk songs at Lamplight Expo Hall, with a standing floor and a seated balcony.',
    description: [
      'The band behind Mirrorwork Events’ Navratri nights takes the stage for a concert of its own. The Mirrorwork Ensemble — dhol, tabla, harmonium, shehnai and three singers — plays the garba and folk songs of the season, arranged for listening as well as for dancing.',
      'The floor at Lamplight Expo Hall is standing and open to anyone who wants to dance. The balcony is seated, for anyone who would rather listen.',
      'The concert runs in two halves with an interval. Food and drink are served in the lobby and stay off the dance floor.',
    ].join('\n\n'),
    category: 'MUSIC_CONCERT',
    status: 'ON_SALE',
    days: 22,
    localStart: [19, 30],
    durationHours: 4,
    timezone: EASTERN,
    languages: ['Gujarati', 'English'],
    isOnline: false,
    publishedDays: -36,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'live-band-floor',
        name: 'General Admission — Standing Floor',
        description: 'Standing entry to the dance floor.',
        priceCents: 4500,
        quantityTotal: 1500,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -36,
        salesEndDays: 22,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'rainier-family',
    id: seedId('seed-event-rainier-family-garba'),
    slug: 'rainier-family-garba',
    orgKey: 'rainier',
    venueKey: 'cedar-lane',
    title: 'Rainier Raas: Family Garba Evening',
    summary:
      'An easy-going garba evening in Bellevue for families, with a teaching round at the start and a finish that suits younger dancers.',
    description: [
      'Rainier Raas built this evening for families who want Navratri without a one-in-the-morning finish. Cedar Lane Hall opens with a teaching round in which a volunteer walks everyone through the basic steps, and the music stays at a pace small feet can follow.',
      'After the first hour the circles split: a gentle one for children and grandparents near the stage, a faster one for everyone else. The evening closes with an aarti at the garbo.',
      'Child tickets are for ages three to twelve. There is a quiet room off the lobby for anyone who needs a break from the music, and the hall is step-free throughout.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 22,
    localStart: [19, 0],
    durationHours: 3.5,
    timezone: PACIFIC,
    languages: ['English', 'Gujarati'],
    isOnline: false,
    publishedDays: -33,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'rainier-adult',
        name: 'Adult',
        description: 'Entry for one adult.',
        priceCents: 2200,
        quantityTotal: 900,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -33,
        salesEndDays: 22,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'rainier-child',
        name: 'Child (3–12)',
        description: 'Entry for a child aged three to twelve, with an adult.',
        priceCents: 800,
        quantityTotal: 300,
        minPerOrder: 1,
        maxPerOrder: 6,
        salesStartDays: -33,
        salesEndDays: 22,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'pacific-dandiya',
    id: seedId('seed-event-pacific-dandiya-night'),
    slug: 'pacific-dandiya-night',
    orgKey: 'pacific',
    venueKey: 'cerritos',
    title: 'Pacific Dandiya Night',
    summary:
      'A late dandiya night at Cerritos Garden Pavilion with a live band, a garden terrace for breathers and a VIP lounge above the floor.',
    description: [
      'Pacific Dandiya Society’s dandiya night at Cerritos Garden Pavilion starts late and runs later: a live band, long raas lines, and a garden terrace outside for when you need air between rounds.',
      'The first set is garba to warm up. After that it is dandiya until close, with the band calling the changes in pattern so that nobody is left clacking sticks at the wrong moment.',
      'The VIP Lounge overlooks the floor, with seating, its own entrance and chai all night.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 23,
    localStart: [20, 0],
    durationHours: 5,
    timezone: PACIFIC,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: -37,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'pacific-general',
        name: 'General Admission',
        description: 'Entry to the floor and the garden terrace.',
        priceCents: 3800,
        quantityTotal: 1800,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -37,
        salesEndDays: 23,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'pacific-vip-lounge',
        name: 'VIP Lounge',
        description: 'Lounge seating above the floor, its own entrance and chai all night.',
        priceCents: 11000,
        quantityTotal: 80,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -37,
        salesEndDays: 23,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'marathon',
    id: seedId('seed-event-five-boroughs-garba-marathon'),
    slug: 'five-boroughs-garba-marathon',
    orgKey: 'five-boroughs',
    venueKey: 'queens',
    title: 'Five Boroughs Garba Marathon',
    summary:
      'Six hours of garba at Queens Community Arena, with two live bands trading sets so the music never stops.',
    description: [
      'Five Boroughs Garba runs this one as a marathon: six hours at Queens Community Arena, two live bands trading sets so that the music does not stop between them, and a circle that keeps turning from the first aarti to the last.',
      'There are water stations on every side of the floor and a rest area with seating on the upper concourse. Pace yourself; the fastest three-taali rounds are saved for the final hour.',
      'Doors open an hour before the first set, and the wristband you are given at the door lets you out and back in.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'SOLD_OUT',
    days: 24,
    localStart: [19, 0],
    durationHours: 6,
    timezone: EASTERN,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: -50,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'marathon-general',
        name: 'General Admission',
        description: 'Entry for the whole marathon, with re-entry.',
        priceCents: 3000,
        quantityTotal: 6,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -50,
        salesEndDays: 24,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'garba-for-good',
    id: seedId('seed-event-garba-for-good-philadelphia'),
    slug: 'garba-for-good-philadelphia',
    orgKey: 'liberty-bell',
    venueKey: 'delaware',
    title: 'Garba for Good: Charity Navratri Night',
    summary:
      'A Navratri garba night at Delaware River Pavilion raising money for a neighbourhood food pantry, with a live band and a raffle.',
    description: [
      'Garba for Good is Liberty Bell Navratri’s charity night: the same garba and aarti as any other evening at Delaware River Pavilion, with the organiser pledging the evening’s proceeds to a neighbourhood food pantry in Philadelphia.',
      'A live band plays garba and dandiya, volunteers run a snack stall, and a raffle of donated prizes is drawn before the final raas.',
      'Everyone is welcome, whatever their experience; the first round is taught.',
    ].join('\n\n'),
    category: 'CULTURAL_FESTIVAL',
    status: 'POSTPONED',
    postponedDays: -3,
    days: 24,
    localStart: [19, 0],
    durationHours: 5,
    timezone: EASTERN,
    languages: ['English', 'Gujarati'],
    isOnline: false,
    publishedDays: -30,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'garba-for-good-general',
        name: 'General Admission',
        description: 'Entry for the evening, raffle ticket included.',
        priceCents: 2500,
        quantityTotal: 1000,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -30,
        salesEndDays: 24,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'peachtree-saturday',
    id: seedId('seed-event-peachtree-garba-saturday'),
    slug: 'peachtree-garba-saturday',
    orgKey: 'peachtree',
    venueKey: 'midtown',
    title: 'Peachtree Garba Saturday',
    summary:
      'A Saturday of garba at Midtown Grand Hall in Atlanta, with a live band, a kids’ circle and a food court from local caterers.',
    description: [
      'Peachtree Raas Club gives Navratri a proper Saturday night at Midtown Grand Hall: a live band, an aarti at the garbo, and a circle that starts slow and gets a little faster with every round.',
      'Families are the point of this one. A separate kids’ circle at the side of the hall has its own volunteer leads, so younger dancers can learn the steps without being swept into the fast rounds.',
      'Kids tickets are for ages five to twelve. Local caterers run a food court in the lobby with Gujarati snacks, chaat and chai, paid for separately.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 20,
    // The title names the day, so the date is the first Saturday on or after
    // `days` rather than whatever weekday `days` happens to land on.
    weekday: 6,
    localStart: [19, 30],
    durationHours: 4.5,
    timezone: EASTERN,
    languages: ['Gujarati', 'English'],
    isOnline: false,
    publishedDays: -35,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'peachtree-general',
        name: 'General Admission',
        description: 'Entry for the evening.',
        priceCents: 2500,
        quantityTotal: 1800,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -35,
        salesEndDays: 20,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'peachtree-kids',
        name: 'Kids 5–12',
        description: 'Entry for a child aged five to twelve, with an adult.',
        priceCents: 1000,
        quantityTotal: 400,
        minPerOrder: 1,
        maxPerOrder: 6,
        salesStartDays: -35,
        salesEndDays: 20,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'glow-night',
    id: seedId('seed-event-garba-glow-night-santa-clara'),
    slug: 'garba-glow-night-santa-clara',
    orgKey: 'bay-lights',
    venueKey: 'santa-clara',
    title: 'Garba Glow Night (All-White Dress Code)',
    summary:
      'Garba under ultraviolet light at Santa Clara Valley Expo, with an all-white dress code and a live band.',
    description: [
      'For one night Bay Lights Garba Co. turns the lights down and the ultraviolet up at Santa Clara Valley Expo. Come dressed in white and the whole circle glows, from the dandiya sticks to the mirrorwork on your dupatta.',
      'The band plays a full set of garba and dandiya, and the lighting crew changes the colour of the room between rounds. Glow sticks and white dandiya sticks are sold at the merchandise table.',
      'The dress code is a request, not a rule at the door: white or pale clothes glow best, and anything with mirrorwork catches the light.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'SALES_PAUSED',
    days: 25,
    localStart: [20, 0],
    durationHours: 4.5,
    timezone: PACIFIC,
    languages: ['English', 'Gujarati'],
    isOnline: false,
    publishedDays: -34,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'glow-night-general',
        name: 'General Admission',
        description: 'Entry to the floor for the night.',
        priceCents: 4500,
        quantityTotal: 2000,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -34,
        salesEndDays: 25,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'mela-queens',
    id: seedId('seed-event-navratri-mela-queens'),
    slug: 'navratri-mela-queens',
    orgKey: 'five-boroughs',
    venueKey: 'queens',
    title: 'Navratri Mela & Garba',
    summary:
      'A Navratri mela at Queens Community Arena — food stalls, crafts and henna — followed by live garba on the arena floor.',
    description: [
      'The Navratri Mela fills the Queens Community Arena concourse with stalls: Gujarati snacks and chaat, chaniya choli and jewellery sellers, henna artists, and a stall for dandiya sticks. The arena floor opens for garba later in the evening.',
      'Mela Entry covers the stalls and the performances on the concourse stage, including a children’s dance showcase. Mela + Garba adds the arena floor for the live garba that follows.',
      'Stalls are run by independent sellers, who take their own payments.',
    ].join('\n\n'),
    category: 'CULTURAL_FESTIVAL',
    status: 'ON_SALE',
    days: 26,
    localStart: [19, 0],
    durationHours: 5.5,
    timezone: EASTERN,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: -39,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'mela-entry',
        name: 'Mela Entry',
        description: 'The stalls and the concourse stage.',
        priceCents: 1000,
        quantityTotal: 2000,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -39,
        salesEndDays: 26,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'mela-and-garba',
        name: 'Mela + Garba',
        description: 'The stalls, the concourse stage and the garba on the arena floor.',
        priceCents: 2800,
        quantityTotal: 2500,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -39,
        salesEndDays: 26,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'dussehra-finale',
    id: seedId('seed-event-dussehra-raas-finale-schaumburg'),
    slug: 'dussehra-raas-finale-schaumburg',
    orgKey: 'lakeshore',
    venueKey: 'lakeshore',
    title: 'Dussehra Raas Finale',
    summary:
      'Lakeshore Raas closes its Navratri season on Dussehra at Lakeshore Pavilion, with a live band and one last long raas.',
    description: [
      'Dussehra follows Navratri’s ninth night, and Lakeshore Raas uses it to close the season properly: one more evening at Lakeshore Pavilion, one more aarti at the garbo, and a live band playing until the last circle breaks up.',
      'Expect the fast rounds to be very fast. By this point in the season most of the room knows every step, and the band plays like it.',
      'General admission only. The coat check by the main doors is included with every ticket.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 27,
    localStart: [19, 30],
    durationHours: 4.5,
    timezone: CENTRAL,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: -38,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'dussehra-general',
        name: 'General Admission',
        description: 'Entry for the night, coat check included.',
        priceCents: 3500,
        quantityTotal: 2600,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -38,
        salesEndDays: 27,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'collegiate',
    id: seedId('seed-event-collegiate-raas-showcase-irving'),
    slug: 'collegiate-raas-showcase-irving',
    orgKey: 'lone-star',
    venueKey: 'trinity',
    title: 'Raas-Garba Collegiate Showcase',
    summary:
      'College raas and garba teams from across Texas perform their competition sets at Trinity Convention Hall.',
    description: [
      'Collegiate raas-garba is its own world: student teams, costumes made by hand, and eight-minute sets choreographed to the second. Lone Star Navratri’s showcase brings college teams from across Texas to the Trinity Convention Hall stage.',
      'It is a showcase rather than a competition — no judges and no trophies, just each team’s set performed for an audience that knows what it is watching. Spectator tickets are unreserved seating.',
    ].join('\n\n'),
    category: 'CULTURAL_FESTIVAL',
    status: 'CANCELLED',
    cancelledDays: -2,
    cancellationReason: 'The venue could not confirm the date for the student teams.',
    days: 30,
    localStart: [19, 0],
    durationHours: 3.5,
    timezone: CENTRAL,
    languages: ['English', 'Gujarati'],
    isOnline: false,
    publishedDays: -32,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'collegiate-spectator',
        name: 'Spectator',
        description: 'Unreserved seating for the showcase.',
        priceCents: 2200,
        quantityTotal: 2000,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -32,
        salesEndDays: 30,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'sharad-poonam',
    id: seedId('seed-event-lone-star-sharad-poonam-garba'),
    slug: 'lone-star-sharad-poonam-garba',
    orgKey: 'lone-star',
    venueKey: 'trinity',
    title: 'Lone Star Navratri: Sharad Poonam Garba',
    summary:
      'Garba on the night of the Sharad Poonam full moon at Trinity Convention Hall in Irving, closing with doodh-pauva for everyone.',
    description: [
      'Sharad Poonam, the full moon that follows Navratri, is traditionally a night for one more garba. Lone Star Navratri marks it at Trinity Convention Hall with a live band and the courtyard doors open, so that the moon is part of the evening.',
      'The music leans traditional — slow garba, two-taali and three-taali, and a long raas to finish. Near midnight the organisers serve doodh-pauva, the sweetened milk and flattened rice eaten on Sharad Poonam, to everyone in the hall.',
      'One ticket type, general admission, for the whole evening.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    days: 33,
    localStart: [19, 30],
    durationHours: 4.5,
    timezone: CENTRAL,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: -29,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'sharad-poonam-general',
        name: 'General Admission',
        description: 'Entry for the evening, doodh-pauva included.',
        priceCents: 2800,
        quantityTotal: 3000,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -29,
        salesEndDays: 33,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    ],
  },
  {
    key: 'garba-basics-online',
    id: seedId('seed-event-garba-basics-online'),
    slug: 'garba-basics-online',
    orgKey: 'chaniya',
    venueKey: null,
    title: 'Garba Basics Online: Learn the Steps at Home',
    summary:
      'A ninety-minute live class online for anyone who wants to learn the basic garba steps before their first night out.',
    description: [
      'A live class, taught on video by two Chaniya Collective teachers, for anyone who would rather learn the steps in their living room than at the edge of a circle. It covers two-taali, three-taali and how to join a moving circle without stopping it.',
      'The joining link is sent to ticket holders before the class starts. Keep a few feet of clear floor and wear shoes you can turn in.',
    ].join('\n\n'),
    category: 'WORKSHOP',
    status: 'ON_SALE',
    days: 8,
    localStart: [19, 0],
    durationHours: 1.5,
    timezone: CENTRAL,
    languages: ['English', 'Gujarati'],
    isOnline: true,
    onlineUrl: 'https://live.chaniya.example/garba-basics',
    publishedDays: -20,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'online-live',
        name: 'Live Class',
        description: 'Join the class live.',
        priceCents: 1200,
        quantityTotal: 200,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -20,
        salesEndDays: 8,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'online-live-feedback',
        name: 'Live Class + Video Feedback',
        description: 'The live class, plus written feedback on a short video of your practice.',
        priceCents: 3000,
        quantityTotal: 20,
        minPerOrder: 1,
        maxPerOrder: 1,
        salesStartDays: -20,
        salesEndDays: 6,
        // Paused by the organiser while the teachers confirm how many reviews
        // they can write, which is the tier-level pause the rest of the
        // catalogue does not otherwise exercise.
        status: 'PAUSED',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'diwali-raas-draft',
    id: seedId('seed-event-mirrorwork-diwali-raas-social'),
    slug: 'mirrorwork-diwali-raas-social',
    orgKey: 'mirrorwork',
    venueKey: 'lamplight',
    title: 'Diwali Raas Social',
    summary: 'A Diwali evening of raas, sweets and a live band at Lamplight Expo Hall.',
    description:
      'Draft listing. The band and the caterer are confirmed; the hall booking is not. Do not send for review until the venue confirms the date in writing.',
    category: 'CULTURAL_FESTIVAL',
    status: 'DRAFT',
    days: 45,
    localStart: [19, 0],
    durationHours: 4,
    timezone: EASTERN,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: null,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'diwali-raas-general',
        name: 'General Admission',
        description: 'Entry for the evening.',
        priceCents: 3000,
        quantityTotal: 1500,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: 20,
        salesEndDays: 45,
        status: 'DRAFT',
        sortOrder: 0,
      },
      {
        key: 'diwali-raas-family',
        name: 'Family (4 people)',
        description: 'Entry for four people from one household.',
        priceCents: 10_000,
        quantityTotal: 200,
        minPerOrder: 1,
        maxPerOrder: 2,
        salesStartDays: 20,
        salesEndDays: 44,
        status: 'DRAFT',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'houston-sharad-draft',
    id: seedId('seed-event-houston-sharad-poonam-raas'),
    slug: 'houston-sharad-poonam-raas',
    orgKey: 'chaniya',
    venueKey: 'lantern-row',
    title: 'Sharad Poonam Raas',
    summary: 'One more raas under the full moon after Navratri, at Lantern Row Event Hall.',
    description:
      'Draft listing. Waiting on the dhol ensemble to confirm the date before this goes to review. Prices are placeholders.',
    category: 'GARBA_DANDIYA',
    status: 'DRAFT',
    days: 34,
    localStart: [19, 30],
    durationHours: 4,
    timezone: CENTRAL,
    languages: ['Gujarati', 'English'],
    isOnline: false,
    publishedDays: null,
    currency: 'USD',
    ticketTypes: [
      {
        key: 'houston-sharad-general',
        name: 'General Admission',
        description: 'Entry for the night.',
        priceCents: 2500,
        quantityTotal: 2000,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: 10,
        salesEndDays: 34,
        status: 'DRAFT',
        sortOrder: 0,
      },
    ],
  },
]

/** Promo codes of both types, one organisation-wide and one event-scoped each. */
const PROMO_CODES = [
  {
    key: 'navratri10',
    id: seedId('seed-promo-navratri10'),
    orgKey: 'mirrorwork',
    eventKey: null,
    code: 'NAVRATRI10',
    type: 'PERCENTAGE',
    value: 1000,
    maxRedemptions: 200,
    startsDays: -30,
    endsDays: 30,
    active: true,
  },
  {
    key: 'nightone5',
    id: seedId('seed-promo-nightone5'),
    orgKey: 'mirrorwork',
    eventKey: 'night-one',
    code: 'NIGHTONE5',
    type: 'FIXED_AMOUNT',
    // A flat discount is denominated: $5 off, never ₹5 off. The
    // `promo_code_fixed_amount_currency` check constraint rejects the row
    // without this.
    currency: 'USD',
    value: 500,
    maxRedemptions: 300,
    startsDays: -20,
    endsDays: 18,
    active: true,
  },
  {
    key: 'dhol15',
    id: seedId('seed-promo-dhol15'),
    orgKey: 'chaniya',
    eventKey: 'dandiya-dhol',
    code: 'DHOL15',
    type: 'PERCENTAGE',
    value: 1500,
    maxRedemptions: 100,
    startsDays: -25,
    endsDays: 19,
    active: true,
  },
  {
    key: 'chaniya-welcome',
    id: seedId('seed-promo-chaniya-welcome'),
    orgKey: 'chaniya',
    eventKey: null,
    code: 'WELCOME5',
    type: 'FIXED_AMOUNT',
    currency: 'USD',
    value: 500,
    maxRedemptions: 100,
    startsDays: -200,
    endsDays: -30,
    active: false,
  },
]

/**
 * Orders covering every OrderStatus, with tickets, payments and holds that
 * match. `quantitySold` on each ticket type is derived from these rows, so
 * changing an order here automatically keeps inventory counters correct.
 */
const ORDERS = [
  {
    key: 'us01',
    reference: 'DE-US-200001',
    eventKey: 'night-one',
    userKey: 'aarav',
    buyerName: 'Aarav Shah',
    buyerEmail: 'aarav.shah@mail.example',
    status: 'PAID',
    promoKey: 'nightone5',
    placedDays: -12,
    lines: [{ ticketTypeKey: 'night-one-general', quantity: 2 }],
    attendees: ['Aarav Shah', 'Riddhi Shah'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'us02',
    reference: 'DE-US-200002',
    eventKey: 'bay-lights-opening',
    userKey: 'diya',
    buyerName: 'Diya Patel',
    buyerEmail: 'diya.patel@mail.example',
    status: 'PAID',
    promoKey: null,
    placedDays: -30,
    lines: [{ ticketTypeKey: 'bay-lights-early', quantity: 4 }],
    attendees: ['Diya Patel', 'Mihir Patel', 'Asha Patel', 'Nirav Patel'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'us03',
    reference: 'DE-US-200003',
    eventKey: 'bay-lights-opening',
    userKey: 'sneha',
    buyerName: 'Sneha Reddy',
    buyerEmail: 'sneha.reddy@mail.example',
    status: 'PAID',
    promoKey: null,
    placedDays: -26,
    // Together with DE-US-200002 this takes the whole Early Bird allocation,
    // so that tier is genuinely sold out rather than merely labelled that way.
    lines: [
      { ticketTypeKey: 'bay-lights-early', quantity: 2 },
      { ticketTypeKey: 'bay-lights-vip', quantity: 1 },
    ],
    attendees: ['Sneha Reddy', 'Karthik Reddy', 'Sneha Reddy'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'us04',
    reference: 'DE-US-200004',
    eventKey: 'warm-up',
    userKey: 'karan',
    buyerName: 'Karan Vora',
    buyerEmail: 'karan.vora@mail.example',
    status: 'PAID',
    promoKey: null,
    placedDays: -20,
    lines: [{ ticketTypeKey: 'warm-up-general', quantity: 3 }],
    attendees: ['Karan Vora', 'Pooja Vora', 'Anika Vora'],
    ticketStatus: 'CHECKED_IN',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'us05',
    reference: 'DE-US-200005',
    eventKey: 'marathon',
    userKey: 'ishaan',
    buyerName: 'Ishaan Gupta',
    buyerEmail: 'ishaan.gupta@mail.example',
    status: 'PAID',
    promoKey: null,
    placedDays: -25,
    lines: [{ ticketTypeKey: 'marathon-general', quantity: 4 }],
    attendees: ['Ishaan Gupta', 'Tanvi Gupta', 'Rahul Menon', 'Priya Menon'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'us06',
    reference: 'DE-US-200006',
    eventKey: 'marathon',
    userKey: 'aarav',
    buyerName: 'Aarav Shah',
    buyerEmail: 'aarav.shah@mail.example',
    status: 'PAID',
    promoKey: null,
    placedDays: -12,
    // The last two places: with DE-US-200005 the marathon is sold out, which
    // is why the event itself is SOLD_OUT.
    lines: [{ ticketTypeKey: 'marathon-general', quantity: 2 }],
    attendees: ['Aarav Shah', 'Riddhi Shah'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'us07',
    reference: 'DE-US-200007',
    eventKey: 'dandiya-dhol',
    userKey: 'maya',
    buyerName: 'Maya Chokshi',
    buyerEmail: 'maya.chokshi@mail.example',
    status: 'PENDING',
    promoKey: null,
    placedDays: 0,
    lines: [{ ticketTypeKey: 'dhol-general', quantity: 2 }],
    attendees: ['Maya Chokshi', 'Sahil Chokshi'],
    // A PENDING order has not issued tickets yet; inventory is held instead.
    issueTickets: false,
    payments: [{ suffix: 'a', status: 'INITIATED', amount: 'total' }],
    hold: { status: 'ACTIVE', liveExpiryMinutes: 10 },
  },
  {
    key: 'us08',
    reference: 'DE-US-200008',
    eventKey: 'lakeshore-opening',
    userKey: 'karan',
    buyerName: 'Karan Vora',
    buyerEmail: 'karan.vora@mail.example',
    status: 'REFUNDED',
    promoKey: null,
    placedDays: -10,
    refundedDays: -3,
    lines: [{ ticketTypeKey: 'lakeshore-general', quantity: 4 }],
    attendees: ['Karan Vora', 'Pooja Vora', 'Anika Vora', 'Dhruv Vora'],
    ticketStatus: 'REFUNDED',
    payments: [
      { suffix: 'a', status: 'SUCCEEDED', amount: 'total' },
      { suffix: 'r', status: 'REFUNDED', amount: 'total' },
    ],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'us09',
    reference: 'DE-US-200009',
    eventKey: 'pacific-dandiya',
    userKey: 'diya',
    buyerName: 'Diya Patel',
    buyerEmail: 'diya.patel@mail.example',
    status: 'CANCELLED',
    promoKey: null,
    placedDays: -6,
    cancelledDays: -6,
    lines: [{ ticketTypeKey: 'pacific-vip-lounge', quantity: 1 }],
    attendees: ['Diya Patel'],
    ticketStatus: 'VOID',
    payments: [{ suffix: 'a', status: 'FAILED', amount: 'total', failureCode: 'card_declined' }],
    hold: { status: 'RELEASED', offsetMinutes: 10 },
  },
  {
    key: 'us10',
    reference: 'DE-US-200010',
    eventKey: 'rainier-family',
    userKey: null,
    buyerName: 'Leela Sharma',
    buyerEmail: 'leela.sharma@mail.example',
    status: 'EXPIRED',
    promoKey: null,
    placedDays: -2,
    lines: [{ ticketTypeKey: 'rainier-adult', quantity: 2 }],
    attendees: ['Leela Sharma', 'Guest'],
    issueTickets: false,
    payments: [],
    hold: { status: 'EXPIRED', offsetMinutes: 10 },
  },
  {
    key: 'us11',
    reference: 'DE-US-200011',
    eventKey: 'garba-basics-online',
    userKey: 'sneha',
    buyerName: 'Sneha Reddy',
    buyerEmail: 'sneha.reddy@mail.example',
    status: 'PAID',
    promoKey: null,
    placedDays: -5,
    lines: [{ ticketTypeKey: 'online-live', quantity: 1 }],
    attendees: ['Sneha Reddy'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'us12',
    reference: 'DE-US-200012',
    eventKey: 'nine-nights',
    userKey: 'ishaan',
    buyerName: 'Ishaan Gupta',
    buyerEmail: 'ishaan.gupta@mail.example',
    status: 'PAID',
    promoKey: 'navratri10',
    placedDays: -8,
    lines: [{ ticketTypeKey: 'nine-nights-family', quantity: 1 }],
    attendees: ['Gupta household'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'us13',
    reference: 'DE-US-200013',
    eventKey: 'dandiya-dhol',
    userKey: 'aarav',
    buyerName: 'Aarav Shah',
    buyerEmail: 'aarav.shah@mail.example',
    status: 'PAID',
    promoKey: 'dhol15',
    placedDays: -4,
    lines: [
      { ticketTypeKey: 'dhol-student', quantity: 2 },
      { ticketTypeKey: 'dhol-general', quantity: 1 },
    ],
    attendees: ['Aarav Shah', 'Riddhi Shah', 'Neel Shah'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
]

/** Waitlist interest, including on the sold-out marathon. */
const WAITLIST = [
  { eventKey: 'marathon', userKey: 'diya', email: 'diya.patel@mail.example', quantity: 4 },
  { eventKey: 'marathon', userKey: null, email: 'neha.bhatt@mail.example', quantity: 2 },
  { eventKey: 'glow-night', userKey: 'sneha', email: 'sneha.reddy@mail.example', quantity: 2 },
  { eventKey: 'garba-for-good', userKey: null, email: 'nikhil.joshi@mail.example', quantity: 3 },
]

// ---------------------------------------------------------------------------
// Dataset assembly
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SeedData
 * @property {Date} anchor Midnight UTC used as the origin for all day offsets.
 * @property {object[]} users Users with their hashed password.
 * @property {object[]} organizations Organisations with resolved member lists.
 * @property {object[]} venues Venues, ready to write.
 * @property {object[]} events Events with resolved timestamps.
 * @property {object[]} ticketTypes Flattened ticket types carrying `quantitySold`.
 * @property {object[]} promoCodes Promo codes with resolved `redemptionCount`.
 * @property {object[]} orders Orders with totals, items, tickets, payments, holds.
 * @property {object[]} waitlist Waitlist entries.
 * @property {object[]} auditLogs Audit trail rows for the organiser actions above.
 */

/**
 * Build the complete seed dataset.
 *
 * Pure apart from password hashing: given the same `now` it always produces the
 * same rows, which is what makes the script safe to re-run. Derived counters
 * (`TicketType.quantitySold`, `PromoCode.redemptionCount`, every money column
 * on `Order`) are computed here from the order list rather than written by
 * hand, so the seeded data can never contradict itself.
 *
 * @param {Date} [now] Instant to treat as "now". Defaults to the current time.
 * @returns {SeedData} Everything the writer needs, with no database access.
 * @throws {Error} If the dataset is internally inconsistent — an unknown key,
 *   a duplicate reference, or a ticket type sold beyond its allocation.
 */
export function buildSeedData(now = new Date()) {
  const anchor = startOfUtcDay(now)
  const passwordHash = hashPasswordSync(SEED_PASSWORD, SEED_SCRYPT)

  const users = USERS.map((user) => ({
    key: user.key,
    email: user.email,
    passwordHash,
    displayName: user.displayName,
    phone: user.phone,
    locale: user.locale,
    role: user.role,
    emailVerified: user.emailVerified,
  }))
  const userByKey = new Map(users.map((user) => [user.key, user]))

  const organizations = ORGANIZATIONS.map((org) => ({
    ...org,
    // Derived from the verification state rather than written beside it, so the
    // denormalised column and the state the public badge reads cannot disagree.
    verified: org.verificationStatus === 'VERIFIED',
    payoutCurrency: 'USD',
    members: org.members.map((member) => {
      const user = userByKey.get(member.userKey)
      if (!user) throw new Error(`Unknown user key "${member.userKey}" in org "${org.key}"`)
      return { email: user.email, role: member.role }
    }),
  }))
  const orgById = new Map(organizations.map((org) => [org.key, org]))

  const venues = VENUES.map((venue) => ({
    ...venue,
    addressLine2: venue.addressLine2 ?? null,
    country: 'US',
    latitude: null,
    longitude: null,
    accessibility: { features: venue.accessibility, note: null },
  }))
  const venueById = new Map(venues.map((venue) => [venue.key, venue]))

  const events = EVENTS.map((event) => {
    const org = orgById.get(event.orgKey)
    if (!org) throw new Error(`Unknown org key "${event.orgKey}" on event "${event.key}"`)
    if (event.venueKey && !venueById.has(event.venueKey)) {
      throw new Error(`Unknown venue key "${event.venueKey}" on event "${event.key}"`)
    }

    const days =
      event.weekday === undefined ? event.days : onOrAfterWeekday(anchor, event.days, event.weekday)
    const startsAt = localTime(anchor, days, event.timezone, ...event.localStart)

    return {
      key: event.key,
      id: event.id,
      slug: event.slug,
      organizationId: org.id,
      venueId: event.venueKey ? venueById.get(event.venueKey).id : null,
      title: event.title,
      summary: event.summary,
      description: event.description,
      category: event.category,
      status: event.status,
      startsAt,
      endsAt: new Date(startsAt.getTime() + event.durationHours * HOUR_MS),
      timezone: event.timezone,
      // No cover image: the web app draws each event's poster from its slug,
      // and a URL here would point pages at a host nothing serves.
      coverImageUrl: null,
      isOnline: event.isOnline,
      onlineUrl: event.onlineUrl ?? null,
      languages: event.languages,
      publishedAt: event.publishedDays === null ? null : offset(anchor, event.publishedDays, 9),
      // Sales opened the day it was published for everything that has been on
      // sale; a draft has done neither.
      salesOpenedAt: event.publishedDays === null ? null : offset(anchor, event.publishedDays, 10),
      // What the lifecycle writes on postponement: the date it was going to be
      // on, until a new one is set.
      postponedAt: event.status === 'POSTPONED' ? offset(anchor, event.postponedDays, 15) : null,
      previousStartsAt: event.status === 'POSTPONED' ? startsAt : null,
      cancelledAt: event.status === 'CANCELLED' ? offset(anchor, event.cancelledDays, 15) : null,
      cancellationReason: event.status === 'CANCELLED' ? event.cancellationReason : null,
      currency: event.currency,
      venueCountry: event.venueKey ? venueById.get(event.venueKey).country : null,
    }
  })
  const eventByKey = new Map(events.map((event) => [event.key, event]))

  /** @type {Map<string, object>} */
  const ticketTypeByKey = new Map()
  for (const source of EVENTS) {
    const event = eventByKey.get(source.key)
    for (const ticketType of source.ticketTypes) {
      if (ticketTypeByKey.has(ticketType.key)) {
        throw new Error(`Duplicate ticket type key "${ticketType.key}"`)
      }
      ticketTypeByKey.set(ticketType.key, {
        key: ticketType.key,
        id: seedId(`seed-tt-${ticketType.key}`),
        eventId: event.id,
        eventKey: event.key,
        name: ticketType.name,
        description: ticketType.description ?? null,
        priceCents: ticketType.priceCents,
        currency: event.currency,
        quantityTotal: ticketType.quantityTotal,
        quantitySold: 0,
        minPerOrder: ticketType.minPerOrder,
        maxPerOrder: ticketType.maxPerOrder,
        salesStartAt:
          ticketType.salesStartDays === null ? null : offset(anchor, ticketType.salesStartDays, 4),
        salesEndAt:
          ticketType.salesEndDays === null ? null : offset(anchor, ticketType.salesEndDays, 12),
        declaredStatus: ticketType.status,
        status: ticketType.status,
        sortOrder: ticketType.sortOrder,
      })
    }
  }

  const promoByKey = new Map(
    PROMO_CODES.map((promo) => {
      const org = orgById.get(promo.orgKey)
      if (!org) throw new Error(`Unknown org key "${promo.orgKey}" on promo "${promo.code}"`)
      if (promo.eventKey && !eventByKey.has(promo.eventKey)) {
        throw new Error(`Unknown event key "${promo.eventKey}" on promo "${promo.code}"`)
      }
      return [
        promo.key,
        {
          key: promo.key,
          id: promo.id,
          organizationId: org.id,
          eventId: promo.eventKey ? eventByKey.get(promo.eventKey).id : null,
          code: promo.code,
          type: promo.type,
          value: promo.value,
          // Required for FIXED_AMOUNT and null for PERCENTAGE, which is
          // currency-neutral. The database rejects the row otherwise.
          currency: promo.currency ?? null,
          maxRedemptions: promo.maxRedemptions,
          redemptionCount: 0,
          startsAt: promo.startsDays === null ? null : offset(anchor, promo.startsDays, 0),
          endsAt: promo.endsDays === null ? null : offset(anchor, promo.endsDays, 23, 59),
          active: promo.active,
        },
      ]
    }),
  )

  const seenReferences = new Set()
  const seenTicketCodes = new Set()

  const orders = ORDERS.map((order) => {
    if (seenReferences.has(order.reference)) {
      throw new Error(`Duplicate order reference "${order.reference}"`)
    }
    seenReferences.add(order.reference)

    const event = eventByKey.get(order.eventKey)
    if (!event) throw new Error(`Unknown event key "${order.eventKey}" on order ${order.reference}`)

    const promo = order.promoKey ? promoByKey.get(order.promoKey) : null
    if (order.promoKey && !promo) {
      throw new Error(`Unknown promo key "${order.promoKey}" on order ${order.reference}`)
    }
    if (promo && promo.eventId && promo.eventId !== event.id) {
      throw new Error(`Promo "${promo.code}" is not valid for event "${event.slug}"`)
    }

    const lines = order.lines.map((line) => {
      const ticketType = ticketTypeByKey.get(line.ticketTypeKey)
      if (!ticketType) {
        throw new Error(`Unknown ticket type "${line.ticketTypeKey}" on order ${order.reference}`)
      }
      if (ticketType.eventId !== event.id) {
        throw new Error(
          `Ticket type "${line.ticketTypeKey}" does not belong to event "${event.slug}"`,
        )
      }
      return {
        ticketTypeKey: line.ticketTypeKey,
        ticketTypeId: ticketType.id,
        quantity: line.quantity,
        unitPriceCents: ticketType.priceCents,
      }
    })

    // An online event has no venue; every organisation here is American, so
    // its supply is taxed as a US one.
    const taxBps = TAX_BPS_BY_COUNTRY[event.venueCountry ?? 'US'] ?? 0
    const totals = computeSeedOrderTotals({ lines, promo, taxBps })

    const placedAt = offset(anchor, order.placedDays, 6, 45)
    const issueTickets = order.issueTickets !== false

    const items = lines.map((line, index) => ({
      id: seedId(`seed-item-${order.key}-${index}`),
      ticketTypeId: line.ticketTypeId,
      ticketTypeKey: line.ticketTypeKey,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      subtotalCents: line.quantity * line.unitPriceCents,
    }))

    /** @type {object[]} */
    const tickets = []
    if (issueTickets) {
      let seat = 0
      for (const [index, item] of items.entries()) {
        for (let n = 0; n < item.quantity; n += 1) {
          const code = `${order.reference}-T${String(index + 1)}${String(n + 1).padStart(2, '0')}`
          if (seenTicketCodes.has(code)) throw new Error(`Duplicate ticket code "${code}"`)
          seenTicketCodes.add(code)
          tickets.push({
            orderItemId: item.id,
            code,
            attendeeName: order.attendees[seat] ?? order.buyerName,
            status: order.ticketStatus ?? 'VALID',
            // Through the door twenty minutes after the start, in whatever
            // zone and season the event fell in — a fixed UTC hour would put
            // some check-ins before the doors opened.
            checkedInAt:
              order.ticketStatus === 'CHECKED_IN'
                ? new Date(event.startsAt.getTime() + CHECK_IN_AFTER_START_MINUTES * MINUTE_MS)
                : null,
          })
          seat += 1
        }
      }
    }

    const payments = order.payments.map((payment) => ({
      provider: 'in-memory',
      providerRef: `pi_${order.reference.toLowerCase().replaceAll('-', '_')}_${payment.suffix}`,
      status: payment.status,
      amountCents: totals.totalCents,
      currency: event.currency,
      failureCode: payment.failureCode ?? null,
    }))

    const holdQuantity = lines.reduce((sum, line) => sum + line.quantity, 0)
    const hold = order.hold
      ? {
          id: seedId(`seed-hold-${order.key}`),
          ticketTypeId: lines[0].ticketTypeId,
          quantity: holdQuantity,
          status: order.hold.status,
          // Every hold has exactly one owner — the database enforces it with
          // the `ticket_hold_single_owner` check constraint. A seeded hold
          // belongs to the buyer who placed the order when there is one, and
          // otherwise carries a deterministic guest digest so the seed stays
          // idempotent rather than minting a new token on every run.
          //
          // User ids are assigned by the database, so the owner travels as an
          // email here and is resolved when the row is written.
          userEmail: order.userKey ? userByKey.get(order.userKey).email : null,
          guestTokenHash: order.userKey ? null : seedGuestTokenHash(order.key),
          // An ACTIVE hold must be genuinely unexpired for the availability
          // logic to treat it as reserved, so it tracks the wall clock rather
          // than the day anchor.
          expiresAt: order.hold.liveExpiryMinutes
            ? new Date(now.getTime() + order.hold.liveExpiryMinutes * MINUTE_MS)
            : new Date(placedAt.getTime() + (order.hold.offsetMinutes ?? 10) * MINUTE_MS),
        }
      : null

    return {
      key: order.key,
      id: seedId(`seed-order-${order.key}`),
      reference: order.reference,
      eventId: event.id,
      eventKey: event.key,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      userEmail: order.userKey ? userByKey.get(order.userKey).email : null,
      status: order.status,
      currency: event.currency,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      feesCents: totals.feesCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      promoCodeId: promo ? promo.id : null,
      promoKey: promo ? promo.key : null,
      expiresAt:
        order.status === 'PENDING'
          ? new Date(now.getTime() + 10 * MINUTE_MS)
          : order.status === 'EXPIRED'
            ? new Date(placedAt.getTime() + 10 * MINUTE_MS)
            : null,
      paidAt: order.status === 'PAID' || order.status === 'REFUNDED' ? placedAt : null,
      cancelledAt:
        order.status === 'CANCELLED'
          ? offset(anchor, order.cancelledDays ?? order.placedDays, 8)
          : order.status === 'REFUNDED'
            ? offset(anchor, order.refundedDays ?? order.placedDays, 8)
            : null,
      items,
      tickets,
      payments,
      hold,
    }
  })

  // Derive inventory and redemption counters from the orders above.
  for (const order of orders) {
    if (order.status === 'PAID') {
      for (const item of order.items) {
        const ticketType = ticketTypeByKey.get(item.ticketTypeKey)
        ticketType.quantitySold += item.quantity
      }
    }
    if (order.promoKey && REDEEMING_STATUSES.has(order.status)) {
      promoByKey.get(order.promoKey).redemptionCount += 1
    }
  }

  const ticketTypes = [...ticketTypeByKey.values()].map((ticketType) => {
    if (ticketType.quantitySold > ticketType.quantityTotal) {
      throw new Error(
        `Ticket type "${ticketType.key}" is oversold: ${ticketType.quantitySold}/${ticketType.quantityTotal}`,
      )
    }
    const soldOut = ticketType.quantitySold >= ticketType.quantityTotal
    return {
      ...ticketType,
      status: ticketType.declaredStatus === 'ON_SALE' && soldOut ? 'SOLD_OUT' : ticketType.status,
    }
  })

  const promoCodes = [...promoByKey.values()].map((promo) => {
    if (promo.maxRedemptions !== null && promo.redemptionCount > promo.maxRedemptions) {
      throw new Error(`Promo "${promo.code}" exceeds its redemption cap`)
    }
    return promo
  })

  const waitlist = WAITLIST.map((entry, index) => {
    const event = eventByKey.get(entry.eventKey)
    if (!event) throw new Error(`Unknown event key "${entry.eventKey}" on waitlist entry ${index}`)
    return {
      eventId: event.id,
      userEmail: entry.userKey ? userByKey.get(entry.userKey).email : null,
      email: entry.email,
      quantity: entry.quantity,
      notified: false,
    }
  })

  const auditLogs = [
    {
      id: seedId('seed-audit-publish-night-one'),
      actorEmail: userByKey.get('nisha').email,
      action: 'event.publish',
      entityType: 'Event',
      entityId: eventByKey.get('night-one').id,
      metadata: { slug: 'navratri-night-one-edison', channel: 'dashboard' },
      createdAt: offset(anchor, -42, 9),
    },
    {
      id: seedId('seed-audit-publish-dandiya-dhol'),
      actorEmail: userByKey.get('anjali').email,
      action: 'event.publish',
      entityType: 'Event',
      entityId: eventByKey.get('dandiya-dhol').id,
      metadata: { slug: 'dandiya-dhol-houston', channel: 'dashboard' },
      createdAt: offset(anchor, -40, 14),
    },
    {
      id: seedId('seed-audit-refund-us08'),
      actorEmail: userByKey.get('priti').email,
      action: 'order.refund',
      entityType: 'Order',
      entityId: seedId('seed-order-us08'),
      metadata: { reference: 'DE-US-200008', reason: 'buyer_request' },
      createdAt: offset(anchor, -3, 8),
    },
    {
      id: seedId('seed-audit-checkin-warm-up'),
      actorEmail: userByKey.get('meera').email,
      action: 'ticket.check_in',
      entityType: 'Order',
      entityId: seedId('seed-order-us04'),
      metadata: { reference: 'DE-US-200004', gate: 'Main doors' },
      createdAt: new Date(
        eventByKey.get('warm-up').startsAt.getTime() + CHECK_IN_AFTER_START_MINUTES * MINUTE_MS,
      ),
    },
  ]

  return {
    anchor,
    users,
    organizations,
    venues,
    events,
    ticketTypes,
    promoCodes,
    orders,
    waitlist,
    auditLogs,
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

// `PrismaClient` below is the client returned by `createPrismaClient`. It is
// written as a bare name rather than `import('@prisma/client').PrismaClient`
// because the repository's shared ESLint config runs eslint-plugin-jsdoc in
// standard `jsdoc` mode, which rejects TypeScript-style import types.

/**
 * Write the dataset produced by {@link buildSeedData} to PostgreSQL.
 *
 * Every statement is an upsert on a natural unique key or on a stable seed id,
 * so the function is safe to call repeatedly against the same database. Rows
 * are written parents-first to satisfy foreign keys.
 *
 * @param {PrismaClient} prisma Client to write through.
 * @param {SeedData} data Dataset to persist.
 * @returns {Promise<Record<string, number>>} Row counts per model after writing.
 */
export async function writeSeedData(prisma, data) {
  /** @type {Map<string, string>} email -> User.id */
  const userIdByEmail = new Map()

  /**
   * Computed id -> the id the database actually holds, for rows upserted on a
   * natural key. Empty when the database was created by this version.
   *
   * @type {Map<string, string>}
   */
  const realId = new Map()

  /**
   * Resolve a computed id to the one the database holds.
   *
   * @param {string|null|undefined} id A computed id.
   * @returns {string|null|undefined} The real id, or the input when unmapped.
   */
  const real = (id) => (id == null ? id : (realId.get(id) ?? id))

  for (const user of data.users) {
    const fields = {
      passwordHash: user.passwordHash,
      displayName: user.displayName,
      phone: user.phone,
      locale: user.locale,
      role: user.role,
      emailVerified: user.emailVerified,
    }
    const row = await prisma.user.upsert({
      where: { email: user.email },
      update: fields,
      create: { email: user.email, ...fields },
      select: { id: true },
    })
    userIdByEmail.set(user.email, row.id)
  }

  for (const org of data.organizations) {
    const fields = {
      name: org.name,
      description: org.description,
      contactEmail: org.contactEmail,
      websiteUrl: org.websiteUrl,
      verified: org.verified,
      // The public badge reads this, not `verified`; left to its default, every
      // seeded organiser would show as unverified and could not publish.
      verificationStatus: org.verificationStatus,
      payoutCurrency: org.payoutCurrency,
      // Both default to India in the schema, from before the catalogue moved.
      timezone: org.timezone,
      refundPolicy: org.refundPolicy,
    }
    const row = await prisma.organization.upsert({
      where: { slug: org.slug },
      update: fields,
      create: { id: org.id, slug: org.slug, ...fields },
      select: { id: true },
    })

    // An upsert keyed on the slug matches an existing row and keeps *its* id,
    // which need not be the one this run computed — a database seeded by an
    // older version of this script holds different ids entirely. Every foreign
    // key below therefore goes through `realId`, exactly as user ids already
    // go through `userIdByEmail`. Without this the seed only works against a
    // database it created itself.
    realId.set(org.id, row.id)
  }

  let membershipCount = 0
  for (const org of data.organizations) {
    for (const member of org.members) {
      const userId = userIdByEmail.get(member.email)
      await prisma.membership.upsert({
        where: { userId_organizationId: { userId, organizationId: real(org.id) } },
        update: { role: member.role },
        create: { userId, organizationId: real(org.id), role: member.role },
      })
      membershipCount += 1
    }
  }

  for (const venue of data.venues) {
    const fields = {
      // A venue with no slug has no public page and is left out of the venue
      // directory, so the demo's six venues had neither until Phase 4.
      slug: venue.slug,
      name: venue.name,
      addressLine1: venue.addressLine1,
      addressLine2: venue.addressLine2,
      city: venue.city,
      region: venue.region,
      postalCode: venue.postalCode,
      country: venue.country,
      latitude: venue.latitude,
      longitude: venue.longitude,
      capacity: venue.capacity,
      // The column defaults to Asia/Kolkata; a US venue has to say its own zone.
      timezone: venue.timezone,
      accessibility: venue.accessibility,
    }
    await prisma.venue.upsert({
      where: { id: venue.id },
      update: fields,
      create: { id: venue.id, ...fields },
    })
  }

  for (const event of data.events) {
    const fields = {
      organizationId: real(event.organizationId),
      venueId: real(event.venueId),
      title: event.title,
      summary: event.summary,
      description: event.description,
      category: event.category,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      coverImageUrl: event.coverImageUrl,
      isOnline: event.isOnline,
      onlineUrl: event.onlineUrl,
      languages: event.languages,
      publishedAt: event.publishedAt,
      salesOpenedAt: event.salesOpenedAt,
      postponedAt: event.postponedAt,
      previousStartsAt: event.previousStartsAt,
      cancelledAt: event.cancelledAt,
      cancellationReason: event.cancellationReason,
    }
    const eventRow = await prisma.event.upsert({
      where: { slug: event.slug },
      update: fields,
      create: { id: event.id, slug: event.slug, ...fields },
      select: { id: true },
    })

    // Same reasoning as organizations: the slug matched an existing row, whose
    // id is authoritative regardless of what this run computed.
    realId.set(event.id, eventRow.id)
  }

  // Promo codes are written before orders because orders reference them.
  for (const promo of data.promoCodes) {
    const fields = {
      eventId: real(promo.eventId),
      type: promo.type,
      value: promo.value,
      currency: promo.currency ?? null,
      maxRedemptions: promo.maxRedemptions,
      redemptionCount: promo.redemptionCount,
      startsAt: promo.startsAt,
      endsAt: promo.endsAt,
      active: promo.active,
    }
    const promoRow = await prisma.promoCode.upsert({
      where: {
        organizationId_code: { organizationId: real(promo.organizationId), code: promo.code },
      },
      update: fields,
      create: {
        id: promo.id,
        organizationId: real(promo.organizationId),
        code: promo.code,
        ...fields,
      },
      select: { id: true },
    })

    realId.set(promo.id, promoRow.id)
  }

  for (const ticketType of data.ticketTypes) {
    const fields = {
      eventId: real(ticketType.eventId),
      name: ticketType.name,
      description: ticketType.description,
      priceCents: ticketType.priceCents,
      currency: ticketType.currency,
      quantityTotal: ticketType.quantityTotal,
      quantitySold: ticketType.quantitySold,
      minPerOrder: ticketType.minPerOrder,
      maxPerOrder: ticketType.maxPerOrder,
      salesStartAt: ticketType.salesStartAt,
      salesEndAt: ticketType.salesEndAt,
      status: ticketType.status,
      sortOrder: ticketType.sortOrder,
    }
    await prisma.ticketType.upsert({
      where: { id: ticketType.id },
      update: fields,
      create: { id: ticketType.id, ...fields },
    })
  }

  let orderItemCount = 0
  let ticketCount = 0
  let paymentCount = 0
  let holdCount = 0

  for (const order of data.orders) {
    const fields = {
      eventId: real(order.eventId),
      userId: order.userEmail ? userIdByEmail.get(order.userEmail) : null,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      status: order.status,
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      feesCents: order.feesCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      promoCodeId: real(order.promoCodeId),
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      cancelledAt: order.cancelledAt,
    }
    const row = await prisma.order.upsert({
      where: { reference: order.reference },
      update: fields,
      create: { id: order.id, reference: order.reference, ...fields },
      select: { id: true },
    })
    const orderId = row.id
    realId.set(order.id, orderId)

    for (const item of order.items) {
      const itemFields = {
        orderId,
        ticketTypeId: item.ticketTypeId,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        subtotalCents: item.subtotalCents,
      }
      await prisma.orderItem.upsert({
        where: { id: item.id },
        update: itemFields,
        create: { id: item.id, ...itemFields },
      })
      orderItemCount += 1
    }

    for (const ticket of order.tickets) {
      const ticketFields = {
        orderItemId: ticket.orderItemId,
        attendeeName: ticket.attendeeName,
        status: ticket.status,
        checkedInAt: ticket.checkedInAt,
      }
      await prisma.ticket.upsert({
        where: { code: ticket.code },
        update: ticketFields,
        create: { code: ticket.code, ...ticketFields },
      })
      ticketCount += 1
    }

    for (const payment of order.payments) {
      const paymentFields = {
        orderId,
        status: payment.status,
        amountCents: payment.amountCents,
        currency: payment.currency,
        failureCode: payment.failureCode,
      }
      await prisma.payment.upsert({
        where: {
          provider_providerRef: { provider: payment.provider, providerRef: payment.providerRef },
        },
        update: paymentFields,
        create: {
          provider: payment.provider,
          providerRef: payment.providerRef,
          ...paymentFields,
        },
      })
      paymentCount += 1
    }

    if (order.hold) {
      const holdFields = {
        ticketTypeId: order.hold.ticketTypeId,
        orderId,
        quantity: order.hold.quantity,
        status: order.hold.status,
        expiresAt: order.hold.expiresAt,
        userId: order.hold.userEmail ? userIdByEmail.get(order.hold.userEmail) : null,
        guestTokenHash: order.hold.userEmail ? null : order.hold.guestTokenHash,
      }
      await prisma.ticketHold.upsert({
        where: { id: order.hold.id },
        update: holdFields,
        create: { id: order.hold.id, ...holdFields },
      })
      holdCount += 1
    }
  }

  for (const entry of data.waitlist) {
    const fields = {
      userId: entry.userEmail ? userIdByEmail.get(entry.userEmail) : null,
      quantity: entry.quantity,
      notified: entry.notified,
    }
    await prisma.waitlistEntry.upsert({
      where: { eventId_email: { eventId: real(entry.eventId), email: entry.email } },
      update: fields,
      create: { eventId: real(entry.eventId), email: entry.email, ...fields },
    })
  }

  // Audit rows are append-only at the database — `desi_audit_log_immutable`
  // refuses an UPDATE — so re-seeding creates the ones that are missing and
  // leaves the rest alone. It cannot be an upsert: the second run's update
  // would be refused, and an audit row the seed could rewrite would be an audit
  // row nothing else could be trusted not to rewrite either. The sample rows
  // carry fixed ids and fixed content, so skipping them changes nothing.
  for (const log of data.auditLogs) {
    const present = await prisma.auditLog.findUnique({
      where: { id: log.id },
      select: { id: true },
    })

    if (present) continue

    await prisma.auditLog.create({
      data: {
        id: log.id,
        actorId: userIdByEmail.get(log.actorEmail) ?? null,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        createdAt: log.createdAt,
      },
    })
  }

  return {
    users: data.users.length,
    organizations: data.organizations.length,
    memberships: membershipCount,
    venues: data.venues.length,
    events: data.events.length,
    ticketTypes: data.ticketTypes.length,
    promoCodes: data.promoCodes.length,
    orders: data.orders.length,
    orderItems: orderItemCount,
    tickets: ticketCount,
    payments: paymentCount,
    ticketHolds: holdCount,
    waitlistEntries: data.waitlist.length,
    auditLogs: data.auditLogs.length,
  }
}

/**
 * Count every seeded model, so the summary reports what is actually in the
 * database rather than what this run intended to write.
 *
 * @param {PrismaClient} prisma Client to read through.
 * @returns {Promise<Record<string, number>>} Row count per model.
 */
export async function countRows(prisma) {
  const [
    users,
    organizations,
    memberships,
    venues,
    events,
    ticketTypes,
    ticketHolds,
    promoCodes,
    orders,
    orderItems,
    tickets,
    payments,
    waitlistEntries,
    auditLogs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.membership.count(),
    prisma.venue.count(),
    prisma.event.count(),
    prisma.ticketType.count(),
    prisma.ticketHold.count(),
    prisma.promoCode.count(),
    prisma.order.count(),
    prisma.orderItem.count(),
    prisma.ticket.count(),
    prisma.payment.count(),
    prisma.waitlistEntry.count(),
    prisma.auditLog.count(),
  ])

  return {
    users,
    organizations,
    memberships,
    venues,
    events,
    ticketTypes,
    ticketHolds,
    promoCodes,
    orders,
    orderItems,
    tickets,
    payments,
    waitlistEntries,
    auditLogs,
  }
}

/**
 * Build and write the dataset, then print a summary.
 *
 * @param {object} [options] Run options.
 * @param {string} [options.connectionString] Database to seed. Defaults to `DATABASE_URL`.
 * @param {Date} [options.now] Instant to treat as "now", for reproducible runs.
 * @returns {Promise<Record<string, number>>} Row counts after seeding.
 * @throws {Error} If no connection string is available or a write fails.
 */
export async function runSeed(options = {}) {
  const prisma = createPrismaClient({ connectionString: options.connectionString })

  try {
    const data = buildSeedData(options.now ?? new Date())
    const written = await writeSeedData(prisma, data)
    const counts = await countRows(prisma)

    const published = data.events.filter((event) => event.publishedAt !== null).length
    const online = data.events.filter((event) => event.isOnline).length
    const paidOrders = data.orders.filter((order) => order.status === 'PAID')
    const grossCents = paidOrders.reduce((sum, order) => sum + order.totalCents, 0)
    const soldOut = data.ticketTypes.filter((type) => type.status === 'SOLD_OUT').length

    console.log('Desi-Event seed complete.')
    console.log(`  anchor (midnight UTC)   ${data.anchor.toISOString()}`)
    console.log(`  written this run        ${JSON.stringify(written)}`)
    console.log('')
    console.log('  rows in database:')
    for (const [model, count] of Object.entries(counts)) {
      console.log(`    ${model.padEnd(22)} ${count}`)
    }
    console.log('')
    console.log(
      `  events                  ${published} public at some point, ${data.events.length - published} draft, ${online} online`,
    )
    console.log(`  ticket types            ${soldOut} sold out`)
    console.log(
      `  paid orders             ${paidOrders.length} worth ${grossCents} cents gross (USD)`,
    )
    console.log(`  seeded login password   ${SEED_PASSWORD} (development only)`)

    return counts
  } finally {
    await prisma.$disconnect()
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (invokedDirectly) {
  try {
    await runSeed()
  } catch (error) {
    console.error('Seed failed:', error)
    process.exitCode = 1
  }
}
