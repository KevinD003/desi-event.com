/**
 * Reading what a retention rehearsal found.
 *
 * One route, and it is a `GET`. There is no route here that starts a sweep, no
 * route that activates enforcement, and no route that deletes anything — and
 * those absences are the design rather than a backlog.
 *
 * ## Why there is no route that starts a sweep
 *
 * The API holds no queue client. Nothing in `apps/api` enqueues a BullMQ job;
 * the worker's schedule and its operator helpers are the only producers. Adding
 * a queue client here to gain a "run it now" button would mean the one surface
 * reachable from a browser had acquired the ability to start a job whose
 * durations nobody has approved. Initiation stays where it cannot be reached
 * over HTTP: an operator with access to the worker, through
 * `enqueueSweepRetention`.
 *
 * ## Why this is platform-scoped
 *
 * Because the thing it reads is. `RetentionSweep` has no `organizationId` and a
 * sweep counts across every tenant at once, so there is no honest per-tenant
 * figure to derive from it. `retention:view` is platform-only, which
 * `PLATFORM_ONLY_CAPABILITIES` asserts at module load — an organisation role
 * that somehow acquired it would fail the import rather than reach this route.
 *
 * ## What the payload cannot contain
 *
 * Anybody's data. Not by filtering, but because the sweep that wrote these rows
 * never read a personal value: its queries ask about timestamps and about
 * whether a column is null, never what is in one. What comes back is class
 * names, counts, cut-offs and states.
 *
 * `leaseOwner` is dropped on the way out. It names a worker process, which is
 * infrastructure a reader cannot act on and an attacker would rather have.
 *
 * ## Why there is no per-sweep detail route
 *
 * There was going to be one, and the case for it did not survive being written
 * down. Everything a detail view would show is already on the list row: the
 * class, the mode, the state, the cut-off, the three counts, the failure code
 * and the timestamps. The two fields that looked like new content —
 * `proposedDays` and `basis` — are compile-time constants in
 * `RETENTION_CLASS_PROPOSALS`, which the browser already imports.
 *
 * So the route would have added a pair of schemas, a contract entry, a
 * regenerated `openapi.json` and a regenerated route manifest, in exchange for
 * a second way to read fields that are already served. The only honest
 * remaining argument is a deep-linkable URL for one sweep, and nobody has asked
 * to link to one. Surface without safety is the thing this phase keeps finding
 * and removing; adding some here would be strange.
 *
 * What was worth building from that plan is the rollup below, which answers a
 * question the list genuinely cannot.
 *
 * @module @desi-event/api/routes/retention
 */

import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import {
  RETENTION_CLASS_PROPOSALS,
  RETENTION_NOT_EVALUATED,
  buildPaginationMeta,
  retentionApprovalFor,
  toSkipTake,
} from '@desi-event/schemas'

import { defineRoute } from '../lib/register.js'

/**
 * Newest first.
 *
 * The opposite of the reconciliation queue, and deliberately: a rehearsal is
 * evidence rather than work, and the question a reader arrives with is "what
 * did the last run say?", not "what has been waiting longest?".
 *
 * @type {Array<object>}
 */
const SWEEP_ORDER = Object.freeze([{ createdAt: 'desc' }, { id: 'desc' }])

/**
 * Present one sweep row.
 *
 * Field-by-field rather than by spreading the row, so a column added to
 * `RetentionSweep` later has to be named here before it can reach a reader.
 * `leaseOwner` and `leaseExpiresAt` are omitted on purpose.
 *
 * @param {object} row A `RetentionSweep` row.
 * @returns {object} The payload shape.
 */
function toRetentionSweep(row) {
  return {
    id: row.id,
    retentionClass: row.retentionClass,
    mode: row.mode,
    state: row.state,
    olderThan: row.olderThan,
    examinedCount: row.examinedCount,
    affectedCount: row.affectedCount,
    heldCount: row.heldCount,
    failureCode: row.failureCode ?? null,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
    // Attached here rather than stored, so the label cannot be left behind by a
    // row written before the policy had one. A number that reaches an operator
    // without PROPOSED beside it is a number somebody eventually treats as
    // settled.
    approval: retentionApprovalFor(row.retentionClass),
  }
}

/**
 * Where every evaluated class stands, whatever page is being read.
 *
 * ## Why this is computed and not filtered
 *
 * Deliberately ignores the caller's `retentionClass` and `state` filters. The
 * rollup exists precisely for the reader who has narrowed the list: filter to
 * `FAILED` and the page shows only failures, which is a screen on which every
 * class looks broken. The rollup is the fixed reference the filtered view is
 * read against.
 *
 * ## Why a query per class rather than one clever one
 *
 * A `DISTINCT ON` or a window function would be one round trip instead of
 * eight, and would have to be raw SQL to express in Prisma. There are four
 * classes and this table grows by four rows per rehearsal, which is not on a
 * timer — the query count is a constant, not a function of anything. Raw SQL
 * against the retention tables is exactly what the rest of this surface avoids,
 * and buying a round trip with it would be a poor trade.
 *
 * @param {object} prisma The Prisma client.
 * @returns {Promise<Array<object>>} One entry per evaluated class.
 */
async function classSummary(prisma) {
  return Promise.all(
    RETENTION_CLASS_PROPOSALS.map(async (proposal) => {
      const where = { retentionClass: proposal.retentionClass }
      const [latest, runCount] = await Promise.all([
        prisma.retentionSweep.findFirst({ where, orderBy: SWEEP_ORDER }),
        prisma.retentionSweep.count({ where }),
      ])

      return {
        retentionClass: proposal.retentionClass,
        // Null rather than absent. "No rehearsal has ever covered this class"
        // is a finding, and a class dropped from the array would be
        // indistinguishable from one the rollup forgot.
        latest: latest ? toRetentionSweep(latest) : null,
        runCount,
      }
    }),
  )
}

/**
 * Register the retention routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerRetentionRoutes(app, { prisma }) {
  defineRoute(app, 'retention.listSweeps', {
    handler: async (request) => {
      // Asserted here as well as by the route's declared capability. The empty
      // context is the whole point: `decide` consults the platform role list
      // first and only falls back to memberships when an organisation is named,
      // so asking with no organisation is asking the platform question — which
      // is the one this route means, and the one an organisation-scoped check
      // would get backwards.
      assertCan(request.actor, CAPABILITIES.RETENTION_VIEW, {})

      const { page, perPage, retentionClass, state } = request.query
      const { skip, take } = toSkipTake({ page, perPage })

      const where = {
        ...(retentionClass ? { retentionClass } : {}),
        ...(state ? { state } : {}),
      }

      const [rows, total, summary] = await Promise.all([
        prisma.retentionSweep.findMany({ where, orderBy: SWEEP_ORDER, skip, take }),
        prisma.retentionSweep.count({ where }),
        classSummary(prisma),
      ])

      return {
        data: rows.map(toRetentionSweep),
        pagination: buildPaginationMeta({ page, perPage, total }),
        // Sent with every page, including an empty one. A reader who filtered
        // to nothing still needs to know which classes no sweep ever covers.
        notEvaluated: RETENTION_NOT_EVALUATED.map((entry) => ({ ...entry })),
        summary,
      }
    },
  })
}
