/**
 * The accounts, the organisation and the listing file the import journeys
 * need (SPEC2-XI area I, §9 row 12).
 *
 * `detail-event-import.spec.js` uploads a Sulekha listing file in the browser,
 * applies it, approves and publishes what it wrote, imports it again, moves one
 * event to an organiser's own organisation and copies a late picture. Every
 * one of those writes something nothing can take back from the page, so
 * everything here is new and carries the tag:
 *
 *   - **The platform administrator** (`import-admin-<tag>@platform.test`,
 *     ADMIN, a confirmed second factor as the role requires), who imports,
 *     approves, publishes and moves. Imports are held by `event:import`, and
 *     approving also needs `moderation:review`; an ADMIN holds both.
 *   - **The moderator** (`import-moderator-<tag>@platform.test`, MODERATOR, a
 *     factor), who reviews events but imports nothing.
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
 * digit, so no two runs collide, and every address on Sulekha's hosts
 * (`events.sulekha.com` for the listing and its tickets, `usimg.sulekha.io`
 * for pictures), because the API checks every host again when a file is
 * uploaded. The spec uploads it with `setInputFiles({ name, mimeType, buffer })`.
 *
 * ## The pictures
 *
 * The API in these runs reads pictures from a directory, not the network
 * (`IMPORT_IMAGE_SOURCE=fixtures`): the detail config points it at
 * {@link IMPORT_PICTURE_DIR} and the sweep config at
 * {@link SWEEP_IMPORT_PICTURE_DIR}, both under the system's temporary
 * directory. {@link preparePictures} empties that directory and copies the
 * committed pictures (`e2e/fixtures/import-images/`) into it, all but
 * {@link LATE_PICTURE}, which the run therefore cannot copy and reports as
 * not found; journey I5 adds it with {@link addLatePicture} before "Retry
 * pictures". Nothing under `e2e/fixtures` is written during a run.
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
 * import records, their pictures' rows, change notices and visits go with
 * each event by cascade. Then the runs the administrator planned, the venues
 * whose names carry the tag, Import Gamma with its memberships, and — only
 * when the spec says it made it and it is empty — the platform-held
 * organisation "Sulekha Events". An event an order pins is kept, as the other
 * seeds keep one; nothing here sells, so none is.
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
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** The committed pictures, read and never written during a run. */
export const IMPORT_FIXTURES = fileURLToPath(new URL('../fixtures/import-images/', import.meta.url))

/**
 * The directory the detail config's API reads pictures from. The config sets
 * `IMPORT_IMAGE_FIXTURE_DIR` to the same expression.
 */
export const IMPORT_PICTURE_DIR = path.join(os.tmpdir(), 'desi-event-e2e-import-images')

/** The directory the sweep config's API reads pictures from, likewise. */
export const SWEEP_IMPORT_PICTURE_DIR = path.join(os.tmpdir(), 'desi-event-e2e-sweep-import-images')

/** The one picture left out of a run until journey I5 adds it. */
export const LATE_PICTURE = 'classical-concert-tanpura.png'

/** Sulekha's listing host and picture host, as the API's run-time checks require. */
export const SULEKHA_EVENTS = 'https://events.sulekha.com'
export const SULEKHA_PICTURES = 'https://usimg.sulekha.io'

/** The note the curator leaves on a listing whose category The Desi Events lacks. */
export const CATEGORY_NOTE =
  'Sulekha lists this as CLASSICAL; The Desi Events has no such category, so it is listed under MUSIC_CONCERT. If another fits better, change it in an editing session once the event is published.'

/** The prices the first listing gives: a child's ticket is free. */
export const GARBA_PRICES = Object.freeze([
  { name: 'General admission', priceCents: 2_500, currency: 'USD', note: null },
  { name: 'VIP', priceCents: 4_000, currency: 'USD', note: 'Front rows and a dinner plate' },
  { name: 'Child (under 12)', priceCents: 0, currency: 'USD', note: null },
])

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
    gammaName: `Import Gamma ${tag}`,
    gammaSlug: `import-gamma-${tag}`,
    waitingTitle: `Import Gamma Waiting ${tag}`,
    waitingSlug: `import-gamma-waiting-${tag}`,
    fileName: `sulekha-texas-${tag}.json`,
    updateFileName: `sulekha-texas-${tag}-update.json`,
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
 * A listing's Sulekha page, which is also where its tickets are sold.
 *
 * @param {string} slug The page's words.
 * @param {string} sourceId The listing.
 * @returns {string} The address.
 */
function listingPage(slug, sourceId) {
  return `${SULEKHA_EVENTS}/${slug}_event-in-houston_${sourceId}`
}

/**
 * A picture's address on Sulekha's picture host. The API reads the file of
 * the same name from the fixture directory.
 *
 * @param {string} run The run's number.
 * @param {string} file The fixture's name.
 * @returns {string} The address.
 */
function pictureAddress(run, file) {
  return `${SULEKHA_PICTURES}/events/images/${run}/${file}`
}

/**
 * The listing file, built at run time.
 *
 * Three listings: a garba night with three prices (one of them free), a cover
 * and a gallery picture, and no end time; a Bollywood evening with one price,
 * a cover and an end time; and a classical concert Sulekha prices nowhere,
 * whose category is the curator's mapping, with a cover and the late gallery
 * picture. `sweep` adds the plan-only listing the sweep previews and never
 * applies, as a file of its own ({@link planOnlyDataset}).
 *
 * @param {string} tag The run suffix.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The run's moment; the dates and `scrapedAt` follow it.
 * @returns {object} A `desi-event-import/1` file.
 */
export function buildImportDataset(tag, { now = new Date() } = {}) {
  const names = importNames(tag)
  const run = importRunNumber(tag)
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
    sourceName: 'Sulekha',
    sourceSite: `${SULEKHA_EVENTS}/`,
    collectedFrom: new Date(now.getTime() - 2 * HOUR_MS).toISOString(),
    collectedTo: scrapedAt,
    curatedOn: now.toISOString().slice(0, 10),
    imageHosts: ['usimg.sulekha.io'],
    events: [
      {
        sourceId: garba.sourceId,
        sourceUrl: listingPage('import-garba-night', garba.sourceId),
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
        images: [
          {
            url: pictureAddress(run, 'garba-night-cover.png'),
            role: 'cover',
            alt: 'Dancers in a circle under strings of festival lights',
          },
          {
            url: pictureAddress(run, 'garba-night-circle.png'),
            role: 'gallery',
            alt: 'A dandiya circle seen from the balcony',
          },
        ],
        ticketUrl: listingPage('import-garba-night', garba.sourceId),
        importNotes: [
          'The header says 7:00 PM and the description says 7:30 PM; 7:00 PM is imported.',
        ],
      },
      {
        sourceId: bollywood.sourceId,
        sourceUrl: listingPage('import-bollywood-evening', bollywood.sourceId),
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
        images: [
          {
            url: pictureAddress(run, 'bollywood-evening-cover.png'),
            role: 'cover',
            alt: 'A band on a stage lit in pink and gold',
          },
        ],
        ticketUrl: listingPage('import-bollywood-evening', bollywood.sourceId),
        importNotes: [],
      },
      {
        sourceId: concert.sourceId,
        sourceUrl: listingPage('import-classical-concert', concert.sourceId),
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
        images: [
          {
            url: pictureAddress(run, 'classical-concert-cover.png'),
            role: 'cover',
            alt: 'A sitar resting on a rug before the recital',
          },
          {
            url: pictureAddress(run, LATE_PICTURE),
            role: 'gallery',
            alt: 'A tanpura standing beside the stage',
          },
        ],
        ticketUrl: listingPage('import-classical-concert', concert.sourceId),
        importNotes: [CATEGORY_NOTE],
      },
    ],
  }
}

/**
 * The same file with one listing's start moved, as Sulekha would show it
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
        sourceUrl: listingPage('import-dandiya-matinee', planOnly.sourceId),
        ticketUrl: listingPage('import-dandiya-matinee', planOnly.sourceId),
        title: planOnly.title,
        presentedBy: planOnly.presentedBy,
        startsAt: evening(13, now).toISOString(),
        images: [],
        importNotes: [
          'Sulekha lists this event twice; only this listing is imported.',
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
 * Empty a picture directory and copy the committed pictures into it, all but
 * the late one.
 *
 * @param {string} directory {@link IMPORT_PICTURE_DIR} or {@link SWEEP_IMPORT_PICTURE_DIR}.
 * @returns {Promise<string[]>} The files copied.
 */
export async function preparePictures(directory) {
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })

  const files = (await readdir(IMPORT_FIXTURES)).filter(
    (file) => file.endsWith('.png') && file !== LATE_PICTURE,
  )

  for (const file of files) {
    await copyFile(path.join(IMPORT_FIXTURES, file), path.join(directory, file))
  }

  return files
}

/**
 * Copy the late picture in, as if Sulekha had put it up since.
 *
 * @param {string} directory The run's picture directory.
 * @returns {Promise<void>} Resolves once copied.
 */
export async function addLatePicture(directory) {
  await copyFile(path.join(IMPORT_FIXTURES, LATE_PICTURE), path.join(directory, LATE_PICTURE))
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
    await prisma.membership.deleteMany({ where: { userId: { in: [admin.id, moderator.id] } } })

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
      gammaOrganizationId: gamma.id,
      waitingEventId: waiting.id,
      waitingRevision: waiting.revision ?? 0,
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Whether the platform-held organisation for Sulekha is already there.
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
        images: {
          orderBy: { position: 'asc' },
          select: {
            url: true,
            role: true,
            status: true,
            failureCode: true,
            mediaAsset: { select: { id: true, moderationStatus: true, kind: true } },
          },
        },
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
            _count: { select: { ticketTypes: true } },
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
 * @param {boolean} [options.removePlatformHeld] Also remove "Sulekha Events" when it is left empty; only when the journeys made it.
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
      // Nothing here sells, so no order should pin one; asked anyway, as every
      // seed asks, so a cleanup never fights the ledger.
      if ((await prisma.order.count({ where: { eventId } })) > 0) {
        keptEvents += 1
        continue
      }

      // Import records, their pictures' rows, change notices, sittings and
      // visits go with the event by cascade; said here for what pins it.
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

    // The venues the listings made (under "Sulekha Events", or moved with an
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
      where: { email: { in: [names.adminEmail, names.moderatorEmail, names.ownerEmail] } },
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
