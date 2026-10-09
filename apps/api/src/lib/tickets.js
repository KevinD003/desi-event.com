/**
 * The ticket's life: issued, handed on, withdrawn, admitted.
 *
 * A ticket is the one object in this application that a stranger presents at a
 * door and expects to be believed. Everything here is written so that being
 * believed is decided by the database rather than by whichever scanner asked
 * first.
 *
 * ## Check-in happens once — once a night for a ticket good for every night
 *
 * Not "usually once". The `CheckIn` row is unique on the ticket and the night,
 * so two scanners racing produce one row and one of them is told the ticket is
 * already in. A ticket for one night moves to CHECKED_IN under a conditional
 * `UPDATE` in the same transaction; a ticket good for every night (a tier with
 * no night of its own, on an event of more than one) stays VALID and gains one
 * row per night. A trigger — `desi_check_in_ticket_admissible` — locks the
 * ticket and refuses a row for a ticket that is refunded, revoked or
 * transferred away, on a night that is not its own, or a second row for a
 * ticket that admits once, whatever the application believed.
 *
 * That is three layers for one property, and it is not redundancy for its own
 * sake: the unique index is what makes the race safe, the conditional update is
 * what makes the answer correct, and the trigger is what makes it true for code
 * that has not been written yet.
 *
 * A ticket that has been let in on any night is not handed on: a successor
 * would start with no admissions and could be let in again on a night this one
 * already was. For a ticket that admits once CHECKED_IN says so; for one good
 * for every night the offer and the acceptance check its admissions, and
 * `desi_ticket_status_transition` refuses the move whatever the caller checked.
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
 * ## A reserved seat goes with its ticket
 *
 * `Ticket.eventSeatId` is unique among *live* tickets only (VALID,
 * TRANSFER_PENDING, CHECKED_IN — the partial index
 * `Ticket_eventSeatId_live_key`, ADR 0006). The predecessor leaves that set
 * (to TRANSFERRED) before the successor, which copies the seat, enters it, all
 * in one transaction; the old row keeps its pointer as history. The order line
 * is locked `FOR UPDATE` first, the same lock a refund takes before it reads
 * the line's tickets, so an acceptance and a refund of the same line take
 * turns: a refund can never read the predecessor, return the money, and leave
 * a live successor behind.
 *
 * ## How the code reaches the recipient
 *
 * The token is minted by the route and handed to `../lib/delivery.js`: with no
 * delivery provider it is returned to the sender once, `no-store`, to pass on
 * themselves; with one, the provider gets it. Either way the database keeps
 * only its digest, and the acceptor must be signed in at the offered address.
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

import { RECORDED_CHECK_IN_METHODS } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import {
  UNPAID_CANCELLED_SENTENCE,
  conflict,
  forbidden,
  httpError,
  notFound,
  unprocessable,
} from './errors.js'
import { issueTicketCredential } from './ticket-credentials.js'

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
 * Why a ticket cannot be admitted, as a closed code, or null when it can.
 *
 * Pure, so the rule is readable without a database, and shared, so the door,
 * the wallet and the holder's pass cannot disagree about it: all three read
 * this function.
 *
 * ## The event, since Phase 4
 *
 * Before the admission work this looked only at the ticket and its order, and a
 * ticket for a **cancelled event** admitted: cancelling an event writes
 * `cancelledAt` and raises refunds, and never touches a ticket row, so every
 * ticket on it stayed VALID. When the event is supplied, a cancelled one now
 * refuses. There is still no admission *window* — nothing in this system has
 * ever defined one, and inventing it here would be a product decision made by
 * a function.
 *
 * `CHECKED_IN` is not a refusal: a second scan is a duplicate, answered with the
 * original admission rather than an error.
 *
 * ## A deleted event and a cancelled night (SPEC2-XI X-S)
 *
 * A deleted event admits nobody (`EVENT_DELETED`), and neither does a
 * cancelled night (`SESSION_CANCELLED`): the night the ticket is for, or the
 * night the door named, when it was given. Their tickets are withdrawn when
 * the event is deleted or the night cancelled, so a withdrawn ticket names the
 * reason it was withdrawn rather than a bare `CANCELLED`.
 *
 * @param {object} ticket The ticket.
 * @param {object|null} order Its order.
 * @param {object|null} [event] Its event, with `status` and `cancelledAt`.
 * @param {object|null} [session] The night in question, with `status`.
 * @returns {string|null} One of `ADMISSION_REFUSAL_REASONS`, or null.
 */
export function admissionRefusalCode(ticket, order, event = null, session = null) {
  if (!ADMISSIBLE_STATES.includes(ticket.status)) {
    if (ticket.status === TICKET_STATES.CHECKED_IN) return null

    if (ticket.status === TICKET_STATES.CANCELLED) {
      if (event?.status === 'DELETED') return 'EVENT_DELETED'
      if (
        session?.status === 'CANCELLED' ||
        String(ticket.revokedReason ?? '').startsWith(SESSION_CANCELLED_PREFIX)
      ) {
        return 'SESSION_CANCELLED'
      }
    }

    const codes = {
      [TICKET_STATES.REFUNDED]: 'REFUNDED',
      [TICKET_STATES.REVOKED]: 'REVOKED',
      [TICKET_STATES.TRANSFERRED]: 'TRANSFERRED',
      [TICKET_STATES.CANCELLED]: 'CANCELLED',
      [TICKET_STATES.SUPERSEDED]: 'SUPERSEDED',
      [TICKET_STATES.VOID]: 'VOID',
    }

    return codes[ticket.status] ?? 'NOT_ADMISSIBLE'
  }

  if (order && order.status !== 'PAID') return 'ORDER_NOT_PAID'

  if (event?.status === 'DELETED') return 'EVENT_DELETED'

  if (event && (event.status === 'CANCELLED' || event.cancelledAt)) return 'EVENT_CANCELLED'

  if (session?.status === 'CANCELLED') return 'SESSION_CANCELLED'

  return null
}

/**
 * The sentence a person reads for each refusal code.
 *
 * The wallet and the pass route show these; the door returns the code and lets
 * the scanner screen choose its own words.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ADMISSION_REFUSAL_SENTENCES = Object.freeze({
  REFUNDED: 'This ticket was refunded.',
  REVOKED: 'This ticket was withdrawn by the organiser.',
  TRANSFERRED: 'This ticket was handed to somebody else.',
  CANCELLED: 'This event was cancelled.',
  SUPERSEDED: 'This pass was replaced. Ask for the current one.',
  VOID: 'This ticket is void.',
  NOT_ADMISSIBLE: 'This ticket cannot be admitted.',
  ORDER_NOT_PAID: 'The order for this ticket is not paid.',
  EVENT_CANCELLED: 'This event was cancelled.',
  EVENT_DELETED: 'This event was taken off Desi-Event.',
  SESSION_CANCELLED: 'This night was cancelled.',
  WRONG_EVENT: 'This ticket is for a different event.',
  WRONG_NIGHT: 'This ticket is for a different night.',
  NIGHT_REQUIRED: 'This event has more than one night. Say which night the door is admitting to.',
  PREVIEW_EXPIRED: 'That check took too long. Look the ticket up again.',
  PREVIEW_INVALID: 'That check could not be confirmed. Look the ticket up again.',
  PREVIEW_MISMATCH: 'The pass presented is not the one that was checked. Look it up again.',
  GROUP_CHANGED: 'Some tickets in this group changed after it was looked up.',
  // A ticket booked to pay at the venue and cancelled because it was not paid
  // for (SPEC3-XI XU12). Which REVOKED ticket answers it is Stage B1-V's
  // `admissionRefusalCode`; the sentence belongs to the vocabulary.
  UNPAID_CANCELLED: UNPAID_CANCELLED_SENTENCE,
})

/**
 * Why a ticket cannot be admitted, as a sentence, or null when it can.
 *
 * @param {object} ticket The ticket.
 * @param {object|null} order Its order.
 * @param {object|null} [event] Its event, with `status` and `cancelledAt`.
 * @returns {string|null} A sentence for the person holding the ticket or the scanner, or null.
 */
export function admissionRefusal(ticket, order, event = null, session = null) {
  const code = admissionRefusalCode(ticket, order, event, session)

  return code === null ? null : ADMISSION_REFUSAL_SENTENCES[code]
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
 * Admit somebody, once — or once tonight, for a ticket good for every night.
 *
 * The `CheckIn` row is what makes "once" true: its unique index on the ticket
 * and the night means two scanners racing produce one row, and the loser
 * learns from the violation rather than from a status it read a moment ago.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.ticket The ticket, in an admissible state.
 * @param {string|null} [params.eventSessionId] Which night: the ticket's own, or for a ticket good for every night the night it is let in on.
 * @param {boolean} [params.everyNight] A ticket good for every night: record tonight's admission and leave the ticket VALID for the others.
 * @param {string|null} [params.scannedByUserId] Who scanned it.
 * @param {string|null} [params.deviceId] A `Device` row this system issued, or null.
 * @param {string|null} [params.scannerId] What the scanner calls itself. Audit only.
 * @param {string} params.method `QR_SCAN` or `MANUAL_CODE`: what was presented, never a default.
 * @param {string|null} [params.gate] The door.
 * @param {string|null} [params.authority] `ORGANIZATION_ROLE`, `EVENT_SCOPE` or `PLATFORM_ROLE`.
 * @param {string|null} [params.role] The role that authority came with: an organisation role, or `SUPER_ADMIN`.
 * @param {string|null} [params.organizationId] The organisation whose event it is.
 * @param {string|null} [params.groupPassId] The order's group pass, when admitted through it.
 * @param {Date} params.now The instant.
 * @returns {Promise<{admitted: boolean, checkIn: object|null}>} What happened.
 * @throws {TypeError} When `method` is missing or not one the door records.
 */
export async function admit(tx, params) {
  const {
    ticket,
    eventSessionId = null,
    everyNight = false,
    scannedByUserId = null,
    // `CheckIn.deviceId` is a foreign key to a `Device` this system issued. A
    // string a scanner sends about itself is not one, and putting it here turns
    // a scan from an unrecognised device into a foreign-key violation — a 500
    // at a door, for a field nobody needed. What the scanner calls itself goes
    // in the audit metadata below, labelled as self-reported, which is what it
    // is.
    deviceId = null,
    scannerId = null,
    method,
    gate = null,
    // Where the scanner's authority came from — an organisation-wide role, an
    // event scope, or the platform super administrator's own. Recorded so a
    // reviewer can tell them apart afterwards.
    authority = null,
    // And the role it came with, and whose event it is: for a platform
    // admission, `SUPER_ADMIN` at another organisation's door, which the
    // admission's own record should say without a reader having to join it to
    // the event's.
    role = null,
    organizationId = null,
    // Set when the ticket was admitted through its order's group pass. The
    // trigger `desi_check_in_group_pass_matches` refuses a value naming a pass
    // for another order, or a ticket its buyer no longer holds.
    groupPassId = null,
    now,
  } = params

  // No default, and nothing unrecognised. The method is a claim about what was
  // presented — the secure pass credential, or the printed reference — and a
  // caller that forgot to say would otherwise record QR_SCAN, from this
  // function or from the column's own default, for a code somebody typed.
  // `ASSISTED` is refused too: nothing can tell it apart from a typed code.
  if (!RECORDED_CHECK_IN_METHODS.includes(method)) {
    throw new TypeError(
      `An admission needs the method that was presented, ${RECORDED_CHECK_IN_METHODS.join(' or ')}; received ${method}.`,
    )
  }

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
      groupPassId,
    },
  })

  if (everyNight && !eventSessionId) {
    throw new TypeError('An admission of a ticket good for every night names the night.')
  }

  // A ticket good for every night stays as it is: tonight's row is the record,
  // and the ticket still admits on the other nights. The row lock the caller
  // holds, and the one the trigger takes, keep its status from changing under
  // this admission until it commits.
  const moved = everyNight
    ? true
    : await transition(tx, {
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
      reason: 'NOT_ADMISSIBLE',
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
      authority,
      role,
      organizationId,
      groupPassId,
      everyNight,
      previousStatus: ticket.status,
    },
  })

  return { admitted: true, checkIn }
}

/**
 * Whether a ticket has been let in on any night, read under its row lock.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string} ticketId The ticket.
 * @returns {Promise<boolean>} True when it has an admission.
 */
async function admittedAlready(tx, ticketId) {
  await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`

  return (await tx.checkIn.count({ where: { ticketId } })) > 0
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
 * @param {'MANUAL'|'EMAIL'|null} [params.delivery] How the code reaches the recipient, for the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{transfer: object|null, started: boolean}>} What was written.
 * @throws {Error} 422 when the ticket is being sent to whoever already holds it.
 */
export async function startTransfer(tx, params) {
  const {
    ticket,
    toEmail,
    fromUserId,
    tokenHash,
    expiresAt,
    requestId = null,
    delivery = null,
    now,
  } = params

  // A reserved seat is offered like any other ticket: the seat goes with it at
  // acceptance (see the module doc and ADR 0006).
  const holder = fromUserId ? await tx.user.findUnique({ where: { id: fromUserId } }) : null

  if (holder && holder.email.toLowerCase() === toEmail) {
    // No address in the refusal: the sender typed it, and an error body is
    // kept by more things than the screen that shows it.
    throw unprocessable('That ticket is already theirs.')
  }

  // A ticket good for every night stays VALID after a night's admission, so
  // its status does not say it was used. Its admissions do, read under its row
  // lock so an admission cannot slip in between the check and the offer.
  if (
    canTransition(ticket.status, TICKET_STATES.TRANSFER_PENDING) &&
    (await admittedAlready(tx, ticket.id))
  ) {
    throw conflict(
      'This ticket has already let somebody in, so it cannot be handed on. The nights left are for whoever went in.',
      { reason: 'ALREADY_ADMITTED' },
    )
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
      // Not the address. The transfer row holds it, and a privacy redaction
      // rewrites it there, whereas an audit row is immutable and would keep it
      // after the person asked for it to go. The transfer id is the join. Never
      // the token either: that is a bearer secret, and an audit row is read by
      // more people than a database row.
      expiresAt: expiresAt.toISOString(),
      // How the code went out, never the code: MANUAL means the sender was
      // shown it once to pass on themselves.
      delivery,
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

  // The order line first, before anything is read or written. A refund
  // settling this line takes the same lock before it reads the line's live
  // tickets, so the two take turns: either the refund goes first and this
  // acceptance finds the ticket REFUNDED (TICKET_CHANGED below), or this goes
  // first and the refund finds — and refunds — the successor. Without it a
  // refund could read the predecessor, return the money, and leave the
  // successor admitting (ADR 0005's "quiet double admission"; ADR 0006).
  await tx.$queryRaw`SELECT "id" FROM "OrderItem" WHERE "id" = ${ticket.orderItemId} FOR UPDATE`

  // Then the ticket, which every admission locks before it writes. A ticket
  // good for every night that was let in on a night while the offer stood is
  // still TRANSFER_PENDING, so only its admissions say it was used: handing it
  // on would let the recipient in again on that night. Refused like any other
  // change to the ticket since it was offered, and nothing is written. (A
  // ticket read as CHECKED_IN is refused by the transition table below.)
  if (
    canTransition(ticket.status, TICKET_STATES.TRANSFERRED) &&
    (await admittedAlready(tx, ticket.id))
  ) {
    throw conflict(
      'That ticket changed while the transfer was being accepted. Nothing was handed on.',
      { reason: 'TICKET_CHANGED', ticketId: ticket.id },
    )
  }

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

  // Thrown, not returned. The invitation was marked ACCEPTED two statements
  // ago; returning would commit that with no successor ticket behind it — an
  // accepted transfer that handed nobody anything, and a ticket still sitting
  // with the sender. That happened when the ticket was read before this
  // transaction and was admitted, revoked or refunded in between. Throwing
  // rolls the whole acceptance back.
  if (!moved) {
    throw conflict(
      'That ticket changed while the transfer was being accepted. Nothing was handed on.',
      {
        reason: 'TICKET_CHANGED',
        ticketId: ticket.id,
      },
    )
  }

  // The name the door will match a face to: the recipient's own, read from
  // their account here rather than taken from `recipient`. The route passes the
  // request actor, which carries an id, a role and an address but no name, and
  // reading `recipient.displayName` left every ticket ever handed on nameless —
  // including a seat whose buyer had typed the guest's name at checkout. The
  // buyer's guest name is not carried over: it names somebody else.
  const account = await tx.user.findUnique({
    where: { id: recipient.id },
    select: { displayName: true },
  })

  const issued = await tx.ticket.create({
    data: {
      orderItemId: ticket.orderItemId,
      code: generateTicketCode(),
      attendeeName: account?.displayName ?? null,
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
      // A reserved seat moves with the ticket; the audit names which one, so a
      // seat's history reads from the log as well as from the rows.
      eventSeatId: ticket.eventSeatId ?? null,
      seatCarried: Boolean(ticket.eventSeatId),
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
      // Not the address, for the reason given where the transfer starts.
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
      // No printed code: it admits at the door by hand, and an audit row is
      // read by operators and exports. The row names the ticket by its id.
    },
  })

  return true
}

/** The `revokedReason` prefix of a ticket withdrawn because its event was deleted. */
export const EVENT_DELETED_PREFIX = 'event-deleted:'

/** The `revokedReason` prefix of a ticket withdrawn because its night was cancelled. */
export const SESSION_CANCELLED_PREFIX = 'session-cancelled:'

/**
 * Withdraw tickets because their event was deleted or their night cancelled.
 *
 * VALID and TRANSFER_PENDING tickets become CANCELLED in the caller's
 * transaction: the pass dies with them (`credentialHash` cleared, the version
 * bumped), and an offer outstanding on one is withdrawn. The reason names the
 * event or the night (`event-deleted:<eventId>`, `session-cancelled:<sessionId>`),
 * which is how the refund that later settles their order finds them
 * (`revokeAndReturn`) and moves them to REFUNDED. A ticket already admitted,
 * refunded or handed on is left as it is.
 *
 * Conditional updates, so a ticket scanned or refunded a moment earlier is not
 * overwritten; the count is what this call withdrew.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {string[]} params.ticketIds The tickets to withdraw.
 * @param {string} params.reason `event-deleted:<id>` or `session-cancelled:<id>`.
 * @param {Date} params.now The instant.
 * @returns {Promise<number>} How many were withdrawn.
 */
export async function withdrawTickets(tx, { ticketIds, reason, now }) {
  const ids = [...new Set(ticketIds ?? [])]

  if (ids.length === 0) return 0

  const withdrawable = [TICKET_STATES.VALID, TICKET_STATES.TRANSFER_PENDING]
  const pending = await tx.ticket.findMany({
    where: { id: { in: ids }, status: TICKET_STATES.TRANSFER_PENDING },
    select: { id: true },
  })

  const { count } = await tx.ticket.updateMany({
    where: { id: { in: ids }, status: { in: withdrawable } },
    data: {
      status: TICKET_STATES.CANCELLED,
      revokedAt: now,
      revokedReason: reason,
      credentialHash: null,
      credentialVersion: { increment: 1 },
    },
  })

  if (pending.length > 0) {
    await tx.ticketTransfer.updateMany({
      where: { ticketId: { in: pending.map((ticket) => ticket.id) }, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: now },
    })
  }

  return count
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
