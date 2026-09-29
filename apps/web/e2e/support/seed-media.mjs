/**
 * The event the pictures journey uploads to: a draft of gamma's, ready to send
 * for review.
 *
 * Its own event rather than the feature world's draft, which has no session
 * and is not complete, and rather than anything alpha or beta hold, whose
 * counts later specs pin. It has everything review asks for — a venue, the
 * three policies, one general-admission night and a tier on sale — so the
 * journey can take it from draft to public, which is the only way to see what
 * a picture does on a public page.
 *
 * ## Cleanup
 *
 * The event goes, and with it its pictures: a `MediaAsset` row cascades to its
 * `MediaBlob`, which holds the bytes, so nothing is left in the store. The
 * moderation history, sessions and tiers go first, as the foreign keys need.
 * Nothing is sold, so no order or ledger row pins it.
 *
 * No account is created here, so none is left behind.
 * The audit rows deliberately stay: `desi_audit_log_immutable` refuses every
 * UPDATE and DELETE on `AuditLog`, and the ones this journey writes point at
 * the event by id only, so nothing about them stops its removal.
 *
 * @module e2e/support/seed-media
 */

import { createHash, randomUUID } from 'node:crypto'

import { createPrismaClient } from '@desi-event/db'

import { solidPng } from './images.mjs'
import { FEATURE_CURRENCY, FEATURE_TIME_ZONE, checkedTag } from './seed-feature-world.mjs'
import { CONNECTION } from './seed-refusals.mjs'

/** One day, in milliseconds. */
const DAY_MS = 86_400_000

/**
 * The pictures event's title and slug.
 *
 * @param {string} tag The run suffix.
 * @returns {{title: string, slug: string}} Its names.
 */
export function mediaEventNames(tag) {
  checkedTag(tag)

  return { title: `Gamma Picture Night ${tag}`, slug: `gamma-pictures-${tag}` }
}

/**
 * Seed the pictures event under gamma.
 *
 * @param {object} options Options.
 * @param {string} options.tag The run suffix.
 * @param {string} options.organizationId Gamma's organisation.
 * @param {string} options.venueId Gamma's venue.
 * @returns {Promise<{eventId: string, title: string, slug: string}>} The event.
 */
export async function seedMedia({ tag, organizationId, venueId }) {
  const { title, slug } = mediaEventNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const day = new Date(Date.now() + 70 * DAY_MS)
    const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
    const startsAt = new Date(midnight + 23.5 * 3_600_000)
    const endsAt = new Date(midnight + 28 * 3_600_000)

    const event = await prisma.event.create({
      data: {
        organizationId,
        venueId,
        title,
        slug,
        summary: 'An evening of garba, with pictures of the last one.',
        description:
          'A general-admission floor for one night. The pictures on this page were taken at the last one.',
        category: 'GARBA_DANDIYA',
        status: 'DRAFT',
        startsAt,
        endsAt,
        timezone: FEATURE_TIME_ZONE,
        policies: {
          entry: 'Doors open half an hour before. Bring the pass on your phone.',
          refund: 'Refunds up to seven days before the night.',
          conduct: 'Be kind to each other and to the floor.',
        },
      },
    })

    const session = await prisma.eventSession.create({
      data: {
        eventId: event.id,
        startsAt,
        endsAt,
        timezone: FEATURE_TIME_ZONE,
        status: 'SCHEDULED',
        capacity: 150,
        sortOrder: 0,
      },
    })

    await prisma.ticketType.create({
      data: {
        eventId: event.id,
        eventSessionId: session.id,
        name: 'General admission',
        priceCents: 2_000,
        currency: FEATURE_CURRENCY,
        quantityTotal: 150,
        status: 'ON_SALE',
      },
    })

    return { eventId: event.id, title, slug }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Remove the pictures event and everything hanging from it.
 *
 * Safe to run twice, and after a journey that stopped part-way.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupMedia(tag) {
  const { slug } = mediaEventNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const event = await prisma.event.findUnique({ where: { slug } })

    if (!event) return

    // The bytes go with their asset, by cascade.
    await prisma.mediaAsset.deleteMany({ where: { eventId: event.id } }).catch(() => {})
    await prisma.notificationOutbox
      .deleteMany({ where: { dedupeKey: { contains: event.id } } })
      .catch(() => {})
    await prisma.eventModerationAction.deleteMany({ where: { eventId: event.id } }).catch(() => {})
    await prisma.ticketType.deleteMany({ where: { eventId: event.id } }).catch(() => {})
    await prisma.eventSession.deleteMany({ where: { eventId: event.id } }).catch(() => {})
    await prisma.event.delete({ where: { id: event.id } }).catch(() => {})
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Pictures written straight into the store, for a page that has to be
 * measured with pictures on it.
 *
 * The accessibility sweep scans the editor's Media step, the moderator's review
 * and the public event page with a cover and a gallery, and none of those can
 * be reached through the upload form on the event it needs: a live event takes
 * no new picture, and the sweep has no window for gamma's team. So the rows are
 * written here as the upload pipeline writes them — a PNG built from its own
 * description, its SHA-256, the asset and then its bytes, sanitised and marked
 * clean — at the moderation state the page is meant to show. What the pipeline
 * itself does to a picture is `detail-event-media.spec.js`'s to prove.
 *
 * Remove them with {@link removePictures}; an event's cleanup takes them too,
 * because an asset cascades from its event and its bytes from the asset.
 *
 * @param {object} options Options.
 * @param {string} options.eventId The event the pictures belong to.
 * @param {'PENDING'|'APPROVED'} options.status The moderation state of every picture.
 * @param {string} options.coverAlt The cover's description.
 * @param {string[]} options.galleryAlts One description per gallery picture, in order.
 * @returns {Promise<{coverId: string, galleryIds: string[]}>} The pictures' ids.
 */
export async function seedPictures({ eventId, status, coverAlt, galleryAlts }) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  /**
   * One picture: the asset row, then the bytes it names.
   *
   * @param {object} picture What to write.
   * @param {'EVENT_COVER'|'EVENT_GALLERY'} picture.kind Cover or gallery.
   * @param {string} picture.altText Its description.
   * @param {number|null} picture.position Its gallery position, or null for a cover.
   * @param {number} picture.width Pixels across.
   * @param {number} picture.height Pixels down.
   * @param {Array<number>} picture.rgb Its one colour.
   * @returns {Promise<string>} Its id.
   */
  const write = async ({ kind, altText, position, width, height, rgb }) => {
    const bytes = solidPng(width, height, { rgb })
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const storageKey = `pg/${randomUUID()}`
    const now = new Date()

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
        position,
        sanitisedAt: now,
        scanStatus: 'CLEAN',
        moderationStatus: status,
        moderatedAt: status === 'PENDING' ? null : now,
      },
      select: { id: true },
    })

    await prisma.mediaBlob.create({
      data: { storageKey, bytes, byteSize: bytes.length, checksum },
    })

    return asset.id
  }

  try {
    const coverId = await write({
      kind: 'EVENT_COVER',
      altText: coverAlt,
      position: null,
      width: 1200,
      height: 630,
      rgb: [214, 88, 43],
    })
    const galleryIds = []

    for (const [index, altText] of galleryAlts.entries()) {
      galleryIds.push(
        await write({
          kind: 'EVENT_GALLERY',
          altText,
          position: index,
          width: 400,
          height: 400,
          rgb: [36 + index * 40, 99, 140],
        }),
      )
    }

    return { coverId, galleryIds }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Remove every picture of an event, bytes and all.
 *
 * @param {string} eventId The event.
 * @returns {Promise<void>} Resolves when done.
 */
export async function removePictures(eventId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    // The bytes go with their asset, by cascade.
    await prisma.mediaAsset.deleteMany({ where: { eventId } })
  } finally {
    await prisma.$disconnect()
  }
}
