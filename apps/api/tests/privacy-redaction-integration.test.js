/**
 * Redaction, against a real database.
 *
 * The stub cannot prove any of this. What is under test is the agreement between
 * the service and PostgreSQL's own rules — the state-transition trigger, the
 * partial unique index that permits one live request per subject, the
 * append-only triggers on `AuditLog` and `PrivacyAuditEvent`, and the `@unique`
 * constraint on `User.email` that a colliding placeholder would violate. A stub
 * that agreed with the service would prove only that the service agrees with
 * itself.
 *
 * ## What is asserted, and why each one would cost somebody something
 *
 *   - **Money does not move.** Every amount, tax figure, status and ledger row is
 *     captured before the redaction and compared afterwards. A redaction that
 *     changed a single cent would be a redaction that rewrote an invoice.
 *   - **Nothing of the original survives.** Every redacted column is re-read and
 *     searched for the value it used to hold, and the subject's old address is
 *     searched for across the whole notification payload tree.
 *   - **A second run changes nothing.** Determinism is the property that makes a
 *     crash recoverable, so it is asserted by running the engine twice and
 *     comparing rows rather than by trusting the derivation.
 *   - **An open process refuses.** A pending ticket transfer is matched on a raw
 *     address at `routes/tickets.js:406`; redacting around it would strand a
 *     ticket somebody paid for.
 *   - **The account survives a neighbour.** A subject who also deals with another
 *     organisation keeps their account identity, because one organiser must not
 *     be able to erase a person from an organisation they have no authority over.
 *
 * ## Teardown
 *
 * There is deliberately none. `desi_privacy_audit_event_immutable` refuses to
 * delete a privacy audit row, and `desi_audit_log_immutable` refuses the
 * `SET NULL` update that deleting an actor would make to their audit history, so
 * a suite that tried to clean up after itself would fail in cleanup rather than
 * in a test. Every row is tagged with a per-run suffix instead.
 *
 * @module @desi-event/api/tests/privacy-redaction-integration
 */

import { randomUUID } from 'node:crypto'

import { expect, it } from 'vitest'

import { PRIVACY_CATEGORIES } from '../src/lib/privacy.js'
import { isRedactedValue } from '../src/lib/privacy-placeholders.js'
import { HOLD_DECISIONS, OPEN_PROCESS_CODES, evaluateHolds } from '../src/lib/privacy-holds.js'
import {
  CATEGORY_STATUSES,
  previewScope,
  redactSubject,
  subjectBelongsElsewhere,
} from '../src/lib/privacy-redaction.js'
import { orderPaidBatch } from '@desi-event/ledger'

import { postBatch } from '../src/lib/ledger.js'
import { connectTestDatabase } from './helpers/database.js'

/** Marks every row this suite creates, so nothing else can be mistaken for it. */
const TAG = `prv${randomUUID().slice(0, 8)}`

const { prisma, when } = await connectTestDatabase('the privacy redaction integration suite')

/** Far enough ahead that an admission counts as unspent. */
const FUTURE = new Date('2027-06-01T18:00:00Z')

/** Far enough behind that an admission no longer blocks. */
const PAST_START = new Date('2020-06-01T18:00:00Z')
const PAST_END = new Date('2020-06-01T22:00:00Z')

let counter = 0

/**
 * A unique fragment, so two calls in one run never collide.
 *
 * @param {string} label What it is.
 * @returns {string} The fragment.
 */
function unique(label) {
  counter += 1

  return `${label}-${TAG}-${counter}`
}

/**
 * An organisation with one event, one session and one tier.
 *
 * @param {object} [options] Options.
 * @param {boolean} [options.past] Whether the event has already finished.
 * @returns {Promise<object>} The graph.
 */
async function organisation({ past = false } = {}) {
  const slug = unique('org')

  const org = await prisma.organization.create({
    data: {
      name: `Org ${slug}`,
      slug,
      contactEmail: `${slug}@example.test`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      title: `Event ${slug}`,
      slug: unique('event'),
      summary: 'Seeded for the privacy suite.',
      description: 'Seeded by the privacy redaction integration suite.',
      category: 'MUSIC_CONCERT',
      status: 'PUBLISHED',
      startsAt: past ? PAST_START : FUTURE,
      endsAt: past ? PAST_END : new Date(FUTURE.getTime() + 4 * 60 * 60 * 1000),
    },
  })

  const session = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: 'SCHEDULED',
    },
  })

  const ticketType = await prisma.ticketType.create({
    data: {
      eventId: event.id,
      name: 'General',
      priceCents: 250_000,
      currency: 'INR',
      quantityTotal: 100,
    },
  })

  return { org, event, session, ticketType }
}

/**
 * A person, with a known address and name.
 *
 * @param {string} label A label for the address.
 * @returns {Promise<object>} The user.
 */
async function person(label) {
  const slug = unique(label)

  return prisma.user.create({
    data: {
      email: `${slug}@people.test`,
      passwordHash: 'x'.repeat(60),
      displayName: `Person ${slug}`,
      phone: '+44 7700 900000',
      role: 'ATTENDEE',
      emailVerified: true,
    },
  })
}

/**
 * A paid order for one person, with its line and its tickets.
 *
 * @param {object} options Inputs.
 * @param {object} options.graph An organisation graph.
 * @param {object} options.buyer The person.
 * @param {number} [options.quantity] How many tickets.
 * @param {string} [options.ticketStatus] The status to give the tickets.
 * @returns {Promise<object>} The order, line and tickets.
 */
async function paidOrder({ graph, buyer, quantity = 1, ticketStatus = 'VALID' }) {
  const reference = unique('DE').toUpperCase()
  const subtotal = graph.ticketType.priceCents * quantity

  const order = await prisma.order.create({
    data: {
      reference,
      eventId: graph.event.id,
      eventSessionId: graph.session.id,
      userId: buyer.id,
      buyerEmail: buyer.email,
      buyerName: buyer.displayName,
      status: 'PAID',
      currency: 'INR',
      subtotalCents: subtotal,
      feesCents: 1_000,
      taxCents: 2_500,
      discountCents: 0,
      totalCents: subtotal + 3_500,
      paidAt: new Date('2026-01-01T00:00:00Z'),
    },
  })

  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketTypeId: graph.ticketType.id,
      quantity,
      unitPriceCents: graph.ticketType.priceCents,
      subtotalCents: subtotal,
    },
  })

  const tickets = []

  for (let index = 0; index < quantity; index += 1) {
    tickets.push(
      await prisma.ticket.create({
        data: {
          orderItemId: item.id,
          code: unique('DET').toUpperCase(),
          status: ticketStatus,
          attendeeName: buyer.displayName,
          ownerUserId: buyer.id,
        },
      }),
    )
  }

  // A paid order that posted no ledger batch is not a paid order, and an
  // assertion about money that has no money to look at proves nothing. The first
  // version of this fixture created none, so `financialFacts` had nothing of its
  // own to count and counted the whole table instead — see its comment.
  const { batch } = await postBatch(
    prisma,
    orderPaidBatch({
      capturedCents: order.totalCents,
      organizerNetCents: order.subtotalCents,
      platformFeeCents: order.feesCents,
      taxCents: order.taxCents,
      currency: order.currency,
      organizationId: graph.org.id,
      reference,
    }),
    { sourceType: 'ORDER', sourceId: order.id, reference, orderId: order.id },
  )

  return { order, item, tickets, batch }
}

/**
 * Everything about a subject that a redaction must not change.
 *
 * @param {object} order An order row.
 * @returns {Promise<object>} The financial facts, as they stand.
 */
async function financialFacts(order) {
  const row = await prisma.order.findUnique({ where: { id: order.id } })

  // Scoped to this order through `LedgerBatch.orderId`, which is a foreign key
  // and therefore something no other suite can reach into.
  //
  // The first version counted the whole table — `ledgerEntry.aggregate({ _count:
  // { _all: true } })` — which made this assertion a measurement of whatever
  // else happened to be running. Vitest runs suites in parallel, so a neighbour
  // posting a batch between the two snapshots moved the number: CI run
  // `35248621822` on merged `main` failed here with 59 expected and 61 received.
  // Worse than flaky, it was empty: this fixture posted no batch of its own, so
  // every row it counted belonged to somebody else and none of them could ever
  // have been changed by redacting this subject.
  //
  // The rows are compared, not tallied. A count cannot tell the difference
  // between a row that was left alone and a row that was deleted while another
  // appeared, and `memo` is the field §11 of the Phase 2 report names as the one
  // a redaction can never reach — so it is read back rather than assumed.
  const ledger = await prisma.ledgerEntry.findMany({
    where: { batch: { orderId: order.id } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      batchId: true,
      accountId: true,
      direction: true,
      amountCents: true,
      currency: true,
      memo: true,
      organizationId: true,
    },
  })

  return {
    status: row.status,
    currency: row.currency,
    subtotalCents: row.subtotalCents,
    feesCents: row.feesCents,
    taxCents: row.taxCents,
    discountCents: row.discountCents,
    totalCents: row.totalCents,
    refundedCents: row.refundedCents,
    refundPendingCents: row.refundPendingCents,
    paidAt: row.paidAt?.toISOString() ?? null,
    ledgerEntries: ledger.length,
    ledger,
  }
}

when()('redacting a subject who belongs to one organisation', () => {
  it('replaces every approved field and leaves the money exactly as it was', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('subject')
    const originalEmail = subject.email
    const originalName = subject.displayName

    const { order, tickets } = await paidOrder({ graph, buyer: subject })
    const before = await financialFacts(order)

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const after = await financialFacts(order)

    expect(after).toEqual(before)

    const user = await prisma.user.findUnique({ where: { id: subject.id } })
    const redactedOrder = await prisma.order.findUnique({ where: { id: order.id } })
    const redactedTicket = await prisma.ticket.findUnique({ where: { id: tickets[0].id } })

    expect(user.email).not.toBe(originalEmail)
    expect(user.displayName).not.toBe(originalName)
    expect(user.phone).toBe(null)
    expect(isRedactedValue(user.email)).toBe(true)
    expect(isRedactedValue(user.displayName)).toBe(true)

    expect(redactedOrder.buyerEmail).not.toBe(originalEmail)
    expect(redactedOrder.buyerName).not.toBe(originalName)
    expect(isRedactedValue(redactedOrder.buyerEmail)).toBe(true)

    expect(redactedTicket.attendeeName).not.toBe(originalName)
    expect(isRedactedValue(redactedTicket.attendeeName)).toBe(true)
  })

  it('is unmoved by a neighbouring order posting its own ledger batch', async () => {
    // The regression for CI run `35248621822`. That failure was not a redaction
    // defect: a parallel suite posted entries between the two snapshots and the
    // whole-table count moved underneath an assertion that had no business
    // reading it. This reproduces the interference deliberately and proves the
    // scoped snapshot does not feel it.
    const graph = await organisation({ past: true })
    const subject = await person('neighbour-subject')

    const { order } = await paidOrder({ graph, buyer: subject })
    const before = await financialFacts(order)

    expect(before.ledgerEntries).toBeGreaterThan(0)

    const globalBefore = await prisma.ledgerEntry.count()

    // Somebody else's money, in somebody else's organisation, posted between the
    // two snapshots — exactly what a neighbouring suite does.
    const otherGraph = await organisation({ past: true })
    const otherBuyer = await person('neighbour-other')
    const { order: otherOrder } = await paidOrder({ graph: otherGraph, buyer: otherBuyer })

    const globalAfterNeighbour = await prisma.ledgerEntry.count()

    // Without this, the test would pass for the wrong reason: it has to prove
    // the interference actually happened before it can prove it was survived.
    expect(globalAfterNeighbour).toBeGreaterThan(globalBefore)

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    expect(await financialFacts(order)).toEqual(before)

    // And the neighbour is untouched by a redaction in an organisation that is
    // not theirs — the tenant boundary, asserted on the money rather than on the
    // identity columns.
    const neighbour = await prisma.ledgerEntry.findMany({
      where: { batch: { orderId: otherOrder.id } },
      orderBy: { id: 'asc' },
      select: { id: true, amountCents: true, memo: true },
    })

    expect(neighbour.length).toBeGreaterThan(0)
    expect(neighbour.every((entry) => entry.amountCents > 0)).toBe(true)
  })

  it('leaves ticket status, code and credential untouched, so the door still works', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('holder')
    const { tickets } = await paidOrder({ graph, buyer: subject })

    await prisma.ticket.update({
      where: { id: tickets[0].id },
      data: { credentialHash: unique('cred'), credentialIssuedAt: new Date() },
    })

    const before = await prisma.ticket.findUnique({ where: { id: tickets[0].id } })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const after = await prisma.ticket.findUnique({ where: { id: tickets[0].id } })

    expect(after.status).toBe(before.status)
    expect(after.code).toBe(before.code)
    expect(after.credentialHash).toBe(before.credentialHash)
    expect(after.credentialVersion).toBe(before.credentialVersion)
    expect(after.ownerUserId).toBe(before.ownerUserId)
  })

  it('revokes every live session and unused token', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('session-holder')

    await paidOrder({ graph, buyer: subject })

    await prisma.session.create({
      data: {
        userId: subject.id,
        tokenHash: unique('tok'),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    await prisma.authToken.create({
      data: {
        userId: subject.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: unique('reset'),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    const outcome = await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    expect(outcome.sessionsRevoked).toBe(1)
    expect(outcome.tokensRevoked).toBe(1)

    const live = await prisma.session.count({ where: { userId: subject.id, revokedAt: null } })

    expect(live).toBe(0)
  })

  it('scrubs a sent notification and leaves an unsent one alone', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('notified')

    await paidOrder({ graph, buyer: subject })

    const sent = await prisma.notificationOutbox.create({
      data: {
        template: 'order.confirmation',
        recipient: subject.email,
        userId: subject.id,
        organizationId: graph.org.id,
        payload: { buyerName: subject.displayName, orderReference: 'DE-KEEP', totalCents: 1 },
        status: 'SENT',
        dedupeKey: unique('dedupe-sent'),
        sentAt: new Date(),
      },
    })

    const queued = await prisma.notificationOutbox.create({
      data: {
        template: 'order.reminder',
        recipient: subject.email,
        userId: subject.id,
        organizationId: graph.org.id,
        payload: { buyerName: subject.displayName },
        status: 'QUEUED',
        dedupeKey: unique('dedupe-queued'),
      },
    })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const scrubbed = await prisma.notificationOutbox.findUnique({ where: { id: sent.id } })
    const untouched = await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })

    expect(isRedactedValue(scrubbed.recipient)).toBe(true)
    expect(scrubbed.payload).toEqual({ orderReference: 'DE-KEEP', totalCents: 1 })
    // The evidence that the message went is what survives.
    expect(scrubbed.status).toBe('SENT')
    expect(scrubbed.dedupeKey).toBe(sent.dedupeKey)
    expect(scrubbed.template).toBe('order.confirmation')

    // A queued message still has to be deliverable. Redacting it would send a
    // person a message with holes in it rather than redacting them.
    expect(untouched.recipient).toBe(subject.email)
  })

  it('is idempotent — a second run writes nothing and changes nothing', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('twice')
    const { order } = await paidOrder({ graph, buyer: subject })

    const run = () =>
      prisma.$transaction((tx) =>
        redactSubject(tx, {
          organizationId: graph.org.id,
          subjectUserId: subject.id,
          now: new Date(),
        }),
      )

    await run()

    const afterFirst = {
      user: await prisma.user.findUnique({ where: { id: subject.id } }),
      order: await prisma.order.findUnique({ where: { id: order.id } }),
    }

    const second = await run()

    const afterSecond = {
      user: await prisma.user.findUnique({ where: { id: subject.id } }),
      order: await prisma.order.findUnique({ where: { id: order.id } }),
    }

    expect(afterSecond.user.email).toBe(afterFirst.user.email)
    expect(afterSecond.user.displayName).toBe(afterFirst.user.displayName)
    expect(afterSecond.order.buyerEmail).toBe(afterFirst.order.buyerEmail)
    expect(afterSecond.order.buyerName).toBe(afterFirst.order.buyerName)

    // `updatedAt` would move if a write had happened.
    expect(afterSecond.user.updatedAt.toISOString()).toBe(afterFirst.user.updatedAt.toISOString())

    for (const entry of second.categories) {
      expect(entry.status).not.toBe(CATEGORY_STATUSES.REDACTED)
    }
  })

  it('leaves no trace of the original address anywhere it used to be', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('trace')
    const original = subject.email

    const { order, tickets } = await paidOrder({ graph, buyer: subject })

    await prisma.notificationOutbox.create({
      data: {
        template: 'order.confirmation',
        recipient: original,
        userId: subject.id,
        organizationId: graph.org.id,
        payload: { email: original, nested: { recipientEmail: original } },
        status: 'SENT',
        dedupeKey: unique('dedupe-trace'),
        sentAt: new Date(),
      },
    })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const haystack = JSON.stringify({
      user: await prisma.user.findUnique({ where: { id: subject.id } }),
      order: await prisma.order.findUnique({ where: { id: order.id } }),
      ticket: await prisma.ticket.findUnique({ where: { id: tickets[0].id } }),
      outbox: await prisma.notificationOutbox.findMany({ where: { userId: subject.id } }),
    })

    expect(haystack).not.toContain(original)
    expect(haystack).not.toContain(subject.displayName)
  })
})

when()('a subject who also deals with another organisation', () => {
  it('keeps their account identity, and says so rather than skipping silently', async () => {
    const mine = await organisation({ past: true })
    const theirs = await organisation({ past: true })
    const subject = await person('shared')

    const here = await paidOrder({ graph: mine, buyer: subject })
    await paidOrder({ graph: theirs, buyer: subject })

    expect(
      await subjectBelongsElsewhere(prisma, {
        organizationId: mine.org.id,
        subjectUserId: subject.id,
      }),
    ).toBe(true)

    const outcome = await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: mine.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const account = outcome.categories.find(
      (entry) => entry.category === PRIVACY_CATEGORIES.ACCOUNT_IDENTITY,
    )

    expect(account.status).toBe(CATEGORY_STATUSES.OUT_OF_SCOPE)

    const user = await prisma.user.findUnique({ where: { id: subject.id } })

    // The account is untouched. One organiser must not be able to erase a person
    // from an organisation they hold no authority over.
    expect(user.email).toBe(subject.email)
    expect(user.displayName).toBe(subject.displayName)

    // This organisation's own rows are still redacted.
    const redacted = await prisma.order.findUnique({ where: { id: here.order.id } })

    expect(isRedactedValue(redacted.buyerEmail)).toBe(true)
  })

  it('leaves the other organisation’s rows completely alone', async () => {
    const mine = await organisation({ past: true })
    const theirs = await organisation({ past: true })
    const subject = await person('neighbour')

    await paidOrder({ graph: mine, buyer: subject })
    const elsewhere = await paidOrder({ graph: theirs, buyer: subject })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: mine.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const untouched = await prisma.order.findUnique({ where: { id: elsewhere.order.id } })

    expect(untouched.buyerEmail).toBe(subject.email)
    expect(untouched.buyerName).toBe(subject.displayName)
  })
})

when()('contact addresses', () => {
  it('replaces an organisation contact only when it is the subject’s own', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('contact')

    await paidOrder({ graph, buyer: subject })

    // The organisation's contact is somebody else's; it must survive.
    const before = await prisma.organization.findUnique({ where: { id: graph.org.id } })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const after = await prisma.organization.findUnique({ where: { id: graph.org.id } })

    expect(after.contactEmail).toBe(before.contactEmail)
  })

  it('replaces it when the subject is the contact', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('is-contact')

    await paidOrder({ graph, buyer: subject })
    await prisma.organization.update({
      where: { id: graph.org.id },
      data: { contactEmail: subject.email },
    })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const after = await prisma.organization.findUnique({ where: { id: graph.org.id } })

    expect(isRedactedValue(after.contactEmail)).toBe(true)
  })
})

when()('holds and open processes', () => {
  it('refuses while a legal hold is active, and permits it once released', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('held')
    const placer = await person('counsel')

    await paidOrder({ graph, buyer: subject })

    const hold = await prisma.privacyHold.create({
      data: {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        kind: 'LEGAL',
        matterReference: unique('matter'),
        placedById: placer.id,
      },
    })

    const blocked = await evaluateHolds(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
      now: new Date(),
    })

    expect(blocked.decision).toBe(HOLD_DECISIONS.LEGAL_HOLD_ACTIVE)
    expect(blocked.holdId).toBe(hold.id)

    await prisma.privacyHold.update({
      where: { id: hold.id },
      data: { state: 'RELEASED', releasedAt: new Date(), releasedById: placer.id },
    })

    const clear = await evaluateHolds(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
      now: new Date(),
    })

    expect(clear.decision).toBe(HOLD_DECISIONS.NONE_ACTIVE)
  })

  it('names the legal hold when a fraud hold is also active', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('double-held')
    const placer = await person('investigator')

    await paidOrder({ graph, buyer: subject })

    await prisma.privacyHold.create({
      data: {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        kind: 'FRAUD_INVESTIGATION',
        matterReference: unique('fraud'),
        placedById: placer.id,
      },
    })

    await prisma.privacyHold.create({
      data: {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        kind: 'LEGAL',
        matterReference: unique('legal'),
        placedById: placer.id,
      },
    })

    const decided = await evaluateHolds(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
      now: new Date(),
    })

    expect(decided.decision).toBe(HOLD_DECISIONS.LEGAL_HOLD_ACTIVE)
  })

  it('refuses while a ticket invitation is still open', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('transferrer')
    const { tickets } = await paidOrder({ graph, buyer: subject })

    await prisma.ticketTransfer.create({
      data: {
        ticketId: tickets[0].id,
        fromUserId: subject.id,
        toEmail: `${unique('recipient')}@people.test`,
        tokenHash: unique('transfer-token'),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    const decided = await evaluateHolds(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
      now: new Date(),
    })

    expect(decided.decision).toBe(HOLD_DECISIONS.OPEN_PROCESS)
    expect(decided.openProcessCode).toBe(OPEN_PROCESS_CODES.TRANSFER_PENDING)
  })

  it('stops refusing once the invitation has expired', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('expired-transfer')
    const { tickets } = await paidOrder({ graph, buyer: subject })

    await prisma.ticketTransfer.create({
      data: {
        ticketId: tickets[0].id,
        fromUserId: subject.id,
        toEmail: `${unique('recipient')}@people.test`,
        tokenHash: unique('transfer-token'),
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1_000),
      },
    })

    const decided = await evaluateHolds(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
      now: new Date(),
    })

    expect(decided.decision).toBe(HOLD_DECISIONS.NONE_ACTIVE)
  })

  it('refuses while an admission for a future event is unspent', async () => {
    const graph = await organisation({ past: false })
    const subject = await person('attending')

    await paidOrder({ graph, buyer: subject })

    const decided = await evaluateHolds(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
      now: new Date(),
    })

    expect(decided.decision).toBe(HOLD_DECISIONS.OPEN_PROCESS)
    expect(decided.openProcessCode).toBe(OPEN_PROCESS_CODES.ADMISSION_UNSPENT)
  })

  it('refuses while a notification is still waiting to go out', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('pending-notification')

    await paidOrder({ graph, buyer: subject })

    await prisma.notificationOutbox.create({
      data: {
        template: 'order.reminder',
        recipient: subject.email,
        userId: subject.id,
        organizationId: graph.org.id,
        payload: {},
        status: 'QUEUED',
        dedupeKey: unique('dedupe-block'),
      },
    })

    const decided = await evaluateHolds(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
      now: new Date(),
    })

    expect(decided.decision).toBe(HOLD_DECISIONS.OPEN_PROCESS)
    expect(decided.openProcessCode).toBe(OPEN_PROCESS_CODES.NOTIFICATION_UNDELIVERED)
  })

  it('does not treat another organisation’s open process as this one’s reason to refuse', async () => {
    const mine = await organisation({ past: true })
    const theirs = await organisation({ past: false })
    const subject = await person('busy-elsewhere')

    await paidOrder({ graph: mine, buyer: subject })
    // An unspent admission, but in the neighbour's organisation.
    await paidOrder({ graph: theirs, buyer: subject })

    const decided = await evaluateHolds(prisma, {
      organizationId: mine.org.id,
      subjectUserId: subject.id,
      now: new Date(),
    })

    expect(decided.decision).toBe(HOLD_DECISIONS.NONE_ACTIVE)
  })
})

when()('the scope preview', () => {
  it('counts without reading a value', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('previewed')

    await paidOrder({ graph, buyer: subject, quantity: 3 })

    const scope = await previewScope(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
    })

    const serialised = JSON.stringify(scope)

    expect(serialised).not.toContain(subject.email)
    expect(serialised).not.toContain(subject.displayName)

    const buyer = scope.find((entry) => entry.category === PRIVACY_CATEGORIES.BUYER_IDENTITY)
    const holder = scope.find(
      (entry) => entry.category === PRIVACY_CATEGORIES.TICKET_HOLDER_IDENTITY,
    )

    expect(buyer.rows).toBe(1)
    expect(holder.rows).toBe(3)
  })

  it('names the categories a later phase owns rather than reporting zero', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('deferred')

    await paidOrder({ graph, buyer: subject })

    const scope = await previewScope(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
    })

    const exports = scope.find((entry) => entry.category === PRIVACY_CATEGORIES.EXPORTS)
    const security = scope.find((entry) => entry.category === PRIVACY_CATEGORIES.SECURITY_METADATA)

    expect(exports.status).toBe(CATEGORY_STATUSES.DEFERRED)
    expect(security.status).toBe(CATEGORY_STATUSES.DEFERRED)
  })
})

when()('the two ways a person reaches an organisation without an account link', () => {
  it('redacts a guest order, which carries no user id at all', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('guest-buyer')

    // An account-linked order, so the subject is in scope.
    await paidOrder({ graph, buyer: subject })

    // And a guest order under the same address, with no `userId`. This is the
    // shape of a purchase somebody made before they registered.
    const guest = await prisma.order.create({
      data: {
        reference: unique('DE').toUpperCase(),
        eventId: graph.event.id,
        userId: null,
        buyerEmail: subject.email,
        buyerName: subject.displayName,
        status: 'PAID',
        currency: 'INR',
        subtotalCents: 50_000,
        feesCents: 0,
        taxCents: 0,
        discountCents: 0,
        totalCents: 50_000,
        paidAt: new Date('2025-01-01T00:00:00Z'),
      },
    })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const after = await prisma.order.findUnique({ where: { id: guest.id } })

    expect(isRedactedValue(after.buyerEmail)).toBe(true)
    expect(isRedactedValue(after.buyerName)).toBe(true)
    // The money on the guest order is untouched, like every other order.
    expect(after.totalCents).toBe(50_000)
    expect(after.status).toBe('PAID')
  })

  it('does not reach a guest order in another organisation', async () => {
    const mine = await organisation({ past: true })
    const theirs = await organisation({ past: true })
    const subject = await person('guest-elsewhere')

    await paidOrder({ graph: mine, buyer: subject })

    const elsewhere = await prisma.order.create({
      data: {
        reference: unique('DE').toUpperCase(),
        eventId: theirs.event.id,
        userId: null,
        buyerEmail: subject.email,
        buyerName: subject.displayName,
        status: 'PAID',
        currency: 'INR',
        subtotalCents: 10_000,
        feesCents: 0,
        taxCents: 0,
        discountCents: 0,
        totalCents: 10_000,
        paidAt: new Date('2025-01-01T00:00:00Z'),
      },
    })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: mine.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const after = await prisma.order.findUnique({ where: { id: elsewhere.id } })

    expect(after.buyerEmail).toBe(subject.email)
  })

  it('redacts a waitlist entry, the row that can put somebody in scope on its own', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('waitlisted')

    await paidOrder({ graph, buyer: subject })

    const entry = await prisma.waitlistEntry.create({
      data: { eventId: graph.event.id, userId: subject.id, email: subject.email, quantity: 2 },
    })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const after = await prisma.waitlistEntry.findUnique({ where: { id: entry.id } })

    expect(isRedactedValue(after.email)).toBe(true)
    // The intent is kept; only the identity goes.
    expect(after.quantity).toBe(2)
    expect(after.notified).toBe(false)
  })

  it('gives two waitlist entries for one person two placeholders, so the composite unique index holds', async () => {
    const graph = await organisation({ past: true })
    const second = await organisation({ past: true })
    const subject = await person('twice-waitlisted')

    await paidOrder({ graph, buyer: subject })

    // Two events in one organisation would be the sharper case, so make one.
    const sibling = await prisma.event.create({
      data: {
        organizationId: graph.org.id,
        title: `Sibling ${TAG}`,
        slug: unique('sibling'),
        summary: 'A second event in the same organisation.',
        description: 'Seeded to exercise the composite unique index.',
        category: 'COMEDY',
        status: 'PUBLISHED',
        startsAt: PAST_START,
        endsAt: PAST_END,
      },
    })

    const first = await prisma.waitlistEntry.create({
      data: { eventId: graph.event.id, userId: subject.id, email: subject.email },
    })

    const other = await prisma.waitlistEntry.create({
      data: { eventId: sibling.id, userId: subject.id, email: subject.email },
    })

    // The neighbour organisation is irrelevant here beyond proving the scope.
    expect(second.org.id).not.toBe(graph.org.id)

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const a = await prisma.waitlistEntry.findUnique({ where: { id: first.id } })
    const b = await prisma.waitlistEntry.findUnique({ where: { id: other.id } })

    expect(isRedactedValue(a.email)).toBe(true)
    expect(isRedactedValue(b.email)).toBe(true)
    expect(a.email).not.toBe(b.email)
  })

  it('records the redaction reason on every revoked session, from the closed vocabulary', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('revoked')

    await paidOrder({ graph, buyer: subject })

    await prisma.session.create({
      data: {
        userId: subject.id,
        tokenHash: unique('tok'),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const sessions = await prisma.session.findMany({ where: { userId: subject.id } })

    for (const session of sessions) {
      expect(session.revokedReason).toBe('privacy_redaction')
    }
  })
})

when()('the three gaps an adversarial read found', () => {
  it('blocks on an invitation addressed to somebody who had no account yet', async () => {
    // The sharpest case in the whole subsystem. Acceptance is gated by
    // comparing the signed-in address against `toEmail`
    // (`apps/api/src/routes/tickets.js:407`), and `toUserId` is null when the
    // invitation was sent to somebody who had not registered. A hold check that
    // looked only at `fromUserId`/`toUserId` would pass, the redaction would
    // rewrite `User.email`, and the gate could never match again from either
    // side — leaving a paid ticket that nobody can accept or decline.
    const graph = await organisation({ past: true })
    const sender = await person('sender')
    const recipient = await person('late-registrant')

    const { tickets } = await paidOrder({ graph, buyer: sender })

    await prisma.ticketTransfer.create({
      data: {
        ticketId: tickets[0].id,
        fromUserId: sender.id,
        toEmail: recipient.email,
        // Null, exactly as it is when the invitation predates the account.
        toUserId: null,
        tokenHash: unique('token'),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    // The recipient is in scope through their own order, so the request is
    // otherwise raisable.
    await paidOrder({ graph, buyer: recipient })

    const decided = await evaluateHolds(prisma, {
      organizationId: graph.org.id,
      subjectUserId: recipient.id,
      subjectEmail: recipient.email.toLowerCase(),
      now: new Date(),
    })

    expect(decided.decision).toBe(HOLD_DECISIONS.OPEN_PROCESS)
    expect(decided.openProcessCode).toBe(OPEN_PROCESS_CODES.TRANSFER_PENDING)
  })

  it('previews exactly the number of rows it then redacts', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('counted')

    // An account-linked order, a guest order, a guest waitlist entry and a sent
    // notification — three of the four reachable only by address.
    await paidOrder({ graph, buyer: subject })

    await prisma.order.create({
      data: {
        reference: unique('DE').toUpperCase(),
        eventId: graph.event.id,
        userId: null,
        buyerEmail: subject.email,
        buyerName: subject.displayName,
        status: 'PAID',
        currency: 'INR',
        subtotalCents: 1_000,
        feesCents: 0,
        taxCents: 0,
        discountCents: 0,
        totalCents: 1_000,
        paidAt: new Date('2025-02-02T00:00:00Z'),
      },
    })

    await prisma.waitlistEntry.create({
      data: { eventId: graph.event.id, userId: null, email: subject.email, quantity: 1 },
    })

    await prisma.notificationOutbox.create({
      data: {
        template: 'order.confirmation',
        recipient: subject.email,
        userId: null,
        organizationId: graph.org.id,
        payload: { orderReference: 'DE-X' },
        status: 'SENT',
        dedupeKey: unique('dedupe-count'),
        sentAt: new Date(),
      },
    })

    const preview = await previewScope(prisma, {
      organizationId: graph.org.id,
      subjectUserId: subject.id,
    })

    const outcome = await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    for (const previewed of preview) {
      const actual = outcome.categories.find((entry) => entry.category === previewed.category)

      expect(
        actual.rows,
        `${previewed.category}: previewed ${previewed.rows}, redacted ${actual.rows}`,
      ).toBe(previewed.rows)
    }

    // And the guest rows really were reached.
    const buyer = preview.find((entry) => entry.category === PRIVACY_CATEGORIES.BUYER_IDENTITY)

    expect(buyer.rows).toBe(3)
  })

  it('scrubs a sent notification that carries the address but no account link', async () => {
    const graph = await organisation({ past: true })
    const subject = await person('guest-notified')

    await paidOrder({ graph, buyer: subject })

    const guestMessage = await prisma.notificationOutbox.create({
      data: {
        template: 'event.changed',
        recipient: subject.email,
        // A guest buyer's cancellation notice records no account link.
        userId: null,
        organizationId: graph.org.id,
        payload: { buyerName: subject.displayName, orderReference: 'DE-GUEST' },
        status: 'SENT',
        dedupeKey: unique('dedupe-guest'),
        sentAt: new Date(),
      },
    })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: graph.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const after = await prisma.notificationOutbox.findUnique({ where: { id: guestMessage.id } })

    expect(isRedactedValue(after.recipient)).toBe(true)
    expect(after.payload).toEqual({ orderReference: 'DE-GUEST' })
    expect(after.status).toBe('SENT')
  })

  it('does not reach a settled notification belonging to another organisation', async () => {
    const mine = await organisation({ past: true })
    const theirs = await organisation({ past: true })
    const subject = await person('notified-elsewhere')

    await paidOrder({ graph: mine, buyer: subject })

    const elsewhere = await prisma.notificationOutbox.create({
      data: {
        template: 'order.confirmation',
        recipient: subject.email,
        userId: subject.id,
        organizationId: theirs.org.id,
        payload: {},
        status: 'SENT',
        dedupeKey: unique('dedupe-other'),
        sentAt: new Date(),
      },
    })

    await prisma.$transaction((tx) =>
      redactSubject(tx, {
        organizationId: mine.org.id,
        subjectUserId: subject.id,
        now: new Date(),
      }),
    )

    const after = await prisma.notificationOutbox.findUnique({ where: { id: elsewhere.id } })

    expect(after.recipient).toBe(subject.email)
  })
})
