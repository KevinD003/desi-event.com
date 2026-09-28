/**
 * Probes for the event-picture invariants the database enforces on its own.
 *
 * The API refuses a ninth gallery picture, a picture with no description and a
 * take-down with no reason before it writes anything, but the API is one
 * writer among several — a seed, a migration, an operator at a `psql` prompt.
 * These probes are the evidence that the rules hold without it:
 *
 *   - **The gallery cap.** `desi_media_gallery_cap` refuses a ninth gallery
 *     picture on one event, and accepts the eighth.
 *   - **The shape CHECKs.** An event picture has a description of 1–300
 *     characters, is a JPEG, PNG or WebP within 8000 pixels a side and 10 MiB,
 *     and has a SHA-256 checksum. A cover has no position; a gallery picture
 *     has one from 0 to 7.
 *   - **The review CHECKs.** A picture taken down carries its reason; a
 *     decided picture carries when it was decided; an approved picture was
 *     sanitised and passed the structural check.
 *   - **The bytes.** A blob's recorded size is its real size, its checksum is
 *     SHA-256-shaped, and it goes when its picture — or its event — goes.
 *
 * The one-cover-per-event index is probed beside the other partial unique
 * indexes in `verify-fresh-database.mjs`.
 *
 * Every probe runs inside a transaction that is always rolled back, against a
 * disposable database `verify-fresh-database.mjs` created and will destroy. A
 * refusal counts only when it names the constraint or trigger being probed, so
 * a probe cannot pass on some other rule's error.
 *
 * @module @desi-event/db/scripts/media-probes
 */

/** A SHA-256-shaped checksum. */
const CHECKSUM = 'c'.repeat(64)

/**
 * A distinct storage key for one probe row.
 *
 * @param {string} label What the row is for.
 * @returns {string} A key no other row has.
 */
function keyFor(label) {
  return `probe-media-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * A valid event picture row, which a probe then breaks in one way.
 *
 * @param {string} eventId The event.
 * @param {object} [overrides] Field overrides.
 * @returns {object} `MediaAsset` create data.
 */
function picture(eventId, overrides = {}) {
  return {
    ownerType: 'EVENT',
    ownerId: eventId,
    eventId,
    kind: 'EVENT_GALLERY',
    position: 0,
    storageKey: keyFor(overrides.kind ?? 'gallery'),
    contentType: 'image/png',
    byteSize: 4,
    width: 1200,
    height: 630,
    checksum: CHECKSUM,
    altText: 'A probe picture',
    sanitisedAt: new Date(),
    scanStatus: 'CLEAN',
    scanNote: 'structural-v1: probe row',
    ...overrides,
  }
}

/**
 * Run the event-picture probes.
 *
 * @param {object} prisma A client connected to the seeded disposable database.
 * @param {object} helpers The verifier's own helpers.
 * @param {Function} helpers.probe `probe(prisma, name, expected, write)`: runs `write` in a rolled-back transaction.
 * @param {Function} helpers.record `record(name, ok, detail)`: records one step.
 * @returns {Promise<boolean>} Whether every probe passed.
 */
export async function runMediaProbes(prisma, { probe, record }) {
  const [event, organization] = await Promise.all([
    prisma.event.findFirst({ orderBy: { slug: 'asc' } }),
    prisma.organization.findFirst(),
  ])

  if (!event || !organization) {
    return record('event-picture probes have the fixtures they need', false, {
      note: 'the seed did not provide an event and an organisation',
    })
  }

  const results = []

  /**
   * One probe on the seeded event.
   *
   * @param {string} name What is being shown.
   * @param {RegExp|null} expected The refusal expected, or null when the write must be accepted.
   * @param {function(object): Promise<void>} write The write, given the transaction.
   * @returns {Promise<void>} Resolves once recorded.
   */
  const check = async (name, expected, write) => {
    results.push(await probe(prisma, name, expected, write))
  }

  // ---- The gallery cap ---------------------------------------------------

  await check('an event can hold eight gallery pictures', null, async (tx) => {
    // Whatever the seed left is removed first, inside the rolled-back
    // transaction, so the count starts from nothing.
    await tx.mediaAsset.deleteMany({ where: { eventId: event.id } })

    for (let position = 0; position < 8; position += 1) {
      await tx.mediaAsset.create({ data: picture(event.id, { position }) })
    }
  })

  await check(
    'an event cannot hold a ninth gallery picture',
    /already has 8 gallery pictures/,
    async (tx) => {
      await tx.mediaAsset.deleteMany({ where: { eventId: event.id } })

      for (let position = 0; position < 8; position += 1) {
        await tx.mediaAsset.create({ data: picture(event.id, { position }) })
      }

      // No unique index on position: a reorder collides transiently. The
      // trigger counts rows, so a duplicate position is still the ninth.
      await tx.mediaAsset.create({ data: picture(event.id, { position: 7 }) })
    },
  )

  // ---- The shape of an event picture -------------------------------------

  await check(
    'an event picture cannot go without a description',
    /media_asset_event_media_shape/,
    async (tx) => {
      await tx.mediaAsset.create({ data: picture(event.id, { altText: null }) })
    },
  )

  await check(
    'an event picture cannot be described by blank space',
    /media_asset_event_media_shape/,
    async (tx) => {
      await tx.mediaAsset.create({ data: picture(event.id, { altText: '   ' }) })
    },
  )

  await check(
    'an event picture cannot be an SVG drawing',
    /media_asset_event_media_shape/,
    async (tx) => {
      await tx.mediaAsset.create({ data: picture(event.id, { contentType: 'image/svg+xml' }) })
    },
  )

  await check(
    'an event picture cannot be wider than 8000 pixels',
    /media_asset_event_media_shape/,
    async (tx) => {
      await tx.mediaAsset.create({ data: picture(event.id, { width: 8001 }) })
    },
  )

  await check(
    'an event picture cannot belong to one event and name another as its owner',
    /media_asset_event_media_shape/,
    async (tx) => {
      await tx.mediaAsset.create({ data: picture(event.id, { ownerId: organization.id }) })
    },
  )

  await check('a cover has no gallery position', /media_asset_position_by_kind/, async (tx) => {
    await tx.mediaAsset.deleteMany({ where: { eventId: event.id, kind: 'EVENT_COVER' } })
    await tx.mediaAsset.create({
      data: picture(event.id, { kind: 'EVENT_COVER', position: 0 }),
    })
  })

  await check(
    'a gallery picture has a position from 0 to 7',
    /media_asset_position_by_kind/,
    async (tx) => {
      await tx.mediaAsset.create({ data: picture(event.id, { position: 8 }) })
    },
  )

  // ---- The review state ---------------------------------------------------

  await check(
    'a picture cannot be taken down without a reason',
    /media_asset_rejection_has_note/,
    async (tx) => {
      await tx.mediaAsset.create({
        data: picture(event.id, {
          moderationStatus: 'REJECTED',
          moderatedAt: new Date(),
          moderationNote: null,
        }),
      })
    },
  )

  await check(
    'a decided picture carries when it was decided',
    /media_asset_decision_is_stamped/,
    async (tx) => {
      await tx.mediaAsset.create({
        data: picture(event.id, { moderationStatus: 'APPROVED', moderatedAt: null }),
      })
    },
  )

  await check(
    'a picture that was never sanitised cannot be approved',
    /media_asset_approved_is_servable/,
    async (tx) => {
      await tx.mediaAsset.create({
        data: picture(event.id, {
          moderationStatus: 'APPROVED',
          moderatedAt: new Date(),
          sanitisedAt: null,
          scanStatus: 'PENDING',
        }),
      })
    },
  )

  // ---- The bytes ------------------------------------------------------------

  await check(
    'a blob cannot claim a size its bytes do not have',
    /media_blob_size_matches/,
    async (tx) => {
      const asset = await tx.mediaAsset.create({ data: picture(event.id) })

      await tx.mediaBlob.create({
        data: {
          storageKey: asset.storageKey,
          bytes: Buffer.from([1, 2, 3, 4]),
          byteSize: 5,
          checksum: CHECKSUM,
        },
      })
    },
  )

  await check('a blob checksum is SHA-256-shaped', /media_blob_checksum_shape/, async (tx) => {
    const asset = await tx.mediaAsset.create({ data: picture(event.id) })

    await tx.mediaBlob.create({
      data: {
        storageKey: asset.storageKey,
        bytes: Buffer.from([1, 2, 3, 4]),
        byteSize: 4,
        checksum: 'not-a-digest',
      },
    })
  })

  await check('removing a picture removes its bytes', null, async (tx) => {
    const asset = await tx.mediaAsset.create({ data: picture(event.id) })

    await tx.mediaBlob.create({
      data: {
        storageKey: asset.storageKey,
        bytes: Buffer.from([1, 2, 3, 4]),
        byteSize: 4,
        checksum: CHECKSUM,
      },
    })
    await tx.mediaAsset.delete({ where: { id: asset.id } })

    const left = await tx.mediaBlob.count({ where: { storageKey: asset.storageKey } })

    if (left !== 0) throw new Error(`${left} blob row(s) outlived their picture`)
  })

  await check('removing an event removes its pictures and their bytes', null, async (tx) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const doomed = await tx.event.create({
      data: {
        organizationId: organization.id,
        title: 'Probe event for picture cascade',
        slug: `probe-media-cascade-${stamp}`,
        summary: 'A probe.',
        description: 'A probe.',
        category: 'MUSIC_CONCERT',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
      },
    })
    const cover = await tx.mediaAsset.create({
      data: picture(doomed.id, { kind: 'EVENT_COVER', position: null }),
    })

    await tx.mediaBlob.create({
      data: {
        storageKey: cover.storageKey,
        bytes: Buffer.from([1, 2, 3, 4]),
        byteSize: 4,
        checksum: CHECKSUM,
      },
    })
    await tx.event.delete({ where: { id: doomed.id } })

    const [assets, blobs] = await Promise.all([
      tx.mediaAsset.count({ where: { eventId: doomed.id } }),
      tx.mediaBlob.count({ where: { storageKey: cover.storageKey } }),
    ])

    if (assets !== 0 || blobs !== 0) {
      throw new Error(`${assets} picture(s) and ${blobs} blob(s) outlived their event`)
    }
  })

  return results.every(Boolean)
}
