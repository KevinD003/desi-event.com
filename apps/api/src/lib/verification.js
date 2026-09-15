/**
 * Organiser verification: which transitions exist, and who may make them.
 *
 * Verification is the gate on two things that matter — publishing an event and
 * being paid for it — so the interesting property is not the happy path but the
 * shape of the graph. Every edge here was chosen; anything not listed is refused
 * with the list of what *is* allowed, because "invalid transition" without the
 * alternatives is an error message that helps nobody.
 *
 * The states, and why each is separate:
 *
 *   - `UNVERIFIED` — nobody has asked yet. The starting point.
 *   - `PENDING` — asked, waiting for a moderator.
 *   - `REQUIRES_INFORMATION` — a moderator needs something. The *organiser* can
 *     act from here, which is what distinguishes it from `PENDING`: one is our
 *     queue, the other is theirs.
 *   - `VERIFIED` — granted.
 *   - `REJECTED` — considered and refused. Never granted.
 *   - `SUSPENDED` — a temporary hold on an organisation that *was* verified,
 *     expected to be lifted.
 *   - `REVOKED` — granted and then withdrawn. Distinct from `REJECTED`, which was
 *     never granted, and from `SUSPENDED`, which is expected to end. An organiser
 *     who was verified and is no longer is a different conversation from one who
 *     never was, and a different row in a report.
 *
 * Two rules the transition table encodes that are easy to get wrong:
 *
 *   - **You cannot go straight from `UNVERIFIED` to `VERIFIED`.** A moderator
 *     approving something nobody submitted means the evidence was never
 *     gathered.
 *   - **`REJECTED` and `REVOKED` are not dead ends.** An organiser can submit
 *     again. A permanent refusal with no route back is a support ticket wearing
 *     a state machine's clothes.
 *
 * @module @desi-event/api/lib/verification
 */

import { forbidden, httpError } from './errors.js'

/** Every verification state, mirroring the Prisma enum. */
export const VERIFICATION_STATES = Object.freeze({
  UNVERIFIED: 'UNVERIFIED',
  PENDING: 'PENDING',
  REQUIRES_INFORMATION: 'REQUIRES_INFORMATION',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
  REVOKED: 'REVOKED',
})

/**
 * Who may make a transition.
 *
 * `organiser` means an authorised member of the organisation itself; `moderator`
 * means platform staff holding `moderation:review`. The distinction is the whole
 * authorisation model of this module: an organiser may *ask*, and may answer a
 * question, and may do nothing else.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ACTORS = Object.freeze({
  ORGANISER: 'organiser',
  MODERATOR: 'moderator',
})

/**
 * The transitions that exist, as `from -> [{ to, actor }]`.
 *
 * @type {Readonly<Record<string, ReadonlyArray<{to: string, actor: string}>>>}
 */
export const TRANSITIONS = Object.freeze({
  [VERIFICATION_STATES.UNVERIFIED]: Object.freeze([
    { to: VERIFICATION_STATES.PENDING, actor: ACTORS.ORGANISER },
  ]),
  [VERIFICATION_STATES.PENDING]: Object.freeze([
    { to: VERIFICATION_STATES.REQUIRES_INFORMATION, actor: ACTORS.MODERATOR },
    { to: VERIFICATION_STATES.VERIFIED, actor: ACTORS.MODERATOR },
    { to: VERIFICATION_STATES.REJECTED, actor: ACTORS.MODERATOR },
  ]),
  [VERIFICATION_STATES.REQUIRES_INFORMATION]: Object.freeze([
    // The organiser answers, which puts it back in the moderators' queue.
    { to: VERIFICATION_STATES.PENDING, actor: ACTORS.ORGANISER },
    { to: VERIFICATION_STATES.REJECTED, actor: ACTORS.MODERATOR },
  ]),
  [VERIFICATION_STATES.VERIFIED]: Object.freeze([
    { to: VERIFICATION_STATES.SUSPENDED, actor: ACTORS.MODERATOR },
    { to: VERIFICATION_STATES.REVOKED, actor: ACTORS.MODERATOR },
  ]),
  [VERIFICATION_STATES.SUSPENDED]: Object.freeze([
    // A hold is lifted back to where it was, not re-approved from scratch.
    { to: VERIFICATION_STATES.VERIFIED, actor: ACTORS.MODERATOR },
    { to: VERIFICATION_STATES.REVOKED, actor: ACTORS.MODERATOR },
  ]),
  [VERIFICATION_STATES.REJECTED]: Object.freeze([
    { to: VERIFICATION_STATES.PENDING, actor: ACTORS.ORGANISER },
  ]),
  [VERIFICATION_STATES.REVOKED]: Object.freeze([
    { to: VERIFICATION_STATES.PENDING, actor: ACTORS.ORGANISER },
  ]),
})

/**
 * States in which the organisation may publish an event and be paid.
 *
 * One set rather than two, deliberately: an organisation that cannot be paid
 * should not be selling, and keeping the two answers together means they cannot
 * drift apart.
 *
 * @type {ReadonlySet<string>}
 */
export const ELIGIBLE_STATES = Object.freeze(new Set([VERIFICATION_STATES.VERIFIED]))

/**
 * States whose badge is shown publicly.
 *
 * Exactly one. A badge for anything else would be an unearned claim, and the
 * public page derives it from here rather than from the denormalised `verified`
 * column, so the two cannot disagree.
 *
 * @type {ReadonlySet<string>}
 */
export const BADGED_STATES = ELIGIBLE_STATES

/**
 * Whether an organisation may publish and be paid.
 *
 * Suspension is checked separately from the verification state: an organisation
 * can be verified *and* suspended, and the suspension wins.
 *
 * @param {object} organization The organisation row.
 * @returns {boolean} True when it may publish and be paid.
 */
export function isEligible(organization) {
  if (!organization) return false
  if (organization.suspendedAt) return false

  return ELIGIBLE_STATES.has(organization.verificationStatus)
}

/**
 * Whether a transition exists, and whether this actor may make it.
 *
 * @param {string} from The current state.
 * @param {string} to The requested state.
 * @param {string} actor One of {@link ACTORS}.
 * @returns {{allowed: boolean, reason: string|null, permitted: string[]}} The verdict, with what is possible from here.
 */
export function canTransition(from, to, actor) {
  const edges = TRANSITIONS[from] ?? []
  const permitted = edges.map((edge) => edge.to)
  const edge = edges.find((candidate) => candidate.to === to)

  if (!edge) {
    return { allowed: false, reason: 'NO_SUCH_TRANSITION', permitted }
  }

  if (edge.actor !== actor) {
    return { allowed: false, reason: 'WRONG_ACTOR', permitted }
  }

  return { allowed: true, reason: null, permitted }
}

/**
 * Assert a transition, or throw the right error for why not.
 *
 * A wrong actor is a 403 and an impossible transition is a 409, because they
 * mean different things to whoever hits them: one says "not you", the other says
 * "not from here". Collapsing both into one status would send an organiser to
 * ask for permissions they already have.
 *
 * @param {string} from The current state.
 * @param {string} to The requested state.
 * @param {string} actor One of {@link ACTORS}.
 * @returns {void}
 * @throws {Error} A 409 or a 403.
 */
export function assertTransition(from, to, actor) {
  const verdict = canTransition(from, to, actor)

  if (verdict.allowed) return

  if (verdict.reason === 'WRONG_ACTOR') {
    throw forbidden(
      `Only a ${TRANSITIONS[from].find((edge) => edge.to === to).actor} can move this organisation from ${from} to ${to}.`,
      'VERIFICATION_WRONG_ACTOR',
    )
  }

  throw httpError(409, 'VERIFICATION_INVALID_TRANSITION', permittedMessage(from, verdict.permitted))
}

/**
 * The message for an impossible transition.
 *
 * Says what *is* possible, because a refusal that does not is a dead end.
 *
 * @param {string} from The current state.
 * @param {string[]} permitted Where it could go instead.
 * @returns {string} The message.
 */
function permittedMessage(from, permitted) {
  if (permitted.length === 0) {
    return `An organisation in ${from} has no verification transitions available.`
  }

  return `An organisation in ${from} can only move to ${permitted.join(', ')}.`
}

/**
 * Apply a verification transition, with its history entry, in one transaction.
 *
 * The update is conditional on the state the caller read, so two moderators
 * acting on the same organisation at the same moment produce one transition and
 * one history row rather than two of each. That is the same conditional-update
 * shape the seat and webhook code uses, for the same reason: reading and then
 * writing is not a decision, it is a race.
 *
 * `verified` is written alongside `verificationStatus` because the column is the
 * denormalised public badge and the schema says the two must always agree. Set
 * here rather than derived at read time so that a query filtering on `verified`
 * cannot see a stale answer.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params The transition.
 * @param {object} params.organization The organisation as read, carrying `id` and `verificationStatus`.
 * @param {string} params.to The requested state.
 * @param {string} params.actor One of {@link ACTORS}.
 * @param {string|null} [params.actorId] The user making it. Null for an automatic transition.
 * @param {string|null} [params.reason] Why. Required for every moderator action by the route layer.
 * @param {string|null} [params.note] What the organiser must supply, for REQUIRES_INFORMATION.
 * @param {Date} [params.now] The instant.
 * @returns {Promise<object>} The updated organisation.
 * @throws {Error} A 409 when somebody else moved it first.
 */
export async function applyTransition(
  tx,
  { organization, to, actor, actorId = null, reason = null, note = null, now = new Date() },
) {
  const from = organization.verificationStatus

  assertTransition(from, to, actor)

  const { count } = await tx.organization.updateMany({
    where: { id: organization.id, verificationStatus: from },
    data: {
      verificationStatus: to,
      verified: BADGED_STATES.has(to),
      verificationNote: to === VERIFICATION_STATES.REQUIRES_INFORMATION ? note : null,
      verificationUpdatedAt: now,
    },
  })

  if (count !== 1) {
    throw httpError(
      409,
      'VERIFICATION_CONCURRENT_CHANGE',
      'This organisation was changed while you were looking at it. Reload and try again.',
    )
  }

  await tx.organizationVerificationEvent.create({
    data: { organizationId: organization.id, fromStatus: from, toStatus: to, actorId, reason },
  })

  return tx.organization.findUnique({ where: { id: organization.id } })
}
