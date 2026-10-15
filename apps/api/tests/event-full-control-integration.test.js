/**
 * Full control of posted events on a real database (SPEC2-XI X).
 *
 * The stub serialises every write and models none of the triggers, CHECKs and
 * partial indexes this work leans on, so the claims that matter most are made
 * here:
 *
 *  - what the database refuses on its own: entering DELETED without the status
 *    the event really had, rewriting that record, leaving DELETED for anything
 *    but `desi_event_restore_target`, half-set deletion columns, a cancelled
 *    night coming back, a replacement cover approved while it still points at
 *    the old one or pointing at another event's cover, two open sittings, and a
 *    sitting of the wrong shape;
 *  - the races: two deletes, a delete and a checkout on one tier, a delete and
 *    a night's cancellation, a cover's approval and the old cover's removal,
 *    and a payment captured while the event is being deleted (XM3). Each
 *    interleaving that matters is forced with an outside row lock and
 *    `pg_blocking_pids`, not hoped for;
 *  - a deletion and a night's cancellation that cannot wait behind the event's
 *    row: each gives up at its lock wait (`lib/transaction-budget.js`) with a
 *    503 to try again, never a 500, leaves nothing written and nothing of its
 *    own still queued on the row;
 *  - the whole CANCEL_AND_REFUND path on orders that carry a fee, tax and a
 *    promo code (`helpers/fee-orders.js`): every Order CHECK and the
 *    `desi_refund_within_order_total` trigger hold, and every refund settles —
 *    the proof of X-13's repair; and a night cancelled with its orders refunded;
 *  - a restore through both triggers, and a deleted event still on the
 *    organiser's analytics list, marked deleted (O8), while `events.list`
 *    leaves it out unless asked for by name.
 *
 * Collected by the API suite and by `pnpm verify:tests:fresh`, and run with
 * `REQUIRE_DATABASE=1` in CI, where an unreachable database is a failure
 * rather than a skip. Nothing is cleaned up: the ledger and the audit trail are
 * append-only, and every row carries this run's tag.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-full-control-integration
 */

import { randomUUID } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { OUT_OF_TIME_RETRY_AFTER_SECONDS } from '../src/lib/errors.js'
import { DELETION_OUT_OF_TIME_SENTENCE } from '../src/lib/event-deletion.js'
import { NIGHT_OUT_OF_TIME_SENTENCE } from '../src/lib/session-cancellation.js'
import { startSession } from '../src/lib/sessions.js'
import { LOCK_WAIT_MS, TRANSACTION_BUDGETS, budgetOptions } from '../src/lib/transaction-budget.js'
import { trafficSummary } from '../src/lib/traffic-report.js'
import {
  SEAT_POLICIES,
  approveRefund,
  cancelRefund,
  markSubmitted,
  requestRefund,
  settleRefund,
  submitRefund,
} from '../src/lib/refunds.js'
import { admissionRefusalCode } from '../src/lib/tickets.js'
import { dispatchDelivery } from '../src/lib/webhook-handlers.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'
import { createFeeEvent, createFeeOrder } from './helpers/fee-orders.js'
import { untilWaiting, waitingOn } from './helpers/row-locks.js'

const { prisma, reachable, when } = await connectTestDatabase('the full control suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the pass deriver, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

/** A reason long enough for every reason box and every reason CHECK. */
const REASON = 'The organiser called the whole season off.'

/** The deletion columns, as a restore clears them. */
const CLEARED = Object.freeze({
  deletedAt: null,
  deletedById: null,
  deletionReason: null,
  deletionOutcome: null,
  deletionAuthority: null,
  statusBeforeDeletion: null,
  deletedSlug: null,
})

/** A deletion's transaction options on an event without orders. */
const DELETION_BUDGET = budgetOptions(TRANSACTION_BUDGETS.ORDERS)

/** The tables a test may hold a row of from outside the app. */
const LOCKABLE = new Set(['Event', 'TicketType', 'TicketHold'])

const providers = createInMemoryProviderRegistry({ payments: { idPrefix: `pifull${RUN}` } })
const payments = providers.payments

let app
let world
let tagSequence = 0

/**
 * A tag unique to this run and this call, for slugs and references.
 *
 * @param {string} label What it is for.
 * @returns {string} Lower-case letters and digits.
 */
function tag(label) {
  tagSequence += 1

  return `${label}${RUN}${tagSequence.toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * A user with a confirmed second factor, as every privileged role needs.
 *
 * @param {string} label Distinguishes them.
 * @param {string} role The platform role.
 * @returns {Promise<object>} The user.
 */
async function person(label, role) {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${RUN}@full-control.example`,
      displayName: `${label} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  await prisma.mfaFactor.create({
    data: {
      userId: user.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })

  return user
}

/**
 * Bearer headers for a real session whose second factor was confirmed just
 * now, carrying the user's memberships as they stand.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The headers.
 */
async function sessionFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'full-control-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * A verified organisation the owner runs, with a venue, and fresh owner headers.
 *
 * @param {string} label Distinguishes it.
 * @returns {Promise<object>} `{ organization, venue, headers }`.
 */
async function organisation(label) {
  const slug = tag(label)
  const organization = await prisma.organization.create({
    data: {
      name: `Full control ${slug}`,
      slug: `full-control-${slug}`,
      contactEmail: `hello-${slug}@full-control.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      organizationId: organization.id,
      name: `Control Hall ${slug}`,
      slug: `control-hall-${slug}`,
      addressLine1: '1 Test Road',
      city: 'Houston',
      region: 'TX',
      postalCode: '77002',
      country: 'US',
      timezone: 'America/Chicago',
    },
  })

  await prisma.membership.create({
    data: { userId: world.owner.id, organizationId: organization.id, role: 'OWNER' },
  })

  return { organization, venue, headers: await sessionFor(world.owner) }
}

/**
 * An event of the suite's organisation in a status, with one night per
 * `nights` a day apart and one general-admission tier on each.
 *
 * @param {string} label Distinguishes it.
 * @param {object} [options] Options.
 * @param {string} [options.status] The event's status.
 * @param {number} [options.nights] How many nights.
 * @param {object} [options.home] The organisation, from {@link organisation}; the suite's own by default.
 * @returns {Promise<object>} `{ event, nights, tiers }`: the rows.
 */
async function posted(label, { status = 'ON_SALE', nights = 1, home = world.home } = {}) {
  const slug = tag(label)
  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const lastEnds = new Date(startsAt.getTime() + (nights - 1) * 86_400_000 + 4 * 3_600_000)
  const draft = ['DRAFT', 'CHANGES_REQUIRED', 'REVIEW_PENDING', 'REJECTED'].includes(status)
  const event = await prisma.event.create({
    data: {
      organizationId: home.organization.id,
      venueId: home.venue.id,
      title: `Control ${slug}`,
      slug: `control-${slug}`,
      summary: 'Seeded for the full control suite.',
      description: 'Seeded for the full control suite, long enough to be plausible.',
      category: 'MUSIC_CONCERT',
      status,
      startsAt,
      endsAt: lastEnds,
      timezone: 'America/Chicago',
      publishedAt: draft ? null : new Date(),
      salesOpenedAt: status === 'ON_SALE' ? new Date() : null,
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })
  const rows = { event, nights: [], tiers: [] }

  for (let night = 0; night < nights; night += 1) {
    const opens = new Date(startsAt.getTime() + night * 86_400_000)
    const session = await prisma.eventSession.create({
      data: {
        eventId: event.id,
        label: `Night ${night + 1}`,
        startsAt: opens,
        endsAt: new Date(opens.getTime() + 4 * 3_600_000),
        timezone: 'America/Chicago',
        capacity: 200,
      },
    })
    const tier = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        eventSessionId: session.id,
        name: `General ${night + 1} ${slug}`,
        priceCents: 4_000,
        currency: 'USD',
        quantityTotal: 100,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })

    rows.nights.push(session)
    rows.tiers.push(tier)
  }

  return rows
}

/**
 * The event as the database holds it now.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object>} The row.
 */
function eventRow(eventId) {
  return prisma.event.findUnique({ where: { id: eventId } })
}

/**
 * Ask to delete an event, at its current revision unless one is given.
 *
 * @param {string} eventId The event.
 * @param {string} outcome The outcome the deleter read.
 * @param {object} [options] Options.
 * @param {object} [options.headers] Whose request; the owner's in the suite's organisation by default.
 * @param {number} [options.revision] The revision to send.
 * @param {string} [options.slug] The web address to confirm, read beforehand; with `revision`, nothing is read first.
 * @param {object} [options.extra] More body fields.
 * @returns {Promise<object>} The response.
 */
async function deleteEvent(
  eventId,
  outcome,
  { headers = world.home.headers, revision, slug, extra = {} } = {},
) {
  // Read beforehand, a racing test's deletion goes straight to the API.
  const row = slug && revision !== undefined ? { slug, revision } : await eventRow(eventId)

  return app.inject({
    method: 'POST',
    url: `/v1/events/${eventId}/delete`,
    headers,
    payload: {
      revision: revision ?? row.revision,
      reason: REASON,
      confirmSlug: row.slug,
      expectedOutcome: outcome,
      ...extra,
    },
  })
}

/**
 * Cancel one night, at the event's current revision unless one is given.
 *
 * @param {string} eventId The event.
 * @param {string} sessionId The night.
 * @param {number} expectedOrders The preview's count of orders it touches.
 * @param {object} [options] Options.
 * @param {object} [options.headers] Whose request.
 * @param {number} [options.revision] The revision to send.
 * @returns {Promise<object>} The response.
 */
async function cancelNight(
  eventId,
  sessionId,
  expectedOrders,
  { headers = world.home.headers, revision } = {},
) {
  return app.inject({
    method: 'POST',
    url: `/v1/events/${eventId}/sessions/${sessionId}/cancel`,
    headers,
    payload: {
      revision: revision ?? (await eventRow(eventId)).revision,
      reason: 'The band could not travel that night.',
      confirm: true,
      expectedOrders,
    },
  })
}

/**
 * Place an order for a tier as the buyer, with no hold.
 *
 * @param {object} event The event.
 * @param {object} tier The tier.
 * @param {number} quantity How many.
 * @returns {Promise<object>} The response.
 */
function placeOrder(event, tier, quantity) {
  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: world.buyer.headers,
    payload: {
      eventId: event.id,
      buyerEmail: world.buyer.user.email,
      buyerName: 'Control Buyer',
      items: [{ ticketTypeId: tier.id, quantity }],
    },
  })
}

/**
 * Hold one row locked from outside the app until `open()` is called.
 *
 * @param {string} table One of {@link LOCKABLE}.
 * @param {string} rowId The row.
 * @returns {Promise<{pid: number, open: function(): Promise<void>}>} The locking backend and its release.
 */
async function lockFromOutside(table, rowId) {
  if (!LOCKABLE.has(table)) throw new Error(`No outside lock for the table ${table}.`)

  let open
  const gate = new Promise((resolve) => {
    open = resolve
  })
  let ready
  const locked = new Promise((resolve) => {
    ready = resolve
  })

  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, rowId)

      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

      ready(Number(pid))
      await gate
    },
    { timeout: 60_000, maxWait: 10_000 },
  )

  done.catch((error) => ready(Promise.reject(error)))

  const pid = await locked

  return {
    pid,
    open: async () => {
      open()
      await done
    },
  }
}

/**
 * The columns an event picture needs, with overrides.
 *
 * @param {object} event The event.
 * @param {object} [overrides] Column overrides.
 * @returns {object} `MediaAsset` create data.
 */
function picture(event, overrides = {}) {
  return {
    ownerType: 'EVENT',
    ownerId: event.id,
    eventId: event.id,
    kind: 'EVENT_COVER',
    storageKey: `pg/${randomUUID()}`,
    contentType: 'image/png',
    byteSize: 100,
    width: 960,
    height: 540,
    checksum: 'a'.repeat(64),
    altText: 'Dancers circling a lit garbo',
    position: null,
    sanitisedAt: new Date(),
    scanStatus: 'CLEAN',
    uploadedById: world.owner.id,
    ...overrides,
  }
}

/** An approved picture's columns. */
const APPROVED = Object.freeze({ moderationStatus: 'APPROVED', moderatedAt: new Date() })

/**
 * The columns that put an event into DELETED, with overrides.
 *
 * @param {string} statusBeforeDeletion What the event was.
 * @param {object} [overrides] Column overrides.
 * @returns {object} `Event` update data.
 */
function deletion(statusBeforeDeletion, overrides = {}) {
  return {
    status: 'DELETED',
    deletedAt: new Date(),
    deletionReason: REASON,
    deletionOutcome: 'REMOVED',
    deletionAuthority: 'ORGANIZATION',
    statusBeforeDeletion,
    ...overrides,
  }
}

/**
 * Update an event's columns directly, as a careless script would.
 *
 * @param {string} eventId The event.
 * @param {object} data The columns.
 * @returns {Promise<object>} The row.
 */
function write(eventId, data) {
  return prisma.event.update({ where: { id: eventId }, data })
}

/**
 * A captured intent at the in-memory provider and a PENDING order for it, the
 * way checkout leaves one between its two transactions.
 *
 * @param {object} event The event.
 * @param {object} tier The tier.
 * @param {string} paymentStatus The payment's status.
 * @returns {Promise<{order: object, payment: object, intent: object}>} The rows.
 */
async function orderInFlight(event, tier, paymentStatus = 'PENDING') {
  const totalCents = 2 * tier.priceCents
  const intent = payments.createIntent({ amountCents: totalCents, currency: 'USD' })

  payments.capture(intent.id)

  const order = await prisma.order.create({
    data: {
      reference: `DE-FC${tag('o')}`.toUpperCase().slice(0, 32),
      eventId: event.id,
      eventSessionId: tier.eventSessionId,
      userId: world.buyer.user.id,
      buyerEmail: world.buyer.user.email,
      buyerName: 'Control Buyer',
      status: 'PENDING',
      currency: 'USD',
      subtotalCents: totalCents,
      totalCents,
      items: {
        create: [
          {
            ticketTypeId: tier.id,
            quantity: 2,
            unitPriceCents: tier.priceCents,
            subtotalCents: totalCents,
          },
        ],
      },
    },
  })
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: payments.name,
      providerRef: intent.id,
      status: paymentStatus,
      amountCents: totalCents,
      currency: 'USD',
    },
  })

  return { order, payment, intent }
}

/**
 * The provider's word that an intent succeeded, as a signed delivery carries it.
 *
 * @param {object} intent The intent.
 * @param {number} amountCents Its amount.
 * @returns {Promise<object>} The handler's result.
 */
function paymentSucceeded(intent, amountCents) {
  return dispatchDelivery(prisma, {
    id: null,
    eventType: 'payment_intent.succeeded',
    accountContext: null,
    payload: {
      data: {
        object: { id: intent.id, amount: amountCents, currency: 'usd', status: 'succeeded' },
      },
    },
  })
}

/**
 * Orders on an event that still hold or expect money.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object[]>} PENDING and PAID orders.
 */
function liveOrders(eventId) {
  return prisma.order.findMany({ where: { eventId, status: { in: ['PENDING', 'PAID'] } } })
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers,
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  })
  await app.ready()

  const owner = await person('owner', 'ORGANIZER')
  const moderator = await person('moderator', 'MODERATOR')
  const administrator = await person('administrator', 'ADMIN')
  const buyer = await prisma.user.create({
    data: {
      email: `buyer-${RUN}@full-control.example`,
      displayName: `Buyer ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role: 'ATTENDEE',
      emailVerified: true,
    },
  })

  world = { owner }
  world.home = await organisation('home')
  world.moderator = { user: moderator, headers: await sessionFor(moderator) }
  world.administrator = { user: administrator, headers: await sessionFor(administrator) }
  world.buyer = { user: buyer, headers: await sessionFor(buyer) }
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

when()('what the database refuses on its own', () => {
  it('records the status an event really had when it entered DELETED, and never rewrites it', async () => {
    const { event } = await posted('enter')

    await expect(write(event.id, deletion('DRAFT'))).rejects.toThrow(
      /event_deletion_records_prior_status/u,
    )
    expect((await eventRow(event.id)).status).toBe('ON_SALE')

    await write(event.id, deletion('ON_SALE'))

    await expect(write(event.id, { statusBeforeDeletion: 'PUBLISHED' })).rejects.toThrow(
      /event_deletion_records_prior_status/u,
    )
    expect((await eventRow(event.id)).statusBeforeDeletion).toBe('ON_SALE')
  })

  it('leaves DELETED only for desi_event_restore_target, which passes the review gate', async () => {
    const { event } = await posted('leave')

    await write(event.id, deletion('ON_SALE'))

    // Deleted on sale: never back on sale, and never anywhere but paused.
    for (const status of ['ON_SALE', 'DRAFT', 'CANCELLED']) {
      await expect(write(event.id, { status, ...CLEARED }), status).rejects.toThrow(
        /event_restore_returns_prior_status/u,
      )
    }

    await write(event.id, { status: 'SALES_PAUSED', ...CLEARED })
    expect((await eventRow(event.id)).status).toBe('SALES_PAUSED')

    // Deleted under review: back as a draft, never public.
    const review = await posted('leave-review', { status: 'REVIEW_PENDING' })

    await write(review.event.id, deletion('REVIEW_PENDING'))
    await expect(write(review.event.id, { status: 'PUBLISHED', ...CLEARED })).rejects.toThrow(
      /event_restore_returns_prior_status/u,
    )
    await write(review.event.id, { status: 'DRAFT', ...CLEARED })
    expect((await eventRow(review.event.id)).status).toBe('DRAFT')
  })

  it('still refuses DRAFT → PUBLISHED', async () => {
    const { event } = await posted('gate', { status: 'DRAFT' })

    await expect(write(event.id, { status: 'PUBLISHED' })).rejects.toThrow(
      /event_public_requires_review/u,
    )
  })

  it('refuses half-set deletion columns (event_deletion_consistency)', async () => {
    const { event } = await posted('half')

    for (const [label, data] of [
      ['a deletion stamp on a live event', { deletedAt: new Date() }],
      ['a released address on a live event', { deletedSlug: 'somewhere-else' }],
      ['DELETED with no authority', deletion('ON_SALE', { deletionAuthority: null })],
      [
        'DELETED with a nine-character reason',
        deletion('ON_SALE', { deletionReason: 'Too short' }),
      ],
      [
        'refunded on deletion without having been cancelled',
        deletion('ON_SALE', { deletionOutcome: 'CANCELLED_AND_REFUNDED' }),
      ],
    ]) {
      await expect(write(event.id, data), label).rejects.toThrow(/event_deletion_consistency/u)
    }

    expect((await eventRow(event.id)).status).toBe('ON_SALE')
  })

  it('stamps a cancelled night, and never brings it back', async () => {
    const { nights } = await posted('night', { nights: 2 })
    const night = nights[0]
    const update = (data) => prisma.eventSession.update({ where: { id: night.id }, data })

    await expect(update({ status: 'CANCELLED' })).rejects.toThrow(
      /event_session_cancellation_stamped/u,
    )
    await expect(
      update({ status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: '   ' }),
    ).rejects.toThrow(/event_session_cancellation_stamped/u)

    await update({
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReason: 'The band could not travel.',
    })

    await expect(
      update({ status: 'SCHEDULED', cancelledAt: null, cancellationReason: null }),
    ).rejects.toThrow(/event_session_cancellation_final/u)
    expect((await prisma.eventSession.findUnique({ where: { id: night.id } })).status).toBe(
      'CANCELLED',
    )
  })

  it('never approves a replacement cover that still points, nor lets one point at another event’s cover', async () => {
    const { event } = await posted('covers')
    const other = await posted('covers-other')
    const old = await prisma.mediaAsset.create({ data: picture(event, APPROVED) })

    await expect(
      prisma.mediaAsset.create({ data: picture(event, { ...APPROVED, replacesMediaId: old.id }) }),
    ).rejects.toThrow(/media_asset_replacement_shape/u)
    await expect(
      prisma.mediaAsset.create({
        data: picture(event, { kind: 'EVENT_GALLERY', position: 0, replacesMediaId: old.id }),
      }),
    ).rejects.toThrow(/media_asset_replacement_shape/u)
    await expect(
      prisma.mediaAsset.create({ data: picture(other.event, { replacesMediaId: old.id }) }),
    ).rejects.toThrow(/media_asset_replacement_matches/u)

    const waiting = await prisma.mediaAsset.create({
      data: picture(event, { replacesMediaId: old.id }),
    })

    await expect(
      prisma.mediaAsset.update({ where: { id: waiting.id }, data: APPROVED }),
    ).rejects.toThrow(/media_asset_replacement_shape/u)
    // A replacement replaces the current cover, never another replacement.
    await expect(
      prisma.mediaAsset.update({ where: { id: old.id }, data: { replacesMediaId: waiting.id } }),
    ).rejects.toThrow(/media_asset_replacement/u)

    expect(
      await prisma.mediaAsset.count({ where: { eventId: event.id, moderationStatus: 'APPROVED' } }),
    ).toBe(1)
  })

  it('keeps one open sitting per administrator per event, of the right shape', async () => {
    const { event } = await posted('sittings')
    const opened = new Date()
    const sitting = (overrides = {}) =>
      prisma.eventPlatformEdit.create({
        data: {
          eventId: event.id,
          actorId: world.administrator.user.id,
          reason: 'The organiser asked us to fix the end time.',
          openedAt: opened,
          expiresAt: new Date(opened.getTime() + 60 * 60_000),
          ...overrides,
        },
      })
    const first = await sitting()

    await expect(sitting()).rejects.toMatchObject({
      message: expect.stringMatching(/Unique constraint|EventPlatformEdit_one_open_per_actor_key/u),
    })

    for (const [label, overrides] of [
      ['a nine-character reason', { reason: 'Too short' }],
      ['three hours open', { expiresAt: new Date(opened.getTime() + 3 * 3_600_000) }],
      ['expiring as it opens', { expiresAt: opened }],
      ['closed with no ending', { closedAt: new Date() }],
      ['an ending while open', { endedBy: 'CLOSED' }],
    ]) {
      await expect(sitting(overrides), label).rejects.toThrow(/event_platform_edit_shape/u)
    }

    await prisma.eventPlatformEdit.update({
      where: { id: first.id },
      data: { closedAt: new Date(), endedBy: 'EXPIRED' },
    })

    // Once the first one ended (here as EXPIRED), another may open.
    const second = await sitting()

    expect(second.closedAt).toBeNull()
  })
})

when()('deleting through the API, racing', () => {
  it('two deletes at one revision: one is the deletion, the other 409', async () => {
    const { event } = await posted('twice')
    const { revision } = await eventRow(event.id)

    const answers = await Promise.all([
      deleteEvent(event.id, 'REMOVE', { revision }),
      deleteEvent(event.id, 'REMOVE', { revision }),
    ])

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409])
    expect(['ALREADY_DELETED', 'STALE_REVISION']).toContain(
      answers.find((answer) => answer.statusCode === 409).json().error.code,
    )
    expect(
      await prisma.auditLog.count({ where: { action: 'event.deleted', entityId: event.id } }),
    ).toBe(1)
    expect(
      await prisma.eventModerationAction.count({
        where: { eventId: event.id, toStatus: 'DELETED' },
      }),
    ).toBe(1)
  })

  it('a checkout queued behind a deletion on its tier is refused, and leaves no order', async () => {
    const { event, tiers } = await posted('checkout-after')
    const tierLock = await lockFromOutside('TicketType', tiers[0].id)

    const deleting = deleteEvent(event.id, 'REMOVE')
    const [deleter] = await untilWaiting(prisma, () => [tierLock.pid], 1, 'the deletion')
    const ordering = placeOrder(event, tiers[0], 2)

    await untilWaiting(prisma, () => [tierLock.pid, deleter], 2, 'the checkout')
    await tierLock.open()

    const [deleted, ordered] = await Promise.all([deleting, ordering])

    expect(deleted.statusCode, deleted.body).toBe(200)
    expect(ordered.statusCode).toBe(422)
    expect(ordered.json().error.message).toBe('This event is not on sale.')
    expect((await eventRow(event.id)).status).toBe('DELETED')
    expect(await prisma.order.count({ where: { eventId: event.id } })).toBe(0)
  })

  it('a deletion queued behind a checkout is refused, and the order it lost to is refunded by the next one', async () => {
    const { event, tiers } = await posted('checkout-before')
    const tierLock = await lockFromOutside('TicketType', tiers[0].id)

    const ordering = placeOrder(event, tiers[0], 2)
    const [orderer] = await untilWaiting(prisma, () => [tierLock.pid], 1, 'the checkout')
    const deleting = deleteEvent(event.id, 'REMOVE')

    await untilWaiting(prisma, () => [tierLock.pid, orderer], 2, 'the deletion')
    await tierLock.open()

    const [ordered, refused] = await Promise.all([ordering, deleting])

    expect(ordered.statusCode, ordered.body).toBe(201)
    expect(refused.statusCode).toBe(409)
    // Seen while its payment was being taken, or once it was paid.
    expect(['PAYMENT_IN_FLIGHT', 'OUTCOME_CHANGED']).toContain(refused.json().error.code)
    expect((await eventRow(event.id)).status).toBe('ON_SALE')

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${event.id}/deletion`,
      headers: world.home.headers,
    })

    expect(preview.json().data).toMatchObject({ outcome: 'CANCEL_AND_REFUND', permitted: true })

    const deleted = await deleteEvent(event.id, 'CANCEL_AND_REFUND')

    expect(deleted.statusCode, deleted.body).toBe(200)
    expect(deleted.json().data.refunds).toMatchObject({ owed: 1, settled: 1, failed: 0 })
    expect(await liveOrders(event.id)).toEqual([])
    expect(
      await prisma.order.findMany({ where: { eventId: event.id }, select: { status: true } }),
    ).toEqual([{ status: 'REFUNDED' }])
  })

  it('never leaves an order on a deleted event when the two race unforced', async () => {
    for (let round = 0; round < 4; round += 1) {
      const { event, tiers } = await posted(`checkout-race-${round}`)
      const { revision } = await eventRow(event.id)
      const [ordered, deleted] = await Promise.all([
        placeOrder(event, tiers[0], 1),
        deleteEvent(event.id, 'REMOVE', { revision }),
      ])
      const status = (await eventRow(event.id)).status

      if (status === 'DELETED') {
        expect(deleted.statusCode, `round ${round}`).toBe(200)
        expect(ordered.statusCode, `round ${round}`).toBe(422)
        expect(await liveOrders(event.id), `round ${round}`).toEqual([])
      } else {
        expect(deleted.statusCode, `round ${round}`).toBe(409)
        expect(ordered.statusCode, `round ${round}`).toBe(201)
      }
    }
  })

  it('a deletion and a night’s cancellation at one revision are serialised by the event row', async () => {
    const { event, nights } = await posted('night-race', { nights: 2 })
    const { revision, slug } = await eventRow(event.id)
    const eventLock = await lockFromOutside('Event', event.id)

    // The cancellation waits on the row from here until it is let go: each
    // request carries what it would otherwise read, so the wait is the
    // deletion's way to the row and no more, well inside the cancellation's
    // lock wait (`LOCK_WAIT_MS`) and its budget.
    const cancelling = cancelNight(event.id, nights[0].id, 0, { revision })
    const [canceller] = await untilWaiting(prisma, () => [eventLock.pid], 1, 'the cancellation')
    const deleting = deleteEvent(event.id, 'REMOVE', { revision, slug })

    await untilWaiting(prisma, () => [eventLock.pid, canceller], 2, 'the deletion')
    await eventLock.open()

    const [cancelled, refused] = await Promise.all([cancelling, deleting])

    expect(cancelled.statusCode, cancelled.body).toBe(200)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe('STALE_REVISION')
    expect((await eventRow(event.id)).status).toBe('ON_SALE')
    expect(
      (
        await prisma.eventSession.findMany({
          where: { eventId: event.id },
          orderBy: { startsAt: 'asc' },
        })
      ).map((night) => night.status),
    ).toEqual(['CANCELLED', 'SCHEDULED'])

    // Unforced, either may win, and the loser changes nothing.
    const again = await posted('night-race-unforced', { nights: 2 })
    const at = (await eventRow(again.event.id)).revision
    const answers = await Promise.all([
      cancelNight(again.event.id, again.nights[0].id, 0, { revision: at }),
      deleteEvent(again.event.id, 'REMOVE', { revision: at }),
    ])

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409])

    const after = await eventRow(again.event.id)
    const cancelledNights = await prisma.eventSession.count({
      where: { eventId: again.event.id, status: 'CANCELLED' },
    })

    expect(after.status === 'DELETED' ? cancelledNights === 0 : cancelledNights === 1).toBe(true)
  })

  // The deletion's budget, which it proves, and the suite's thirty seconds
  // besides.
  it(
    'a deletion and a night’s cancellation that cannot wait behind the event row answer 503, never 500, and change nothing',
    async () => {
      const { event, nights } = await posted('night-wait', { nights: 2 })
      const before = await eventRow(event.id)
      const eventLock = await lockFromOutside('Event', event.id)
      const answered = (request) => request.then((response) => ({ response, at: Date.now() }))
      const started = Date.now()

      // The cancellation waits on the row's holder; the deletion queues behind
      // the cancellation, for the row's tuple lock and then for the holder: two
      // lock waits, which its statement bound (its budget) cuts short.
      const cancelling = answered(
        cancelNight(event.id, nights[0].id, 0, { revision: before.revision }),
      )
      let answers = null
      let queued = null
      let deleting = Promise.resolve(null)

      try {
        const [canceller] = await untilWaiting(prisma, () => [eventLock.pid], 1, 'the cancellation')

        deleting = answered(
          deleteEvent(event.id, 'REMOVE', { revision: before.revision, slug: before.slug }),
        )
        await untilWaiting(prisma, () => [eventLock.pid, canceller], 2, 'the deletion')

        // Held past their bounds, they give up on their own, well before the
        // row is let go, which is only after this.
        answers = await Promise.race([
          Promise.all([cancelling, deleting]),
          new Promise((resolve) => {
            setTimeout(() => resolve(null), DELETION_BUDGET.timeout + 10_000)
          }),
        ])
        // Answered while the row is still held, and nothing of theirs is still
        // queued behind it: PostgreSQL ended each transaction, locks and all.
        queued = await waitingOn(prisma, [eventLock.pid])
      } finally {
        await eventLock.open()
        await Promise.allSettled([cancelling, deleting])
      }

      expect(answers, 'they were still waiting on the event row').not.toBeNull()
      expect(queued).toEqual([])

      const [cancelled, deleted] = answers

      // They waited as long as they promise to, and were not refused at once.
      expect(cancelled.at - started).toBeGreaterThanOrEqual(LOCK_WAIT_MS)
      expect(deleted.at - started).toBeGreaterThanOrEqual(LOCK_WAIT_MS)

      for (const [{ response: answer }, sentence] of [
        [cancelled, NIGHT_OUT_OF_TIME_SENTENCE],
        [deleted, DELETION_OUT_OF_TIME_SENTENCE],
      ]) {
        expect(answer.statusCode, answer.body).toBe(503)
        expect(answer.headers['retry-after']).toBe(String(OUT_OF_TIME_RETRY_AFTER_SECONDS))
        expect(answer.json().error).toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
          message: sentence,
        })
        expect(answer.body).not.toMatch(/P20\d\d|55P03|57014|lock timeout|expired transaction/)
      }

      // Nothing of either was written.
      expect(await eventRow(event.id)).toMatchObject({
        status: before.status,
        revision: before.revision,
        ...CLEARED,
      })
      expect(
        (
          await prisma.eventSession.findMany({
            where: { eventId: event.id },
            orderBy: { startsAt: 'asc' },
          })
        ).map((night) => night.status),
      ).toEqual(['SCHEDULED', 'SCHEDULED'])
      expect(
        await prisma.auditLog.count({
          where: {
            entityId: event.id,
            action: { in: ['event.deleted', 'event.session_cancelled'] },
          },
        }),
      ).toBe(0)
      expect(await prisma.eventModerationAction.count({ where: { eventId: event.id } })).toBe(0)

      // And trying again, as they said, does what was asked.
      const again = await cancelNight(event.id, nights[0].id, 0, { revision: before.revision })

      expect(again.statusCode, again.body).toBe(200)
      expect(again.json().data.session.status).toBe('CANCELLED')
    },
    DELETION_BUDGET.timeout + 30_000,
  )

  it('a cover’s approval and the old cover’s removal end with one current cover, in either order', async () => {
    for (const first of ['removal', 'approval']) {
      const { event } = await posted(`cover-race-${first}`)
      const old = await prisma.mediaAsset.create({ data: picture(event, APPROVED) })
      const replacement = await prisma.mediaAsset.create({
        data: picture(event, { replacesMediaId: old.id }),
      })
      const { revision } = await eventRow(event.id)
      const remove = () =>
        app.inject({
          method: 'DELETE',
          url: `/v1/events/${event.id}/media/${old.id}?revision=${revision}`,
          headers: world.home.headers,
        })
      const approve = () =>
        app.inject({
          method: 'POST',
          url: `/v1/moderation/media/${replacement.id}/decision`,
          headers: world.moderator.headers,
          payload: { decision: 'approve' },
        })
      const eventLock = await lockFromOutside('Event', event.id)
      const one = first === 'removal' ? remove() : approve()
      const [waiter] = await untilWaiting(prisma, () => [eventLock.pid], 1, `the ${first}`)
      const two = first === 'removal' ? approve() : remove()

      await untilWaiting(prisma, () => [eventLock.pid, waiter], 2, 'the second request')
      await eventLock.open()

      const [removed, approved] =
        first === 'removal'
          ? await Promise.all([one, two])
          : (await Promise.all([one, two])).reverse()

      expect(approved.statusCode, `${first} first: ${approved.body}`).toBe(200)

      if (first === 'removal') {
        expect(removed.statusCode, removed.body).toBe(200)
      } else {
        // The old cover went with the approval; removing it finds nothing.
        expect([404, 409]).toContain(removed.statusCode)
      }

      const covers = await prisma.mediaAsset.findMany({
        where: { eventId: event.id, kind: 'EVENT_COVER' },
        select: { id: true, moderationStatus: true, replacesMediaId: true },
      })

      expect(covers, `${first} first`).toEqual([
        { id: replacement.id, moderationStatus: 'APPROVED', replacesMediaId: null },
      ])
    }
  })
})

when()('a payment captured while the event is being deleted (XM3)', () => {
  it('is never lost: the deletion refuses while it is in flight, and refunds it once paid', async () => {
    const { event, tiers } = await posted('webhook-sequence')
    const { order, payment, intent } = await orderInFlight(event, tiers[0])

    // The deletion first: the payment is still being taken.
    const early = await deleteEvent(event.id, 'REMOVE')

    expect(early.statusCode).toBe(409)
    expect(early.json().error.code).toBe('PAYMENT_IN_FLIGHT')

    // Then the provider's word: the order is paid, and deleting it now refunds it.
    expect((await paymentSucceeded(intent, payment.amountCents)).outcome).toBe('processed')
    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('PAID')

    const stale = await deleteEvent(event.id, 'REMOVE')

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('OUTCOME_CHANGED')

    const deleted = await deleteEvent(event.id, 'CANCEL_AND_REFUND')

    expect(deleted.statusCode, deleted.body).toBe(200)
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      status: 'REFUNDED',
      refundedCents: order.totalCents,
      refundPendingCents: 0,
    })
  })

  it('races the delivery against the deletion and never deletes over a captured payment', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { event, tiers } = await posted(`webhook-race-${round}`)
      const { order, payment, intent } = await orderInFlight(event, tiers[0])
      const [delivered, deleted] = await Promise.all([
        paymentSucceeded(intent, payment.amountCents),
        deleteEvent(event.id, 'REMOVE'),
      ])

      expect(delivered.outcome).toBe('processed')
      expect(deleted.statusCode, `round ${round}`).toBe(409)
      expect(['PAYMENT_IN_FLIGHT', 'OUTCOME_CHANGED']).toContain(deleted.json().error.code)
      expect((await eventRow(event.id)).status).toBe('ON_SALE')
      expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('PAID')
    }
  })

  it('turns a payment that lands on an order the deletion cancelled into a reconciliation task', async () => {
    const { event, tiers } = await posted('webhook-late')
    // A payment the provider refused: nobody is paying for this order.
    const { order, payment, intent } = await orderInFlight(event, tiers[0], 'FAILED')

    const deleted = await deleteEvent(event.id, 'REMOVE')

    expect(deleted.statusCode, deleted.body).toBe(200)
    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('CANCELLED')

    // The provider changes its mind: the money was taken after all.
    expect((await paymentSucceeded(intent, payment.amountCents)).outcome).toBe('processed')

    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('CANCELLED')
    expect(await liveOrders(event.id)).toEqual([])

    const task = await prisma.reconciliationTask.findFirst({
      where: { paymentId: payment.id, kind: 'PROVIDER_MISMATCH', state: 'OPEN' },
    })

    expect(task).toBeTruthy()
    expect(task.organizationId).toBe(world.home.organization.id)
    expect(
      await prisma.auditLog.count({
        where: { action: 'payment.succeeded_after_close', entityId: payment.id },
      }),
    ).toBe(1)
  })
})

when()('cancelling and refunding orders that carry a fee, tax and a promo code', () => {
  /**
   * A fee event the suite's owner runs, with fresh headers.
   *
   * @param {string} label Distinguishes it.
   * @returns {Promise<object>} The world from `createFeeEvent`, with `headers`.
   */
  async function feeWorld(label) {
    const fees = await createFeeEvent(prisma, { tag: tag(label) })

    await prisma.membership.create({
      data: { userId: world.owner.id, organizationId: fees.organization.id, role: 'OWNER' },
    })

    return { ...fees, headers: await sessionFor(world.owner) }
  }

  /**
   * A paid fee order.
   *
   * @param {object} fees From {@link feeWorld}.
   * @param {object} [options] Passed to `createFeeOrder`.
   * @returns {Promise<object>} `{ order, payment, totals, tickets }`.
   */
  function feeOrder(fees, options = {}) {
    return createFeeOrder(prisma, fees, {
      tag: tag('order'),
      payments,
      credentialSecret: SECRET,
      ...options,
    })
  }

  /**
   * A second night on a fee event, a day after the first, with a tier of its
   * own at a price.
   *
   * @param {object} fees From {@link feeWorld}.
   * @param {number} priceCents The tier's price; 0 for a free tier.
   * @param {string} label Distinguishes the tier's name.
   * @returns {Promise<{second: object, tier: object}>} The night and its tier.
   */
  async function secondNight(fees, priceCents, label) {
    const later = new Date(fees.session.startsAt.getTime() + 86_400_000)
    const second = await prisma.eventSession.create({
      data: {
        eventId: fees.event.id,
        startsAt: later,
        endsAt: new Date(later.getTime() + 4 * 3_600_000),
        timezone: 'America/Chicago',
        capacity: 500,
      },
    })
    const tier = await prisma.ticketType.create({
      data: {
        eventId: fees.event.id,
        eventSessionId: second.id,
        name: `Second night ${label} ${RUN}`,
        priceCents,
        currency: 'USD',
        quantityTotal: 50,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })

    return { second, tier }
  }

  /**
   * The night's cancellation preview, as the organiser reads it.
   *
   * @param {object} fees From {@link feeWorld}.
   * @param {string} sessionId The night.
   * @returns {Promise<object>} The response.
   */
  function nightPreview(fees, sessionId) {
    return app.inject({
      method: 'GET',
      url: `/v1/events/${fees.event.id}/sessions/${sessionId}/cancellation`,
      headers: fees.headers,
    })
  }

  /**
   * An order's tickets, by line, in the order they were issued.
   *
   * @param {string} orderItemId The line.
   * @returns {Promise<object[]>} The tickets.
   */
  function ticketsOf(orderItemId) {
    return prisma.ticket.findMany({ where: { orderItemId }, orderBy: { createdAt: 'asc' } })
  }

  /**
   * Whether the door would admit a ticket now, as it decides: its state, its
   * order's status, its event and its night.
   *
   * @param {string} ticketId The ticket.
   * @returns {Promise<string|null>} The refusal code, or null when it admits.
   */
  async function doorAnswer(ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { orderItem: { include: { order: { include: { event: true } } } } },
    })
    const tier = await prisma.ticketType.findUnique({
      where: { id: ticket.orderItem.ticketTypeId },
      include: { eventSession: true },
    })

    return admissionRefusalCode(
      ticket,
      ticket.orderItem.order,
      ticket.orderItem.order.event,
      tier.eventSession ?? null,
    )
  }

  it('deletes an event on sale as CANCEL_AND_REFUND: cancelled, every order refunded in full, then DELETED', async () => {
    const fees = await feeWorld('refund')
    const sold = [await feeOrder(fees), await feeOrder(fees, { withPromo: false })]
    const owed = sold.reduce((sum, paid) => sum + paid.order.totalCents, 0)

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fees.event.id}/deletion`,
      headers: fees.headers,
    })

    expect(preview.statusCode).toBe(200)
    expect(preview.json().data).toMatchObject({
      outcome: 'CANCEL_AND_REFUND',
      permitted: true,
      refusal: null,
      counts: { paidOrders: 2, refundableCents: owed, currency: 'USD' },
    })

    const deleted = await deleteEvent(fees.event.id, 'CANCEL_AND_REFUND', { headers: fees.headers })

    expect(deleted.statusCode, deleted.body).toBe(200)
    expect(deleted.json().data.event.status).toBe('DELETED')
    expect(deleted.json().data.refunds).toMatchObject({
      owed: 2,
      settled: 2,
      failed: 0,
      amountCents: owed,
    })

    expect(await eventRow(fees.event.id)).toMatchObject({
      status: 'DELETED',
      statusBeforeDeletion: 'CANCELLED',
      deletionOutcome: 'CANCELLED_AND_REFUNDED',
      deletionAuthority: 'ORGANIZATION',
      deletionReason: REASON,
      // It was public: its address stays retired rather than released.
      slug: fees.event.slug,
      deletedSlug: null,
    })

    for (const { order } of sold) {
      expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
        status: 'REFUNDED',
        refundedCents: order.totalCents,
        refundPendingCents: 0,
      })
    }

    // The provider paid each one back in full.
    for (const { payment, order } of sold) {
      expect(payments.getStatus(payment.providerRef).refundedAmountCents).toBe(order.totalCents)
    }

    expect(
      await prisma.ticket.count({
        where: { status: 'VALID', orderItem: { order: { eventId: fees.event.id } } },
      }),
    ).toBe(0)
    expect(
      await prisma.refund.count({
        where: { order: { eventId: fees.event.id }, status: 'SUCCEEDED' },
      }),
    ).toBe(2)

    const cancelledAudit = await prisma.auditLog.findFirst({
      where: { action: 'event.cancelled', entityId: fees.event.id },
    })
    const deletedAudit = await prisma.auditLog.findFirst({
      where: { action: 'event.deleted', entityId: fees.event.id },
    })

    expect(cancelledAudit.metadata).toMatchObject({ from: 'ON_SALE', via: 'event_deletion' })
    expect(deletedAudit.metadata).toMatchObject({
      from: 'CANCELLED',
      cancelledFrom: 'ON_SALE',
      outcome: 'CANCEL_AND_REFUND',
      authority: 'ORGANIZATION',
      slugReleased: false,
    })
    expect(
      await prisma.eventChangeNotice.count({ where: { eventId: fees.event.id, kind: 'DELETED' } }),
    ).toBe(1)

    // Nothing is left to send.
    const finish = await app.inject({
      method: 'POST',
      url: `/v1/events/${fees.event.id}/refunds/finish`,
      headers: fees.headers,
    })

    expect(finish.statusCode).toBe(409)
    expect(finish.json().error.code).toBe('NOTHING_OWED')
  })

  it('cancels one night and refunds its orders in full, leaving the other night’s', async () => {
    const fees = await feeWorld('night')
    const later = new Date(fees.session.startsAt.getTime() + 86_400_000)
    const second = await prisma.eventSession.create({
      data: {
        eventId: fees.event.id,
        startsAt: later,
        endsAt: new Date(later.getTime() + 4 * 3_600_000),
        timezone: 'America/Chicago',
        capacity: 500,
      },
    })
    const secondTier = await prisma.ticketType.create({
      data: {
        eventId: fees.event.id,
        eventSessionId: second.id,
        name: `Second night ${RUN}`,
        priceCents: 3_000,
        currency: 'USD',
        quantityTotal: 50,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })
    const first = [await feeOrder(fees), await feeOrder(fees, { withPromo: false })]
    const kept = await feeOrder(
      { ...fees, session: second },
      {
        withPromo: false,
        lines: [{ ticketTypeId: secondTier.id, quantity: 1, unitPriceCents: 3_000 }],
      },
    )

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fees.event.id}/sessions/${fees.session.id}/cancellation`,
      headers: fees.headers,
    })

    expect(preview.statusCode).toBe(200)
    expect(preview.json().data).toMatchObject({ permitted: true, refusal: null, ordersRefunded: 2 })

    const cancelled = await cancelNight(fees.event.id, fees.session.id, 2, {
      headers: fees.headers,
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    expect(await prisma.eventSession.findUnique({ where: { id: fees.session.id } })).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'The band could not travel that night.',
    })

    for (const { order } of first) {
      expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
        status: 'REFUNDED',
        refundedCents: order.totalCents,
        refundPendingCents: 0,
      })
    }

    expect(await prisma.order.findUnique({ where: { id: kept.order.id } })).toMatchObject({
      status: 'PAID',
      refundedCents: 0,
    })
    expect((await eventRow(fees.event.id)).status).toBe('ON_SALE')
    expect(
      await prisma.ticketType.count({
        where: { eventSessionId: fees.session.id, status: { not: 'CLOSED' } },
      }),
    ).toBe(0)
    expect(
      await prisma.notificationOutbox.count({
        where: {
          template: 'event.session_cancelled',
          dedupeKey: { startsWith: `session-cancelled:${fees.session.id}:` },
        },
      }),
    ).toBe(2)
    expect(
      await prisma.eventChangeNotice.count({
        where: {
          eventId: fees.event.id,
          kind: 'SESSION_CANCELLED',
          eventSessionId: fees.session.id,
        },
      }),
    ).toBe(1)
  })

  it('refunds a mixed order’s tickets for the cancelled night with their share of the fee and tax (R6)', async () => {
    const fees = await feeWorld('mixed')
    const later = new Date(fees.session.startsAt.getTime() + 86_400_000)
    const second = await prisma.eventSession.create({
      data: {
        eventId: fees.event.id,
        startsAt: later,
        endsAt: new Date(later.getTime() + 4 * 3_600_000),
        timezone: 'America/Chicago',
        capacity: 500,
      },
    })
    const secondTier = await prisma.ticketType.create({
      data: {
        eventId: fees.event.id,
        eventSessionId: second.id,
        name: `Second night mixed ${RUN}`,
        priceCents: 3_000,
        currency: 'USD',
        quantityTotal: 50,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })
    // Two floor tickets for the first night and one for the second, with the
    // 50 % promo code, the flat fee and 8.25 % tax.
    const mixed = await feeOrder(fees, {
      lines: [
        { ticketTypeId: fees.tiers.floor.id, quantity: 2, unitPriceCents: 5_000 },
        { ticketTypeId: secondTier.id, quantity: 1, unitPriceCents: 3_000 },
      ],
    })
    const order = mixed.order

    expect(order.discountCents).toBeGreaterThan(0)
    expect(order.feesCents).toBeGreaterThan(0)
    expect(order.taxCents).toBeGreaterThan(0)

    const nightLine = order.items.find((item) => item.ticketTypeId === secondTier.id)
    const netFace = order.subtotalCents - order.discountCents
    // The night's ticket net of its share of the discount, and its share of
    // the fee and the tax, floored (REFUNDS_DISPUTES.md, R6).
    const face =
      nightLine.subtotalCents -
      Math.round((order.discountCents * nightLine.subtotalCents) / order.subtotalCents)
    const expected = {
      faceValueCents: face,
      feeCents: Math.floor((order.feesCents * face) / netFace),
      taxCents: Math.floor((order.taxCents * face) / netFace),
    }
    const expectedCents = expected.faceValueCents + expected.feeCents + expected.taxCents

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fees.event.id}/sessions/${second.id}/cancellation`,
      headers: fees.headers,
    })

    expect(preview.statusCode).toBe(200)
    expect(preview.json().data).toMatchObject({
      refusal: null,
      orders: 1,
      ordersRefunded: 1,
      refundableCents: expectedCents,
      currency: 'USD',
    })

    const cancelled = await cancelNight(fees.event.id, second.id, preview.json().data.orders, {
      headers: fees.headers,
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)
    expect(cancelled.json().data.refunds).toMatchObject({
      owed: 1,
      settled: 1,
      amountCents: expectedCents,
    })

    const refund = await prisma.refund.findFirst({
      where: { orderId: order.id },
      include: { items: true },
    })

    expect(refund).toMatchObject({
      status: 'SUCCEEDED',
      reason: 'EVENT_CANCELLED',
      idempotencyKey: `session-cancelled:${second.id}:${order.id}`,
      amountCents: expectedCents,
    })
    expect(refund.allocation).toMatchObject({ ...expected, form: 'lines' })
    expect(refund.items).toEqual([
      expect.objectContaining({ orderItemId: nightLine.id, quantity: 1 }),
    ])

    // The order keeps its first night: paid, the second night's part refunded.
    const after = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    })

    expect(after).toMatchObject({
      status: 'PAID',
      refundedCents: expectedCents,
      refundPendingCents: 0,
    })
    expect(after.items.find((item) => item.id === nightLine.id)).toMatchObject({
      refundedCents: face,
      refundedQuantity: 1,
    })
    expect(after.items.find((item) => item.id !== nightLine.id).refundedCents).toBe(0)

    const tickets = await prisma.ticket.findMany({
      where: { orderItemId: { in: after.items.map((item) => item.id) } },
    })

    expect(
      tickets.filter((ticket) => ticket.orderItemId === nightLine.id).map((t) => t.status),
    ).toEqual(['REFUNDED'])
    expect(
      tickets.filter((ticket) => ticket.orderItemId !== nightLine.id).map((t) => t.status),
    ).toEqual(['VALID', 'VALID'])

    // The provider paid back exactly that.
    expect(payments.getStatus(mixed.payment.providerRef).refundedAmountCents).toBe(expectedCents)

    const notice = await prisma.notificationOutbox.findFirst({
      where: { dedupeKey: `session-cancelled:${second.id}:${order.id}` },
    })

    expect(notice.payload).toMatchObject({ outcome: 'REFUNDED', refunded: true })
  })

  it('cancels a night on an order a sum refund already paid back in part, refunding what is left (XR-1)', async () => {
    const fees = await feeWorld('partial')
    const { second, tier } = await secondNight(fees, 3_000, 'partial')
    // Two floor tickets for the first night and one for the second, with the
    // 50 % promo code, the fee and 8.25 % tax.
    const mixed = await feeOrder(fees, {
      lines: [
        { ticketTypeId: fees.tiers.floor.id, quantity: 2, unitPriceCents: 5_000 },
        { ticketTypeId: tier.id, quantity: 1, unitPriceCents: 3_000 },
      ],
    })
    const order = mixed.order
    const nightLine = order.items.find((item) => item.ticketTypeId === tier.id)
    const firstLine = order.items.find((item) => item.ticketTypeId !== tier.id)

    // Finance gives a sum back as goodwill (the amount form). It pays for one
    // first-night ticket and part of the rest, and settles.
    const goodwill = await prisma.$transaction((tx) =>
      requestRefund(tx, {
        order,
        payment: mixed.payment,
        amountCents: 6_000,
        reason: 'ORGANIZER_GOODWILL',
        idempotencyKey: `goodwill-${RUN}`,
        actorId: null,
        now: new Date(),
      }),
    )

    await prisma.$transaction(async (tx) =>
      approveRefund(tx, {
        refund: goodwill.refund,
        order: await tx.order.findUnique({ where: { id: order.id } }),
        actorId: null,
        now: new Date(),
      }),
    )

    const sent = await submitRefund(prisma, providers, {
      refund: await prisma.refund.findUnique({ where: { id: goodwill.refund.id } }),
      order: await prisma.order.findUnique({ where: { id: order.id } }),
      payment: mixed.payment,
      organizationId: fees.organization.id,
      eventStartsAt: fees.event.startsAt,
      seatPolicy: SEAT_POLICIES.WITHHOLD,
      actorId: null,
      requestId: null,
    })

    expect(sent.outcome).toBe('SUCCEEDED')

    const settled = await prisma.refund.findUnique({ where: { id: goodwill.refund.id } })
    const netFace = order.subtotalCents - order.discountCents
    const faceLeft = netFace - settled.allocation.faceValueCents
    // The night's ticket costs more face value than the order has left: the
    // goodwill sum paid part of it back without withdrawing it.
    const nightFace =
      nightLine.subtotalCents -
      Math.round((order.discountCents * nightLine.subtotalCents) / order.subtotalCents)

    expect(nightFace).toBeGreaterThan(faceLeft)

    const left = order.totalCents - 6_000
    const preview = await nightPreview(fees, second.id)

    expect(preview.statusCode).toBe(200)
    expect(preview.json().data).toMatchObject({
      permitted: true,
      refusal: null,
      orders: 1,
      ordersRefunded: 1,
      ticketsWithdrawn: 1,
      refundableCents: left,
    })

    const cancelled = await cancelNight(fees.event.id, second.id, 1, { headers: fees.headers })

    expect(cancelled.statusCode, cancelled.body).toBe(200)
    expect(cancelled.json().data.refunds).toMatchObject({ owed: 1, settled: 1, amountCents: left })

    const refund = await prisma.refund.findUnique({
      where: { idempotencyKey: `session-cancelled:${second.id}:${order.id}` },
      include: { items: true },
    })

    expect(refund).toMatchObject({ status: 'SUCCEEDED', amountCents: left })
    // The night's ticket for what is left of its face value, its share of the
    // fee and the tax, and nothing of the first night.
    expect(refund.allocation).toMatchObject({ form: 'lines', faceValueCents: faceLeft })
    expect(refund.items).toEqual([
      expect.objectContaining({ orderItemId: nightLine.id, quantity: 1, amountCents: faceLeft }),
    ])

    const after = await prisma.order.findUnique({ where: { id: order.id } })

    // Every cent is back, and the first night's other ticket still admits, so
    // the order stays PAID: the door refuses every ticket of an order that is not.
    expect(after).toMatchObject({
      status: 'PAID',
      refundedCents: order.totalCents,
      refundPendingCents: 0,
    })
    expect((await ticketsOf(nightLine.id)).map((ticket) => ticket.status)).toEqual(['REFUNDED'])

    const firstNight = await ticketsOf(firstLine.id)

    expect(firstNight.map((ticket) => ticket.status).sort()).toEqual(['REFUNDED', 'VALID'])
    expect(await doorAnswer(firstNight.find((ticket) => ticket.status === 'VALID').id)).toBeNull()
    expect(payments.getStatus(mixed.payment.providerRef).refundedAmountCents).toBe(order.totalCents)
  })

  it('keeps the same order’s free ticket for another night when one night is cancelled (XR-2)', async () => {
    const fees = await feeWorld('freeother')
    const { second, tier } = await secondNight(fees, 0, 'free')
    const mixed = await feeOrder(fees, {
      withPromo: false,
      lines: [
        { ticketTypeId: fees.tiers.floor.id, quantity: 1, unitPriceCents: 5_000 },
        { ticketTypeId: tier.id, quantity: 1, unitPriceCents: 0 },
      ],
    })
    const order = mixed.order
    const paidLine = order.items.find((item) => item.ticketTypeId !== tier.id)
    const freeLine = order.items.find((item) => item.ticketTypeId === tier.id)

    const preview = await nightPreview(fees, fees.session.id)

    // The free ticket carries no fee, so the first night's ticket comes to
    // everything the order paid.
    expect(preview.json().data).toMatchObject({
      orders: 1,
      ordersRefunded: 1,
      ticketsWithdrawn: 1,
      refundableCents: order.totalCents,
    })

    const cancelled = await cancelNight(fees.event.id, fees.session.id, 1, {
      headers: fees.headers,
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const refund = await prisma.refund.findUnique({
      where: { idempotencyKey: `session-cancelled:${fees.session.id}:${order.id}` },
      include: { items: true },
    })

    // Not promoted to a refund of everything: only the night's line.
    expect(refund).toMatchObject({ status: 'SUCCEEDED', amountCents: order.totalCents })
    expect(refund.allocation).toMatchObject({ form: 'lines', whole: false })
    expect(refund.items).toEqual([
      expect.objectContaining({ orderItemId: paidLine.id, quantity: 1 }),
    ])

    const [kept] = await ticketsOf(freeLine.id)

    expect(kept).toMatchObject({ status: 'VALID', revokedReason: null })
    expect(kept.credentialHash).not.toBeNull()
    expect(await doorAnswer(kept.id)).toBeNull()
    expect((await ticketsOf(paidLine.id)).map((ticket) => ticket.status)).toEqual(['REFUNDED'])
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      status: 'PAID',
      refundedCents: order.totalCents,
      refundPendingCents: 0,
    })
    expect((await prisma.eventSession.findUnique({ where: { id: second.id } })).status).toBe(
      'SCHEDULED',
    )
  })

  it('keeps the same order’s free every-night pass when one night is cancelled (XR-2, night-cancellation-passes)', async () => {
    const fees = await feeWorld('freepass')
    const { second } = await secondNight(fees, 4_000, 'pass')
    const pass = await prisma.ticketType.create({
      data: {
        eventId: fees.event.id,
        eventSessionId: null,
        name: `Kids pass ${RUN}`,
        priceCents: 0,
        currency: 'USD',
        quantityTotal: 50,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })
    const mixed = await feeOrder(fees, {
      withPromo: false,
      lines: [
        { ticketTypeId: fees.tiers.floor.id, quantity: 1, unitPriceCents: 5_000 },
        { ticketTypeId: pass.id, quantity: 1, unitPriceCents: 0 },
      ],
    })
    const order = mixed.order
    const passLine = order.items.find((item) => item.ticketTypeId === pass.id)

    const preview = await nightPreview(fees, fees.session.id)

    expect(preview.json().data).toMatchObject({ orders: 1, ordersRefunded: 1, ticketsWithdrawn: 1 })

    const cancelled = await cancelNight(fees.event.id, fees.session.id, 1, {
      headers: fees.headers,
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const refund = await prisma.refund.findUnique({
      where: { idempotencyKey: `session-cancelled:${fees.session.id}:${order.id}` },
      include: { items: true },
    })

    expect(refund.allocation).toMatchObject({ form: 'lines', whole: false })
    expect(refund.items.map((item) => item.orderItemId)).not.toContain(passLine.id)

    const [kept] = await ticketsOf(passLine.id)

    expect(kept).toMatchObject({ status: 'VALID', revokedReason: null })
    expect(await doorAnswer(kept.id)).toBeNull()
    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('PAID')
    expect((await prisma.eventSession.findUnique({ where: { id: second.id } })).status).toBe(
      'SCHEDULED',
    )
  })

  it('refunds the night’s other ticket when a refund of the same line settles mid-cancellation (XR-3)', async () => {
    const fees = await feeWorld('nightrace')
    const { second, tier } = await secondNight(fees, 3_000, 'race')
    const mixed = await feeOrder(fees, {
      withPromo: false,
      lines: [
        { ticketTypeId: fees.tiers.floor.id, quantity: 1, unitPriceCents: 5_000 },
        { ticketTypeId: tier.id, quantity: 2, unitPriceCents: 3_000 },
      ],
    })
    const order = mixed.order
    const nightLine = order.items.find((item) => item.ticketTypeId === tier.id)

    // Finance refunds one of the two second-night tickets; it is with the provider.
    const asked = await prisma.$transaction((tx) =>
      requestRefund(tx, {
        order,
        payment: mixed.payment,
        lines: [{ orderItemId: nightLine.id, quantity: 1 }],
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: `customer-${RUN}`,
        now: new Date(),
      }),
    )

    await prisma.$transaction((tx) =>
      approveRefund(tx, { refund: asked.refund, order, actorId: null, now: new Date() }),
    )
    await prisma.$transaction(async (tx) =>
      markSubmitted(tx, {
        refund: await tx.refund.findUnique({ where: { id: asked.refund.id } }),
        now: new Date(),
      }),
    )

    const submitted = await prisma.refund.findUnique({ where: { id: asked.refund.id } })
    const preview = await nightPreview(fees, second.id)

    expect(preview.json().data).toMatchObject({ orders: 1, ordersRefunded: 1 })

    // The provider answers for finance's refund now, and it settles — in a
    // transaction held open until the cancellation, having read the night's
    // orders while the refund was still in flight, waits for the order. Since
    // SPEC3-XI §2.3.1 a night's cancellation locks every paid order it
    // refunds right after reading them, before it touches a hold or a ticket,
    // so this is where a refund settling mid-cancellation now meets it: the
    // cancellation waits for the settlement's commit, then decides again
    // from what it left.
    let letGo
    const gate = new Promise((resolve) => {
      letGo = resolve
    })
    let settledInside
    const inside = new Promise((resolve, reject) => {
      settledInside = { resolve, reject }
    })
    const settling = prisma.$transaction(
      async (tx) => {
        const result = await settleRefund(tx, {
          refund: submitted,
          order,
          result: { providerRefundId: `re_race_${RUN}`, rawStatus: 'succeeded' },
          organizationId: fees.organization.id,
          seatPolicy: SEAT_POLICIES.WITHHOLD,
          now: new Date(),
        })
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

        settledInside.resolve(Number(pid))
        await gate

        return result
      },
      { timeout: 60_000, maxWait: 10_000 },
    )

    settling.catch((error) => settledInside.reject(error))

    const settlerPid = await inside
    const cancelling = cancelNight(fees.event.id, second.id, 1, { headers: fees.headers })

    await untilWaiting(prisma, () => [settlerPid], 1, 'the cancellation')

    letGo()

    const finished = await settling

    expect(finished.settled).toBe(true)

    const cancelled = await cancelling

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const nightRefunds = await prisma.refund.findMany({
      where: { idempotencyKey: `session-cancelled:${second.id}:${order.id}` },
      include: { items: true },
    })

    // The night's other ticket: asked for, settled, and never left withdrawn
    // without its money.
    expect(nightRefunds).toHaveLength(1)
    expect(nightRefunds[0]).toMatchObject({ status: 'SUCCEEDED' })
    expect(nightRefunds[0].items).toEqual([
      expect.objectContaining({ orderItemId: nightLine.id, quantity: 1 }),
    ])
    expect((await ticketsOf(nightLine.id)).map((ticket) => ticket.status)).toEqual([
      'REFUNDED',
      'REFUNDED',
    ])

    const after = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    })

    expect(after.refundPendingCents).toBe(0)
    expect(after.items.find((item) => item.id === nightLine.id)).toMatchObject({
      refundedQuantity: 2,
      refundedCents: nightLine.subtotalCents,
    })

    const notice = await prisma.notificationOutbox.findFirst({
      where: { dedupeKey: `session-cancelled:${second.id}:${order.id}` },
    })

    expect(notice.payload).toMatchObject({ outcome: 'REFUNDED', refunded: true })
  })

  it('lists the event to the team at The Desi Events with its paid orders counted by one grouped count', async () => {
    const fees = await feeWorld('listed')

    await feeOrder(fees)
    await feeOrder(fees, { withPromo: false })

    const search = encodeURIComponent(fees.event.slug)
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/platform/events?q=${search}&imported=exclude`,
      headers: world.administrator.headers,
    })

    expect(listed.statusCode, listed.body).toBe(200)
    expect(listed.json().data).toEqual([
      expect.objectContaining({
        id: fees.event.id,
        paidOrders: 2,
        picturesWaiting: 0,
        imported: false,
      }),
    ])

    const onlyImported = await app.inject({
      method: 'GET',
      url: `/v1/platform/events?q=${search}&imported=only`,
      headers: world.administrator.headers,
    })

    expect(onlyImported.statusCode, onlyImported.body).toBe(200)
    expect(onlyImported.json().data).toEqual([])
  })

  it('deletes a cancelled event whose refund finance withdrew, and refunds that order in full', async () => {
    const fees = await feeWorld('cancelled')
    const sold = [await feeOrder(fees), await feeOrder(fees)]

    const called = await app.inject({
      method: 'POST',
      url: `/v1/events/${fees.event.id}/cancel`,
      headers: fees.headers,
      payload: { reasonCode: 'VENUE_UNAVAILABLE', reason: 'The venue flooded this week.' },
    })

    expect(called.statusCode, called.body).toBe(200)

    // Finance withdrew the cancellation's refund of the first order, giving
    // its reservation back: the order is paid, with everything left.
    const withdrawn = await prisma.refund.findFirst({ where: { orderId: sold[0].order.id } })

    await prisma.$transaction(async (tx) =>
      cancelRefund(tx, {
        refund: withdrawn,
        order: await tx.order.findUnique({ where: { id: sold[0].order.id } }),
        reason: 'Withdrawn by finance for the test',
        actorId: null,
        now: new Date(),
      }),
    )

    expect(await prisma.order.findUnique({ where: { id: sold[0].order.id } })).toMatchObject({
      status: 'PAID',
      refundPendingCents: 0,
      refundedCents: 0,
    })

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fees.event.id}/deletion`,
      headers: fees.headers,
    })

    expect(preview.json().data).toMatchObject({
      outcome: 'CANCEL_AND_REFUND',
      counts: { paidOrders: 2 },
    })

    const deleted = await deleteEvent(fees.event.id, 'CANCEL_AND_REFUND', { headers: fees.headers })

    expect(deleted.statusCode, deleted.body).toBe(200)
    expect(deleted.json().data.refunds).toMatchObject({ owed: 2, settled: 2, failed: 0 })

    for (const { order, payment } of sold) {
      expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
        status: 'REFUNDED',
        refundedCents: order.totalCents,
        refundPendingCents: 0,
      })
      expect(payments.getStatus(payment.providerRef).refundedAmountCents).toBe(order.totalCents)
    }

    expect(
      (
        await prisma.refund.findMany({
          where: { orderId: sold[0].order.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => [row.idempotencyKey, row.status]),
    ).toEqual([
      [`event-cancelled:${fees.event.id}:${sold[0].order.id}`, 'CANCELLED'],
      [`event-cancelled:${fees.event.id}:${sold[0].order.id}:d1`, 'SUCCEEDED'],
    ])
    expect(
      (
        await prisma.auditLog.findFirst({
          where: { action: 'event.deleted', entityId: fees.event.id },
        })
      ).metadata.counts.refundsReserved,
    ).toBe(1)
  })
})

when()('a deleted event, afterwards', () => {
  it('is restored by the team at The Desi Events through both triggers, an on-sale one paused', async () => {
    const { event } = await posted('restore')

    expect((await deleteEvent(event.id, 'REMOVE')).statusCode).toBe(200)

    const deleted = await eventRow(event.id)
    const restored = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${event.id}/restore`,
      headers: world.administrator.headers,
      payload: {
        revision: deleted.revision,
        reason: 'Deleted by mistake; the organiser asked for it back.',
      },
    })

    expect(restored.statusCode, restored.body).toBe(200)
    expect(restored.json().data.status).toBe('SALES_PAUSED')
    expect(await eventRow(event.id)).toMatchObject({ status: 'SALES_PAUSED', ...CLEARED })

    // A draft that was never public had its address released, and gets it back.
    const draft = await posted('restore-draft', { status: 'DRAFT' })

    expect((await deleteEvent(draft.event.id, 'REMOVE')).statusCode).toBe(200)

    const released = await eventRow(draft.event.id)

    expect(released).toMatchObject({
      slug: `deleted-${draft.event.id}`,
      deletedSlug: draft.event.slug,
    })

    const back = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${draft.event.id}/restore`,
      headers: world.administrator.headers,
      payload: {
        revision: released.revision,
        reason: 'Deleted by mistake; the organiser asked for it back.',
      },
    })

    expect(back.statusCode, back.body).toBe(200)
    expect(back.json().data).toMatchObject({ status: 'DRAFT', slug: draft.event.slug })
  })

  it('stays on the organiser’s analytics list, marked deleted, and off events.list unless asked for (O8)', async () => {
    const home = await organisation('listed')
    const live = await posted('listed-live', { home })
    const gone = await posted('listed-gone', { home })

    expect((await deleteEvent(gone.event.id, 'REMOVE', { headers: home.headers })).statusCode).toBe(
      200,
    )

    const summary = await trafficSummary(prisma, {
      organizationId: home.organization.id,
      now: new Date(),
    })
    const rows = new Map(summary.byEvent.map((row) => [row.eventId, row]))

    expect(rows.get(gone.event.id)).toMatchObject({ status: 'DELETED', deleted: true })
    expect(rows.get(live.event.id)).toMatchObject({ status: 'ON_SALE', deleted: false })

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/events?organizationId=${home.organization.id}`,
      headers: home.headers,
    })
    const asked = await app.inject({
      method: 'GET',
      url: `/v1/events?organizationId=${home.organization.id}&status=DELETED`,
      headers: home.headers,
    })

    expect(listed.statusCode).toBe(200)
    expect(listed.json().data.map((row) => row.id)).toEqual([live.event.id])
    expect(asked.json().data.map((row) => row.id)).toEqual([gone.event.id])

    // A stranger never sees it, asked for or not.
    const stranger = await app.inject({
      method: 'GET',
      url: `/v1/events?organizationId=${home.organization.id}&status=DELETED`,
      headers: world.buyer.headers,
    })

    expect(stranger.json().data ?? []).toEqual([])
  })
})
