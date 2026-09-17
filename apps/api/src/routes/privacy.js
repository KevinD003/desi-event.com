/**
 * Redacting a person, and the record of having done it.
 *
 * Phase 1 built the authorization, the policy and the data model. Phase 2 adds
 * the service: raising a request, confirming it, executing the redaction inside
 * one transaction, withdrawing it before it runs, reading its evidence, and
 * placing or lifting the holds that refuse it.
 *
 * ## The shape of the exchange, and why it has two steps
 *
 * Raising a request writes nothing about the subject. It evaluates the holds,
 * counts what is in scope, and hands back a single-use phrase the server minted
 * and stored only as a digest. Confirming requires that phrase back, re-runs the
 * hold evaluation from scratch, and only then redacts. The two steps exist
 * because the interval between them is exactly when a legal hold gets placed,
 * and because an irreversible action reached in one call is an irreversible
 * action a mis-click can reach.
 *
 * ## Why a read needs the same capability as the destruction
 *
 * `privacy:redact` gates both. Reading who has asked to be removed from an
 * organisation is part of the same decision as removing them — a list of
 * subjects is a list of people who wanted to leave, and handing it to a wider
 * audience than the one trusted to act on it would defeat the point. The
 * capability is granted to the organisation owner and to nobody else.
 *
 * ## What this surface will not tell you
 *
 * Whether an identifier is real. A request belonging to another organisation
 * and a request that never existed answer the same 404 with the same sentence,
 * because a caller who can tell the difference has a way to confirm that a named
 * person is in the system — which is exactly the question a redaction exists to
 * stop answering.
 *
 * And it will not tell you a value. A subject is an opaque row id; the work is
 * counts by category. There is no field here carrying a name, an address, or
 * anything that was or will be redacted, before or after.
 *
 * @module @desi-event/api/routes/privacy
 */

import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { AUDIT_ACTIONS } from '../lib/audit.js'
import { conflict, notFound } from '../lib/errors.js'
import {
  assertSubjectBelongsToOrganization,
  loadOrganizationForPrivacy,
  toPrivacyRequest,
} from '../lib/privacy.js'
import { HOLD_DECISIONS, placeHold, releaseHold, toPrivacyHold } from '../lib/privacy-holds.js'
import {
  CONFIRMATION_WINDOW_MS,
  cancelPrivacyRequest,
  confirmPrivacyRequest,
  raisePrivacyRequest,
  recordPrivacyAudit,
} from '../lib/privacy-requests.js'
import { defineRoute } from '../lib/register.js'

/**
 * Newest first.
 *
 * A privacy queue is read to answer "what has come in", not "what is oldest":
 * unlike the notification outbox there is no backlog to work through, because a
 * request either completed or is waiting on a person.
 *
 * @type {ReadonlyArray<object>}
 */
const REQUEST_ORDER = Object.freeze([{ createdAt: 'desc' }, { id: 'desc' }])

/**
 * Oldest first.
 *
 * The opposite of the request list, and for the opposite reason: a timeline is
 * read as a narrative. What happened, then what happened next.
 *
 * @type {ReadonlyArray<object>}
 */
const EVENT_ORDER = Object.freeze([{ occurredAt: 'asc' }, { id: 'asc' }])

/**
 * Project an audit row onto what an operator may see.
 *
 * An allow list, and there is nothing interesting left out — every column on
 * `PrivacyAuditEvent` is already an opaque id, an enum, a code or a count. The
 * projection exists so that a column added later has to be added here on
 * purpose, rather than appearing on the wire because somebody widened a model.
 *
 * @param {object} row A `PrivacyAuditEvent` row.
 * @returns {object} The payload described by `privacyAuditEventSchema`.
 */
function toPrivacyAuditEvent(row) {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actorId ?? null,
    targetId: row.targetId,
    targetType: row.targetType,
    reasonCode: row.reasonCode,
    holdDecision: row.holdDecision,
    result: row.result,
    policyVersion: row.policyVersion,
    correlationId: row.correlationId,
    detail: row.detail ?? null,
    occurredAt: row.occurredAt,
  }
}

/**
 * Register the privacy routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerPrivacyRoutes(app, { prisma }) {
  defineRoute(app, 'privacy.listRequests', {
    handler: async (request) => {
      const organizationId = request.params.id
      const { page, perPage, state, subjectId } = request.query

      await loadOrganizationForPrivacy(prisma, organizationId)

      const { skip, take } = toSkipTake({ page, perPage })
      // The organisation is in the same `where` that finds the rows rather than
      // filtered afterwards, so another tenant's requests are not counted into
      // `pagination.total` — a total is a leak in its own right.
      const where = {
        organizationId,
        ...(state ? { state } : {}),
        ...(subjectId ? { subjectUserId: subjectId } : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.privacyRequest.findMany({ where, orderBy: REQUEST_ORDER, skip, take }),
        prisma.privacyRequest.count({ where }),
      ])

      return {
        data: rows.map(toPrivacyRequest),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'privacy.getRequest', {
    handler: async (request) => {
      const organizationId = request.params.id

      await loadOrganizationForPrivacy(prisma, organizationId)

      // Scoped in the lookup, not checked after it. A request that belongs to
      // another organisation is not found rather than found-and-refused, which
      // is the same answer a request that does not exist gets.
      const row = await prisma.privacyRequest.findFirst({
        where: { id: request.params.requestId, organizationId },
      })

      if (!row) throw notFound('No such redaction request.')

      return { data: toPrivacyRequest(row) }
    },
  })

  defineRoute(app, 'privacy.createRequest', {
    handler: async (request, reply) => {
      const now = new Date()

      const { request: raised, confirmationPhrase } = await raisePrivacyRequest(prisma, {
        organizationId: request.params.id,
        subjectUserId: request.body.subjectId,
        actor: request.actor,
        reason: request.body.reason,
        now,
      })

      reply.code(201)

      // The one time the phrase crosses the wire. Only its digest is stored, so
      // re-reading the request will never produce it again — which is what makes
      // a confirmation a confirmation rather than a field somebody can look up.
      return {
        data: toPrivacyRequest(raised),
        confirmation: {
          phrase: confirmationPhrase,
          expiresAt: new Date(now.getTime() + CONFIRMATION_WINDOW_MS),
        },
      }
    },
  })

  defineRoute(app, 'privacy.confirmRequest', {
    handler: async (request) => {
      const confirmed = await confirmPrivacyRequest(prisma, {
        organizationId: request.params.id,
        requestId: request.params.requestId,
        confirmationPhrase: request.body.confirmationPhrase,
        actor: request.actor,
        now: new Date(),
      })

      return { data: toPrivacyRequest(confirmed) }
    },
  })

  defineRoute(app, 'privacy.cancelRequest', {
    handler: async (request) => {
      const cancelled = await cancelPrivacyRequest(prisma, {
        organizationId: request.params.id,
        requestId: request.params.requestId,
        actor: request.actor,
        now: new Date(),
      })

      return { data: toPrivacyRequest(cancelled) }
    },
  })

  defineRoute(app, 'privacy.listRequestEvents', {
    handler: async (request) => {
      const organizationId = request.params.id
      const { page, perPage } = request.query

      await loadOrganizationForPrivacy(prisma, organizationId)

      // The request is resolved inside this organisation first. Reading the
      // events of another tenant's request would be the same disclosure as
      // reading the request, so it gets the same 404.
      const owner = await prisma.privacyRequest.findFirst({
        where: { id: request.params.requestId, organizationId },
        select: { id: true },
      })

      if (!owner) throw notFound('No such redaction request.')

      const { skip, take } = toSkipTake({ page, perPage })
      const where = { privacyRequestId: owner.id, organizationId }

      const [rows, total] = await Promise.all([
        prisma.privacyAuditEvent.findMany({ where, orderBy: EVENT_ORDER, skip, take }),
        prisma.privacyAuditEvent.count({ where }),
      ])

      return {
        data: rows.map(toPrivacyAuditEvent),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'privacy.listHolds', {
    handler: async (request) => {
      const organizationId = request.params.id
      const { page, perPage, state, subjectId } = request.query

      await loadOrganizationForPrivacy(prisma, organizationId)

      const { skip, take } = toSkipTake({ page, perPage })
      const where = {
        organizationId,
        ...(state ? { state } : {}),
        ...(subjectId ? { subjectUserId: subjectId } : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.privacyHold.findMany({
          where,
          orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
          skip,
          take,
        }),
        prisma.privacyHold.count({ where }),
      ])

      return {
        data: rows.map(toPrivacyHold),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'privacy.placeHold', {
    handler: async (request, reply) => {
      const organizationId = request.params.id

      await loadOrganizationForPrivacy(prisma, organizationId)

      // The same scope test a redaction gets. A hold over somebody this
      // organisation holds nothing about would be an assertion of authority it
      // does not have, and the 404 is the same one a redaction would give.
      await assertSubjectBelongsToOrganization(prisma, {
        organizationId,
        subjectUserId: request.body.subjectId,
      })

      const hold = await placeHold(prisma, {
        organizationId,
        subjectUserId: request.body.subjectId,
        kind: request.body.kind,
        matterReference: request.body.matterReference,
        placedById: request.actor.id,
        expectedUntil: request.body.expectedUntil ? new Date(request.body.expectedUntil) : null,
      })

      await recordPrivacyAudit(prisma, {
        action: AUDIT_ACTIONS.PRIVACY_HOLD_PLACED,
        actorId: request.actor.id,
        organizationId,
        targetId: request.body.subjectId,
        reasonCode: hold.kind,
        holdDecision:
          hold.kind === 'LEGAL'
            ? HOLD_DECISIONS.LEGAL_HOLD_ACTIVE
            : HOLD_DECISIONS.FRAUD_HOLD_ACTIVE,
        result: 'REFUSED_HOLD',
        correlationId: hold.id,
      })

      reply.code(201)

      return { data: toPrivacyHold(hold) }
    },
  })

  defineRoute(app, 'privacy.releaseHold', {
    handler: async (request) => {
      const organizationId = request.params.id
      const now = new Date()

      await loadOrganizationForPrivacy(prisma, organizationId)

      const existing = await prisma.privacyHold.findFirst({
        where: { id: request.params.holdId, organizationId },
      })

      if (!existing) throw notFound('No such privacy hold.')

      const { released } = await releaseHold(prisma, {
        organizationId,
        holdId: existing.id,
        releasedById: request.actor.id,
        releaseReasonCode: request.body.releaseReasonCode,
        now,
      })

      if (!released) {
        throw conflict('That hold has already been lifted.', { state: existing.state })
      }

      await recordPrivacyAudit(prisma, {
        action: AUDIT_ACTIONS.PRIVACY_HOLD_RELEASED,
        actorId: request.actor.id,
        organizationId,
        targetId: existing.subjectUserId,
        reasonCode: request.body.releaseReasonCode,
        holdDecision: HOLD_DECISIONS.NONE_ACTIVE,
        result: 'REQUESTED',
        correlationId: existing.id,
      })

      const refreshed = await prisma.privacyHold.findUnique({ where: { id: existing.id } })

      return { data: toPrivacyHold(refreshed) }
    },
  })
}
