/**
 * The ticket's life: issued, handed on, withdrawn, admitted.
 *
 * A ticket is the one object in this application that a stranger presents at a
 * door and expects to be believed. Everything here is written so that being
 * believed is decided by the database rather than by whichever scanner asked
 * first.
 *
 * ## Check-in happens once
 *
 * Not "usually once". The `CheckIn` row has a unique index on `ticketId`, so two
 * scanners racing produce one row and one of them is told the ticket is already
 * in. The ticket's own status moves under a conditional `UPDATE` in the same
 * transaction, and a trigger — `desi_check_in_ticket_admissible` — refuses a
 * row for a ticket that is refunded, revoked or transferred away, whatever the
 * application believed.
 *
 * That is three layers for one property, and it is not redundancy for its own
 * sake: the unique index is what makes the race safe, the conditional update is
 * what makes the answer correct, and the trigger is what makes it true for code
 * that has not been written yet.
 *
 * ## A transfer is an invitation, not a handover
 *
 * Starting one does not move the ticket. `TRANSFER_PENDING` means somebody has
 * been asked; the current holder can still walk in, and that is deliberate — an
 * invitation nobody accepted must not leave a paying attendee at the door. What
 * it does stop is a second transfer starting.
 *
 * On acceptance the old ticket becomes `TRANSFERRED` and its credential dies:
 * the new ticket is a new row with a new credential at version one, and the old
 * row's `credentialHash` is cleared so the old pass matches nothing. The
 * recipient's pass is derived, never stored — see `./ticket-credentials.js`.
 *
 * ## What is never stored
 *
 * The credential itself. The database holds a SHA-256 of it and nothing else,
 * so a database that leaks does not leak passes. Nothing here logs one, and
 * nothing puts one in an audit row.
 *
 * @module @desi-event/api/lib/tickets
 */

import { createHash, randomBytes } from 'node:crypto'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { conflict, forbidden, httpError, notFound, unprocessable } from './errors.js'
import { credentialDigest, issueTicketCredential } from './ticket-credentials.js'

/**
 * Every state a ticket can be in that this module drives.
 *
 * `ACTIVE` in the brief is `VALID` here: one state, one spelling, chosen when
 * Phase 1 issued the first ticket and kept so that a reader never has to ask
 * which of two names is authoritative.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TICKET_STATES = Object.freeze({
  VALID: 'VALID',
  TRANSFER_PENDING: 'TRANSFER_PENDING',
  TRANSFERRED: 'TRANSFERRED',
  REVOKED: 'REVOKED',
  REFUNDED: 'REFUNDED',
  CHECKED_IN: 'CHECKED_IN',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED',
  VOID: 'VOID',
})

/**
 * What each state may become.
 *
 * `CHECKED_IN` is terminal on purpose. A ticket that went through the door has
 * been used, and every later claim on it — a refund, a transfer, a revocation —
 * is a decision about money or about the audit trail rather than about
 * admission. Marking an admitted ticket refunded would contradict the person
 * who scanned it.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const TICKET_TRANSITIONS = Object.freeze({
  VALID: Object.freeze([
    TICKET_STATES.TRANSFER_PENDING,
    TICKET_STATES.CHECKED_IN,
    TICKET_STATES.REVOKED,
    TICKET_STATES.REFUNDED,
    TICKET_STATES.CANCELLED,
    TICKET_STATES.SUPERSEDED,
  ]),
  // An invitation is outstanding and the holder can still walk in.
  TRANSFER_PENDING: Object.freeze([
    TICKET_STATES.VALID,
    TICKET_STATES.TRANSFERRED,
    TICKET_STATES.CHECKED_IN,
    TICKET_STATES.REVOKED,
    TICKET_STATES.REFUNDED,
    TICKET_STATES.CANCELLED,
  ]),
  TRANSFERRED: Object.freeze([]),
  CHECKED_IN: Object.freeze([]),
  REVOKED: Object.freeze([]),
  REFUNDED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  SUPERSEDED: Object.freeze([]),
  VOID: Object.freeze([]),
})

/** The states that open a door. */
export const ADMISSIBLE_STATES = Object.freeze([
  TICKET_STATES.VALID,
  TICKET_STATES.TRANSFER_PENDING,
])

/** How long a transfer invitation stands before it lapses. */
export const TRANSFER_TTL_HOURS = 72

/**
 * Whether one ticket state may become another.
 *
 * @param {string} from The current state.
 * @param {string} to The proposed state.
 * @returns {boolean} True when the transition is in the table.
 */
export function canTransition(from, to) {
  return (TICKET_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Why a ticket cannot be admitted, or null when it can.
 *
 * Pure, so the rule is readable without a database and so the door's answer and
 * the organiser's screen cannot disagree about it.
 *
 * @param {object} ticket The ticket.
 * @param {object|null} order Its order.
 * @returns {string|null} A sentence for the person holding the scanner, or null.
 */
export function admissionRefusal(ticket, order) {
  if (!ADMISSIBLE_STATES.includes(ticket.status)) {
    if (ticket.status === TICKET_STATES.CHECKED_IN) return null

    const reasons = {
      [TICKET_STATES.REFUNDED]: 'This ticket was refunded.',
      [TICKET_STATES.REVOKED]: 'This ticket was withdrawn by the organiser.',
      [TICKET_STATES.TRANSFERRED]: 'This ticket was handed to somebody else.',
      [TICKET_STATES.CANCELLED]: 'This event was cancelled.',
      [TICKET_STATES.SUPERSEDED]: 'This pass was replaced. Ask for the current one.',
      [TICKET_STATES.VOID]: 'This ticket is void.',
    }

    return reasons[ticket.status] ?? 'This ticket cannot be admitted.'
  }

  if (order && order.status !== 'PAID') return 'The order for this ticket is not paid.'

  return null
}

/**
 * Whether a transfer invitation has lapsed.
 *
 * @param {object} transfer The transfer.
 * @param {Date} now The instant.
 * @returns {boolean} True when it is past its expiry.
 */
export function transferHasLapsed(transfer, now) {
  return new Date(transfer.expiresAt).getTime() <= now.getTime()
}

/**
 * A single-use transfer token, and the digest to store.
 *
 * The same discipline as every other bearer secret here: the plaintext goes in
 * the invitation link and is never written down, the digest is what the
 * database holds, and a leaked database cannot accept a transfer.
 *
 * @returns {{token: string, tokenHash: string}} Plaintext and digest.
 */
export function mintTransferToken() {
  const token = randomBytes(32).toString('base64url')

  return { token, tokenHash: createHash('sha256').update(token).digest('hex') }
}

/**
 * The digest of a presented transfer token.
 *
 * @param {string} token What the recipient sent.
 * @returns {string} A 64-character hex digest.
 */
export function transferTokenDigest(token) {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Move a ticket to a new state, conditionally.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.ticket The ticket as it was read.
 * @param {string} params.to The new state.
 * @param {object} [params.data] Extra columns.
 * @returns {Promise<boolean>} Whether this call performed the transition.
 * @throws {Error} 409 when the transition is not in the table.
 */
export async function transition(tx, { ticket, to, data = {} }) {
  if (!canTransition(ticket.status, to)) {
    throw conflict(
      `A ${ticket.status.toLowerCase().replace(/_/g, ' ')} ticket cannot become ${to.toLowerCase().replace(/_/g, ' ')}.`,
      { from: ticket.status, to },
    )
  }

  const { count } = await tx.ticket.updateMany({
    where: { id: ticket.id, status: ticket.status },
    data: { status: to, ...data },
  })

  return count === 1
}

/**
 * Admit somebody, once.
 *
 * The `CheckIn` row is what makes "once" true: its unique index on `ticketId`
 * means two scanners racing produce one row, and the loser learns from the
 * violation rather than from a status it read a moment ago.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.ticket The ticket, in an admissible state.
 * @param {string|null} [params.eventSessionId] Which performance.
 * @param {string|null} [params.scannedByUserId] Who scanned it.
 * @param {string|null} [params.deviceId] A `Device` row this system issued, or null.
 * @param {string|null} [params.scannerId] What the scanner calls itself. Audit only.
 * @param {string} [params.method] A `CheckInMethod`.
 * @param {string|null} [params.gate] The door.
 * @param {Date} params.now The instant.
 * @returns {Promise<{admitted: boolean, checkIn: object|null}>} What happened.
 */
export async function admit(tx, params) {
  const {
    ticket,
    eventSessionId = null,
    scannedByUserId = null,
    // `CheckIn.deviceId` is a foreign key to a `Device` this system issued. A
    // string a scanner sends about itself is not one, and putting it here turns
    // a scan from an unrecognised device into a foreign-key violation — a 500
    // at a door, for a field nobody needed. What the scanner calls itself goes
    // in the audit metadata below, labelled as self-reported, which is what it
    // is.
    deviceId = null,
    scannerId = null,
    method = 'QR_SCAN',
    gate = null,
    now,
  } = params

  // The attendance row first, while the ticket is still admissible.
  //
  // `desi_check_in_ticket_admissible` reads the ticket's status at the moment
  // the row is inserted and refuses anything that is not VALID or
  // TRANSFER_PENDING. Moving the ticket to CHECKED_IN first would make the
  // trigger refuse this very check-in — the ticket would already be in a state
  // that does not admit — so the order is: write the attendance, then record
  // it on the ticket. Both happen in one transaction, so there is no instant
  // where one exists without the other.
  //
  // This is also what makes the race safe. `CheckIn.ticketId` is unique, so two
  // scanners inserting at once produce one row and the loser's whole
  // transaction rolls back, ticket status included.
  const checkIn = await tx.checkIn.create({
    data: {
      ticketId: ticket.id,
      eventSessionId,
      scannedByUserId,
      deviceId,
      method,
      gate,
      scannedAt: now,
    },
  })

  const moved = await transition(tx, {
    ticket,
    to: TICKET_STATES.CHECKED_IN,
    data: { checkedInAt: now },
  })

  // The attendance row was accepted and the ticket moved on underneath it —
  // somebody revoked or refunded it between the insert above and this update.
  //
  // Throwing rather than returning, and that distinction is the whole point:
  // returning would commit the transaction, leaving an attendance row against a
  // ticket that is now REVOKED. The trigger cannot catch that, because it fires
  // on insert and the insert was legitimate at the time. Rolling back is what
  // keeps the two facts from disagreeing.
  if (!moved) {
    throw conflict('That ticket changed while it was being scanned. Scan it again.', {
      ticketId: ticket.id,
      readStatus: ticket.status,
    })
  }

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TICKET_CHECKED_IN,
    entityType: 'Ticket',
    entityId: ticket.id,
    actorId: scannedByUserId,
    metadata: {
      at: now.toISOString(),
      checkInId: checkIn.id,
      eventSessionId,
      deviceId,
      // Self-reported, and named so. A scanner is a device in somebody's hand
      // and what it says about itself is a hint rather than an identity.
      scannerId,
      method,
      gate,
      previousStatus: ticket.status,
    },
  })

  return { admitted: true, checkIn }
}

/**
 * Invite somebody to take a ticket.
 *
 * The ticket does not move. `TRANSFER_PENDING` says an invitation is
 * outstanding, and the current holder can still be admitted on it — an
 * invitation nobody accepted must not leave a paying attendee at the door.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.ticket The ticket, VALID.
 * @param {string} params.toEmail Who is being asked. Lower-cased by the caller's schema.
 * @param {string|null} params.fromUserId The current holder.
 * @param {string} params.tokenHash From {@link mintTransferToken}.
 * @param {Date} params.expiresAt When the invitation lapses.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{transfer: object|null, started: boolean}>} What was written.
 * @throws {Error} 422 when the ticket is being sent to whoever already holds it.
 */
export async function startTransfer(tx, params) {
  const { ticket, toEmail, fromUserId, tokenHash, expiresAt, requestId = null, now } = params

  const holder = fromUserId ? await tx.user.findUnique({ where: { id: fromUserId } }) : null

  if (holder && holder.email.toLowerCase() === toEmail) {
    throw unprocessable('That ticket is already theirs.', { toEmail })
  }

  const moved = await transition(tx, { ticket, to: TICKET_STATES.TRANSFER_PENDING })

  if (!moved) return { transfer: null, started: false }

  const recipient = await tx.user.findUnique({ where: { email: toEmail } })

  const transfer = await tx.ticketTransfer.create({
    data: {
      ticketId: ticket.id,
      fromUserId,
      toEmail,
      toUserId: recipient?.id ?? null,
      tokenHash,
      status: 'PENDING',
      expiresAt,
    },
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TICKET_TRANSFER_STARTED,
    entityType: 'Ticket',
    entityId: ticket.id,
    actorId: fromUserId,
    metadata: {
      requestId,
      at: now.toISOString(),
      transferId: transfer.id,
      // The address, because who a ticket was offered to is the point of the
      // record. Never the token: that is a bearer secret and an audit row is
      // read by more people than a database row.
      toEmail,
      expiresAt: expiresAt.toISOString(),
    },
  })

  return { transfer, started: true }
}

/**
 * Take a ticket that was offered.
 *
 * The old ticket becomes TRANSFERRED and its credential is cleared, so the old
 * pass matches nothing. The new ticket is a separate row with its own
 * credential at version one, pointing back at the old one through
 * `supersedesTicketId` — an unbroken chain from the original purchase.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.transfer The PENDING transfer.
 * @param {object} params.ticket The ticket being handed over.
 * @param {object} params.recipient The accepting user.
 * @param {string} params.credentialSecret The deployment's `AUTH_SECRET`.
 * @param {Function} params.generateTicketCode Makes the new ticket's code.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{accepted: boolean, ticket: object|null, credential: string|null}>} The new ticket and its one-time pass.
 */
export async function acceptTransfer(tx, params) {
  const {
    transfer,
    ticket,
    recipient,
    credentialSecret,
    generateTicketCode,
    requestId = null,
    now,
  } = params

  // Conditional on the transfer still being PENDING. Two people cannot accept
  // one invitation, and the same person clicking twice accepts once.
  const { count } = await tx.ticketTransfer.updateMany({
    where: { id: transfer.id, status: 'PENDING' },
    data: { status: 'ACCEPTED', acceptedAt: now, toUserId: recipient.id },
  })

  if (count === 0) return { accepted: false, ticket: null, credential: null }

  const moved = await transition(tx, {
    ticket,
    to: TICKET_STATES.TRANSFERRED,
    data: {
      // The old pass dies here. Clearing the digest rather than leaving it is
      // what makes an old QR code match nothing at all, rather than matching a
      // ticket that happens to be in the wrong state.
      credentialHash: null,
      credentialVersion: { increment: 1 },
    },
  })

  if (!moved) return { accepted: false, ticket: null, credential: null }

  const issued = await tx.ticket.create({
    data: {
      orderItemId: ticket.orderItemId,
      code: generateTicketCode(),
      attendeeName: recipient.displayName ?? null,
      ownerUserId: recipient.id,
      eventSeatId: ticket.eventSeatId,
      status: TICKET_STATES.VALID,
      supersedesTicketId: ticket.id,
      credentialVersion: 1,
    },
  })

  const { credential, credentialHash } = issueTicketCredential({
    secret: credentialSecret,
    ticketId: issued.id,
    version: 1,
  })

  await tx.ticket.update({
    where: { id: issued.id },
    data: { credentialHash, credentialIssuedAt: now },
  })

  await tx.ticketTransfer.update({
    where: { id: transfer.id },
    data: { resultTicketId: issued.id },
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TICKET_TRANSFER_ACCEPTED,
    entityType: 'Ticket',
    entityId: ticket.id,
    actorId: recipient.id,
    metadata: {
      requestId,
      at: now.toISOString(),
      transferId: transfer.id,
      newTicketId: issued.id,
      fromUserId: transfer.fromUserId,
      // No credential and no token. Neither belongs in a row somebody reads.
      oldCredentialRevoked: true,
    },
  })

  return { accepted: true, ticket: { ...issued, credentialHash }, credential }
}

/**
 * End a transfer without handing the ticket over.
 *
 * One function for declining, cancelling and expiring, because the three differ
 * only in who decided and what it is called. The ticket goes back to VALID in
 * all three: an invitation that did not complete leaves the holder exactly
 * where they were.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.transfer The PENDING transfer.
 * @param {object} params.ticket The ticket.
 * @param {string} params.outcome `DECLINED`, `CANCELLED` or `EXPIRED`.
 * @param {string|null} [params.actorId] Who decided. Null when it lapsed.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<boolean>} Whether this call ended it.
 */
export async function endTransfer(
  tx,
  { transfer, ticket, outcome, actorId = null, requestId = null, now },
) {
  const stamp = {
    DECLINED: { declinedAt: now },
    CANCELLED: { cancelledAt: now },
    EXPIRED: {},
  }[outcome]

  if (!stamp) throw unprocessable('That is not a way a transfer ends.', { outcome })

  const { count } = await tx.ticketTransfer.updateMany({
    where: { id: transfer.id, status: 'PENDING' },
    data: { status: outcome, ...stamp },
  })

  if (count === 0) return false

  // Back to VALID, and only from TRANSFER_PENDING. A ticket that was refunded
  // or checked in while the invitation stood stays where it is: the invitation
  // ending is not a reason to undo either.
  await tx.ticket.updateMany({
    where: { id: ticket.id, status: TICKET_STATES.TRANSFER_PENDING },
    data: { status: TICKET_STATES.VALID },
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TICKET_TRANSFER_ENDED,
    entityType: 'Ticket',
    entityId: ticket.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      transferId: transfer.id,
      outcome,
      toEmail: transfer.toEmail,
      source: actorId ? 'person' : 'system',
    },
  })

  return true
}

/**
 * Withdraw a ticket.
 *
 * Distinct from a refund, which is about money, and from a cancellation, which
 * is about the event. A revocation is an organiser saying this particular
 * ticket no longer admits anybody, and it requires a reason because in six
 * months nothing else will say why somebody was turned away.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.ticket The ticket.
 * @param {string} params.reason Why.
 * @param {string} params.actorId Who.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<boolean>} Whether this call revoked it.
 */
export async function revokeTicket(tx, { ticket, reason, actorId, requestId = null, now }) {
  const moved = await transition(tx, {
    ticket,
    to: TICKET_STATES.REVOKED,
    data: {
      revokedAt: now,
      revokedReason: reason,
      // The pass dies with the ticket, for the same reason it does on a
      // transfer: an old QR code should match nothing rather than match a row
      // in a state somebody has to remember to check.
      credentialHash: null,
      credentialVersion: { increment: 1 },
    },
  })

  if (!moved) return false

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TICKET_REVOKED,
    entityType: 'Ticket',
    entityId: ticket.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      previousStatus: ticket.status,
      reason,
      ticketCode: ticket.code,
    },
  })

  return true
}

/**
 * Find a ticket by the pass a scanner presented, or by its printed code.
 *
 * The digest is looked up rather than every ticket being compared, because a
 * scan happens at a door with a queue behind it. The comparison is still
 * constant-time where it matters: the digest is a lookup key and the credential
 * it came from is never revealed by the answer.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Inputs.
 * @param {string} [params.credential] The pass from a QR code.
 * @param {string} [params.code] The printed reference.
 * @param {object} [params.include] Relations to load.
 * @returns {Promise<object|null>} The ticket, or null.
 */
export async function findTicketForScan(prisma, { credential, code, include }) {
  if (credential) {
    return prisma.ticket.findUnique({
      where: { credentialHash: credentialDigest(credential) },
      ...(include ? { include } : {}),
    })
  }

  if (code) return prisma.ticket.findUnique({ where: { code }, ...(include ? { include } : {}) })

  return null
}

/**
 * Load a transfer with the rows a decision about it needs.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {string} tokenHash The digest of the presented token.
 * @param {Date} now The instant, for the expiry check.
 * @returns {Promise<{transfer: object, ticket: object}>} The rows.
 * @throws {Error} 404 when there is no such invitation; 410 when it has lapsed.
 */
export async function loadTransferByToken(prisma, tokenHash, now) {
  const transfer = await prisma.ticketTransfer.findUnique({ where: { tokenHash } })

  // The same answer for "no such invitation" and "not yours", because
  // distinguishing them would let somebody with a guessed token learn that it
  // named something real.
  if (!transfer) throw notFound('No such ticket invitation.')

  if (transfer.status !== 'PENDING') {
    throw conflict(`That invitation was already ${transfer.status.toLowerCase()}.`, {
      status: transfer.status,
    })
  }

  if (transferHasLapsed(transfer, now)) {
    throw httpError(410, 'TRANSFER_EXPIRED', 'That invitation has expired. Ask for another one.')
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: transfer.ticketId } })

  if (!ticket) throw notFound('No such ticket invitation.')

  return { transfer, ticket }
}

/**
 * Assert that whoever is asking holds this ticket.
 *
 * A ticket bought as a guest has no owner, and nobody may transfer it: there is
 * no account to prove a claim from, and letting anybody who knows the code hand
 * it on would make the code a bearer token.
 *
 * @param {object} actor The authenticated actor.
 * @param {object} ticket The ticket.
 * @returns {void} Nothing; throws when refused.
 */
export function assertHolds(actor, ticket) {
  if (!ticket.ownerUserId) {
    throw forbidden(
      'This ticket was bought without an account, so it cannot be transferred. Sign in with the address it was bought under to claim it first.',
      'TICKET_UNCLAIMED',
    )
  }

  if (ticket.ownerUserId !== actor?.id) throw notFound('No such ticket.')
}
