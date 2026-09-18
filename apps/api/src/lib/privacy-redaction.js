/**
 * The redaction engine: what a request actually does to the data.
 *
 * Erasure in this system is **redaction, not deletion**, and the reason is
 * structural rather than a preference. An `Order` is the counterparty of a
 * `LedgerEntry`, and `desi_ledger_entry_immutable` refuses to change a posted
 * entry; deleting the order would either break the reference or require
 * rewriting the ledger. So the row, its id, its amounts and its state all
 * survive, and the personal fields inside it are replaced with placeholders
 * derived from the row's own id.
 *
 * Two scoping rules govern every category, and both exist because the authority
 * that permits a redaction is **organisation-scoped**:
 *
 * **Organisation-scoped data is redacted.** Orders, tickets, transfers and
 * notifications that belong to this organisation are within the authority of
 * somebody holding `privacy:redact` here.
 *
 * **Account-wide data is redacted only when this organisation is the last one.**
 * `User.email` is not organisation-scoped: one row serves every organisation the
 * person deals with. An organiser who could blank it would be erasing that
 * person's account from organisations they have no authority over — a
 * cross-tenant write dressed up as a privacy control. So account identity is
 * redacted only when no other organisation holds anything about the subject, and
 * otherwise it is reported as out of scope rather than silently skipped. The
 * scope preview says so before the operator confirms, so nobody is told their
 * account was erased when it was not.
 *
 * Security metadata — sessions, login attempts, IP hashes — is deliberately
 * **not** a redaction category. `docs/PHASE3_IMPLEMENTATION_PLAN.md` §5 assigns
 * it to retention ("deletion by retention, not redaction"), and the retention
 * sweeper is Phase 3. What this engine does do is revoke the subject's live
 * sessions, which is a security action rather than a data one.
 *
 * @module @desi-event/api/lib/privacy-redaction
 */

import { REVOCATION_REASONS } from '@desi-event/auth'

import { countExportsContaining, invalidateExportsForSubject } from './export-register.js'
import { PRIVACY_CATEGORIES } from './privacy.js'
import { redactedEmail, redactedName, scrubPayload } from './privacy-placeholders.js'

/**
 * Why a category did nothing.
 *
 * A closed vocabulary, because "nothing to do" and "not allowed to" are
 * different answers and a count of zero cannot tell them apart.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CATEGORY_STATUSES = Object.freeze({
  /** Rows were found and redacted. */
  REDACTED: 'REDACTED',
  /** The organisation holds nothing of this kind about the subject. */
  NOTHING_TO_DO: 'NOTHING_TO_DO',
  /** Already placeholders, from an earlier run of the same request. */
  ALREADY_REDACTED: 'ALREADY_REDACTED',
  /** Out of this organisation's authority. See the module note on scoping. */
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  /** Belongs to a later phase and is not attempted here. */
  DEFERRED: 'DEFERRED',
})

/** Outbox rows whose message has already gone, or will never go. */
const OUTBOX_SETTLED = Object.freeze(['SENT', 'CANCELLED', 'FAILED', 'DEAD_LETTER', 'SUPPRESSED'])

/**
 * The two ways a row can belong to the subject.
 *
 * Every relationship in this module is reached by an account link **or** by the
 * address on the row, because `Order.userId`, `WaitlistEntry.userId` and
 * `NotificationOutbox.userId` are all nullable: a guest checkout, a waitlist
 * joined before registering and a message sent to somebody who had no account
 * all record an address and no link.
 *
 * Shared by the preview and the execution deliberately. They diverged once —
 * the preview counted account links only while the engine matched both — and the
 * result was an operator confirming an irreversible action against a number
 * smaller than what it did. One function means the confirmation screen and the
 * write can no longer disagree.
 *
 * @param {string} subjectUserId The data subject.
 * @param {string|null} subjectEmail Their address, lower-cased, or null.
 * @param {string} field Which column on this model holds the address.
 * @returns {Array<object>} `OR` clauses for a Prisma `where`.
 */
export function subjectMatchers(subjectUserId, subjectEmail, field) {
  return [
    { userId: subjectUserId },
    ...(subjectEmail ? [{ [field]: { equals: subjectEmail, mode: 'insensitive' } }] : []),
  ]
}

/**
 * The subject's address as it stands, lower-cased.
 *
 * Read before anything changes it, because every matcher above needs the value
 * the row had on the way in.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {string} subjectUserId The data subject.
 * @returns {Promise<string|null>} The address, or null when there is no user row.
 */
export async function subjectAddress(tx, subjectUserId) {
  const subject = await tx.user.findUnique({
    where: { id: subjectUserId },
    select: { email: true },
  })

  return subject ? subject.email.toLowerCase() : null
}

/**
 * Does any organisation other than this one hold data about the subject?
 *
 * The test that decides whether account identity is in scope. Four
 * relationships, matching {@link subjectBelongsToOrganization} in `privacy.js`,
 * asked with `NOT` on the organisation rather than by listing organisations —
 * so a new relationship added later fails safe by not being counted, rather than
 * by silently widening what an organiser may erase.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @returns {Promise<boolean>} Whether another organisation holds something.
 */
export async function subjectBelongsElsewhere(tx, { organizationId, subjectUserId }) {
  const membership = await tx.membership.findFirst({
    where: { userId: subjectUserId, organizationId: { not: organizationId } },
    select: { id: true },
  })

  if (membership) return true

  const order = await tx.order.findFirst({
    where: { userId: subjectUserId, event: { organizationId: { not: organizationId } } },
    select: { id: true },
  })

  if (order) return true

  const ticket = await tx.ticket.findFirst({
    where: {
      ownerUserId: subjectUserId,
      orderItem: { order: { event: { organizationId: { not: organizationId } } } },
    },
    select: { id: true },
  })

  if (ticket) return true

  const waitlisted = await tx.waitlistEntry.findFirst({
    where: { userId: subjectUserId, event: { organizationId: { not: organizationId } } },
    select: { id: true },
  })

  return Boolean(waitlisted)
}

/**
 * Replace the subject's account identity, and revoke what it authenticates.
 *
 * `User.email` is `@unique`, so the placeholder has to be collision-free; it is,
 * by being derived from the row's own primary key. `phone` is nullable and is
 * cleared rather than given a placeholder: a synthetic telephone number is a
 * string somebody will eventually dial.
 *
 * Sessions and single-use tokens are revoked in the same transaction. A session
 * minted against an address that no longer exists is an authenticated session
 * belonging to nobody, and leaving it open would be the one way a redaction
 * could make an account *less* safe than it was.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Parameters.
 * @param {string} params.subjectUserId The data subject.
 * @param {Date} params.now The instant.
 * @returns {Promise<{status: string, count: number, sessionsRevoked: number, tokensRevoked: number}>} What happened.
 */
export async function redactAccountIdentity(tx, { subjectUserId, now }) {
  const user = await tx.user.findUnique({
    where: { id: subjectUserId },
    select: { id: true, email: true, displayName: true, phone: true },
  })

  if (!user)
    return {
      status: CATEGORY_STATUSES.NOTHING_TO_DO,
      count: 0,
      sessionsRevoked: 0,
      tokensRevoked: 0,
    }

  const email = redactedEmail('User.email', user.id)
  const displayName = redactedName('User.displayName', user.id)

  if (user.email === email && user.displayName === displayName && user.phone === null) {
    return {
      status: CATEGORY_STATUSES.ALREADY_REDACTED,
      count: 0,
      sessionsRevoked: 0,
      tokensRevoked: 0,
    }
  }

  await tx.user.update({
    where: { id: user.id },
    data: { email, displayName, phone: null },
  })

  const sessions = await tx.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: now, revokedReason: REVOCATION_REASONS.PRIVACY_REDACTION },
  })

  const tokens = await tx.authToken.updateMany({
    where: { userId: user.id, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  })

  return {
    status: CATEGORY_STATUSES.REDACTED,
    count: 1,
    sessionsRevoked: sessions.count,
    tokensRevoked: tokens.count,
  }
}

/**
 * Replace buyer identity on this organisation's orders.
 *
 * Amounts, currency, tax, status and every timestamp are untouched — the
 * `data` object below names exactly two columns, which is the whole guarantee.
 * The ledger never sees this write.
 *
 * Each order gets a placeholder derived from **its own** id rather than the
 * user's, so two orders by the same person do not advertise that they were.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @param {string|null} params.subjectEmail The subject's address before redaction, lower-cased.
 * @returns {Promise<{status: string, count: number}>} What happened.
 */
export async function redactBuyerIdentity(tx, { organizationId, subjectUserId, subjectEmail }) {
  // Two ways to reach the subject's orders, because `Order.userId` is nullable.
  // A guest checkout records no account link at all, so an order somebody placed
  // before they registered — or without registering — is reachable only through
  // the address on it. Matching on both is what stops a redaction from leaving a
  // person's name on the order they bought as a guest.
  const orders = await tx.order.findMany({
    where: {
      event: { organizationId },
      OR: subjectMatchers(subjectUserId, subjectEmail, 'buyerEmail'),
    },
    select: { id: true, buyerEmail: true, buyerName: true },
  })

  if (orders.length === 0) return { status: CATEGORY_STATUSES.NOTHING_TO_DO, count: 0 }

  let count = 0

  for (const order of orders) {
    if (!order.buyerEmail && !order.buyerName) continue

    const buyerEmail = redactedEmail('Order.buyerEmail', order.id)
    const buyerName = redactedName('Order.buyerName', order.id)

    if (order.buyerEmail === buyerEmail && order.buyerName === buyerName) continue

    await tx.order.update({ where: { id: order.id }, data: { buyerEmail, buyerName } })
    count += 1
  }

  return {
    status: count === 0 ? CATEGORY_STATUSES.ALREADY_REDACTED : CATEGORY_STATUSES.REDACTED,
    count,
  }
}

/**
 * Replace the names and addresses attached to this organisation's tickets.
 *
 * Ticket status, code, credential digest, seat and check-in are untouched, so
 * `desi_ticket_status_transition` is never engaged and a ticket that was valid
 * stays valid. The door still admits the bearer; it simply no longer prints a
 * name.
 *
 * Only **settled** transfers are touched. A `PENDING` invitation is matched
 * against the accepting session's address at
 * `apps/api/src/routes/tickets.js:406`, so rewriting `toEmail` mid-flight would
 * strand a ticket somebody paid for — which is why an open invitation refuses
 * the whole request in `privacy-holds.js` rather than being redacted around.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @param {string|null} params.subjectEmail The subject's address before redaction, lower-cased.
 * @returns {Promise<{status: string, count: number}>} What happened.
 */
export async function redactTicketHolderIdentity(
  tx,
  { organizationId, subjectUserId, subjectEmail },
) {
  const withinOrganization = { orderItem: { order: { event: { organizationId } } } }

  const tickets = await tx.ticket.findMany({
    where: { ownerUserId: subjectUserId, attendeeName: { not: null }, ...withinOrganization },
    select: { id: true, attendeeName: true },
  })

  let count = 0

  for (const ticket of tickets) {
    if (!ticket.attendeeName) continue

    const attendeeName = redactedName('Ticket.attendeeName', ticket.id)

    if (ticket.attendeeName === attendeeName) continue

    await tx.ticket.update({ where: { id: ticket.id }, data: { attendeeName } })
    count += 1
  }

  // Transfers reach the subject two ways: they sent one, or one was addressed to
  // them. The address is on the row either way, so both are redacted — but only
  // the ones that have finished.
  const addressed = subjectEmail ? [{ toEmail: subjectEmail }] : []

  const transfers = await tx.ticketTransfer.findMany({
    where: {
      status: { not: 'PENDING' },
      ticket: withinOrganization,
      OR: [{ fromUserId: subjectUserId }, { toUserId: subjectUserId }, ...addressed],
    },
    select: { id: true, toEmail: true },
  })

  for (const transfer of transfers) {
    if (!transfer.toEmail) continue

    const toEmail = redactedEmail('TicketTransfer.toEmail', transfer.id)

    if (transfer.toEmail === toEmail) continue

    await tx.ticketTransfer.update({ where: { id: transfer.id }, data: { toEmail } })
    count += 1
  }

  if (tickets.length === 0 && transfers.length === 0) {
    return { status: CATEGORY_STATUSES.NOTHING_TO_DO, count: 0 }
  }

  return {
    status: count === 0 ? CATEGORY_STATUSES.ALREADY_REDACTED : CATEGORY_STATUSES.REDACTED,
    count,
  }
}

/**
 * Replace the address on a waitlist entry.
 *
 * Easy to miss, and it matters: a waitlist entry is one of the four
 * relationships that put a subject inside an organisation's scope in the first
 * place (`privacy.js`), so somebody can be redactable *because of* a row that
 * holds nothing but their address. `WaitlistEntry.email` is `NOT NULL` and part
 * of `@@unique([eventId, email])`, so the placeholder is derived from the entry's
 * own id rather than the subject's — two entries for one person on two events
 * then get two placeholders and the composite unique index is satisfied by
 * construction.
 *
 * Reached by account link and by address, for the same reason orders are:
 * `WaitlistEntry.userId` is nullable, so somebody who joined a waitlist before
 * registering is reachable only through what they typed.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @param {string|null} params.subjectEmail The subject's address before redaction, lower-cased.
 * @returns {Promise<{status: string, count: number}>} What happened.
 */
export async function redactWaitlistEntries(tx, { organizationId, subjectUserId, subjectEmail }) {
  const entries = await tx.waitlistEntry.findMany({
    where: {
      event: { organizationId },
      OR: subjectMatchers(subjectUserId, subjectEmail, 'email'),
    },
    select: { id: true, email: true },
  })

  if (entries.length === 0) return { status: CATEGORY_STATUSES.NOTHING_TO_DO, count: 0 }

  let count = 0

  for (const entry of entries) {
    if (!entry.email) continue

    const email = redactedEmail('WaitlistEntry.email', entry.id)

    if (entry.email === email) continue

    await tx.waitlistEntry.update({ where: { id: entry.id }, data: { email } })
    count += 1
  }

  return {
    status: count === 0 ? CATEGORY_STATUSES.ALREADY_REDACTED : CATEGORY_STATUSES.REDACTED,
    count,
  }
}

/**
 * Scrub delivery evidence without destroying the evidence.
 *
 * What is kept is what proves a message was sent: the row, its template and
 * version, its `dedupeKey`, its status, its attempt count, its timestamps and
 * its failure category. What goes is the address it went to and the personal
 * keys inside the rendered payload.
 *
 * Only settled rows. The dispatcher renders from the stored payload rather than
 * from source rows (`apps/worker/src/outbox/dispatcher.js:167`), so scrubbing a
 * queued row would not redact anybody — it would send a person a message with
 * holes in it, or fail delivery and retry forever.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @param {string|null} params.subjectEmail The subject's address before redaction, lower-cased.
 * @returns {Promise<{status: string, count: number}>} What happened.
 */
export async function redactNotificationDelivery(
  tx,
  { organizationId, subjectUserId, subjectEmail },
) {
  const rows = await tx.notificationOutbox.findMany({
    where: {
      organizationId,
      status: { in: [...OUTBOX_SETTLED] },
      OR: subjectMatchers(subjectUserId, subjectEmail, 'recipient'),
    },
    select: { id: true, recipient: true, payload: true },
  })

  if (rows.length === 0) return { status: CATEGORY_STATUSES.NOTHING_TO_DO, count: 0 }

  let count = 0

  for (const row of rows) {
    if (!row.recipient) continue

    const recipient = redactedEmail('NotificationOutbox.recipient', row.id)
    const scrubbed = scrubPayload(row.payload)

    if (row.recipient === recipient && scrubbed.removed === 0) continue

    await tx.notificationOutbox.update({
      where: { id: row.id },
      data: { recipient, payload: scrubbed.payload },
    })

    count += 1
  }

  return {
    status: count === 0 ? CATEGORY_STATUSES.ALREADY_REDACTED : CATEGORY_STATUSES.REDACTED,
    count,
  }
}

/**
 * Replace a contact address that happens to be the subject's own.
 *
 * `Organization.contactEmail` and `Event.contactEmail` appear in the approved
 * matrix, and taken literally they would mean an attendee's erasure request
 * blanking the organiser's public contact address. That is not what a subject
 * erasure is for, and it would break the organisation's ability to be contacted
 * about its own events.
 *
 * So the rule is narrower and, read against the matrix's intent, more correct:
 * the address is replaced **only when it is the subject's own address**, which is
 * exactly the case where it is personal data about them. Compared case-
 * insensitively, because addresses are stored as entered.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string|null} params.subjectEmail The subject's address before redaction, lower-cased.
 * @returns {Promise<{status: string, count: number}>} What happened.
 */
export async function redactContactAddresses(tx, { organizationId, subjectEmail }) {
  if (!subjectEmail) return { status: CATEGORY_STATUSES.NOTHING_TO_DO, count: 0 }

  let count = 0

  const organization = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, contactEmail: true },
  })

  // Null-guarded rather than trusting the query's filter. A `where` clause is a
  // request, not a contract: the column is nullable on `Event`, and a reader
  // that assumed otherwise would turn a missing address into a 500 on the one
  // route that must never fail halfway.
  if (organization?.contactEmail && organization.contactEmail.toLowerCase() === subjectEmail) {
    await tx.organization.update({
      where: { id: organization.id },
      data: { contactEmail: redactedEmail('Organization.contactEmail', organization.id) },
    })

    count += 1
  }

  const events = await tx.event.findMany({
    where: { organizationId, contactEmail: { not: null } },
    select: { id: true, contactEmail: true },
  })

  for (const event of events) {
    if (!event.contactEmail) continue
    if (event.contactEmail.toLowerCase() !== subjectEmail) continue

    await tx.event.update({
      where: { id: event.id },
      data: { contactEmail: redactedEmail('Event.contactEmail', event.id) },
    })

    count += 1
  }

  return {
    status: count === 0 ? CATEGORY_STATUSES.NOTHING_TO_DO : CATEGORY_STATUSES.REDACTED,
    count,
  }
}

/**
 * How many contact addresses are the subject's own.
 *
 * Separate from {@link redactContactAddresses} only in that it counts rather
 * than writes; the predicate is identical, so the preview cannot promise a
 * different number from the one the write produces.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string|null} params.subjectEmail The subject's address, lower-cased.
 * @returns {Promise<number>} How many rows would be replaced.
 */
export async function countContactAddresses(tx, { organizationId, subjectEmail }) {
  if (!subjectEmail) return 0

  const organization = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { contactEmail: true },
  })

  let count = organization?.contactEmail?.toLowerCase() === subjectEmail ? 1 : 0

  const events = await tx.event.findMany({
    where: { organizationId, contactEmail: { not: null } },
    select: { contactEmail: true },
  })

  for (const event of events) {
    if (event.contactEmail && event.contactEmail.toLowerCase() === subjectEmail) count += 1
  }

  return count
}

/**
 * Count what a redaction would reach, without reading a single value.
 *
 * This is what the operator confirms against. It answers "how much, of what
 * kind" and never "which addresses" — a preview that listed the values would be
 * a worse disclosure than the fields it describes, and it would be one the
 * confirming operator had no reason to see.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @returns {Promise<Array<{category: string, count: number, status: string}>>} The scope, one entry per category.
 */
export async function previewScope(prisma, { organizationId, subjectUserId }) {
  const subjectEmail = await subjectAddress(prisma, subjectUserId)
  const elsewhere = await subjectBelongsElsewhere(prisma, { organizationId, subjectUserId })

  const orders = await prisma.order.count({
    where: {
      event: { organizationId },
      OR: subjectMatchers(subjectUserId, subjectEmail, 'buyerEmail'),
    },
  })

  const waitlisted = await prisma.waitlistEntry.count({
    where: {
      event: { organizationId },
      OR: subjectMatchers(subjectUserId, subjectEmail, 'email'),
    },
  })

  const tickets = await prisma.ticket.count({
    where: {
      ownerUserId: subjectUserId,
      attendeeName: { not: null },
      orderItem: { order: { event: { organizationId } } },
    },
  })

  const transfers = await prisma.ticketTransfer.count({
    where: {
      status: { not: 'PENDING' },
      ticket: { orderItem: { order: { event: { organizationId } } } },
      OR: [
        { fromUserId: subjectUserId },
        { toUserId: subjectUserId },
        ...(subjectEmail ? [{ toEmail: subjectEmail }] : []),
      ],
    },
  })

  const notifications = await prisma.notificationOutbox.count({
    where: {
      organizationId,
      status: { in: [...OUTBOX_SETTLED] },
      OR: subjectMatchers(subjectUserId, subjectEmail, 'recipient'),
    },
  })

  const contacts = await countContactAddresses(prisma, { organizationId, subjectEmail })
  // Counted through the join rather than by opening anything: the register
  // knows which artefacts are known to contain this person, and nothing here
  // reads an export.
  const exports = await countExportsContaining(prisma, { organizationId, subjectUserId })

  return [
    {
      // `(account ? 1 : 0) + contacts`, matching `redactSubject` exactly. The
      // parenthesis matters: an out-of-scope account still leaves this
      // organisation's own contact columns to replace.
      category: PRIVACY_CATEGORIES.ACCOUNT_IDENTITY,
      rows: (elsewhere ? 0 : 1) + contacts,
      status: elsewhere ? CATEGORY_STATUSES.OUT_OF_SCOPE : CATEGORY_STATUSES.REDACTED,
    },
    {
      category: PRIVACY_CATEGORIES.BUYER_IDENTITY,
      rows: orders + waitlisted,
      status:
        orders + waitlisted === 0 ? CATEGORY_STATUSES.NOTHING_TO_DO : CATEGORY_STATUSES.REDACTED,
    },
    {
      category: PRIVACY_CATEGORIES.TICKET_HOLDER_IDENTITY,
      rows: tickets + transfers,
      status:
        tickets + transfers === 0 ? CATEGORY_STATUSES.NOTHING_TO_DO : CATEGORY_STATUSES.REDACTED,
    },
    {
      category: PRIVACY_CATEGORIES.NOTIFICATION_DELIVERY,
      rows: notifications,
      status: notifications === 0 ? CATEGORY_STATUSES.NOTHING_TO_DO : CATEGORY_STATUSES.REDACTED,
    },
    {
      category: PRIVACY_CATEGORIES.SECURITY_METADATA,
      rows: 0,
      status: CATEGORY_STATUSES.DEFERRED,
    },
    {
      // No longer deferred. The export register answers this now — and for
      // every export this system currently produces the answer is zero,
      // because both CSV routes emit aggregate figures under column allow
      // lists that carry no personal field. `NOTHING_TO_DO` rather than
      // `DEFERRED` is the difference between "nothing to reach" and "nobody
      // has looked", and only one of those is true.
      category: PRIVACY_CATEGORIES.EXPORTS,
      rows: exports,
      status: exports === 0 ? CATEGORY_STATUSES.NOTHING_TO_DO : CATEGORY_STATUSES.REDACTED,
    },
  ]
}

/**
 * Run the redaction.
 *
 * Every write happens inside the caller's transaction, so there is no partial
 * redaction to resume: either the whole thing commits or none of it did. That is
 * possible here only because nothing in this path calls a provider — the moment
 * one does, it moves out of the transaction and this comment has to change.
 *
 * Idempotent by construction rather than by a guard: every placeholder is a pure
 * function of a row id, so a second run computes the same values, finds them
 * already stored, and writes nothing.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @param {Date} params.now The instant.
 * @returns {Promise<{categories: Array<object>, sessionsRevoked: number, tokensRevoked: number}>} What was done, by category.
 */
export async function redactSubject(tx, { organizationId, subjectUserId, now }) {
  // Read once, before anything changes it. Every category that has to recognise
  // the subject's own address needs the value it had on the way in.
  const subjectEmail = await subjectAddress(tx, subjectUserId)

  const elsewhere = await subjectBelongsElsewhere(tx, { organizationId, subjectUserId })

  const buyer = await redactBuyerIdentity(tx, { organizationId, subjectUserId, subjectEmail })
  const holder = await redactTicketHolderIdentity(tx, {
    organizationId,
    subjectUserId,
    subjectEmail,
  })
  const waitlist = await redactWaitlistEntries(tx, {
    organizationId,
    subjectUserId,
    subjectEmail,
  })
  const notifications = await redactNotificationDelivery(tx, {
    organizationId,
    subjectUserId,
    subjectEmail,
  })
  const contacts = await redactContactAddresses(tx, { organizationId, subjectEmail })
  // Inside the same transaction as everything else, so there is no state in
  // which the person is redacted while the register still advertises an
  // artefact containing them.
  const exportsInvalidated = await invalidateExportsForSubject(tx, {
    organizationId,
    subjectUserId,
    now,
  })

  // Last, because every category above needs the address this one replaces.
  const account = elsewhere
    ? { status: CATEGORY_STATUSES.OUT_OF_SCOPE, count: 0, sessionsRevoked: 0, tokensRevoked: 0 }
    : await redactAccountIdentity(tx, { subjectUserId, now })

  return {
    categories: [
      {
        // Two things in one line, and the split is worth stating. `rows` counts
        // both the account row and any contact address that turned out to be the
        // subject's own, because both are identity. `status` reports the
        // **account**, which is the only part that can be out of this
        // organisation's reach — a contact column belongs to this organisation
        // and is always within it. So `OUT_OF_SCOPE` with a non-zero count means
        // exactly what it says: the account survived, the contact columns did not.
        category: PRIVACY_CATEGORIES.ACCOUNT_IDENTITY,
        rows: account.count + contacts.count,
        status: account.status,
      },
      {
        category: PRIVACY_CATEGORIES.BUYER_IDENTITY,
        rows: buyer.count + waitlist.count,
        status:
          buyer.status === CATEGORY_STATUSES.REDACTED ||
          waitlist.status === CATEGORY_STATUSES.REDACTED
            ? CATEGORY_STATUSES.REDACTED
            : buyer.status,
      },
      {
        category: PRIVACY_CATEGORIES.TICKET_HOLDER_IDENTITY,
        rows: holder.count,
        status: holder.status,
      },
      {
        category: PRIVACY_CATEGORIES.NOTIFICATION_DELIVERY,
        rows: notifications.count,
        status: notifications.status,
      },
      {
        category: PRIVACY_CATEGORIES.SECURITY_METADATA,
        rows: 0,
        status: CATEGORY_STATUSES.DEFERRED,
      },
      {
        // Invalidated rather than deleted: every export is streamed and
        // nothing is stored, so there are no bytes to erase. What changes is
        // the register's claim that the artefact is still good — a row left
        // AVAILABLE after its subject was redacted would be this system
        // telling a later reader that a copy of that person still exists.
        category: PRIVACY_CATEGORIES.EXPORTS,
        rows: exportsInvalidated,
        status:
          exportsInvalidated === 0 ? CATEGORY_STATUSES.NOTHING_TO_DO : CATEGORY_STATUSES.REDACTED,
      },
    ],
    sessionsRevoked: account.sessionsRevoked,
    tokensRevoked: account.tokensRevoked,
  }
}
