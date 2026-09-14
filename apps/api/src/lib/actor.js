/**
 * Building the request actor.
 *
 * `@desi-event/permissions` decides everything about authorization; this
 * module's only job is to assemble the `{ id, role, memberships }` object it
 * expects. No route re-implements a role comparison — if you find yourself
 * writing `role === 'OWNER'` in a handler, the capability is missing from the
 * permissions package instead.
 *
 * @module @desi-event/api/lib/actor
 */

/**
 * @typedef {object} Actor
 * @property {string} id The user's id.
 * @property {string} role Platform-wide `UserRole`.
 * @property {string} email The user's email, used for buyer-owned resources.
 * @property {Array<{organizationId: string, role: string}>} memberships Organisation memberships.
 */

/**
 * Assemble an actor from a user row and its memberships.
 *
 * @param {object} user A `User` row.
 * @param {Array<{organizationId: string, role: string}>} [memberships] `Membership` rows for that user.
 * @returns {Actor} The actor passed to `can`/`assertCan`.
 */
export function toActor(user, memberships = []) {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    memberships: memberships.map((membership) => ({
      organizationId: membership.organizationId,
      role: membership.role,
    })),
  }
}

/**
 * Load a user and their memberships and build the actor.
 *
 * Memberships are read on every authenticated request rather than being baked
 * into the token: a role revoked at 09:00 has to stop working at 09:00, not
 * whenever the buyer's seven-day token happens to expire.
 *
 * @param {object} prisma A Prisma client (or transaction client).
 * @param {string} userId The user id taken from the verified token.
 * @returns {Promise<{user: object, actor: Actor}|null>} The user row and actor, or `null` when the user no longer exists.
 */
export async function loadActor(prisma, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return null

  const memberships = await prisma.membership.findMany({ where: { userId: user.id } })

  return { user, actor: toActor(user, memberships) }
}

/**
 * Organisation ids in which the actor holds a capability.
 *
 * Used to turn a permission question into a database filter — "which drafts may
 * this caller see" is answered with an `organizationId IN (...)` clause rather
 * than by fetching every draft and filtering in memory.
 *
 * @param {Actor|null|undefined} actor The request actor.
 * @param {function(object, string, object): boolean} can The permissions `can` function.
 * @param {string} capability The capability to test in each organisation.
 * @returns {string[]} Matching organisation ids; empty when the actor is anonymous.
 */
export function organizationsWhere(actor, can, capability) {
  if (!actor) return []

  const ids = new Set()
  for (const membership of actor.memberships ?? []) {
    if (can(actor, capability, { organizationId: membership.organizationId })) {
      ids.add(membership.organizationId)
    }
  }

  return [...ids]
}
