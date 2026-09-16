/**
 * Organiser verification, and the public page an organiser is judged by.
 *
 * Verification is not a field. It is a small state machine with two actors, and
 * these routes are the only way to move it — which is the point. The generic
 * organisation update in `teams.js` cannot reach `verificationStatus` or
 * `verified`, so an organiser with `organization:update` cannot write themselves
 * a badge, and a moderator's decision cannot be made by a PATCH that nobody
 * reviewed.
 *
 * Four routes, and the asymmetry between them is the authorisation model:
 *
 *   - **Read** the state and its history, for anybody who can already see the
 *     organisation's members.
 *   - **Submit**, for an organiser. The body names no target state: `PENDING` is
 *     the only place they can go.
 *   - **Decide**, for platform staff holding `moderation:review`, with a recent
 *     second factor and a recorded reason.
 *   - **Read the public profile**, for anybody at all — with the badge derived
 *     from the verification state rather than read off the denormalised column,
 *     so a stale `verified` cannot become an unearned claim on a public page.
 *
 * What a suspended organisation leaks: nothing. It is 404 on the public route
 * rather than 403, because a 403 confirms the organisation exists and a
 * suspension is not news we owe the internet.
 *
 * @module @desi-event/api/routes/organizers
 */

import { PUBLIC_EVENT_STATUSES } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { notFound } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import {
  ACTORS,
  BADGED_STATES,
  VERIFICATION_STATES,
  applyTransition,
  isEligible,
} from '../lib/verification.js'

/**
 * How many events either list on the public page carries.
 *
 * Bounded because the route is anonymous and an organiser with four thousand
 * past events should not be a way to make the database work hard for free.
 *
 * @type {number}
 */
export const PUBLIC_EVENT_LIMIT = 24

/**
 * Statuses an event may be in and still appear under "upcoming".
 *
 * The shared public set, unmodified. A cancelled or postponed event is not
 * something to sell a ticket to from an organiser's page, and a draft is not
 * something an anonymous caller may learn exists.
 *
 * @type {string[]}
 */
const UPCOMING_STATUSES = [...PUBLIC_EVENT_STATUSES]

/**
 * Statuses an event may be in and still appear under "past".
 *
 * `COMPLETED` is added, and only here: it is what a finished event becomes, and
 * an organiser's track record is the reason somebody reads this page at all. A
 * cancelled event is still absent — "we ran this" and "we called this off" are
 * not the same claim.
 *
 * @type {string[]}
 */
const PAST_STATUSES = [...PUBLIC_EVENT_STATUSES, 'COMPLETED']

/**
 * The verification state, as the API returns it.
 *
 * `eligible` is computed here rather than left for a client to derive from
 * `status`, so that no screen can get the rule subtly wrong and so the rule can
 * change without every client changing with it.
 *
 * @param {object} organization The organisation row.
 * @param {object[]} history The transitions, oldest first.
 * @returns {object} The response payload.
 */
function toVerificationState(organization, history) {
  return {
    organizationId: organization.id,
    status: organization.verificationStatus,
    eligible: isEligible(organization),
    note: organization.verificationNote ?? null,
    updatedAt: organization.verificationUpdatedAt ?? null,
    history: history.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus,
      reason: event.reason ?? null,
      createdAt: event.createdAt,
    })),
  }
}

/**
 * One event as the public organiser page lists it.
 *
 * Deliberately thin: a title, when it is, and where. Anything more belongs on
 * the event page, and anything about the buyer belongs nowhere near an
 * anonymous route.
 *
 * @param {object} event The event row, with its venue included.
 * @returns {object} The listing entry.
 */
function toPublicEvent(event) {
  return {
    slug: event.slug,
    title: event.title,
    startsAt: event.startsAt,
    venueName: event.venue?.name ?? null,
  }
}

/**
 * Register the organiser verification and public profile routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerOrganizerRoutes(app, { prisma }) {
  /**
   * Load an organisation by id, or 404.
   *
   * @param {string} id The organisation id.
   * @returns {Promise<object>} The organisation row.
   * @throws {Error} A 404 when it does not exist.
   */
  async function organizationById(id) {
    const organization = await prisma.organization.findUnique({ where: { id } })

    if (!organization) throw notFound('No such organisation.')

    return organization
  }

  /**
   * The transitions an organisation has been through, oldest first.
   *
   * @param {object} db A Prisma client or transaction client.
   * @param {string} organizationId Which organisation.
   * @returns {Promise<object[]>} The history.
   */
  function historyFor(db, organizationId) {
    return db.organizationVerificationEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    })
  }

  defineRoute(app, 'organizers.verification', {
    handler: async (request) => {
      const organization = await organizationById(request.params.id)

      return {
        data: toVerificationState(organization, await historyFor(prisma, organization.id)),
      }
    },
  })

  defineRoute(app, 'organizers.submitVerification', {
    handler: async (request) => {
      // Read inside the transaction, so the state the transition is conditional
      // on is the state it was decided from. `applyTransition` re-checks it in
      // the `updateMany` filter, which is what actually makes two simultaneous
      // submissions produce one history row.
      const { organization, history } = await prisma.$transaction(async (tx) => {
        const current = await tx.organization.findUnique({ where: { id: request.params.id } })

        if (!current) throw notFound('No such organisation.')

        const updated = await applyTransition(tx, {
          organization: current,
          to: VERIFICATION_STATES.PENDING,
          actor: ACTORS.ORGANISER,
          actorId: request.actor.id,
          reason: request.body.note ?? null,
        })

        // The legal name is the one piece of the submission that belongs on the
        // organisation rather than in its history: it is what a moderator checks
        // the registry against. Nothing else from the body is stored, and the
        // schema does not accept a document, a bank detail or a tax identifier.
        if (request.body.legalName) {
          await tx.organization.update({
            where: { id: current.id },
            data: { legalName: request.body.legalName },
          })
          updated.legalName = request.body.legalName
        }

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.VERIFICATION_SUBMITTED,
          entityType: 'Organization',
          entityId: current.id,
          actorId: request.actor.id,
          metadata: { from: current.verificationStatus, to: VERIFICATION_STATES.PENDING },
        })

        return { organization: updated, history: await historyFor(tx, current.id) }
      })

      request.log.info(
        { organizationId: organization.id, actorId: request.actor.id },
        'verification submitted',
      )

      return { data: toVerificationState(organization, history) }
    },
  })

  defineRoute(app, 'organizers.moderateVerification', {
    handler: async (request) => {
      const { decision, reason, note } = request.body

      const { organization, history, from } = await prisma.$transaction(async (tx) => {
        const current = await tx.organization.findUnique({ where: { id: request.params.id } })

        if (!current) throw notFound('No such organisation.')

        const updated = await applyTransition(tx, {
          organization: current,
          to: decision,
          actor: ACTORS.MODERATOR,
          actorId: request.actor.id,
          reason,
          note: note ?? null,
        })

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.VERIFICATION_DECIDED,
          entityType: 'Organization',
          entityId: current.id,
          actorId: request.actor.id,
          // The reason is recorded in two places on purpose: the history row is
          // what the organisation is shown, and the audit row is what an
          // investigator reads. Neither is derived from the other.
          metadata: { from: current.verificationStatus, to: decision, reason },
        })

        return {
          organization: updated,
          history: await historyFor(tx, current.id),
          from: current.verificationStatus,
        }
      })

      request.log.info(
        { organizationId: organization.id, actorId: request.actor.id, from, to: decision },
        'verification decided',
      )

      return { data: toVerificationState(organization, history) }
    },
  })

  defineRoute(app, 'organizers.get', {
    handler: async (request) => {
      const organization = await prisma.organization.findUnique({
        where: { slug: request.params.slug },
      })

      if (!organization) throw notFound('No such organiser.')

      // A suspended organisation is not found rather than refused. 404 and not
      // 403 because a 403 confirms the organisation exists, and a suspension is
      // not news we owe the internet. There is no staff exception here: this
      // route is anonymous, so there is no actor to make one for, and staff
      // reviewing a suspension read the verification route instead.
      if (organization.suspendedAt) throw notFound('No such organiser.')

      const now = new Date()

      const [upcoming, past] = await Promise.all([
        prisma.event.findMany({
          where: {
            organizationId: organization.id,
            status: { in: UPCOMING_STATUSES },
            startsAt: { gte: now },
          },
          orderBy: { startsAt: 'asc' },
          take: PUBLIC_EVENT_LIMIT,
          include: { venue: true },
        }),
        prisma.event.findMany({
          where: {
            organizationId: organization.id,
            status: { in: PAST_STATUSES },
            startsAt: { lt: now },
          },
          orderBy: { startsAt: 'desc' },
          take: PUBLIC_EVENT_LIMIT,
          include: { venue: true },
        }),
      ])

      return {
        data: {
          slug: organization.slug,
          name: organization.name,
          description: organization.description ?? null,
          websiteUrl: organization.websiteUrl ?? null,
          // From the state machine, not from the denormalised column. The two
          // are kept in step by `applyTransition`, and deriving the badge from
          // the state means that if they ever do disagree the page is wrong in
          // the safe direction.
          verified: BADGED_STATES.has(organization.verificationStatus),
          refundPolicy: organization.refundPolicy ?? null,
          timezone: organization.timezone,
          upcomingEvents: upcoming.map(toPublicEvent),
          pastEvents: past.map(toPublicEvent),
        },
      }
    },
  })
}
