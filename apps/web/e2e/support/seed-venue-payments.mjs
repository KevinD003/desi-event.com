/**
 * The accounts and events the booking-fee and pay-at-the-venue journeys need
 * (SPEC3 §14.6, SPEC3-XI §14.6).
 *
 * Every journey in `detail-venue-payments.spec.js` changes something that
 * cannot be taken back: an event's booking fee, its pay-at-the-venue switch, a
 * referral code's uses, a payment taken at the door, an unpaid ticket
 * cancelled, an event cancelled or deleted. None of it may touch a row another
 * spec counts, so everything here is new and carries the tag:
 *
 *   - **Pay Venue <tag>**, a VERIFIED organisation (America/Chicago) with its
 *     owner (`pay-owner-<tag>`, a factor), a FINANCE member (`pay-finance-<tag>`,
 *     a factor) and a SCANNER (`pay-scanner-<tag>`) scoped to every event below.
 *   - The Desi Events team: an ADMIN (`pay-admin-<tag>`), a SUPER_ADMIN
 *     (`pay-super-<tag>`), a FINANCE_ADMIN (`pay-finadmin-<tag>`) and a
 *     MODERATOR (`pay-mod-<tag>`), each with a factor, none a member of the
 *     organisation.
 *   - Three buyers with no factor, whose addresses leave the tag out for the
 *     reason {@link venuePaymentNames} gives.
 *   - Its events:
 *       - **ga**: on sale, a US venue, no nights, one $40 tier of 40, the site's
 *         booking fee, paying at the venue off;
 *       - **twoNights**: on sale, two nights with a $25 tier each and a $45
 *         every-night pass, paying at the venue on (limit 50), and an
 *         organiser's promo code at 25% whose text the seed returns;
 *       - **toronto**: on sale, a venue in Ontario, one $40 (USD) tier, paying
 *         at the venue on (limit 50);
 *       - **draft**, **ended** (on sale, its only night over yesterday),
 *         **cancelled** and **deleted**, for the fee's "any state" rule;
 *       - **pastNight** ("Past Night <tag>"): one $25 night, paying at the
 *         venue on. It is dated ahead at first, so the spec can book it through
 *         the real checkout; {@link finishPastNight} then moves its night to
 *         yesterday and has the scanner take the payment and admit the ticket
 *         during that night.
 *
 * ## Through the API's own writers
 *
 * The switch and the door payment have writers in the API, and those are what
 * this file calls: `setVenuePayment` (`lib/payment-terms.js`) as the seed's
 * administrator, and `previewAdmission` and `confirmAdmission`
 * (`lib/admission.js`), which record the payment with `recordVenuePayment`, as
 * the seed's scanner with the night's time as `now`. No column those writers
 * own is written here by hand.
 *
 * ## Orders
 *
 * The journeys' orders are bought through the real checkout, signed in as the
 * buyer, never written here: a refund goes back to the payment the order was
 * paid with, and the simulated payment provider knows only the payments its
 * own process took. A seeded order's booking fee could not be refunded.
 *
 * ## Cleanup
 *
 * {@link cleanupVenuePayments} takes the fixture users' sessions, factors and
 * memberships, and the events nobody bought, with their nights and tiers, and
 * switches off the referral codes the run's administrators made. An
 * event an order reaches stays, with its organisation and venue: the ledger
 * the checkout posted to is append-only, and the tag is never used again.
 *
 * The audit rows deliberately stay: `desi_audit_log_immutable` refuses an
 * UPDATE or a DELETE on `AuditLog`, and the actor foreign key is ON DELETE SET
 * NULL, so deleting an account would be an update of its audit rows and is
 * refused. Every user row stays with them; without its sessions, factor and
 * memberships a left-behind account is inert.
 *
 * @module e2e/support/seed-venue-payments
 */

import { createHash } from 'node:crypto'

import { createPrismaClient } from '@desi-event/db'
import { hashPassword, seal } from '@desi-event/auth'

import { loadActor } from '../../../api/src/lib/actor.js'
import { confirmAdmission, previewAdmission } from '../../../api/src/lib/admission.js'
import { setVenuePayment } from '../../../api/src/lib/payment-terms.js'
import { checkedTag } from './seed-feature-world.mjs'
import { AUTH_SECRET, CONNECTION, PASSWORD, TOTP_SECRET } from './seed-refusals.mjs'

/** One day, in milliseconds. */
const DAY_MS = 86_400_000

/** One hour, in milliseconds. */
const HOUR_MS = 3_600_000

/** Where the organisation runs its nights, and the US venue's zone. */
export const VENUE_TIME_ZONE = 'America/Chicago'

/** The Ontario venue's zone. */
export const TORONTO_TIME_ZONE = 'America/Toronto'

/** The currency every tier is priced in, the Ontario one too. */
export const VENUE_CURRENCY = 'USD'

/** The general-admission tier's face value, in cents. */
export const GA_PRICE_CENTS = 4_000

/** How many general-admission tickets there are. */
export const GA_QUANTITY = 40

/** A night's tier on the two-night event, in cents. */
export const NIGHT_PRICE_CENTS = 2_500

/** The every-night pass on the two-night event, in cents. */
export const PASS_PRICE_CENTS = 4_500

/** The Toronto tier, in cents (USD). */
export const TORONTO_PRICE_CENTS = 4_000

/** The past night's tier, in cents. */
export const PAST_PRICE_CENTS = 2_500

/** The organiser's promo code on the two-night event: 25% off, in basis points. */
export const PROMO_PERCENT_BPS = 2_500

/** How many tickets may wait to be paid at the door on each event that allows it. */
export const VENUE_LIMIT = 50

/** Why the seed's administrator switched paying at the venue on. */
export const SWITCH_REASON = 'Agreed with the organiser for their community nights.'

/** Why the cancelled event was cancelled. */
const CANCELLED_REASON = 'The hall flooded and the night cannot go ahead.'

/** Why the deleted event was deleted. */
const DELETED_REASON = 'Posted twice by mistake; the other listing is the right one.'

/** What every event's policies say. */
const POLICIES = Object.freeze({
  entry: 'Doors open half an hour before. Bring the pass on your phone.',
  refund: 'Refunds up to seven days before the night.',
  conduct: 'Be kind to each other and to the floor.',
})

/**
 * The journeys' addresses, names, titles and web addresses.
 *
 * Pure, so a spec can name them before anything is seeded.
 *
 * @param {string} tag The run suffix.
 * @returns {object} The names.
 */
export function venuePaymentNames(tag) {
  checkedTag(tag)

  // A digest of the tag, not the tag: the detail world's teardown
  // (`cleanupDetailScreens`) clears every order whose buyer's address
  // contains the tag, and these buyers' orders are the checkout's, pinned by
  // the ledger, and this file's to leave. Still one address per run.
  const digest = createHash('sha256').update(`venue-${tag}`).digest('hex').slice(0, 12)
  const slug = (name) => `pay-venue-${name}-${tag}`

  return {
    adminEmail: `pay-admin-${tag}@platform.test`,
    // Named for the run: the administrators' "By administrator" table is one
    // row per name a reader can see, and a database a developer reuses keeps
    // every earlier run's administrator.
    adminName: `Nandini Rao ${tag}`,
    superEmail: `pay-super-${tag}@platform.test`,
    superName: 'Harish Menon',
    finadminEmail: `pay-finadmin-${tag}@platform.test`,
    finadminName: 'Farah Siddiqui',
    modEmail: `pay-mod-${tag}@platform.test`,
    modName: 'Rohan Dutta',
    ownerEmail: `pay-owner-${tag}@organiser.test`,
    ownerName: 'Kavita Shah',
    financeEmail: `pay-finance-${tag}@organiser.test`,
    financeName: 'Arjun Mehta',
    scannerEmail: `pay-scanner-${tag}@organiser.test`,
    scannerName: 'Sunil Patel',
    buyer1Email: `pay-buyer1-${digest}@attendee.test`,
    buyer1Name: 'Priya Nair',
    buyer2Email: `pay-buyer2-${digest}@attendee.test`,
    buyer2Name: 'Dev Kapoor',
    buyer3Email: `pay-buyer3-${digest}@attendee.test`,
    buyer3Name: 'Meena Iyer',
    organizationName: `Pay Venue ${tag}`,
    organizationSlug: `pay-venue-${tag}`,
    promoCode: `PAYVENUE${tag.toUpperCase()}`,
    events: {
      ga: { title: `Pay Venue Garba ${tag}`, slug: slug('ga') },
      twoNights: { title: `Pay Venue Two Nights ${tag}`, slug: slug('two-nights') },
      toronto: { title: `Pay Venue Toronto ${tag}`, slug: slug('toronto') },
      draft: { title: `Pay Venue Draft ${tag}`, slug: slug('draft') },
      ended: { title: `Pay Venue Ended ${tag}`, slug: slug('ended') },
      cancelled: { title: `Pay Venue Cancelled ${tag}`, slug: slug('cancelled') },
      deleted: { title: `Pay Venue Deleted ${tag}`, slug: slug('deleted') },
      pastNight: { title: `Past Night ${tag}`, slug: slug('past-night') },
    },
  }
}

/**
 * A night, as instants in a zone's evening: doors, start and end.
 *
 * Midnight UTC plus a day, give or take, is evening in Chicago and Toronto;
 * the honest local time is whatever the zone says.
 *
 * @param {number} daysAhead How many days from now; negative for the past.
 * @returns {{doorsOpenAt: Date, startsAt: Date, endsAt: Date}} The instants.
 */
export function venueNight(daysAhead) {
  const day = new Date(Date.now() + daysAhead * DAY_MS)
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())

  return {
    doorsOpenAt: new Date(midnight + 23.5 * HOUR_MS),
    startsAt: new Date(midnight + 24 * HOUR_MS),
    endsAt: new Date(midnight + 28 * HOUR_MS),
  }
}

/**
 * The actor a request from this user would carry, read now.
 *
 * @param {object} prisma The client.
 * @param {string} userId The user.
 * @returns {Promise<object>} The actor.
 */
async function actorOf(prisma, userId) {
  const loaded = await loadActor(prisma, userId)

  if (!loaded) throw new Error(`No user ${userId} to act as.`)

  return loaded.actor
}

/**
 * Seed the accounts, the organisation, its events and their switches.
 *
 * Upserted or found again throughout, because Playwright starts a fresh
 * worker and runs `beforeAll` again after a failure, and a fixture user
 * outlives every run. Events are found by their tagged slug and reused as they
 * are; a switch already on is left on.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<object>} The ids the journeys navigate by.
 */
export async function seedVenuePayments(tag) {
  const names = venuePaymentNames(tag)
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
     * Give an account the confirmed second factor its role asks for, once.
     *
     * Idempotent because `seal` picks a fresh nonce each time, so a blind
     * create would add a second factor to a re-seeded account.
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
    const superAdmin = await account(names.superEmail, names.superName, 'SUPER_ADMIN')
    const finadmin = await account(names.finadminEmail, names.finadminName, 'FINANCE_ADMIN')
    const moderator = await account(names.modEmail, names.modName, 'MODERATOR')
    const owner = await account(names.ownerEmail, names.ownerName, 'ORGANIZER')
    const finance = await account(names.financeEmail, names.financeName, 'ORGANIZER')
    const scanner = await account(names.scannerEmail, names.scannerName, 'ATTENDEE')
    const buyers = [
      await account(names.buyer1Email, names.buyer1Name, 'ATTENDEE'),
      await account(names.buyer2Email, names.buyer2Name, 'ATTENDEE'),
      await account(names.buyer3Email, names.buyer3Name, 'ATTENDEE'),
    ]

    for (const user of [admin, superAdmin, finadmin, moderator, owner, finance]) {
      await enrol(user.id)
    }

    // The buyers and the scanner arrive the way most people do, with no
    // second factor.
    await prisma.mfaFactor.deleteMany({
      where: { userId: { in: [scanner.id, ...buyers.map((buyer) => buyer.id)] } },
    })

    const now = new Date()
    const orgFields = {
      name: names.organizationName,
      contactEmail: `${names.organizationSlug}@example.test`,
      verificationStatus: 'VERIFIED',
      verified: true,
      verificationUpdatedAt: now,
      payoutCurrency: VENUE_CURRENCY,
      timezone: VENUE_TIME_ZONE,
    }
    const organization = await prisma.organization.upsert({
      where: { slug: names.organizationSlug },
      update: orgFields,
      create: { slug: names.organizationSlug, ...orgFields },
    })

    /**
     * One of the organisation's venues, upserted by its slug.
     *
     * @param {string} hallSlug Its slug.
     * @param {object} place Where it is.
     * @returns {Promise<object>} The venue.
     */
    const venueAt = (hallSlug, place) => {
      const hall = {
        name: `${names.organizationName} ${place.city} Hall`,
        addressLine1: '1 Test Plaza',
        organizationId: organization.id,
        provenance: 'organizer',
        ...place,
      }

      return prisma.venue.upsert({
        where: { slug: hallSlug },
        update: hall,
        create: { slug: hallSlug, ...hall },
      })
    }

    const houston = await venueAt(`pay-venue-hall-${tag}`, {
      city: 'Houston',
      region: 'TX',
      postalCode: '77002',
      country: 'US',
      timezone: VENUE_TIME_ZONE,
    })
    const toronto = await venueAt(`pay-venue-toronto-hall-${tag}`, {
      city: 'Toronto',
      region: 'ON',
      postalCode: 'M5V 2T6',
      country: 'CA',
      timezone: TORONTO_TIME_ZONE,
    })

    for (const [user, role] of [
      [owner, 'OWNER'],
      [finance, 'FINANCE'],
      [scanner, 'SCANNER'],
    ]) {
      await prisma.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
        update: { role },
        create: { userId: user.id, organizationId: organization.id, role },
      })
    }

    // Nobody else starts in the organisation, whatever an earlier seed of
    // this tag left: the team at The Desi Events and the buyers are members of
    // none.
    await prisma.membership.deleteMany({
      where: {
        userId: {
          in: [admin.id, superAdmin.id, finadmin.id, moderator.id, ...buyers.map((b) => b.id)],
        },
      },
    })

    /**
     * An event, its nights and a tier per night (plus any listed), found
     * again by its slug when it is there.
     *
     * Inserted in the status it is meant to be in, never moved there: the
     * review gate refuses a move into public that a moderator did not
     * approve, and only `lib/event-deletion.js` moves an event into DELETED.
     *
     * @param {object} spec The event.
     * @param {{title: string, slug: string}} spec.name Its title and slug.
     * @param {string} spec.status Where it stands.
     * @param {number[]} spec.nights Days from now, one per night; empty for an event with none.
     * @param {number} [spec.startsInDays] When an event with no nights starts.
     * @param {number} spec.priceCents Each night's tier's face value (or the one tier's).
     * @param {number} [spec.passCents] An every-night pass at this price, when there is one.
     * @param {number} [spec.quantity] How many of each tier.
     * @param {object} [spec.venue] Where; Houston unless named.
     * @param {string} [spec.timezone] The event's zone.
     * @param {object} [spec.extra] Columns of its own.
     * @returns {Promise<object>} `{id, slug, title, sessions, tiers, passTierId}`.
     */
    async function eventFor({
      name,
      status,
      nights,
      startsInDays = 40,
      priceCents,
      passCents,
      quantity = 100,
      venue = houston,
      timezone = VENUE_TIME_ZONE,
      extra = {},
    }) {
      const include = {
        sessions: { orderBy: { sortOrder: 'asc' } },
        ticketTypes: { orderBy: { sortOrder: 'asc' } },
      }
      const existing = await prisma.event.findUnique({ where: { slug: name.slug }, include })

      if (existing) return described(existing)

      const times = nights.map(venueNight)
      const span =
        times.length > 0
          ? { startsAt: times[0].startsAt, endsAt: times[times.length - 1].endsAt }
          : { startsAt: venueNight(startsInDays).startsAt, endsAt: venueNight(startsInDays).endsAt }
      const posted = status !== 'DRAFT'
      const selling = ['ON_SALE', 'DELETED', 'CANCELLED'].includes(status)
      const event = await prisma.event.create({
        data: {
          organizationId: organization.id,
          venueId: venue.id,
          title: name.title,
          slug: name.slug,
          summary: 'A night of garba under the lights, with a live dhol ensemble.',
          description:
            'Three hours of garba and dandiya raas on a sprung floor, with sticks lent at the door and vegetarian food from seven.',
          category: 'GARBA_DANDIYA',
          status,
          ...span,
          timezone,
          policies: POLICIES,
          contactEmail: `${names.organizationSlug}@example.test`,
          ...(posted ? { publishedAt: now } : {}),
          ...(selling ? { salesOpenedAt: now } : {}),
          ...extra,
        },
      })

      for (const [index, night] of times.entries()) {
        const session = await prisma.eventSession.create({
          data: {
            eventId: event.id,
            ...night,
            timezone,
            status: status === 'ON_SALE' ? 'ON_SALE' : 'SCHEDULED',
            capacity: 200,
            sortOrder: index,
            label: `Night ${index + 1}`,
          },
        })

        await prisma.ticketType.create({
          data: {
            eventId: event.id,
            eventSessionId: session.id,
            name: times.length > 1 ? `Night ${index + 1}` : 'General admission',
            priceCents,
            currency: VENUE_CURRENCY,
            quantityTotal: quantity,
            status: 'ON_SALE',
            sortOrder: index,
          },
        })
      }

      if (times.length === 0) {
        await prisma.ticketType.create({
          data: {
            eventId: event.id,
            eventSessionId: null,
            name: 'General admission',
            priceCents,
            currency: VENUE_CURRENCY,
            quantityTotal: quantity,
            status: 'ON_SALE',
            sortOrder: 0,
          },
        })
      }

      if (passCents) {
        await prisma.ticketType.create({
          data: {
            eventId: event.id,
            eventSessionId: null,
            name: 'Every night',
            priceCents: passCents,
            currency: VENUE_CURRENCY,
            quantityTotal: quantity,
            status: 'ON_SALE',
            sortOrder: times.length,
          },
        })
      }

      return described(await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include }))
    }

    const { events } = names
    const seeded = {
      ga: await eventFor({
        name: events.ga,
        status: 'ON_SALE',
        nights: [],
        startsInDays: 40,
        priceCents: GA_PRICE_CENTS,
        quantity: GA_QUANTITY,
      }),
      twoNights: await eventFor({
        name: events.twoNights,
        status: 'ON_SALE',
        nights: [42, 43],
        priceCents: NIGHT_PRICE_CENTS,
        passCents: PASS_PRICE_CENTS,
      }),
      toronto: await eventFor({
        name: events.toronto,
        status: 'ON_SALE',
        nights: [44],
        priceCents: TORONTO_PRICE_CENTS,
        venue: toronto,
        timezone: TORONTO_TIME_ZONE,
      }),
      draft: await eventFor({
        name: events.draft,
        status: 'DRAFT',
        nights: [46],
        priceCents: NIGHT_PRICE_CENTS,
      }),
      ended: await eventFor({
        name: events.ended,
        status: 'ON_SALE',
        nights: [-1],
        priceCents: NIGHT_PRICE_CENTS,
      }),
      cancelled: await eventFor({
        name: events.cancelled,
        status: 'CANCELLED',
        nights: [48],
        priceCents: NIGHT_PRICE_CENTS,
        extra: { cancelledAt: now, cancellationReason: CANCELLED_REASON },
      }),
      deleted: await eventFor({
        name: events.deleted,
        status: 'DELETED',
        nights: [50],
        priceCents: NIGHT_PRICE_CENTS,
        extra: {
          deletedAt: new Date(now.getTime() - DAY_MS),
          deletedById: owner.id,
          deletionReason: DELETED_REASON,
          deletionOutcome: 'REMOVED',
          deletionAuthority: 'ORGANIZATION',
          statusBeforeDeletion: 'ON_SALE',
        },
      }),
      // Dated ahead until the spec has booked it; `finishPastNight` moves it.
      pastNight: await eventFor({
        name: events.pastNight,
        status: 'ON_SALE',
        nights: [3],
        priceCents: PAST_PRICE_CENTS,
      }),
    }

    // The scanner holds every event's door, by name.
    const scannerMembership = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: scanner.id, organizationId: organization.id } },
    })

    for (const event of Object.values(seeded)) {
      await prisma.scannerScope.upsert({
        where: { membershipId_eventId: { membershipId: scannerMembership.id, eventId: event.id } },
        update: {},
        create: { membershipId: scannerMembership.id, eventId: event.id },
      })
    }

    // Paying at the venue, switched on by the administrator through the API's
    // own writer, so the history row and the audit row are the real ones.
    const adminActor = await actorOf(prisma, admin.id)

    for (const key of ['twoNights', 'toronto', 'pastNight']) {
      const row = await prisma.event.findUniqueOrThrow({
        where: { id: seeded[key].id },
        select: { venuePaymentEnabled: true, venuePaymentLimit: true },
      })

      if (row.venuePaymentEnabled) continue

      await setVenuePayment(prisma, {
        eventId: seeded[key].id,
        enabled: true,
        limit: VENUE_LIMIT,
        reason: SWITCH_REASON,
        seen: { enabled: false, limit: row.venuePaymentLimit ?? null },
        actor: adminActor,
      })
    }

    // The organiser's own promo code, on the two-night event only.
    const promo = await prisma.promoCode.findFirst({
      where: { organizationId: organization.id, code: names.promoCode },
    })

    if (!promo) {
      await prisma.promoCode.create({
        data: {
          organizationId: organization.id,
          eventId: seeded.twoNights.id,
          code: names.promoCode,
          type: 'PERCENTAGE',
          value: PROMO_PERCENT_BPS,
          active: true,
        },
      })
    }

    return {
      tag,
      organizationId: organization.id,
      users: {
        admin: admin.id,
        superAdmin: superAdmin.id,
        finadmin: finadmin.id,
        moderator: moderator.id,
        owner: owner.id,
        finance: finance.id,
        scanner: scanner.id,
        buyer1: buyers[0].id,
        buyer2: buyers[1].id,
        buyer3: buyers[2].id,
      },
      events: seeded,
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * An event as the journeys navigate by it.
 *
 * @param {object} event The row, with its nights and tiers.
 * @returns {{id: string, slug: string, title: string, sessions: string[], tiers: string[], passTierId: string|null}} Its ids.
 */
function described(event) {
  const withNights = event.sessions.length > 0
  const pass = withNights
    ? (event.ticketTypes.find((tier) => tier.eventSessionId === null) ?? null)
    : null

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    sessions: event.sessions.map((session) => session.id),
    tiers: event.ticketTypes
      .filter((tier) => !withNights || tier.eventSessionId !== null)
      .map((tier) => tier.id),
    passTierId: pass?.id ?? null,
  }
}

/**
 * Move the past night's one night to yesterday evening, and have the scanner
 * take the payment and admit its booked ticket during that night.
 *
 * The booking was made through the real checkout while the night was ahead.
 * The times are the event's own columns, moved as an organiser's reschedule
 * would leave them; the payment and the admission go through the API's door
 * (`previewAdmission`, `confirmAdmission`), with the night's own time as
 * `now`, so the payment row, the check-in and their audit rows are the real
 * ones, dated when the door would have written them.
 *
 * @param {string} tag The run suffix.
 * @param {string} orderReference The pay-at-the-venue order booked on it.
 * @returns {Promise<{ticketId: string, paidCents: number}>} The ticket admitted and what was taken.
 */
export async function finishPastNight(tag, orderReference) {
  const names = venuePaymentNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const event = await prisma.event.findUniqueOrThrow({
      where: { slug: names.events.pastNight.slug },
      include: { sessions: true },
    })
    const [session] = event.sessions
    const night = venueNight(-1)

    await prisma.eventSession.update({ where: { id: session.id }, data: night })
    await prisma.event.update({
      where: { id: event.id },
      data: { startsAt: night.startsAt, endsAt: night.endsAt },
    })

    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { orderItem: { order: { reference: orderReference } } },
      select: { id: true, code: true, checkedInAt: true, venuePaymentId: true },
    })

    if (ticket.venuePaymentId) {
      const paid = await prisma.venuePayment.findUniqueOrThrow({
        where: { id: ticket.venuePaymentId },
      })

      return { ticketId: ticket.id, paidCents: paid.amountCents }
    }

    const scanner = await prisma.user.findUniqueOrThrow({ where: { email: names.scannerEmail } })
    const actor = await actorOf(prisma, scanner.id)
    const env = { AUTH_SECRET }
    const during = new Date(night.startsAt.getTime() + HOUR_MS)
    const body = { code: ticket.code, eventSessionId: session.id }
    const preview = await previewAdmission({ prisma, env, actor, body, now: during })

    if (preview.outcome !== 'ADMISSIBLE' || !preview.payment) {
      throw new Error(`The past night's ticket is not admissible: ${JSON.stringify(preview)}.`)
    }

    const amountCents = preview.payment.dueCents

    await confirmAdmission({
      prisma,
      env,
      actor,
      body: { ...body, previewReference: preview.previewReference, payment: { amountCents } },
      now: during,
    })

    return { ticketId: ticket.id, paidCents: amountCents }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * An order's tickets, as the door and the wallet know them: the printed code
 * the steward types, who holds each, and where each stands.
 *
 * @param {string} orderReference The order.
 * @returns {Promise<Array<{id: string, code: string, status: string, ownerUserId: string|null, checkedInAt: Date|null, supersedesTicketId: string|null, venueCancellationId: string|null}>>} In code order.
 */
export async function ticketsOf(orderReference) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.ticket.findMany({
      where: { orderItem: { order: { reference: orderReference } } },
      select: {
        id: true,
        code: true,
        status: true,
        ownerUserId: true,
        checkedInAt: true,
        supersedesTicketId: true,
        venueCancellationId: true,
      },
      orderBy: { code: 'asc' },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The ticket that replaced one when it was passed on, as it stands now.
 *
 * Accepting an offer issues the new holder a ticket of their own, with its own
 * printed code; the old one is kept as history.
 *
 * @param {string} ticketId The ticket that was passed on.
 * @returns {Promise<{id: string, code: string, status: string, ownerUserId: string|null}|null>} Its successor, or null.
 */
export async function successorOf(ticketId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.ticket.findUnique({
      where: { supersedesTicketId: ticketId },
      select: { id: true, code: true, status: true, ownerUserId: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * A tier's places sold, as the tier row counts them.
 *
 * @param {string} tierId The tier.
 * @returns {Promise<number>} `quantitySold`.
 */
export async function soldOf(tierId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const tier = await prisma.ticketType.findUniqueOrThrow({
      where: { id: tierId },
      select: { quantitySold: true },
    })

    return tier.quantitySold
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The refunds an order has, as the refund rows record them.
 *
 * @param {string} orderReference The order.
 * @returns {Promise<Array<{amountCents: number, status: string}>>} Oldest first.
 */
export async function refundsOf(orderReference) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.refund.findMany({
      where: { order: { reference: orderReference } },
      select: { amountCents: true, status: true },
      orderBy: { createdAt: 'asc' },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Move the night a tier is for to yesterday evening, as an organiser's
 * reschedule would leave it, so a ticket booked for it is one whose night is
 * over. The event's own start and end follow its nights.
 *
 * @param {string} tierId A tier sold for one night.
 * @returns {Promise<void>} Resolves when moved.
 */
export async function endNightOf(tierId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const tier = await prisma.ticketType.findUniqueOrThrow({
      where: { id: tierId },
      select: { eventId: true, eventSessionId: true },
    })

    if (!tier.eventSessionId) throw new Error('That tier is not sold for one night.')

    // Two days back, so its end is behind now at any hour of the day.
    await prisma.eventSession.update({ where: { id: tier.eventSessionId }, data: venueNight(-2) })

    const nights = await prisma.eventSession.findMany({ where: { eventId: tier.eventId } })

    await prisma.event.update({
      where: { id: tier.eventId },
      data: {
        startsAt: new Date(Math.min(...nights.map((night) => night.startsAt.getTime()))),
        endsAt: new Date(Math.max(...nights.map((night) => night.endsAt.getTime()))),
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Remove what the journeys' accounts can still use, and the events nobody
 * bought.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupVenuePayments(tag) {
  const names = venuePaymentNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const emails = [
      names.adminEmail,
      names.superEmail,
      names.finadminEmail,
      names.modEmail,
      names.ownerEmail,
      names.financeEmail,
      names.scannerEmail,
      names.buyer1Email,
      names.buyer2Email,
      names.buyer3Email,
    ]
    const users = await prisma.user.findMany({ where: { email: { in: emails } } })
    const userIds = users.map((user) => user.id)

    // The referral codes the run's administrators made stop working: a code
    // with no limit would otherwise still waive fees in a database a developer
    // reuses. Switched off, as the administrator's own switch leaves one, and
    // kept, since orders name them.
    await prisma.referralCode
      .updateMany({
        where: { createdById: { in: userIds }, active: true },
        data: { active: false, switchedOffAt: new Date() },
      })
      .catch(() => {})
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.mfaFactor.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.membership.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})

    const organization = await prisma.organization.findUnique({
      where: { slug: names.organizationSlug },
    })

    if (!organization) return

    const events = await prisma.event.findMany({ where: { organizationId: organization.id } })

    for (const event of events) {
      // An event an order reaches is pinned by the ledger the checkout posted
      // to. Skipped rather than attempted, so the log carries no foreign-key
      // error that reads like a failure.
      const orders = await prisma.order.count({ where: { eventId: event.id } })

      if (orders > 0) continue

      await prisma.ticketType.deleteMany({ where: { eventId: event.id } }).catch(() => {})
      await prisma.eventSession.deleteMany({ where: { eventId: event.id } }).catch(() => {})
      await prisma.event.delete({ where: { id: event.id } }).catch(() => {})
    }
  } finally {
    await prisma.$disconnect()
  }
}
