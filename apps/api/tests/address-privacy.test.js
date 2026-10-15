/**
 * Where addresses stopped going, around the team list.
 *
 * The team list has its own two suites (`team-email-visibility`, and
 * `team-email-integration` against PostgreSQL). This file is for everywhere
 * else the same analysis reached, one surface at a time:
 *
 * - **A transfer's recipient** becomes `••••@domain` for the parties, whatever
 *   the local part: no length, no ends, no alias, no suffix, and so nothing
 *   that tells two recipients at one domain apart.
 * - **The door** shows a name, never an address, even when the name is one.
 * - **The operations queue** carries no recipient at all, and an address in
 *   a stored error is taken out.
 * - **An order read by its organisation** carries no buyer address. The buyer's
 *   own read still does.
 * - **Audit rows** for a transfer no longer copy the recipient's address. An
 *   audit row is immutable, so an address in one outlived its erasure.
 * - **Payment metadata** carries identifiers only.
 *
 * Each presenter case also parses its output with the route's response schema,
 * because that schema is the second check behind the presenter and is what
 * actually shapes the wire.
 *
 * @module @desi-event/api/tests/address-privacy
 */

import {
  admissionPreviewResponseSchema,
  checkInResponseSchema,
  notificationSummarySchema,
} from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import { toAdmissionPreview, toAdmissionResult } from '../src/lib/admission.js'
import { captureOutsideTransaction } from '../src/lib/checkout.js'
import { toOperatorNotification, transferRecipient } from '../src/lib/presenters.js'
import { bearer, claim, createTestApp, signIn } from './helpers/app.js'

const BUYER = 'priya@example.com'
const RECIPIENT = 'rival@dhol.example'

describe('a transfer recipient', () => {
  it('is four bullets and the domain, whatever the local part', () => {
    const locals = ['r', 'ri', 'riv', 'rival', 'rival.org', 'rival+tickets', 'r'.repeat(40)]
    const shown = locals.map((local) => transferRecipient(`${local}@dhol.example`))

    // One value for all of them: no length, no first or last character, no
    // suffix, and nothing that distinguishes one recipient from another.
    expect(new Set(shown)).toEqual(new Set(['••••@dhol.example']))
  })

  it('says Hidden email for a stored value with no usable domain, rather than invent one', () => {
    expect(transferRecipient('no-at-sign')).toBe('Hidden email')
    expect(transferRecipient(null)).toBe('Hidden email')
  })
})

/**
 * A ticket as the door presenters receive it.
 *
 * @param {string} attendeeName The name on the ticket.
 * @returns {object} The row.
 */
function doorTicket(attendeeName) {
  return {
    attendeeName,
    checkedInAt: null,
    checkIn: null,
    eventSeat: null,
    orderItem: {
      ticketType: { name: 'General admission' },
      order: {
        event: {
          id: 'cevent0000000000000000001',
          title: 'Navratri Garba Night',
          startsAt: new Date('2026-10-11T13:30:00.000Z'),
          endsAt: null,
          timezone: 'Asia/Kolkata',
        },
      },
    },
  }
}

describe('the door', () => {
  it.each([
    ['an address', 'rival@dhol.example', 'Hidden email'],
    ['a name with an address in it', 'Ravi (ravi.k+door@dhol.example)', 'Ravi (Hidden email)'],
    ['a name', 'Ravi Kumar', 'Ravi Kumar'],
  ])('shows %s typed as a name as a name, never as an address', (_case, typed, shown) => {
    const preview = toAdmissionPreview({
      ticket: doorTicket(typed),
      outcome: 'ADMISSIBLE',
      refusal: null,
      method: 'MANUAL_CODE',
      previewReference: null,
      previewExpiresAt: null,
    })
    const result = toAdmissionResult({
      ticket: doorTicket(typed),
      outcome: 'ADMITTED',
      actorId: 'cactor0000000000000000001',
    })

    expect(preview.attendeeName).toBe(shown)
    expect(result.attendeeName).toBe(shown)

    const wire = JSON.stringify([
      admissionPreviewResponseSchema.parse({ data: preview }),
      checkInResponseSchema.parse({ data: { ...result, checkedInAt: new Date() } }),
    ])

    expect(wire).not.toContain('@')
  })

  it('refuses to send an address as a name, if a presenter ever stopped replacing it', () => {
    const preview = toAdmissionPreview({
      ticket: doorTicket('Ravi'),
      outcome: 'ADMISSIBLE',
      refusal: null,
      method: 'MANUAL_CODE',
      previewReference: null,
      previewExpiresAt: null,
    })

    expect(
      admissionPreviewResponseSchema.safeParse({
        data: { ...preview, attendeeName: 'rival@dhol.example' },
      }).success,
    ).toBe(false)
  })
})

/**
 * An outbox row carrying an address everywhere one could hide.
 *
 * @returns {object} The row.
 */
function hostileOutboxRow() {
  return {
    id: 'coutbox000000000000000001',
    template: 'event.cancelled',
    channel: 'EMAIL',
    status: 'DEAD_LETTER',
    recipient: 'priya.sharma+events@example.com',
    recipientMasked: 'p****s@example.com',
    payload: { buyerEmail: 'priya.sharma+events@example.com' },
    dedupeKey: 'event.cancelled|EMAIL|priya.sharma+events@example.com|v1',
    businessEvent: 'event.cancelled:cevent0000000000000000001',
    templateVersion: 1,
    attempts: 5,
    maxAttempts: 5,
    scheduledFor: new Date('2026-09-16T10:00:00Z'),
    sentAt: null,
    lastAttemptAt: new Date('2026-09-16T10:05:00Z'),
    failureCategory: 'PERMANENT',
    lastError: "SEND_FAILED: 550 <o'brien.priya@example.com>: mailbox unavailable",
    leaseExpiresAt: null,
    suppressible: false,
    createdAt: new Date('2026-09-16T09:00:00Z'),
  }
}

describe('the operations queue', () => {
  it('carries no recipient in any form, and no address in the error', () => {
    const presented = toOperatorNotification(hostileOutboxRow())
    const wire = JSON.stringify(notificationSummarySchema.parse(presented))

    expect(presented).not.toHaveProperty('recipient')
    expect(presented).not.toHaveProperty('recipientMasked')
    expect(wire).not.toContain('@')
    expect(wire).not.toContain('priya')
    expect(wire).not.toContain('brien')
    expect(presented.lastError).toBe('SEND_FAILED: 550 <Hidden email>: mailbox unavailable')
  })

  it('refuses an error that still carries an address, if the presenter ever stopped replacing it', () => {
    const presented = toOperatorNotification(hostileOutboxRow())

    expect(
      notificationSummarySchema.safeParse({ ...presented, lastError: 'to priya@example.com' })
        .success,
    ).toBe(false)
  })
})

/**
 * A harness holding one paid order for the fixture buyer, claimed by them.
 *
 * @returns {Promise<object>} The harness, the order reference and its tickets.
 */
async function withOrder() {
  const harness = await createTestApp({ deliver: async () => {} })
  const { app, prisma, ids } = harness

  const order = await app.inject({
    method: 'POST',
    url: '/v1/orders',
    payload: {
      eventId: ids.publishedEvent.id,
      buyerEmail: BUYER,
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
    },
  })

  expect(order.statusCode, order.body).toBe(201)

  const { reference, tickets } = order.json().data

  claim(prisma, tickets, ids.attendee.id)

  return { ...harness, reference, tickets }
}

describe('an order, read by its organisation', () => {
  it.each([
    ['a VIEWER', 'finance@rangoli.example'],
    ['the OWNER', 'owner@rangoli.example'],
  ])('carries no buyer address for %s', async (_who, email) => {
    const { app, reference } = await withOrder()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}`,
      headers: bearer(await signIn(app, email)),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).not.toHaveProperty('buyerEmail')
    expect(response.body).not.toContain(BUYER)
    // What an organisation needs from an order is still there.
    expect(response.json().data.reference).toBe(reference)

    await app.close()
  })

  it('still gives the buyer their own address', async () => {
    const { app, reference } = await withOrder()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}`,
      headers: bearer(await signIn(app, BUYER)),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.buyerEmail).toBe(BUYER)

    await app.close()
  })
})

describe('the audit trail of a transfer', () => {
  it('records who offered it and which transfer, and not the recipient address', async () => {
    const { app, prisma, tickets } = await withOrder()
    const headers = bearer(await signIn(app, BUYER))

    const offered = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers`,
      headers,
      payload: { toEmail: RECIPIENT },
    })

    expect(offered.statusCode, offered.body).toBe(201)

    const withdrawn = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers/cancel`,
      headers,
    })

    expect(withdrawn.statusCode, withdrawn.body).toBe(200)

    const rows = prisma._store.auditLog.filter((row) => row.action.startsWith('ticket.transfer_'))

    expect(rows.map((row) => row.action).sort()).toEqual([
      'ticket.transfer_ended',
      'ticket.transfer_started',
    ])

    for (const row of rows) {
      // Immutable, and outside what a privacy redaction rewrites: an address
      // here would outlive the person asking for it to go.
      expect(row.metadata).not.toHaveProperty('toEmail')
      expect(JSON.stringify(row.metadata)).not.toContain(RECIPIENT)
      expect(JSON.stringify(row.metadata)).not.toContain('@')
      expect(row.metadata.transferId).toBe(offered.json().data.id)
    }

    await app.close()
  })
})

describe('payment metadata', () => {
  it('carries the order reference and nothing that names the buyer', async () => {
    let asked = null

    const payments = {
      async createIntent(input) {
        asked = input

        return { id: 'pi_test_only', status: 'requires_capture' }
      },
      async capture() {
        return { id: 'pi_test_only', status: 'succeeded' }
      },
    }

    await captureOutsideTransaction(payments, {
      id: 'corder0000000000000000001',
      reference: 'DE-TEST',
      buyerEmail: BUYER,
      buyerName: 'Priya Sharma',
      totalCents: 249_900,
      currency: 'INR',
    })

    expect(asked.metadata).toEqual({ reference: 'DE-TEST' })
    expect(JSON.stringify(asked)).not.toContain('@')
  })
})
