/**
 * The world the feature-completion specs share, beside the detail world and
 * never inside it.
 *
 * The detail world's accounts are signed in once, in global setup, and their
 * sessions saved; the specs that follow depend on counts nobody may change —
 * alpha lists exactly one upcoming event and has exactly four members, beta
 * and the unverified organisation list nothing. The features added since
 * change privileges, publish events, sell seats and hand tickets on, and doing
 * any of that to a saved account would rotate its session (NF-10) or move a
 * count underneath a later spec. So everything they need lives here instead:
 *
 *   - **gamma-<tag>**, a VERIFIED organisation with its own owner (a confirmed
 *     second factor, as the role requires) and its own venue, holding:
 *       - a general-admission event on sale over two labelled nights, one tier
 *         per night;
 *       - a seated event on sale over two labelled nights: a published venue
 *         map in two sections, each its own price zone — the balcony, two rows
 *         of six plain seats, and the boxes, one row of the seats a picker has
 *         to explain (a wheelchair space and its companion seat, an obstructed
 *         view, a restricted seat with its note, and one blocked on both
 *         nights) — a reserved tier per zone per night, and every seat of
 *         every night bound to the tier pricing its zone;
 *       - a draft event, for pictures and the new detail fields;
 *       - an online event on sale, with a joining link only a holder is
 *         given, and beside its public tier a hidden one nobody is shown;
 *       - three organisation-wide promo codes: one current, one expired, and
 *         one whose only use is spent.
 *   - **giver**, an attendee holding a general-admission ticket to offer, a
 *     reserved seat on night one, an order of three tickets with three
 *     guests' names, for the group pass, and one more ticket on night one
 *     that only the platform's own door admits (`detail-platform-door`).
 *   - **taker**, an attendee with nothing, to accept what is offered.
 *   - **role-target**, an attendee with a confirmed second factor whom no
 *     global setup ever signs in, so a platform-role change rotates nobody's
 *     saved session.
 *   - **pending-<tag>**, an organisation that has asked to be verified and is
 *     waiting, with its owner, so the verification queue is not empty.
 *   - **door-moderator**, a MODERATOR with a confirmed second factor: a
 *     platform role that is not door authority, whom the door refuses.
 *   - **link-admin**, a platform ADMIN with a confirmed second factor, who
 *     decides on events' website links (`website_redirect:manage`) and reads
 *     every event's visits (`analytics:view_all`). Nothing here signs it in;
 *     the specs that need it sign it in themselves.
 *
 * ## The website links
 *
 * Gamma's general-admission event carries the organiser's address
 * `https://gamma-<tag>.test/`, waiting for an administrator: its link is off,
 * as an organiser's save leaves it. Gamma's seated event carries
 * `https://gamma-balcony-<tag>.test/` with its link on, decided by link-admin
 * for that exact address (`websiteDecidedUrl`), so a public page with a live
 * link exists whichever order the specs run in. Both are `.test` hosts, which
 * never resolve; a spec that follows a link answers the request itself.
 * Written directly, as every seed writes a public event: in the application
 * only `lib/website-redirect.js` writes the switch.
 *
 * Every address and slug carries the tag, and every name a buyer or guest
 * types is checked against the analytics and refund needle lists, so none of
 * this can make those scans fail by accident.
 *
 * ## Extending it
 *
 * `seedFeatureWorld` returns plain ids and never reads them back. A spec that
 * needs one more thing under gamma adds it with {@link seedPaidOrder} (a paid
 * order, issued the way checkout issues one) or with its own rows keyed by the
 * returned ids; {@link cleanupFeatureWorld} finds everything by organisation
 * and event rather than by a list of what this file made, so rows a spec or
 * the product added under gamma go with it.
 *
 * Picture bytes need no directory of their own: the media store is the
 * `MediaBlob` table, deleted with each asset, and the assets with their event.
 *
 * @module e2e/support/seed-feature-world
 */

import { createHash } from 'node:crypto'

import { createPrismaClient } from '@desi-event/db'

import { hashPassword, seal } from '@desi-event/auth'

import { issueTicketCredential } from '../../../api/src/lib/ticket-credentials.js'
import { AUTH_SECRET, CONNECTION, PASSWORD, TOTP_SECRET } from './seed-refusals.mjs'

/**
 * What a tag may be.
 *
 * Lower-case, because addresses are compared lower-cased and a tag with a
 * capital in it would seed an account nobody can sign in as; short, because
 * it is part of an order reference with a 32-character ceiling.
 *
 * @type {RegExp}
 */
const TAG_SHAPE = /^[a-z0-9]{3,24}$/u

/** One day, in milliseconds. */
const DAY_MS = 86_400_000

/** The venue's zone. The catalogue is US-only, and so is gamma. */
export const FEATURE_TIME_ZONE = 'America/New_York'

/** What gamma sells in. */
export const FEATURE_CURRENCY = 'USD'

/** A general-admission ticket, in cents. */
export const GA_PRICE_CENTS = 2_500

/** A balcony seat, in cents. */
export const SEAT_PRICE_CENTS = 4_500

/** The balcony: row label to seat count. */
export const BALCONY_ROWS = Object.freeze({ A: 6, B: 6 })

/** A box seat, in cents. */
export const BOX_PRICE_CENTS = 6_000

/**
 * The boxes: one row, K, in a section and price zone of their own, holding
 * every kind of seat the picker has to say something about.
 *
 *   - K1 is a wheelchair space and K2 its companion seat, which are chosen,
 *     held and sold together;
 *   - K3 has an obstructed view;
 *   - K4 is restricted, with the note the picker shows under the section;
 *   - K5 is blocked on both nights, by the organiser, for the sound desk.
 *
 * The balcony's seats are plain, so no assertion about them moves.
 */
export const BOX_SEATS = Object.freeze([
  Object.freeze({ label: 'K1', accessible: true }),
  Object.freeze({ label: 'K2', companionOf: 'K1' }),
  Object.freeze({ label: 'K3', obstructedView: true }),
  Object.freeze({
    label: 'K4',
    restricted: true,
    restrictionNote: 'Beside the camera platform: the stage is seen from the side.',
  }),
  Object.freeze({ label: 'K5', blockedReason: 'Kept for the sound desk.' }),
])

/** Every seat on gamma's plan, both sections. */
export const PLAN_SEATS =
  Object.values(BALCONY_ROWS).reduce((sum, count) => sum + count, 0) + BOX_SEATS.length

/** Who the giver is, as a buyer and on their own tickets. */
export const GIVER_NAME = 'Rohan Mehta'

/** Who the taker is. */
export const TAKER_NAME = 'Tara Iyer'

/** The three guests on the giver's group order, in ticket order. */
export const GROUP_GUESTS = Object.freeze(['Meera Joshi', 'Kabir Rao', 'Anika Sen'])

/** The name on the ticket the platform's door admits. */
export const PLATFORM_GUEST = 'Nikhil Varma'

/** An online ticket, in cents. */
export const ONLINE_PRICE_CENTS = 1_500

/** The online event's public tier, and the hidden one beside it. */
export const ONLINE_TIERS = Object.freeze({ public: 'Online pass', hidden: 'Speakers and crew' })

/**
 * The online event's joining link.
 *
 * On a `.test` host, so nothing ever resolves it, and carrying the tag, so a
 * page that printed another run's link could not pass for this one's.
 *
 * @param {string} tag The run suffix.
 * @returns {string} The link.
 */
export function onlineJoinUrl(tag) {
  return `https://stream.example.test/${checkedTag(tag)}`
}

/**
 * Words the analytics, refund and reconciliation payload scans look for.
 *
 * Those scans are right to fail on a payment word or a personal name in a
 * money payload, and wrong to fail on an innocent promo code or guest name
 * that happens to contain one — "COMPANY10" holds "pan". So every string this
 * world types is checked here first, and a clash fails the seed with its
 * reason rather than a scan three specs later without one.
 *
 * @type {ReadonlyArray<string>}
 */
const PAYLOAD_NEEDLES = Object.freeze(['pan', 'card', 'cvc', 'pi_', 'priya', 'ticket holder'])

/**
 * Refuse any typed value that contains a payload-scan needle.
 *
 * @param {Record<string, string>} values Labelled values.
 * @returns {void}
 * @throws {Error} Naming the value and the needle it contains.
 */
function assertNoPayloadNeedles(values) {
  for (const [label, value] of Object.entries(values)) {
    const lower = value.toLowerCase()
    const needle = PAYLOAD_NEEDLES.find((word) => lower.includes(word))

    if (needle !== undefined) {
      throw new Error(`The feature world's ${label} "${value}" contains "${needle}".`)
    }
  }
}

/**
 * Refuse a tag this world cannot seed safely.
 *
 * Exported so that a caller seeding other worlds under the same tag first —
 * `seedDetailWorld` — can refuse a bad one before any of them writes a row.
 *
 * @param {string} tag The run suffix.
 * @returns {string} The same tag.
 * @throws {Error} When it is not lower-case letters and digits, 3 to 24 long.
 */
export function checkedTag(tag) {
  if (typeof tag !== 'string' || !TAG_SHAPE.test(tag)) {
    throw new Error(
      `A feature-world tag is 3 to 24 lower-case letters and digits; got ${JSON.stringify(tag)}.`,
    )
  }

  return tag
}

/**
 * The addresses this world's accounts sign in with.
 *
 * Pure, so a spec can name an account without reading the world file.
 *
 * @param {string} tag The run suffix.
 * @returns {{gammaOwner: string, giver: string, taker: string, roleTarget: string, pendingOwner: string, doorModerator: string, linkAdmin: string}} The addresses.
 */
export function featureAccounts(tag) {
  checkedTag(tag)

  return {
    gammaOwner: `gamma-owner-${tag}@organiser.test`,
    giver: `giver-${tag}@attendee.test`,
    taker: `taker-${tag}@attendee.test`,
    roleTarget: `role-target-${tag}@platform.test`,
    pendingOwner: `pending-owner-${tag}@organiser.test`,
    doorModerator: `door-moderator-${tag}@platform.test`,
    linkAdmin: `link-admin-${tag}@platform.test`,
  }
}

/** The platform administrator who decides on website links, as organisers are shown the name. */
export const LINK_ADMIN_NAME = 'Lalita Linkwala'

/** Why link-admin turned the seated event's link on, as the organiser is shown it. */
export const SEATED_LINK_REASON = 'Checked for the e2e world.'

/**
 * The website addresses gamma's two public events carry.
 *
 * Pure, so a spec can name them without reading the world file. On `.test`
 * hosts, which never resolve, and carrying the tag, so a link that went to
 * another run's address could not pass for this one's.
 *
 * @param {string} tag The run suffix.
 * @returns {{gaEvent: string, seatedEvent: string}} The addresses, in the stored (normalised) form.
 */
export function featureWebsites(tag) {
  checkedTag(tag)

  return {
    gaEvent: `https://gamma-${tag}.test/`,
    seatedEvent: `https://gamma-balcony-${tag}.test/`,
  }
}

/**
 * The slugs this world's organisations, venue and events use.
 *
 * @param {string} tag The run suffix.
 * @returns {{gamma: string, pending: string, venue: string, gaEvent: string, seatedEvent: string, draftEvent: string, onlineEvent: string}} The slugs.
 */
export function featureSlugs(tag) {
  checkedTag(tag)

  return {
    gamma: `gamma-${tag}`,
    pending: `pending-${tag}`,
    venue: `gamma-hall-${tag}`,
    gaEvent: `gamma-nights-${tag}`,
    seatedEvent: `gamma-balcony-${tag}`,
    draftEvent: `gamma-draft-${tag}`,
    onlineEvent: `gamma-online-${tag}`,
  }
}

/**
 * Gamma's three promo codes.
 *
 * Each carries the tag, upper-cased, so two runs never share a code. A tag is
 * random, and one that happened to spell a payload needle would put it in a
 * code; that tag is replaced by a digest of itself, whose hexadecimal
 * alphabet cannot spell any of them.
 *
 * @param {string} tag The run suffix.
 * @returns {{current: string, expired: string, used: string}} The current 10% code, the expired one, and the one used up.
 */
export function featurePromoCodes(tag) {
  checkedTag(tag)

  const spelled = PAYLOAD_NEEDLES.some((needle) => tag.includes(needle))
  const suffix = spelled
    ? createHash('sha256').update(tag).digest('hex').slice(0, 12).toUpperCase()
    : tag.toUpperCase()

  return {
    current: `GAMMA10${suffix}`,
    expired: `GAMMAOLD${suffix}`,
    used: `GAMMAUSED${suffix}`,
  }
}

/**
 * A night, as UTC instants: doors, start and end.
 *
 * 23:00, 23:30 and 04:00 the next day in UTC, which is 7 pm, 7:30 pm and
 * midnight in New York in summer and an hour earlier in winter. The honest
 * local time is whatever the zone says; nothing here pretends otherwise.
 *
 * @param {number} daysAhead How many days from today.
 * @returns {{doorsOpenAt: Date, startsAt: Date, endsAt: Date}} The instants.
 */
function night(daysAhead) {
  const day = new Date(Date.now() + daysAhead * DAY_MS)
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())

  return {
    doorsOpenAt: new Date(midnight + 23 * 3_600_000),
    startsAt: new Date(midnight + 23.5 * 3_600_000),
    endsAt: new Date(midnight + 28 * 3_600_000),
  }
}

/**
 * Create a paid order and issue its tickets, the way settlement issues them.
 *
 * Each ticket gets a credential derived from the API's `AUTH_SECRET`, of which
 * only the digest is stored: the holder's pass screen derives it again, which
 * is the path under test. A seated ticket takes its `EventSeat`, which is
 * marked SOLD on this order's line.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options What to sell.
 * @param {string} options.reference The order reference, upper-case.
 * @param {string} options.codePrefix Each ticket's code is this plus its position.
 * @param {string} options.eventId The event.
 * @param {string|null} options.eventSessionId The night, when the order is for one.
 * @param {string} options.ticketTypeId The tier.
 * @param {{id: string, email: string, displayName: string}} options.buyer Who bought and holds them.
 * @param {string[]} options.attendeeNames One name per ticket.
 * @param {string[]} [options.eventSeatIds] One seat per ticket, for a reserved tier.
 * @param {number} options.unitPriceCents The face value.
 * @param {string} [options.currency] The currency.
 * @returns {Promise<{orderId: string, reference: string, orderItemId: string, ticketIds: string[]}>} The ids.
 */
async function paidOrder(
  prisma,
  {
    reference,
    codePrefix,
    eventId,
    eventSessionId,
    ticketTypeId,
    buyer,
    attendeeNames,
    eventSeatIds = [],
    unitPriceCents,
    currency = FEATURE_CURRENCY,
  },
) {
  const quantity = attendeeNames.length

  if (eventSeatIds.length > 0 && eventSeatIds.length !== quantity) {
    throw new Error(`Order ${reference} names ${quantity} people for ${eventSeatIds.length} seats.`)
  }

  assertNoPayloadNeedles(
    Object.fromEntries(attendeeNames.map((name, index) => [`guest ${index + 1}`, name])),
  )

  const order = await prisma.order.create({
    data: {
      reference,
      eventId,
      eventSessionId,
      userId: buyer.id,
      buyerEmail: buyer.email,
      buyerName: buyer.displayName,
      status: 'PAID',
      currency,
      subtotalCents: unitPriceCents * quantity,
      totalCents: unitPriceCents * quantity,
      paidAt: new Date(),
    },
  })

  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketTypeId,
      quantity,
      unitPriceCents,
      subtotalCents: unitPriceCents * quantity,
    },
  })

  const ticketIds = []

  for (const [index, attendeeName] of attendeeNames.entries()) {
    const eventSeatId = eventSeatIds[index] ?? null

    if (eventSeatId !== null) {
      await prisma.eventSeat.update({
        where: { id: eventSeatId },
        data: { status: 'SOLD', orderItemId: orderItem.id, holdId: null },
      })
    }

    const ticket = await prisma.ticket.create({
      data: {
        orderItemId: orderItem.id,
        code: `${codePrefix}${index + 1}`,
        ownerUserId: buyer.id,
        attendeeName,
        eventSeatId,
        status: 'VALID',
      },
    })

    // The digest only. The credential itself is never written anywhere.
    const { credentialHash } = issueTicketCredential({
      secret: AUTH_SECRET,
      ticketId: ticket.id,
      version: 1,
    })

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { credentialHash, credentialVersion: 1, credentialIssuedAt: new Date() },
    })

    ticketIds.push(ticket.id)
  }

  await prisma.ticketType.update({
    where: { id: ticketTypeId },
    data: { quantitySold: { increment: quantity } },
  })

  return { orderId: order.id, reference: order.reference, orderItemId: orderItem.id, ticketIds }
}

/**
 * Gamma's published seat plan: the balcony, the rows in {@link BALCONY_ROWS}
 * in the Balcony zone, then the boxes, {@link BOX_SEATS} in the Box zone.
 *
 * A published version is frozen by trigger and cannot be deleted, so a cleanup
 * leaves it behind; a later seed of the same tag reuses it, which is safe
 * because it is exactly the layout this function would draw. A version that
 * was never published — a seed that died half-way — is still editable, so it
 * is removed and drawn again.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.venueId Gamma's venue.
 * @param {string} options.tag The run suffix.
 * @param {Date} options.now The publication instant, for a new version.
 * @returns {Promise<{version: object, zone: object, boxZone: object, seats: object[], seatCount: number}>} The published plan, seats in section and row order.
 */
async function balconyPlan(prisma, { venueId, tag, now }) {
  const seatCount = PLAN_SEATS
  const name = `Gamma plan ${tag}`
  const map = await prisma.venueMap.upsert({
    where: { venueId_name: { venueId, name } },
    update: {},
    create: { venueId, name },
  })
  const existing = await prisma.venueMapVersion.findUnique({
    where: { venueMapId_version: { venueMapId: map.id, version: 1 } },
  })

  if (existing?.publishedAt) {
    const zone = await prisma.priceZone.findFirst({
      where: { venueMapVersionId: existing.id, name: 'Balcony' },
    })
    const boxZone = await prisma.priceZone.findFirst({
      where: { venueMapVersionId: existing.id, name: 'Box' },
    })
    const seats = await prisma.seat.findMany({
      where: { venueMapVersionId: existing.id },
      orderBy: { sortOrder: 'asc' },
    })

    if (zone === null || boxZone === null || seats.length !== seatCount) {
      throw new Error(`The kept balcony plan for ${tag} is not the one this seed draws.`)
    }

    return { version: existing, zone, boxZone, seats, seatCount }
  }

  if (existing) await prisma.venueMapVersion.delete({ where: { id: existing.id } })

  const version = await prisma.venueMapVersion.create({
    data: { venueMapId: map.id, version: 1, seatCount },
  })
  const section = await prisma.section.create({
    data: { venueMapVersionId: version.id, name: 'Balcony', kind: 'SEATED', sortOrder: 0 },
  })
  const zone = await prisma.priceZone.create({
    data: { venueMapVersionId: version.id, name: 'Balcony', sortOrder: 0 },
  })

  const seats = []

  for (const [rowIndex, [rowLabel, count]] of Object.entries(BALCONY_ROWS).entries()) {
    const row = await prisma.seatRow.create({
      data: {
        venueMapVersionId: version.id,
        sectionId: section.id,
        label: rowLabel,
        sortOrder: rowIndex,
      },
    })

    for (let number = 1; number <= count; number += 1) {
      seats.push(
        await prisma.seat.create({
          data: {
            venueMapVersionId: version.id,
            sectionId: section.id,
            rowId: row.id,
            label: `${rowLabel}${number}`,
            sortOrder: rowIndex * 100 + number,
            priceZoneId: zone.id,
          },
        }),
      )
    }
  }

  // The boxes: their own section, zone and row, after the balcony.
  const boxes = await prisma.section.create({
    data: { venueMapVersionId: version.id, name: 'Boxes', kind: 'SEATED', sortOrder: 1 },
  })
  const boxZone = await prisma.priceZone.create({
    data: { venueMapVersionId: version.id, name: 'Box', sortOrder: 1 },
  })
  const boxRow = await prisma.seatRow.create({
    data: {
      venueMapVersionId: version.id,
      sectionId: boxes.id,
      label: 'K',
      sortOrder: Object.keys(BALCONY_ROWS).length,
    },
  })
  const byLabel = new Map()

  // In order, so a companion's wheelchair space exists before it points at it.
  for (const [index, box] of BOX_SEATS.entries()) {
    const seat = await prisma.seat.create({
      data: {
        venueMapVersionId: version.id,
        sectionId: boxes.id,
        rowId: boxRow.id,
        label: box.label,
        sortOrder: 1_000 + index + 1,
        priceZoneId: boxZone.id,
        accessible: box.accessible === true,
        companionOfSeatId: box.companionOf ? byLabel.get(box.companionOf).id : null,
        obstructedView: box.obstructedView === true,
        restricted: box.restricted === true,
        restrictionNote: box.restrictionNote ?? null,
      },
    })

    byLabel.set(box.label, seat)
    seats.push(seat)
  }

  // The freeze: from here the layout cannot change, and a session may sell it.
  const published = await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: now },
  })

  return { version: published, zone, boxZone, seats, seatCount }
}

/**
 * Refuse to seed over a world this tag already has.
 *
 * A second seed of one tag works when the first was cleaned up: the accounts
 * are upserted, and the venue and its published seat plan — which a cleanup
 * leaves, frozen — are taken back (see {@link balconyPlan}). It cannot work
 * over an organisation a cleanup kept. `cleanupFeatureWorld` keeps gamma, on
 * purpose, when the ledger names one of its orders, which it does as soon as a
 * spec pays through checkout; and a world seeded over those orders would not
 * be the one the specs are written against — the taker would already hold
 * tickets, seats would already be sold. Nor can it work over the rows of a
 * run that stopped before its cleanup. Either way the answer is a new tag, so
 * this says so before anything is written, rather than failing half-way on a
 * unique slug.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} tag The run suffix.
 * @param {string[]} [alsoOrganizations] Other slugs the caller is about to create under the tag.
 * @returns {Promise<void>} Resolves when none of them is there.
 * @throws {Error} Naming what is still there, and why.
 */
async function refuseLeftovers(prisma, tag, alsoOrganizations = []) {
  const slugs = featureSlugs(tag)
  const kept = await prisma.organization.findMany({
    where: { slug: { in: [slugs.gamma, slugs.pending, ...alsoOrganizations] } },
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  })

  if (kept.length === 0) return

  const ledgered = await prisma.ledgerBatch.findMany({
    where: { order: { event: { organizationId: { in: kept.map((row) => row.id) } } } },
    select: { orderId: true },
    distinct: ['orderId'],
  })
  const why =
    ledgered.length > 0
      ? `a ledger batch names ${ledgered.length} of their orders, so cleanup keeps them on ` +
        'purpose — the ledger is append-only — and a world seeded over those orders would not ' +
        'be the one the specs expect'
      : 'a run with this tag stopped before its cleanup'

  throw new Error(
    `The tag "${tag}" has been used: ${kept.map((row) => row.slug).join(', ')} ` +
      `${kept.length === 1 ? 'is' : 'are'} still in the database, because ${why}. Seed with a ` +
      'new tag — unset DETAIL_E2E_TAG or SWEEP_E2E_TAG, or choose another.',
  )
}

/**
 * Refuse, before anything is written, a tag the feature world cannot be
 * seeded under: one of the wrong shape, or one whose world is still there.
 *
 * For a caller that seeds other worlds under the same tag before this one —
 * `seedDetailWorld` — so that a refusal comes before any of them has written
 * a row. `seedFeatureWorld` asks the same itself.
 *
 * @param {string} tag The run suffix.
 * @param {object} [options] Options.
 * @param {string[]} [options.alsoOrganizations] The caller's own organisation slugs under the tag, refused the same way.
 * @returns {Promise<void>} Resolves when the tag is free.
 */
export async function assertTagFree(tag, { alsoOrganizations = [] } = {}) {
  checkedTag(tag)

  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await refuseLeftovers(prisma, tag, alsoOrganizations)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * One more paid order under the feature world, for a spec that needs its own.
 *
 * Opens and closes its own connection, so a spec can call it from a
 * `beforeAll` without holding one. The order and its tickets hang from a
 * gamma event, so {@link cleanupFeatureWorld} removes them.
 *
 * @param {object} options As {@link paidOrder} takes them.
 * @returns {Promise<{orderId: string, reference: string, orderItemId: string, ticketIds: string[]}>} The ids.
 */
export async function seedPaidOrder(options) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await paidOrder(prisma, options)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Everything an organiser can put on an event's page beyond its basics: a
 * line-up with bios, a running order, questions and answers, a dress code,
 * arrival notes, a published contact, links and a sponsor.
 *
 * Nothing else seeds these, so without them no page a scanner reads draws
 * those sections. `rows: 'one'` gives a draft one performer, one slot and one
 * question, so the editor's repeating rows exist when its steps are measured.
 * Every string is held to the payload scans' needles, like the rest of this
 * world, and every address is on a `.test` host nothing resolves.
 *
 * @param {string} tag The run suffix.
 * @param {object} [options] Options.
 * @param {'all'|'one'} [options.rows] How much of each list.
 * @returns {object} The fields, as the `Event` columns hold them.
 */
export function eventContent(tag, { rows = 'all' } = {}) {
  checkedTag(tag)

  const performers = [
    {
      name: 'Meera Dhol Ensemble',
      role: 'Dhol and percussion',
      bio: 'Six drummers from Jersey City who have played garba nights since 2014.',
    },
    { name: 'Kiran Solanki', role: 'Lead vocals' },
  ]
  const runningOrder = [
    { time: '19:00', title: 'Doors and aarti', note: 'The aarti starts on time.' },
    { time: '19:45', title: 'First garba set' },
    { time: '21:30', title: 'Dandiya raas', note: 'Sticks are lent at the door.' },
  ]
  const faq = [
    {
      question: 'Can I bring my own dandiya sticks?',
      answer: 'Yes. Sticks are lent at the door as well, and handed back as you leave.',
    },
    { question: 'Is there food?', answer: 'Vegetarian stalls open at seven.' },
  ]
  const one = rows === 'one'
  const content = {
    performers: one ? performers.slice(0, 1) : performers,
    artists: (one ? performers.slice(0, 1) : performers).map((performer) => performer.name),
    runningOrder: one ? runningOrder.slice(0, 1) : runningOrder,
    faq: one ? faq.slice(0, 1) : faq,
    dressCode: 'Traditional dress is welcome and not required. Wear shoes you can dance in.',
    directions: 'Parking is in the south lot. The entrance is beside the fountain.',
    publicContactEmail: `hello-${tag}@example.test`,
    publicContactPhone: '+1 201 555 0142',
    // The website is the event's own column, never a social link: the
    // database refuses `socialLinks.website` (`event_social_links_shape`).
    // Writing it here leaves the link off and waiting for an administrator,
    // as an organiser's save does; nothing here turns it on.
    websiteUrl: `https://garba-${tag}.example.test/`,
    socialLinks: {
      instagram: 'https://www.instagram.com/desievent.sweep',
    },
    sponsors: [
      { name: 'Edison Sweets', url: `https://sweets-${tag}.example.test/`, level: 'Gold' },
    ],
  }

  assertNoPayloadNeedles({
    ...Object.fromEntries(
      content.performers.flatMap((p, i) =>
        Object.entries(p).map(([k, v]) => [`performer ${i} ${k}`, v]),
      ),
    ),
    ...Object.fromEntries(
      content.runningOrder.flatMap((r, i) =>
        Object.entries(r).map(([k, v]) => [`slot ${i} ${k}`, v]),
      ),
    ),
    ...Object.fromEntries(
      content.faq.flatMap((q, i) => Object.entries(q).map(([k, v]) => [`question ${i} ${k}`, v])),
    ),
    'dress code': content.dressCode,
    directions: content.directions,
    sponsor: content.sponsors[0].name,
  })

  return content
}

/**
 * Write {@link eventContent} onto an existing event.
 *
 * For the accessibility sweep, whose own world's events carry none of it.
 * The event keeps its status: this is what the organiser's content steps
 * write, not a lifecycle change. Whatever cleans up the event takes this with
 * it.
 *
 * @param {string} eventId The event.
 * @param {string} tag The run suffix.
 * @param {object} [options] As {@link eventContent} takes them.
 * @returns {Promise<object>} What was written.
 */
export async function seedEventContent(eventId, tag, options = {}) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })
  const content = eventContent(tag, options)

  try {
    await prisma.event.update({ where: { id: eventId }, data: content })

    return content
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * A postponed event beside an existing one: same organisation, venue, zone
 * and terms, one night, one tier, and no date yet to come back on.
 *
 * For the accessibility sweep, whose organiser needs a postponed event to open
 * the form that sets a new date and brings it back (`event-reschedule-form`).
 * It hangs from the same organisation as `fromEventId`, so whatever cleans up
 * that organisation's events removes it.
 *
 * @param {object} options Options.
 * @param {string} options.fromEventId The event to take the organisation, venue and terms from.
 * @param {string} options.tag The run suffix.
 * @returns {Promise<{eventId: string, title: string, slug: string}>} The postponed event.
 */
export async function seedPostponedEvent({ fromEventId, tag }) {
  checkedTag(tag)

  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const from = await prisma.event.findUniqueOrThrow({ where: { id: fromEventId } })
    const now = new Date()
    const startsAt = new Date(now.getTime() + 40 * DAY_MS)
    const endsAt = new Date(startsAt.getTime() + 3 * 3_600_000)
    const event = await prisma.event.create({
      data: {
        organizationId: from.organizationId,
        venueId: from.venueId,
        title: `Postponed Evening ${tag}`,
        slug: `postponed-evening-${tag}`,
        summary: 'Postponed until the venue can be used again.',
        description:
          'An evening moved off its date. Ticket holders keep their tickets until a new date is set.',
        category: from.category,
        status: 'POSTPONED',
        startsAt,
        endsAt,
        timezone: from.timezone,
        policies: from.policies ?? undefined,
        publishedAt: now,
        salesOpenedAt: now,
        postponedAt: now,
        previousStartsAt: startsAt,
      },
    })
    const session = await prisma.eventSession.create({
      data: {
        eventId: event.id,
        startsAt,
        endsAt,
        timezone: from.timezone,
        status: 'SCHEDULED',
        sortOrder: 0,
        label: 'The evening',
      },
    })

    await prisma.ticketType.create({
      data: {
        eventId: event.id,
        eventSessionId: session.id,
        name: 'General admission',
        priceCents: 2_000,
        currency: 'USD',
        quantityTotal: 100,
        status: 'ON_SALE',
      },
    })

    return { eventId: event.id, title: event.title, slug: event.slug }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Seed the feature world for one run.
 *
 * Seeded once per tag, like the refusals world it sits beside. The accounts
 * are upserted, because a fixture user outlives cleanup (see
 * {@link cleanupFeatureWorld}); everything else is created, and carries the
 * tag, so a second run with a new tag collides with nothing. A second seed of
 * the same tag works after a cleanup that removed gamma, and is refused, before
 * anything is written, when gamma or pending is still there (see
 * {@link refuseLeftovers}).
 *
 * @param {object} options Options.
 * @param {string} options.tag A suffix unique to this run: 3 to 24 lower-case letters and digits.
 * @returns {Promise<object>} The ids and names the specs navigate by.
 */
export async function seedFeatureWorld({ tag }) {
  checkedTag(tag)

  const accounts = featureAccounts(tag)
  const slugs = featureSlugs(tag)
  const promoCodes = featurePromoCodes(tag)
  const TAG = tag.toUpperCase()

  assertNoPayloadNeedles({
    'giver name': GIVER_NAME,
    'taker name': TAKER_NAME,
    'current promo code': promoCodes.current,
    'expired promo code': promoCodes.expired,
    'used promo code': promoCodes.used,
  })

  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await refuseLeftovers(prisma, tag)

    const passwordHash = await hashPassword(PASSWORD)

    /**
     * A signed-in-able account, upserted: fixture users outlive a run.
     *
     * @param {string} email The address.
     * @param {string} displayName The name.
     * @param {string} role The platform role.
     * @returns {Promise<object>} The user.
     */
    const account = (email, displayName, role) =>
      prisma.user.upsert({
        where: { email },
        update: { passwordHash, displayName, role, emailVerified: true },
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

    // ---------------------------------------------------------------- people

    const gammaOwner = await account(accounts.gammaOwner, 'Gamma Owner', 'ORGANIZER')
    const giver = await account(accounts.giver, GIVER_NAME, 'ATTENDEE')
    const taker = await account(accounts.taker, TAKER_NAME, 'ATTENDEE')
    const roleTarget = await account(accounts.roleTarget, 'Role Target', 'ATTENDEE')
    const pendingOwner = await account(accounts.pendingOwner, 'Pending Owner', 'ORGANIZER')
    const doorModerator = await account(accounts.doorModerator, 'Door Moderator', 'MODERATOR')
    const linkAdmin = await account(accounts.linkAdmin, LINK_ADMIN_NAME, 'ADMIN')

    await enrol(gammaOwner.id)
    await enrol(pendingOwner.id)
    // A platform role with capabilities, none of them the door's: the role
    // requires a second factor, so it has one, and it signs in the way a real
    // moderator would.
    await enrol(doorModerator.id)
    // A platform administrator is a privileged role, which requires a factor.
    await enrol(linkAdmin.id)
    // An attendee needs no factor, but the role this account is about to be
    // given does: a platform role without one is refused at the next
    // privileged route, which is a different journey from the one under test.
    await enrol(roleTarget.id)

    // --------------------------------------------------------- organisations

    const now = new Date()

    const gamma = await prisma.organization.create({
      data: {
        name: `Gamma Collective ${tag}`,
        slug: slugs.gamma,
        contactEmail: `gamma-${tag}@example.test`,
        verificationStatus: 'VERIFIED',
        verified: true,
        verificationUpdatedAt: now,
        payoutCurrency: FEATURE_CURRENCY,
        timezone: FEATURE_TIME_ZONE,
      },
    })

    await prisma.membership.create({
      data: { userId: gammaOwner.id, organizationId: gamma.id, role: 'OWNER' },
    })

    // Asked, and waiting: created by its owner from the site, the way the
    // self-service form creates one, with the one history row a submission
    // writes.
    const pending = await prisma.organization.create({
      data: {
        name: `Pending Collective ${tag}`,
        slug: slugs.pending,
        contactEmail: `pending-${tag}@example.test`,
        legalName: `Pending Collective ${tag} LLC`,
        verificationStatus: 'PENDING',
        verified: false,
        verificationUpdatedAt: now,
        payoutCurrency: FEATURE_CURRENCY,
        timezone: FEATURE_TIME_ZONE,
        createdById: pendingOwner.id,
      },
    })

    await prisma.membership.create({
      data: { userId: pendingOwner.id, organizationId: pending.id, role: 'OWNER' },
    })
    await prisma.organizationVerificationEvent.create({
      data: {
        organizationId: pending.id,
        fromStatus: 'UNVERIFIED',
        toStatus: 'PENDING',
        actorId: pendingOwner.id,
      },
    })

    // ----------------------------------------------------------------- venue

    // Upserted, and handed back to gamma: its published seat plan outlives a
    // cleanup (see `cleanupFeatureWorld`), so a second seed of the same tag
    // after a cleanup — a run re-started with `DETAIL_E2E_TAG` or
    // `SWEEP_E2E_TAG` pinned — finds it rather than colliding with it. A
    // cleanup that kept gamma itself is refused above, before this point.
    const venueFields = {
      name: `Gamma Hall ${tag}`,
      addressLine1: '1 Test Plaza',
      city: 'Edison',
      region: 'NJ',
      postalCode: '08817',
      country: 'US',
      timezone: FEATURE_TIME_ZONE,
      organizationId: gamma.id,
      provenance: 'organizer',
    }
    const venue = await prisma.venue.upsert({
      where: { slug: slugs.venue },
      update: venueFields,
      create: { slug: slugs.venue, ...venueFields },
    })

    const policies = {
      entry: 'Doors open half an hour before. Bring the pass on your phone.',
      refund: 'Refunds up to seven days before the night.',
      conduct: 'Be kind to each other and to the floor.',
    }

    /**
     * An event on sale, public, with its sales opened.
     *
     * @param {object} fields What differs between the two.
     * @returns {Promise<object>} The event.
     */
    const eventOnSale = (fields) =>
      prisma.event.create({
        data: {
          organizationId: gamma.id,
          venueId: venue.id,
          timezone: FEATURE_TIME_ZONE,
          status: 'ON_SALE',
          publishedAt: now,
          salesOpenedAt: now,
          policies,
          contactEmail: `gamma-${tag}@example.test`,
          ...fields,
        },
      })

    // ------------------------------------------ general admission, two nights

    const gaNights = [night(40), night(41)]
    const websites = featureWebsites(tag)

    const gaEvent = await eventOnSale({
      title: `Gamma Garba Nights ${tag}`,
      slug: slugs.gaEvent,
      summary: 'Two nights of garba, one ticket a night.',
      description:
        'A general-admission floor on two consecutive nights. Each night is sold separately, and a ticket is for its own night only.',
      category: 'GARBA_DANDIYA',
      startsAt: gaNights[0].startsAt,
      endsAt: gaNights[1].endsAt,
      // The organiser's address, waiting for an administrator, its link off:
      // what an organiser's save leaves. `desi_event_website_change` would
      // mark it waiting by itself; it is said here so the row reads as meant.
      websiteUrl: websites.gaEvent,
      websiteDecisionPending: true,
      websiteSubmittedAt: now,
    })

    const gaSessions = []
    const gaTiers = []

    for (const [index, times] of gaNights.entries()) {
      const session = await prisma.eventSession.create({
        data: {
          eventId: gaEvent.id,
          ...times,
          timezone: FEATURE_TIME_ZONE,
          status: 'ON_SALE',
          capacity: 200,
          sortOrder: index,
          label: `Night ${index + 1}`,
        },
      })

      gaSessions.push(session)
      gaTiers.push(
        await prisma.ticketType.create({
          data: {
            eventId: gaEvent.id,
            eventSessionId: session.id,
            name: `General admission, night ${index + 1}`,
            priceCents: GA_PRICE_CENTS,
            currency: FEATURE_CURRENCY,
            quantityTotal: 100,
            status: 'ON_SALE',
            sortOrder: index,
          },
        }),
      )
    }

    // ----------------------------------------------- reserved seats, two nights

    const { version, zone, boxZone, seats } = await balconyPlan(prisma, {
      venueId: venue.id,
      tag,
      now,
    })

    const seatedNights = [night(50), night(51)]

    const seatedEvent = await eventOnSale({
      title: `Gamma Balcony Concert ${tag}`,
      slug: slugs.seatedEvent,
      summary: 'Two nights in the balcony, every seat numbered.',
      description:
        'A seated concert on two consecutive nights. Every ticket is for a named balcony seat on one night.',
      category: 'MUSIC_CONCERT',
      startsAt: seatedNights[0].startsAt,
      endsAt: seatedNights[1].endsAt,
      // Its link on, decided by link-admin for exactly this address, so a
      // public page with a live link exists whatever order the specs run in.
      // Nothing waits: the address is the one decided on.
      websiteUrl: websites.seatedEvent,
      websiteRedirectEnabled: true,
      websiteDecidedUrl: websites.seatedEvent,
      websiteRedirectChangedAt: now,
      websiteRedirectChangedById: linkAdmin.id,
      websiteRedirectReason: SEATED_LINK_REASON,
    })

    const seatedSessions = []
    const seatedTiers = []
    const boxTiers = []
    // Night index, then seat label, to the EventSeat that sells it.
    const eventSeats = []
    const boxLabels = new Set(BOX_SEATS.map((box) => box.label))
    const blocked = new Map(
      BOX_SEATS.filter((box) => box.blockedReason).map((box) => [box.label, box.blockedReason]),
    )

    for (const [index, times] of seatedNights.entries()) {
      const session = await prisma.eventSession.create({
        data: {
          eventId: seatedEvent.id,
          ...times,
          timezone: FEATURE_TIME_ZONE,
          status: 'ON_SALE',
          venueMapVersionId: version.id,
          sortOrder: index,
          label: `Night ${index + 1}`,
        },
      })

      // One reserved tier prices each zone on each night, and every seat in
      // the zone is bound to it — what `bindReservedSeats` does when a tier is
      // created or sales open, written here directly.
      const tier = await prisma.ticketType.create({
        data: {
          eventId: seatedEvent.id,
          eventSessionId: session.id,
          priceZoneId: zone.id,
          reserved: true,
          name: `Balcony, night ${index + 1}`,
          priceCents: SEAT_PRICE_CENTS,
          currency: FEATURE_CURRENCY,
          quantityTotal: seats.length - boxLabels.size,
          status: 'ON_SALE',
          sortOrder: index,
        },
      })
      const boxTier = await prisma.ticketType.create({
        data: {
          eventId: seatedEvent.id,
          eventSessionId: session.id,
          priceZoneId: boxZone.id,
          reserved: true,
          name: `Boxes, night ${index + 1}`,
          priceCents: BOX_PRICE_CENTS,
          currency: FEATURE_CURRENCY,
          quantityTotal: boxLabels.size,
          status: 'ON_SALE',
          sortOrder: seatedNights.length + index,
        },
      })

      const bySeat = {}

      for (const seat of seats) {
        // The blocked box is the organiser's to hold back: bound to its tier,
        // as a prepared seat is, and not for sale.
        const reason = blocked.get(seat.label) ?? null
        const eventSeat = await prisma.eventSeat.create({
          data: {
            eventSessionId: session.id,
            seatId: seat.id,
            ticketTypeId: boxLabels.has(seat.label) ? boxTier.id : tier.id,
            status: reason ? 'BLOCKED' : 'AVAILABLE',
            blockedReason: reason,
          },
        })

        bySeat[seat.label] = eventSeat.id
      }

      seatedSessions.push(session)
      seatedTiers.push(tier)
      boxTiers.push(boxTier)
      eventSeats.push(bySeat)
    }

    // ------------------------------------------------------------- the draft

    const draftTimes = night(60)
    const draftEvent = await prisma.event.create({
      data: {
        organizationId: gamma.id,
        venueId: venue.id,
        title: `Gamma Draft ${tag}`,
        slug: slugs.draftEvent,
        summary: 'Not published, and not finished.',
        description:
          'A draft for pictures and the detail fields: nothing about it is public, and nothing is sold.',
        category: 'CULTURAL_FESTIVAL',
        status: 'DRAFT',
        startsAt: draftTimes.startsAt,
        endsAt: draftTimes.endsAt,
        timezone: FEATURE_TIME_ZONE,
        policies,
      },
    })

    await prisma.ticketType.create({
      data: {
        eventId: draftEvent.id,
        name: 'General admission',
        priceCents: GA_PRICE_CENTS,
        currency: FEATURE_CURRENCY,
        quantityTotal: 50,
        status: 'DRAFT',
      },
    })

    // ------------------------------------------------------------ online
    //
    // No venue, a joining link, and two tiers: the public one, and a hidden
    // one the public page must not list and a stranger must not book by id.
    // Seventy days out, after every other public event in the detail world,
    // so the listings those specs read keep their order.

    const onlineTimes = night(70)
    const onlineEvent = await prisma.event.create({
      data: {
        organizationId: gamma.id,
        venueId: null,
        isOnline: true,
        onlineUrl: onlineJoinUrl(tag),
        title: `Gamma Online Workshop ${tag}`,
        slug: slugs.onlineEvent,
        summary: 'A garba steps class, streamed.',
        description:
          'An online class in the first eight steps of garba. The joining link is on your ticket once you have booked.',
        category: 'WORKSHOP',
        status: 'ON_SALE',
        publishedAt: now,
        salesOpenedAt: now,
        startsAt: onlineTimes.startsAt,
        endsAt: onlineTimes.endsAt,
        timezone: FEATURE_TIME_ZONE,
        policies,
        contactEmail: `gamma-${tag}@example.test`,
      },
    })

    const onlinePublicTier = await prisma.ticketType.create({
      data: {
        eventId: onlineEvent.id,
        name: ONLINE_TIERS.public,
        priceCents: ONLINE_PRICE_CENTS,
        currency: FEATURE_CURRENCY,
        quantityTotal: 100,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    })
    const onlineHiddenTier = await prisma.ticketType.create({
      data: {
        eventId: onlineEvent.id,
        name: ONLINE_TIERS.hidden,
        priceCents: ONLINE_PRICE_CENTS,
        currency: FEATURE_CURRENCY,
        quantityTotal: 20,
        status: 'ON_SALE',
        visibility: 'HIDDEN',
        sortOrder: 1,
      },
    })

    // ----------------------------------------------------------- promo codes

    // Organisation-wide, so the current code applies on either event.
    await prisma.promoCode.create({
      data: {
        organizationId: gamma.id,
        code: promoCodes.current,
        type: 'PERCENTAGE',
        value: 1_000,
        active: true,
      },
    })
    await prisma.promoCode.create({
      data: {
        organizationId: gamma.id,
        code: promoCodes.expired,
        type: 'PERCENTAGE',
        value: 1_000,
        active: true,
        startsAt: new Date(now.getTime() - 30 * DAY_MS),
        endsAt: new Date(now.getTime() - DAY_MS),
      },
    })
    // One use allowed, and that use counted: live in every other respect, so
    // a buyer is told it is used up rather than anything else, and its
    // organiser may pause it but not delete it.
    await prisma.promoCode.create({
      data: {
        organizationId: gamma.id,
        code: promoCodes.used,
        type: 'PERCENTAGE',
        value: 1_000,
        active: true,
        maxRedemptions: 1,
        redemptionCount: 1,
      },
    })

    // ------------------------------------------------------ the giver's orders

    const offer = await paidOrder(prisma, {
      reference: `DE-GO${TAG}`,
      codePrefix: `DE-GAM-${TAG}-O`,
      eventId: gaEvent.id,
      eventSessionId: gaSessions[0].id,
      ticketTypeId: gaTiers[0].id,
      buyer: giver,
      attendeeNames: [GIVER_NAME],
      unitPriceCents: GA_PRICE_CENTS,
    })

    const seatedLabel = 'A3'
    const seated = await paidOrder(prisma, {
      reference: `DE-GS${TAG}`,
      codePrefix: `DE-GAM-${TAG}-S`,
      eventId: seatedEvent.id,
      eventSessionId: seatedSessions[0].id,
      ticketTypeId: seatedTiers[0].id,
      buyer: giver,
      attendeeNames: [GIVER_NAME],
      eventSeatIds: [eventSeats[0][seatedLabel]],
      unitPriceCents: SEAT_PRICE_CENTS,
    })

    const group = await paidOrder(prisma, {
      reference: `DE-GG${TAG}`,
      codePrefix: `DE-GAM-${TAG}-G`,
      eventId: gaEvent.id,
      eventSessionId: gaSessions[1].id,
      ticketTypeId: gaTiers[1].id,
      buyer: giver,
      attendeeNames: [...GROUP_GUESTS],
      unitPriceCents: GA_PRICE_CENTS,
    })

    // One ticket that only the platform's door admits in its spec: nobody in
    // gamma is signed in at it there, and no other spec touches it.
    const platform = await paidOrder(prisma, {
      reference: `DE-GP${TAG}`,
      codePrefix: `DE-GAM-${TAG}-P`,
      eventId: gaEvent.id,
      eventSessionId: gaSessions[0].id,
      ticketTypeId: gaTiers[0].id,
      buyer: giver,
      attendeeNames: [PLATFORM_GUEST],
      unitPriceCents: GA_PRICE_CENTS,
    })

    return {
      gammaOrganizationId: gamma.id,
      gammaOrganizationName: gamma.name,
      gammaOrganizationSlug: gamma.slug,
      gammaOwnerEmail: gammaOwner.email,
      gammaOwnerId: gammaOwner.id,
      gammaVenueId: venue.id,
      gammaGaEventId: gaEvent.id,
      gammaGaEventSlug: gaEvent.slug,
      gammaGaEventTitle: gaEvent.title,
      gammaGaSessionIds: gaSessions.map((session) => session.id),
      gammaGaTierIds: gaTiers.map((tier) => tier.id),
      gammaSeatedEventId: seatedEvent.id,
      gammaSeatedEventSlug: seatedEvent.slug,
      gammaSeatedEventTitle: seatedEvent.title,
      gammaSeatedSessionIds: seatedSessions.map((session) => session.id),
      gammaSeatedTierIds: seatedTiers.map((tier) => tier.id),
      gammaBoxTierIds: boxTiers.map((tier) => tier.id),
      gammaMapVersionId: version.id,
      gammaPriceZoneId: zone.id,
      gammaBoxZoneId: boxZone.id,
      gammaSeatLabels: seats.map((seat) => seat.label),
      gammaDraftEventId: draftEvent.id,
      gammaDraftEventSlug: draftEvent.slug,
      gammaOnlineEventId: onlineEvent.id,
      gammaOnlineEventSlug: onlineEvent.slug,
      gammaOnlineEventTitle: onlineEvent.title,
      gammaOnlineTierId: onlinePublicTier.id,
      gammaOnlineHiddenTierId: onlineHiddenTier.id,
      gammaPromoCode: promoCodes.current,
      gammaExpiredPromoCode: promoCodes.expired,
      gammaUsedPromoCode: promoCodes.used,
      giverEmail: giver.email,
      giverId: giver.id,
      offerTicketId: offer.ticketIds[0],
      offerOrderReference: offer.reference,
      seatedTicketId: seated.ticketIds[0],
      seatedTicketSeatLabel: seatedLabel,
      seatedOrderReference: seated.reference,
      groupOrderId: group.orderId,
      groupOrderReference: group.reference,
      groupTicketIds: group.ticketIds,
      platformOrderReference: platform.reference,
      platformTicketId: platform.ticketIds[0],
      platformTicketCode: `DE-GAM-${TAG}-P1`,
      takerEmail: taker.email,
      takerId: taker.id,
      roleTargetEmail: roleTarget.email,
      roleTargetId: roleTarget.id,
      pendingOrganizationId: pending.id,
      pendingOrganizationName: pending.name,
      pendingOrganizationSlug: pending.slug,
      pendingOwnerEmail: pendingOwner.email,
      doorModeratorEmail: doorModerator.email,
      doorModeratorId: doorModerator.id,
      linkAdminEmail: linkAdmin.email,
      linkAdminId: linkAdmin.id,
      linkAdminName: linkAdmin.displayName,
      gammaGaWebsiteUrl: websites.gaEvent,
      gammaSeatedWebsiteUrl: websites.seatedEvent,
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Remove what the run created under the feature world, in the order the
 * foreign keys allow.
 *
 * Which organisations: gamma, pending, and any organisation an account of this
 * run created from the site — a spec that creates "Self Made <tag>" is found by
 * its creator, not by a name this file would have to know. Never alpha, beta
 * or the unverified one, which the refusals cleanup owns.
 *
 * What stays, on purpose:
 *
 *   - **An order a ledger batch names**, with its tickets, and so its event
 *     and organisation: the ledger is append-only, and an order a spec paid
 *     for through checkout is posted. Skipped rather than attempted, so the
 *     log carries no foreign-key error that reads like a failure.
 *   - **A published map version**, its sections, rows and seats, and so its
 *     map and venue: a published layout is frozen by trigger, and a teardown
 *     is not the thing that should prove otherwise. The venue loses its
 *     organisation with the organisation, as `seed-organizer.mjs`'s do; a
 *     later seed of the same tag takes both back (see `balconyPlan`). A kept
 *     gamma is not taken back: a later seed of its tag is refused (see
 *     `refuseLeftovers`).
 *   - **Every user row, and every audit row.**
 *     The audit rows deliberately stay: `desi_audit_log_immutable` refuses an
 *     UPDATE or a DELETE on `AuditLog`, and the actor foreign key is ON DELETE
 *     SET NULL, so deleting an account would be an update of its audit rows
 *     and is refused. In this system a person is redacted, never deleted.
 *     Their sessions, factors and memberships go, which is what makes a
 *     left-behind account inert.
 *
 * Everything left behind carries the tag, in a database that is disposable by
 * construction.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<{pinnedOrderIds: string[]}>} Which orders the ledger kept.
 */
export async function cleanupFeatureWorld(tag) {
  checkedTag(tag)

  const accounts = Object.values(featureAccounts(tag))
  const slugs = featureSlugs(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })
  const pinnedOrderIds = []

  try {
    const organizations = await prisma.organization.findMany({
      where: {
        OR: [
          { slug: { in: [slugs.gamma, slugs.pending] } },
          { createdBy: { email: { contains: tag } } },
        ],
      },
    })
    // Read before any organisation is deleted, which would take the link with it.
    const creatorIds = organizations
      .map((organization) => organization.createdById)
      .filter((id) => id !== null)

    for (const organization of organizations) {
      const events = await prisma.event.findMany({ where: { organizationId: organization.id } })

      for (const event of events) {
        // Picture bytes go with their asset, by cascade.
        await prisma.mediaAsset.deleteMany({ where: { eventId: event.id } }).catch(() => {})
        // A seat still held — a spec that stopped between reserving and
        // paying — is given back first: deleting its hold would clear the
        // seat's hold and leave it HELD, which `event_seat_status_coherent`
        // refuses, and the refusal would keep every hold below.
        await prisma.eventSeat
          .updateMany({
            where: { status: 'HELD', hold: { ticketType: { eventId: event.id } } },
            data: { status: 'AVAILABLE', holdId: null },
          })
          .catch(() => {})
        // A hold line refuses its tier's deletion; its hold takes it along.
        await prisma.ticketHold
          .deleteMany({ where: { ticketType: { eventId: event.id } } })
          .catch(() => {})

        const orders = await prisma.order.findMany({
          where: { eventId: event.id },
          include: { items: true },
        })

        for (const order of orders) {
          // Asked first, before anything of the order's is touched: a ledger
          // batch of any status refuses the order's deletion, and an order that
          // must stay keeps its tickets too, rather than surviving as a paid
          // order that issued nothing.
          const ledgered = await prisma.ledgerBatch.count({ where: { orderId: order.id } })

          if (ledgered > 0) {
            pinnedOrderIds.push(order.id)
            continue
          }

          await prisma.reconciliationTask
            .deleteMany({ where: { orderId: order.id } })
            .catch(() => {})
          await prisma.refundItem
            .deleteMany({ where: { refund: { orderId: order.id } } })
            .catch(() => {})
          await prisma.refund.deleteMany({ where: { orderId: order.id } }).catch(() => {})

          const itemIds = order.items.map((item) => item.id)

          // Transfers and check-ins go with their tickets, by cascade.
          await prisma.ticket
            .deleteMany({ where: { orderItemId: { in: itemIds } } })
            .catch(() => {})

          await prisma.eventSeat
            .updateMany({
              where: { orderItemId: { in: itemIds } },
              data: { status: 'AVAILABLE', orderItemId: null },
            })
            .catch(() => {})
          await prisma.orderItem.deleteMany({ where: { orderId: order.id } }).catch(() => {})
          await prisma.payment.deleteMany({ where: { orderId: order.id } }).catch(() => {})
          // The group pass goes with its order, by cascade.
          await prisma.order.delete({ where: { id: order.id } }).catch(() => {})
        }

        const remaining = await prisma.order.count({ where: { eventId: event.id } })

        if (remaining > 0) continue

        const sessions = await prisma.eventSession.findMany({ where: { eventId: event.id } })

        for (const session of sessions) {
          await prisma.eventSeat
            .deleteMany({ where: { eventSessionId: session.id } })
            .catch(() => {})
        }

        await prisma.promoCode.deleteMany({ where: { eventId: event.id } }).catch(() => {})
        await prisma.ticketType.deleteMany({ where: { eventId: event.id } }).catch(() => {})
        await prisma.eventSession.deleteMany({ where: { eventId: event.id } }).catch(() => {})
        await prisma.eventModerationAction
          .deleteMany({ where: { eventId: event.id } })
          .catch(() => {})
        await prisma.event.delete({ where: { id: event.id } }).catch(() => {})
      }

      await prisma.promoCode
        .deleteMany({ where: { organizationId: organization.id } })
        .catch(() => {})
      await prisma.invitation
        .deleteMany({ where: { organizationId: organization.id } })
        .catch(() => {})

      const venues = await prisma.venue.findMany({ where: { organizationId: organization.id } })

      for (const venue of venues) {
        const maps = await prisma.venueMap.findMany({ where: { venueId: venue.id } })

        for (const map of maps) {
          const versions = await prisma.venueMapVersion.findMany({ where: { venueMapId: map.id } })

          for (const version of versions) {
            // Published layouts are frozen by trigger; see the note above.
            if (version.publishedAt) continue

            await prisma.venueMapVersion.delete({ where: { id: version.id } }).catch(() => {})
          }

          if (versions.some((version) => version.publishedAt)) continue

          await prisma.venueMap.delete({ where: { id: map.id } }).catch(() => {})
        }

        const keptMaps = await prisma.venueMap.count({ where: { venueId: venue.id } })

        if (keptMaps === 0) {
          await prisma.venue.delete({ where: { id: venue.id } }).catch(() => {})
        }
      }

      const pinned = await prisma.event.count({ where: { organizationId: organization.id } })

      if (pinned > 0) continue

      // Memberships and verification history go with it, by cascade; a kept
      // venue is left without an owner rather than blocking the delete.
      await prisma.organization.delete({ where: { id: organization.id } }).catch(() => {})
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [{ email: { in: accounts } }, { id: { in: creatorIds } }],
      },
    })

    for (const user of users) {
      await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {})
      await prisma.mfaFactor.deleteMany({ where: { userId: user.id } }).catch(() => {})
      await prisma.membership.deleteMany({ where: { userId: user.id } }).catch(() => {})
      // The user row stays, and so do its audit rows: see the note above.
    }
  } finally {
    await prisma.$disconnect()
  }

  return { pinnedOrderIds }
}
