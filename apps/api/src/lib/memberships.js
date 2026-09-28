/**
 * The membership rules every route that changes a role shares.
 *
 * Three routes can take `OWNER` away from somebody — a role change, a removal
 * and an ownership transfer — and a fourth, the platform's direct grant, can do
 * the same from outside the organisation. They all have to agree on one rule:
 * an organisation always has an owner. Kept here so the rule is written once.
 *
 * @module @desi-event/api/lib/memberships
 */

import { requiresAdmissionScope } from '@desi-event/permissions'

import { unprocessable } from './errors.js'

/**
 * How many owners an organisation has.
 *
 * Only meaningful after {@link lockOwners} in the same transaction. On its own,
 * under READ COMMITTED, two transactions demoting two different owners each
 * count two and both proceed — leaving none.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {string} organizationId Which organisation.
 * @returns {Promise<number>} The count.
 */
export function ownerCount(tx, organizationId) {
  return tx.membership.count({ where: { organizationId, role: 'OWNER' } })
}

/**
 * Lock every owner membership of an organisation until the transaction ends.
 *
 * The fix for the last-owner race. Two concurrent demotions of two different
 * owners each lock the same set of rows first, in the same order, so the
 * second waits for the first to commit and then counts what it left. Ordered
 * by id so two transactions can never take the locks in opposite orders.
 *
 * A no-op against the test double, whose transactions are serialised anyway.
 *
 * @param {object} tx A transaction client.
 * @param {string} organizationId Which organisation.
 * @returns {Promise<void>} Resolves once the rows are locked.
 */
export async function lockOwners(tx, organizationId) {
  await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "organizationId" = ${organizationId} AND "role" = 'OWNER' ORDER BY "id" FOR UPDATE`
}

/**
 * Refuse a change that would leave an organisation with no owner.
 *
 * Locks the owners, then counts them. Call it in the transaction that makes
 * the change, before the change.
 *
 * @param {object} tx A transaction client.
 * @param {string} organizationId Which organisation.
 * @returns {Promise<void>} Resolves when at least one other owner remains.
 * @throws {Error} A 422 when this is the only owner.
 */
export async function assertNotLastOwner(tx, organizationId) {
  await lockOwners(tx, organizationId)

  if ((await ownerCount(tx, organizationId)) <= 1) {
    throw unprocessable(
      'This is the only owner of the organisation. Make somebody else an owner first.',
    )
  }
}

/**
 * Lock one membership, and the organisation's owners, then read it as it is now.
 *
 * Every route that changes or removes a membership decides from the target's
 * role: whether the caller may act on it at all, and whether taking it away is
 * a last-owner question. A role read before the transaction can be stale by
 * the time the transaction runs — an ownership transfer committed in between
 * turns a manager into the only owner, and a removal decided on "manager" would
 * then delete the organisation's last owner, by somebody with no power over an
 * owner. So the role is read here, inside the transaction, after the row is
 * locked, and every decision is made from this read.
 *
 * The owners are locked first and the target second, in every route that calls
 * this — the same order the transfer takes them — so two of these can never
 * wait on each other in opposite orders. The owner rows come in id order
 * (`lockOwners`).
 *
 * Found either by id or by account, both within the organisation. Null when
 * the membership no longer exists: a concurrent removal won.
 *
 * @param {object} tx A transaction client.
 * @param {string} organizationId Which organisation.
 * @param {{id?: string, userId?: string}} target The membership's id, or its account's.
 * @returns {Promise<object|null>} The membership as it is now, or null.
 */
export async function lockMembership(tx, organizationId, { id, userId }) {
  await lockOwners(tx, organizationId)

  if (id) {
    await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "id" = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`

    return tx.membership.findFirst({ where: { id, organizationId } })
  }

  await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "userId" = ${userId} AND "organizationId" = ${organizationId} FOR UPDATE`

  return tx.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  })
}

/**
 * Replace a member's event scopes.
 *
 * Scopes are kept for the event-scoped door roles — MANAGER, STAFF and
 * SCANNER — and for nobody else. Those three may admit only to the events a
 * scope names; OWNER and ADMIN admit across the organisation and need none;
 * every other role cannot admit at all. So a promotion to ADMIN, or a demotion
 * to VIEWER, leaves no scopes behind to be re-inherited later. See
 * `@desi-event/permissions/admission` for the policy.
 *
 * Until the admission work only SCANNER kept scopes, which was harmless while
 * nothing read them. Now that the door enforces them, STAFF and MANAGER would
 * otherwise have been unable to admit anybody at all.
 *
 * ## A requested event that is not this organisation's is refused
 *
 * It used to be dropped without a word and the route answered `{ ok: true }`,
 * so an administrator could believe a scanner was scoped to an event it was
 * not — and find out at the door. The table now refuses such a row too
 * (`desi_scanner_scope_same_organization`); this is the readable version of
 * that refusal.
 *
 * @param {object} tx A transaction client.
 * @param {object} options Options.
 * @param {object} options.membership The membership row, already updated.
 * @param {string[]} options.eventIds Events to scope to.
 * @param {string} options.organizationId The organisation, for scoping the event lookup.
 * @returns {Promise<string[]>} The event ids scoped.
 * @throws {Error} A 422 when a requested event is not one of this organisation's.
 */
export async function setScannerScopes(tx, { membership, eventIds, organizationId }) {
  const wanted = requiresAdmissionScope(membership.role) ? [...new Set(eventIds)] : []

  const events = wanted.length
    ? await tx.event.findMany({
        where: { id: { in: wanted }, organizationId },
        select: { id: true },
      })
    : []

  if (events.length !== wanted.length) {
    throw unprocessable(
      `${wanted.length - events.length} of the requested events are not events of this organisation. ` +
        'A door scope can only name one of your own events.',
    )
  }

  await tx.scannerScope.deleteMany({ where: { membershipId: membership.id } })

  for (const event of events) {
    await tx.scannerScope.create({ data: { membershipId: membership.id, eventId: event.id } })
  }

  return events.map((event) => event.id)
}
