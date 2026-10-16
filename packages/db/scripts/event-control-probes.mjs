/**
 * Probes for the invariants full control of posted events rests on (SPEC2-XI
 * §6, area X), and for the import tables and the platform-held organisation
 * (area I), held by the database on its own.
 *
 * The API refuses each of these before it writes, but the API is one writer
 * among several — a seed, a migration, an importer, an operator at a `psql`
 * prompt. These probes are the evidence that the rules hold without it:
 *
 *   - **Deletion.** `desi_event_deletion_moves` records the status an event
 *     really had on entering DELETED, keeps it fixed while DELETED, and lets the
 *     event leave DELETED only for `desi_event_restore_target` of it: an event
 *     deleted on sale comes back paused, one deleted under review comes back a
 *     draft. The review gate lets exactly that restore through, and nothing
 *     else. `event_deletion_consistency` ties the deletion columns to the status.
 *   - **Cancelled nights.** A cancelled night is stamped, and never comes back.
 *   - **Replacement covers.** One current cover per event, a waiting replacement
 *     beside it, never approved while it points, only ever at its own event's
 *     current cover, and freed when the cover it replaces goes.
 *   - **Platform edit sittings.** One open sitting per administrator per event,
 *     the shape CHECK, the EXPIRED ending, and a sitting outliving its browser
 *     session only as a row nothing can match.
 *   - **Change notices.** The shape CHECK.
 *   - **Imports.** No member or team invitation in a platform-held
 *     organisation, one such organisation per source, one record per listing,
 *     https picture addresses, a digest-shaped plan and an array of prices.
 *   - **Door scopes on a moved event.** An event does not move to another
 *     organisation while a door scope of its old one names it, and no seeded
 *     scope crosses organisations. Seeded venues store codes for their state
 *     and country.
 *
 * Every probe runs inside a transaction that is always rolled back, against a
 * disposable database `verify-fresh-database.mjs` created and will destroy. A
 * refusal counts only when it names the constraint, index or trigger being
 * probed, so a probe cannot pass on some other rule's error.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/db/scripts/event-control-probes
 */

import { createHash, randomUUID } from 'node:crypto'

import { restoreTarget } from '@desi-event/schemas/lifecycle'

/** A day, in milliseconds. */
const DAY_MS = 86_400_000

/** What `desi_event_restore_target` must answer, written out (SPEC2-XI §4.6). */
const RESTORE_TARGETS = Object.freeze({
  REVIEW_PENDING: 'DRAFT',
  APPROVED: 'DRAFT',
  ON_SALE: 'SALES_PAUSED',
  SOLD_OUT: 'SALES_PAUSED',
})

/** A reason inside every 10-500 character bound. */
const REASON = 'Checked by the fresh-database probes.'

/**
 * A value no other probe row has.
 *
 * @param {string} label What the value is for.
 * @returns {string} A distinct, slug-safe string.
 */
function unique(label) {
  return `probe-${label}-${randomUUID().slice(0, 8)}`
}

/**
 * A SHA-256-shaped digest, distinct per call.
 *
 * @returns {string} 64 lower-case hex characters.
 */
function digest() {
  return createHash('sha256').update(randomUUID()).digest('hex')
}

/**
 * A minimal event, inserted with whatever status the probe starts from. An
 * INSERT is outside the deletion and review triggers (they fire on UPDATE), so
 * a probe can start an event anywhere in the lifecycle.
 *
 * @param {object} tx A transaction client.
 * @param {string} organizationId The organisation.
 * @param {object} [overrides] Field overrides.
 * @returns {Promise<object>} The event row.
 */
function probeEvent(tx, organizationId, overrides = {}) {
  return tx.event.create({
    data: {
      organizationId,
      title: 'Probe event',
      slug: unique('event'),
      summary: 'A probe event.',
      description: 'A probe event, rolled back with its transaction.',
      category: 'COMEDY',
      startsAt: new Date(Date.now() + 10 * DAY_MS),
      endsAt: new Date(Date.now() + 10 * DAY_MS + 3_600_000),
      ...overrides,
    },
  })
}

/**
 * The columns that delete an event, as `lib/event-deletion.js` writes them.
 *
 * @param {string} from The status the event had.
 * @param {string} userId Who deleted it.
 * @param {object} [overrides] Column overrides.
 * @returns {object} Update data.
 */
function deletion(from, userId, overrides = {}) {
  return {
    status: 'DELETED',
    deletedAt: new Date(),
    deletedById: userId,
    deletionReason: REASON,
    deletionOutcome: from === 'CANCELLED' ? 'CANCELLED_AND_REFUNDED' : 'REMOVED',
    deletionAuthority: 'PLATFORM',
    statusBeforeDeletion: from,
    ...overrides,
  }
}

/** The columns a restore clears, beside the status it writes. */
const RESTORED = Object.freeze({
  deletedAt: null,
  deletedById: null,
  deletionReason: null,
  deletionOutcome: null,
  deletionAuthority: null,
  statusBeforeDeletion: null,
  deletedSlug: null,
})

/** A SHA-256-shaped checksum for a probe picture. */
const CHECKSUM = 'd'.repeat(64)

/**
 * A valid event cover, waiting for review, which a probe then changes.
 *
 * @param {string} eventId The event.
 * @param {object} [overrides] Field overrides.
 * @returns {object} `MediaAsset` create data.
 */
function cover(eventId, overrides = {}) {
  return {
    ownerType: 'EVENT',
    ownerId: eventId,
    eventId,
    kind: 'EVENT_COVER',
    storageKey: unique('cover'),
    contentType: 'image/png',
    byteSize: 1024,
    width: 1200,
    height: 630,
    checksum: CHECKSUM,
    altText: 'A probe cover picture',
    sanitisedAt: new Date(),
    scanStatus: 'CLEAN',
    scanNote: 'structural-v1: probe row',
    ...overrides,
  }
}

/**
 * Run the probes.
 *
 * @param {object} prisma A client connected to the seeded disposable database.
 * @param {object} helpers The verifier's own helpers.
 * @param {Function} helpers.probe `probe(prisma, name, expected, write)`: runs `write` in a rolled-back transaction.
 * @param {Function} helpers.record `record(name, ok, detail)`: records one step.
 * @returns {Promise<boolean>} Whether every probe passed.
 */
export async function runEventControlProbes(prisma, { probe, record }) {
  const [organization, user] = await Promise.all([
    prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } }),
    prisma.user.findFirst({ orderBy: { createdAt: 'asc' } }),
  ])

  if (!organization || !user) {
    return record('the full-control and import probes have the seeded rows they need', false, {
      note: 'the seed did not produce an organisation and a user',
    })
  }

  const results = []

  /**
   * One probe.
   *
   * @param {string} name What is being shown.
   * @param {RegExp|null} expected The refusal expected, or null when the write must be accepted.
   * @param {function(object): Promise<unknown>} write The write, given the transaction.
   * @returns {Promise<void>} Resolves once recorded.
   */
  const check = async (name, expected, write) => {
    results.push(await probe(prisma, name, expected, write))
  }

  // -------------------------------------------------------------------------
  // Where a restore lands: one SQL function, equal to the browser-safe one.
  // -------------------------------------------------------------------------

  const targets = await prisma.$queryRawUnsafe(
    'SELECT status::text AS status, desi_event_restore_target(status)::text AS target ' +
      'FROM unnest(enum_range(NULL::"EventStatus")) AS status',
  )
  const wrongTargets = targets.filter(
    ({ status, target }) =>
      target !== (RESTORE_TARGETS[status] ?? status) || target !== restoreTarget(status),
  )
  results.push(
    record(
      'desi_event_restore_target answers the restore table for every status, as restoreTarget does',
      targets.length > 0 && wrongTargets.length === 0,
      {
        note:
          wrongTargets.length === 0
            ? `${targets.length} statuses; never APPROVED or ON_SALE`
            : wrongTargets.map(({ status, target }) => `${status} -> ${target}`).join(', '),
      },
    ),
  )

  const [{ volatility }] = await prisma.$queryRawUnsafe(
    "SELECT provolatile::text AS volatility FROM pg_proc WHERE proname = 'desi_event_restore_target'",
  )
  results.push(
    record('desi_event_restore_target is IMMUTABLE', volatility === 'i', {
      note: `provolatile = ${volatility}`,
    }),
  )

  // -------------------------------------------------------------------------
  // Deletion and restore.
  // -------------------------------------------------------------------------

  const restoreRefused = /event_restore_returns_prior_status/
  const priorRefused = /event_deletion_records_prior_status/
  const consistency = /event_deletion_consistency/

  await check('an event on sale can be deleted, recording ON_SALE', null, async (tx) => {
    const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

    await tx.event.update({ where: { id: event.id }, data: deletion('ON_SALE', user.id) })
  })
  await check(
    'deleting an event must record the status it really had',
    priorRefused,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

      await tx.event.update({ where: { id: event.id }, data: deletion('DRAFT', user.id) })
    },
  )
  await check("a deleted event's prior status cannot be rewritten", priorRefused, async (tx) => {
    const event = await probeEvent(tx, organization.id, { status: 'DRAFT' })

    await tx.event.update({ where: { id: event.id }, data: deletion('DRAFT', user.id) })
    await tx.event.update({
      where: { id: event.id },
      data: { statusBeforeDeletion: 'PUBLISHED' },
    })
  })
  await check(
    'leaving DELETED from statusBeforeDeletion ON_SALE to ON_SALE is refused',
    restoreRefused,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

      await tx.event.update({ where: { id: event.id }, data: deletion('ON_SALE', user.id) })
      await tx.event.update({ where: { id: event.id }, data: { status: 'ON_SALE', ...RESTORED } })
    },
  )
  await check(
    'leaving DELETED from statusBeforeDeletion ON_SALE to SALES_PAUSED is accepted',
    null,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

      await tx.event.update({ where: { id: event.id }, data: deletion('ON_SALE', user.id) })
      await tx.event.update({
        where: { id: event.id },
        data: { status: 'SALES_PAUSED', ...RESTORED },
      })
    },
  )
  await check(
    'an event deleted under review cannot come back approved',
    restoreRefused,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'REVIEW_PENDING' })

      await tx.event.update({
        where: { id: event.id },
        data: deletion('REVIEW_PENDING', user.id),
      })
      await tx.event.update({ where: { id: event.id }, data: { status: 'APPROVED', ...RESTORED } })
    },
  )
  await check('an event deleted when approved comes back a draft', null, async (tx) => {
    const event = await probeEvent(tx, organization.id, { status: 'APPROVED' })

    await tx.event.update({ where: { id: event.id }, data: deletion('APPROVED', user.id) })
    await tx.event.update({ where: { id: event.id }, data: { status: 'DRAFT', ...RESTORED } })
  })
  await check(
    'a restore to the public status an event had passes the review gate',
    null,
    async (tx) => {
      const published = await probeEvent(tx, organization.id, { status: 'PUBLISHED' })
      const cancelled = await probeEvent(tx, organization.id, {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      })

      await tx.event.update({ where: { id: published.id }, data: deletion('PUBLISHED', user.id) })
      await tx.event.update({
        where: { id: published.id },
        data: { status: 'PUBLISHED', ...RESTORED },
      })
      await tx.event.update({ where: { id: cancelled.id }, data: deletion('CANCELLED', user.id) })
      await tx.event.update({
        where: { id: cancelled.id },
        data: { status: 'CANCELLED', ...RESTORED },
      })
    },
  )
  await check('a deleted draft cannot come back public', restoreRefused, async (tx) => {
    const event = await probeEvent(tx, organization.id, { status: 'DRAFT' })

    await tx.event.update({ where: { id: event.id }, data: deletion('DRAFT', user.id) })
    await tx.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED', ...RESTORED } })
  })
  await check(
    'a draft still cannot become public without review',
    /event_public_requires_review/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'DRAFT' })

      await tx.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED' } })
    },
  )
  await check('a deleted event carries every deletion column', consistency, async (tx) => {
    const event = await probeEvent(tx, organization.id, { status: 'DRAFT' })

    await tx.event.update({
      where: { id: event.id },
      data: deletion('DRAFT', user.id, { deletionReason: null }),
    })
  })
  await check('a deletion reason is at least 10 characters', consistency, async (tx) => {
    const event = await probeEvent(tx, organization.id, { status: 'DRAFT' })

    await tx.event.update({
      where: { id: event.id },
      data: deletion('DRAFT', user.id, { deletionReason: '   short  ' }),
    })
  })
  await check(
    'only a cancelled event is deleted as cancelled and refunded',
    consistency,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

      await tx.event.update({
        where: { id: event.id },
        data: deletion('ON_SALE', user.id, { deletionOutcome: 'CANCELLED_AND_REFUNDED' }),
      })
    },
  )
  await check('an event that is not deleted carries no deletion columns', consistency, (tx) =>
    probeEvent(tx, organization.id, { status: 'DRAFT', deletedAt: new Date() }),
  )
  await check(
    'a restore that leaves a deletion column behind is refused',
    consistency,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'DRAFT' })

      await tx.event.update({ where: { id: event.id }, data: deletion('DRAFT', user.id) })
      await tx.event.update({
        where: { id: event.id },
        data: { status: 'DRAFT', ...RESTORED, deletionReason: REASON },
      })
    },
  )

  // -------------------------------------------------------------------------
  // Cancelled nights.
  // -------------------------------------------------------------------------

  /**
   * A night of a fresh probe event.
   *
   * @param {object} tx A transaction client.
   * @param {object} [overrides] Field overrides.
   * @returns {Promise<object>} The session row.
   */
  const night = async (tx, overrides = {}) => {
    const event = await probeEvent(tx, organization.id)

    return tx.eventSession.create({
      data: {
        eventId: event.id,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        capacity: 10,
        ...overrides,
      },
    })
  }

  await check(
    'a cancelled night carries when it was cancelled',
    /event_session_cancellation_stamped/,
    (tx) => night(tx, { status: 'CANCELLED' }),
  )
  await check(
    "a night's cancellation reason is 1 to 500 characters",
    /event_session_cancellation_stamped/,
    (tx) => night(tx, { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: '   ' }),
  )
  await check('a night can be cancelled with its stamp and reason', null, async (tx) => {
    const session = await night(tx)

    await tx.eventSession.update({
      where: { id: session.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: REASON },
    })
  })
  await check(
    'a cancelled night does not come back',
    /event_session_cancellation_final/,
    async (tx) => {
      const session = await night(tx, { status: 'CANCELLED', cancelledAt: new Date() })

      await tx.eventSession.update({
        where: { id: session.id },
        data: { status: 'SCHEDULED', cancelledAt: null },
      })
    },
  )

  // -------------------------------------------------------------------------
  // Replacement covers.
  // -------------------------------------------------------------------------

  await check('a replacement cover waits beside the current one', null, async (tx) => {
    const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })
    const current = await tx.mediaAsset.create({ data: cover(event.id) })

    await tx.mediaAsset.create({ data: cover(event.id, { replacesMediaId: current.id }) })
  })
  await check(
    'an event has one current cover',
    /MediaAsset_one_current_cover_per_event_key/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)

      await tx.mediaAsset.create({ data: cover(event.id) })
      await tx.mediaAsset.create({ data: cover(event.id) })
    },
  )
  await check('one waiting replacement per cover', /MediaAsset_replacesMediaId_key/, async (tx) => {
    const event = await probeEvent(tx, organization.id)
    const current = await tx.mediaAsset.create({ data: cover(event.id) })

    await tx.mediaAsset.create({ data: cover(event.id, { replacesMediaId: current.id }) })
    await tx.mediaAsset.create({ data: cover(event.id, { replacesMediaId: current.id }) })
  })
  await check(
    'a replacement cover is never approved while it points at the old one',
    /media_asset_replacement_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const current = await tx.mediaAsset.create({ data: cover(event.id) })

      await tx.mediaAsset.create({
        data: cover(event.id, {
          replacesMediaId: current.id,
          moderationStatus: 'APPROVED',
          moderatedAt: new Date(),
          moderatedById: user.id,
        }),
      })
    },
  )
  await check('a gallery picture replaces nothing', /media_asset_replacement_shape/, async (tx) => {
    const event = await probeEvent(tx, organization.id)
    const current = await tx.mediaAsset.create({ data: cover(event.id) })

    await tx.mediaAsset.create({
      data: cover(event.id, { kind: 'EVENT_GALLERY', position: 0, replacesMediaId: current.id }),
    })
  })
  await check(
    "a replacement only replaces its own event's cover",
    /media_asset_replacement_matches/,
    async (tx) => {
      const one = await probeEvent(tx, organization.id)
      const other = await probeEvent(tx, organization.id)
      const current = await tx.mediaAsset.create({ data: cover(one.id) })

      await tx.mediaAsset.create({ data: cover(other.id, { replacesMediaId: current.id }) })
    },
  )
  await check(
    'a replacement replaces a cover, not a gallery picture',
    /media_asset_replacement_matches/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const gallery = await tx.mediaAsset.create({
        data: cover(event.id, { kind: 'EVENT_GALLERY', position: 0 }),
      })

      await tx.mediaAsset.create({ data: cover(event.id, { replacesMediaId: gallery.id }) })
    },
  )
  await check(
    'a replacement cannot replace another waiting replacement',
    /media_asset_replacement_matches/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const current = await tx.mediaAsset.create({ data: cover(event.id) })
      const waiting = await tx.mediaAsset.create({
        data: cover(event.id, { replacesMediaId: current.id }),
      })

      await tx.mediaAsset.create({ data: cover(event.id, { replacesMediaId: waiting.id }) })
    },
  )
  await check(
    'removing the replaced cover makes the replacement the current cover, then approvable',
    null,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const current = await tx.mediaAsset.create({ data: cover(event.id) })
      const waiting = await tx.mediaAsset.create({
        data: cover(event.id, { replacesMediaId: current.id }),
      })

      await tx.mediaAsset.deleteMany({ where: { id: current.id } })

      const after = await tx.mediaAsset.findUnique({ where: { id: waiting.id } })
      if (after.replacesMediaId !== null) {
        throw new Error('the replacement still points at a cover that is gone')
      }

      await tx.mediaAsset.update({
        where: { id: waiting.id },
        data: { moderationStatus: 'APPROVED', moderatedAt: new Date(), moderatedById: user.id },
      })
    },
  )

  // -------------------------------------------------------------------------
  // Platform edit sittings.
  // -------------------------------------------------------------------------

  const ends = (
    await prisma.$queryRawUnsafe(
      'SELECT label.enumlabel AS label FROM pg_enum label JOIN pg_type type ON type.oid = label.enumtypid ' +
        `WHERE type.typname = 'PlatformEditEnd' ORDER BY label.enumsortorder`,
    )
  ).map((row) => row.label)
  results.push(
    record(
      'a sitting can end CLOSED, SUPERSEDED, EVENT_DELETED or EXPIRED',
      JSON.stringify(ends) === JSON.stringify(['CLOSED', 'SUPERSEDED', 'EVENT_DELETED', 'EXPIRED']),
      { note: ends.join(', ') },
    ),
  )

  /**
   * An open sitting's create data, from now for an hour.
   *
   * @param {string} eventId The event.
   * @param {object} [overrides] Field overrides.
   * @returns {object} `EventPlatformEdit` create data.
   */
  const sitting = (eventId, overrides = {}) => {
    const openedAt = new Date()

    return {
      eventId,
      actorId: user.id,
      reason: REASON,
      openedAt,
      expiresAt: new Date(openedAt.getTime() + 3_600_000),
      ...overrides,
    }
  }

  await check(
    'one open sitting per administrator per event',
    /EventPlatformEdit_one_open_per_actor_key/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

      await tx.eventPlatformEdit.create({ data: sitting(event.id) })
      await tx.eventPlatformEdit.create({ data: sitting(event.id) })
    },
  )
  await check('a closed sitting makes way for a new one', null, async (tx) => {
    const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })
    const first = await tx.eventPlatformEdit.create({ data: sitting(event.id) })

    await tx.eventPlatformEdit.update({
      where: { id: first.id },
      data: { closedAt: new Date(), endedBy: 'EXPIRED' },
    })
    await tx.eventPlatformEdit.create({ data: sitting(event.id) })
  })
  await check(
    "a sitting's reason is at least 10 characters",
    /event_platform_edit_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

      await tx.eventPlatformEdit.create({ data: sitting(event.id, { reason: '  too short ' }) })
    },
  )
  await check('a sitting lasts at most two hours', /event_platform_edit_shape/, async (tx) => {
    const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })
    const openedAt = new Date()

    await tx.eventPlatformEdit.create({
      data: sitting(event.id, {
        openedAt,
        expiresAt: new Date(openedAt.getTime() + 2 * 3_600_000 + 1000),
      }),
    })
  })
  await check(
    'a sitting is closed exactly when it has an ending',
    /event_platform_edit_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

      await tx.eventPlatformEdit.create({ data: sitting(event.id, { closedAt: new Date() }) })
    },
  )
  await check(
    'a sitting outlives its browser session only as a row nothing can match',
    null,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })
      const session = await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: digest(),
          expiresAt: new Date(Date.now() + DAY_MS),
        },
      })
      const row = await tx.eventPlatformEdit.create({
        data: sitting(event.id, { sessionId: session.id }),
      })

      await tx.session.delete({ where: { id: session.id } })

      const after = await tx.eventPlatformEdit.findUnique({ where: { id: row.id } })
      if (!after || after.sessionId !== null) {
        throw new Error('the sitting did not keep its row with its session cleared')
      }
    },
  )

  // -------------------------------------------------------------------------
  // Change notices.
  // -------------------------------------------------------------------------

  await check(
    "a change notice's before and after are objects",
    /event_change_notice_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

      await tx.eventChangeNotice.create({
        data: { eventId: event.id, kind: 'MATERIAL_CHANGE', before: ['startsAt'] },
      })
    },
  )
  await check(
    'a change notice names at most 20 fields',
    /event_change_notice_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'ON_SALE' })

      await tx.eventChangeNotice.create({
        data: {
          eventId: event.id,
          kind: 'MATERIAL_CHANGE',
          fields: Array.from({ length: 21 }, (_, index) => `field${index}`),
        },
      })
    },
  )

  // -------------------------------------------------------------------------
  // Imports and the platform-held organisation.
  // -------------------------------------------------------------------------

  const noMembers = /platform_held_organization_has_no_members/

  /**
   * The platform-held organisation for imported events, made inside the probe
   * with the name the API gives it.
   *
   * @param {object} tx A transaction client.
   * @returns {Promise<object>} The organisation.
   */
  const platformHeld = (tx) =>
    tx.organization.create({
      data: {
        name: 'The Desi Events',
        slug: unique('the-desi-events'),
        contactEmail: 'imports@desi-event.example',
        verified: true,
        verificationStatus: 'VERIFIED',
        payoutCurrency: 'USD',
        platformHeldSource: 'SULEKHA',
      },
    })

  await check(
    'a membership into a platform-held organisation is refused',
    noMembers,
    async (tx) => {
      const held = await platformHeld(tx)

      await tx.membership.create({
        data: { userId: user.id, organizationId: held.id, role: 'OWNER' },
      })
    },
  )
  await check(
    'a membership moved into a platform-held organisation is refused',
    noMembers,
    async (tx) => {
      const held = await platformHeld(tx)
      const membership = await tx.membership.findFirst({
        where: { organizationId: organization.id, role: { not: 'SCANNER' } },
      })

      if (!membership) throw new Error('the seed left the first organisation without members')

      await tx.membership.update({
        where: { id: membership.id },
        data: { organizationId: held.id },
      })
    },
  )
  await check(
    'a team invitation into a platform-held organisation is refused',
    noMembers,
    async (tx) => {
      const held = await platformHeld(tx)

      await tx.invitation.create({
        data: {
          organizationId: held.id,
          email: `${unique('invitee')}@example.test`,
          role: 'VIEWER',
          tokenHash: digest(),
          invitedById: user.id,
          deliveryMode: 'MANUAL',
          expiresAt: new Date(Date.now() + DAY_MS),
        },
      })
    },
  )
  // ADR 0019: door scanners, and nothing else, for imported events.

  /**
   * A team invitation, written directly.
   *
   * @param {object} tx A transaction client.
   * @param {string} organizationId Where.
   * @param {string} role Its role.
   * @returns {Promise<object>} The invitation.
   */
  const invitationTo = (tx, organizationId, role) =>
    tx.invitation.create({
      data: {
        organizationId,
        email: `${unique('invitee')}@example.test`,
        role,
        tokenHash: digest(),
        invitedById: user.id,
        deliveryMode: 'MANUAL',
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    })

  await check(
    'a door scanner may join the platform-held organisation (ADR 0019)',
    null,
    async (tx) => {
      const held = await platformHeld(tx)

      await tx.membership.create({
        data: { userId: user.id, organizationId: held.id, role: 'SCANNER' },
      })
    },
  )
  await check(
    'a SCANNER team invitation into the platform-held organisation is accepted (ADR 0019)',
    null,
    async (tx) => {
      const held = await platformHeld(tx)

      await invitationTo(tx, held.id, 'SCANNER')
    },
  )
  for (const role of ['ADMIN', 'MANAGER', 'STAFF']) {
    await check(
      `${role === 'ADMIN' ? 'an' : 'a'} ${role} membership in a platform-held organisation is refused`,
      noMembers,
      async (tx) => {
        const held = await platformHeld(tx)

        await tx.membership.create({ data: { userId: user.id, organizationId: held.id, role } })
      },
    )
    await check(
      `${role === 'ADMIN' ? 'an' : 'a'} ${role} team invitation into a platform-held organisation is refused`,
      noMembers,
      async (tx) => {
        const held = await platformHeld(tx)

        await invitationTo(tx, held.id, role)
      },
    )
  }
  await check(
    'a scanner of the platform-held organisation cannot be moved to another role',
    noMembers,
    async (tx) => {
      const held = await platformHeld(tx)
      const scanner = await tx.membership.create({
        data: { userId: user.id, organizationId: held.id, role: 'SCANNER' },
      })

      await tx.membership.update({ where: { id: scanner.id }, data: { role: 'STAFF' } })
    },
  )
  await check(
    'an invitation scope naming its own organisation’s event, for a scanner, is accepted',
    null,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const invitation = await invitationTo(tx, organization.id, 'SCANNER')

      await tx.invitationScope.create({ data: { invitationId: invitation.id, eventId: event.id } })
    },
  )
  await check(
    'an invitation scope naming another organisation’s event is refused',
    /invitation_scope_same_organization/,
    async (tx) => {
      const other = await tx.organization.create({
        data: {
          name: 'Probe other organisation',
          slug: unique('other-org'),
          contactEmail: `${unique('other')}@example.test`,
        },
      })
      const event = await probeEvent(tx, other.id)
      const invitation = await invitationTo(tx, organization.id, 'SCANNER')

      await tx.invitationScope.create({ data: { invitationId: invitation.id, eventId: event.id } })
    },
  )
  await check(
    'an invitation scope on a role that does not admit by event is refused',
    /invitation_scope_door_role/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const invitation = await invitationTo(tx, organization.id, 'VIEWER')

      await tx.invitationScope.create({ data: { invitationId: invitation.id, eventId: event.id } })
    },
  )
  // An event that moves takes no door scope of its old organisation with it
  // (20261016150000_event_move_leaves_no_door_scope).
  const moveRefused = /event_move_leaves_no_door_scope/

  /**
   * Another organisation, made inside the probe.
   *
   * @param {object} tx A transaction client.
   * @returns {Promise<object>} The organisation.
   */
  const otherOrganisation = (tx) =>
    tx.organization.create({
      data: {
        name: 'Probe receiving organisation',
        slug: unique('receiving-org'),
        contactEmail: `${unique('receiving')}@example.test`,
      },
    })

  /**
   * A door scanner of the first organisation, scoped to one of its events.
   *
   * @param {object} tx A transaction client.
   * @param {string} eventId The event.
   * @returns {Promise<object>} The `ScannerScope` row.
   */
  const scannerScopedTo = async (tx, eventId) => {
    const scanner = await tx.user.create({
      data: {
        email: `${unique('scanner')}@example.test`,
        passwordHash: 'x'.repeat(60),
        displayName: 'Probe scanner',
        role: 'ATTENDEE',
      },
    })
    const membership = await tx.membership.create({
      data: { userId: scanner.id, organizationId: organization.id, role: 'SCANNER' },
    })

    return tx.scannerScope.create({ data: { membershipId: membership.id, eventId } })
  }

  await check(
    'moving an event while a member of its old organisation is scoped to it is refused',
    moveRefused,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const other = await otherOrganisation(tx)

      await scannerScopedTo(tx, event.id)
      await tx.event.update({ where: { id: event.id }, data: { organizationId: other.id } })
    },
  )
  await check(
    'moving an event while a waiting invitation of its old organisation names it is refused',
    moveRefused,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const other = await otherOrganisation(tx)
      const invitation = await invitationTo(tx, organization.id, 'SCANNER')

      await tx.invitationScope.create({ data: { invitationId: invitation.id, eventId: event.id } })
      await tx.event.update({ where: { id: event.id }, data: { organizationId: other.id } })
    },
  )
  await check(
    'moving an event once its old organisation’s door scopes are removed is accepted',
    null,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const other = await otherOrganisation(tx)
      const scope = await scannerScopedTo(tx, event.id)
      const invitation = await invitationTo(tx, organization.id, 'SCANNER')

      await tx.invitationScope.create({ data: { invitationId: invitation.id, eventId: event.id } })
      await tx.scannerScope.delete({ where: { id: scope.id } })
      await tx.invitationScope.deleteMany({ where: { eventId: event.id } })
      await tx.event.update({ where: { id: event.id }, data: { organizationId: other.id } })
    },
  )
  await check('an event edited without moving keeps its door scopes', null, async (tx) => {
    const event = await probeEvent(tx, organization.id)

    await scannerScopedTo(tx, event.id)
    await tx.event.update({
      where: { id: event.id },
      data: { organizationId: organization.id, title: 'Probe event, renamed' },
    })
  })

  const [crossing] = await prisma.$queryRawUnsafe(
    'SELECT ' +
      '(SELECT count(*)::int FROM "ScannerScope" s JOIN "Membership" m ON m."id" = s."membershipId" ' +
      'JOIN "Event" e ON e."id" = s."eventId" WHERE m."organizationId" <> e."organizationId") AS members, ' +
      '(SELECT count(*)::int FROM "InvitationScope" s JOIN "Invitation" i ON i."id" = s."invitationId" ' +
      'JOIN "Event" e ON e."id" = s."eventId" WHERE i."organizationId" <> e."organizationId") AS invitations',
  )
  results.push(
    record(
      'no door scope in the seeded database names another organisation’s event',
      crossing.members === 0 && crossing.invitations === 0,
      { note: `${crossing.members} member scopes, ${crossing.invitations} invitation scopes` },
    ),
  )

  // Venue states and countries as codes (20261016140000_venue_region_codes,
  // ADR 0020): every seeded United States or Canadian venue can be found by
  // the listing's State/Province filter.
  const [uncoded] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM "Venue" WHERE "country" IN (\'US\', \'CA\') ' +
      'AND "region" !~ \'^[A-Z0-9]{1,3}$\'',
  )
  const [lowerCountries] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM "Venue" WHERE "country" !~ \'^[A-Z]{2}$\'',
  )
  results.push(
    record(
      'every seeded venue stores its country in capitals, and a US or Canadian state or province as its code',
      uncoded.n === 0 && lowerCountries.n === 0,
      { note: `${uncoded.n} uncoded regions, ${lowerCountries.n} countries not in capitals` },
    ),
  )

  await check(
    'a second organisation with the same platformHeldSource is refused',
    /Organization_platformHeldSource_key/,
    async (tx) => {
      await platformHeld(tx)
      await platformHeld(tx)
    },
  )

  /**
   * An import record for a fresh event in the platform-held organisation.
   *
   * @param {object} tx A transaction client.
   * @param {string} organizationId The platform-held organisation.
   * @param {object} [overrides] Field overrides.
   * @returns {Promise<object>} The `EventImportItem` row.
   */
  const importItem = async (tx, organizationId, overrides = {}) => {
    const event = await probeEvent(tx, organizationId)

    return tx.eventImportItem.create({
      data: {
        source: 'SULEKHA',
        sourceId: '402059',
        eventId: event.id,
        importedById: user.id,
        scrapedAt: new Date('2026-09-29T21:25:00Z'),
        presentedBy: 'Probe Presenters',
        prices: [{ name: 'General', priceCents: 2500, currency: 'USD', note: null }],
        importNotes: ['A probe note.'],
        ...overrides,
      },
    })
  }

  await check(
    'a duplicate (source, sourceId) is refused',
    /EventImportItem_source_sourceId_key/,
    async (tx) => {
      const held = await platformHeld(tx)

      await importItem(tx, held.id)
      await importItem(tx, held.id)
    },
  )
  await check("an import record's prices are an array", /event_import_item_shape/, async (tx) => {
    const held = await platformHeld(tx)

    await importItem(tx, held.id, { prices: { name: 'General' } })
  })
  // Since 2026-10-15 an import copies nothing and keeps no address on the
  // source: the pictures' table and the record's link are gone.
  const [{ pictures, links }] = await prisma.$queryRawUnsafe(
    'SELECT ' +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' " +
      "AND table_name = 'EventImportImage') AS pictures, " +
      "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' " +
      "AND table_name = 'EventImportItem' AND column_name = 'sourceUrl') AS links",
  )
  results.push(
    record(
      'an import keeps no address on the source: no table of pictures, no link on its record',
      pictures === 0 && links === 0,
      {
        note: `pictures' table ${pictures === 0 ? 'absent' : 'present'}, sourceUrl ${links === 0 ? 'absent' : 'present'}`,
      },
    ),
  )

  /**
   * A ticket type an import made, on a fresh event in the platform-held organisation.
   *
   * @param {object} tx A transaction client.
   * @param {string} eventId The event.
   * @param {object} [overrides] Field overrides.
   * @returns {Promise<object>} The `TicketType` row.
   */
  const importedTier = (tx, eventId, overrides = {}) =>
    tx.ticketType.create({
      data: {
        eventId,
        name: 'General',
        priceCents: 2500,
        currency: 'USD',
        quantityTotal: 100,
        importKey: 'General|2500|USD',
        quantityIsAllowance: true,
        ...overrides,
      },
    })

  await check(
    "an imported ticket type's import key may not be blank",
    /ticket_type_import_key_shape/,
    async (tx) => {
      const held = await platformHeld(tx)
      const item = await importItem(tx, held.id)

      await importedTier(tx, item.eventId, { importKey: '   ' })
    },
  )
  await check(
    'two ticket types of one event made from the same listed price are refused',
    /TicketType_eventId_importKey_key/,
    async (tx) => {
      const held = await platformHeld(tx)
      const item = await importItem(tx, held.id)

      await importedTier(tx, item.eventId)
      await importedTier(tx, item.eventId, { name: 'General (renamed)' })
    },
  )
  await check('a malformed plan digest is refused', /event_import_run_shape/, (tx) =>
    tx.eventImportRun.create({
      data: {
        source: 'SULEKHA',
        fileName: 'texas-2026.json',
        datasetSha256: digest(),
        dataset: { format: 'desi-event-import/1' },
        plan: [],
        planDigest: 'not-a-digest',
        eventCount: 1,
        createdById: user.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    }),
  )
  await check(
    'a well-formed run, record and imported ticket types are accepted',
    null,
    async (tx) => {
      const held = await platformHeld(tx)
      const run = await tx.eventImportRun.create({
        data: {
          source: 'SULEKHA',
          fileName: 'texas-2026.json',
          datasetSha256: digest(),
          dataset: { format: 'desi-event-import/1' },
          plan: [],
          planDigest: digest(),
          eventCount: 1,
          createdById: user.id,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
      const item = await importItem(tx, held.id, { lastRunId: run.id })

      // One per listed price; a tier an organiser adds has no key, and many may.
      await importedTier(tx, item.eventId)
      await importedTier(tx, item.eventId, {
        name: 'VIP',
        priceCents: 6000,
        importKey: 'VIP|6000|USD',
        status: 'CLOSED',
      })
      await importedTier(tx, item.eventId, {
        name: 'Door',
        importKey: null,
        quantityIsAllowance: false,
      })
      await importedTier(tx, item.eventId, {
        name: 'Door 2',
        importKey: null,
        quantityIsAllowance: false,
      })
    },
  )

  return results.every(Boolean)
}
