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
 *   - **Unpaid tickets cancelled (SPEC3-XI XU).** A cancellation has its
 *     shape, equals the tickets it cancelled at commit and goes on equalling
 *     them, and is never edited; a ticket is cancelled once, by a cancellation
 *     of its own order, while it is unpaid, never let in, and withdrawn in the
 *     same change; a cancelled ticket is never paid or let in; an order's kept
 *     fee stays within its fee and, with what is refunded, within what it took
 *     online; a line's refunded and cancelled tickets stay within it; a tier's
 *     sold count never goes below 0.
 *   - **Referral returns (SPEC3-XI XR).** A return marker has its cause and a
 *     code, is set once and never changed, and the code an order used never
 *     changes.
 *   - **What is due stays with a ticket (open question 7).** A successor owes
 *     what its predecessor owed, no ticket's due changes, and a ticket is
 *     issued neither paid nor cancelled.
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
 * Cancel unpaid tickets of a booking, as `lib/venue-bookings.js` writes it: the
 * cancellation row, then each ticket withdrawn and pointed at it.
 *
 * @param {object} tx A transaction client.
 * @param {object} booking From {@link venueBooking}: its `event` and `order`.
 * @param {object[]} tickets The tickets it cancels.
 * @param {object} [overrides] Column overrides.
 * @param {boolean} [overrides.point] Whether to withdraw the tickets and point them at it (default true).
 * @returns {Promise<object>} The cancellation row.
 */
async function cancelUnpaid(tx, booking, tickets, { point = true, ...overrides } = {}) {
  const cancellation = await tx.venueBookingCancellation.create({
    data: {
      orderId: booking.order.id,
      eventId: booking.event.id,
      organizationId: booking.event.organizationId,
      ticketCount: tickets.length,
      basisCents: tickets.reduce((sum, ticket) => sum + ticket.venueDueCents, 0),
      feeKeptCents: 0,
      currency: 'USD',
      authority: 'ORGANIZATION_ROLE',
      role: 'OWNER',
      reason: REASON,
      ...overrides,
    },
  })

  if (point) {
    for (const ticket of tickets) {
      await withdrawUnpaid(tx, ticket, cancellation)
    }
  }

  return cancellation
}

/**
 * Withdraw one ticket as cancelled unpaid by a cancellation, in one change.
 *
 * @param {object} tx A transaction client.
 * @param {object} ticket The ticket.
 * @param {object} cancellation The cancellation row.
 * @returns {Promise<object>} The updated ticket.
 */
function withdrawUnpaid(tx, ticket, cancellation) {
  return tx.ticket.update({
    where: { id: ticket.id },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedReason: `venue-unpaid:${cancellation.id}`,
      credentialHash: null,
      venueCancellationId: cancellation.id,
    },
  })
}

/**
 * Fire the deferred cancellation-sum checks now — the cancellation's own
 * (`desi_venue_booking_cancellation_sum`) and each written ticket's
 * (`desi_ticket_venue_cancellation_sum`,
 * `desi_ticket_venue_cancellation_sum_on_delete`) — as COMMIT would.
 *
 * @param {object} tx A transaction client.
 * @returns {Promise<unknown>} Resolves when the pending checks have run.
 */
function checkCancellationSumsNow(tx) {
  return tx.$executeRawUnsafe(
    'SET CONSTRAINTS desi_venue_booking_cancellation_sum, desi_ticket_venue_cancellation_sum, ' +
      'desi_ticket_venue_cancellation_sum_on_delete IMMEDIATE',
  )
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

  /**
   * A write in its own transaction that must fail — at commit, for the
   * deferred sums — naming `constraint`, and change nothing.
   *
   * With `setAside`, that trigger on "Ticket" is disabled inside the
   * transaction before the write, so a rule further back can be shown to hold
   * on its own. The transaction is meant to fail, which takes the disabling
   * with it; should it commit, the trigger is enabled again at once.
   *
   * @param {boolean[]} into Where to record the outcome.
   * @param {string} name What is being shown.
   * @param {function(object): Promise<unknown>} write The write, given the transaction.
   * @param {object} [options] What to expect.
   * @param {string} [options.constraint] The refusal expected (default `venue_payment_sum`).
   * @param {string} [options.setAside] A trigger on "Ticket" to disable for this transaction.
   * @returns {Promise<void>} Resolves once recorded.
   */
  const refusedAtCommit = async (
    into,
    name,
    write,
    { constraint = 'venue_payment_sum', setAside = null } = {},
  ) => {
    let committed = false
    let detail = ''

    try {
      await prisma.$transaction(async (tx) => {
        if (setAside) {
          await tx.$executeRawUnsafe(`ALTER TABLE "Ticket" DISABLE TRIGGER ${setAside}`)
        }

        await write(tx)
      })
      committed = true
    } catch (error) {
      detail = `${error?.code ?? ''} ${error?.message ?? error}`.replace(/\s+/g, ' ')
    }

    if (committed && setAside) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Ticket" ENABLE TRIGGER ${setAside}`)
    }

    const matched = !committed && new RegExp(constraint).test(detail)

    into.push(
      record(name, matched, {
        note: committed
          ? 'the transaction committed, which it must not'
          : matched
            ? 'refused; nothing written'
            : detail.slice(0, 160),
      }),
    )
  }

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

  // An insert naming a payment is refused by the insert guard
  // (`desi_ticket_venue_due_guard`, SPEC3-XI §5.3 trigger 2) before the CHECK
  // is evaluated: a BEFORE trigger runs first. The same rule on the update
  // path, where the guard on the payment column answers, is the case after it.
  await check(
    'a ticket inserted with a payment and nothing due is refused (the insert guard runs before the CHECK)',
    refusedBy('ticket_venue_insert_unpaid'),
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
    'a ticket inserted owing nothing, then pointed at a payment of its own order, is refused',
    refusedBy('venue_payment_order'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const payment = await venuePayment(tx, booking, booking.tickets, { point: false })
      const owingNothing = await tx.ticket.create({
        data: {
          orderItemId: booking.line.id,
          code: unique('ticket').toUpperCase(),
          venueDueCents: 0,
        },
      })
      await tx.ticket.update({
        where: { id: owingNothing.id },
        data: { venuePaymentId: payment.id },
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

    const changeDue = (tx) =>
      tx.ticket.update({ where: { id: first.id }, data: { venueDueCents: 1 } })
    const insertPointing = (tx) =>
      tx.ticket.create({
        data: {
          orderItemId: booking.line.id,
          code: unique('ticket').toUpperCase(),
          ownerUserId: user.id,
          venueDueCents: 4000,
          venuePaymentId: payment.id,
        },
      })

    await refusedAtCommit(
      results,
      'an unpaid ticket pointed later at a committed payment is refused at commit (venue_payment_sum)',
      (tx) => tx.ticket.update({ where: { id: unpaid.id }, data: { venuePaymentId: payment.id } }),
    )

    // SPEC3-XI's due guard (§5.3 trigger 2) now refuses these two writes
    // first, under its own names. Each is shown both ways: refused by the
    // guard, and, with the guard set aside inside that transaction only, still
    // refused at commit by the payment's sum, so neither rule leans on the
    // other.
    await refusedAtCommit(
      results,
      "a paid ticket's due changed after its payment committed is refused by the due guard (ticket_venue_due_fixed)",
      changeDue,
      { constraint: 'ticket_venue_due_fixed' },
    )

    await refusedAtCommit(
      results,
      "a paid ticket's due changed after its payment committed is refused at commit (venue_payment_sum), the due guard set aside",
      changeDue,
      { setAside: 'desi_ticket_venue_due_guard' },
    )

    await refusedAtCommit(
      results,
      'a ticket inserted already pointing at a committed payment is refused by the insert guard (ticket_venue_insert_unpaid)',
      insertPointing,
      { constraint: 'ticket_venue_insert_unpaid' },
    )

    await refusedAtCommit(
      results,
      'a ticket inserted already pointing at a committed payment is refused at commit (venue_payment_sum), the insert guard set aside',
      insertPointing,
      { setAside: 'desi_ticket_venue_due_guard' },
    )

    await refusedAtCommit(
      results,
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

  await probeUnpaidCancellations({
    prisma,
    world,
    user,
    check,
    refusedBy,
    refusedAtCommit,
    record,
    results,
  })
  await probeReferralReturnsAndDues({ world, user, check, refusedBy, referral })

  return results.every(Boolean)
}

/**
 * Probes 16-21: unpaid pay-at-the-venue tickets cancelled (SPEC3-XI XU, §5.3).
 *
 * @param {object} context The runner's helpers and rows.
 * @param {object} context.prisma The client.
 * @param {object} context.world The organisation and buyer ids.
 * @param {object} context.user The seeded user.
 * @param {Function} context.check Runs one rolled-back probe.
 * @param {Function} context.refusedBy Builds a 23514 matcher for a constraint name.
 * @param {Function} context.refusedAtCommit Runs one write that must fail at commit.
 * @param {Function} context.record Records one step.
 * @param {boolean[]} context.results Where commit-time outcomes are recorded.
 * @returns {Promise<void>} Resolves once every probe is recorded.
 */
async function probeUnpaidCancellations({
  prisma,
  world,
  user,
  check,
  refusedBy,
  refusedAtCommit,
  record,
  results,
}) {
  // -------------------------------------------------------------------------
  // 16. A cancellation's shape, and its sum at commit
  // -------------------------------------------------------------------------

  await check(
    'a cancellation with a nine-character reason is refused',
    /venue_booking_cancellation_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await cancelUnpaid(tx, booking, booking.tickets, { reason: 'Too short' })
    },
  )

  await check(
    'a cancellation of 0 tickets is refused',
    /venue_booking_cancellation_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await cancelUnpaid(tx, booking, booking.tickets, { point: false, ticketCount: 0 })
    },
  )

  await check(
    "a cancellation under a door scope's authority is refused",
    /venue_booking_cancellation_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await cancelUnpaid(tx, booking, booking.tickets, { authority: 'EVENT_SCOPE' })
    },
  )

  await check(
    'a cancellation of nothing owed is refused',
    /venue_booking_cancellation_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await cancelUnpaid(tx, booking, booking.tickets, { point: false, basisCents: 0 })
    },
  )

  await check(
    'a cancellation keeping a negative fee is refused',
    /venue_booking_cancellation_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await cancelUnpaid(tx, booking, booking.tickets, { feeKeptCents: -1 })
    },
  )

  await check(
    'a cancellation whose tickets owe less than its basis is refused when its checks run',
    refusedBy('venue_booking_cancellation_sum'),
    async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 4000] })
      await cancelUnpaid(tx, booking, [booking.tickets[0]], { basisCents: 8000, ticketCount: 2 })
      await checkCancellationSumsNow(tx)
    },
  )

  await check(
    'a cancellation no ticket points at is refused when its checks run',
    refusedBy('venue_booking_cancellation_sum'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await cancelUnpaid(tx, booking, booking.tickets, { point: false })
      await checkCancellationSumsNow(tx)
    },
  )

  await check(
    'a cancellation equal to its tickets, keeping part of the fee, passes its checks',
    null,
    async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 3999] })
      await cancelUnpaid(tx, booking, booking.tickets, {
        feeKeptCents: 335,
        cancelledById: user.id,
        authority: 'PLATFORM_ROLE',
        role: 'ADMIN',
      })
      await tx.order.update({
        where: { id: booking.order.id },
        data: { venueCancelledBasisCents: 7999, venueFeeKeptCents: 335 },
      })
      await tx.orderItem.update({
        where: { id: booking.line.id },
        data: { venueCancelledQuantity: 2 },
      })
      await tx.ticketType.update({
        where: { id: booking.line.ticketTypeId },
        data: { quantitySold: 0 },
      })
      await checkCancellationSumsNow(tx)
    },
  )

  // At commit, with no SET CONSTRAINTS: meant to fail, taking every row with it.
  let committed = false
  let commitError = ''
  const reference = unique('commit-cancel').toUpperCase()

  try {
    await prisma.$transaction(async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 4000], order: { reference } })
      await cancelUnpaid(tx, booking, [booking.tickets[0]], { basisCents: 8000, ticketCount: 2 })
    })
    committed = true
  } catch (error) {
    commitError = `${error?.code ?? ''} ${error?.message ?? error}`.replace(/\s+/g, ' ')
  }

  const leftBehind = await prisma.order.count({ where: { reference } })

  results.push(
    record(
      'a cancellation whose tickets do not sum to it is refused at commit (venue_booking_cancellation_sum)',
      !committed && /venue_booking_cancellation_sum/.test(commitError) && leftBehind === 0,
      {
        note: committed
          ? 'the transaction committed, which it must not'
          : /venue_booking_cancellation_sum/.test(commitError)
            ? 'refused at commit; nothing written'
            : commitError.slice(0, 160),
      },
    ),
  )

  // -------------------------------------------------------------------------
  // 17. A ticket is cancelled once, by its own order's cancellation; the
  //     cancellation is never edited and goes on equalling its tickets
  // -------------------------------------------------------------------------

  await check(
    "a ticket cannot be cancelled by another order's cancellation",
    refusedBy('venue_cancellation_ticket'),
    async (tx) => {
      const mine = await venueBooking(tx, world)
      const theirs = await venueBooking(tx, world)
      const cancellation = await cancelUnpaid(tx, theirs, theirs.tickets, { point: false })
      await withdrawUnpaid(tx, mine.tickets[0], cancellation)
    },
  )

  await check(
    'a ticket paid at the door cannot be cancelled unpaid',
    refusedBy('venue_cancellation_ticket'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await venuePayment(tx, booking, booking.tickets)
      const cancellation = await cancelUnpaid(tx, booking, booking.tickets, { point: false })
      await withdrawUnpaid(tx, booking.tickets[0], cancellation)
    },
  )

  await check(
    'a ticket let in cannot be cancelled unpaid',
    refusedBy('venue_cancellation_ticket'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await venuePayment(tx, booking, booking.tickets)
      await tx.checkIn.create({ data: { ticketId: booking.tickets[0].id, method: 'MANUAL_CODE' } })
      const cancellation = await cancelUnpaid(tx, booking, booking.tickets, { point: false })
      await withdrawUnpaid(tx, booking.tickets[0], cancellation)
    },
  )

  await check(
    'a ticket left VALID cannot name a cancellation',
    refusedBy('venue_cancellation_ticket'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const cancellation = await cancelUnpaid(tx, booking, booking.tickets, { point: false })
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { venueCancellationId: cancellation.id },
      })
    },
  )

  await check(
    'a ticket owing nothing cannot be cancelled unpaid',
    refusedBy('venue_cancellation_ticket'),
    async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 0] })
      const cancellation = await cancelUnpaid(tx, booking, [booking.tickets[0]], { point: false })
      await withdrawUnpaid(tx, booking.tickets[1], cancellation)
    },
  )

  await check(
    'a ticket already withdrawn cannot be cancelled unpaid afterwards',
    refusedBy('venue_cancellation_ticket'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'probe' },
      })
      const cancellation = await cancelUnpaid(tx, booking, booking.tickets, { point: false })
      await withdrawUnpaid(tx, booking.tickets[0], cancellation)
    },
  )

  await check('a ticket on offer to someone else can be cancelled unpaid', null, async (tx) => {
    const booking = await venueBooking(tx, world)
    await tx.ticket.update({
      where: { id: booking.tickets[0].id },
      data: { status: 'TRANSFER_PENDING' },
    })
    await cancelUnpaid(tx, booking, booking.tickets)
    await checkCancellationSumsNow(tx)
  })

  await check(
    "a ticket's cancellation cannot be changed once set",
    refusedBy('ticket_venue_cancellation_fixed'),
    async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 4000] })
      await cancelUnpaid(tx, booking, [booking.tickets[0]])
      const second = await cancelUnpaid(tx, booking, [booking.tickets[1]])
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { venueCancellationId: second.id },
      })
    },
  )

  await check(
    "a ticket's cancellation cannot be cleared once set",
    refusedBy('ticket_venue_cancellation_fixed'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await cancelUnpaid(tx, booking, booking.tickets)
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { venueCancellationId: null },
      })
    },
  )

  await check(
    "a cancellation's reason cannot be edited",
    refusedBy('venue_booking_cancellation_append_only'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const cancellation = await cancelUnpaid(tx, booking, booking.tickets)
      await tx.venueBookingCancellation.update({
        where: { id: cancellation.id },
        data: { reason: 'A different reason entirely.' },
      })
    },
  )

  await check(
    "a cancellation's kept fee cannot be edited",
    refusedBy('venue_booking_cancellation_append_only'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const cancellation = await cancelUnpaid(tx, booking, booking.tickets)
      await tx.venueBookingCancellation.update({
        where: { id: cancellation.id },
        data: { feeKeptCents: 1 },
      })
    },
  )

  await check(
    'a cancellation cannot be deleted',
    refusedBy('venue_booking_cancellation_append_only'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const cancellation = await cancelUnpaid(tx, booking, booking.tickets, { point: false })
      await tx.venueBookingCancellation.delete({ where: { id: cancellation.id } })
    },
  )

  await check("a cancellation's author can be cleared", null, async (tx) => {
    const booking = await venueBooking(tx, world)
    const cancellation = await cancelUnpaid(tx, booking, booking.tickets, {
      cancelledById: user.id,
    })
    await tx.venueBookingCancellation.update({
      where: { id: cancellation.id },
      data: { cancelledById: null },
    })
    await checkCancellationSumsNow(tx)
  })

  await check(
    "a cancellation's author cannot be changed to someone else",
    refusedBy('venue_booking_cancellation_append_only'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const cancellation = await cancelUnpaid(tx, booking, booking.tickets, {
        cancelledById: user.id,
      })
      const someoneElse = await stranger(tx)
      await tx.venueBookingCancellation.update({
        where: { id: cancellation.id },
        data: { cancelledById: someoneElse.id },
      })
    },
  )

  // After it committed, a cancellation goes on equalling its tickets. A booking
  // of three unpaid tickets, the first cancelled, is committed here; each later
  // write below, in its own transaction, is meant to fail at commit and leave
  // that booking as it was.
  let kept = null
  let keepError = ''

  try {
    kept = await prisma.$transaction(async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 4000, 4000] })
      const cancellation = await cancelUnpaid(tx, booking, [booking.tickets[0]])

      return { booking, cancellation }
    })
  } catch (error) {
    keepError = `${error?.code ?? ''} ${error?.message ?? error}`.replace(/\s+/g, ' ')
  }

  results.push(
    record('a cancellation equal to its ticket commits', kept !== null, {
      note: kept ? 'committed' : keepError.slice(0, 160),
    }),
  )

  if (kept) {
    const { booking, cancellation } = kept
    const [cancelled, standing] = booking.tickets

    await refusedAtCommit(
      results,
      'a further ticket of the order withdrawn and pointed later at a committed cancellation is refused at commit (venue_booking_cancellation_sum)',
      (tx) => withdrawUnpaid(tx, standing, cancellation),
      { constraint: 'venue_booking_cancellation_sum' },
    )

    await refusedAtCommit(
      results,
      'a cancelled ticket removed after its cancellation committed is refused at commit (venue_booking_cancellation_sum)',
      (tx) => tx.ticket.delete({ where: { id: cancelled.id } }),
      { constraint: 'venue_booking_cancellation_sum' },
    )

    const pointing = await prisma.ticket.findMany({
      where: { venueCancellationId: cancellation.id },
      select: { id: true },
    })
    const stillStanding = await prisma.ticket.findUnique({ where: { id: standing.id } })

    results.push(
      record(
        'after them, the committed cancellation still names exactly the ticket it cancelled',
        pointing.length === 1 &&
          pointing[0].id === cancelled.id &&
          stillStanding?.status === 'VALID' &&
          stillStanding?.venueCancellationId === null,
        {
          note:
            `${pointing.length} ticket(s) point at it; the second ticket is ` +
            `${stillStanding?.status ?? 'missing'}`,
        },
      ),
    )
  }

  // -------------------------------------------------------------------------
  // 18. A ticket cancelled unpaid is never paid and never let in
  // -------------------------------------------------------------------------

  await check(
    'a ticket cancelled unpaid cannot be paid at the door',
    refusedBy('venue_payment_order'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await cancelUnpaid(tx, booking, booking.tickets)
      const payment = await venuePayment(tx, booking, booking.tickets, { point: false })
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { venuePaymentId: payment.id },
      })
    },
  )

  await check('a ticket cancelled unpaid is not let in', /which does not admit/, async (tx) => {
    const booking = await venueBooking(tx, world)
    await cancelUnpaid(tx, booking, booking.tickets)
    await tx.checkIn.create({ data: { ticketId: booking.tickets[0].id, method: 'MANUAL_CODE' } })
  })

  // -------------------------------------------------------------------------
  // 19. What an order keeps is part of its fee, and never refunded
  // -------------------------------------------------------------------------

  await check(
    'a kept fee above the fee charged is refused',
    /order_venue_cancel_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world, {
        order: { taxCents: 120, totalCents: 335 + 120 },
      })
      await tx.order.update({ where: { id: booking.order.id }, data: { venueFeeKeptCents: 336 } })
    },
  )

  await check('a card order keeping a fee is refused', /order_venue_cancel_shape/, async (tx) => {
    const card = await venueBooking(tx, world, {
      order: { paymentMethod: 'CARD', venueDueCents: 0, totalCents: 4335 },
    })
    await tx.order.update({ where: { id: card.order.id }, data: { venueFeeKeptCents: 100 } })
  })

  await check(
    'a card order with a door price no longer owed is refused',
    /order_venue_cancel_shape/,
    async (tx) => {
      const card = await venueBooking(tx, world, {
        order: { paymentMethod: 'CARD', venueDueCents: 0, totalCents: 4335 },
      })
      await tx.order.update({
        where: { id: card.order.id },
        data: { venueCancelledBasisCents: 100 },
      })
    },
  )

  await check(
    'a door price no longer owed above the door price is refused',
    /order_venue_cancel_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.order.update({
        where: { id: booking.order.id },
        data: { venueCancelledBasisCents: 4001 },
      })
    },
  )

  await check(
    'refunded and kept money above what was paid online is refused',
    /order_venue_kept_within_total/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.order.update({
        where: { id: booking.order.id },
        data: { refundedCents: 200, venueFeeKeptCents: 200 },
      })
    },
  )

  await check(
    'a refund being processed that would reach into a kept fee is refused',
    /order_venue_kept_within_total/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.order.update({
        where: { id: booking.order.id },
        data: { venueFeeKeptCents: 200, refundPendingCents: 136 },
      })
    },
  )

  await check('refunded and kept money equal to what was paid online is accepted', null, (tx) =>
    venueBooking(tx, world).then((booking) =>
      tx.order.update({
        where: { id: booking.order.id },
        data: { refundedCents: 135, venueFeeKeptCents: 200, venueCancelledBasisCents: 4000 },
      }),
    ),
  )

  // -------------------------------------------------------------------------
  // 20. A line's refunded and cancelled tickets stay within it
  // -------------------------------------------------------------------------

  await check(
    "a line's refunded and cancelled tickets above its quantity are refused",
    /order_item_venue_cancelled_within_line/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.orderItem.update({
        where: { id: booking.line.id },
        data: { refundedQuantity: 1, venueCancelledQuantity: 1 },
      })
    },
  )

  await check(
    'a negative cancelled quantity is refused',
    /order_item_venue_cancelled_within_line/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.orderItem.update({
        where: { id: booking.line.id },
        data: { venueCancelledQuantity: -1 },
      })
    },
  )

  await check("a line's refunded and cancelled tickets filling it are accepted", null, (tx) =>
    venueBooking(tx, world, { shares: [4000, 4000] }).then((booking) =>
      tx.orderItem.update({
        where: { id: booking.line.id },
        data: { refundedQuantity: 1, venueCancelledQuantity: 1 },
      }),
    ),
  )

  // -------------------------------------------------------------------------
  // 21. A tier's sold count never goes below 0
  // -------------------------------------------------------------------------

  await check('a tier sold count of -1 is refused', /ticket_type_sold_not_negative/, async (tx) => {
    const booking = await venueBooking(tx, world)
    await tx.ticketType.update({
      where: { id: booking.line.ticketTypeId },
      data: { quantitySold: -1 },
    })
  })

  await check('a tier sold count of 0 is accepted', null, async (tx) => {
    const booking = await venueBooking(tx, world)
    await tx.ticketType.update({
      where: { id: booking.line.ticketTypeId },
      data: { quantitySold: 0 },
    })
  })
}

/**
 * Probes 22-23: referral returns (SPEC3-XI XR, §5.2) and what is due staying
 * with a ticket (open question 7, §5.3 trigger 2).
 *
 * @param {object} context The runner's helpers and rows.
 * @param {object} context.world The organisation and buyer ids.
 * @param {object} context.user The seeded user.
 * @param {Function} context.check Runs one rolled-back probe.
 * @param {Function} context.refusedBy Builds a 23514 matcher for a constraint name.
 * @param {Function} context.referral Creates a referral code row.
 * @returns {Promise<void>} Resolves once every probe is recorded.
 */
async function probeReferralReturnsAndDues({ world, user, check, refusedBy, referral }) {
  // -------------------------------------------------------------------------
  // 22. A referral use goes back once; the code an order used never changes
  // -------------------------------------------------------------------------

  /**
   * A booking whose whole fee a new referral code waived.
   *
   * @param {object} tx A transaction client.
   * @returns {Promise<object>} The rows of {@link venueBooking} and `code`.
   */
  const waived = async (tx) => {
    const code = await referral(tx, { useCount: 1 })
    const booking = await venueBooking(tx, world, {
      order: { feesCents: 0, feeWaivedCents: 335, totalCents: 0, referralCodeId: code.id },
    })

    return { ...booking, code }
  }

  await check(
    'a referral return marker on an order with no code is refused',
    /order_referral_return_shape/,
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.order.update({
        where: { id: booking.order.id },
        data: { referralUseReturnedAt: new Date(), referralUseReturnCause: 'REFUNDED' },
      })
    },
  )

  await check(
    'a referral return time without a cause is refused',
    /order_referral_return_shape/,
    async (tx) => {
      const { order } = await waived(tx)
      await tx.order.update({
        where: { id: order.id },
        data: { referralUseReturnedAt: new Date() },
      })
    },
  )

  await check(
    'a referral return cause without a time is refused',
    /order_referral_return_shape/,
    async (tx) => {
      const { order } = await waived(tx)
      await tx.order.update({
        where: { id: order.id },
        data: { referralUseReturnCause: 'VENUE_UNPAID_CANCELLED' },
      })
    },
  )

  await check('a referral use given back once, with its cause, is accepted', null, async (tx) => {
    const { order } = await waived(tx)
    await tx.order.update({
      where: { id: order.id },
      data: { referralUseReturnedAt: new Date(), referralUseReturnCause: 'NOT_COMPLETED' },
    })
  })

  await check(
    'a referral use given back cannot be given back again under another cause',
    refusedBy('order_referral_return_once'),
    async (tx) => {
      const { order } = await waived(tx)
      await tx.order.update({
        where: { id: order.id },
        data: { referralUseReturnedAt: new Date(), referralUseReturnCause: 'REFUNDED' },
      })
      await tx.order.update({
        where: { id: order.id },
        data: { referralUseReturnCause: 'EVENT_CANCELLED' },
      })
    },
  )

  await check(
    'a referral use given back cannot be taken back (marker cleared)',
    refusedBy('order_referral_return_once'),
    async (tx) => {
      const { order } = await waived(tx)
      await tx.order.update({
        where: { id: order.id },
        data: { referralUseReturnedAt: new Date(), referralUseReturnCause: 'REFUNDED' },
      })
      await tx.order.update({
        where: { id: order.id },
        data: { referralUseReturnedAt: null, referralUseReturnCause: null },
      })
    },
  )

  await check(
    "an order's referral code cannot be changed to another",
    refusedBy('order_referral_code_fixed'),
    async (tx) => {
      const { order } = await waived(tx)
      const other = await referral(tx)
      await tx.order.update({ where: { id: order.id }, data: { referralCodeId: other.id } })
    },
  )

  await check(
    "an order's referral code cannot be removed",
    refusedBy('order_referral_code_fixed'),
    async (tx) => {
      const { order } = await waived(tx)
      await tx.order.update({ where: { id: order.id }, data: { referralCodeId: null } })
    },
  )

  await check(
    'an order placed without a code cannot be given one afterwards',
    refusedBy('order_referral_code_fixed'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const code = await referral(tx)
      await tx.order.update({ where: { id: booking.order.id }, data: { referralCodeId: code.id } })
    },
  )

  // -------------------------------------------------------------------------
  // 23. What is due stays with the ticket (open question 7)
  // -------------------------------------------------------------------------

  await check(
    'a successor owing a different amount at the door is refused',
    refusedBy('ticket_venue_due_successor'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const holder = await stranger(tx)
      await tx.ticket.create({
        data: {
          orderItemId: booking.line.id,
          code: unique('ticket').toUpperCase(),
          ownerUserId: holder.id,
          venueDueCents: 3999,
          supersedesTicketId: booking.tickets[0].id,
        },
      })
    },
  )

  await check('a successor owing what its predecessor owed is accepted', null, async (tx) => {
    const booking = await venueBooking(tx, world)
    const holder = await stranger(tx)
    await tx.ticket.update({
      where: { id: booking.tickets[0].id },
      data: { status: 'TRANSFER_PENDING' },
    })
    await tx.ticket.update({
      where: { id: booking.tickets[0].id },
      data: { status: 'TRANSFERRED' },
    })
    await tx.ticket.create({
      data: {
        orderItemId: booking.line.id,
        code: unique('ticket').toUpperCase(),
        ownerUserId: holder.id,
        venueDueCents: 4000,
        supersedesTicketId: booking.tickets[0].id,
      },
    })
  })

  await check(
    "a ticket's due cannot be changed",
    refusedBy('ticket_venue_due_fixed'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      await tx.ticket.update({
        where: { id: booking.tickets[0].id },
        data: { venueDueCents: 3999 },
      })
    },
  )

  await check(
    'a ticket owing nothing cannot be made to owe something',
    refusedBy('ticket_venue_due_fixed'),
    async (tx) => {
      const booking = await venueBooking(tx, world, { shares: [4000, 0] })
      await tx.ticket.update({
        where: { id: booking.tickets[1].id },
        data: { venueDueCents: 100 },
      })
    },
  )

  await check(
    'a ticket inserted already paid at the door is refused',
    refusedBy('ticket_venue_insert_unpaid'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const payment = await venuePayment(tx, booking, booking.tickets, { point: false })
      await tx.ticket.create({
        data: {
          orderItemId: booking.line.id,
          code: unique('ticket').toUpperCase(),
          ownerUserId: user.id,
          venueDueCents: 4000,
          venuePaymentId: payment.id,
        },
      })
    },
  )

  await check(
    'a ticket inserted already cancelled unpaid is refused',
    refusedBy('ticket_venue_insert_unpaid'),
    async (tx) => {
      const booking = await venueBooking(tx, world)
      const cancellation = await cancelUnpaid(tx, booking, booking.tickets, { point: false })
      await tx.ticket.create({
        data: {
          orderItemId: booking.line.id,
          code: unique('ticket').toUpperCase(),
          ownerUserId: user.id,
          status: 'REVOKED',
          venueDueCents: 4000,
          venueCancellationId: cancellation.id,
        },
      })
    },
  )
}
