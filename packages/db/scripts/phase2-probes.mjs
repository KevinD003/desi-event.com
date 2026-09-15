/**
 * Probes for the Phase 2 invariants the database enforces on its own.
 *
 * Phase 1's probes covered the constraints a single table can state. Phase 2
 * added two kinds the schema cannot express, and this module is the evidence
 * that both work:
 *
 *   - **Triggers spanning two tables.** An order line may only sell a tier from
 *     its own order's event; a session's seat inventory may only come from the
 *     session's own seat map; a published seat map cannot be edited.
 *   - **The ledger's two guarantees.** A batch cannot reach POSTED unless its
 *     entries balance in one currency, and once posted neither it nor its
 *     entries can be changed or removed by anybody — this application included.
 *
 * Every probe runs against a disposable database that
 * `verify-fresh-database.mjs` created and will destroy. Most run inside a
 * transaction that is always rolled back; the ledger immutability probes need a
 * genuinely committed posted batch to push against, so they commit one first —
 * and cannot clean it up afterwards, which is the point.
 *
 * @module @desi-event/db/scripts/phase2-probes
 */

/** Rejections that mean a unique index did its job. */
const DUPLICATE = /P2002|duplicate key|unique constraint/i

/** Rejections raised by one of the Phase 2 triggers or CHECK constraints. */
const REFUSED = /check_violation|violates check constraint|P2010|P2002/i

/**
 * Fixtures the probes push against, created once and committed.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @returns {Promise<object|null>} The fixture ids, or null when the seed did not provide what is needed.
 */
async function createFixtures(prisma) {
  const [event, otherEvent, ticketType, order, venue] = await Promise.all([
    prisma.event.findFirst({ orderBy: { slug: 'asc' } }),
    prisma.event.findFirst({ orderBy: { slug: 'desc' } }),
    prisma.ticketType.findFirst(),
    prisma.order.findFirst(),
    prisma.venue.findFirst(),
  ])

  if (!event || !otherEvent || !ticketType || !order || !venue || event.id === otherEvent.id) {
    return null
  }

  const otherTier = await prisma.ticketType.findFirst({ where: { eventId: otherEvent.id } })
  if (!otherTier) return null

  // A seat map: one draft version to edit, one published version to sell from.
  const map = await prisma.venueMap.create({
    data: { venueId: venue.id, name: `probe-map-${Date.now()}` },
  })

  const draftVersion = await prisma.venueMapVersion.create({
    data: { venueMapId: map.id, version: 1 },
  })

  const publishedVersion = await prisma.venueMapVersion.create({
    data: { venueMapId: map.id, version: 2 },
  })

  const draftSection = await prisma.section.create({
    data: { venueMapVersionId: draftVersion.id, name: 'Stalls' },
  })

  const publishedSection = await prisma.section.create({
    data: { venueMapVersionId: publishedVersion.id, name: 'Stalls' },
  })

  const publishedSeat = await prisma.seat.create({
    data: {
      venueMapVersionId: publishedVersion.id,
      sectionId: publishedSection.id,
      label: 'Stalls A1',
    },
  })

  const draftSeat = await prisma.seat.create({
    data: { venueMapVersionId: draftVersion.id, sectionId: draftSection.id, label: 'Stalls A1' },
  })

  // Freeze the published version only after its seats exist: the freeze is what
  // the immutability triggers watch for.
  await prisma.venueMapVersion.update({
    where: { id: publishedVersion.id },
    data: { publishedAt: new Date(), seatCount: 1 },
  })

  const session = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      venueMapVersionId: publishedVersion.id,
    },
  })

  const eventSeat = await prisma.eventSeat.create({
    data: { eventSessionId: session.id, seatId: publishedSeat.id },
  })

  const accounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: ['processor_clearing', 'organizer_payable', 'platform_fee_revenue'] } },
    orderBy: { code: 'asc' },
  })
  if (accounts.length !== 3) return null

  const byCode = Object.fromEntries(accounts.map((account) => [account.code, account.id]))

  // A committed, posted, balanced batch for the immutability probes to push
  // against. It cannot be removed afterwards, which is exactly the property
  // being demonstrated.
  const postedBatch = await prisma.ledgerBatch.create({
    data: {
      reference: `PROBE-POSTED-${Date.now()}`,
      kind: 'ORDER_PAID',
      currency: 'INR',
      sourceType: 'ORDER',
      sourceId: order.id,
      idempotencyKey: `probe-posted-${Date.now()}`,
      entries: {
        create: [
          {
            accountId: byCode.processor_clearing,
            direction: 'DEBIT',
            amountCents: 1000,
            currency: 'INR',
          },
          {
            accountId: byCode.organizer_payable,
            direction: 'CREDIT',
            amountCents: 900,
            currency: 'INR',
          },
          {
            accountId: byCode.platform_fee_revenue,
            direction: 'CREDIT',
            amountCents: 100,
            currency: 'INR',
          },
        ],
      },
    },
  })

  const posted = await prisma.ledgerBatch.update({
    where: { id: postedBatch.id },
    data: { status: 'POSTED' },
  })

  return {
    event,
    otherEvent,
    otherTier,
    ticketType,
    order,
    accounts: byCode,
    draftVersion,
    publishedVersion,
    draftSection,
    publishedSection,
    draftSeat,
    publishedSeat,
    session,
    eventSeat,
    posted,
  }
}

/**
 * Run every Phase 2 probe.
 *
 * @param {object} prisma A client connected to the seeded disposable database.
 * @param {object} helpers Injected helpers from the verifier.
 * @param {Function} helpers.probe Runs one probe in a rolled-back transaction.
 * @param {Function} helpers.record Records a step's outcome.
 * @returns {Promise<boolean>} Whether every probe passed.
 */
export async function runPhase2Probes(prisma, { probe, record }) {
  let fixtures
  try {
    fixtures = await createFixtures(prisma)
  } catch (error) {
    return record('Phase 2 probes have the fixtures they need', false, {
      note: String(error?.message ?? error).slice(0, 200),
    })
  }

  if (!fixtures) {
    return record('Phase 2 probes have the fixtures they need', false, {
      note: 'the seed did not provide two events, a tier, an order and a venue',
    })
  }

  record('Phase 2 probes have the fixtures they need', true, {
    note: 'a published seat map, a session, a seat and a posted ledger batch',
  })

  const results = []
  const {
    accounts,
    draftVersion,
    order,
    otherTier,
    posted,
    publishedSeat,
    publishedSection,
    publishedVersion,
    session,
    eventSeat,
  } = fixtures

  /**
   * Draft-batch data with entries that sum to the given pair.
   *
   * @param {object} options Options.
   * @param {number} options.debit Debit amount in minor units.
   * @param {number} options.credit Credit amount in minor units.
   * @param {string} [options.currency] Batch currency.
   * @param {string} [options.entryCurrency] Currency for the credit entry, to force a mismatch.
   * @returns {object} A Prisma create payload.
   */
  const draftBatch = ({ debit, credit, currency = 'INR', entryCurrency = currency }) => ({
    reference: `PROBE-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    kind: 'ORDER_PAID',
    currency,
    sourceType: 'ORDER',
    sourceId: order.id,
    idempotencyKey: `probe-${Math.random().toString(36).slice(2, 12)}`,
    entries: {
      create: [
        {
          accountId: accounts.processor_clearing,
          direction: 'DEBIT',
          amountCents: debit,
          currency,
        },
        {
          accountId: accounts.organizer_payable,
          direction: 'CREDIT',
          amountCents: credit,
          currency: entryCurrency,
        },
      ],
    },
  })

  // ---- The ledger balances -------------------------------------------------

  results.push(
    await probe(prisma, 'a ledger batch cannot post unbalanced', /does not balance/, async (tx) => {
      const batch = await tx.ledgerBatch.create({ data: draftBatch({ debit: 1000, credit: 900 }) })
      await tx.ledgerBatch.update({ where: { id: batch.id }, data: { status: 'POSTED' } })
    }),
  )

  results.push(
    await probe(prisma, 'a ledger batch cannot post with no entries', /no entries/, async (tx) => {
      const batch = await tx.ledgerBatch.create({
        data: {
          reference: `PROBE-EMPTY-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'ORDER_PAID',
          currency: 'INR',
          sourceType: 'ORDER',
          sourceId: order.id,
          idempotencyKey: `probe-empty-${Math.random().toString(36).slice(2, 10)}`,
        },
      })
      await tx.ledgerBatch.update({ where: { id: batch.id }, data: { status: 'POSTED' } })
    }),
  )

  results.push(
    await probe(prisma, 'a ledger batch cannot mix currencies', /mixes currencies/, async (tx) => {
      const batch = await tx.ledgerBatch.create({
        data: draftBatch({ debit: 1000, credit: 1000, currency: 'INR', entryCurrency: 'CAD' }),
      })
      await tx.ledgerBatch.update({ where: { id: batch.id }, data: { status: 'POSTED' } })
    }),
  )

  results.push(
    await probe(prisma, 'a balanced ledger batch posts', null, async (tx) => {
      const batch = await tx.ledgerBatch.create({ data: draftBatch({ debit: 1000, credit: 1000 }) })
      const result = await tx.ledgerBatch.update({
        where: { id: batch.id },
        data: { status: 'POSTED' },
      })

      // The totals are computed by the database from the entries, so they cannot
      // be written to agree with each other and disagree with the rows.
      if (result.debitCents !== 1000 || result.creditCents !== 1000) {
        throw new Error(`totals were not computed: ${result.debitCents}/${result.creditCents}`)
      }
      if (result.postedAt === null) throw new Error('postedAt was not stamped')
    }),
  )

  results.push(
    await probe(
      prisma,
      'a ledger batch cannot be posted with totals that contradict its entries',
      /does not balance/,
      async (tx) => {
        // Writing the totals by hand does not help: the trigger recomputes them.
        const batch = await tx.ledgerBatch.create({
          data: draftBatch({ debit: 1000, credit: 400 }),
        })
        await tx.ledgerBatch.update({
          where: { id: batch.id },
          data: { status: 'POSTED', debitCents: 1000, creditCents: 1000 },
        })
      },
    ),
  )

  // ---- A posted batch is immutable ----------------------------------------

  results.push(
    await probe(prisma, 'a posted ledger batch cannot be modified', /is posted/, (tx) =>
      tx.ledgerBatch.update({ where: { id: posted.id }, data: { sourceId: 'tampered' } }),
    ),
  )

  results.push(
    await probe(prisma, 'a posted ledger batch cannot be deleted', /is posted/, (tx) =>
      tx.ledgerBatch.delete({ where: { id: posted.id } }),
    ),
  )

  results.push(
    await probe(prisma, 'an entry cannot be added to a posted batch', /is posted/, (tx) =>
      tx.ledgerEntry.create({
        data: {
          batchId: posted.id,
          accountId: accounts.processor_clearing,
          direction: 'DEBIT',
          amountCents: 1,
          currency: 'INR',
        },
      }),
    ),
  )

  results.push(
    await probe(prisma, "a posted batch's entries cannot be changed", /is posted/, async (tx) => {
      const entry = await tx.ledgerEntry.findFirst({ where: { batchId: posted.id } })
      await tx.ledgerEntry.update({ where: { id: entry.id }, data: { amountCents: 99_999 } })
    }),
  )

  results.push(
    await probe(prisma, "a posted batch's entries cannot be deleted", /is posted/, async (tx) => {
      const entry = await tx.ledgerEntry.findFirst({ where: { batchId: posted.id } })
      await tx.ledgerEntry.delete({ where: { id: entry.id } })
    }),
  )

  results.push(
    await probe(
      prisma,
      'history is corrected by compensation, not by editing',
      null,
      async (tx) => {
        // The escape hatch the immutability is built around: a new batch that
        // names the one it reverses.
        const correction = await tx.ledgerBatch.create({
          data: {
            ...draftBatch({ debit: 1000, credit: 1000 }),
            kind: 'CORRECTION',
            compensatesBatchId: posted.id,
          },
        })
        await tx.ledgerBatch.update({ where: { id: correction.id }, data: { status: 'POSTED' } })
      },
    ),
  )

  results.push(
    await probe(
      prisma,
      'only a correction batch may claim to compensate another',
      /ledger_batch_correction_references/,
      (tx) =>
        tx.ledgerBatch.create({
          data: { ...draftBatch({ debit: 1, credit: 1 }), compensatesBatchId: posted.id },
        }),
    ),
  )

  // Against a *draft* batch, deliberately. On the posted one the immutability
  // trigger answers first, which would make this probe pass without ever
  // reaching the CHECK it claims to test.
  results.push(
    await probe(
      prisma,
      'a ledger entry cannot carry a negative or zero amount',
      /ledger_entry_amount_positive/,
      async (tx) => {
        const draft = await tx.ledgerBatch.create({ data: draftBatch({ debit: 100, credit: 100 }) })

        await tx.ledgerEntry.create({
          data: {
            batchId: draft.id,
            accountId: accounts.processor_clearing,
            direction: 'DEBIT',
            amountCents: -100,
            currency: 'INR',
          },
        })
      },
    ),
  )

  results.push(
    await probe(prisma, 'a ledger source can only post once', DUPLICATE, async (tx) => {
      const key = `probe-once-${Math.random().toString(36).slice(2, 10)}`
      await tx.ledgerBatch.create({
        data: { ...draftBatch({ debit: 1, credit: 1 }), idempotencyKey: key },
      })
      await tx.ledgerBatch.create({
        data: { ...draftBatch({ debit: 1, credit: 1 }), idempotencyKey: key },
      })
    }),
  )

  // ---- Seats ---------------------------------------------------------------

  results.push(
    await probe(prisma, 'a seat label is unique within a seat map version', DUPLICATE, (tx) =>
      tx.seat.create({
        data: {
          venueMapVersionId: draftVersion.id,
          sectionId: fixtures.draftSection.id,
          label: 'Stalls A1',
        },
      }),
    ),
  )

  results.push(
    await probe(prisma, 'a seat exists once per session', DUPLICATE, (tx) =>
      tx.eventSeat.create({ data: { eventSessionId: session.id, seatId: publishedSeat.id } }),
    ),
  )

  results.push(
    await probe(
      prisma,
      "a published seat map's seats cannot be changed",
      /cannot be changed/,
      (tx) => tx.seat.update({ where: { id: publishedSeat.id }, data: { label: 'Renamed' } }),
    ),
  )

  results.push(
    await probe(
      prisma,
      'a seat cannot be added to a published seat map',
      /cannot be changed/,
      (tx) =>
        tx.seat.create({
          data: {
            venueMapVersionId: publishedVersion.id,
            sectionId: publishedSection.id,
            label: 'Stalls A2',
          },
        }),
    ),
  )

  results.push(
    await probe(
      prisma,
      'a published seat map cannot be unpublished',
      /cannot be unpublished/,
      (tx) =>
        tx.venueMapVersion.update({
          where: { id: publishedVersion.id },
          data: { publishedAt: null },
        }),
    ),
  )

  results.push(
    await probe(prisma, 'a session cannot sell an unpublished seat map', /still editable/, (tx) =>
      tx.eventSession.create({
        data: {
          eventId: fixtures.event.id,
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 90_000_000),
          venueMapVersionId: draftVersion.id,
        },
      }),
    ),
  )

  results.push(
    await probe(
      prisma,
      "a session's seat inventory must come from its own seat map",
      /belongs to map version/,
      (tx) =>
        tx.eventSeat.create({
          data: { eventSessionId: session.id, seatId: fixtures.draftSeat.id },
        }),
    ),
  )

  results.push(
    await probe(
      prisma,
      'a seat that says it is held must name the hold',
      /event_seat_status_coherent/,
      (tx) => tx.eventSeat.update({ where: { id: eventSeat.id }, data: { status: 'HELD' } }),
    ),
  )

  // ---- NF-04: one organiser per order -------------------------------------

  results.push(
    await probe(
      prisma,
      "an order line cannot sell another event's ticket type",
      /but the order is for event/,
      (tx) =>
        tx.orderItem.create({
          data: {
            orderId: order.id,
            ticketTypeId: otherTier.id,
            quantity: 1,
            unitPriceCents: 1000,
            subtotalCents: 1000,
          },
        }),
    ),
  )

  // ---- Refunds -------------------------------------------------------------

  results.push(
    await probe(
      prisma,
      'an order cannot be refunded past its total',
      /order_refund_within_total/,
      (tx) =>
        tx.order.update({
          where: { id: order.id },
          data: { refundedCents: order.totalCents + 1 },
        }),
    ),
  )

  results.push(
    await probe(
      prisma,
      'a refund in flight is counted against the ceiling',
      /order_refund_within_total/,
      (tx) =>
        // Two concurrent requests cannot together exceed the total, because the
        // pending reservation is part of the sum the constraint checks.
        tx.order.update({
          where: { id: order.id },
          data: { refundedCents: order.totalCents, refundPendingCents: 1 },
        }),
    ),
  )

  // ---- Tickets, check-in, idempotency, webhooks ---------------------------

  results.push(
    await probe(prisma, 'a QR credential is issued once', DUPLICATE, async (tx) => {
      const ticket = await tx.ticket.findFirst()
      const digest = 'a'.repeat(64)
      await tx.ticket.update({ where: { id: ticket.id }, data: { credentialHash: digest } })
      const other = await tx.ticket.findFirst({ where: { id: { not: ticket.id } } })
      await tx.ticket.update({ where: { id: other.id }, data: { credentialHash: digest } })
    }),
  )

  results.push(
    await probe(prisma, 'a ticket is checked in once', DUPLICATE, async (tx) => {
      const ticket = await tx.ticket.findFirst()
      await tx.checkIn.create({ data: { ticketId: ticket.id, eventSessionId: session.id } })
      await tx.checkIn.create({ data: { ticketId: ticket.id, eventSessionId: session.id } })
    }),
  )

  results.push(
    await probe(prisma, 'an idempotency key is unique within its scope', DUPLICATE, async (tx) => {
      const row = {
        scope: 'checkout',
        key: `probe-${Math.random().toString(36).slice(2, 10)}`,
        requestHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000),
      }
      await tx.idempotencyRecord.create({ data: row })
      await tx.idempotencyRecord.create({ data: row })
    }),
  )

  results.push(
    await probe(
      prisma,
      'the same key in a different scope is a different request',
      null,
      async (tx) => {
        const key = `probe-${Math.random().toString(36).slice(2, 10)}`
        const base = {
          key,
          requestHash: 'b'.repeat(64),
          expiresAt: new Date(Date.now() + 3_600_000),
        }
        await tx.idempotencyRecord.create({ data: { ...base, scope: 'checkout' } })
        await tx.idempotencyRecord.create({ data: { ...base, scope: 'refund' } })
      },
    ),
  )

  results.push(
    await probe(
      prisma,
      'a webhook delivery is recorded once per account',
      DUPLICATE,
      async (tx) => {
        const row = {
          provider: 'stripe',
          accountContext: 'acct_probe',
          providerEventId: `evt_${Math.random().toString(36).slice(2, 10)}`,
          eventType: 'payment_intent.succeeded',
          payload: {},
        }
        await tx.webhookEvent.create({ data: row })
        await tx.webhookEvent.create({ data: row })
      },
    ),
  )

  results.push(
    await probe(
      prisma,
      'the same provider event for two accounts is two facts',
      null,
      async (tx) => {
        // Stripe delivers one event to the platform and to a connected account.
        // Those are different facts and both must be storable.
        const providerEventId = `evt_${Math.random().toString(36).slice(2, 10)}`
        const base = {
          provider: 'stripe',
          providerEventId,
          eventType: 'charge.refunded',
          payload: {},
        }
        await tx.webhookEvent.create({ data: { ...base, accountContext: '' } })
        await tx.webhookEvent.create({ data: { ...base, accountContext: 'acct_probe' } })
      },
    ),
  )

  results.push(
    await probe(
      prisma,
      'a transfer cannot be reversed beyond its amount',
      /transfer_reversal_within_amount/,
      async (tx) => {
        const organization = await tx.organization.findFirst()
        await tx.transfer.create({
          data: {
            organizationId: organization.id,
            provider: 'stripe',
            amountCents: 1000,
            currency: 'INR',
            reversedCents: 1001,
            idempotencyKey: `probe-${Math.random().toString(36).slice(2, 10)}`,
          },
        })
      },
    ),
  )

  results.push(
    await probe(
      prisma,
      'a session must end after it starts',
      /event_session_ends_after_start/,
      (tx) =>
        tx.eventSession.create({
          data: {
            eventId: fixtures.event.id,
            startsAt: new Date(Date.now() + 90_000_000),
            endsAt: new Date(Date.now() + 86_400_000),
          },
        }),
    ),
  )

  results.push(
    await probe(prisma, 'a session cannot outlive its expiry logic', null, async (tx) => {
      // The positive case for the same constraint, so a trivially-always-failing
      // trigger could not masquerade as a passing probe.
      await tx.eventSession.create({
        data: {
          eventId: fixtures.event.id,
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 90_000_000),
        },
      })
    }),
  )

  return results.every(Boolean)
}

export { DUPLICATE, REFUSED }
