/**
 * Admission at the door, against a real database.
 *
 * `tickets.test.js` proves the routes' wiring against the stub. What is here
 * is what only PostgreSQL can answer: whether the authority read inside the
 * confirmation really is the one committed at that instant, whether the row
 * locks serialise a confirmation against a revocation, a refund or a scope
 * withdrawal, whether the unique `CheckIn.ticketId` turns two confirmations
 * into one admission, and whether the triggers the migration added refuse what
 * they say they refuse.
 *
 * Two groups, matching the brief:
 *
 * **Authorisation.** Eleven ways a scanner could be let in where it should not
 * be, and the cases the Phase 3 closure audit found missing. Each asserts the
 * refusal *and* that no `CheckIn` row was written.
 *
 * **Races.** Ten ways two things can happen to one ticket at once. Each
 * asserts one `CheckIn` row at most, a truthful answer for the loser, and no
 * error that is not one of the door's own.
 *
 * Where an interleaving has to be forced rather than hoped for, the test holds
 * a lock in one transaction and waits — by polling `pg_stat_activity`, not by
 * sleeping — until PostgreSQL reports a session blocked by *that* transaction,
 * named by its backend pid.
 *
 * Last, the audit log: every row this file caused is read back and searched for
 * the credentials, printed codes and preview references it presented.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/admission-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryPaymentProvider } from '@desi-event/providers'
import { afterAll, expect, it } from 'vitest'

import { loadActor } from '../src/lib/actor.js'
import {
  PREVIEW_TTL_MS,
  confirmAdmission as confirmAdmissionService,
  listAdmissionEvents,
  previewAdmission as previewAdmissionService,
  signPreviewReference,
} from '../src/lib/admission.js'
import {
  REFUND_OUTCOMES,
  approveRefund,
  markSubmitted,
  pendingQuantitiesByLine,
  requestRefund,
  settleRefund,
  submitOutsideTransaction,
} from '../src/lib/refunds.js'
import {
  TICKET_STATES,
  acceptTransfer,
  mintTransferToken,
  revokeTicket,
  startTransfer,
} from '../src/lib/tickets.js'
import { issueTicketCredential } from '../src/lib/ticket-credentials.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the admission suite')

/** A suffix unique to this run. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the key derivations, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

const ENV = Object.freeze({ AUTH_SECRET: SECRET })

/**
 * One mock provider for the whole suite, for the refund case.
 *
 * Its refund ids carry the run, because `Refund.provider + providerRefundId` is
 * unique and nothing this suite writes is ever deleted.
 */
const payments = createInMemoryPaymentProvider({ idPrefix: `piadmission${RUN}` })

/**
 * Every identifier this file minted, so the audit-log case can find the rows
 * this file caused and no other suite's.
 *
 * @type {Set<string>}
 */
const minted = new Set()

/**
 * Every credential, printed code and preview reference this file showed the
 * door or was given by it, each with what kind of secret it is.
 *
 * @type {Map<string, string>}
 */
const presented = new Map()

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`admission-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')
  const identifier = `c${body.padEnd(24, '0').slice(0, 24)}`

  minted.add(identifier)

  return identifier
}

/**
 * A short unique token for slugs, codes and emails.
 *
 * @returns {string} The token.
 */
function unique() {
  sequence += 1

  return `${RUN}${sequence.toString(36)}`
}

/**
 * Create a signed-in-able user.
 *
 * @param {string} label What they are for, in their name.
 * @returns {Promise<object>} The user.
 */
function user(label) {
  return prisma.user.create({
    data: {
      id: id(`user-${label}`),
      email: `${label}-${unique()}@admission.example`,
      displayName: label,
      passwordHash: 'not-a-hash-this-suite-never-signs-in',
      role: 'ORGANIZER',
      emailVerified: true,
    },
  })
}

/**
 * An organisation with a venue.
 *
 * @param {string} label Its name.
 * @returns {Promise<{organization: object, venue: object}>} The rows.
 */
async function organisation(label) {
  const organization = await prisma.organization.create({
    data: {
      id: id(`org-${label}`),
      name: `${label} ${RUN}`,
      slug: `admission-${label.toLowerCase()}-${unique()}`,
      contactEmail: `${label.toLowerCase()}-${unique()}@admission.example`,
    },
  })

  const venue = await prisma.venue.create({
    data: {
      id: id(`venue-${label}`),
      organizationId: organization.id,
      name: `${label} Hall`,
      slug: `admission-venue-${unique()}`,
      addressLine1: '1 Door Street',
      city: 'Pune',
      region: 'MH',
      postalCode: '411001',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    },
  })

  return { organization, venue }
}

/**
 * A published event with one paid order and `count` issued tickets.
 *
 * @param {object} home From {@link organisation}.
 * @param {object} holder The ticket holder.
 * @param {number} [count] How many tickets.
 * @returns {Promise<object>} `{ event, session, order, tickets }`, each ticket with its `credential`.
 */
async function eventWithTickets(home, holder, count = 1) {
  const startsAt = new Date(Date.now() + 3_600_000)
  const endsAt = new Date(startsAt.getTime() + 3 * 3_600_000)

  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: home.organization.id,
      venueId: home.venue.id,
      title: `Door Night ${unique()}`,
      slug: `admission-event-${unique()}`,
      category: 'MUSIC_CONCERT',
      summary: 'Built by the admission suite.',
      description: 'A queue, some stewards, and the tickets they check.',
      status: 'PUBLISHED',
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
    },
  })

  const session = await prisma.eventSession.create({
    data: { id: id('session'), eventId: event.id, startsAt, endsAt, timezone: 'Asia/Kolkata' },
  })

  const ticketType = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: event.id,
      name: 'Standing',
      priceCents: 100_000,
      currency: 'INR',
      quantityTotal: count,
      status: 'ON_SALE',
    },
  })

  const totalCents = 100_000 * count

  const order = await prisma.order.create({
    data: {
      id: id('order'),
      reference: `DE-${unique().toUpperCase()}`,
      eventId: event.id,
      eventSessionId: session.id,
      userId: holder.id,
      buyerEmail: holder.email,
      buyerName: holder.displayName,
      status: 'PAID',
      currency: 'INR',
      subtotalCents: totalCents,
      totalCents,
      paidAt: new Date(),
    },
  })

  await prisma.payment.create({
    data: {
      id: id('payment'),
      orderId: order.id,
      provider: 'in-memory-payments',
      providerRef: `pi_${unique()}`,
      status: 'SUCCEEDED',
      amountCents: totalCents,
      currency: 'INR',
    },
  })

  const orderItem = await prisma.orderItem.create({
    data: {
      id: id('line'),
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity: count,
      unitPriceCents: 100_000,
      subtotalCents: totalCents,
    },
  })

  const tickets = []

  for (let index = 0; index < count; index += 1) {
    const ticketId = id(`ticket-${index}`)
    const { credential, credentialHash } = issueTicketCredential({
      secret: SECRET,
      ticketId,
      version: 1,
    })

    const ticket = await prisma.ticket.create({
      data: {
        id: ticketId,
        orderItemId: orderItem.id,
        code: `DET-${unique().toUpperCase()}`,
        credentialHash,
        credentialVersion: 1,
        credentialIssuedAt: new Date(),
        attendeeName: 'Asha Door',
        ownerUserId: holder.id,
        status: TICKET_STATES.VALID,
      },
    })

    tickets.push({ ...ticket, credential })
  }

  return { event, session, order, tickets }
}

/**
 * Give a user a role in an organisation, optionally scoped to events.
 *
 * @param {object} member The user.
 * @param {object} home From {@link organisation}.
 * @param {string} role The `OrgRole`.
 * @param {string[]} [eventIds] Door scopes.
 * @returns {Promise<object>} The membership.
 */
async function member(member, home, role, eventIds = []) {
  const membership = await prisma.membership.create({
    data: { id: id('membership'), userId: member.id, organizationId: home.organization.id, role },
  })

  for (const eventId of eventIds) {
    await prisma.scannerScope.create({ data: { membershipId: membership.id, eventId } })
  }

  return membership
}

/**
 * The actor a request from this user would carry, read now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The actor.
 */
async function actorFor(who) {
  return (await loadActor(prisma, who.id)).actor
}

/**
 * A world: two organisations, three events, and a cast of stewards.
 *
 * - `home` runs `eventA` (two tickets) and `eventA2` (one ticket).
 * - `rival` runs `eventB` (one ticket).
 * - `scannerA` and `stewardA` are scoped to `eventA`; `scannerA2` to `eventA2`.
 * - `unscoped` is a SCANNER with no scope; `viewer` a VIEWER; `owner` an OWNER.
 * - `rivalOwner` owns the rival organisation.
 *
 * @returns {Promise<object>} Everything.
 */
async function world() {
  const home = await organisation('Home')
  const rival = await organisation('Rival')
  const holder = await user('holder')

  const a = await eventWithTickets(home, holder, 2)
  const a2 = await eventWithTickets(home, holder, 1)
  const b = await eventWithTickets(rival, holder, 1)

  const cast = {
    owner: await user('owner'),
    scannerA: await user('scanner-a'),
    stewardA: await user('steward-a'),
    scannerA2: await user('scanner-a2'),
    unscoped: await user('unscoped'),
    viewer: await user('viewer'),
    rivalOwner: await user('rival-owner'),
  }

  const memberships = {
    owner: await member(cast.owner, home, 'OWNER'),
    scannerA: await member(cast.scannerA, home, 'SCANNER', [a.event.id]),
    stewardA: await member(cast.stewardA, home, 'STAFF', [a.event.id]),
    scannerA2: await member(cast.scannerA2, home, 'SCANNER', [a2.event.id]),
    unscoped: await member(cast.unscoped, home, 'SCANNER'),
    viewer: await member(cast.viewer, home, 'VIEWER'),
    rivalOwner: await member(cast.rivalOwner, rival, 'OWNER'),
  }

  return { home, rival, holder, a, a2, b, cast, memberships }
}

/**
 * Note a secret this file showed the door or was given by it.
 *
 * @param {string} kind `credential`, `code` or `previewReference`.
 * @param {string|null|undefined} value The secret, when there was one.
 * @returns {void} Nothing.
 */
function remember(kind, value) {
  if (typeof value === 'string' && value !== '') presented.set(value, kind)
}

/**
 * The real `previewAdmission`, noting what was presented and what came back.
 *
 * Every door call in this file comes through here or through
 * {@link confirmAdmission} — the helpers below and the cases that call them
 * directly with an actor of their own — so the audit-log case at the end knows
 * every secret the door was shown.
 *
 * @param {object} options As for `previewAdmission`.
 * @returns {Promise<object>} What it returned.
 */
async function previewAdmission(options) {
  remember('credential', options.body?.credential)
  remember('code', options.body?.code)

  const data = await previewAdmissionService(options)

  remember('previewReference', data.previewReference)

  return data
}

/**
 * The real `confirmAdmission`, noting what was presented.
 *
 * @param {object} options As for `confirmAdmission`.
 * @returns {Promise<object>} What it returned.
 */
function confirmAdmission(options) {
  remember('credential', options.body?.credential)
  remember('code', options.body?.code)
  remember('previewReference', options.body?.previewReference)

  return confirmAdmissionService(options)
}

/**
 * Run a door call and describe what came back, error or not.
 *
 * @param {Promise<object>} call A preview or confirmation.
 * @returns {Promise<{status: number, data?: object, reason?: string, message?: string}>} The outcome.
 */
async function outcome(call) {
  try {
    return { status: 200, data: await call }
  } catch (error) {
    if (typeof error?.statusCode !== 'number') throw error

    return { status: error.statusCode, reason: error.details?.reason, message: error.message }
  }
}

/**
 * Preview as a user.
 *
 * @param {object} who The user.
 * @param {object} body The request body.
 * @returns {Promise<object>} From {@link outcome}.
 */
async function previewAs(who, body) {
  return outcome(previewAdmission({ prisma, env: ENV, actor: await actorFor(who), body }))
}

/**
 * Confirm as a user.
 *
 * @param {object} who The user.
 * @param {object} body The request body, with its `previewReference`.
 * @returns {Promise<object>} From {@link outcome}.
 */
async function confirmAs(who, body) {
  return outcome(confirmAdmission({ prisma, env: ENV, actor: await actorFor(who), body }))
}

/**
 * Preview, assert it is admissible, and hand back the confirmation body.
 *
 * @param {object} who The user.
 * @param {object} presentation `{ code }` or `{ credential }`.
 * @returns {Promise<object>} The body a confirmation would send.
 */
async function previewed(who, presentation) {
  const looked = await previewAs(who, presentation)

  expect(looked.status, looked.message).toBe(200)
  expect(looked.data.outcome).toBe('ADMISSIBLE')

  return { ...presentation, previewReference: looked.data.previewReference }
}

/**
 * A reference the server would have signed, for a caller who never got one.
 *
 * The strongest version of "the preview is not an authorisation token": even a
 * validly signed reference, naming this caller, admits nobody the confirmation
 * does not itself authorise.
 *
 * @param {object} options Options.
 * @param {object} options.ticket The ticket.
 * @param {object} options.event Its event.
 * @param {object} options.who The caller.
 * @param {string} [options.method] How it is presented.
 * @returns {string} The reference.
 */
function forgedButValid({ ticket, event, who, method = 'MANUAL_CODE' }) {
  return signPreviewReference({
    secret: SECRET,
    ticketId: ticket.id,
    eventId: event.id,
    organizationId: event.organizationId,
    actorId: who.id,
    method,
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
  })
}

/**
 * How many admissions a ticket has.
 *
 * @param {object} ticket The ticket.
 * @returns {Promise<number>} The `CheckIn` count.
 */
function admissions(ticket) {
  return prisma.checkIn.count({ where: { ticketId: ticket.id } })
}

/**
 * A pattern matching a secret as a whole token, not as the start of a longer one.
 *
 * Printed codes here are a run prefix and a counter, so one code can be the
 * beginning of another: `DET-X1` inside `DET-X12` is not that code.
 *
 * @param {string} secret A credential, printed code or preview reference.
 * @returns {RegExp} The pattern.
 */
function token(secret) {
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'u')
}

/**
 * Wait until PostgreSQL reports a session blocked by the holder's transaction.
 *
 * The honest way to say "the other transaction has reached the lock": ask the
 * database, rather than sleep and hope. And ask about this holder, by its
 * backend pid through `pg_blocking_pids`, rather than whether any session in
 * the database is waiting on a lock: another suite's lock wait answers that
 * question just as well, and a race that ran in sequence would still pass.
 *
 * @param {{pid: number}} holder From {@link holding}.
 * @returns {Promise<void>} Resolves once a session is blocked by it.
 * @throws {Error} After five seconds without one.
 */
async function untilBlocked(holder) {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    const [{ waiting }] = await prisma.$queryRaw`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND ${holder.pid}::int = ANY (pg_blocking_pids(pid))`

    if (waiting > 0) return

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }

  throw new Error(
    `No session was blocked by the holding transaction (backend ${holder.pid}) within five ` +
      'seconds: the racing call never waited on its lock.',
  )
}

/**
 * Hold a lock in a transaction until told to let go.
 *
 * @param {function(object): Promise<void>} take Takes the lock.
 * @param {function(object): Promise<void>} [then] Runs before commit.
 * @returns {Promise<{release: function(): void, done: Promise<void>, pid: number}>} Resolves once
 *   the lock is held, with the backend pid of the transaction holding it.
 */
async function holding(take, then = async () => {}) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })

  let held
  const heldPromise = new Promise((resolve) => {
    held = resolve
  })

  const done = prisma.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

      await take(tx)
      held(pid)
      await gate
      await then(tx)
    },
    { timeout: 20_000, maxWait: 10_000 },
  )

  const pid = await heldPromise

  return { release, done, pid }
}

/**
 * Refund an order in full through the refund service, as the routes do.
 *
 * Requested and approved, marked SUBMITTED in its own transaction, sent to the
 * in-memory provider with nothing open, and settled — the settlement is what
 * revokes the tickets and clears their passes. The fixture's payment carries a
 * reference no provider issued, so the refund goes against an intent this
 * suite's provider captured for the same amount: the substitution
 * `refund-concurrency.test.js` makes for its timeout case.
 *
 * @param {object} sold From {@link eventWithTickets}.
 * @param {object} who Who asks for, approves and settles it.
 * @returns {Promise<object>} What `settleRefund` returned.
 */
async function refundInFull(sold, who) {
  const payment = await prisma.payment.findFirst({
    where: { orderId: sold.order.id, status: 'SUCCEEDED' },
  })
  const items = await prisma.orderItem.findMany({ where: { orderId: sold.order.id } })

  const { refund } = await prisma.$transaction(async (tx) =>
    requestRefund(tx, {
      order: { ...(await tx.order.findUnique({ where: { id: sold.order.id } })), items },
      payment,
      lines: items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })),
      pendingByLine: await pendingQuantitiesByLine(tx, sold.order.id),
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: `admission-refund-${unique()}`,
      actorId: who.id,
      now: new Date(),
    }),
  )

  await prisma.$transaction((tx) => approveRefund(tx, { refund, actorId: who.id, now: new Date() }))

  const approved = await prisma.refund.findUnique({ where: { id: refund.id } })

  await prisma.$transaction((tx) => markSubmitted(tx, { refund: approved, now: new Date() }))

  const submitted = await prisma.refund.findUnique({ where: { id: refund.id } })
  const intent = payments.createIntent({
    amountCents: payment.amountCents,
    currency: payment.currency,
  })

  payments.capture(intent.id)

  const result = await submitOutsideTransaction(payments, submitted, {
    ...payment,
    providerRef: intent.id,
  })

  expect(result.outcome, 'the mock provider did not take the refund').toBe(
    REFUND_OUTCOMES.SUCCEEDED,
  )

  return prisma.$transaction(async (tx) =>
    settleRefund(tx, {
      refund: submitted,
      order: await tx.order.findUnique({ where: { id: sold.order.id } }),
      result,
      organizationId: sold.event.organizationId,
      eventStartsAt: sold.event.startsAt,
      actorId: who.id,
      now: new Date(),
    }),
  )
}

afterAll(async () => {
  // Nothing is deleted: audit rows are append-only by trigger, and every row
  // here carries a per-run suffix. See `connect-lifecycle-integration.test.js`.
  await prisma.$disconnect().catch(() => {})
})

when()('what the migration put in the database', () => {
  it('renamed the manual method and kept the unrecorded one out of use', async () => {
    const labels = await prisma.$queryRaw`
      SELECT e.enumlabel AS label FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'CheckInMethod' ORDER BY e.enumsortorder`

    expect(labels.map((row) => row.label)).toEqual(['QR_SCAN', 'MANUAL_CODE', 'ASSISTED'])
  })

  it('refuses a door scope naming another organisation’s event', async () => {
    const w = await world()

    // Straight at the table, not through the route: the question is whether
    // the database refuses it when some future code path forgets to.
    await expect(
      prisma.scannerScope.create({
        data: { membershipId: w.memberships.scannerA.id, eventId: w.b.event.id },
      }),
    ).rejects.toThrow(/organi[sz]ation/iu)
  })

  it('refuses a door scope naming an event that does not exist', async () => {
    const w = await world()

    await expect(
      prisma.scannerScope.create({
        data: { membershipId: w.memberships.scannerA.id, eventId: id('no-such-event') },
      }),
    ).rejects.toThrow()
  })
})

when()('a preview', () => {
  it('writes nothing to the ticket and records no admission', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const before = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    const byCredential = await previewAs(w.cast.scannerA, { credential: ticket.credential })
    const byCode = await previewAs(w.cast.scannerA, { code: ticket.code })

    expect(byCredential.data).toMatchObject({ outcome: 'ADMISSIBLE', method: 'QR_SCAN' })
    expect(byCode.data).toMatchObject({ outcome: 'ADMISSIBLE', method: 'MANUAL_CODE' })
    expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).toEqual(before)
    expect(await admissions(ticket)).toBe(0)
  })

  it('lists for a scoped scanner only the event its scope names', async () => {
    const w = await world()
    const entries = await listAdmissionEvents({ prisma, actor: await actorFor(w.cast.scannerA) })

    expect(entries.map((entry) => entry.event.id)).toEqual([w.a.event.id])
    expect(entries[0]).toMatchObject({ authority: 'EVENT_SCOPE', role: 'SCANNER' })
  })
})

when()('scanner authorisation', () => {
  it('1. a scanner scoped to event A cannot preview a ticket for event B', async () => {
    const w = await world()
    const [ticketA2] = w.a2.tickets

    const real = await previewAs(w.cast.scannerA, { code: ticketA2.code })
    const invented = await previewAs(w.cast.scannerA, { code: `DET-${unique().toUpperCase()}` })

    expect(real.status).toBe(404)
    expect(real.message).toBe(invented.message)
    expect(await admissions(ticketA2)).toBe(0)
  })

  it('2. a scanner scoped to event A cannot check in a ticket for event B, even with a signed reference', async () => {
    const w = await world()
    const [ticketA2] = w.a2.tickets

    const result = await confirmAs(w.cast.scannerA, {
      code: ticketA2.code,
      previewReference: forgedButValid({
        ticket: ticketA2,
        event: w.a2.event,
        who: w.cast.scannerA,
      }),
    })

    expect(result.status).toBe(403)
    expect(await admissions(ticketA2)).toBe(0)
  })

  it('3. an owner of organisation A cannot preview or admit organisation B’s ticket', async () => {
    const w = await world()
    const [ticketB] = w.b.tickets

    const looked = await previewAs(w.cast.owner, { code: ticketB.code })
    const admitted = await confirmAs(w.cast.owner, {
      code: ticketB.code,
      previewReference: forgedButValid({ ticket: ticketB, event: w.b.event, who: w.cast.owner }),
    })

    expect(looked.status).toBe(404)
    expect(admitted.status).toBe(403)
    expect(await admissions(ticketB)).toBe(0)
  })

  it('4. a scanner with no scope admits nobody', async () => {
    const w = await world()
    const [ticket] = w.a.tickets

    expect((await previewAs(w.cast.unscoped, { code: ticket.code })).status).toBe(404)
    expect(
      (
        await confirmAs(w.cast.unscoped, {
          code: ticket.code,
          previewReference: forgedButValid({ ticket, event: w.a.event, who: w.cast.unscoped }),
        })
      ).status,
    ).toBe(403)
    expect(await admissions(ticket)).toBe(0)
  })

  it('5. a removed membership admits nobody, even to a caller still holding the old actor', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    // Read before the removal, the way a request that began a moment earlier
    // would hold it. Door authority must come from the database, not from this.
    const stale = await actorFor(w.cast.scannerA)
    const body = await previewed(w.cast.scannerA, { code: ticket.code })

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "id" = ${w.memberships.scannerA.id} FOR UPDATE`
      await tx.scannerScope.deleteMany({ where: { membershipId: w.memberships.scannerA.id } })
      await tx.membership.delete({ where: { id: w.memberships.scannerA.id } })
    })

    const looked = await outcome(
      previewAdmission({ prisma, env: ENV, actor: stale, body: { code: ticket.code } }),
    )
    const admitted = await outcome(confirmAdmission({ prisma, env: ENV, actor: stale, body }))

    expect(looked.status).toBe(404)
    expect(admitted.status).toBe(403)
    expect(await admissions(ticket)).toBe(0)
  })

  it('6. an expired or revoked session is refused before the door is reached', async () => {
    // The door has no session logic of its own: the session guard runs first
    // and answers 401. Asserted through the routes in `tickets.test.js`
    // ("refuses a caller whose session has ended"); here, the service's own
    // floor — an actor with no memberships at all — is a 403 before any read.
    const w = await world()
    const [ticket] = w.a.tickets
    const nobody = { id: w.cast.scannerA.id, role: 'ORGANIZER', memberships: [] }

    const looked = await outcome(
      previewAdmission({ prisma, env: ENV, actor: nobody, body: { code: ticket.code } }),
    )

    expect(looked.status).toBe(403)
    expect(await admissions(ticket)).toBe(0)
  })

  it('7. a role without ticket:check_in is refused, even with a scope row', async () => {
    const w = await world()
    const [ticket] = w.a.tickets

    // A VIEWER with a scope row the table allows but the policy ignores.
    await prisma.scannerScope.create({
      data: { membershipId: w.memberships.viewer.id, eventId: w.a.event.id },
    })

    const looked = await previewAs(w.cast.viewer, { code: ticket.code })
    const admitted = await confirmAs(w.cast.viewer, {
      code: ticket.code,
      previewReference: forgedButValid({ ticket, event: w.a.event, who: w.cast.viewer }),
    })

    expect(looked.status).toBe(403)
    expect(admitted.status).toBe(403)
    expect(await admissions(ticket)).toBe(0)
  })

  it('8. the event id a browser sends never decides authority', async () => {
    const w = await world()
    const [ticketA] = w.a.tickets

    // Scoped to A2 only, claiming to stand at A2, presenting A's ticket. If the
    // browser's event decided authority, this would pass.
    const claimed = await previewAs(w.cast.scannerA2, {
      code: ticketA.code,
      expectedEventId: w.a2.event.id,
    })

    expect(claimed.status).toBe(404)

    // Scoped to A, presenting A's ticket, while the browser says A2: the
    // server authorises against A and reports the mismatch rather than
    // admitting.
    const mismatched = await previewAs(w.cast.scannerA, {
      code: ticketA.code,
      expectedEventId: w.a2.event.id,
    })

    expect(mismatched.data).toMatchObject({
      outcome: 'REFUSED',
      refusal: 'WRONG_EVENT',
      previewReference: null,
    })
    expect(await admissions(ticketA)).toBe(0)
  })

  it('9. a scope granted after the session began takes effect on the next request', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const actor = await actorFor(w.cast.unscoped)

    const before = await outcome(
      previewAdmission({ prisma, env: ENV, actor, body: { code: ticket.code } }),
    )

    await prisma.scannerScope.create({
      data: { membershipId: w.memberships.unscoped.id, eventId: w.a.event.id },
    })

    // The same actor object, as a long-lived session would carry.
    const after = await outcome(
      previewAdmission({ prisma, env: ENV, actor, body: { code: ticket.code } }),
    )

    expect(before.status).toBe(404)
    expect(after.data.outcome).toBe('ADMISSIBLE')
  })

  it('10. a scope withdrawn between preview and confirmation admits nobody', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const body = await previewed(w.cast.scannerA, { code: ticket.code })

    await prisma.scannerScope.deleteMany({ where: { membershipId: w.memberships.scannerA.id } })

    const result = await confirmAs(w.cast.scannerA, body)

    expect(result.status).toBe(403)
    expect(await admissions(ticket)).toBe(0)
    expect((await prisma.ticket.findUnique({ where: { id: ticket.id } })).status).toBe('VALID')
  })

  it('11. a scope or role changed between preview and confirmation is what the confirmation sees', async () => {
    const w = await world()
    const [first, second] = w.a.tickets

    // Moved from A to A2: the new scope does not cover the previewed ticket.
    const moved = await previewed(w.cast.scannerA, { code: first.code })

    await prisma.$transaction([
      prisma.scannerScope.deleteMany({ where: { membershipId: w.memberships.scannerA.id } }),
      prisma.scannerScope.create({
        data: { membershipId: w.memberships.scannerA.id, eventId: w.a2.event.id },
      }),
    ])

    expect((await confirmAs(w.cast.scannerA, moved)).status).toBe(403)

    // Demoted to VIEWER with the scope still in place: the role no longer
    // carries the capability, and the scope alone is nothing.
    const demoted = await previewed(w.cast.stewardA, { code: second.code })

    await prisma.membership.update({
      where: { id: w.memberships.stewardA.id },
      data: { role: 'VIEWER' },
    })

    expect((await confirmAs(w.cast.stewardA, demoted)).status).toBe(403)
    expect(await admissions(first)).toBe(0)
    expect(await admissions(second)).toBe(0)
  })

  it('does not let a platform super-administrator admit, and says so in the audit log', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const platform = await prisma.user.create({
      data: {
        id: id('platform'),
        email: `platform-${unique()}@admission.example`,
        displayName: 'Platform',
        passwordHash: 'not-a-hash-this-suite-never-signs-in',
        role: 'SUPER_ADMIN',
        emailVerified: true,
      },
    })

    const looked = await previewAs(platform, { code: ticket.code })

    expect(looked.status).toBe(403)
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'ticket.admission_refused',
          entityId: platform.id,
          metadata: { path: ['reason'], equals: 'PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY' },
        },
      }),
    ).toBe(1)
  })

  it('a scanner of another organisation, scoped to its own event, is told nothing and admits nobody, finding AUZ-3', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const outsider = await user('rival-scanner')

    await member(outsider, w.rival, 'SCANNER', [w.b.event.id])

    // Door authority of its own, at its own event, so the refusals below come
    // from the ticket's organisation and event and not from the floor that
    // refuses a caller with no door authority anywhere.
    await previewed(outsider, { code: w.b.tickets[0].code })

    const invented = await previewAs(outsider, { code: `DET-${unique().toUpperCase()}` })
    const byCode = await previewAs(outsider, { code: ticket.code })
    const byCredential = await previewAs(outsider, { credential: ticket.credential })

    expect(invented.status).toBe(404)
    expect(byCode).toMatchObject({ status: 404, message: invented.message })
    expect(byCredential).toMatchObject({ status: 404, message: invented.message })

    const admittedByCode = await confirmAs(outsider, {
      code: ticket.code,
      previewReference: forgedButValid({ ticket, event: w.a.event, who: outsider }),
    })
    const admittedByCredential = await confirmAs(outsider, {
      credential: ticket.credential,
      previewReference: forgedButValid({
        ticket,
        event: w.a.event,
        who: outsider,
        method: 'QR_SCAN',
      }),
    })

    expect(admittedByCode.status).toBe(403)
    expect(admittedByCredential.status).toBe(403)
    expect(await admissions(ticket)).toBe(0)
  })

  it('a confirmation naming another event the scanner also covers is refused as the wrong event, finding AUZ-8', async () => {
    const w = await world()
    const [byCode, byCredential] = w.a.tickets
    const both = await user('scanner-both')

    // Scoped to both of Home's events, so the event mismatch is the only thing
    // wrong and the refusal cannot be a scope refusal under another name.
    await member(both, w.home, 'SCANNER', [w.a.event.id, w.a2.event.id])

    const codeBody = await previewed(both, { code: byCode.code, expectedEventId: w.a.event.id })
    const credentialBody = await previewed(both, {
      credential: byCredential.credential,
      expectedEventId: w.a.event.id,
    })

    // The door screen was switched to A2 between the preview and the tap.
    const codeResult = await confirmAs(both, { ...codeBody, expectedEventId: w.a2.event.id })
    const credentialResult = await confirmAs(both, {
      ...credentialBody,
      expectedEventId: w.a2.event.id,
    })

    expect(codeResult).toMatchObject({ status: 409, reason: 'WRONG_EVENT' })
    expect(credentialResult).toMatchObject({ status: 409, reason: 'WRONG_EVENT' })
    expect(await admissions(byCode)).toBe(0)
    expect(await admissions(byCredential)).toBe(0)
  })

  it('a scope withdrawn between a QR preview and its confirmation admits nobody, finding QRC-12', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const body = await previewed(w.cast.scannerA, { credential: ticket.credential })

    await prisma.scannerScope.deleteMany({ where: { membershipId: w.memberships.scannerA.id } })

    expect((await confirmAs(w.cast.scannerA, body)).status).toBe(403)
    expect(await admissions(ticket)).toBe(0)
  })

  it('a demotion to VIEWER between a QR preview and its confirmation admits nobody, finding QRC-12', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    // Read before the demotion, as a request already in flight would hold it.
    // An actor read afterwards is refused at the floor; this one reaches the
    // authority re-read inside the confirmation, which is what is under test.
    const stale = await actorFor(w.cast.stewardA)
    const body = await previewed(w.cast.stewardA, { credential: ticket.credential })

    await prisma.membership.update({
      where: { id: w.memberships.stewardA.id },
      data: { role: 'VIEWER' },
    })

    expect(
      await prisma.scannerScope.count({ where: { membershipId: w.memberships.stewardA.id } }),
    ).toBe(1)
    expect((await confirmAs(w.cast.stewardA, body)).status).toBe(403)
    expect((await outcome(confirmAdmission({ prisma, env: ENV, actor: stale, body }))).status).toBe(
      403,
    )
    expect(await admissions(ticket)).toBe(0)
  })
})

when()('admission races', () => {
  it('1. two simultaneous confirmations of one preview admit once', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const body = await previewed(w.cast.scannerA, { code: ticket.code })

    const results = await Promise.all([
      confirmAs(w.cast.scannerA, body),
      confirmAs(w.cast.scannerA, body),
    ])

    expect(results.map((result) => result.status)).toEqual([200, 200])
    expect(results.map((result) => result.data.outcome).sort()).toEqual([
      'ADMITTED',
      'ALREADY_CHECKED_IN',
    ])
    expect(results.every((result) => result.data.checkedInByYou)).toBe(true)
    expect(new Set(results.map((result) => String(result.data.checkedInAt))).size).toBe(1)
    expect(await admissions(ticket)).toBe(1)
  })

  it('2. two stewards confirming one ticket at once admit once, and the loser is told who won', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const scannerBody = await previewed(w.cast.scannerA, { code: ticket.code })
    const stewardBody = await previewed(w.cast.stewardA, { code: ticket.code })

    const [scanner, steward] = await Promise.all([
      confirmAs(w.cast.scannerA, scannerBody),
      confirmAs(w.cast.stewardA, stewardBody),
    ])

    const winner = scanner.data.outcome === 'ADMITTED' ? scanner : steward
    const loser = winner === scanner ? steward : scanner

    expect(winner.data).toMatchObject({ outcome: 'ADMITTED', checkedInByYou: true })
    expect(loser.data).toMatchObject({ outcome: 'ALREADY_CHECKED_IN', checkedInByYou: false })
    expect(await admissions(ticket)).toBe(1)
  })

  it('3. a QR scan and a typed code racing for one ticket admit once, recording the winner’s method', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const scanned = await previewed(w.cast.scannerA, { credential: ticket.credential })
    const typed = await previewed(w.cast.stewardA, { code: ticket.code })

    const [qr, manual] = await Promise.all([
      confirmAs(w.cast.scannerA, scanned),
      confirmAs(w.cast.stewardA, typed),
    ])

    const winner = qr.data.outcome === 'ADMITTED' ? qr : manual
    const rows = await prisma.checkIn.findMany({ where: { ticketId: ticket.id } })

    expect([qr, manual].filter((result) => result.data.outcome === 'ADMITTED')).toHaveLength(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].method).toBe(winner === qr ? 'QR_SCAN' : 'MANUAL_CODE')
    expect(winner.data.method).toBe(rows[0].method)
  })

  it('4. a preview overtaken by another steward’s admission confirms as already in', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const late = await previewed(w.cast.scannerA, { code: ticket.code })
    const early = await previewed(w.cast.stewardA, { code: ticket.code })

    expect((await confirmAs(w.cast.stewardA, early)).data.outcome).toBe('ADMITTED')

    const result = await confirmAs(w.cast.scannerA, late)

    expect(result.data).toMatchObject({ outcome: 'ALREADY_CHECKED_IN', checkedInByYou: false })
    expect(await admissions(ticket)).toBe(1)
  })

  it('5. a scope withdrawal in flight holds the confirmation, which then sees it gone', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const body = await previewed(w.cast.scannerA, { code: ticket.code })

    // The revocation takes the membership row first, as the team routes do.
    const revocation = await holding(
      (tx) =>
        tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "id" = ${w.memberships.scannerA.id} FOR UPDATE`,
      (tx) => tx.scannerScope.deleteMany({ where: { membershipId: w.memberships.scannerA.id } }),
    )

    const confirmation = confirmAs(w.cast.scannerA, body)

    // The confirmation has locked the ticket and is now waiting on the
    // membership. Only then does the revocation delete the scope and commit.
    await untilBlocked(revocation)
    revocation.release()
    await revocation.done

    const result = await confirmation

    expect(result.status).toBe(403)
    expect(await admissions(ticket)).toBe(0)
  })

  it('6. a revocation in flight holds the confirmation, which then refuses a revoked ticket', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const body = await previewed(w.cast.scannerA, { credential: ticket.credential })

    const revocation = await holding((tx) =>
      revokeTicket(tx, {
        ticket,
        reason: 'Removed by the organiser during the admission race test.',
        actorId: w.cast.owner.id,
        now: new Date(),
      }),
    )

    const confirmation = confirmAs(w.cast.scannerA, body)

    await untilBlocked(revocation)
    revocation.release()
    await revocation.done

    const result = await confirmation

    // The pass stopped resolving when the digest was cleared, and the door is
    // told why rather than "not found".
    expect(result).toMatchObject({ status: 409, reason: 'REVOKED' })
    expect(await admissions(ticket)).toBe(0)
  })

  it('7. a ticket refunded after its preview is refused, by pass and by code', async () => {
    const w = await world()
    const [byPass, byCode] = w.a.tickets
    const passBody = await previewed(w.cast.scannerA, { credential: byPass.credential })
    const codeBody = await previewed(w.cast.scannerA, { code: byCode.code })

    // The refund service itself rather than a copy of what it writes, so the
    // door is tested against whatever a settled refund actually leaves behind.
    const settled = await refundInFull(w.a, w.cast.owner)

    expect(settled).toMatchObject({ settled: true, ticketsRevoked: 2 })
    expect(await confirmAs(w.cast.scannerA, passBody)).toMatchObject({
      status: 409,
      reason: 'REFUNDED',
    })
    expect(await confirmAs(w.cast.scannerA, codeBody)).toMatchObject({
      status: 409,
      reason: 'REFUNDED',
    })
    expect(await admissions(byPass)).toBe(0)
    expect(await admissions(byCode)).toBe(0)
  })

  it('8. a transfer accepted after the preview leaves the old pass admitting nobody', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const recipient = await user('recipient')
    const body = await previewed(w.cast.scannerA, { credential: ticket.credential })
    const codeBody = await previewed(w.cast.scannerA, { code: ticket.code })
    const { tokenHash } = mintTransferToken()

    const accepted = await prisma.$transaction(async (tx) => {
      const { transfer } = await startTransfer(tx, {
        ticket,
        toEmail: recipient.email,
        fromUserId: w.holder.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        now: new Date(),
      })
      const pending = await tx.ticket.findUnique({ where: { id: ticket.id } })

      return acceptTransfer(tx, {
        transfer,
        ticket: pending,
        recipient,
        credentialSecret: SECRET,
        generateTicketCode: () => `DET-${unique().toUpperCase()}`,
        now: new Date(),
      })
    })

    expect(accepted.accepted).toBe(true)
    expect(await confirmAs(w.cast.scannerA, body)).toMatchObject({
      status: 409,
      reason: 'TRANSFERRED',
    })
    expect(await confirmAs(w.cast.scannerA, codeBody)).toMatchObject({
      status: 409,
      reason: 'TRANSFERRED',
    })
    expect(await admissions(ticket)).toBe(0)

    // The recipient's new pass is the one that works.
    const fresh = await previewed(w.cast.scannerA, { credential: accepted.credential })

    expect((await confirmAs(w.cast.scannerA, fresh)).data.outcome).toBe('ADMITTED')
    expect(await admissions(accepted.ticket)).toBe(1)
  })

  it('9. a browser that submits the same confirmation three times admits once', async () => {
    const w = await world()
    const [ticket] = w.a.tickets
    const body = await previewed(w.cast.scannerA, { code: ticket.code })

    const results = []

    for (let attempt = 0; attempt < 3; attempt += 1) {
      results.push(await confirmAs(w.cast.scannerA, body))
    }

    expect(results.map((result) => result.data.outcome)).toEqual([
      'ADMITTED',
      'ALREADY_CHECKED_IN',
      'ALREADY_CHECKED_IN',
    ])
    expect(new Set(results.map((result) => String(result.data.checkedInAt))).size).toBe(1)
    expect(await admissions(ticket)).toBe(1)
  })

  it('10. a network retry while the first request is still in flight admits once', async () => {
    // There is no idempotency key on this route: the confirmation is idempotent
    // on the ticket itself. A retry — the same body, sent again because the
    // first response never arrived — is either the admission or a truthful
    // "already in, by you", with the same instant, and never a second row.
    const w = await world()
    const [ticket] = w.a.tickets
    const body = await previewed(w.cast.scannerA, { credential: ticket.credential })

    const results = await Promise.all(
      Array.from({ length: 4 }, () => confirmAs(w.cast.scannerA, body)),
    )

    expect(results.filter((result) => result.data.outcome === 'ADMITTED')).toHaveLength(1)
    expect(results.every((result) => result.data.checkedInByYou)).toBe(true)
    expect(new Set(results.map((result) => String(result.data.checkedInAt))).size).toBe(1)
    expect(await admissions(ticket)).toBe(1)
  })

  it('never deadlocks a confirmation against a member removal', async () => {
    // The lock order is ticket, membership, scope in the confirmation and
    // membership, scope in the removal. Run both many times at once and
    // require that neither ever fails with 40P01.
    const w = await world()
    const outcomes = []

    for (let round = 0; round < 5; round += 1) {
      const steward = await user(`steward-round-${round}`)
      const membership = await member(steward, w.home, 'STAFF', [w.a.event.id])
      const [ticket] = (await eventWithTickets(w.home, w.holder, 1)).tickets
      // Scope the steward to the new ticket's event too.
      const event = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { orderItem: { select: { order: { select: { eventId: true } } } } },
      })

      await prisma.scannerScope.create({
        data: { membershipId: membership.id, eventId: event.orderItem.order.eventId },
      })

      const body = await previewed(steward, { code: ticket.code })

      const [confirmation, removal] = await Promise.allSettled([
        confirmAs(steward, body),
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "id" = ${membership.id} FOR UPDATE`
          await tx.scannerScope.deleteMany({ where: { membershipId: membership.id } })
          await tx.membership.delete({ where: { id: membership.id } })
        }),
      ])

      expect(confirmation.status).toBe('fulfilled')
      expect(removal.status).toBe('fulfilled')
      expect([200, 403]).toContain(confirmation.value.status)
      expect(await admissions(ticket)).toBe(confirmation.value.status === 200 ? 1 : 0)

      outcomes.push(confirmation.value.status)
    }

    // Recorded rather than asserted: which one wins each round is up to the
    // scheduler. What is asserted is that every round ended in one of the two.
    expect(outcomes).toHaveLength(5)
  })
})

when()('what the audit log kept, finding QRC-9h', () => {
  it('holds no credential, printed code or preview reference this file presented', async () => {
    // Last in the file, so every case above — refusals included — has written
    // its rows. Found by this run's identifiers: the ticket a row is about,
    // or the caller who caused it.
    const ids = [...minted]
    const rows = await prisma.auditLog.findMany({
      where: { OR: [{ entityId: { in: ids } }, { actorId: { in: ids } }] },
    })

    expect(presented.size, 'nothing was presented to the door').toBeGreaterThan(0)
    expect(
      rows.some((row) => row.action === 'ticket.admission_refused' && row.entityType === 'Ticket'),
      'no refusal row to search',
    ).toBe(true)

    const secrets = [...presented].map(([secret, kind]) => ({ kind, pattern: token(secret) }))
    const leaks = []

    for (const row of rows) {
      const text = JSON.stringify(row)

      for (const { kind, pattern } of secrets) {
        if (pattern.test(text)) leaks.push(`${row.action} on ${row.entityId} carries a ${kind}`)
      }
    }

    expect(leaks).toEqual([])
  })
})
