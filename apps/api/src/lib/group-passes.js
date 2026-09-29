/**
 * The group pass: one QR for everybody on an order that its buyer still holds.
 *
 * ## Who it is for
 *
 * The account that bought the order — `Order.userId`, the single source of
 * truth; the pass has no holder column of its own. Nobody else may take it out
 * or replace it: not an organiser holding `order:view`, not a platform
 * administrator, not another account signed in with the buyer's address, not a
 * guest order. Every one of them gets the same 404 as a reference nobody has
 * used, exactly as a ticket's own pass does.
 *
 * ## What it admits
 *
 * Computed live, at every door read: the tickets on the order held by its
 * buyer, minus rows a later row on the order superseded. A ticket handed on
 * leaves the group when its transfer is accepted — its old row is TRANSFERRED
 * and superseded, and the new row belongs to somebody else, who has their own
 * pass. So a transfer never needs the group pass replaced: an old screenshot of
 * it can only ever admit the buyer's own live tickets. A ticket with an offer
 * outstanding still admits, like its own pass; admitting it makes the offer
 * unacceptable (the acceptance answers TICKET_CHANGED).
 *
 * ## Created lazily
 *
 * The row is created on the buyer's first request for it, so checkout, the
 * webhook and every existing order are untouched, and nothing needed a
 * backfill. The QR content and the printed code are derived from the row's id
 * and version (`./group-pass-credentials.js`); only their digests are stored.
 *
 * @module @desi-event/api/lib/group-passes
 */

import { timingSafeEqual } from 'node:crypto'

import { GROUP_PASS_MAX_TICKETS, GROUP_PASS_MIN_TICKETS } from '@desi-event/schemas'

import { ADMISSION_INCLUDE } from './admission.js'
import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { conflict, databaseErrorCode, notFound } from './errors.js'
import {
  groupCodeDigest,
  groupCredentialMatches,
  issueGroupPass,
} from './group-pass-credentials.js'
import { TICKET_STATES, admissionRefusalCode } from './tickets.js'

/** The one answer for anybody who is not the order's buyer. */
const NO_SUCH_ORDER = 'No such order.'

/** How many times a clash on a freshly derived digest is retried. */
const DIGEST_ATTEMPTS = 3

/**
 * The order columns a group decision reads. Never the buyer's address or
 * totals: nothing here needs them, and a query that never fetches them cannot
 * leak them.
 */
export const GROUP_ORDER_SELECT = Object.freeze({
  id: true,
  reference: true,
  status: true,
  userId: true,
  eventSessionId: true,
  event: {
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      status: true,
      cancelledAt: true,
      organizationId: true,
    },
  },
})

/**
 * Which ticket rows on an order a later row replaced.
 *
 * The same rule as the order presenter: every accepted transfer mints a new row
 * on the same order item pointing back at the one it replaced.
 *
 * @param {Array<{supersedesTicketId?: string|null}>} rows Every ticket row on the order.
 * @returns {Set<string>} The replaced ids.
 */
export function supersededIds(rows) {
  return new Set(rows.map((row) => row.supersedesTicketId).filter(Boolean))
}

/**
 * Split an order's ticket rows into the group and what was handed on.
 *
 * @param {object} order The order, with `userId`.
 * @param {Array<object>} rows Every ticket row on the order.
 * @returns {{tickets: Array<object>, handedOn: number}} The buyer's current rows, oldest first, and how many current rows other people hold.
 */
export function groupMembers(order, rows) {
  if (!order?.userId) return { tickets: [], handedOn: 0 }

  const superseded = supersededIds(rows)
  const current = rows.filter((row) => !superseded.has(row.id))

  const tickets = current
    .filter((row) => row.ownerUserId === order.userId)
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
        String(left.id).localeCompare(String(right.id)),
    )

  // A current row somebody else holds reached them through a transfer: it
  // supersedes a row that was on this order.
  const handedOn = current.filter(
    (row) => row.ownerUserId !== order.userId && row.supersedesTicketId,
  ).length

  return { tickets, handedOn }
}

/**
 * Every ticket row on an order, with what the door needs.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} orderId The order.
 * @returns {Promise<Array<object>>} The rows, with `ADMISSION_INCLUDE`.
 */
export async function orderTicketRows(db, orderId) {
  return db.ticket.findMany({
    where: { orderItem: { orderId } },
    include: ADMISSION_INCLUDE,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

/**
 * Whether a ticket would admit right now, and is not already in.
 *
 * @param {object} ticket The ticket.
 * @param {object} order Its order.
 * @param {object|null} event Its event.
 * @returns {boolean} True when it would admit.
 */
function stillAdmits(ticket, order, event) {
  return (
    ticket.status !== TICKET_STATES.CHECKED_IN &&
    admissionRefusalCode(ticket, order, event) === null
  )
}

/**
 * Whether an order has a group pass to show, and why not.
 *
 * @param {object} order The order, with `status`, `userId` and `event`.
 * @param {Array<object>} tickets The buyer's current rows (see {@link groupMembers}).
 * @returns {{admits: number, available: boolean, unavailableReason: string|null}} The answer.
 */
export function groupPassEligibility(order, tickets) {
  const event = order.event ?? null
  const admits = tickets.filter((ticket) => stillAdmits(ticket, order, event)).length

  let unavailableReason = null

  if (order.status !== 'PAID') unavailableReason = 'ORDER_NOT_PAID'
  else if (event && (event.status === 'CANCELLED' || event.cancelledAt)) {
    unavailableReason = 'EVENT_CANCELLED'
  } else if (admits < GROUP_PASS_MIN_TICKETS) unavailableReason = 'TOO_FEW_TICKETS'
  else if (admits > GROUP_PASS_MAX_TICKETS) unavailableReason = 'TOO_MANY_TICKETS'

  return { admits, available: unavailableReason === null, unavailableReason }
}

/**
 * The group-pass summary for `orders.get`, for the buyer and nobody else.
 *
 * Needs no query of its own: the order route already loads every ticket row
 * on the order and its event.
 *
 * @param {object} order An order with `items[].tickets` and `event`.
 * @param {object} options Options.
 * @param {string|null|undefined} options.viewerUserId Who is reading.
 * @returns {{admits: number, available: boolean, unavailableReason: string|null}|null} The summary, or null.
 */
export function groupPassSummary(order, { viewerUserId }) {
  if (!order?.userId || !viewerUserId || order.userId !== viewerUserId) return null

  const rows = (order.items ?? []).flatMap((item) => item.tickets ?? [])
  const { tickets } = groupMembers(order, rows)

  return groupPassEligibility(order, tickets)
}

/**
 * The seat, in the door's words.
 *
 * @param {object} ticket A ticket with `ADMISSION_INCLUDE`.
 * @returns {{section: string|null, row: string|null, label: string}|null} The seat.
 */
function seatOf(ticket) {
  const seat = ticket.eventSeat?.seat

  if (!seat) return null

  return { section: seat.section?.name ?? null, row: seat.row?.label ?? null, label: seat.label }
}

/**
 * Compare two hex digests in constant time.
 *
 * @param {string} left One digest.
 * @param {string|null|undefined} right The other.
 * @returns {boolean} True when equal.
 */
function sameDigest(left, right) {
  if (typeof right !== 'string' || right.length !== left.length) return false

  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

/**
 * Load an order for its buyer, or refuse with the uniform 404.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} actor The request actor.
 * @param {string} reference The order reference.
 * @returns {Promise<object>} The order, with `groupPass`.
 */
async function orderForBuyer(prisma, actor, reference) {
  const order = await prisma.order.findUnique({
    where: { reference },
    select: { ...GROUP_ORDER_SELECT, groupPass: true },
  })

  // The buyer by account and nobody else. Not the address the order was
  // placed with: a guest order has no account, and "somebody signed in at that
  // address" is not who bought it. One answer for every other reader.
  if (!order || !order.userId || order.userId !== actor?.id) throw notFound(NO_SUCH_ORDER)

  return order
}

/**
 * Create the order's pass row and its digests, once.
 *
 * Create, derive from the new id, then store the digests — in one
 * transaction, so a row never exists without them. Two first requests racing
 * collide on the unique `orderId`; the loser reads the winner's row. A clash on
 * a derived digest (sixty bits for the code) is retried with a fresh row id.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} secret The deployment's `AUTH_SECRET`.
 * @param {string} orderId The order.
 * @param {Date} now The instant.
 * @returns {Promise<object>} The `GroupPass` row.
 */
async function createPassRow(prisma, secret, orderId, now) {
  for (let attempt = 1; attempt <= DIGEST_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.groupPass.create({ data: { orderId } })
        const issued = issueGroupPass({ secret, groupPassId: created.id, version: 1 })

        return tx.groupPass.update({
          where: { id: created.id },
          data: {
            credentialHash: issued.credentialHash,
            codeHash: issued.codeHash,
            credentialIssuedAt: now,
          },
        })
      })
    } catch (error) {
      if (databaseErrorCode(error) !== 'P2002') throw error

      const existing = await prisma.groupPass.findUnique({ where: { orderId } })

      if (existing) return existing
    }
  }

  throw conflict('This group pass could not be created. Try again.')
}

/**
 * Hand the buyer their group pass.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {object} options.env The API environment, for `AUTH_SECRET`.
 * @param {object} options.actor The request actor.
 * @param {string} options.reference The order reference.
 * @param {string|null} [options.requestId] For the audit trail.
 * @param {object} [options.log] A request logger.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} A payload satisfying `groupPassResponseSchema`'s `data`.
 * @throws {Error} The uniform 404 for anybody but the buyer; a 409 with a reason when there is no pass to show.
 */
export async function retrieveGroupPass({
  prisma,
  env,
  actor,
  reference,
  requestId = null,
  log,
  now = new Date(),
}) {
  const order = await orderForBuyer(prisma, actor, reference)
  const rows = await orderTicketRows(prisma, order.id)
  const { tickets } = groupMembers(order, rows)
  const eligibility = groupPassEligibility(order, tickets)

  if (!eligibility.available) {
    throw conflict(unavailableSentence(eligibility.unavailableReason), {
      reason: eligibility.unavailableReason,
    })
  }

  const row = order.groupPass ?? (await createPassRow(prisma, env.AUTH_SECRET, order.id, now))
  const issued = issueGroupPass({
    secret: env.AUTH_SECRET,
    groupPassId: row.id,
    version: row.credentialVersion,
  })

  // Derived, then checked against what is stored, as for a ticket's own pass:
  // a string that looks like a pass and opens nothing is worse than a refusal.
  if (
    !groupCredentialMatches(issued.credential, row.credentialHash) ||
    !sameDigest(groupCodeDigest(issued.code), row.codeHash)
  ) {
    log?.error(
      { groupPassId: row.id, credentialVersion: row.credentialVersion },
      'derived group pass does not match the stored digests',
    )

    throw conflict('This group pass cannot be verified.')
  }

  await recordAudit(prisma, {
    action: AUDIT_ACTIONS.TICKET_GROUP_PASS_ISSUED,
    entityType: 'GroupPass',
    entityId: row.id,
    actorId: actor.id,
    // The version and the instant; never the QR content or the code.
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: order.id,
      credentialVersion: row.credentialVersion,
      admits: eligibility.admits,
    },
  })

  const event = order.event ?? null
  const admitting = tickets.filter((ticket) => stillAdmits(ticket, order, event))

  return {
    orderReference: order.reference,
    credential: issued.credential,
    groupCode: issued.code,
    credentialVersion: row.credentialVersion,
    issuedAt: row.credentialIssuedAt ?? null,
    admits: eligibility.admits,
    tickets: admitting.map((ticket) => ({
      id: ticket.id,
      status: ticket.status,
      tier: ticket.orderItem?.ticketType ? { name: ticket.orderItem.ticketType.name } : null,
      seat: seatOf(ticket),
      offered: ticket.status === TICKET_STATES.TRANSFER_PENDING,
    })),
  }
}

/**
 * Replace the buyer's group pass: the old QR and code stop working.
 *
 * A conditional update on the version read, so two replacements at once
 * produce one bump each rather than one lost. No secret comes back.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {object} options.env The API environment, for `AUTH_SECRET`.
 * @param {object} options.actor The request actor.
 * @param {string} options.reference The order reference.
 * @param {string|null} [options.requestId] For the audit trail.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<{credentialVersion: number, rotatedAt: Date}>} The new version.
 * @throws {Error} The uniform 404 for anybody but the buyer; a 409 when there is no pass yet or it moved on.
 */
export async function rotateGroupPass({
  prisma,
  env,
  actor,
  reference,
  requestId = null,
  now = new Date(),
}) {
  const order = await orderForBuyer(prisma, actor, reference)

  if (!order.groupPass) {
    throw conflict('This order has no group pass to replace. Open it first.', {
      reason: 'NO_GROUP_PASS',
    })
  }

  for (let attempt = 1; attempt <= DIGEST_ATTEMPTS; attempt += 1) {
    const current = await prisma.groupPass.findUnique({ where: { id: order.groupPass.id } })
    const fromVersion = current.credentialVersion
    // One version on, or further on a retry: a clash on the derived code is
    // retried at a version whose derivation differs.
    const toVersion = fromVersion + attempt
    const issued = issueGroupPass({
      secret: env.AUTH_SECRET,
      groupPassId: current.id,
      version: toVersion,
    })

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const { count } = await tx.groupPass.updateMany({
          where: { id: current.id, credentialVersion: fromVersion },
          data: {
            credentialVersion: toVersion,
            credentialHash: issued.credentialHash,
            codeHash: issued.codeHash,
            credentialIssuedAt: now,
            rotatedAt: now,
          },
        })

        if (count === 0) return false

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.TICKET_GROUP_PASS_ROTATED,
          entityType: 'GroupPass',
          entityId: current.id,
          actorId: actor.id,
          // The versions; never the old or new QR content or codes.
          metadata: { requestId, at: now.toISOString(), orderId: order.id, fromVersion, toVersion },
        })

        return true
      })

      if (!updated) {
        throw conflict('This group pass was replaced at the same moment. Open it again.', {
          reason: 'GROUP_PASS_CHANGED',
        })
      }

      return { credentialVersion: toVersion, rotatedAt: now }
    } catch (error) {
      // A clash on the newly derived code (sixty bits) is not this buyer's
      // problem: the version moves on and the next derivation differs.
      if (databaseErrorCode(error) !== 'P2002') throw error
    }
  }

  throw conflict('This group pass could not be replaced. Try again.')
}

/**
 * What a buyer is told when their order has no group pass.
 *
 * @param {string} reason One of `GROUP_PASS_UNAVAILABLE_REASONS`.
 * @returns {string} The sentence.
 */
function unavailableSentence(reason) {
  switch (reason) {
    case 'ORDER_NOT_PAID':
      return 'This order is not paid, so it has no group pass.'
    case 'EVENT_CANCELLED':
      return 'This event was cancelled, so nobody is admitted to it.'
    case 'TOO_MANY_TICKETS':
      return `A group pass covers at most ${GROUP_PASS_MAX_TICKETS} tickets. Use each ticket's own pass.`
    default:
      return `A group pass needs at least ${GROUP_PASS_MIN_TICKETS} tickets on this order that still admit.`
  }
}
