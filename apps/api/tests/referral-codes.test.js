/**
 * Referral codes, against the stub (SPEC3 §8, §14.2; SPEC3-XI §8.4, §14.2):
 * making, changing and switching them, who may, what the lists and reports
 * say — uses placed, given back and counting now — and that a code's text and
 * label never reach an audit row.
 *
 * Every code's text here is generated at run time (`generatedReferralText`),
 * never a literal in the repository.
 *
 * @module @desi-event/api/tests/referral-codes
 */

import { describe, expect, it } from 'vitest'

import { referralCodeDetailResponseSchema } from '@desi-event/schemas'
import {
  REFERRAL_RETURN_CAUSES,
  listReferralCodesQuerySchema,
} from '@desi-event/schemas/payment-terms'

import {
  GENERATION_ATTEMPTS,
  evaluateReferral,
  generateReferralCode,
  listReferralCodes,
  referralCodeDetail,
  referralStatus,
  toReferralUse,
} from '../src/lib/referral-codes.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { generatedReferralText, referralCodeFixture } from './helpers/fee-orders.js'
import { addRows, makeWorld, paymentTermsAccountsFixture } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** A reason inside the 10-500 character bounds. */
const REASON = 'Handed out at the community fair.'

/**
 * Sign in and confirm a second factor.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @returns {Promise<object>} The request headers.
 */
async function as(app, email) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * Make a code through the route.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @param {object} body The body.
 * @returns {Promise<object>} The response.
 */
function create(app, headers, body) {
  return app.inject({ method: 'POST', url: '/v1/platform/referral-codes', headers, payload: body })
}

/**
 * Change a code through the route.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @param {string} id The code.
 * @param {object} body The body.
 * @returns {Promise<object>} The response.
 */
function update(app, headers, id, body) {
  return app.inject({
    method: 'PATCH',
    url: `/v1/platform/referral-codes/${id}`,
    headers,
    payload: body,
  })
}

/**
 * Switch a code on or off through the route.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @param {string} id The code.
 * @param {'on'|'off'} to Which way.
 * @param {object} [body] The body (switching off only).
 * @returns {Promise<object>} The response.
 */
function switchCode(app, headers, id, to, body = {}) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/referral-codes/${id}/switch-${to}`,
    headers,
    ...(to === 'off' ? { payload: body } : {}),
  })
}

/**
 * Read through a GET route.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @param {string} url The path and query.
 * @returns {Promise<object>} The response.
 */
function read(app, headers, url) {
  return app.inject({ method: 'GET', url, headers })
}

/**
 * A world with SPEC3's accounts and a SUPPORT account.
 *
 * @returns {Promise<{seed: object, ids: object}>} The world.
 */
async function world() {
  const built = await makeWorld()

  addRows(built.seed, paymentTermsAccountsFixture(built.ids).rows)
  addRows(built.seed, {
    user: [
      {
        id: cuid(),
        email: 'sunil-support@desi-event.example',
        passwordHash: built.ids.attendee.passwordHash,
        displayName: 'Sunil Support',
        phone: null,
        locale: 'en-IN',
        role: 'SUPPORT',
        emailVerified: true,
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
      },
    ],
  })

  return built
}

/** Numbers the orders {@link orderNaming} writes. */
let orderSequence = 0

/**
 * An order naming a code, written straight into the stub as checkout and the
 * returner would leave it.
 *
 * @param {object} prisma The stub.
 * @param {object} ids World ids.
 * @param {object} code The code row.
 * @param {object} [options] Options.
 * @param {string} [options.status] The order's status.
 * @param {number} [options.waived] The fee waived.
 * @param {string|null} [options.returnCause] When set, the use was given back with this cause.
 * @param {string} [options.currency] The order's currency.
 * @returns {Promise<object>} The order.
 */
async function orderNaming(
  prisma,
  ids,
  code,
  { status = 'PAID', waived = 335, returnCause = null, currency = 'INR' } = {},
) {
  return prisma.order.create({
    data: {
      reference: `DE-REF${(orderSequence += 1)}`,
      eventId: ids.publishedEvent.id,
      userId: ids.attendee.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      status,
      currency,
      subtotalCents: 4_000,
      discountCents: 0,
      feesCents: 0,
      taxCents: 0,
      totalCents: 4_000,
      feeGrossCents: waived,
      feeWaivedCents: waived,
      referralCodeId: code.id,
      referralUseReturnedAt: returnCause ? new Date('2026-10-09T12:00:00.000Z') : null,
      referralUseReturnCause: returnCause,
    },
  })
}

describe('who manages referral codes', () => {
  it('lets ADMIN and SUPER_ADMIN, and refuses everybody else with 403', async () => {
    const { seed, ids } = await world()
    const { app } = await createTestApp({ seed, ids })

    for (const email of ['anil@desi-event.example', 'ops@desi-event.example']) {
      const headers = await as(app, email)

      expect((await read(app, headers, '/v1/platform/referral-codes')).statusCode, email).toBe(200)
      expect(
        (await create(app, headers, { generate: true, scope: 'ALL_EVENTS' })).statusCode,
        email,
      ).toBe(201)
    }

    for (const email of [
      'maya@desi-event.example',
      'farah-finance@desi-event.example',
      'sunil-support@desi-event.example',
      'owner@rangoli.example',
      'priya@example.com',
    ]) {
      const headers = bearer(await signIn(app, email))

      for (const response of [
        await read(app, headers, '/v1/platform/referral-codes'),
        await read(app, headers, '/v1/platform/referral-codes/by-administrator'),
        await create(app, headers, { generate: true, scope: 'ALL_EVENTS' }),
      ]) {
        expect(response.statusCode, email).toBe(403)
      }
    }

    await app.close()
  })

  it('asks for the PAYMENT_TERMS step-up to make, change and switch on, and none to switch off', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))
    const { row } = await referralCodeFixture(prisma, {
      createdById: ids.platformAdministrator.id,
      active: false,
    })

    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 11 * 60_000)
    }

    for (const response of [
      await create(app, headers, { generate: true, scope: 'ALL_EVENTS' }),
      await update(app, headers, row.id, {
        label: 'x',
        expectedUpdatedAt: row.updatedAt.toISOString(),
      }),
      await switchCode(app, headers, row.id, 'on'),
    ]) {
      expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    }

    // Switching off only takes away; it needs no second factor.
    expect((await switchCode(app, headers, row.id, 'off')).statusCode).toBe(200)

    await app.close()
  })
})

describe('making a code', () => {
  it('makes a typed code, normalised, and answers it as referralCode, never code', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const typed = generatedReferralText()

    const made = await create(app, headers, {
      referralCode: `  ${typed.toLowerCase()} `,
      label: 'Fair stall',
      scope: 'ALL_EVENTS',
      maxUses: 25,
    })

    expect(made.statusCode).toBe(201)
    expect(made.headers['cache-control']).toBe('no-store, private')

    const { data } = made.json()

    expect(data).toMatchObject({
      referralCode: typed,
      label: 'Fair stall',
      scope: 'ALL_EVENTS',
      events: [],
      eventCount: 0,
      maxUses: 25,
      useCount: 0,
      usesPlaced: 0,
      usesReturned: 0,
      waived: [],
      status: 'ON',
      active: true,
      createdBy: { id: ids.platformAdministrator.id, displayName: 'Anil Administrator' },
    })
    expect(data).not.toHaveProperty('code')
    expect(prisma._store.referralCode[0].code).toBe(typed)

    await app.close()
  })

  it('generates a code from the alphabet without look-alikes', async () => {
    const { app, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')

    const made = await create(app, headers, {
      generate: true,
      scope: 'SELECTED_EVENTS',
      eventIds: [ids.publishedEvent.id, ids.draftEvent.id],
    })

    expect(made.statusCode).toBe(201)
    expect(made.json().data.referralCode).toMatch(/^[A-HJ-KMNP-Z2-9]{5}-[A-HJ-KMNP-Z2-9]{5}$/u)
    expect(made.json().data.eventCount).toBe(2)
    expect(
      made
        .json()
        .data.events.map((event) => event.id)
        .sort(),
    ).toEqual([ids.publishedEvent.id, ids.draftEvent.id].sort())

    for (let index = 0; index < 50; index += 1) {
      expect(generateReferralCode()).toMatch(/^[A-HJ-KMNP-Z2-9]{5}-[A-HJ-KMNP-Z2-9]{5}$/u)
    }

    await app.close()
  })

  it('refuses a typed code another code has with REFERRAL_CODE_TAKEN', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const { referralCode } = await referralCodeFixture(prisma, {
      createdById: ids.platformAdministrator.id,
    })

    const clash = await create(app, headers, { referralCode, scope: 'ALL_EVENTS' })

    expect(clash.statusCode).toBe(409)
    expect(clash.json().error).toMatchObject({
      code: 'REFERRAL_CODE_TAKEN',
      message: 'That code is already in use. Choose another, or generate one.',
    })
    expect(prisma._store.referralCode).toHaveLength(1)

    await app.close()
  })

  it('draws a generated code again on a clash, at most five times, then answers 503 TRY_AGAIN', async () => {
    expect(GENERATION_ATTEMPTS).toBe(5)

    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const create = prisma.referralCode.create.bind(prisma.referralCode)
    let attempts = 0

    // Every insert clashes, as the unique index would answer.
    prisma.referralCode.create = async () => {
      attempts += 1

      throw Object.assign(new Error('Unique constraint failed on the fields: (`code`)'), {
        code: 'P2002',
      })
    }

    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform/referral-codes',
      headers,
      payload: { generate: true, scope: 'ALL_EVENTS' },
    })

    prisma.referralCode.create = create

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('TRY_AGAIN')
    expect(attempts).toBe(5)
    expect(ids.platformAdministrator.id).toBeTruthy()

    await app.close()
  })

  it('checks the scope: events only for SELECTED_EVENTS, 1 to 50, never a deleted or unknown one', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')

    expect(
      (await create(app, headers, { generate: true, scope: 'SELECTED_EVENTS' })).statusCode,
    ).toBe(400)
    expect(
      (
        await create(app, headers, {
          generate: true,
          scope: 'ALL_EVENTS',
          eventIds: [ids.publishedEvent.id],
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await create(app, headers, {
          referralCode: generatedReferralText(),
          generate: true,
          scope: 'ALL_EVENTS',
        })
      ).statusCode,
    ).toBe(400)

    prisma._store.event.find((row) => row.id === ids.draftEvent.id).status = 'DELETED'

    const unknown = cuid()
    const refused = await create(app, headers, {
      generate: true,
      scope: 'SELECTED_EVENTS',
      eventIds: [ids.publishedEvent.id, ids.draftEvent.id, unknown],
    })

    expect(refused.statusCode).toBe(422)
    expect(refused.json().error.code).toBe('REFERRAL_EVENT_NOT_ELIGIBLE')
    expect(refused.json().error.details.eventIds.sort()).toEqual(
      [ids.draftEvent.id, unknown].sort(),
    )
    expect(prisma._store.referralCode).toHaveLength(0)
    expect(prisma._store.referralCodeEvent).toHaveLength(0)

    const past = await create(app, headers, {
      generate: true,
      scope: 'ALL_EVENTS',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })

    expect(past.statusCode).toBe(422)

    await app.close()
  })
})

describe('changing a code', () => {
  it('changes label, scope, expiry and limit; never the text; refuses a stale read', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const made = (await create(app, headers, { generate: true, scope: 'ALL_EVENTS' })).json().data
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString()

    const changed = await update(app, headers, made.id, {
      label: 'Radio giveaway',
      scope: 'SELECTED_EVENTS',
      eventIds: [ids.publishedEvent.id],
      expiresAt,
      maxUses: 10,
      expectedUpdatedAt: made.updatedAt,
    })

    expect(changed.statusCode).toBe(200)
    expect(changed.json().data).toMatchObject({
      referralCode: made.referralCode,
      label: 'Radio giveaway',
      scope: 'SELECTED_EVENTS',
      eventCount: 1,
      expiresAt,
      maxUses: 10,
    })

    const stale = await update(app, headers, made.id, {
      label: 'Again',
      expectedUpdatedAt: made.updatedAt,
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('REFERRAL_CODE_CHANGED')

    expect(
      (
        await update(app, headers, made.id, {
          referralCode: generatedReferralText(),
          expectedUpdatedAt: changed.json().data.updatedAt,
        })
      ).statusCode,
    ).toBe(400)
    expect(prisma._store.referralCode[0].code).toBe(made.referralCode)

    await app.close()
  })

  it('refuses a limit below the uses that count now, and a past expiry', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const { row } = await referralCodeFixture(prisma, {
      createdById: ids.platformAdministrator.id,
      useCount: 3,
    })

    const below = await update(app, headers, row.id, {
      maxUses: 2,
      expectedUpdatedAt: row.updatedAt.toISOString(),
    })

    expect(below.statusCode).toBe(422)
    expect(below.json().error).toMatchObject({
      code: 'REFERRAL_LIMIT_BELOW_USES',
      message: "It has been used 3 times already, so its limit can't be lower than that.",
    })

    const past = await update(app, headers, row.id, {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      expectedUpdatedAt: row.updatedAt.toISOString(),
    })

    expect(past.statusCode).toBe(422)

    // At the count, it is allowed: a use given back can bring it under again.
    expect(
      (
        await update(app, headers, row.id, {
          maxUses: 3,
          expectedUpdatedAt: row.updatedAt.toISOString(),
        })
      ).json().data.status,
    ).toBe('USED_UP')

    await app.close()
  })

  it('switches off idempotently with one audit row, and refuses switching an expired code on', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const { row } = await referralCodeFixture(prisma, {
      createdById: ids.platformAdministrator.id,
    })

    expect(
      (await switchCode(app, headers, row.id, 'off', { reason: REASON })).json().data,
    ).toMatchObject({
      status: 'OFF',
      active: false,
    })
    expect((await switchCode(app, headers, row.id, 'off')).statusCode).toBe(200)
    expect(
      prisma._store.auditLog.filter((entry) => entry.action === 'referral_code.switched_off'),
    ).toHaveLength(1)
    expect(
      prisma._store.auditLog.find((entry) => entry.action === 'referral_code.switched_off')
        .metadata,
    ).toEqual({ referralCodeId: row.id, reason: REASON, requestId: expect.any(String) })

    expect((await switchCode(app, headers, row.id, 'on')).json().data.status).toBe('ON')
    expect((await switchCode(app, headers, row.id, 'on')).statusCode).toBe(200)
    expect(
      prisma._store.auditLog.filter((entry) => entry.action === 'referral_code.switched_on'),
    ).toHaveLength(1)

    await switchCode(app, headers, row.id, 'off')
    prisma._store.referralCode.find((code) => code.id === row.id).expiresAt = new Date(
      Date.now() - 1_000,
    )

    const expired = await switchCode(app, headers, row.id, 'on')

    expect(expired.statusCode).toBe(409)
    expect(expired.json().error.code).toBe('REFERRAL_CODE_EXPIRED')

    await app.close()
  })

  it('never writes a code’s text or its label into an audit row', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const typed = generatedReferralText()
    const label = 'Label kept out of the audit'

    const made = (
      await create(app, headers, { referralCode: typed, label, scope: 'ALL_EVENTS' })
    ).json().data

    await update(app, headers, made.id, {
      label: 'Another label kept out',
      maxUses: 5,
      expectedUpdatedAt: made.updatedAt,
    })
    await switchCode(app, headers, made.id, 'off', { reason: REASON })

    const rows = prisma._store.auditLog.filter((entry) => entry.action.startsWith('referral_code.'))
    const text = JSON.stringify(rows)

    expect(rows.map((entry) => entry.action)).toEqual([
      'referral_code.created',
      'referral_code.updated',
      'referral_code.switched_off',
    ])
    expect(text).not.toContain(typed)
    expect(text).not.toContain(label)
    expect(text).not.toContain('Another label kept out')
    expect(rows[0].metadata).toEqual({
      referralCodeId: made.id,
      generated: false,
      scope: 'ALL_EVENTS',
      eventIds: [],
      expiresAt: null,
      maxUses: null,
      labelSet: true,
      requestId: expect.any(String),
    })
    expect(rows[1].metadata).toEqual({
      referralCodeId: made.id,
      changes: { maxUses: { from: null, to: 5 } },
      labelChanged: true,
      requestId: expect.any(String),
    })

    await app.close()
  })
})

describe('the lists and reports', () => {
  it('lists newest first, filtered by status, maker and event, never by text', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const admin = ids.platformAdministrator.id
    const ops = ids.platformAdmin.id
    const on = (await referralCodeFixture(prisma, { createdById: admin })).row
    const off = (await referralCodeFixture(prisma, { createdById: admin, active: false })).row
    const expired = (
      await referralCodeFixture(prisma, {
        createdById: ops,
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).row
    const usedUp = (
      await referralCodeFixture(prisma, { createdById: ops, maxUses: 1, useCount: 1 })
    ).row
    const scoped = (
      await referralCodeFixture(prisma, {
        createdById: ops,
        scope: 'SELECTED_EVENTS',
        eventIds: [ids.draftEvent.id],
      })
    ).row

    prisma._store.referralCode.find((row) => row.id === expired.id).expiresAt = new Date(
      Date.now() - 1_000,
    )

    // Newest first: spread the creation times.
    for (const [index, row] of [on, off, expired, usedUp, scoped].entries()) {
      prisma._store.referralCode.find((code) => code.id === row.id).createdAt = new Date(
        Date.UTC(2026, 9, 1, index),
      )
    }

    const ids_ = (response) => response.json().data.map((row) => row.id)
    const all = await read(app, headers, '/v1/platform/referral-codes')

    expect(ids_(all)).toEqual([scoped.id, usedUp.id, expired.id, off.id, on.id])
    expect(all.json().pagination.total).toBe(5)

    for (const [status, expected] of [
      ['ON', [scoped.id, on.id]],
      ['OFF', [off.id]],
      ['EXPIRED', [expired.id]],
      ['USED_UP', [usedUp.id]],
    ]) {
      expect(
        ids_(await read(app, headers, `/v1/platform/referral-codes?status=${status}`)),
      ).toEqual(expected)
    }

    expect(
      ids_(await read(app, headers, `/v1/platform/referral-codes?creatorId=${admin}`)),
    ).toEqual([off.id, on.id])
    // A code for all events works for every event; a scoped one only for its own.
    expect(
      ids_(
        await read(app, headers, `/v1/platform/referral-codes?eventId=${ids.publishedEvent.id}`),
      ),
    ).toEqual([usedUp.id, expired.id, off.id, on.id])
    expect(
      ids_(await read(app, headers, `/v1/platform/referral-codes?eventId=${ids.draftEvent.id}`)),
    ).toEqual([scoped.id, usedUp.id, expired.id, off.id, on.id])
    // No query parameter names a code's text: the list's filters are status,
    // maker and event, and paging.
    expect(Object.keys(listReferralCodesQuerySchema.shape).sort()).toEqual([
      'creatorId',
      'eventId',
      'page',
      'perPage',
      'status',
    ])

    await app.close()
  })

  it('counts uses placed, given back and now, and the fees current uses waived on paid orders', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const { row } = await referralCodeFixture(prisma, {
      createdById: ids.platformAdministrator.id,
      useCount: 3,
    })

    // Five orders placed with it: three still use it (two paid, one pending),
    // two gave their use back.
    await orderNaming(prisma, ids, row, { waived: 335 })
    await orderNaming(prisma, ids, row, { waived: 200, currency: 'USD' })
    await orderNaming(prisma, ids, row, { status: 'PENDING', waived: 999 })
    await orderNaming(prisma, ids, row, {
      status: 'REFUNDED',
      waived: 500,
      returnCause: 'REFUNDED',
    })
    await orderNaming(prisma, ids, row, {
      status: 'CANCELLED',
      waived: 700,
      returnCause: 'PAYMENT_FAILED',
    })

    const listed = (await read(app, headers, '/v1/platform/referral-codes')).json().data[0]

    expect(listed).toMatchObject({ useCount: 3, usesPlaced: 5, usesReturned: 2 })
    expect(listed.usesPlaced - listed.usesReturned).toBe(listed.useCount)
    // Only the current uses on PAID orders: not the pending one, not those given back.
    expect(listed.waived).toEqual([
      { currency: 'INR', cents: 335 },
      { currency: 'USD', cents: 200 },
    ])
    expect(listed).not.toHaveProperty('completedUses')

    const byAdmin = (
      await read(app, headers, '/v1/platform/referral-codes/by-administrator')
    ).json().data

    expect(byAdmin).toEqual([
      {
        administrator: { id: ids.platformAdministrator.id, displayName: 'Anil Administrator' },
        codes: 1,
        usesPlaced: 5,
        usesReturned: 2,
        currentUses: 3,
        waived: [
          { currency: 'INR', cents: 335 },
          { currency: 'USD', cents: 200 },
        ],
      },
    ])

    await app.close()
  })

  it('lists the uses of one code with when and why each was given back, and no buyer', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const { row } = await referralCodeFixture(prisma, {
      createdById: ids.platformAdministrator.id,
      useCount: 1,
    })
    const kept = await orderNaming(prisma, ids, row)
    const returned = await orderNaming(prisma, ids, row, {
      status: 'CANCELLED',
      returnCause: 'VENUE_UNPAID_CANCELLED',
    })

    kept.createdAt = new Date(Date.UTC(2026, 9, 1))
    prisma._store.order.find((order) => order.id === kept.id).createdAt = new Date(
      Date.UTC(2026, 9, 1),
    )
    prisma._store.order.find((order) => order.id === returned.id).createdAt = new Date(
      Date.UTC(2026, 9, 2),
    )

    const detail = await read(app, headers, `/v1/platform/referral-codes/${row.id}`)

    expect(detail.statusCode).toBe(200)
    expect(referralCodeDetailResponseSchema.safeParse(detail.json()).success).toBe(true)

    const { uses } = detail.json().data

    expect(uses.map((use) => use.orderReference)).toEqual([returned.reference, kept.reference])
    expect(uses[0]).toMatchObject({
      orderStatus: 'CANCELLED',
      useReturned: { at: '2026-10-09T12:00:00.000Z', cause: 'VENUE_UNPAID_CANCELLED' },
    })
    expect(uses[1].useReturned).toBeNull()

    const text = JSON.stringify(detail.json())

    for (const leak of ['priya@example.com', 'Priya Sharma', ids.attendee.id]) {
      expect(text).not.toContain(leak)
    }

    expect((await read(app, headers, `/v1/platform/referral-codes/${cuid()}`)).statusCode).toBe(404)

    await app.close()
  })

  it('pages the list and a code’s uses fifty at a time, as the contract says, and never more', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    let used

    for (let index = 0; index < 55; index += 1) {
      const { row } = await referralCodeFixture(prisma, {
        createdById: ids.platformAdministrator.id,
      })

      used ??= row
    }

    for (let index = 0; index < 55; index += 1) await orderNaming(prisma, ids, used)

    for (const url of ['/v1/platform/referral-codes', `/v1/platform/referral-codes/${used.id}`]) {
      const rowsOf = (response) =>
        url.endsWith(used.id) ? response.json().data.uses : response.json().data
      const first = await read(app, headers, url)

      expect(first.statusCode, first.body).toBe(200)
      expect(rowsOf(first)).toHaveLength(50)
      expect(first.json().pagination).toMatchObject({ page: 1, perPage: 50, total: 55 })

      const second = await read(app, headers, `${url}?page=2`)

      expect(rowsOf(second)).toHaveLength(5)
      expect(second.json().pagination).toMatchObject({ page: 2, perPage: 50, totalPages: 2 })

      const fewer = await read(app, headers, `${url}?perPage=10`)

      expect(rowsOf(fewer)).toHaveLength(10)
      expect(fewer.json().pagination.perPage).toBe(10)

      // More than fifty is refused, not quietly cut.
      for (const perPage of [51, 100]) {
        expect((await read(app, headers, `${url}?perPage=${perPage}`)).statusCode).toBe(400)
      }
    }

    // The service keeps to fifty for a caller that names no page size, or too large a one.
    const now = new Date()

    for (const query of [{}, { perPage: 100 }]) {
      expect((await listReferralCodes(prisma, query, now)).data).toHaveLength(50)
      expect(await referralCodeDetail(prisma, used.id, query, now)).toMatchObject({
        perPage: 50,
        total: 55,
      })
    }

    await app.close()
  })

  it('reports codes whose maker’s account is gone in one row with no administrator', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')

    await referralCodeFixture(prisma, { createdById: null, useCount: 0 })
    await referralCodeFixture(prisma, { createdById: null, useCount: 0 })
    await referralCodeFixture(prisma, { createdById: ids.platformAdministrator.id })

    const rows = (await read(app, headers, '/v1/platform/referral-codes/by-administrator')).json()
      .data

    expect(rows).toEqual([
      {
        administrator: null,
        codes: 2,
        usesPlaced: 0,
        usesReturned: 0,
        currentUses: 0,
        waived: [],
      },
      {
        administrator: { id: ids.platformAdministrator.id, displayName: 'Anil Administrator' },
        codes: 1,
        usesPlaced: 0,
        usesReturned: 0,
        currentUses: 0,
        waived: [],
      },
    ])

    await app.close()
  })

  it('carries every cause a use can be given back for, NOT_COMPLETED among them', () => {
    expect(REFERRAL_RETURN_CAUSES).toContain('NOT_COMPLETED')

    for (const cause of REFERRAL_RETURN_CAUSES) {
      const use = toReferralUse({
        reference: 'DE-CAUSE01',
        eventId: cuid(),
        event: { title: 'Garba Night' },
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        paymentMethod: 'AT_VENUE',
        status: 'CANCELLED',
        feeWaivedCents: 335,
        currency: 'USD',
        referralUseReturnedAt: new Date('2026-10-02T00:00:00.000Z'),
        referralUseReturnCause: cause,
      })

      expect(use.useReturned).toEqual({ at: '2026-10-02T00:00:00.000Z', cause })
    }
  })
})

describe('evaluating a code at checkout (DR10, DR13)', () => {
  it('answers NOT_ACCEPTED alike for unknown, off, expired, used up, out of scope and the maker’s own', async () => {
    const { seed, ids } = await makeWorld()
    const { prisma } = await createTestApp({ seed, ids })
    const now = new Date()
    const buyer = { id: ids.attendee.id }
    const event = { id: ids.publishedEvent.id }
    const admin = ids.platformAdministrator.id

    const cases = {
      unknown: generatedReferralText(),
      malformed: 'no such code!',
      off: (await referralCodeFixture(prisma, { createdById: admin, active: false })).referralCode,
      expired: (
        await referralCodeFixture(prisma, {
          createdById: admin,
          expiresAt: new Date(now.getTime() + 60_000),
        })
      ).referralCode,
      usedUp: (await referralCodeFixture(prisma, { createdById: admin, maxUses: 2, useCount: 2 }))
        .referralCode,
      outOfScope: (
        await referralCodeFixture(prisma, {
          createdById: admin,
          scope: 'SELECTED_EVENTS',
          eventIds: [ids.draftEvent.id],
        })
      ).referralCode,
    }

    prisma._store.referralCode.find((row) => row.code === cases.expired).expiresAt = new Date(
      now.getTime() - 1_000,
    )

    for (const [name, code] of Object.entries(cases)) {
      expect(
        await evaluateReferral(prisma, { code, event, actor: buyer, now, lock: false }),
        name,
      ).toEqual({ row: null, applicable: false, reason: 'NOT_ACCEPTED' })
    }

    const { referralCode } = await referralCodeFixture(prisma, { createdById: admin })

    expect(
      await evaluateReferral(prisma, {
        code: referralCode.toLowerCase(),
        event,
        actor: { id: admin },
        now,
        lock: false,
      }),
    ).toEqual({ row: null, applicable: false, reason: 'NOT_ACCEPTED' })

    const applied = await evaluateReferral(prisma, {
      code: ` ${referralCode.toLowerCase()} `,
      event,
      actor: buyer,
      now,
      lock: true,
    })

    expect(applied.applicable).toBe(true)
    expect(applied.row.code).toBe(referralCode)
  })

  it('says where a code stands: OFF, then EXPIRED, then USED_UP', () => {
    const now = new Date('2026-10-09T12:00:00.000Z')
    const base = { active: true, expiresAt: null, maxUses: null, useCount: 0 }
    const past = new Date('2026-10-08T00:00:00.000Z')

    expect(referralStatus(base, now)).toBe('ON')
    expect(referralStatus({ ...base, maxUses: 1, useCount: 1 }, now)).toBe('USED_UP')
    expect(referralStatus({ ...base, maxUses: 1, useCount: 1, expiresAt: past }, now)).toBe(
      'EXPIRED',
    )
    expect(
      referralStatus({ ...base, active: false, maxUses: 1, useCount: 1, expiresAt: past }, now),
    ).toBe('OFF')
    // A use given back brings a used-up code back (SPEC3-XI XR7).
    expect(referralStatus({ ...base, maxUses: 1, useCount: 0 }, now)).toBe('ON')
  })
})
