/**
 * Reading a retention rehearsal, and the four things this surface must not do.
 *
 * The route is a `GET` and nothing else, so the interesting assertions are all
 * about absence:
 *
 *   - **No organisation role can reach it.** `retention:view` is platform-only,
 *     and an organisation owner is the strongest actor an organisation has.
 *   - **No route starts a sweep.** Asserted against the contract rather than
 *     against this file, because the claim is about the whole API.
 *   - **No payload carries a worker's identity.** `leaseOwner` names a process.
 *   - **No number travels without its approval status.** Every row says
 *     `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`, including one written before
 *     the class had a proposal at all.
 *
 * @module @desi-event/api/tests/retention-sweeps.test
 */

import { describe, expect, it } from 'vitest'

import { apiRoutes } from '@desi-event/api-contract'
import { RETENTION_APPROVAL, RETENTION_NOT_EVALUATED } from '@desi-event/schemas'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

/** A fixed instant, so ordering is checkable rather than approximate. */
const RUN_AT = new Date('2026-09-18T00:00:00.000Z')

/**
 * One `RetentionSweep` row.
 *
 * @param {object} [overrides] Fields to override.
 * @returns {object} The row.
 */
function sweep(overrides = {}) {
  return {
    id: cuid(),
    retentionClass: 'login_attempt',
    mode: 'DRY_RUN',
    state: 'COMPLETED',
    olderThan: new Date('2026-08-19T00:00:00.000Z'),
    examinedCount: 12,
    affectedCount: 0,
    heldCount: 0,
    leaseOwner: 'worker-4711',
    leaseExpiresAt: null,
    startedAt: RUN_AT,
    finishedAt: RUN_AT,
    failureCode: null,
    createdAt: RUN_AT,
    updatedAt: RUN_AT,
    ...overrides,
  }
}

/**
 * Build the app with some sweeps already recorded.
 *
 * @param {Array<object>} rows The sweep rows.
 * @returns {Promise<object>} The harness.
 */
async function withSweeps(rows) {
  const harness = await createTestApp()
  harness.prisma._store.retentionSweep = rows
  return harness
}

/**
 * Read the sweep list as the platform admin.
 *
 * @param {object} harness The harness.
 * @param {string} [query] A query string, including the leading `?`.
 * @returns {Promise<object>} The injected response.
 */
async function listSweeps(harness, query = '') {
  const token = await signIn(harness.app, 'ops@desi-event.example')

  return harness.app.inject({
    method: 'GET',
    url: `/v1/operations/retention/sweeps${query}`,
    headers: bearer(token),
  })
}

describe('who may read a rehearsal', () => {
  it('lets a platform admin read it', async () => {
    const harness = await withSweeps([sweep()])

    const response = await listSweeps(harness)

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toHaveLength(1)
  })

  it('refuses an organisation owner, the strongest actor an organisation has', async () => {
    // The property that matters: there is no seniority inside an organisation
    // that reaches a platform-wide retention figure. If an owner can, the
    // capability has stopped being platform-only.
    const harness = await withSweeps([sweep()])
    const token = await signIn(harness.app, 'owner@rangoli.example')

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/operations/retention/sweeps',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)
  })

  it('refuses an unauthenticated caller', async () => {
    const harness = await withSweeps([sweep()])

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/operations/retention/sweeps',
    })

    expect(response.statusCode).toBe(401)
  })
})

describe('what the payload says, and what it withholds', () => {
  it('never carries the worker process that ran the sweep', async () => {
    // `leaseOwner` is infrastructure a reader cannot act on and an attacker
    // would rather have. The presenter names fields one by one so a column
    // added later cannot arrive here by accident.
    const harness = await withSweeps([sweep()])

    const [row] = (await listSweeps(harness)).json().data

    expect(row.leaseOwner).toBeUndefined()
    expect(row.leaseExpiresAt).toBeUndefined()
    expect(JSON.stringify(row)).not.toMatch(/worker-4711/u)
  })

  it('labels every row PROPOSED, including a class it does not recognise', async () => {
    // The fallback matters more than the happy path: an unrecognised class name
    // is still an unapproved duration, and answering "no status" for one would
    // be the single way a number could reach a reader unlabelled.
    const harness = await withSweeps([sweep(), sweep({ retentionClass: 'invented_later' })])

    for (const row of (await listSweeps(harness)).json().data) {
      expect(row.approval).toBe(RETENTION_APPROVAL)
      expect(row.approval).toMatch(/REQUIRES LEGAL\/PRIVACY REVIEW/u)
    }
  })

  it('reports affectedCount 0 on every dry run', async () => {
    const harness = await withSweeps([sweep(), sweep({ retentionClass: 'session' })])

    for (const row of (await listSweeps(harness)).json().data) {
      expect(row.mode).toBe('DRY_RUN')
      expect(row.affectedCount).toBe(0)
    }
  })

  it('names the classes no sweep evaluates, even when the list is empty', async () => {
    // An empty page still has to say which classes nobody sweeps; otherwise a
    // filtered view reads as full coverage.
    const harness = await withSweeps([])

    const body = (await listSweeps(harness)).json()

    expect(body.data).toHaveLength(0)
    expect(body.notEvaluated.map((entry) => entry.retentionClass)).toContain('export_artifact')
    for (const entry of body.notEvaluated) expect(entry.approval).toBe(RETENTION_APPROVAL)
  })

  it('serves the reason verbatim, so the string is operator-visible and not decoration', () => {
    // Written because the coupling did not exist, and its absence had a cost.
    //
    // `RETENTION_NOT_EVALUATED[0].reason` is the sentence the `/retention`
    // screen prints beside a class it does not sweep. It said that nothing in
    // this repository had ever written an `ExportArtifact` row — true when it
    // was written, false a few commits later when the export register landed
    // and both CSV routes began recording one. It was wrong in front of
    // operators for as long as it took somebody to read it against the code,
    // and no test anywhere connected the string to a reader: the web test mocks
    // the API and hardcodes its own fixture, and the API cases asserted
    // `retentionClass` and `approval` and never looked at `reason`.
    //
    // This is that connection. It does not judge the wording — a test that
    // restated the sentence would just be the same claim written twice — it
    // asserts that whatever the shared vocabulary says is exactly what the
    // route serves, so there is one place to correct rather than two.
    const [source] = RETENTION_NOT_EVALUATED

    expect(typeof source.reason).toBe('string')
    expect(source.reason.length).toBeGreaterThan(80)
    // The one thing it may not say again.
    expect(source.reason).not.toMatch(/has ever written an ExportArtifact row/u)

    return withSweeps([]).then((harness) =>
      listSweeps(harness).then((response) => {
        const [served] = response.json().notEvaluated

        expect(served.retentionClass).toBe(source.retentionClass)
        expect(served.reason).toBe(source.reason)
      }),
    )
  })

  it('distinguishes a refusal from a silence', async () => {
    // SKIPPED_DISABLED is the worker saying, at a recorded instant, that it was
    // told not to run. An empty list means no rehearsal has ever happened here.
    // A reader has to be able to tell those apart.
    const harness = await withSweeps([sweep({ state: 'SKIPPED_DISABLED', examinedCount: 0 })])

    const [row] = (await listSweeps(harness)).json().data

    expect(row.state).toBe('SKIPPED_DISABLED')
    expect(row.examinedCount).toBe(0)
  })
})

describe('filters', () => {
  it('narrows to one class', async () => {
    const harness = await withSweeps([sweep(), sweep({ retentionClass: 'session' })])

    const body = (await listSweeps(harness, '?retentionClass=session')).json()

    expect(body.data).toHaveLength(1)
    expect(body.data[0].retentionClass).toBe('session')
  })

  it('narrows to one state', async () => {
    const harness = await withSweeps([sweep(), sweep({ state: 'SKIPPED_DISABLED' })])

    const body = (await listSweeps(harness, '?state=SKIPPED_DISABLED')).json()

    expect(body.data).toHaveLength(1)
    expect(body.data[0].state).toBe('SKIPPED_DISABLED')
  })

  it('rejects a state outside the vocabulary rather than ignoring it', async () => {
    const harness = await withSweeps([sweep()])

    expect((await listSweeps(harness, '?state=DELETED_EVERYTHING')).statusCode).toBe(400)
  })
})

describe('the API cannot start or execute a sweep', () => {
  it('exposes no route that runs, activates or executes retention', () => {
    // Asserted against the whole contract rather than this module, because the
    // claim is about the API rather than about one file. Initiation lives in
    // the worker, where it cannot be reached over HTTP.
    const retention = apiRoutes.filter((route) => route.path.includes('/retention'))

    expect(retention).toHaveLength(1)
    expect(retention[0].method).toBe('GET')
    for (const route of apiRoutes) {
      expect(route.path).not.toMatch(/retention.*(run|execute|activate|sweep\/start)/u)
    }
  })

  it('declares the platform-only capability rather than an organisation one', () => {
    const route = apiRoutes.find((entry) => entry.id === 'retention.listSweeps')

    expect(route.capability).toBe('retention:view')
    // No scope: an organisation-scoped assertion would ask the wrong question
    // of a table that has no organisation.
    expect(route.capabilityScope).toBeUndefined()
  })
})
