/**
 * The door, through the routes: list, preview, confirm.
 *
 * These run the real application against the stub database, so they prove the
 * wiring — schemas, headers, status codes, what reaches the wire and the audit
 * log — and the policy's answer for every kind of caller. What only a real
 * database can prove (row locks, the unique `CheckIn.ticketId`, the triggers,
 * two confirmations racing) is in `admission-integration.test.js`.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import { PREVIEW_TTL_MS, signPreviewReference } from '../src/lib/admission.js'
import { mintTicketCredential } from '../src/lib/ticket-credentials.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import { TEST_AUTH_SECRET } from './helpers/fixtures.js'

const PREVIEW_URL = '/v1/tickets/admission/preview'
const CHECK_IN_URL = '/v1/tickets/check-in'
const EVENTS_URL = '/v1/tickets/admission/events'

const DOOR = 'door@rangoli.example'
const OWNER = 'owner@rangoli.example'
const MANAGER = 'arun@rangoli.example'
const VIEWER = 'finance@rangoli.example'
const RIVAL = 'rival@dhol.example'
const PLATFORM = 'ops@desi-event.example'
const ATTENDEE = 'priya@example.com'

/**
 * The only keys a preview may carry. Listed, so that a field added to the
 * presenter has to be added here on purpose.
 */
const PREVIEW_KEYS = [
  'attendeeName',
  'checkedInAt',
  'event',
  'method',
  'outcome',
  'previewExpiresAt',
  'previewReference',
  'refusal',
  'seat',
  'tier',
]

const RESULT_KEYS = [
  'attendeeName',
  'checkedInAt',
  'checkedInByYou',
  'event',
  'method',
  'outcome',
  'seat',
  'tier',
]

/**
 * A world with one paid order of two tickets, and each ticket's secure pass.
 *
 * @param {object} [options] Harness options.
 * @returns {Promise<object>} The harness plus the tickets and their credentials.
 */
async function withPaidOrder(options = {}) {
  const harness = await createTestApp(options)

  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/orders',
    payload: {
      eventId: harness.ids.publishedEvent.id,
      buyerEmail: ATTENDEE,
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: harness.ids.generalAdmission.id, quantity: 2 }],
    },
  })

  expect(response.statusCode).toBe(201)

  const tickets = response.json().data.tickets
  // Issued at version 1 by checkout; the digest on the row is of exactly this.
  const credentials = tickets.map((ticket) =>
    mintTicketCredential({ secret: TEST_AUTH_SECRET, ticketId: ticket.id, version: 1 }),
  )

  return { ...harness, tickets, credentials }
}

/**
 * Preview a presentation.
 *
 * @param {object} app The application.
 * @param {string|null} token A bearer token, or null for anonymous.
 * @param {object} payload The request body.
 * @returns {Promise<object>} The injected response.
 */
function preview(app, token, payload) {
  return app.inject({
    method: 'POST',
    url: PREVIEW_URL,
    headers: token ? bearer(token) : {},
    payload,
  })
}

/**
 * Confirm a presentation.
 *
 * @param {object} app The application.
 * @param {string|null} token A bearer token, or null for anonymous.
 * @param {object} payload The request body.
 * @returns {Promise<object>} The injected response.
 */
function confirm(app, token, payload) {
  return app.inject({
    method: 'POST',
    url: CHECK_IN_URL,
    headers: token ? bearer(token) : {},
    payload,
  })
}

/**
 * Preview and then confirm, the way a door does.
 *
 * @param {object} app The application.
 * @param {string} token A bearer token.
 * @param {object} presentation `{ code }` or `{ credential }`.
 * @returns {Promise<{preview: object, confirmation: object}>} Both responses.
 */
async function previewThenConfirm(app, token, presentation) {
  const looked = await preview(app, token, presentation)

  expect(looked.statusCode, looked.body).toBe(200)

  const confirmation = await confirm(app, token, {
    ...presentation,
    previewReference: looked.json().data.previewReference,
  })

  return { preview: looked, confirmation }
}

/**
 * The stored ticket row.
 *
 * @param {object} prisma The stub.
 * @param {string} id The ticket id.
 * @returns {object} The row.
 */
function storedTicket(prisma, id) {
  return prisma._store.ticket.find((row) => row.id === id)
}

/**
 * The stored check-in rows for a ticket.
 *
 * @param {object} prisma The stub.
 * @param {string} ticketId The ticket id.
 * @returns {object[]} The rows.
 */
function checkInsFor(prisma, ticketId) {
  return (prisma._store.checkIn ?? []).filter((row) => row.ticketId === ticketId)
}

/**
 * The error envelope without its per-request id, for comparing two refusals.
 *
 * @param {object} response An injected response.
 * @returns {object} `{ statusCode, error }` minus `requestId`.
 */
function refusalShape(response) {
  const { requestId: _requestId, ...error } = response.json().error

  return { statusCode: response.statusCode, error }
}

describe('GET /v1/tickets/admission/events', () => {
  it('shows scoped door staff only the event their scope names, and never caches it', async () => {
    const { app, ids } = await createTestApp()
    const response = await app.inject({
      method: 'GET',
      url: EVENTS_URL,
      headers: bearer(await signIn(app, DOOR)),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.json().data).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ id: ids.publishedEvent.id, status: 'PUBLISHED' }),
        organization: { id: ids.organization.id, name: ids.organization.name },
        authority: 'EVENT_SCOPE',
        role: 'STAFF',
      }),
    ])

    await app.close()
  })

  it('shows an owner their organisation’s current events on the organisation role', async () => {
    const { app, ids } = await createTestApp()
    const response = await app.inject({
      method: 'GET',
      url: EVENTS_URL,
      headers: bearer(await signIn(app, OWNER)),
    })
    const entries = response.json().data

    expect(entries.map((entry) => entry.event.id)).toContain(ids.publishedEvent.id)
    expect(entries.every((entry) => entry.authority === 'ORGANIZATION_ROLE')).toBe(true)
    expect(entries.every((entry) => entry.organization.id === ids.organization.id)).toBe(true)
    // A draft has sold nothing, so it has no door.
    expect(entries.map((entry) => entry.event.id)).not.toContain(ids.draftEvent.id)

    await app.close()
  })

  it('shows nothing to an unscoped manager, a viewer, a platform administrator or an attendee', async () => {
    const { app } = await createTestApp()

    for (const email of [MANAGER, VIEWER, PLATFORM, ATTENDEE]) {
      const response = await app.inject({
        method: 'GET',
        url: EVENTS_URL,
        headers: bearer(await signIn(app, email)),
      })

      expect(response.statusCode, email).toBe(200)
      expect(response.json().data, email).toEqual([])
    }

    await app.close()
  })

  it('never lists another organisation’s events', async () => {
    const { app, ids } = await createTestApp()
    const response = await app.inject({
      method: 'GET',
      url: EVENTS_URL,
      headers: bearer(await signIn(app, RIVAL)),
    })

    for (const entry of response.json().data) {
      expect(entry.organization.id).toBe(ids.otherOrganization.id)
    }

    await app.close()
  })

  it('refuses an anonymous caller', async () => {
    const { app } = await createTestApp()
    const response = await app.inject({ method: 'GET', url: EVENTS_URL })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})

describe('POST /v1/tickets/admission/preview', () => {
  /** @type {object} */
  let harness

  beforeEach(async () => {
    harness = await withPaidOrder()
  })

  it('shows door staff what a door needs, and writes nothing to the ticket', async () => {
    const { app, prisma, ids, tickets } = harness
    const before = structuredClone(storedTicket(prisma, tickets[0].id))
    const response = await preview(app, await signIn(app, DOOR), { code: tickets[0].code })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')

    const { data } = response.json()

    expect(Object.keys(data).sort()).toEqual(PREVIEW_KEYS)
    expect(data).toMatchObject({
      outcome: 'ADMISSIBLE',
      refusal: null,
      method: 'MANUAL_CODE',
      event: {
        id: ids.publishedEvent.id,
        title: ids.publishedEvent.title,
        timezone: ids.publishedEvent.timezone,
      },
      tier: { name: 'General Admission' },
      seat: null,
      checkedInAt: null,
    })
    expect(data.previewReference).toEqual(expect.any(String))
    expect(Date.parse(data.previewExpiresAt) - Date.now()).toBeLessThanOrEqual(PREVIEW_TTL_MS)

    // Not one column moved, and no attendance was recorded.
    expect(storedTicket(prisma, tickets[0].id)).toEqual(before)
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)

    // Nothing a door has no use for: not the buyer, not the money, not the
    // printed code it was just given, not the pass.
    expect(response.body).not.toContain(ATTENDEE)
    expect(response.body).not.toContain(tickets[0].code)
    expect(response.body).not.toMatch(/credential|total|amount|orderId|buyer/iu)

    await app.close()
  })

  it('reports the secure pass as a QR scan and the printed code as manual entry', async () => {
    const { app, tickets, credentials } = harness
    const token = await signIn(app, DOOR)

    const scanned = await preview(app, token, { credential: credentials[0] })
    const typed = await preview(app, token, { code: tickets[0].code })

    expect(scanned.json().data.method).toBe('QR_SCAN')
    expect(typed.json().data.method).toBe('MANUAL_CODE')
    expect(scanned.body).not.toContain(credentials[0])

    await app.close()
  })

  it('audits the lookup without the pass, the code or the reference', async () => {
    const { app, prisma, tickets, credentials } = harness
    const token = await signIn(app, DOOR)

    const scanned = await preview(app, token, { credential: credentials[0] })
    const typed = await preview(app, token, { code: tickets[1].code })

    const rows = prisma._store.auditLog.filter(
      (row) => row.action === AUDIT_ACTIONS.TICKET_ADMISSION_PREVIEWED,
    )

    expect(rows.map((row) => row.entityId).sort()).toEqual([tickets[0].id, tickets[1].id].sort())
    expect(rows[0].metadata).toMatchObject({ outcome: 'ADMISSIBLE', authority: 'EVENT_SCOPE' })

    const everything = JSON.stringify(prisma._store.auditLog)

    expect(everything).not.toContain(credentials[0])
    expect(everything).not.toContain(tickets[1].code)
    expect(everything).not.toContain(scanned.json().data.previewReference)
    expect(everything).not.toContain(typed.json().data.previewReference)

    await app.close()
  })

  it('answers an outsider holding a real code exactly as it answers a made-up one', async () => {
    const { app, prisma, tickets } = harness
    const token = await signIn(app, RIVAL)

    const real = await preview(app, token, { code: tickets[0].code })
    const invented = await preview(app, token, { code: 'DET-NOTAREALCODE' })

    expect(real.statusCode).toBe(404)
    expect(refusalShape(real)).toEqual(refusalShape(invented))
    // The organisation that owns the ticket is not named anywhere.
    expect(real.body).not.toMatch(/rangoli/iu)

    // The ticket's own record notes that somebody out of scope held its pass.
    expect(
      prisma._store.auditLog.filter(
        (row) =>
          row.action === AUDIT_ACTIONS.TICKET_ADMISSION_REFUSED && row.entityId === tickets[0].id,
      ),
    ).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: 'NOT_AUTHORISED_FOR_EVENT' }),
      }),
    ])

    await app.close()
  })

  it('answers a door role with no scope for this event with the same 404', async () => {
    const { app, tickets } = harness
    const token = await signIn(app, MANAGER)

    const real = await preview(app, token, { code: tickets[0].code })
    const invented = await preview(app, token, { code: 'DET-NOTAREALCODE' })

    expect(real.statusCode).toBe(404)
    expect(refusalShape(real)).toEqual(refusalShape(invented))

    await app.close()
  })

  it('lets an owner admit anywhere in the organisation without a scope', async () => {
    const { app, tickets } = harness
    const response = await preview(app, await signIn(app, OWNER), { code: tickets[0].code })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.outcome).toBe('ADMISSIBLE')

    await app.close()
  })

  it('refuses callers with no door authority before looking anything up', async () => {
    const { app, tickets } = harness

    const viewer = await preview(app, await signIn(app, VIEWER), { code: tickets[0].code })
    const attendee = await preview(app, await signIn(app, ATTENDEE), { code: tickets[0].code })
    const anonymous = await preview(app, null, { code: tickets[0].code })

    expect(viewer.statusCode).toBe(403)
    expect(attendee.statusCode).toBe(403)
    expect(anonymous.statusCode).toBe(401)
    // A 403 that is a statement about the caller, identical for a real code and
    // an invented one, so it says nothing about tickets.
    const invented = await preview(app, await signIn(app, VIEWER), { code: 'DET-NOTAREALCODE' })

    expect(refusalShape(viewer)).toEqual(refusalShape(invented))

    await app.close()
  })

  it('does not let a platform super-administrator stand at a door, and records that it tried', async () => {
    const { app, prisma, ids, tickets } = harness
    const response = await preview(app, await signIn(app, PLATFORM), { code: tickets[0].code })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.auditLog).toContainEqual(
      expect.objectContaining({
        action: AUDIT_ACTIONS.TICKET_ADMISSION_REFUSED,
        entityType: 'User',
        entityId: ids.platformAdmin.id,
        metadata: expect.objectContaining({ reason: 'PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY' }),
      }),
    )

    await app.close()
  })

  it('resolves the event from the ticket, and only compares the one the browser named', async () => {
    const { app, ids, tickets } = harness
    const response = await preview(app, await signIn(app, DOOR), {
      code: tickets[0].code,
      expectedEventId: ids.draftEvent.id,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      outcome: 'REFUSED',
      refusal: 'WRONG_EVENT',
      previewReference: null,
      // The real event, from the database, not the one the browser sent.
      event: { id: ids.publishedEvent.id },
    })

    await app.close()
  })

  it('names the refusal for a void ticket, an unpaid order and a cancelled event', async () => {
    const { app, prisma, ids, tickets } = harness
    const token = await signIn(app, DOOR)

    storedTicket(prisma, tickets[0].id).status = 'VOID'
    const voided = await preview(app, token, { code: tickets[0].code })

    prisma._store.order[0].status = 'CANCELLED'
    const unpaid = await preview(app, token, { code: tickets[1].code })

    prisma._store.order[0].status = 'PAID'
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)
    event.status = 'CANCELLED'
    event.cancelledAt = new Date()
    const cancelled = await preview(app, token, { code: tickets[1].code })

    expect(voided.json().data).toMatchObject({
      outcome: 'REFUSED',
      refusal: 'VOID',
      previewReference: null,
    })
    expect(unpaid.json().data).toMatchObject({ outcome: 'REFUSED', refusal: 'ORDER_NOT_PAID' })
    expect(cancelled.json().data).toMatchObject({ outcome: 'REFUSED', refusal: 'EVENT_CANCELLED' })

    await app.close()
  })

  it.each([
    ['neither a pass nor a code', {}],
    ['both a pass and a code', 'both'],
    ['a method chosen by the client', 'method'],
    ['a malformed code', { code: 'no!' }],
  ])('rejects a request with %s before looking anything up', async (_label, shape) => {
    const { app, tickets, credentials } = harness
    const body =
      shape === 'both'
        ? { code: tickets[0].code, credential: credentials[0] }
        : shape === 'method'
          ? { code: tickets[0].code, method: 'QR_SCAN' }
          : shape

    const response = await preview(app, await signIn(app, DOOR), body)

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('stops a scanner that probes codes faster than a door ever could', async () => {
    const limited = await withPaidOrder({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        admission: { max: 2, timeWindow: '1 minute' },
      },
    })
    const token = await signIn(limited.app, DOOR)

    const statuses = []

    for (let attempt = 0; attempt < 3; attempt += 1) {
      statuses.push(
        (await preview(limited.app, token, { code: `DET-PROBE${attempt}AAA` })).statusCode,
      )
    }

    expect(statuses).toEqual([404, 404, 429])

    await limited.app.close()
    await harness.app.close()
  })
})

describe('POST /v1/tickets/check-in', () => {
  /** @type {object} */
  let harness

  beforeEach(async () => {
    harness = await withPaidOrder()
  })

  it('admits a previewed ticket once, recording who, how and when', async () => {
    const { app, prisma, ids, tickets } = harness
    const { confirmation } = await previewThenConfirm(app, await signIn(app, DOOR), {
      code: tickets[0].code,
    })

    expect(confirmation.statusCode).toBe(200)
    expect(confirmation.headers['cache-control']).toBe('private, no-store')

    const { data } = confirmation.json()

    expect(Object.keys(data).sort()).toEqual(RESULT_KEYS)
    expect(data).toMatchObject({
      outcome: 'ADMITTED',
      method: 'MANUAL_CODE',
      checkedInByYou: true,
      event: { id: ids.publishedEvent.id },
    })

    const rows = checkInsFor(prisma, tickets[0].id)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ method: 'MANUAL_CODE', scannedByUserId: ids.staff.id })
    expect(storedTicket(prisma, tickets[0].id).status).toBe('CHECKED_IN')
    expect(data.checkedInAt).toBe(rows[0].scannedAt.toISOString())
    expect(confirmation.body).not.toContain(ATTENDEE)
    expect(confirmation.body).not.toContain(tickets[0].code)

    await app.close()
  })

  it('records a secure-pass admission as a QR scan', async () => {
    const { app, prisma, tickets, credentials } = harness
    const { confirmation } = await previewThenConfirm(app, await signIn(app, DOOR), {
      credential: credentials[0],
    })

    expect(confirmation.json().data.method).toBe('QR_SCAN')
    expect(checkInsFor(prisma, tickets[0].id)[0].method).toBe('QR_SCAN')
    expect(JSON.stringify(prisma._store.auditLog)).not.toContain(credentials[0])

    await app.close()
  })

  it('answers a repeated confirmation with the original admission and writes nothing', async () => {
    const { app, prisma, tickets } = harness
    const token = await signIn(app, DOOR)
    const { preview: looked, confirmation } = await previewThenConfirm(app, token, {
      code: tickets[0].code,
    })

    // What a browser that lost the first response sends: the same body again.
    const retried = await confirm(app, token, {
      code: tickets[0].code,
      previewReference: looked.json().data.previewReference,
    })

    expect(retried.statusCode).toBe(200)
    expect(retried.json().data).toMatchObject({
      outcome: 'ALREADY_CHECKED_IN',
      checkedInAt: confirmation.json().data.checkedInAt,
      checkedInByYou: true,
    })
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(1)

    await app.close()
  })

  it('tells a second scanner the ticket is already in, and that somebody else admitted it', async () => {
    const { app, prisma, tickets } = harness
    const ownerToken = await signIn(app, OWNER)
    const doorToken = await signIn(app, DOOR)

    const ownerPreview = await preview(app, ownerToken, { code: tickets[0].code })

    await previewThenConfirm(app, doorToken, { code: tickets[0].code })

    const late = await confirm(app, ownerToken, {
      code: tickets[0].code,
      previewReference: ownerPreview.json().data.previewReference,
    })
    const again = await preview(app, ownerToken, { code: tickets[0].code })

    expect(late.statusCode).toBe(200)
    expect(late.json().data).toMatchObject({ outcome: 'ALREADY_CHECKED_IN', checkedInByYou: false })
    expect(again.json().data).toMatchObject({
      outcome: 'ALREADY_CHECKED_IN',
      previewReference: null,
      checkedInAt: expect.any(String),
    })
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(1)

    await app.close()
  })

  it('refuses a confirmation that never saw a preview', async () => {
    const { app, prisma, tickets } = harness
    const response = await confirm(app, await signIn(app, DOOR), { code: tickets[0].code })

    expect(response.statusCode).toBe(400)
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)

    await app.close()
  })

  it('refuses a tampered reference, and one lifted from another scanner', async () => {
    const { app, prisma, tickets } = harness
    const doorToken = await signIn(app, DOOR)
    const ownerToken = await signIn(app, OWNER)

    const ownerPreview = await preview(app, ownerToken, { code: tickets[0].code })
    const reference = ownerPreview.json().data.previewReference
    const [body, mac] = reference.split('.')
    const tampered = `${body}.${mac.slice(0, -2)}${mac.endsWith('AA') ? 'BB' : 'AA'}`

    const forged = await confirm(app, ownerToken, {
      code: tickets[0].code,
      previewReference: tampered,
    })
    const lifted = await confirm(app, doorToken, {
      code: tickets[0].code,
      previewReference: reference,
    })

    expect(forged.statusCode).toBe(409)
    expect(forged.json().error.reason).toBe('PREVIEW_INVALID')
    expect(lifted.statusCode).toBe(409)
    expect(lifted.json().error.reason).toBe('PREVIEW_INVALID')
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)

    await app.close()
  })

  it('refuses a reference confirmed with a different pass or a different way of presenting it', async () => {
    const { app, prisma, tickets, credentials } = harness
    const token = await signIn(app, DOOR)
    const typed = await preview(app, token, { code: tickets[0].code })
    const reference = typed.json().data.previewReference

    const otherTicket = await confirm(app, token, {
      code: tickets[1].code,
      previewReference: reference,
    })
    const otherMethod = await confirm(app, token, {
      credential: credentials[0],
      previewReference: reference,
    })

    expect(otherTicket.json().error.reason).toBe('PREVIEW_MISMATCH')
    expect(otherMethod.json().error.reason).toBe('PREVIEW_MISMATCH')
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)
    expect(checkInsFor(prisma, tickets[1].id)).toHaveLength(0)

    await app.close()
  })

  it('refuses a reference whose two minutes are up', async () => {
    const { app, prisma, ids, tickets } = harness
    const expired = signPreviewReference({
      secret: TEST_AUTH_SECRET,
      ticketId: tickets[0].id,
      eventId: ids.publishedEvent.id,
      organizationId: ids.organization.id,
      actorId: ids.staff.id,
      method: 'MANUAL_CODE',
      expiresAt: new Date(Date.now() - 1_000),
    })

    const response = await confirm(app, await signIn(app, DOOR), {
      code: tickets[0].code,
      previewReference: expired,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.reason).toBe('PREVIEW_EXPIRED')
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)

    await app.close()
  })

  it.each([
    ['a method', { method: 'QR_SCAN' }],
    ['an admission time', { checkedInAt: '2026-01-01T10:00:00.000Z' }],
    ['force', { force: true }],
    ['an event session', { eventSessionId: 'sessionaaaaaaaaa' }],
  ])('refuses a client that tries to choose %s', async (_label, extra) => {
    const { app, prisma, tickets } = harness
    const token = await signIn(app, DOOR)
    const looked = await preview(app, token, { code: tickets[0].code })

    const response = await confirm(app, token, {
      code: tickets[0].code,
      previewReference: looked.json().data.previewReference,
      ...extra,
    })

    expect(response.statusCode).toBe(400)
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)

    await app.close()
  })

  it('re-reads the scope at confirmation: one withdrawn after the preview admits nobody', async () => {
    const { app, prisma, ids, tickets } = harness
    const token = await signIn(app, DOOR)
    const looked = await preview(app, token, { code: tickets[0].code })

    prisma._store.scannerScope = prisma._store.scannerScope.filter(
      (scope) => scope.eventId !== ids.publishedEvent.id,
    )

    const response = await confirm(app, token, {
      code: tickets[0].code,
      previewReference: looked.json().data.previewReference,
    })

    expect(response.statusCode).toBe(403)
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)
    expect(storedTicket(prisma, tickets[0].id).status).toBe('VALID')

    await app.close()
  })

  it('re-reads the ticket at confirmation: one voided after the preview is refused', async () => {
    const { app, prisma, tickets } = harness
    const token = await signIn(app, DOOR)
    const looked = await preview(app, token, { code: tickets[0].code })

    storedTicket(prisma, tickets[0].id).status = 'VOID'

    const response = await confirm(app, token, {
      code: tickets[0].code,
      previewReference: looked.json().data.previewReference,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.reason).toBe('VOID')
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)

    await app.close()
  })

  it('re-compares the event the browser expects at confirmation', async () => {
    const { app, prisma, ids, tickets } = harness
    const token = await signIn(app, DOOR)
    const looked = await preview(app, token, { code: tickets[0].code })

    const response = await confirm(app, token, {
      code: tickets[0].code,
      expectedEventId: ids.draftEvent.id,
      previewReference: looked.json().data.previewReference,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.reason).toBe('WRONG_EVENT')
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)

    await app.close()
  })

  it('refuses callers with no door authority, and an anonymous one', async () => {
    const { app, prisma, tickets } = harness
    const looked = await preview(app, await signIn(app, DOOR), { code: tickets[0].code })
    const previewReference = looked.json().data.previewReference

    const attendee = await confirm(app, await signIn(app, ATTENDEE), {
      code: tickets[0].code,
      previewReference,
    })
    const anonymous = await confirm(app, null, { code: tickets[0].code, previewReference })

    expect(attendee.statusCode).toBe(403)
    expect(anonymous.statusCode).toBe(401)
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)

    await app.close()
  })

  it('refuses a caller whose session has ended, whatever the preview said', async () => {
    const { app, prisma, ids, tickets } = harness
    const token = await signIn(app, DOOR)
    const looked = await preview(app, token, { code: tickets[0].code })
    const body = { code: tickets[0].code, previewReference: looked.json().data.previewReference }
    const sessions = prisma._store.session.filter((row) => row.userId === ids.staff.id)

    for (const session of sessions) session.expiresAt = new Date(Date.now() - 1_000)

    const expired = await confirm(app, token, body)

    for (const session of sessions) {
      session.expiresAt = new Date(Date.now() + 3_600_000)
      session.revokedAt = new Date()
    }

    const revoked = await confirm(app, token, body)

    expect(expired.statusCode).toBe(401)
    expect(revoked.statusCode).toBe(401)
    expect(checkInsFor(prisma, tickets[0].id)).toHaveLength(0)

    await app.close()
  })

  it('records the admission with its authority and without the pass, code or reference', async () => {
    const { app, prisma, tickets } = harness
    const { preview: looked } = await previewThenConfirm(app, await signIn(app, DOOR), {
      code: tickets[0].code,
    })

    const admitted = prisma._store.auditLog.filter(
      (row) => row.action === AUDIT_ACTIONS.TICKET_CHECKED_IN && row.entityId === tickets[0].id,
    )

    expect(admitted).toHaveLength(1)
    expect(admitted[0].metadata).toMatchObject({ method: 'MANUAL_CODE', authority: 'EVENT_SCOPE' })

    const everything = JSON.stringify(prisma._store.auditLog)

    expect(everything).not.toContain(tickets[0].code)
    expect(everything).not.toContain(looked.json().data.previewReference)

    await app.close()
  })
})
