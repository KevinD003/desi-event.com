/**
 * Probes for the invariants the per-event booking fee, referral codes and
 * paying at the venue rest on (SPEC3 §5.7), held by the database on its own.
 *
 * The API refuses each of these before it writes, but the API is one writer
 * among several — a seed, a migration, an operator at a `psql` prompt, code
 * not written yet. These probes are the evidence that the rules hold without
 * it:
 *
 *   - **Fee terms.** An event's own fee stores its numbers and currency, within
 *     30.00% and 100.00 per ticket; the site default stores none. A fee
 *     decision is never edited, only its author cleared.
 *   - **The pay-at-the-venue switch.** On only with a limit; a limit of
 *     1-100000; a reason of 10-500 characters.
 *   - **Referral codes.** The code's pattern, one row per text, a use count
 *     never past the limit, an expiry after creation, a switched-off code
 *     stamped, and no deleting a code an order names.
 *   - **Orders.** The fee charged is the gross less the waiver; only a code
 *     waives, and it waives everything; a pay-at-the-venue order owes the
 *     ticket price at the door and pays only the fee and its tax online.
 *   - **The door.** A ticket that owes a payment is not let in until paid,
 *     and is handed on like any other ticket (open question 7); its payment is
 *     set once, to a payment of its own order; a payment is never edited or
 *     deleted, and equals the tickets it paid for at commit — and goes on
 *     equalling them after it committed: no ticket joins it later, changes
 *     what it owes, or leaves it.
 *
 * Every probe runs inside a transaction that is always rolled back, against a
 * disposable database `verify-fresh-database.mjs` created and will destroy —
 * except the commit-time probes. One commits a booking paid in part at the
 * door, which the disposable database keeps (nothing downstream counts its
 * rows); each of the others must fail to commit. A refusal counts only when
 * it names the constraint, index or trigger being probed, so a probe cannot
 * pass on some other rule's error.
 *
 * @module @desi-event/db/scripts/payment-terms-probes
 */

import { randomUUID } from 'node:crypto'

/** A day, in milliseconds. */
const DAY_MS = 86_400_000

/** A reason inside every 10-500 character bound. */
const REASON = 'Checked by the fresh-database probes.'

/** PostgreSQL's SQLSTATE for a CHECK or a trigger raising one, as Prisma reports it. */
const CHECK_STATE = /23514/

/** A unique violation, however the driver words it. */
const DUPLICATE = /P2002|duplicate key|unique constraint/i

/** A foreign key refusing a delete, however the driver words it. */
const RESTRICTED = /P2003|P2014|foreign key|violates RESTRICT|still referenced/i

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
 * A referral code's text no other probe row has: upper case, 11 characters.
 *
 * @returns {string} A text matching `referral_code_shape`.
 */
function codeText() {
  return `PRB${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

/**
 * A minimal US event with no nights.
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
 * An account no other probe row names.
 *
 * @param {object} tx A transaction client.
 * @returns {Promise<object>} The user row.
 */
function stranger(tx) {
  return tx.user.create({
    data: {
      email: `${unique('user')}@example.test`,
      passwordHash: 'probe-not-a-hash',
      displayName: 'Probe Stranger',
    },
  })
}

/**
 * A pay-at-the-venue booking as settlement leaves it: one event, one $40 tier,
 * a PAID order owing the ticket prices at the door and the site default's
 * booking fee online, its line, and one VALID ticket per share.
 *
 * @param {object} tx A transaction client.
 * @param {object} world The seeded rows.
 * @param {string} world.organizationId The organisation.
 * @param {string} world.userId The buyer.
 * @param {object} [options] Shape of the booking.
 * @param {number[]} [options.shares] Each ticket's share of the door price, in cents.
 * @param {object} [options.order] Order column overrides.
 * @returns {Promise<object>} The rows: `event`, `order`, `line` and `tickets`.
 */
async function venueBooking(tx, { organizationId, userId }, { shares = [4000], order = {} } = {}) {
  const event = await probeEvent(tx, organizationId)
  const due = shares.reduce((sum, share) => sum + share, 0)
  const tier = await tx.ticketType.create({
    data: {
      eventId: event.id,
      name: unique('tier'),
      priceCents: Math.max(...shares, 0),
      currency: 'USD',
      quantityTotal: 50,
      status: 'ON_SALE',
    },
  })
  const fee = 335
  const created = await tx.order.create({
    data: {
      reference: unique('order').toUpperCase(),
      eventId: event.id,
      userId,
      buyerEmail: 'probe-buyer@example.test',
      buyerName: 'Probe Buyer',
      status: 'PAID',
      currency: 'USD',
      subtotalCents: due,
      discountCents: 0,
      feesCents: fee,
      feeGrossCents: fee,
      taxCents: 0,
      totalCents: fee,
      paymentMethod: 'AT_VENUE',
      feePercentageBps: 590,
      feeFlatCentsPerTicket: 99,
      venueDueCents: due,
      paidAt: new Date(),
      ...order,
    },
  })
  const line = await tx.orderItem.create({
    data: {
      orderId: created.id,
      ticketTypeId: tier.id,
      quantity: shares.length,
      unitPriceCents: Math.max(...shares, 0),
      subtotalCents: Math.max(due, Math.max(...shares, 0) * shares.length),
      venueDueCents: due,
    },
  })
  const tickets = []

  for (const share of shares) {
    tickets.push(
      await tx.ticket.create({
        data: {
          orderItemId: line.id,
          code: unique('ticket').toUpperCase(),
          ownerUserId: userId,
          venueDueCents: share,
        },
      }),
    )
  }

  return { event, order: created, line, tickets }
}

/**
 * A payment taken at the door for some of a booking's tickets, as
 * `lib/venue-payments.js` writes it: the row, then each ticket pointed at it.
 *
 * @param {object} tx A transaction client.
 * @param {object} booking From {@link venueBooking}: its `event` and `order`.
 * @param {object[]} tickets The tickets it pays for.
 * @param {object} [overrides] Column overrides.
 * @param {boolean} [overrides.point] Whether to point the tickets at it (default true).
 * @returns {Promise<object>} The payment row.
 */
async function venuePayment(tx, booking, tickets, { point = true, ...overrides } = {}) {
  const payment = await tx.venuePayment.create({
    data: {
      orderId: booking.order.id,
      eventId: booking.event.id,
      organizationId: booking.event.organizationId,
      amountCents: tickets.reduce((sum, ticket) => sum + ticket.venueDueCents, 0),
      currency: 'USD',
      ticketCount: tickets.length,
      via: tickets.length > 1 ? 'DOOR_GROUP' : 'DOOR_TICKET',
      authority: 'ORGANIZATION_ROLE',
      role: 'OWNER',
      ...overrides,
    },
  })

  if (point) {
    for (const ticket of tickets) {
      await tx.ticket.update({ where: { id: ticket.id }, data: { venuePaymentId: payment.id } })
    }
  }

  return payment
}

/**
 * Fire the deferred payment-sum checks now — the payment's own
 * (`desi_venue_payment_sum`) and each written ticket's
 * (`desi_ticket_venue_payment_sum`, `desi_ticket_venue_payment_sum_on_delete`)
 * — inside the probe's transaction, as COMMIT would.
 *
 * @param {object} tx A transaction client.
 * @returns {Promise<unknown>} Resolves when the pending checks have run.
 */
function checkPaymentSumsNow(tx) {
  return tx.$executeRawUnsafe(
    'SET CONSTRAINTS desi_venue_payment_sum, desi_ticket_venue_payment_sum, ' +
      'desi_ticket_venue_payment_sum_on_delete IMMEDIATE',
  )
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
export async function runPaymentTermsProbes(prisma, { probe, record }) {
  const [organization, user] = await Promise.all([
    prisma.organization.findFirst({
      where: { platformHeldSource: null },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.user.findFirst({ orderBy: { createdAt: 'asc' } }),
  ])

  if (!organization || !user) {
    return record('the payment-terms probes have the seeded rows they need', false, {
      note: 'the seed did not produce an organisation and a user',
    })
  }

  const world = { organizationId: organization.id, userId: user.id }
  const results = []

  /**
   * One probe. A refusal must name `expected` and, when `state` is set, carry
   * SQLSTATE 23514 too.
   *
   * @param {string} name What is being shown.
   * @param {RegExp|null} expected The refusal expected, or null when the write must be accepted.
   * @param {function(object): Promise<unknown>} write The write, given the transaction.
   * @returns {Promise<void>} Resolves once recorded.
   */
  const check = async (name, expected, write) => {
    results.push(await probe(prisma, name, expected, write))
  }

  /**
   * A refusal that must carry SQLSTATE 23514 and name the constraint.
   *
   * @param {string} constraint The constraint or trigger name.
   * @returns {RegExp} Matches the probe's error detail.
   */
  const refusedBy = (constraint) =>
    new RegExp(
      `${CHECK_STATE.source}[\\s\\S]*${constraint}|${constraint}[\\s\\S]*${CHECK_STATE.source}`,
    )

  // -------------------------------------------------------------------------
  // 1-3. An event's own booking fee
  // -------------------------------------------------------------------------

  await check('an EVENT fee with no percentage is refused', /event_fee_shape/, async (tx) => {
    const event = await probeEvent(tx, organization.id)
    await tx.event.update({
      where: { id: event.id },
      data: { feeSource: 'EVENT', feeFlatCentsPerTicket: 149, feeCurrency: 'USD' },
    })
  })

  await check('an EVENT fee with no currency is refused', /event_fee_shape/, async (tx) => {
    const event = await probeEvent(tx, organization.id)
    await tx.event.update({
      where: { id: event.id },
      data: { feeSource: 'EVENT', feePercentageBps: 300, feeFlatCentsPerTicket: 149 },
    })
  })

  await check(
    'a SITE_DEFAULT event carrying a percentage is refused',
    /event_fee_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      await tx.event.update({ where: { id: event.id }, data: { feePercentageBps: 300 } })
    },
  )

  await check('an EVENT fee of 3001 basis points is refused', /event_fee_shape/, async (tx) => {
    const event = await probeEvent(tx, organization.id)
    await tx.event.update({
      where: { id: event.id },
      data: {
        feeSource: 'EVENT',
        feePercentageBps: 3001,
        feeFlatCentsPerTicket: 0,
        feeCurrency: 'USD',
      },
    })
  })

  await check('an EVENT fee of 10001 per ticket is refused', /event_fee_shape/, async (tx) => {
    const event = await probeEvent(tx, organization.id)
    await tx.event.update({
      where: { id: event.id },
      data: {
        feeSource: 'EVENT',
        feePercentageBps: 0,
        feeFlatCentsPerTicket: 10001,
        feeCurrency: 'USD',
      },
    })
  })

  await check(
    'an EVENT fee of 3000 basis points and 10000 per ticket is accepted',
    null,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      const setting = await tx.eventFeeSetting.create({
        data: {
          eventId: event.id,
          sequence: 1,
          source: 'EVENT',
          percentageBps: 3000,
          flatCentsPerTicket: 10000,
          currency: 'USD',
          reason: REASON,
          setById: user.id,
        },
      })
      await tx.event.update({
        where: { id: event.id },
        data: {
          feeSource: 'EVENT',
          feePercentageBps: 3000,
          feeFlatCentsPerTicket: 10000,
          feeCurrency: 'USD',
          feeSettingId: setting.id,
        },
      })
    },
  )

  await check(
    'a fee decision of 3001 basis points is refused',
    /event_fee_setting_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      await tx.eventFeeSetting.create({
        data: {
          eventId: event.id,
          sequence: 1,
          source: 'EVENT',
          percentageBps: 3001,
          flatCentsPerTicket: 0,
          currency: 'USD',
          reason: REASON,
        },
      })
    },
  )

  await check(
    'a fee decision with a nine-character reason is refused',
    /event_fee_setting_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      await tx.eventFeeSetting.create({
        data: { eventId: event.id, sequence: 1, source: 'SITE_DEFAULT', reason: 'Too short' },
      })
    },
  )

  // -------------------------------------------------------------------------
  // 4. A fee decision is never edited
  // -------------------------------------------------------------------------

  /**
   * An event with one SITE_DEFAULT fee decision.
   *
   * @param {object} tx A transaction client.
   * @returns {Promise<object>} The rows: `event` and `setting`.
   */
  const decided = async (tx) => {
    const event = await probeEvent(tx, organization.id)
    const setting = await tx.eventFeeSetting.create({
      data: {
        eventId: event.id,
        sequence: 1,
        source: 'SITE_DEFAULT',
        reason: REASON,
        setById: user.id,
      },
    })

    return { event, setting }
  }

  await check(
    "a fee decision's reason cannot be edited (SQLSTATE 23514)",
    refusedBy('event_fee_setting_append_only'),
    async (tx) => {
      const { setting } = await decided(tx)
      await tx.eventFeeSetting.update({
        where: { id: setting.id },
        data: { reason: 'A different reason entirely.' },
      })
    },
  )

  await check(
    "a fee decision's author cannot be changed to someone else",
    refusedBy('event_fee_setting_append_only'),
    async (tx) => {
      const { setting } = await decided(tx)
      const someoneElse = await stranger(tx)
      await tx.eventFeeSetting.update({
        where: { id: setting.id },
        data: { setById: someoneElse.id },
      })
    },
  )

  await check("a fee decision's author can be cleared", null, async (tx) => {
    const { setting } = await decided(tx)
    await tx.eventFeeSetting.update({ where: { id: setting.id }, data: { setById: null } })
  })

  await check(
    'a fee decision cannot be deleted while its event exists',
    refusedBy('event_fee_setting_append_only'),
    async (tx) => {
      const { setting } = await decided(tx)
      await tx.eventFeeSetting.delete({ where: { id: setting.id } })
    },
  )

  await check('removing an event row takes its fee decisions with it', null, async (tx) => {
    const { event } = await decided(tx)
    await tx.event.delete({ where: { id: event.id } })
  })

  await check('two fee decisions cannot share a sequence', DUPLICATE, async (tx) => {
    const { event } = await decided(tx)
    await tx.eventFeeSetting.create({
      data: { eventId: event.id, sequence: 1, source: 'SITE_DEFAULT', reason: REASON },
    })
  })

  // -------------------------------------------------------------------------
  // 5. The pay-at-the-venue switch
  // -------------------------------------------------------------------------

  await check(
    'switching paying at the venue on without a limit is refused',
    /event_venue_payment_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      await tx.event.update({
        where: { id: event.id },
        data: {
          venuePaymentEnabled: true,
          venuePaymentChangedAt: new Date(),
          venuePaymentReason: REASON,
        },
      })
    },
  )

  await check('a venue limit of 0 is refused', /event_venue_payment_shape/, async (tx) => {
    const event = await probeEvent(tx, organization.id)
    await tx.event.update({
      where: { id: event.id },
      data: {
        venuePaymentEnabled: true,
        venuePaymentLimit: 0,
        venuePaymentChangedAt: new Date(),
        venuePaymentReason: REASON,
      },
    })
  })

  await check(
    'a nine-character switch reason is refused',
    /event_venue_payment_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      await tx.event.update({
        where: { id: event.id },
        data: {
          venuePaymentEnabled: true,
          venuePaymentLimit: 50,
          venuePaymentChangedAt: new Date(),
          venuePaymentReason: 'Too short',
        },
      })
    },
  )

  await check('switching on with a limit, a time and a reason is accepted', null, async (tx) => {
    const event = await probeEvent(tx, organization.id)
    await tx.event.update({
      where: { id: event.id },
      data: {
        venuePaymentEnabled: true,
        venuePaymentLimit: 100_000,
        venuePaymentChangedAt: new Date(),
        venuePaymentChangedById: user.id,
        venuePaymentReason: REASON,
      },
    })
    await tx.eventVenuePaymentChange.create({
      data: {
        eventId: event.id,
        enabled: true,
        limit: 100_000,
        reason: REASON,
        changedById: user.id,
      },
    })
  })

  await check(
    'a switch change turning it on without a limit is refused',
    /event_venue_payment_change_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      await tx.eventVenuePaymentChange.create({
        data: { eventId: event.id, enabled: true, reason: REASON },
      })
    },
  )

  await check(
    'a switch change with a nine-character reason is refused',
    /event_venue_payment_change_shape/,
    async (tx) => {
      const event = await probeEvent(tx, organization.id)
      await tx.eventVenuePaymentChange.create({
        data: { eventId: event.id, enabled: false, limit: 5, reason: 'Too short' },
      })
    },
  )

  // -------------------------------------------------------------------------
  // 6-7. Referral codes
  // -------------------------------------------------------------------------

  /**
   * A referral code row.
   *
   * @param {object} tx A transaction client.
   * @param {object} [overrides] Column overrides.
   * @returns {Promise<object>} The row.
   */
  const referral = (tx, overrides = {}) =>
    tx.referralCode.create({
      data: { code: codeText(), scope: 'ALL_EVENTS', createdById: user.id, ...overrides },
    })

  for (const [label, code] of [
    ['a lower-case referral code is refused', 'probe-lower1'],
    ['a five-character referral code is refused', 'ABCDE'],
    ['a referral code with "--" is refused', 'ABC--DEF12'],
    ['a referral code ending in "-" is refused', 'ABCDEF12-'],
    ['a referral code starting with "-" is refused', '-ABCDEF12'],
    ['a 33-character referral code is refused', 'A'.repeat(33)],
  ]) {
    await check(label, /referral_code_shape/, (tx) => referral(tx, { code }))
  }

  await check('a six- and a 32-character referral code are accepted', null, async (tx) => {
    await referral(tx, { code: `A${codeText().slice(-5)}` })
    await referral(tx, { code: `${codeText()}${'B'.repeat(21)}` })
  })

  await check('two referral codes cannot share a text', DUPLICATE, async (tx) => {
    const first = await referral(tx)
    await referral(tx, { code: first.code })
  })

  await check(
    'a use count above the limit is refused by its own constraint',
    /referral_code_use_within_limit/,
    async (tx) => {
      const row = await referral(tx, { maxUses: 1, useCount: 1 })
      await tx.referralCode.update({ where: { id: row.id }, data: { useCount: 2 } })
    },
  )

  await check('a referral code limit of 0 is refused', /referral_code_shape/, (tx) =>
    referral(tx, { maxUses: 0 }),
  )

  await check(
    'a referral code expiring before it was made is refused',
    /referral_code_shape/,
    (tx) => referral(tx, { createdAt: new Date(), expiresAt: new Date(Date.now() - 60_000) }),
  )

  await check(
    'a referral code switched off without a time is refused',
    /referral_code_shape/,
    (tx) => referral(tx, { active: false }),
  )

  await check('a referral code switched off with a time is accepted', null, (tx) =>
    referral(tx, { active: false, switchedOffAt: new Date() }),
  )

  await check('a referral label of only spaces is refused', /referral_code_shape/, (tx) =>
    referral(tx, { label: '   ' }),
  )

  // -------------------------------------------------------------------------
  // 8. An order's booking fee
  // -------------------------------------------------------------------------

  await check(
    'an order whose fee is not its gross less its waiver is refused',
    /order_fee_parts/,
    (tx) => venueBooking(tx, world, { order: { feeGrossCents: 400 } }),
  )

  await check('a waiver without a referral code is refused', /order_fee_waiver_whole/, (tx) =>
    venueBooking(tx, world, {
      order: { feesCents: 0, feeWaivedCents: 335, totalCents: 0 },
    }),
  )

  await check(
    'a referral code waiving part of the fee is refused',
    /order_fee_waiver_whole/,
    async (tx) => {
      const code = await referral(tx)
      await venueBooking(tx, world, {
        order: { feesCents: 35, feeWaivedCents: 300, totalCents: 35, referralCodeId: code.id },
      })
    },
  )

  await check('a referral code waiving the whole fee is accepted', null, async (tx) => {
    const code = await referral(tx, { useCount: 1, maxUses: 1 })
    await venueBooking(tx, world, {
      order: { feesCents: 0, feeWaivedCents: 335, totalCents: 0, referralCodeId: code.id },
    })
  })

  await check(
    'an order recording one fee term without the other is refused',
    /order_fee_terms_shape/,
    (tx) => venueBooking(tx, world, { order: { feeFlatCentsPerTicket: null } }),
  )

  await check(
    'an EVENT order with neither its setting nor its numbers is refused',
    /order_fee_terms_shape/,
    (tx) =>
      venueBooking(tx, world, {
        order: { feeSource: 'EVENT', feePercentageBps: null, feeFlatCentsPerTicket: null },
      }),
  )

  // -------------------------------------------------------------------------
  // 9. What a pay-at-the-venue order pays where
  // -------------------------------------------------------------------------

  await check(
    'a pay-at-the-venue order charging more online than its fee and tax is refused',
    /order_venue_payment_shape/,
    (tx) => venueBooking(tx, world, { order: { totalCents: 4335 } }),
  )

  await check(
    'a pay-at-the-venue order owing other than its ticket price at the door is refused',
    /order_venue_payment_shape/,
    (tx) => venueBooking(tx, world, { order: { venueDueCents: 3900 } }),
  )

  await check(
    'a pay-at-the-venue order owing nothing at the door is refused',
    /order_venue_payment_shape/,
    (tx) => venueBooking(tx, world, { shares: [0], order: { venueDueCents: 0, subtotalCents: 0 } }),
  )

  await check('a pay-at-the-venue order with tax on its fee online is accepted', null, (tx) =>
    venueBooking(tx, world, { order: { taxCents: 120, totalCents: 335 + 120 } }),
  )

  await check(
    'a card order owing something at the door is refused',
    /order_venue_payment_shape/,
    (tx) =>
      venueBooking(tx, world, {
        order: { paymentMethod: 'CARD', totalCents: 4335 },
      }),
  )

  await check(
    'an order line owing more at the door than its subtotal is refused',
    /order_item_venue_due_shape/,
    async (tx) => {
      const { line } = await venueBooking(tx, world)
      await tx.orderItem.update({
        where: { id: line.id },
        data: { venueDueCents: line.subtotalCents + 1 },
      })
    },
  )

  // -------------------------------------------------------------------------
  // 10. A ticket is paid at the door only if it owes something there
  // -------------------------------------------------------------------------

  await check(
    'a ticket with a payment and nothing due is refused',
    /ticket_venue_due_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const payment = await venuePayment(tx, booking, booking.tickets, { point: false })
      await tx.ticket.create({
        data: {
          orderItemId: booking.line.id,
          code: unique('ticket').toUpperCase(),
          venueDueCents: 0,
          venuePaymentId: payment.id,
        },
      })
    },
  )

  await check(
    'a ticket owing a negative amount is refused',
    /ticket_venue_due_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.ticket.create({
        data: {
          orderItemId: booking.line.id,
          code: unique('ticket').toUpperCase(),
          venueDueCents: -1,
        },
      })
    },
  )

  // -------------------------------------------------------------------------
  // 11. Not let in until paid
  // -------------------------------------------------------------------------

  await check(
    'an unpaid ticket owing a payment is not let in (SQLSTATE 23514, check_in_payment_due)',
    refusedBy('check_in_payment_due'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.checkIn.create({ data: { ticketId: booking.tickets[0].id, method: 'MANUAL_CODE' } })
    },
  )

  await check('a ticket whose payment is recorded is let in', null, async (tx) => {
    const booking = await venueBooking(tx, world)
    await venuePayment(tx, booking, booking.tickets)
    await tx.checkIn.create({ data: { ticketId: booking.tickets[0].id, method: 'MANUAL_CODE' } })
    await checkPaymentSumsNow(tx)
  })

  await check(
    'a ticket of a booking owing nothing for it is let in without a payment',
    null,
    async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 0] })
      await tx.checkIn.create({ data: { ticketId: booking.tickets[1].id, method: 'MANUAL_CODE' } })
    },
  )

  // -------------------------------------------------------------------------
  // 12. Handed on like any other ticket (open question 7)
  // -------------------------------------------------------------------------

  // The owner's answer: a ticket that owes a payment at the door can be passed
  // on, and its new holder pays at the door. The database must not refuse it.
  await check(
    'a ticket owing a payment at the door can be handed on (open question 7)',
    null,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { status: 'TRANSFER_PENDING' },
      })
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { status: 'TRANSFERRED' },
      })
    },
  )

  await check(
    'a ticket owing a payment at the door is still not handed on once let in',
    /cannot be handed on|has been checked in/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await venuePayment(tx, booking, booking.tickets)
      await tx.checkIn.create({ data: { ticketId: booking.tickets[0].id, method: 'MANUAL_CODE' } })
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { status: 'TRANSFER_PENDING' },
      })
    },
  )

  // -------------------------------------------------------------------------
  // 13. A ticket's payment is set once, to its own order's; a payment is final
  // -------------------------------------------------------------------------

  await check(
    "a ticket's payment cannot be changed once set",
    refusedBy('ticket_venue_payment_fixed'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await venuePayment(tx, booking, booking.tickets)
      const second = await venuePayment(tx, booking, booking.tickets, { point: false })
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { venuePaymentId: second.id },
      })
    },
  )

  await check(
    "a ticket's payment cannot be cleared once set",
    refusedBy('ticket_venue_payment_fixed'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await venuePayment(tx, booking, booking.tickets)
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { venuePaymentId: null },
      })
    },
  )

  await check(
    "a ticket cannot be pointed at another order's payment",
    refusedBy('venue_payment_order'),
    async (tx) => {
      const mine = await venueBooking(tx, world)
      const theirs = await venueBooking(tx, world)
      const payment = await venuePayment(tx, theirs, theirs.tickets, { point: false })
      await tx.ticket.update({
        where: { id: mine.tickets[0].id },
        data: { venuePaymentId: payment.id },
      })
    },
  )

  await check(
    'a ticket owing nothing cannot be pointed at a payment',
    refusedBy('venue_payment_order'),
    async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 0] })
      const payment = await venuePayment(tx, booking, [booking.tickets[0]], { point: false })
      await tx.ticket.update({
        where: { id: booking.tickets[1].id },
        data: { venuePaymentId: payment.id },
      })
    },
  )

  await check(
    "a payment's amount cannot be edited",
    refusedBy('venue_payment_append_only'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const payment = await venuePayment(tx, booking, booking.tickets)
      await tx.venuePayment.update({ where: { id: payment.id }, data: { amountCents: 1 } })
    },
  )

  await check('a payment cannot be deleted', refusedBy('venue_payment_append_only'), async (tx) => {
    const booking = await venueBooking(tx, world)
    const payment = await venuePayment(tx, booking, [], {
      point: false,
      amountCents: 1,
      ticketCount: 1,
    })
    await tx.venuePayment.delete({ where: { id: payment.id } })
  })

  await check("a payment's recorder and night can be cleared", null, async (tx) => {
    const booking = await venueBooking(tx, world)
    const night = await tx.eventSession.create({
      data: {
        eventId: booking.event.id,
        startsAt: booking.event.startsAt,
        endsAt: booking.event.endsAt,
      },
    })
    const payment = await venuePayment(tx, booking, booking.tickets, {
      recordedById: user.id,
      eventSessionId: night.id,
    })
    await tx.venuePayment.update({
      where: { id: payment.id },
      data: { recordedById: null, eventSessionId: null },
    })
  })

  await check(
    "a payment's recorder cannot be changed to someone else",
    refusedBy('venue_payment_append_only'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const payment = await venuePayment(tx, booking, booking.tickets, { recordedById: user.id })
      const someoneElse = await stranger(tx)
      await tx.venuePayment.update({
        where: { id: payment.id },
        data: { recordedById: someoneElse.id },
      })
    },
  )

  // -------------------------------------------------------------------------
  // 14. A payment equals the tickets it paid for; the door's authorities
  // -------------------------------------------------------------------------

  await check(
    'a payment whose tickets owe less than it is refused when its checks run',
    refusedBy('venue_payment_sum'),
    async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 4000] })
      await venuePayment(tx, booking, [booking.tickets[0]], {
        amountCents: 8000,
        ticketCount: 2,
      })
      await checkPaymentSumsNow(tx)
    },
  )

  await check(
    'a payment no ticket points at is refused when its checks run',
    refusedBy('venue_payment_sum'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await venuePayment(tx, booking, booking.tickets, { point: false })
      await checkPaymentSumsNow(tx)
    },
  )

  await check('a group payment equal to its tickets passes its checks', null, async (tx) => {
    const booking = await venueBooking(tx, world, { shares: [4000, 3999] })
    await venuePayment(tx, booking, booking.tickets)
    await checkPaymentSumsNow(tx)
  })

  // At commit, with no SET CONSTRAINTS: the transaction is meant to fail, and
  // takes every row it wrote with it.
  let committed = false
  let commitError = ''
  const reference = unique('commit-order').toUpperCase()

  try {
    await prisma.$transaction(async (tx) => {
      const booking = await venueBooking(tx, world, {
        shares: [4000, 4000],
        order: { reference },
      })
      await venuePayment(tx, booking, [booking.tickets[0]], { amountCents: 8000, ticketCount: 2 })
    })
    committed = true
  } catch (error) {
    commitError = `${error?.code ?? ''} ${error?.message ?? error}`.replace(/\s+/g, ' ')
  }

  const leftBehind = await prisma.order.count({ where: { reference } })

  results.push(
    record(
      'a payment whose tickets do not sum to it is refused at commit (venue_payment_sum)',
      !committed && /venue_payment_sum/.test(commitError) && leftBehind === 0,
      {
        note: committed
          ? 'the transaction committed, which it must not'
          : /venue_payment_sum/.test(commitError)
            ? 'refused at commit; nothing written'
            : commitError.slice(0, 160),
      },
    ),
  )

  // After it committed, a payment goes on equalling its tickets. A booking of
  // three tickets, two of them paid at the door by one payment, is committed
  // here; each later write below, in its own transaction, is meant to fail at
  // commit and leave that booking as it was.
  let settled = null
  let settleError = ''

  try {
    settled = await prisma.$transaction(async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 3999, 4000] })
      const payment = await venuePayment(tx, booking, booking.tickets.slice(0, 2))

      return { booking, payment }
    })
  } catch (error) {
    settleError = `${error?.code ?? ''} ${error?.message ?? error}`.replace(/\s+/g, ' ')
  }

  results.push(
    record('a group payment equal to its tickets commits', settled !== null, {
      note: settled ? 'committed' : settleError.slice(0, 160),
    }),
  )

  if (settled) {
    const { booking, payment } = settled
    const [first, second, unpaid] = booking.tickets

    /**
     * A write in its own transaction that must fail at commit, naming
     * `venue_payment_sum`, and change nothing.
     *
     * @param {string} name What is being shown.
     * @param {function(object): Promise<unknown>} write The write, given the transaction.
     * @returns {Promise<void>} Resolves once recorded.
     */
    const refusedAtCommit = async (name, write) => {
      let committed = false
      let detail = ''

      try {
        await prisma.$transaction(write)
        committed = true
      } catch (error) {
        detail = `${error?.code ?? ''} ${error?.message ?? error}`.replace(/\s+/g, ' ')
      }

      const matched = !committed && /venue_payment_sum/.test(detail)

      results.push(
        record(name, matched, {
          note: committed
            ? 'the transaction committed, which it must not'
            : matched
              ? 'refused at commit; nothing written'
              : detail.slice(0, 160),
        }),
      )
    }

    await refusedAtCommit(
      'an unpaid ticket pointed later at a committed payment is refused at commit (venue_payment_sum)',
      (tx) => tx.ticket.update({ where: { id: unpaid.id }, data: { venuePaymentId: payment.id } }),
    )

    await refusedAtCommit(
      "a paid ticket's due changed after its payment committed is refused at commit (venue_payment_sum)",
      (tx) => tx.ticket.update({ where: { id: first.id }, data: { venueDueCents: 1 } }),
    )

    await refusedAtCommit(
      'a ticket inserted already pointing at a committed payment is refused at commit (venue_payment_sum)',
      (tx) =>
        tx.ticket.create({
          data: {
            orderItemId: booking.line.id,
            code: unique('ticket').toUpperCase(),
            ownerUserId: user.id,
            venueDueCents: 4000,
            venuePaymentId: payment.id,
          },
        }),
    )

    await refusedAtCommit(
      'a paid ticket removed after its payment committed is refused at commit (venue_payment_sum)',
      (tx) => tx.ticket.delete({ where: { id: second.id } }),
    )

    const pointing = await prisma.ticket.findMany({
      where: { venuePaymentId: payment.id },
      select: { id: true, venueDueCents: true },
      orderBy: { venueDueCents: 'desc' },
    })
    const stillUnpaid = await prisma.ticket.findUnique({ where: { id: unpaid.id } })
    const unchanged =
      pointing.length === 2 &&
      pointing[0].id === first.id &&
      pointing[0].venueDueCents === 4000 &&
      pointing[1].id === second.id &&
      pointing[1].venueDueCents === 3999 &&
      stillUnpaid?.venuePaymentId === null

    results.push(
      record(
        'after them, the committed payment still names exactly the two tickets it paid for',
        unchanged,
        {
          note:
            pointing.map((ticket) => `${ticket.venueDueCents}`).join(' + ') +
            `; third ticket ${stillUnpaid?.venuePaymentId === null ? 'unpaid' : 'paid'}`,
        },
      ),
    )
  }

  await check("a payment taken under an event scope's authority is accepted", null, async (tx) => {
    const booking = await venueBooking(tx, world)
    await venuePayment(tx, booking, booking.tickets, { authority: 'EVENT_SCOPE', role: 'SCANNER' })
    await checkPaymentSumsNow(tx)
  })

  await check(
    "a payment naming 'ORGANIZATION' as its authority is refused",
    /venue_payment_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await venuePayment(tx, booking, booking.tickets, { authority: 'ORGANIZATION' })
    },
  )

  await check('a payment of 0 is refused', /venue_payment_shape/, async (tx) => {
    const booking = await venueBooking(tx, world)
    await venuePayment(tx, booking, [], { point: false, amountCents: 0, ticketCount: 1 })
  })

  await check('a payment for 101 tickets is refused', /venue_payment_shape/, async (tx) => {
    const booking = await venueBooking(tx, world)
    await venuePayment(tx, booking, [], { point: false, amountCents: 100, ticketCount: 101 })
  })

  await check('a payment with no role is refused', /venue_payment_shape/, async (tx) => {
    const booking = await venueBooking(tx, world)
    await venuePayment(tx, booking, booking.tickets, { point: false, role: '' })
  })

  // -------------------------------------------------------------------------
  // 15. A code an order used is never deleted
  // -------------------------------------------------------------------------

  await check('a referral code an order names cannot be deleted', RESTRICTED, async (tx) => {
    const code = await referral(tx, { useCount: 1 })
    await venueBooking(tx, world, {
      order: { feesCents: 0, feeWaivedCents: 335, totalCents: 0, referralCodeId: code.id },
    })
    await tx.referralCode.delete({ where: { id: code.id } })
  })

  await check('removing a referral code takes its event scope with it', null, async (tx) => {
    const event = await probeEvent(tx, organization.id)
    const code = await referral(tx, { scope: 'SELECTED_EVENTS' })
    await tx.referralCodeEvent.create({ data: { referralCodeId: code.id, eventId: event.id } })
    await tx.referralCode.delete({ where: { id: code.id } })
  })

  return results.every(Boolean)
}
