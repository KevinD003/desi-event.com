import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'

/**
 * Build an app with one paid and one pending order against the published event.
 *
 * Both are people who need telling. The paid one additionally has money at
 * stake, which is what makes the change material rather than merely visible.
 *
 * @returns {Promise<object>} The harness, plus the two order ids.
 */
async function withBuyers() {
  const harness = await createTestApp()
  const { prisma, ids } = harness

  const paid = await prisma.order.create({
    data: {
      eventId: ids.publishedEvent.id,
      organizationId: ids.organization.id,
      userId: ids.attendee.id,
      buyerEmail: 'paid-buyer@example.test',
      reference: 'DE-PAID-0001',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 149_900,
      totalCents: 158_000,
      // The terms as they stood at purchase. Nothing in this workflow may
      // touch it: that is the entire reason it is stored here rather than read
      // back through the event.
      policySnapshot: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })

  const pending = await prisma.order.create({
    data: {
      eventId: ids.publishedEvent.id,
      organizationId: ids.organization.id,
      buyerEmail: 'pending-buyer@example.test',
      reference: 'DE-PEND-0001',
      status: 'PENDING',
      currency: 'INR',
      subtotalCents: 149_900,
      totalCents: 158_000,
    },
  })

  return { ...harness, paid, pending }
}

/**
 * PATCH an event as the organisation's owner.
 *
 * @param {object} harness The test harness.
 * @param {string} eventId The event.
 * @param {object} body The patch.
 * @returns {Promise<object>} The response.
 */
async function patchEvent(harness, eventId, body) {
  const token = await signIn(harness.app, 'owner@rangoli.example')

  return harness.app.inject({
    method: 'PATCH',
    url: `/v1/events/${eventId}`,
    headers: bearer(token),
    payload: body,
  })
}

describe('editing a draft', () => {
  it('needs no confirmation and tells nobody', async () => {
    const harness = await withBuyers()
    const { app, prisma, ids } = harness

    const response = await patchEvent(harness, ids.draftEvent.id, {
      summary: 'Now with a better description.',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.summary).toBe('Now with a better description.')
    expect(prisma._store.notificationOutbox ?? []).toHaveLength(0)

    await app.close()
  })

  it('moves the revision forward, so a second editor is caught', async () => {
    const harness = await withBuyers()
    const { app, ids } = harness

    const first = await patchEvent(harness, ids.draftEvent.id, { summary: 'One.' })

    expect(first.json().data.revision).toBe(1)

    // The second editor read revision 0 and is still holding it.
    const stale = await patchEvent(harness, ids.draftEvent.id, { summary: 'Two.', revision: 0 })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('STALE_REVISION')
    expect(stale.json().error.message).toMatch(/somebody else saved a change/i)

    await app.close()
  })

  it('accepts the revision it was given', async () => {
    const harness = await withBuyers()
    const { app, ids } = harness

    const response = await patchEvent(harness, ids.draftEvent.id, {
      summary: 'Fresh.',
      revision: 0,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.revision).toBe(1)

    await app.close()
  })
})

describe('editing an event a moderator is holding', () => {
  it('refuses, and says to withdraw it first', async () => {
    const harness = await withBuyers()
    const { app, ids } = harness

    const response = await patchEvent(harness, ids.reviewPendingEvent.id, { summary: 'Sneaky.' })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/withdraw it from review first/i)

    await app.close()
  })

  it('refuses to edit an approved version, because that is the version somebody said yes to', async () => {
    const harness = await withBuyers()
    const { app, ids } = harness

    const response = await patchEvent(harness, ids.approvedEvent.id, { summary: 'Different now.' })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/a moderator holds this version/i)

    await app.close()
  })

  it('refuses to edit a rejected event', async () => {
    const harness = await withBuyers()
    const { app, ids } = harness

    const response = await patchEvent(harness, ids.rejectedEvent.id, { summary: 'Try again.' })

    expect(response.statusCode).toBe(409)

    await app.close()
  })
})

describe('a housekeeping edit to a published event', () => {
  it('goes through without a confirmation', async () => {
    const harness = await withBuyers()
    const { app, prisma, ids } = harness

    const response = await patchEvent(harness, ids.publishedEvent.id, {
      summary: 'A clearer description of the same night.',
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.notificationOutbox ?? []).toHaveLength(0)

    await app.close()
  })

  it('does not ask for a confirmation when a material field is sent unchanged', async () => {
    // An editor that PATCHes the whole form on every autosave would otherwise
    // demand a confirmation for a change nobody made.
    const harness = await withBuyers()
    const { app, prisma, ids } = harness
    const row = prisma._store.event.find((event) => event.id === ids.publishedEvent.id)

    const response = await patchEvent(harness, ids.publishedEvent.id, {
      summary: 'Reworded.',
      startsAt: row.startsAt.toISOString(),
      timezone: row.timezone,
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })
})

describe('a material change to a published event', () => {
  it('is refused until somebody says they mean it', async () => {
    const harness = await withBuyers()
    const { app, prisma, ids } = harness

    const response = await patchEvent(harness, ids.publishedEvent.id, {
      startsAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 90 * 24 * 3600 * 1000 + 3 * 3600 * 1000).toISOString(),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems).toEqual([
      'Changing the start time after publication needs an explicit confirmation.',
      'Changing the end time after publication needs an explicit confirmation.',
    ])

    // Nothing written, nothing queued.
    expect(prisma._store.notificationOutbox ?? []).toHaveLength(0)
    expect(prisma._store.event.find((event) => event.id === ids.publishedEvent.id).revision).toBe(0)

    await app.close()
  })

  it('is refused when it is confirmed but carries no reason', async () => {
    const harness = await withBuyers()
    const { app, ids } = harness

    const response = await patchEvent(harness, ids.publishedEvent.id, {
      ageRestriction: 21,
      confirmMaterialChange: true,
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems).toEqual(['Give a reason for the change.'])

    await app.close()
  })

  it('goes through when confirmed, and queues one notice per order', async () => {
    const harness = await withBuyers()
    const { app, prisma, ids } = harness

    const response = await patchEvent(harness, ids.publishedEvent.id, {
      ageRestriction: 21,
      confirmMaterialChange: true,
      changeReason: 'The licence came back restricted to over-21s.',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.ageRestriction).toBe(21)

    const queued = prisma._store.notificationOutbox

    expect(queued).toHaveLength(2)
    expect(queued.map((row) => row.recipient).sort()).toEqual([
      'paid-buyer@example.test',
      'pending-buyer@example.test',
    ])

    await app.close()
  })

  it('queues work rather than claiming anybody has been told', async () => {
    // No outbox worker exists in this repository. The rows are QUEUED and
    // unsent, and nothing anywhere says otherwise.
    const harness = await withBuyers()
    const { app, prisma, ids } = harness

    await patchEvent(harness, ids.publishedEvent.id, {
      ageRestriction: 21,
      confirmMaterialChange: true,
      changeReason: 'The licence came back restricted to over-21s.',
    })

    for (const row of prisma._store.notificationOutbox) {
      expect(row.status).toBe('QUEUED')
      expect(row.sentAt ?? null).toBeNull()
      // Being told what you bought has changed is not marketing.
      expect(row.suppressible).toBe(false)
    }

    await app.close()
  })

  it('records both sides of the change, who made it and why', async () => {
    const harness = await withBuyers()
    const { app, prisma, ids } = harness

    await patchEvent(harness, ids.publishedEvent.id, {
      ageRestriction: 21,
      confirmMaterialChange: true,
      changeReason: 'The licence came back restricted to over-21s.',
    })

    const record = prisma._store.auditLog.find(
      (entry) => entry.action === 'event.material_change.notified',
    )

    expect(record).toBeTruthy()
    expect(record.entityId).toBe(ids.publishedEvent.id)
    expect(record.actorId).toBe(ids.owner.id)
    expect(record.metadata.fields).toEqual(['ageRestriction'])
    expect(record.metadata.before).toEqual({ ageRestriction: null })
    expect(record.metadata.after).toEqual({ ageRestriction: 21 })
    expect(record.metadata.reason).toBe('The licence came back restricted to over-21s.')
    expect(record.metadata.ordersAffected).toBe(2)
    expect(record.metadata.notificationsQueued).toBe(2)
    expect(record.createdAt).toBeTruthy()

    await app.close()
  })

  it('leaves the terms already copied onto an order exactly as they were', async () => {
    // The whole point of a snapshot. Rewriting it to match the new policies
    // would change what a buyer agreed to, retroactively and invisibly.
    const harness = await withBuyers()
    const { app, prisma, ids, paid } = harness
    const before = JSON.stringify(paid.policySnapshot)

    await patchEvent(harness, ids.publishedEvent.id, {
      policies: { entry: 'Doors at six now.', refund: 'No refunds.' },
      confirmMaterialChange: true,
      changeReason: 'The venue moved the curfew.',
    })

    const after = prisma._store.order.find((order) => order.id === paid.id)

    expect(JSON.stringify(after.policySnapshot)).toBe(before)
    expect(after.policySnapshot.refund).toBe('Refundable up to 48 hours before.')

    await app.close()
  })

  it('names every material field rather than the first one', async () => {
    const harness = await withBuyers()
    const { app, ids } = harness

    const response = await patchEvent(harness, ids.publishedEvent.id, {
      ageRestriction: 21,
      timezone: 'Asia/Dubai',
      summary: 'Also reworded, which is not material.',
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems).toHaveLength(2)
    expect(response.json().error.message).toMatch(/the time zone/)
    expect(response.json().error.message).toMatch(/the age restriction/)
    expect(response.json().error.message).not.toMatch(/summary/)

    await app.close()
  })

  it('tells each buyer once per change, not once per attempt', async () => {
    const harness = await withBuyers()
    const { app, prisma, ids } = harness

    await patchEvent(harness, ids.publishedEvent.id, {
      ageRestriction: 21,
      confirmMaterialChange: true,
      changeReason: 'First change.',
    })

    // A second, different material change is a second thing to be told about,
    // so it queues its own notices rather than colliding with the first.
    await patchEvent(harness, ids.publishedEvent.id, {
      timezone: 'Asia/Dubai',
      confirmMaterialChange: true,
      changeReason: 'Second change.',
    })

    const keys = prisma._store.notificationOutbox.map((row) => row.dedupeKey)

    expect(keys).toHaveLength(4)
    expect(new Set(keys).size).toBe(4)

    await app.close()
  })
})
