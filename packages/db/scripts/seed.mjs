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
 * `seed-venue-nsci-dome` into a stable CUID-shaped id, so the same row is
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
 * every run, which argues for hand-written keys like `seed-venue-nsci-dome`.
 * But a literal like that is not the shape `@default(cuid())` produces, and
 * seeded rows that look different from real ones hide bugs: response
 * validation rejecting a seeded id is a failure nobody sees until the API is
 * pointed at a seeded database.
 *
 * Hashing the readable key keeps the idempotency — same key, same id, every
 * run — while producing an identifier indistinguishable in shape from one
 * Prisma generates.
 *
 * @param {string} key Stable human-readable key, e.g. `seed-venue-nsci-dome`.
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
 * for fifteen accounts and guards nothing: at the real cost this would add a
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

/** Indian GST on ticketing, and Ontario HST for the Canadian organisation. */
const TAX_BPS_BY_CURRENCY = { INR: 1800, CAD: 1300 }

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

/** Users: one platform admin, two organisation owners, staff and attendees. */
const USERS = [
  {
    key: 'admin',
    email: 'admin@desi-event.com',
    displayName: 'Desi-Event Platform Admin',
    role: 'SUPER_ADMIN',
    locale: 'en-IN',
    phone: '+91 22 6100 4000',
    emailVerified: true,
  },
  {
    key: 'priya',
    email: 'priya.deshmukh@rangmanchlive.in',
    displayName: 'Priya Deshmukh',
    role: 'ORGANIZER',
    locale: 'en-IN',
    phone: '+91 98200 11224',
    emailVerified: true,
  },
  {
    key: 'arjun',
    email: 'arjun.rao@rangmanchlive.in',
    displayName: 'Arjun Rao',
    role: 'ORGANIZER',
    locale: 'en-IN',
    phone: '+91 98200 55831',
    emailVerified: true,
  },
  {
    key: 'meera',
    email: 'meera.iyer@rangmanchlive.in',
    displayName: 'Meera Iyer',
    role: 'ORGANIZER',
    locale: 'ta-IN',
    phone: '+91 98670 23417',
    emailVerified: true,
  },
  {
    key: 'kabir',
    email: 'kabir.shaikh@rangmanchlive.in',
    displayName: 'Kabir Shaikh',
    role: 'ORGANIZER',
    locale: 'hi-IN',
    phone: '+91 99303 77120',
    emailVerified: false,
  },
  {
    key: 'harjit',
    email: 'harjit.gill@torontodesisociety.ca',
    displayName: 'Harjit Gill',
    role: 'ORGANIZER',
    locale: 'en-CA',
    phone: '+1 416 555 0142',
    emailVerified: true,
  },
  {
    key: 'nisha',
    email: 'nisha.patel@torontodesisociety.ca',
    displayName: 'Nisha Patel',
    role: 'ORGANIZER',
    locale: 'en-CA',
    phone: '+1 647 555 0188',
    emailVerified: true,
  },
  {
    key: 'devang',
    email: 'devang.sharma@torontodesisociety.ca',
    displayName: 'Devang Sharma',
    role: 'ORGANIZER',
    locale: 'en-CA',
    phone: '+1 905 555 0119',
    emailVerified: true,
  },
  {
    key: 'accounts',
    email: 'accounts@torontodesisociety.ca',
    displayName: 'TDCS Accounts',
    role: 'ORGANIZER',
    locale: 'en-CA',
    phone: null,
    emailVerified: true,
  },
  {
    key: 'aarav',
    email: 'aarav.mehta@example.com',
    displayName: 'Aarav Mehta',
    role: 'ATTENDEE',
    locale: 'en-IN',
    phone: '+91 98195 44012',
    emailVerified: true,
  },
  {
    key: 'diya',
    email: 'diya.kapoor@example.com',
    displayName: 'Diya Kapoor',
    role: 'ATTENDEE',
    locale: 'hi-IN',
    phone: '+91 97020 31558',
    emailVerified: true,
  },
  {
    key: 'sneha',
    email: 'sneha.reddy@example.com',
    displayName: 'Sneha Reddy',
    role: 'ATTENDEE',
    locale: 'en-IN',
    phone: '+91 91760 22903',
    emailVerified: true,
  },
  {
    key: 'vikram',
    email: 'vikram.bose@example.com',
    displayName: 'Vikram Bose',
    role: 'ATTENDEE',
    locale: 'en-IN',
    phone: '+91 90040 76611',
    emailVerified: true,
  },
  {
    key: 'rohan',
    email: 'rohan.singh@example.ca',
    displayName: 'Rohan Singh',
    role: 'ATTENDEE',
    locale: 'en-CA',
    phone: '+1 416 555 0173',
    emailVerified: true,
  },
  {
    key: 'ananya',
    email: 'ananya.nair@example.ca',
    displayName: 'Ananya Nair',
    role: 'ATTENDEE',
    locale: 'en-CA',
    phone: '+1 647 555 0126',
    emailVerified: false,
  },
]

/** The two seeded organisations and their staff, covering every OrgRole. */
const ORGANIZATIONS = [
  {
    key: 'rangmanch',
    id: seedId('seed-org-rangmanch-live'),
    slug: 'rangmanch-live',
    name: 'Rangmanch Live',
    description:
      'Mumbai concert promoter producing Sufi, Bollywood and indie live music across Maharashtra since 2011.',
    contactEmail: 'box.office@rangmanchlive.in',
    websiteUrl: 'https://rangmanchlive.in',
    verified: true,
    payoutCurrency: 'INR',
    members: [
      { userKey: 'priya', role: 'OWNER' },
      { userKey: 'arjun', role: 'ADMIN' },
      { userKey: 'meera', role: 'MANAGER' },
      { userKey: 'kabir', role: 'STAFF' },
    ],
  },
  {
    key: 'tdcs',
    id: seedId('seed-org-toronto-desi-society'),
    slug: 'toronto-desi-cultural-society',
    name: 'Toronto Desi Cultural Society',
    description:
      'Not-for-profit society in the Greater Toronto Area running Diwali melas, Punjabi folk nights and diaspora arts programming.',
    contactEmail: 'hello@torontodesisociety.ca',
    websiteUrl: 'https://torontodesisociety.ca',
    verified: true,
    payoutCurrency: 'CAD',
    members: [
      { userKey: 'harjit', role: 'OWNER' },
      { userKey: 'nisha', role: 'MANAGER' },
      { userKey: 'devang', role: 'STAFF' },
      { userKey: 'accounts', role: 'VIEWER' },
    ],
  },
]

/** Venues across Indian host cities and the North American diaspora. */
const VENUES = [
  {
    key: 'nsci',
    id: seedId('seed-venue-nsci-dome'),
    name: 'NSCI Dome',
    addressLine1: 'Lala Lajpatrai Marg, Worli',
    addressLine2: 'National Sports Club of India',
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400018',
    country: 'IN',
    latitude: 18.9906,
    longitude: 72.8177,
    capacity: 8000,
  },
  {
    key: 'jio-garden',
    id: seedId('seed-venue-jio-world-garden'),
    name: 'Jio World Garden',
    addressLine1: 'G Block Road, Bandra Kurla Complex',
    addressLine2: 'Bandra East',
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400051',
    country: 'IN',
    latitude: 19.064,
    longitude: 72.8686,
    capacity: 12000,
  },
  {
    key: 'shanmukhananda',
    id: seedId('seed-venue-shanmukhananda-hall'),
    name: 'Shanmukhananda Fine Arts & Sangeetha Sabha',
    addressLine1: '292, Comrade Harbanslal Marg, Sion East',
    addressLine2: null,
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400022',
    country: 'IN',
    latitude: 19.0402,
    longitude: 72.8617,
    capacity: 2765,
  },
  {
    key: 'gucec',
    id: seedId('seed-venue-gu-convention-centre'),
    name: 'Gujarat University Convention & Exhibition Centre',
    addressLine1: 'Gujarat University Campus, Navrangpura',
    addressLine2: 'Opposite Ahmedabad Management Association',
    city: 'Ahmedabad',
    region: 'Gujarat',
    postalCode: '380009',
    country: 'IN',
    latitude: 23.0365,
    longitude: 72.546,
    capacity: 5000,
  },
  {
    key: 'meridian',
    id: seedId('seed-venue-meridian-hall'),
    name: 'Meridian Hall',
    addressLine1: '1 Front Street East',
    addressLine2: null,
    city: 'Toronto',
    region: 'Ontario',
    postalCode: 'M5E 1B2',
    country: 'CA',
    latitude: 43.6465,
    longitude: -79.376,
    capacity: 3191,
  },
  {
    key: 'sangam',
    id: seedId('seed-venue-sangam-banquet'),
    name: 'Sangam Banquet & Convention Centre',
    addressLine1: '6991 Millcreek Drive, Unit 2',
    addressLine2: 'Meadowvale Business Park',
    city: 'Mississauga',
    region: 'Ontario',
    postalCode: 'L5N 6B9',
    country: 'CA',
    latitude: 43.6108,
    longitude: -79.718,
    capacity: 1200,
  },
]

const IST = 'Asia/Kolkata'
const TORONTO = 'America/Toronto'

/**
 * Events with their ticket types. `days` is an offset in whole days from
 * midnight UTC today, so the mix of past and future events stays correct
 * however long the repository sits unused. Times are UTC instants chosen to
 * land on a sensible local evening in the event's own `timezone`.
 */
const EVENTS = [
  {
    key: 'sufi',
    id: seedId('seed-event-sufi-nights'),
    slug: 'mumbai-sufi-nights',
    orgKey: 'rangmanch',
    venueKey: 'nsci',
    title: 'Mumbai Sufi Nights',
    summary: 'An evening of qawwali and contemporary Sufi rock under the NSCI Dome.',
    description:
      'Rangmanch Live presents three hours of qawwali, kalaam and contemporary Sufi rock. The evening opens with a traditional harmonium and tabla set before the headline ensemble takes the stage. Doors open ninety minutes before the first act.',
    category: 'MUSIC_CONCERT',
    status: 'PUBLISHED',
    days: 45,
    startHour: 13,
    startMinute: 30,
    durationHours: 4,
    timezone: IST,
    languages: ['Hindi', 'Urdu', 'English'],
    isOnline: false,
    publishedDays: -50,
    currency: 'INR',
    ticketTypes: [
      {
        key: 'sufi-early',
        name: 'Early Bird',
        description: 'Limited release at the lowest price. Non-transferable.',
        priceCents: 129900,
        quantityTotal: 400,
        minPerOrder: 1,
        maxPerOrder: 6,
        salesStartDays: -50,
        salesEndDays: 10,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'sufi-general',
        name: 'General Admission',
        description: 'Unreserved standing on the arena floor.',
        priceCents: 149900,
        quantityTotal: 5200,
        minPerOrder: 1,
        maxPerOrder: 10,
        salesStartDays: -40,
        salesEndDays: 45,
        status: 'ON_SALE',
        sortOrder: 1,
      },
      {
        key: 'sufi-vip',
        name: 'VIP Gold Circle',
        description: 'Reserved seating in the first eight rows plus interval refreshments.',
        priceCents: 349900,
        quantityTotal: 600,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -40,
        salesEndDays: 45,
        status: 'ON_SALE',
        sortOrder: 2,
      },
      {
        key: 'sufi-front-row',
        name: 'Front Row Table (4 seats)',
        description: 'Four-seat table at the lip of the stage. Extremely limited.',
        priceCents: 1499900,
        quantityTotal: 4,
        minPerOrder: 1,
        maxPerOrder: 2,
        salesStartDays: -40,
        salesEndDays: 45,
        status: 'ON_SALE',
        sortOrder: 3,
      },
    ],
  },
  {
    key: 'garba',
    id: seedId('seed-event-garba-dhamaal'),
    slug: 'navratri-garba-dhamaal-mumbai',
    orgKey: 'rangmanch',
    venueKey: 'jio-garden',
    title: 'Navratri Garba Dhamaal',
    summary: 'Nine nights of live dhol, raas and dandiya in Bandra Kurla Complex.',
    description:
      'A full-scale Navratri ground with a live orchestra, traditional raas circles and a dandiya arena. Traditional attire is encouraged; sticks are available on site. Food stalls serve Gujarati thali, chaat and falooda until close.',
    category: 'GARBA_DANDIYA',
    status: 'PUBLISHED',
    days: 75,
    startHour: 13,
    startMinute: 0,
    durationHours: 6,
    timezone: IST,
    languages: ['Gujarati', 'Hindi'],
    isOnline: false,
    publishedDays: -35,
    currency: 'INR',
    ticketTypes: [
      {
        key: 'garba-season',
        name: 'Season Pass (9 nights)',
        description: 'Entry to all nine nights. Photo identification required at the gate.',
        priceCents: 899900,
        quantityTotal: 900,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -35,
        salesEndDays: 70,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'garba-single',
        name: 'Single Night',
        description: 'Entry for one night of your choosing.',
        priceCents: 149900,
        quantityTotal: 6000,
        minPerOrder: 1,
        maxPerOrder: 10,
        salesStartDays: -30,
        salesEndDays: 75,
        status: 'ON_SALE',
        sortOrder: 1,
      },
      {
        key: 'garba-couple',
        name: 'Couple Pass',
        description: 'Admits two on any single night.',
        priceCents: 249900,
        quantityTotal: 1500,
        minPerOrder: 1,
        maxPerOrder: 5,
        salesStartDays: -30,
        salesEndDays: 75,
        status: 'ON_SALE',
        sortOrder: 2,
      },
    ],
  },
  {
    key: 'bollywood',
    id: seedId('seed-event-bollywood-retro'),
    slug: 'bollywood-retro-night-worli',
    orgKey: 'rangmanch',
    venueKey: 'nsci',
    title: 'Bollywood Retro Night: 90s Rewind',
    summary: 'A live band and DJ set working through three decades of Hindi film music.',
    description:
      'Nine musicians, two vocalists and a DJ run a chronological set from the late seventies to the turn of the millennium. Expect a dance floor rather than seating; a small licensed lounge is open all evening.',
    category: 'BOLLYWOOD_NIGHT',
    status: 'PUBLISHED',
    days: 20,
    startHour: 15,
    startMinute: 0,
    durationHours: 5,
    timezone: IST,
    languages: ['Hindi', 'English'],
    isOnline: false,
    publishedDays: -25,
    currency: 'INR',
    ticketTypes: [
      {
        key: 'bollywood-general',
        name: 'General Admission',
        description: 'Standing entry to the main floor.',
        priceCents: 99900,
        quantityTotal: 3000,
        minPerOrder: 1,
        maxPerOrder: 10,
        salesStartDays: -25,
        salesEndDays: 20,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'bollywood-vip',
        name: 'VIP Lounge',
        description: 'Elevated lounge access with a dedicated bar and cloakroom.',
        priceCents: 249900,
        quantityTotal: 300,
        minPerOrder: 2,
        maxPerOrder: 8,
        salesStartDays: -25,
        salesEndDays: 20,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'bharatanatyam',
    id: seedId('seed-event-bharatanatyam-margam'),
    slug: 'bharatanatyam-margam-shanmukhananda',
    orgKey: 'rangmanch',
    venueKey: 'shanmukhananda',
    title: 'Bharatanatyam Margam: The Full Arc',
    summary: 'A complete traditional margam performed with a live Carnatic ensemble.',
    description:
      'A full margam from alarippu through varnam to thillana, accompanied by nattuvangam, mridangam, violin and vocals. A short pre-performance talk explains the structure for newcomers.',
    category: 'CLASSICAL_DANCE',
    status: 'PUBLISHED',
    days: 32,
    startHour: 12,
    startMinute: 30,
    durationHours: 3,
    timezone: IST,
    languages: ['Tamil', 'English'],
    isOnline: false,
    publishedDays: -18,
    currency: 'INR',
    ticketTypes: [
      {
        key: 'bharatanatyam-balcony',
        name: 'Balcony',
        description: 'Upper tier, unreserved.',
        priceCents: 49900,
        quantityTotal: 900,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -18,
        salesEndDays: 32,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'bharatanatyam-stalls',
        name: 'Stalls',
        description: 'Reserved seating on the main level.',
        priceCents: 99900,
        quantityTotal: 1400,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -18,
        salesEndDays: 32,
        status: 'ON_SALE',
        sortOrder: 1,
      },
      {
        key: 'bharatanatyam-patron',
        name: 'Patron Seat',
        description: 'Front stalls, programme booklet and post-show reception.',
        priceCents: 249900,
        quantityTotal: 120,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -18,
        salesEndDays: 30,
        status: 'ON_SALE',
        sortOrder: 2,
      },
    ],
  },
  {
    key: 'comedy',
    id: seedId('seed-event-desi-diaries-comedy'),
    slug: 'desi-diaries-standup-mumbai',
    orgKey: 'rangmanch',
    venueKey: 'shanmukhananda',
    title: 'Desi Diaries: Stand-Up Showcase',
    summary: 'Four comics, one hour each, mostly in Hinglish.',
    description:
      'A touring showcase of stand-up built around family, migration and the daily absurdities of life in a metro. Strong language throughout; recommended for ages sixteen and over.',
    category: 'COMEDY',
    status: 'PUBLISHED',
    days: -30,
    startHour: 14,
    startMinute: 0,
    durationHours: 3,
    timezone: IST,
    languages: ['Hindi', 'English'],
    isOnline: false,
    publishedDays: -90,
    currency: 'INR',
    ticketTypes: [
      {
        key: 'comedy-general',
        name: 'General Admission',
        description: 'Unreserved seating.',
        priceCents: 79900,
        quantityTotal: 1600,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -90,
        salesEndDays: -30,
        status: 'CLOSED',
        sortOrder: 0,
      },
      {
        key: 'comedy-front',
        name: 'Front Block',
        description: 'First six rows, reserved.',
        priceCents: 139900,
        quantityTotal: 300,
        minPerOrder: 1,
        maxPerOrder: 6,
        salesStartDays: -90,
        salesEndDays: -30,
        status: 'CLOSED',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'rasotsav',
    id: seedId('seed-event-rasotsav-food-festival'),
    slug: 'rasotsav-ahmedabad-food-festival',
    orgKey: 'rangmanch',
    venueKey: 'gucec',
    title: 'Rasotsav: Ahmedabad Food Festival',
    summary: 'Sixty regional kitchens, live counters and a Gujarati thali masterclass.',
    description:
      'A weekend of regional Indian cooking with sixty kitchens under one roof, hourly live demonstrations and a ticketed thali masterclass. Entry tickets include a tasting card loaded with twelve tokens.',
    category: 'FOOD_FESTIVAL',
    status: 'PUBLISHED',
    days: -60,
    startHour: 5,
    startMinute: 30,
    durationHours: 10,
    timezone: IST,
    languages: ['Gujarati', 'Hindi', 'English'],
    isOnline: false,
    publishedDays: -120,
    currency: 'INR',
    ticketTypes: [
      {
        key: 'rasotsav-day',
        name: 'Day Pass',
        description: 'Entry for one day with a twelve-token tasting card.',
        priceCents: 49900,
        quantityTotal: 4000,
        minPerOrder: 1,
        maxPerOrder: 10,
        salesStartDays: -120,
        salesEndDays: -60,
        status: 'CLOSED',
        sortOrder: 0,
      },
      {
        key: 'rasotsav-weekend',
        name: 'Weekend Pass',
        description: 'Both days plus priority entry to live demonstrations.',
        priceCents: 89900,
        quantityTotal: 1500,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -120,
        salesEndDays: -60,
        status: 'CLOSED',
        sortOrder: 1,
      },
      {
        key: 'rasotsav-masterclass',
        name: 'Thali Masterclass',
        description: 'Ninety-minute hands-on class, includes the day pass.',
        priceCents: 179900,
        quantityTotal: 60,
        minPerOrder: 1,
        maxPerOrder: 2,
        salesStartDays: -120,
        salesEndDays: -62,
        status: 'CLOSED',
        sortOrder: 2,
      },
    ],
  },
  {
    key: 'tabla',
    id: seedId('seed-event-tabla-masterclass'),
    slug: 'tabla-masterclass-online',
    orgKey: 'rangmanch',
    venueKey: null,
    title: 'Tabla Masterclass: Teentaal from Scratch',
    summary: 'A live online workshop on the sixteen-beat cycle for absolute beginners.',
    description:
      'Two hours of live instruction covering bol vocabulary, hand position and a first teentaal kaida. A recording stays available to ticket holders for thirty days. No instrument required for the first half.',
    category: 'WORKSHOP',
    status: 'PUBLISHED',
    days: 28,
    startHour: 11,
    startMinute: 30,
    durationHours: 2,
    timezone: IST,
    languages: ['Hindi', 'English'],
    isOnline: true,
    onlineUrl: 'https://live.rangmanchlive.in/tabla-teentaal',
    publishedDays: -14,
    currency: 'INR',
    ticketTypes: [
      {
        key: 'tabla-standard',
        name: 'Live Access',
        description: 'Join the live session and keep the recording for thirty days.',
        priceCents: 39900,
        quantityTotal: 500,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -14,
        salesEndDays: 28,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'tabla-mentored',
        name: 'Live Access + Feedback',
        description: 'Includes a fifteen-minute one-to-one review of your recorded practice.',
        priceCents: 129900,
        quantityTotal: 40,
        minPerOrder: 1,
        maxPerOrder: 1,
        salesStartDays: -14,
        salesEndDays: 21,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'wedding-expo',
    id: seedId('seed-event-mumbai-wedding-expo'),
    slug: 'mumbai-wedding-expo',
    orgKey: 'rangmanch',
    venueKey: 'jio-garden',
    title: 'Mumbai Wedding Expo',
    summary: 'Two hundred exhibitors across couture, catering, jewellery and venues.',
    description:
      'Draft listing. Floor plan, exhibitor list and the bridal runway schedule are still being confirmed with the venue. Do not publish until the anchor sponsor contract is signed.',
    category: 'WEDDING_EXPO',
    status: 'DRAFT',
    days: 150,
    startHour: 4,
    startMinute: 30,
    durationHours: 9,
    timezone: IST,
    languages: ['Hindi', 'Gujarati', 'English'],
    isOnline: false,
    publishedDays: null,
    currency: 'INR',
    ticketTypes: [
      {
        key: 'wedding-visitor',
        name: 'Visitor Entry',
        description: 'Single-day entry for two.',
        priceCents: 29900,
        quantityTotal: 8000,
        minPerOrder: 1,
        maxPerOrder: 10,
        salesStartDays: 30,
        salesEndDays: 150,
        status: 'DRAFT',
        sortOrder: 0,
      },
      {
        key: 'wedding-trade',
        name: 'Trade Buyer',
        description: 'Industry badge with early access and the buyer lounge.',
        priceCents: 149900,
        quantityTotal: 600,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: 30,
        salesEndDays: 148,
        status: 'DRAFT',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'diwali',
    id: seedId('seed-event-toronto-diwali-mela'),
    slug: 'toronto-diwali-mela',
    orgKey: 'tdcs',
    venueKey: 'meridian',
    title: 'Toronto Diwali Mela',
    summary: 'A full-day mela of music, dance, street food and a rooftop diya lighting.',
    description:
      'The society’s flagship event: an afternoon market of craft and food stalls, a main-stage programme of classical and folk performance, and a communal diya lighting at dusk. Family friendly throughout.',
    category: 'CULTURAL_FESTIVAL',
    status: 'PUBLISHED',
    days: 90,
    startHour: 20,
    startMinute: 0,
    durationHours: 7,
    timezone: TORONTO,
    languages: ['English', 'Hindi', 'Punjabi', 'Gujarati'],
    isOnline: false,
    publishedDays: -60,
    currency: 'CAD',
    ticketTypes: [
      {
        key: 'diwali-early',
        name: 'Early Bird',
        description: 'Discounted general entry, released in a single block.',
        priceCents: 2500,
        quantityTotal: 800,
        minPerOrder: 1,
        maxPerOrder: 6,
        salesStartDays: -60,
        salesEndDays: 20,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'diwali-general',
        name: 'General Admission',
        description: 'Entry to the market and the main-stage programme.',
        priceCents: 4500,
        quantityTotal: 2400,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: -40,
        salesEndDays: 90,
        status: 'ON_SALE',
        sortOrder: 1,
      },
      {
        key: 'diwali-family',
        name: 'Family Pack (2 adults, 3 children)',
        description: 'Best value for households; children must be under fourteen.',
        priceCents: 12000,
        quantityTotal: 500,
        minPerOrder: 1,
        maxPerOrder: 3,
        salesStartDays: -40,
        salesEndDays: 90,
        status: 'ON_SALE',
        sortOrder: 2,
      },
      {
        key: 'diwali-vip',
        name: 'VIP Rooftop',
        description: 'Reserved rooftop terrace for the diya lighting, with catering.',
        priceCents: 18000,
        quantityTotal: 150,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStartDays: -40,
        salesEndDays: 85,
        status: 'PAUSED',
        sortOrder: 3,
      },
    ],
  },
  {
    key: 'punjabi-folk',
    id: seedId('seed-event-punjabi-folk-night'),
    slug: 'punjabi-folk-night-mississauga',
    orgKey: 'tdcs',
    venueKey: 'sangam',
    title: 'Punjabi Folk Night',
    summary: 'Tumbi, dhol and a live bhangra troupe in Meadowvale.',
    description:
      'A seated first half of folk singing with tumbi and algoze, followed by a standing bhangra set with a six-piece dhol line. Late-night langar-style dinner is included with every ticket.',
    category: 'MUSIC_CONCERT',
    status: 'PUBLISHED',
    days: 55,
    startHour: 23,
    startMinute: 0,
    durationHours: 5,
    timezone: TORONTO,
    languages: ['Punjabi', 'English'],
    isOnline: false,
    publishedDays: -45,
    currency: 'CAD',
    ticketTypes: [
      {
        key: 'punjabi-general',
        name: 'General Admission',
        description: 'Standing entry with dinner included.',
        priceCents: 6500,
        quantityTotal: 900,
        minPerOrder: 1,
        maxPerOrder: 10,
        salesStartDays: -45,
        salesEndDays: 55,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'punjabi-table',
        name: 'Reserved Table (8 seats)',
        description: 'A full table of eight with table service through the evening.',
        priceCents: 60000,
        quantityTotal: 60,
        minPerOrder: 1,
        maxPerOrder: 2,
        salesStartDays: -45,
        salesEndDays: 50,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'founders',
    id: seedId('seed-event-desi-founders-mixer'),
    slug: 'desi-founders-mixer-toronto',
    orgKey: 'tdcs',
    venueKey: null,
    title: 'Desi Founders Mixer (Online)',
    summary: 'A moderated online mixer for South Asian founders and operators in Canada.',
    description:
      'Ninety minutes of structured small-group introductions followed by an open room. Attendance is capped so that every breakout stays under eight people. A joining link is emailed one hour before the start.',
    category: 'NETWORKING',
    status: 'PUBLISHED',
    days: 12,
    startHour: 23,
    startMinute: 30,
    durationHours: 2,
    timezone: TORONTO,
    languages: ['English'],
    isOnline: true,
    onlineUrl: 'https://meet.torontodesisociety.ca/founders-mixer',
    publishedDays: -10,
    currency: 'CAD',
    ticketTypes: [
      {
        key: 'founders-member',
        name: 'Society Member',
        description: 'Discounted rate for current society members.',
        priceCents: 1500,
        quantityTotal: 120,
        minPerOrder: 1,
        maxPerOrder: 2,
        salesStartDays: -10,
        salesEndDays: 12,
        status: 'ON_SALE',
        sortOrder: 0,
      },
      {
        key: 'founders-standard',
        name: 'Standard',
        description: 'Open registration.',
        priceCents: 3000,
        quantityTotal: 200,
        minPerOrder: 1,
        maxPerOrder: 2,
        salesStartDays: -10,
        salesEndDays: 12,
        status: 'ON_SALE',
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'tamil-theatre',
    id: seedId('seed-event-tamil-theatre-toronto'),
    slug: 'tamil-theatre-toronto-oorukku-vanakkam',
    orgKey: 'tdcs',
    venueKey: 'meridian',
    title: 'Oorukku Vanakkam: A Tamil Play',
    summary: 'A two-act play about three generations of a Scarborough family.',
    description:
      'Draft listing. Rights are cleared but the cast is not finalised and the surtitle translation is still in review. Hold publication until the director confirms the run dates.',
    category: 'THEATRE',
    status: 'DRAFT',
    days: 120,
    startHour: 23,
    startMinute: 0,
    durationHours: 3,
    timezone: TORONTO,
    languages: ['Tamil', 'English'],
    isOnline: false,
    publishedDays: null,
    currency: 'CAD',
    ticketTypes: [
      {
        key: 'tamil-stalls',
        name: 'Stalls',
        description: 'Main level, reserved seating with English surtitles.',
        priceCents: 5500,
        quantityTotal: 1200,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: 20,
        salesEndDays: 120,
        status: 'DRAFT',
        sortOrder: 0,
      },
      {
        key: 'tamil-mezzanine',
        name: 'Mezzanine',
        description: 'Upper tier, reserved seating.',
        priceCents: 3500,
        quantityTotal: 800,
        minPerOrder: 1,
        maxPerOrder: 8,
        salesStartDays: 20,
        salesEndDays: 120,
        status: 'DRAFT',
        sortOrder: 1,
      },
    ],
  },
]

/** Promo codes of both types, one organisation-wide and one event-scoped each. */
const PROMO_CODES = [
  {
    key: 'earlydesi',
    id: seedId('seed-promo-earlydesi'),
    orgKey: 'rangmanch',
    eventKey: null,
    code: 'EARLYDESI',
    type: 'PERCENTAGE',
    value: 1500,
    maxRedemptions: 200,
    startsDays: -30,
    endsDays: 30,
    active: true,
  },
  {
    key: 'garba500',
    id: seedId('seed-promo-garba500'),
    orgKey: 'rangmanch',
    eventKey: 'garba',
    code: 'GARBA500',
    type: 'FIXED_AMOUNT',
    // A flat discount is denominated: ₹500 off, never CA$500 off. The
    // `promo_code_fixed_amount_currency` check constraint rejects the row
    // without this.
    currency: 'INR',
    value: 50000,
    maxRedemptions: 500,
    startsDays: -20,
    endsDays: 60,
    active: true,
  },
  {
    key: 'diwali10',
    id: seedId('seed-promo-diwali10'),
    orgKey: 'tdcs',
    eventKey: 'diwali',
    code: 'DIWALI10',
    type: 'PERCENTAGE',
    value: 1000,
    maxRedemptions: 300,
    startsDays: -40,
    endsDays: 80,
    active: true,
  },
  {
    key: 'tdcswelcome',
    id: seedId('seed-promo-tdcs-welcome'),
    orgKey: 'tdcs',
    eventKey: null,
    code: 'WELCOME5',
    type: 'FIXED_AMOUNT',
    // Toronto Desi Cultural Society sells in CAD, so CA$5 off.
    currency: 'CAD',
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
    key: 'o1',
    reference: 'DE-MUM-100001',
    eventKey: 'bollywood',
    userKey: 'aarav',
    buyerName: 'Aarav Mehta',
    buyerEmail: 'aarav.mehta@example.com',
    status: 'PAID',
    promoKey: 'earlydesi',
    placedDays: -12,
    lines: [{ ticketTypeKey: 'bollywood-general', quantity: 2 }],
    attendees: ['Aarav Mehta', 'Ishita Mehta'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'o2',
    reference: 'DE-MUM-100002',
    eventKey: 'sufi',
    userKey: 'diya',
    buyerName: 'Diya Kapoor',
    buyerEmail: 'diya.kapoor@example.com',
    status: 'PAID',
    promoKey: null,
    placedDays: -9,
    lines: [
      { ticketTypeKey: 'sufi-vip', quantity: 1 },
      { ticketTypeKey: 'sufi-general', quantity: 2 },
    ],
    attendees: ['Diya Kapoor', 'Rhea Kapoor', 'Nikhil Kapoor'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'o3',
    reference: 'DE-MUM-100003',
    eventKey: 'garba',
    userKey: 'sneha',
    buyerName: 'Sneha Reddy',
    buyerEmail: 'sneha.reddy@example.com',
    status: 'PAID',
    promoKey: 'garba500',
    placedDays: -7,
    lines: [{ ticketTypeKey: 'garba-couple', quantity: 2 }],
    attendees: ['Sneha Reddy', 'Karthik Reddy'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'o4',
    reference: 'DE-AMD-100004',
    eventKey: 'rasotsav',
    userKey: 'vikram',
    buyerName: 'Vikram Bose',
    buyerEmail: 'vikram.bose@example.com',
    status: 'PAID',
    promoKey: null,
    placedDays: -70,
    lines: [
      { ticketTypeKey: 'rasotsav-day', quantity: 3 },
      { ticketTypeKey: 'rasotsav-masterclass', quantity: 1 },
    ],
    attendees: ['Vikram Bose', 'Ritu Bose', 'Aniket Bose', 'Vikram Bose'],
    ticketStatus: 'CHECKED_IN',
    checkedInDays: -60,
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'o5',
    reference: 'DE-MUM-100005',
    eventKey: 'sufi',
    userKey: 'vikram',
    buyerName: 'Vikram Bose',
    buyerEmail: 'vikram.bose@example.com',
    status: 'PAID',
    promoKey: 'earlydesi',
    placedDays: -4,
    // Takes the whole Front Row Table allocation, so that ticket type is
    // genuinely sold out rather than merely labelled that way.
    lines: [{ ticketTypeKey: 'sufi-front-row', quantity: 4 }],
    attendees: ['Vikram Bose', 'Ritu Bose', 'Neel Bose', 'Aniket Bose'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'o6',
    reference: 'DE-TOR-100006',
    eventKey: 'diwali',
    userKey: 'ananya',
    buyerName: 'Ananya Nair',
    buyerEmail: 'ananya.nair@example.ca',
    status: 'PAID',
    promoKey: 'diwali10',
    placedDays: -6,
    lines: [
      { ticketTypeKey: 'diwali-general', quantity: 2 },
      { ticketTypeKey: 'diwali-family', quantity: 1 },
    ],
    attendees: ['Ananya Nair', 'Sunil Nair', 'Nair Family'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'o7',
    reference: 'DE-TOR-100007',
    eventKey: 'diwali',
    userKey: 'rohan',
    buyerName: 'Rohan Singh',
    buyerEmail: 'rohan.singh@example.ca',
    status: 'PENDING',
    promoKey: null,
    placedDays: 0,
    lines: [{ ticketTypeKey: 'diwali-early', quantity: 2 }],
    attendees: ['Rohan Singh', 'Gurpreet Singh'],
    // A PENDING order has not issued tickets yet; inventory is held instead.
    issueTickets: false,
    payments: [{ suffix: 'a', status: 'INITIATED', amount: 'total' }],
    hold: { status: 'ACTIVE', liveExpiryMinutes: 10 },
  },
  {
    key: 'o8',
    reference: 'DE-TOR-100008',
    eventKey: 'punjabi-folk',
    userKey: 'rohan',
    buyerName: 'Rohan Singh',
    buyerEmail: 'rohan.singh@example.ca',
    status: 'REFUNDED',
    promoKey: null,
    placedDays: -15,
    refundedDays: -8,
    lines: [{ ticketTypeKey: 'punjabi-general', quantity: 4 }],
    attendees: ['Rohan Singh', 'Gurpreet Singh', 'Jaspreet Kaur', 'Manav Singh'],
    ticketStatus: 'REFUNDED',
    payments: [
      { suffix: 'a', status: 'SUCCEEDED', amount: 'total' },
      { suffix: 'r', status: 'REFUNDED', amount: 'total' },
    ],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'o9',
    reference: 'DE-TOR-100009',
    eventKey: 'punjabi-folk',
    userKey: 'ananya',
    buyerName: 'Ananya Nair',
    buyerEmail: 'ananya.nair@example.ca',
    status: 'CANCELLED',
    promoKey: null,
    placedDays: -11,
    cancelledDays: -11,
    lines: [{ ticketTypeKey: 'punjabi-table', quantity: 1 }],
    attendees: ['Nair Party of Eight'],
    ticketStatus: 'VOID',
    payments: [{ suffix: 'a', status: 'FAILED', amount: 'total', failureCode: 'card_declined' }],
    hold: { status: 'RELEASED', offsetMinutes: 10 },
  },
  {
    key: 'o10',
    reference: 'DE-MUM-100010',
    eventKey: 'bharatanatyam',
    userKey: null,
    buyerName: 'Lakshmi Subramanian',
    buyerEmail: 'lakshmi.subramanian@example.com',
    status: 'EXPIRED',
    promoKey: null,
    placedDays: -3,
    lines: [{ ticketTypeKey: 'bharatanatyam-stalls', quantity: 2 }],
    attendees: ['Lakshmi Subramanian', 'Guest'],
    issueTickets: false,
    payments: [],
    hold: { status: 'EXPIRED', offsetMinutes: 10 },
  },
  {
    key: 'o11',
    reference: 'DE-MUM-100011',
    eventKey: 'tabla',
    userKey: 'diya',
    buyerName: 'Diya Kapoor',
    buyerEmail: 'diya.kapoor@example.com',
    status: 'PAID',
    promoKey: null,
    placedDays: -5,
    lines: [{ ticketTypeKey: 'tabla-mentored', quantity: 1 }],
    attendees: ['Diya Kapoor'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
  {
    key: 'o12',
    reference: 'DE-TOR-100012',
    eventKey: 'founders',
    userKey: 'ananya',
    buyerName: 'Ananya Nair',
    buyerEmail: 'ananya.nair@example.ca',
    status: 'PAID',
    promoKey: null,
    placedDays: -2,
    lines: [{ ticketTypeKey: 'founders-standard', quantity: 1 }],
    attendees: ['Ananya Nair'],
    ticketStatus: 'VALID',
    payments: [{ suffix: 'a', status: 'SUCCEEDED', amount: 'total' }],
    hold: { status: 'CONVERTED', offsetMinutes: 10 },
  },
]

/** Waitlist interest, including on the sold-out Front Row Table allocation. */
const WAITLIST = [
  { eventKey: 'sufi', userKey: 'aarav', email: 'aarav.mehta@example.com', quantity: 4 },
  { eventKey: 'sufi', userKey: null, email: 'zara.qureshi@example.com', quantity: 2 },
  { eventKey: 'garba', userKey: 'sneha', email: 'sneha.reddy@example.com', quantity: 6 },
  { eventKey: 'diwali', userKey: null, email: 'harpreet.bains@example.ca', quantity: 5 },
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
    members: org.members.map((member) => {
      const user = userByKey.get(member.userKey)
      if (!user) throw new Error(`Unknown user key "${member.userKey}" in org "${org.key}"`)
      return { email: user.email, role: member.role }
    }),
  }))
  const orgById = new Map(organizations.map((org) => [org.key, org]))

  const venueById = new Map(VENUES.map((venue) => [venue.key, venue]))

  const events = EVENTS.map((event) => {
    const org = orgById.get(event.orgKey)
    if (!org) throw new Error(`Unknown org key "${event.orgKey}" on event "${event.key}"`)
    if (event.venueKey && !venueById.has(event.venueKey)) {
      throw new Error(`Unknown venue key "${event.venueKey}" on event "${event.key}"`)
    }

    const startsAt = offset(anchor, event.days, event.startHour, event.startMinute)

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
      coverImageUrl: `https://images.desi-event.com/events/${event.slug}/cover.jpg`,
      isOnline: event.isOnline,
      onlineUrl: event.onlineUrl ?? null,
      languages: event.languages,
      publishedAt: event.publishedDays === null ? null : offset(anchor, event.publishedDays, 9),
      currency: event.currency,
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

    const taxBps = TAX_BPS_BY_CURRENCY[event.currency] ?? 0
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
            checkedInAt:
              order.ticketStatus === 'CHECKED_IN'
                ? offset(anchor, order.checkedInDays ?? order.placedDays, 6)
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
      id: seedId('seed-audit-publish-sufi'),
      actorEmail: userByKey.get('priya').email,
      action: 'event.publish',
      entityType: 'Event',
      entityId: eventByKey.get('sufi').id,
      metadata: { slug: 'mumbai-sufi-nights', channel: 'dashboard' },
      createdAt: offset(anchor, -50, 9),
    },
    {
      id: seedId('seed-audit-publish-diwali'),
      actorEmail: userByKey.get('harjit').email,
      action: 'event.publish',
      entityType: 'Event',
      entityId: eventByKey.get('diwali').id,
      metadata: { slug: 'toronto-diwali-mela', channel: 'dashboard' },
      createdAt: offset(anchor, -60, 14),
    },
    {
      id: seedId('seed-audit-refund-o8'),
      actorEmail: userByKey.get('nisha').email,
      action: 'order.refund',
      entityType: 'Order',
      entityId: seedId('seed-order-o8'),
      metadata: { reference: 'DE-TOR-100007', reason: 'buyer_request' },
      createdAt: offset(anchor, -8, 8),
    },
    {
      id: seedId('seed-audit-checkin-rasotsav'),
      actorEmail: userByKey.get('kabir').email,
      action: 'ticket.check_in',
      entityType: 'Order',
      entityId: seedId('seed-order-o4'),
      metadata: { reference: 'DE-AMD-100004', gate: 'North' },
      createdAt: offset(anchor, -60, 6),
    },
  ]

  return {
    anchor,
    users,
    organizations,
    venues: VENUES,
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
      payoutCurrency: org.payoutCurrency,
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

    const published = data.events.filter((event) => event.status === 'PUBLISHED').length
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
      `  events                  ${published} published, ${data.events.length - published} draft, ${online} online`,
    )
    console.log(`  ticket types            ${soldOut} sold out`)
    console.log(
      `  paid orders             ${paidOrders.length} worth ${grossCents} cents gross (mixed INR/CAD)`,
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
