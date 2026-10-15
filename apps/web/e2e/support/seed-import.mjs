/**
 * The accounts, the organisation and the listing file the import journeys
 * need (SPEC2-XI area I, §9 row 12).
 *
 * `detail-event-import.spec.js` uploads a listing file in the browser,
 * applies it, approves and publishes what it wrote with its tickets on sale,
 * buys a ticket to one through the checkout, imports the file again, moves one
 * event to an organiser's own organisation, and takes the sold one off the
 * site with its order refunded. Every one of those writes something nothing
 * can take back from the page, so everything here is new and carries the tag:
 *
 *   - **The platform administrator** (`import-admin-<tag>@platform.test`,
 *     ADMIN, a confirmed second factor as the role requires), who imports,
 *     approves, publishes and moves. Imports are held by `event:import`, and
 *     approving also needs `moderation:review`; an ADMIN holds both.
 *   - **The moderator** (`import-moderator-<tag>@platform.test`, MODERATOR, a
 *     factor), who reviews events but imports nothing.
 *   - **The buyer** (`import-buyer-<digest>@attendee.test`, ATTENDEE, no
 *     factor), who buys one ticket to an imported event through the checkout,
 *     paid by the simulated provider. Its address carries a digest of the tag,
 *     not the tag, as `seed-full-control.mjs` explains: the detail world's
 *     teardown clears every order whose buyer's address holds the tag.
 *   - **Import Gamma <tag>**, a VERIFIED organisation (America/Chicago) with
 *     its owner (`import-owner-<tag>@organiser.test`, a factor), which an
 *     imported event is moved to. It holds one ordinary event waiting for
 *     review, "Import Gamma Waiting <tag>", which no import wrote: the event an
 *     approval must refuse.
 *
 * ## The listing file
 *
 * Built at run time, never committed ({@link buildImportDataset}): three
 * listings dated 10, 11 and 12 days after the run, so none is ever skipped as
 * past, each `sourceId` the run's own number ({@link importRunNumber}) and a
 * digit, so no two runs collide. Like every import file since 2026-10-15 it
 * carries **no web address at all** — no listing link, no ticket link, no
 * picture, no source name or host (ADR 0015, addendum 2026-10-15 (2)) — so
 * nothing the import writes can lead anywhere but The Desi Events. The spec
 * uploads it with `setInputFiles({ name, mimeType, buffer })`.
 *
 * There are no pictures: an import copies none, so no picture is read from
 * anywhere, a directory included.
 *
 * ## Isolation
 *
 * The imported events are the soonest public events of the detail world
 * (every other world's are forty days out or more), and the one waiting for
 * review joins the moderation queue. None of them may still be there when the
 * specs after this one count a list, so {@link cleanupImport} runs in the
 * spec's `afterAll` as well as before it seeds.
 *
 * ## Cleanup
 *
 * {@link cleanupImport} removes the events this file's listings wrote (found
 * by their `sourceId`, whichever organisation now holds them) and Import
 * Gamma's events, with their nights, pictures and moderation history; the
 * import records, change notices and visits go with each event by cascade. Then the runs the administrator planned, the venues
 * whose names carry the tag, Import Gamma with its memberships, and — only
 * when the spec says it made it and it is empty — the platform-held
 * organisation "The Desi Events". An event an order pins is kept, as the other
 * seeds keep one: the garba night, whose ticket the checkout sold and the
 * ledger therefore holds. The spec's last journey takes it off the site (and
 * refunds its order) before the cleanup runs, so it is no public event of the
 * detail world when the next spec counts a list.
 *
 * The audit rows deliberately stay: `desi_audit_log_immutable` refuses an
 * UPDATE or a DELETE on `AuditLog`, and the actor foreign key is ON DELETE SET
 * NULL, so deleting an account would be an update of its audit rows and is
 * refused. Every user row stays with them; without its sessions, factor and
 * memberships a left-behind account is inert.
 *
 * @module e2e/support/seed-import
 */

import { createHash } from 'node:crypto'

import { createPrismaClient } from '@desi-event/db'
import { hashPassword, seal } from '@desi-event/auth'

import { checkedTag } from './seed-feature-world.mjs'
import { AUTH_SECRET, CONNECTION, PASSWORD, TOTP_SECRET } from './seed-refusals.mjs'

/** One day, in milliseconds. */
const DAY_MS = 86_400_000

/** One hour, in milliseconds. */
const HOUR_MS = 3_600_000

/** Where every listing and organisation here runs its nights. */
export const IMPORT_TIME_ZONE = 'America/Chicago'

/** The note the curator leaves on a listing whose category The Desi Events lacks. */
export const CATEGORY_NOTE =
  'The source listing’s category is CLASSICAL; The Desi Events has no such category, so it is listed under MUSIC_CONCERT. If another fits better, change it in an editing session once the event is published.'

/**
 * The prices the first listing gives: a child's ticket is free, and the early
 * bird the listing marks sold out, which the import makes a ticket type that is
 * not on sale.
 */
export const GARBA_PRICES = Object.freeze([
  { name: 'General admission', priceCents: 2_500, currency: 'USD', note: null },
  { name: 'VIP', priceCents: 4_000, currency: 'USD', note: 'Front rows and a dinner plate' },
  { name: 'Child (under 12)', priceCents: 0, currency: 'USD', note: null },
  { name: 'Early bird', priceCents: 2_000, currency: 'USD', note: 'Sold Out' },
])

/** What each listed price becomes: an allowance, not a count the listing gave. */
export const IMPORT_ALLOWANCE = 100

/** The second listing's one price. */
export const BOLLYWOOD_PRICES = Object.freeze([
  { name: 'General admission', priceCents: 3_000, currency: 'USD', note: null },
])

/**
 * The run's number: nine digits made from the tag, so a run's `sourceId`s
 * are its own and the same on every call (Playwright runs `beforeAll` again
 * in a fresh worker after a failure). A listing's id is this and one digit,
 * ten in all; the database allows 1 to 12.
 *
 * @param {string} tag The run suffix.
 * @returns {string} Nine digits.
 */
export function importRunNumber(tag) {
  const digest = createHash('sha256').update(checkedTag(tag)).digest('hex')

  return String(Number.parseInt(digest.slice(0, 12), 16) % 1_000_000_000).padStart(9, '0')
}

/**
 * The journeys' addresses, names and titles.
 *
 * Pure, so a spec can name them before anything is seeded.
 *
 * @param {string} tag The run suffix.
 * @returns {object} The names.
 */
export function importNames(tag) {
  checkedTag(tag)

  const run = importRunNumber(tag)

  return {
    adminEmail: `import-admin-${tag}@platform.test`,
    adminName: 'Nandini Rao',
    moderatorEmail: `import-moderator-${tag}@platform.test`,
    moderatorName: 'Kunal Shah',
    ownerEmail: `import-owner-${tag}@organiser.test`,
    ownerName: 'Pooja Desai',
    // A digest of the tag, not the tag: see the module note.
    buyerEmail: `import-buyer-${createHash('sha256').update(tag).digest('hex').slice(0, 12)}@attendee.test`,
    buyerName: 'Rohan Iyer',
    gammaName: `Import Gamma ${tag}`,
    gammaSlug: `import-gamma-${tag}`,
    waitingTitle: `Import Gamma Waiting ${tag}`,
    waitingSlug: `import-gamma-waiting-${tag}`,
    fileName: `texas-${tag}.json`,
    updateFileName: `texas-${tag}-update.json`,
    listings: {
      garba: {
        sourceId: `${run}1`,
        title: `Import Garba Night ${tag}`,
        presentedBy: 'Houston Garba Collective',
      },
      bollywood: {
        sourceId: `${run}2`,
        title: `Import Bollywood Evening ${tag}`,
        presentedBy: 'Desi Beats Houston',
      },
      concert: {
        sourceId: `${run}3`,
        title: `Import Classical Concert ${tag}`,
        presentedBy: 'Raga Society of Texas',
      },
      // The sweep's plan-only listings, never applied.
      planOnly: {
        sourceId: `${run}4`,
        title: `Import Dandiya Matinee ${tag}`,
        presentedBy: 'Katy Dandiya Club',
      },
    },
  }
}

/**
 * A night in Chicago's evening, the given number of days after the run.
 *
 * Midnight UTC plus a day is seven in the evening in Chicago in daylight time
 * and six in standard time; the honest local time is whatever the zone says.
 *
 * @param {number} daysAhead How many days from now.
 * @param {Date} now The run's moment.
 * @returns {Date} The start.
 */
function evening(daysAhead, now) {
  const day = new Date(now.getTime() + daysAhead * DAY_MS)

  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + DAY_MS)
}

/**
 * The listing file, built at run time.
 *
 * Three listings: a garba night with four prices (one free, one sold out on
 * the listing) and no end time; a Bollywood evening with one price and an end
 * time; and a classical concert its listing prices nowhere, so it gets no
 * ticket type, whose category is the curator's mapping. No listing carries an
 * address of any kind. The sweep adds the plan-only listing it previews and
 * never applies, as a file of its own ({@link planOnlyDataset}).
 *
 * @param {string} tag The run suffix.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The run's moment; the dates and `scrapedAt` follow it.
 * @returns {object} A `desi-event-import/1` file.
 */
export function buildImportDataset(tag, { now = new Date() } = {}) {
  const names = importNames(tag)
  const { garba, bollywood, concert } = names.listings
  const scrapedAt = new Date(now.getTime() - HOUR_MS).toISOString()
  const hall = {
    name: `Import Hall ${tag}`,
    addressLine1: '1200 Bay Area Blvd',
    city: 'Houston',
    region: 'TX',
    postalCode: '77058',
    country: 'US',
  }
  const pavilion = {
    name: `Import Pavilion ${tag}`,
    addressLine1: '800 Bagby St',
    city: 'Houston',
    region: 'TX',
    postalCode: '77002',
    country: 'US',
  }
  const garbaStart = evening(10, now)
  const bollywoodStart = evening(11, now)
  const concertStart = evening(12, now)

  return {
    format: 'desi-event-import/1',
    source: 'SULEKHA',
    collectedFrom: new Date(now.getTime() - 2 * HOUR_MS).toISOString(),
    collectedTo: scrapedAt,
    curatedOn: now.toISOString().slice(0, 10),
    events: [
      {
        sourceId: garba.sourceId,
        scrapedAt,
        title: garba.title,
        category: 'GARBA_DANDIYA',
        sourceCategory: 'GARBA_DANDIYA',
        summary: 'A night of garba and dandiya raas with a live dhol ensemble.',
        description:
          'Four hours of garba and dandiya raas on a sprung floor, with a live dhol ensemble, sticks lent at the door and vegetarian food from seven.',
        startsAt: garbaStart.toISOString(),
        endsAt: null,
        timeZone: IMPORT_TIME_ZONE,
        venue: hall,
        performers: [{ name: 'Dhol Tasha Houston', role: 'Live drums' }],
        presentedBy: garba.presentedBy,
        languages: ['Gujarati', 'Hindi'],
        prices: GARBA_PRICES.map((price) => ({ ...price })),
        priceText: '$25 to $40',
        ageRestriction: 'All Age',
        dressCode: 'Traditional chaniya choli or kurta',
        parking: 'Free parking in the east lot.',
        faq: [{ q: 'Are sticks provided?', a: 'Yes, sticks are lent at the door.' }],
        importNotes: [
          'The header says 7:00 PM and the description says 7:30 PM; 7:00 PM is imported.',
        ],
      },
      {
        sourceId: bollywood.sourceId,
        scrapedAt,
        title: bollywood.title,
        category: 'BOLLYWOOD_NIGHT',
        sourceCategory: 'BOLLYWOOD',
        summary: 'Bollywood hits from four decades, with a dance floor.',
        description:
          'A live band plays Bollywood hits from four decades, with a dance floor in front of the stage and chaat stalls outside.',
        startsAt: bollywoodStart.toISOString(),
        endsAt: new Date(bollywoodStart.getTime() + 4 * HOUR_MS).toISOString(),
        timeZone: IMPORT_TIME_ZONE,
        venue: pavilion,
        performers: [{ name: 'The Filmi Collective', role: 'Band' }],
        presentedBy: bollywood.presentedBy,
        languages: ['Hindi'],
        prices: BOLLYWOOD_PRICES.map((price) => ({ ...price })),
        priceText: '$30',
        ageRestriction: null,
        dressCode: null,
        parking: null,
        faq: [],
        importNotes: [],
      },
      {
        sourceId: concert.sourceId,
        scrapedAt,
        title: concert.title,
        category: 'MUSIC_CONCERT',
        sourceCategory: 'CLASSICAL',
        summary: 'An evening of Hindustani classical music.',
        description:
          'A sitar recital with tabla accompaniment, two ragas in the first half and a thumri after the interval.',
        startsAt: concertStart.toISOString(),
        endsAt: null,
        timeZone: IMPORT_TIME_ZONE,
        venue: hall,
        performers: [
          { name: 'Anoushka Verma', role: 'Sitar' },
          { name: 'Ravi Kulkarni', role: 'Tabla' },
        ],
        presentedBy: concert.presentedBy,
        languages: ['Hindi'],
        prices: [],
        priceText: null,
        ageRestriction: null,
        dressCode: null,
        parking: null,
        faq: [],
        importNotes: [CATEGORY_NOTE],
      },
    ],
  }
}

/**
 * The same file with one listing's start moved, as its listing would show it
 * after the organiser moved the night: every other listing is unchanged, so
 * a new plan reads it as unchanged.
 *
 * @param {object} dataset The file {@link buildImportDataset} built.
 * @param {string} sourceId The listing whose start moves.
 * @param {number} byMs How far, in milliseconds.
 * @returns {object} A new file.
 */
export function withMovedStart(dataset, sourceId, byMs) {
  return {
    ...dataset,
    events: dataset.events.map((listing) =>
      listing.sourceId === sourceId
        ? {
            ...listing,
            startsAt: new Date(Date.parse(listing.startsAt) + byMs).toISOString(),
          }
        : listing,
    ),
  }
}

/**
 * The sweep's plan-only file: one listing no other file names, previewed and
 * never applied, so its run page stays a plan.
 *
 * @param {string} tag The run suffix.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The run's moment.
 * @returns {object} A `desi-event-import/1` file.
 */
export function planOnlyDataset(tag, { now = new Date() } = {}) {
  const dataset = buildImportDataset(tag, { now })
  const { planOnly } = importNames(tag).listings
  const [garba] = dataset.events

  return {
    ...dataset,
    events: [
      {
        ...garba,
        sourceId: planOnly.sourceId,
        title: planOnly.title,
        presentedBy: planOnly.presentedBy,
        startsAt: evening(13, now).toISOString(),
        importNotes: [
          'The source lists this event twice; only this listing is imported.',
          'A personal phone number was removed from the description.',
        ],
      },
    ],
  }
}

/**
 * A listing file as `setInputFiles` takes it.
 *
 * @param {object} dataset The file's contents.
 * @param {string} name Its name.
 * @returns {{name: string, mimeType: string, buffer: Buffer}} The upload.
 */
export function datasetUpload(dataset, name) {
  return {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(`${JSON.stringify(dataset, null, 2)}\n`, 'utf8'),
  }
}

/**
 * Seed the accounts, Import Gamma, its venue and its event waiting for review.
 *
 * Upserted or found again throughout, because Playwright starts a fresh
 * worker and runs `beforeAll` again after a failure, and a fixture user
 * outlives every run.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<object>} The ids the journeys navigate by.
 */
export async function seedImport(tag) {
  const names = importNames(tag)
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
     * `seal` picks a fresh nonce each time, so a blind create would add a
     * second factor to a re-seeded account rather than fail.
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
    const moderator = await account(names.moderatorEmail, names.moderatorName, 'MODERATOR')
    const owner = await account(names.ownerEmail, names.ownerName, 'ORGANIZER')
    const buyer = await account(names.buyerEmail, names.buyerName, 'ATTENDEE')

    for (const user of [admin, moderator, owner]) await enrol(user.id)

    const now = new Date()
    const fields = {
      name: names.gammaName,
      contactEmail: `${names.gammaSlug}@example.test`,
      verificationStatus: 'VERIFIED',
      verified: true,
      verificationUpdatedAt: now,
      payoutCurrency: 'USD',
      timezone: IMPORT_TIME_ZONE,
    }
    const gamma = await prisma.organization.upsert({
      where: { slug: names.gammaSlug },
      update: fields,
      create: { slug: names.gammaSlug, ...fields },
    })

    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: owner.id, organizationId: gamma.id } },
      update: { role: 'OWNER' },
      create: { userId: owner.id, organizationId: gamma.id, role: 'OWNER' },
    })

    // The platform accounts belong to no organisation, so an approval is never
    // a conflict of interest and a move is never to their own.
    await prisma.membership.deleteMany({
      where: { userId: { in: [admin.id, moderator.id, buyer.id] } },
    })

    const hallFields = {
      name: `Import Gamma Hall ${tag}`,
      addressLine1: '2 Test Plaza',
      city: 'Houston',
      region: 'TX',
      postalCode: '77002',
      country: 'US',
      timezone: IMPORT_TIME_ZONE,
      organizationId: gamma.id,
      provenance: 'organizer',
    }
    const hall = await prisma.venue.upsert({
      where: { slug: `import-gamma-hall-${tag}` },
      update: hallFields,
      create: { slug: `import-gamma-hall-${tag}`, ...hallFields },
    })

    // An ordinary organisation's event waiting for review: inserted in the
    // status it is meant to be in, as the other seeds insert theirs.
    let waiting = await prisma.event.findUnique({ where: { slug: names.waitingSlug } })

    if (!waiting) {
      const startsAt = evening(40, now)
      const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS)

      waiting = await prisma.event.create({
        data: {
          organizationId: gamma.id,
          venueId: hall.id,
          title: names.waitingTitle,
          slug: names.waitingSlug,
          summary: 'A night of garba under the lights, with a live dhol ensemble.',
          description:
            'Three hours of garba and dandiya raas on a sprung floor, with sticks lent at the door and vegetarian food from seven.',
          category: 'GARBA_DANDIYA',
          status: 'REVIEW_PENDING',
          startsAt,
          endsAt,
          timezone: IMPORT_TIME_ZONE,
          policies: {
            entry: 'Doors open half an hour before. Bring the pass on your phone.',
            refund: 'Refunds up to seven days before the night.',
            conduct: 'Be kind to each other and to the floor.',
          },
        },
      })

      const session = await prisma.eventSession.create({
        data: {
          eventId: waiting.id,
          startsAt,
          endsAt,
          timezone: IMPORT_TIME_ZONE,
          status: 'SCHEDULED',
          capacity: 120,
          sortOrder: 0,
        },
      })

      await prisma.ticketType.create({
        data: {
          eventId: waiting.id,
          eventSessionId: session.id,
          name: 'General admission',
          priceCents: 2_200,
          currency: 'USD',
          quantityTotal: 120,
          status: 'ON_SALE',
        },
      })
    }

    return {
      adminId: admin.id,
      moderatorId: moderator.id,
      ownerId: owner.id,
      buyerId: buyer.id,
      gammaOrganizationId: gamma.id,
      waitingEventId: waiting.id,
      waitingRevision: waiting.revision ?? 0,
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Whether the platform-held organisation ("The Desi Events") is already there.
 *
 * Asked before the journeys import, so cleanup removes it only when they made
 * it.
 *
 * @returns {Promise<boolean>} True when it exists.
 */
export async function platformHeldExists() {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return (await prisma.organization.count({ where: { platformHeldSource: 'SULEKHA' } })) > 0
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Make an account's last second-factor confirmation older than any step-up
 * window, in every session it holds, so the next privileged write asks for a
 * fresh one for certain. Moved back, not cleared.
 *
 * @param {string} email The account.
 * @returns {Promise<void>} Resolves once moved.
 */
export async function expireStepUp(email) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await prisma.session.updateMany({
      where: { user: { email }, revokedAt: null },
      data: { mfaSatisfiedAt: new Date(Date.now() - 3 * HOUR_MS) },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The events this tag's listings wrote, by `sourceId`, read from the
 * database rather than a page.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<Record<string, object>>} The events, keyed by `sourceId`.
 */
export async function importedEvents(tag) {
  const run = importRunNumber(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const items = await prisma.eventImportItem.findMany({
      where: { source: 'SULEKHA', sourceId: { in: listingIds(run) } },
      select: {
        sourceId: true,
        lastRunId: true,
        importedById: true,
        approvedById: true,
        reassignedAt: true,
        reassignedToOrganizationId: true,
        event: {
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            revision: true,
            startsAt: true,
            endsAt: true,
            organizationId: true,
            websiteUrl: true,
            websiteRedirectEnabled: true,
            websiteDecidedUrl: true,
            organization: { select: { name: true, platformHeldSource: true } },
            sessions: { select: { startsAt: true, endsAt: true, endTimeListed: true } },
            ticketTypes: {
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true,
                name: true,
                priceCents: true,
                currency: true,
                quantityTotal: true,
                quantitySold: true,
                quantityIsAllowance: true,
                minPerOrder: true,
                maxPerOrder: true,
                status: true,
                visibility: true,
                reserved: true,
                salesStartAt: true,
                salesEndAt: true,
              },
            },
            _count: { select: { media: true } },
          },
        },
      },
    })

    return Object.fromEntries(items.map((item) => [item.sourceId, item]))
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * An event's status and revision, read from the database.
 *
 * @param {string} eventId The event.
 * @returns {Promise<{status: string, revision: number}|null>} Where it stands.
 */
export async function eventStanding(eventId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true, revision: true, organizationId: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Every order of an event, oldest first, with what was refunded and how its
 * tickets stand.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object[]>} The orders.
 */
export async function ordersOf(eventId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.order.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      select: {
        reference: true,
        status: true,
        buyerEmail: true,
        totalCents: true,
        feesCents: true,
        refundedCents: true,
        items: {
          select: {
            ticketTypeId: true,
            unitPriceCents: true,
            quantity: true,
            tickets: { select: { status: true } },
          },
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The change notices written for an event, newest first.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object[]>} The notices.
 */
export async function changeNoticesFor(eventId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.eventChangeNotice.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      select: { kind: true, fields: true, changed: true, reason: true, byPlatform: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Audit rows for one entity and action, newest first. Reading the audit trail
 * is allowed; only changing it is not.
 *
 * @param {string} entityId The entity.
 * @param {string} action The action.
 * @returns {Promise<object[]>} The rows.
 */
export async function auditRows(entityId, action) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.auditLog.findMany({
      where: { entityId, action },
      orderBy: { createdAt: 'desc' },
      select: { actorId: true, metadata: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Every `sourceId` a run of this tag can write: the run's number and one
 * digit.
 *
 * @param {string} run The run's number.
 * @returns {string[]} The ids.
 */
function listingIds(run) {
  return Array.from({ length: 10 }, (_, digit) => `${run}${digit}`)
}

/**
 * Remove what the journeys made and nothing pins.
 *
 * @param {string} tag The run suffix.
 * @param {object} [options] Options.
 * @param {boolean} [options.removePlatformHeld] Also remove the platform-held organisation ("The Desi Events") when it is left empty; only when the journeys made it.
 * @returns {Promise<{keptEvents: number}>} How many events an order kept.
 */
export async function cleanupImport(tag, { removePlatformHeld = false } = {}) {
  const names = importNames(tag)
  const run = importRunNumber(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })
  let keptEvents = 0

  try {
    const gamma = await prisma.organization.findUnique({
      where: { slug: names.gammaSlug },
      select: { id: true },
    })
    const items = await prisma.eventImportItem.findMany({
      where: { source: 'SULEKHA', sourceId: { in: listingIds(run) } },
      select: { eventId: true },
    })
    const gammaEvents = gamma
      ? await prisma.event.findMany({ where: { organizationId: gamma.id }, select: { id: true } })
      : []
    const eventIds = [
      ...new Set([...items.map((item) => item.eventId), ...gammaEvents.map((e) => e.id)]),
    ]

    for (const eventId of eventIds) {
      // The checkout's order is held by the ledger, which is append-only: its
      // event is kept (taken off the site by the spec's last journey).
      if ((await prisma.order.count({ where: { eventId } })) > 0) {
        keptEvents += 1
        continue
      }

      // Import records, change notices, sittings and visits go with the event
      // by cascade; said here for what pins it.
      await prisma.mediaAsset.deleteMany({ where: { eventId } }).catch(() => {})
      await prisma.ticketType.deleteMany({ where: { eventId } }).catch(() => {})
      await prisma.eventSession.deleteMany({ where: { eventId } }).catch(() => {})
      await prisma.eventModerationAction.deleteMany({ where: { eventId } }).catch(() => {})
      await prisma.event.delete({ where: { id: eventId } }).catch(() => {
        keptEvents += 1
      })
    }

    const admin = await prisma.user.findUnique({
      where: { email: names.adminEmail },
      select: { id: true },
    })

    if (admin) {
      await prisma.eventImportRun.deleteMany({ where: { createdById: admin.id } }).catch(() => {})
    }

    // The venues the listings made (under "The Desi Events", or moved with an
    // event to Import Gamma) and Import Gamma's own, once nothing uses them.
    await prisma.venue
      .deleteMany({ where: { name: { contains: tag }, events: { none: {} } } })
      .catch(() => {})

    if (gamma && keptEvents === 0) {
      await prisma.membership.deleteMany({ where: { organizationId: gamma.id } }).catch(() => {})
      await prisma.organization.delete({ where: { id: gamma.id } }).catch(() => {})
    }

    if (removePlatformHeld) {
      const held = await prisma.organization.findFirst({
        where: { platformHeldSource: 'SULEKHA' },
        select: { id: true, _count: { select: { events: true, venues: true } } },
      })

      if (held && held._count.events === 0 && held._count.venues === 0) {
        await prisma.organization.delete({ where: { id: held.id } }).catch(() => {})
      }
    }

    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [names.adminEmail, names.moderatorEmail, names.ownerEmail, names.buyerEmail],
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
