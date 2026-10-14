/**
 * The accounts and events the full-control journeys need (SPEC2-XI area X).
 *
 * Every journey in `detail-event-full-control.spec.js` changes a posted event
 * in a way nothing can take back: a night is cancelled and refunded, an event
 * is deleted, a deleted one is restored, the team at The Desi Events edits
 * somebody else's event in a sitting. None of that may happen to a row another spec
 * counts, so everything here is new and carries the tag:
 *
 *   - **Control Gamma <tag>**, a VERIFIED organisation (America/Chicago) with
 *     its owner (`control-owner-<tag>`, a confirmed second factor, as the role
 *     requires) and an event manager (`control-manager-<tag>`, a factor), who
 *     posts events and may delete an unsold one but decides no refund. It
 *     holds:
 *       - `live-sold`, on sale, one night and one $35.00 tier;
 *       - `multi-night`, on sale over three nights, a tier per night and one
 *         every-night pass;
 *       - `sold-to-delete`, on sale, one night;
 *       - `unsold-live`, published and never sold;
 *       - `with-cover`, on sale, with an approved cover;
 *       - `deleted-restore`, deleted from on sale by its owner, nobody owed;
 *       - `draft`, a draft, which the team at The Desi Events does not edit.
 *   - **Control Other <tag>**, a second VERIFIED organisation with its own
 *     owner (`control-other-owner-<tag>`, a factor), holding `other-live` (two
 *     nights, on sale), `other-super` (two nights, on sale) and `other-unsold`
 *     (published, never sold).
 *   - **The buyer** (`control-buyer-<digest of the tag>`), an attendee with no
 *     factor, whose address leaves the tag out for the reason given in
 *     {@link fullControlNames}.
 *   - **The platform administrator** (`control-admin-<tag>@platform.test`,
 *     ADMIN, a factor) and **the moderator**
 *     (`control-moderator-<tag>@platform.test`, MODERATOR, a factor), who
 *     approves the pictures the administrator uploads: nobody approves their
 *     own.
 *
 * Every event is dated two months out or more, after every other world's, so
 * a list sorted soonest first still opens on the events other specs look for.
 *
 * ## Orders
 *
 * The detail journeys buy their tickets through the real checkout, signed in
 * as the buyer (the spec's `buyTickets`), because a refund is sent to the
 * payment the order was paid with, and the simulated payment provider knows
 * only the payments its own process took. The accessibility sweep refunds
 * nothing, so `{ sweep: true }` writes its paid orders straight into the
 * database instead, issued the way settlement issues them
 * (`seedPaidOrder`), with the notices, states and waiting pictures its pages
 * are measured with.
 *
 * ## Cleanup
 *
 * {@link cleanupFullControl} finds both organisations by their tagged slugs
 * and removes every event nothing pins, with its orders, tickets, nights and
 * ticket types; pictures, sittings and change notices go with each event by
 * cascade. An event whose orders a posted ledger batch names — every order
 * the checkout took — is kept, with its organisation and venue: the ledger is
 * append-only, so those rows cannot go, and the tag is never used again. The
 * fixture users' memberships, sessions and factors go either way.
 *
 * The audit rows deliberately stay: `desi_audit_log_immutable` refuses an
 * UPDATE or a DELETE on `AuditLog`, and the actor foreign key is ON DELETE SET
 * NULL, so deleting an account would be an update of its audit rows and is
 * refused. Every user row stays with them; without its sessions, factor and
 * memberships a left-behind account is inert.
 *
 * @module e2e/support/seed-full-control
 */

import { createHash, randomUUID } from 'node:crypto'

import { createPrismaClient } from '@desi-event/db'
import { hashPassword, seal } from '@desi-event/auth'

import { solidPng } from './images.mjs'
import { checkedTag, seedPaidOrder } from './seed-feature-world.mjs'
import { seedPictures } from './seed-media.mjs'
import { AUTH_SECRET, CONNECTION, PASSWORD, TOTP_SECRET } from './seed-refusals.mjs'

/** One day, in milliseconds. */
const DAY_MS = 86_400_000

/** One hour, in milliseconds. */
const HOUR_MS = 3_600_000

/** Where both organisations run their nights. */
export const CONTROL_TIME_ZONE = 'America/Chicago'

/** The currency every tier is priced in. */
export const CONTROL_CURRENCY = 'USD'

/** The live event's one tier, in cents: the price the journeys re-price from. */
export const LIVE_PRICE_CENTS = 3_500

/** What the live event's tier is re-priced to. */
export const LIVE_NEW_PRICE_CENTS = 4_000

/** The reason the deleted event was deleted with, as its record shows it. */
export const DELETED_REASON = 'Posted twice by mistake; the other listing is the right one.'

/**
 * The journeys' addresses, names, titles and web addresses.
 *
 * Pure, so a spec can name them before anything is seeded.
 *
 * @param {string} tag The run suffix.
 * @returns {object} The names.
 */
export function fullControlNames(tag) {
  checkedTag(tag)

  const slug = (name) => `control-${name}-${tag}`

  return {
    ownerEmail: `control-owner-${tag}@organiser.test`,
    ownerName: 'Asha Verma',
    managerEmail: `control-manager-${tag}@organiser.test`,
    managerName: 'Vikram Bhatt',
    otherOwnerEmail: `control-other-owner-${tag}@organiser.test`,
    otherOwnerName: 'Farhan Qureshi',
    // A digest of the tag, not the tag: the detail world's teardown
    // (`cleanupDetailScreens`) clears every order whose buyer's address
    // contains the tag, and this buyer's orders are the checkout's, pinned by
    // the ledger, and this file's to leave. Still one address per run.
    buyerEmail: `control-buyer-${createHash('sha256').update(tag).digest('hex').slice(0, 12)}@attendee.test`,
    buyerName: 'Leela Menon',
    adminEmail: `control-admin-${tag}@platform.test`,
    adminName: 'Ishaan Rathore',
    moderatorEmail: `control-moderator-${tag}@platform.test`,
    moderatorName: 'Meher Kapadia',
    gammaName: `Control Gamma ${tag}`,
    gammaSlug: `control-gamma-${tag}`,
    otherName: `Control Other ${tag}`,
    otherSlug: `control-other-${tag}`,
    events: {
      liveSold: { title: `Control Live Garba ${tag}`, slug: slug('live-sold') },
      multiNight: { title: `Control Three Nights ${tag}`, slug: slug('multi-night') },
      soldToDelete: { title: `Control Sold Out West ${tag}`, slug: slug('sold-to-delete') },
      unsoldLive: { title: `Control Quiet Evening ${tag}`, slug: slug('unsold-live') },
      withCover: { title: `Control Poster Night ${tag}`, slug: slug('with-cover') },
      deletedRestore: { title: `Control Second Listing ${tag}`, slug: slug('deleted-restore') },
      draft: { title: `Control Draft Night ${tag}`, slug: slug('draft') },
      otherLive: { title: `Control Other Raas ${tag}`, slug: slug('other-live') },
      otherSuper: { title: `Control Other Dandiya ${tag}`, slug: slug('other-super') },
      otherUnsold: { title: `Control Other Matinee ${tag}`, slug: slug('other-unsold') },
      // The sweep's own states, each a deletion outcome it measures.
      finished: { title: `Control Finished Fair ${tag}`, slug: slug('finished') },
      completed: { title: `Control Completed Mela ${tag}`, slug: slug('completed') },
      inProgress: { title: `Control Tonight ${tag}`, slug: slug('in-progress') },
    },
    coverAlt: 'Lanterns over the dance floor before the first circle',
  }
}

/**
 * A night, as instants in Chicago's evening: doors, start and end.
 *
 * Midnight UTC plus a day, give or take, is evening in Chicago, five or six
 * hours behind; the honest local time is whatever the zone says.
 *
 * @param {number} daysAhead How many days from now; negative for the past.
 * @returns {{doorsOpenAt: Date, startsAt: Date, endsAt: Date}} The instants.
 */
export function controlNight(daysAhead) {
  const day = new Date(Date.now() + daysAhead * DAY_MS)
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())

  return {
    doorsOpenAt: new Date(midnight + 23.5 * HOUR_MS),
    startsAt: new Date(midnight + 24 * HOUR_MS),
    endsAt: new Date(midnight + 28 * HOUR_MS),
  }
}

/** What every event's policies say. */
const POLICIES = Object.freeze({
  entry: 'Doors open half an hour before. Bring the pass on your phone.',
  refund: 'Refunds up to seven days before the night.',
  conduct: 'Be kind to each other and to the floor.',
})

/**
 * Seed the accounts, both organisations and their events.
 *
 * Upserted or found again throughout, because Playwright starts a fresh
 * worker and runs `beforeAll` again after a failure, and a fixture user
 * outlives every run. Events are found by their tagged slug and reused as
 * they are.
 *
 * @param {string} tag The run suffix.
 * @param {object} [options] Options.
 * @param {boolean} [options.sweep] Also write the sweep's states, paid orders, notices and waiting pictures.
 * @returns {Promise<object>} The ids the journeys navigate by.
 */
export async function seedFullControl(tag, { sweep = false } = {}) {
  const names = fullControlNames(tag)
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

    const owner = await account(names.ownerEmail, names.ownerName, 'ORGANIZER')
    const manager = await account(names.managerEmail, names.managerName, 'ORGANIZER')
    const otherOwner = await account(names.otherOwnerEmail, names.otherOwnerName, 'ORGANIZER')
    const buyer = await account(names.buyerEmail, names.buyerName, 'ATTENDEE')
    const admin = await account(names.adminEmail, names.adminName, 'ADMIN')
    const moderator = await account(names.moderatorEmail, names.moderatorName, 'MODERATOR')

    for (const user of [owner, manager, otherOwner, admin, moderator]) await enrol(user.id)

    // The buyer arrives the way most people do, with no second factor.
    await prisma.mfaFactor.deleteMany({ where: { userId: buyer.id } })

    const now = new Date()

    /**
     * A VERIFIED organisation, upserted by its slug, and its venue.
     *
     * @param {string} name What to call it.
     * @param {string} slug Its slug.
     * @param {string} hallSlug Its venue's slug.
     * @returns {Promise<{organization: object, venue: object}>} Both.
     */
    async function organisation(name, slug, hallSlug) {
      const fields = {
        name,
        contactEmail: `${slug}@example.test`,
        verificationStatus: 'VERIFIED',
        verified: true,
        verificationUpdatedAt: now,
        payoutCurrency: CONTROL_CURRENCY,
        timezone: CONTROL_TIME_ZONE,
      }
      const organization = await prisma.organization.upsert({
        where: { slug },
        update: fields,
        create: { slug, ...fields },
      })
      const hall = {
        name: `${name} Hall`,
        addressLine1: '1 Test Plaza',
        city: 'Houston',
        region: 'TX',
        postalCode: '77002',
        country: 'US',
        timezone: CONTROL_TIME_ZONE,
        organizationId: organization.id,
        provenance: 'organizer',
      }
      const venue = await prisma.venue.upsert({
        where: { slug: hallSlug },
        update: hall,
        create: { slug: hallSlug, ...hall },
      })

      return { organization, venue }
    }

    const gamma = await organisation(names.gammaName, names.gammaSlug, `control-hall-${tag}`)
    const other = await organisation(names.otherName, names.otherSlug, `control-other-hall-${tag}`)

    for (const [user, organization, role] of [
      [owner, gamma.organization, 'OWNER'],
      [manager, gamma.organization, 'EVENT_MANAGER'],
      [otherOwner, other.organization, 'OWNER'],
    ]) {
      await prisma.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
        update: { role },
        create: { userId: user.id, organizationId: organization.id, role },
      })
    }

    // Nobody else starts in either organisation, whatever an earlier seed of
    // this tag left: the platform accounts and the buyer are members of none.
    await prisma.membership.deleteMany({
      where: { userId: { in: [buyer.id, admin.id, moderator.id] } },
    })

    /**
     * An event with everything publishing asks for, its nights, and a tier
     * per night (plus any listed), found again by its slug when it is there.
     *
     * Inserted in the status it is meant to be in, never moved there: the
     * review gate refuses a move into public that a moderator did not
     * approve, and only `lib/event-deletion.js` moves an event into DELETED.
     *
     * @param {object} spec The event.
     * @param {{organization: object, venue: object}} spec.home Whose and where.
     * @param {{title: string, slug: string}} spec.name Its title and slug.
     * @param {string} spec.status Where it stands.
     * @param {number[]} spec.nights Days from now, one per night.
     * @param {number} spec.priceCents Each night's tier's face value.
     * @param {number} [spec.passCents] An every-night pass at this price, when there is one.
     * @param {object} [spec.extra] Columns of its own (the deletion record).
     * @returns {Promise<object>} The event's ids: `{id, slug, title, sessions, tiers, passTierId}`.
     */
    async function eventFor({ home, name, status, nights, priceCents, passCents, extra = {} }) {
      const existing = await prisma.event.findUnique({
        where: { slug: name.slug },
        include: {
          sessions: { orderBy: { sortOrder: 'asc' } },
          ticketTypes: { orderBy: { sortOrder: 'asc' } },
        },
      })

      if (existing) return described(existing)

      const times = nights.map(controlNight)
      const posted = !['DRAFT'].includes(status)
      const selling = ['ON_SALE'].includes(status) || status === 'DELETED'
      const event = await prisma.event.create({
        data: {
          organizationId: home.organization.id,
          venueId: home.venue.id,
          title: name.title,
          slug: name.slug,
          summary: 'A night of garba under the lights, with a live dhol ensemble.',
          description:
            'Three hours of garba and dandiya raas on a sprung floor, with sticks lent at the door and vegetarian food from seven.',
          category: 'GARBA_DANDIYA',
          status,
          startsAt: times[0].startsAt,
          endsAt: times[times.length - 1].endsAt,
          timezone: CONTROL_TIME_ZONE,
          policies: POLICIES,
          contactEmail: `${home.organization.slug}@example.test`,
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
            timezone: CONTROL_TIME_ZONE,
            status: selling ? 'ON_SALE' : 'SCHEDULED',
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
            currency: CONTROL_CURRENCY,
            quantityTotal: 100,
            status: 'ON_SALE',
            sortOrder: index,
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
            currency: CONTROL_CURRENCY,
            quantityTotal: 100,
            status: 'ON_SALE',
            sortOrder: times.length,
          },
        })
      }

      return described(
        await prisma.event.findUniqueOrThrow({
          where: { id: event.id },
          include: {
            sessions: { orderBy: { sortOrder: 'asc' } },
            ticketTypes: { orderBy: { sortOrder: 'asc' } },
          },
        }),
      )
    }

    const { events } = names
    const seeded = {
      liveSold: await eventFor({
        home: gamma,
        name: events.liveSold,
        status: 'ON_SALE',
        nights: [62],
        priceCents: LIVE_PRICE_CENTS,
      }),
      multiNight: await eventFor({
        home: gamma,
        name: events.multiNight,
        status: 'ON_SALE',
        nights: [64, 65, 66],
        priceCents: 2_000,
        passCents: 5_000,
      }),
      soldToDelete: await eventFor({
        home: gamma,
        name: events.soldToDelete,
        status: 'ON_SALE',
        nights: [68],
        priceCents: 3_000,
      }),
      unsoldLive: await eventFor({
        home: gamma,
        name: events.unsoldLive,
        status: 'PUBLISHED',
        nights: [70],
        priceCents: 2_500,
      }),
      withCover: await eventFor({
        home: gamma,
        name: events.withCover,
        status: 'ON_SALE',
        nights: [72],
        priceCents: 2_500,
      }),
      // Deleted by its owner while on sale, before anybody bought: the record
      // `lib/event-deletion.js` leaves for a REMOVE, written directly as every
      // seed writes a status. Its web address was public, so it kept it.
      deletedRestore: await eventFor({
        home: gamma,
        name: events.deletedRestore,
        status: 'DELETED',
        nights: [74],
        priceCents: 2_500,
        extra: {
          deletedAt: new Date(now.getTime() - DAY_MS),
          deletedById: owner.id,
          deletionReason: DELETED_REASON,
          deletionOutcome: 'REMOVED',
          deletionAuthority: 'ORGANIZATION',
          statusBeforeDeletion: 'ON_SALE',
        },
      }),
      draft: await eventFor({
        home: gamma,
        name: events.draft,
        status: 'DRAFT',
        nights: [76],
        priceCents: 2_500,
      }),
      otherLive: await eventFor({
        home: other,
        name: events.otherLive,
        status: 'ON_SALE',
        nights: [78, 79],
        priceCents: 4_000,
      }),
      otherSuper: await eventFor({
        home: other,
        name: events.otherSuper,
        status: 'ON_SALE',
        nights: [80, 81],
        priceCents: 3_000,
      }),
      otherUnsold: await eventFor({
        home: other,
        name: events.otherUnsold,
        status: 'PUBLISHED',
        nights: [82],
        priceCents: 2_000,
      }),
    }

    // The approved cover the replacement journey replaces. Written once.
    const covers = await prisma.mediaAsset.count({
      where: { eventId: seeded.withCover.id, kind: 'EVENT_COVER' },
    })
    const cover =
      covers === 0
        ? await seedPictures({
            eventId: seeded.withCover.id,
            status: 'APPROVED',
            coverAlt: names.coverAlt,
            galleryAlts: [],
          })
        : null

    const result = {
      ownerId: owner.id,
      managerId: manager.id,
      otherOwnerId: otherOwner.id,
      buyerId: buyer.id,
      adminId: admin.id,
      moderatorId: moderator.id,
      gammaOrganizationId: gamma.organization.id,
      otherOrganizationId: other.organization.id,
      coverId:
        cover?.coverId ??
        (
          await prisma.mediaAsset.findFirst({
            where: { eventId: seeded.withCover.id, kind: 'EVENT_COVER', replacesMediaId: null },
            select: { id: true },
          })
        )?.id ??
        null,
      events: seeded,
    }

    if (sweep)
      result.sweep = await seedSweepStates(prisma, {
        tag,
        names,
        gamma,
        buyer,
        owner,
        seeded,
        eventFor,
      })

    return result
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * An event row as the journeys use it: ids, its nights in order, its tiers in
 * order, and the every-night pass's id when it has one.
 *
 * @param {object} event An event with `sessions` and `ticketTypes`.
 * @returns {object} The ids.
 */
function described(event) {
  const pass = event.ticketTypes.find((tier) => tier.eventSessionId === null) ?? null

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    revision: event.revision ?? 0,
    sessions: event.sessions.map((session) => session.id),
    tiers: event.ticketTypes.filter((tier) => tier.eventSessionId !== null).map((tier) => tier.id),
    passTierId: pass?.id ?? null,
  }
}

/**
 * What only the accessibility sweep needs: paid orders written directly, the
 * notices an order page shows, an event in each deletion outcome the preview
 * reads, and pictures waiting for a decision.
 *
 * @param {object} prisma The client.
 * @param {object} context What {@link seedFullControl} already made.
 * @param {string} context.tag The run suffix.
 * @param {object} context.names {@link fullControlNames} for the tag.
 * @param {{organization: object, venue: object}} context.gamma Control Gamma and its hall.
 * @param {object} context.buyer The buyer's user row.
 * @param {object} context.owner Control Gamma's owner's user row.
 * @param {object} context.seeded The events already made.
 * @param {Function} context.eventFor Makes, or finds again, one event.
 * @returns {Promise<object>} The sweep's ids.
 */
async function seedSweepStates(prisma, { tag, names, gamma, buyer, owner, seeded, eventFor }) {
  const TAG = tag.toUpperCase()
  const { events } = names
  const person = { id: buyer.id, email: buyer.email, displayName: buyer.displayName }

  /**
   * One paid order of one ticket, once: found again by its reference.
   *
   * @param {string} key A short code for the order.
   * @param {object} event The event's ids.
   * @param {number} tierIndex Which of its night tiers.
   * @param {number} unitPriceCents Its face value.
   * @returns {Promise<{orderId: string, reference: string}>} The order.
   */
  async function oneTicket(key, event, tierIndex, unitPriceCents) {
    const reference = `DE-C${key}${TAG}`
    const already = await prisma.order.findUnique({ where: { reference } })

    if (already) return { orderId: already.id, reference }

    const placed = await seedPaidOrder({
      reference,
      codePrefix: `DE-CTL-${TAG}-${key}-`,
      eventId: event.id,
      eventSessionId: event.sessions[tierIndex] ?? null,
      ticketTypeId: event.tiers[tierIndex],
      buyer: person,
      attendeeNames: [names.buyerName],
      unitPriceCents,
      currency: CONTROL_CURRENCY,
    })

    return { orderId: placed.orderId, reference: placed.reference }
  }

  // An event whose every night has ended, with a paid order and nobody
  // checked in: the deletion asks whether it took place.
  const finished = await eventFor({
    home: gamma,
    name: events.finished,
    status: 'ON_SALE',
    nights: [-3],
    priceCents: 2_000,
  })
  // A completed event with a paid order: deleting it refunds nobody.
  const completed = await eventFor({
    home: gamma,
    name: events.completed,
    status: 'COMPLETED',
    nights: [-5],
    priceCents: 2_000,
  })
  // A night whose doors opened an hour ago and which ends tomorrow: deleting
  // it is refused while it runs.
  const inProgress = await eventFor({
    home: gamma,
    name: events.inProgress,
    status: 'ON_SALE',
    nights: [1],
    priceCents: 2_000,
  })

  await prisma.eventSession.update({
    where: { id: inProgress.sessions[0] },
    data: { doorsOpenAt: new Date(Date.now() - HOUR_MS) },
  })

  const orders = {
    liveSold: await oneTicket('LS', seeded.liveSold, 0, LIVE_PRICE_CENTS),
    liveSoldAgain: await oneTicket('LT', seeded.liveSold, 0, LIVE_PRICE_CENTS),
    nightTwo: await oneTicket('N2', seeded.multiNight, 1, 2_000),
    soldA: await oneTicket('SA', seeded.soldToDelete, 0, 3_000),
    soldB: await oneTicket('SB', seeded.soldToDelete, 0, 3_000),
    finished: await oneTicket('FI', finished, 0, 2_000),
    completed: await oneTicket('CO', completed, 0, 2_000),
    inProgress: await oneTicket('IP', inProgress, 0, 2_000),
  }

  // Two notices on the live event, after its orders: its start moved an hour
  // by the organiser, and its night two days later moved again by the team
  // at The Desi Events, so the order page shows both kinds of line.
  const noticed = await prisma.eventChangeNotice.count({ where: { eventId: seeded.liveSold.id } })

  if (noticed === 0) {
    const night = await prisma.eventSession.findUniqueOrThrow({
      where: { id: seeded.liveSold.sessions[0] },
    })
    const earlier = new Date(night.startsAt.getTime() - HOUR_MS)

    await prisma.eventChangeNotice.create({
      data: {
        eventId: seeded.liveSold.id,
        kind: 'MATERIAL_CHANGE',
        fields: ['startsAt'],
        changed: ['the start time'],
        before: { startsAt: night.startsAt.toISOString() },
        after: { startsAt: earlier.toISOString() },
        reason: 'The hall asked us to finish an hour earlier.',
        byPlatform: false,
        createdAt: new Date(Date.now() + 1_000),
      },
    })
    await prisma.eventChangeNotice.create({
      data: {
        eventId: seeded.liveSold.id,
        eventSessionId: night.id,
        kind: 'SESSION_CHANGE',
        fields: ['endsAt'],
        changed: ['the end time'],
        before: { endsAt: night.endsAt.toISOString() },
        after: { endsAt: new Date(night.endsAt.getTime() - HOUR_MS).toISOString() },
        reason: 'The fire marshal set a midnight close for the hall.',
        byPlatform: true,
        createdAt: new Date(Date.now() + 2_000),
      },
    })
  }

  // A picture and a replacement cover waiting for a decision, uploaded by the
  // owner, so the pictures queue and the Media step have both to show.
  const waiting = await prisma.mediaAsset.count({
    where: { eventId: seeded.withCover.id, moderationStatus: 'PENDING' },
  })

  if (waiting === 0) {
    const current = await prisma.mediaAsset.findFirstOrThrow({
      where: { eventId: seeded.withCover.id, kind: 'EVENT_COVER', replacesMediaId: null },
    })

    await waitingPicture(prisma, {
      eventId: seeded.withCover.id,
      uploadedById: owner.id,
      kind: 'EVENT_COVER',
      altText: 'The new poster: two dancers under a marigold arch',
      replacesMediaId: current.id,
      rgb: [180, 70, 120],
    })
    await waitingPicture(prisma, {
      eventId: seeded.withCover.id,
      uploadedById: owner.id,
      kind: 'EVENT_GALLERY',
      altText: 'The band warming up beside the stage',
      replacesMediaId: null,
      rgb: [60, 120, 90],
    })
  }

  return { finished, completed, inProgress, orders }
}

/**
 * A picture waiting for the team at The Desi Events, written the way the upload
 * pipeline writes one: its bytes, their SHA-256, the asset and then the blob.
 *
 * @param {object} prisma The client.
 * @param {object} picture What to write.
 * @param {string} picture.eventId The event.
 * @param {string} picture.uploadedById Who uploaded it.
 * @param {'EVENT_COVER'|'EVENT_GALLERY'} picture.kind Cover or gallery.
 * @param {string} picture.altText Its description.
 * @param {string|null} picture.replacesMediaId The cover it would replace.
 * @param {number[]} picture.rgb Its one colour.
 * @returns {Promise<string>} Its id.
 */
async function waitingPicture(
  prisma,
  { eventId, uploadedById, kind, altText, replacesMediaId, rgb },
) {
  const cover = kind === 'EVENT_COVER'
  const width = cover ? 1200 : 400
  const height = cover ? 630 : 400
  const bytes = solidPng(width, height, { rgb })
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const storageKey = `pg/${randomUUID()}`
  const asset = await prisma.mediaAsset.create({
    data: {
      ownerType: 'EVENT',
      ownerId: eventId,
      eventId,
      kind,
      storageKey,
      contentType: 'image/png',
      byteSize: bytes.length,
      width,
      height,
      checksum,
      altText,
      position: cover ? null : 0,
      sanitisedAt: new Date(),
      scanStatus: 'CLEAN',
      moderationStatus: 'PENDING',
      uploadedById,
      replacesMediaId,
    },
    select: { id: true },
  })

  await prisma.mediaBlob.create({ data: { storageKey, bytes, byteSize: bytes.length, checksum } })

  return asset.id
}

/**
 * Make a night's doors open an hour ago, as if it had started.
 *
 * "Started" is an hour before the doors (or the start), so a night whose
 * doors opened already has started however far off its start is.
 *
 * @param {string} sessionId The night.
 * @returns {Promise<void>} Resolves once moved.
 */
export async function openDoorsAnHourAgo(sessionId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await prisma.eventSession.update({
      where: { id: sessionId },
      data: { doorsOpenAt: new Date(Date.now() - HOUR_MS) },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * An event as the database holds it: status, deletion record, nights and
 * tiers.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object|null>} The row.
 */
export async function eventRow(eventId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        faq: true,
        status: true,
        revision: true,
        startsAt: true,
        deletedAt: true,
        deletionOutcome: true,
        deletionAuthority: true,
        statusBeforeDeletion: true,
        sessions: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, status: true, startsAt: true, cancellationReason: true },
        },
        ticketTypes: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, priceCents: true, quantitySold: true, status: true },
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Every order of an event, with what was refunded and how its tickets stand.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object[]>} The orders, oldest first.
 */
export async function ordersOf(eventId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.order.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        reference: true,
        status: true,
        totalCents: true,
        refundedCents: true,
        refundPendingCents: true,
        items: {
          select: {
            ticketTypeId: true,
            unitPriceCents: true,
            quantity: true,
            tickets: { select: { status: true } },
          },
        },
        refunds: { select: { status: true, reason: true, amountCents: true } },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The audit rows recorded against an event for one action, newest first.
 * Read, never changed.
 *
 * @param {string} eventId The event.
 * @param {string} action The audit action, for example `event.deleted`.
 * @returns {Promise<object[]>} The rows' actor, action and metadata.
 */
export async function auditFor(eventId, action) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.auditLog.findMany({
      where: { entityId: eventId, action },
      orderBy: { createdAt: 'desc' },
      select: { actorId: true, action: true, metadata: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Remove what the journeys made and nothing pins.
 *
 * Safe to run twice, and safe after a journey that stopped part-way. See the
 * module note for what stays.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<{keptEvents: number}>} How many events the ledger kept.
 */
export async function cleanupFullControl(tag) {
  const names = fullControlNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })
  let keptEvents = 0

  try {
    const organizations = await prisma.organization.findMany({
      where: { slug: { in: [names.gammaSlug, names.otherSlug] } },
      select: { id: true, slug: true },
    })

    for (const organization of organizations) {
      const events = await prisma.event.findMany({
        where: { organizationId: organization.id },
        select: { id: true },
      })
      let kept = 0

      for (const event of events) {
        // Asked first, before anything of the event's is touched: a ledger
        // batch makes its orders, and so the event, permanent.
        const ledgered = await prisma.ledgerBatch.count({ where: { order: { eventId: event.id } } })

        if (ledgered > 0) {
          kept += 1
          continue
        }

        // A hold line refuses its tier's deletion; its hold takes it along.
        await prisma.ticketHold
          .deleteMany({ where: { ticketType: { eventId: event.id } } })
          .catch(() => {})

        const orders = await prisma.order.findMany({
          where: { eventId: event.id },
          select: { id: true },
        })

        for (const order of orders) {
          await prisma.reconciliationTask
            .deleteMany({ where: { orderId: order.id } })
            .catch(() => {})
          await prisma.refundItem
            .deleteMany({ where: { refund: { orderId: order.id } } })
            .catch(() => {})
          await prisma.refund.deleteMany({ where: { orderId: order.id } }).catch(() => {})
          // Transfers and check-ins go with their tickets, by cascade.
          await prisma.ticket
            .deleteMany({ where: { orderItem: { orderId: order.id } } })
            .catch(() => {})
          await prisma.orderItem.deleteMany({ where: { orderId: order.id } }).catch(() => {})
          await prisma.payment.deleteMany({ where: { orderId: order.id } }).catch(() => {})
          await prisma.order.delete({ where: { id: order.id } }).catch(() => {})
        }

        // Pictures, sittings and change notices go with the event by cascade;
        // said here too, so a picture left by a stopped journey cannot pin it.
        await prisma.mediaAsset.deleteMany({ where: { eventId: event.id } }).catch(() => {})
        await prisma.ticketType.deleteMany({ where: { eventId: event.id } }).catch(() => {})
        await prisma.eventSession.deleteMany({ where: { eventId: event.id } }).catch(() => {})
        await prisma.eventModerationAction
          .deleteMany({ where: { eventId: event.id } })
          .catch(() => {})
        await prisma.event.delete({ where: { id: event.id } }).catch(() => {
          kept += 1
        })
      }

      await prisma.membership
        .deleteMany({ where: { organizationId: organization.id } })
        .catch(() => {})

      keptEvents += kept

      if (kept === 0) {
        await prisma.venue
          .deleteMany({ where: { organizationId: organization.id } })
          .catch(() => {})
        await prisma.organization.delete({ where: { id: organization.id } }).catch(() => {})
      }
    }

    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [
            names.ownerEmail,
            names.managerEmail,
            names.otherOwnerEmail,
            names.buyerEmail,
            names.adminEmail,
            names.moderatorEmail,
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

  return { keptEvents }
}
