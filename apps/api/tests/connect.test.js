/**
 * The simulated connected-account surface: who may reach it, what it says, and
 * what it refuses to say.
 *
 * The lifecycle itself is proved against real PostgreSQL in
 * `./connect-lifecycle-integration.test.js`, because compare-and-set and a
 * unique constraint are claims about a database. What is proved here is the
 * other half: the capability and step-up gates, the closed action vocabulary,
 * and the shape of the payload.
 *
 * That last one carries the most weight. The declared response schema is the
 * only allow list on this surface — Fastify serialises against it, so a field
 * the handler adds and the schema does not name simply does not leave — and the
 * fields it deliberately omits are omitted for reasons a reader cannot infer
 * from the code. So they are asserted by name, in the negative, here.
 */

import {
  CONNECT_ACTIONS,
  CONNECT_STATES,
  PAYMENT_MODES,
  forbiddenLifecyclePhrasesIn,
} from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

/** The one fixture account holding `connect:manage`: OWNER inherits it. */
const OWNER = 'owner@rangoli.example'

/** Holds the organisation but not this capability — separation of duties. */
const MANAGER = 'arun@rangoli.example'

/** OWNER of a different organisation entirely. */
const OUTSIDER = 'rival@dhol.example'

/**
 * Sign in and step up, returning headers a gated route will accept.
 *
 * Through the challenge rather than around it: a test that went around it would
 * be testing a system nobody runs.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email Which fixture account.
 * @returns {Promise<Record<string, string>>} Authenticated, stepped-up headers.
 */
async function authorized(app, email) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * Age every session's second factor past any step-up window.
 *
 * Signing in *is* a step-up here: `sessions.js:258` sets `mfaSatisfiedAt` when
 * the sign-in presented a factor, and every fixture account that holds
 * `connect:manage` is privileged enough to be required one. So a test about an
 * expired window has to move the clock rather than simply not step up — which is
 * also why the organiser screen's ordinary first state is a fresh window and not
 * a refusal.
 *
 * @param {object} prisma The stub client.
 * @returns {void} Nothing.
 */
function expireStepUp(prisma) {
  for (const session of prisma._store.session) {
    session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
  }
}

/**
 * Read the status for an organisation.
 *
 * @param {object} app The Fastify instance.
 * @param {string} organizationId Which organisation.
 * @param {Record<string, string>} headers Request headers.
 * @returns {Promise<object>} The injected response.
 */
function readStatus(app, organizationId, headers) {
  return app.inject({
    method: 'GET',
    url: `/v1/organizations/${organizationId}/connect`,
    headers,
  })
}

/**
 * Post an action.
 *
 * @param {object} app The Fastify instance.
 * @param {string} organizationId Which organisation.
 * @param {Record<string, string>} headers Request headers.
 * @param {unknown} action What to ask for.
 * @returns {Promise<object>} The injected response.
 */
function act(app, organizationId, headers, action) {
  return app.inject({
    method: 'POST',
    url: `/v1/organizations/${organizationId}/connect/start`,
    headers,
    payload: { action },
  })
}

describe('GET /v1/organizations/:id/connect', () => {
  it('reads NOT_STARTED for an organisation that has never simulated anything', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    const response = await readStatus(app, ids.organization.id, headers)

    expect(response.statusCode).toBe(200)
    // An absent row is an answer, not a 404: "nothing has been simulated yet".
    expect(response.json().data).toMatchObject({
      simulated: true,
      state: 'NOT_STARTED',
      accountExists: false,
      terminal: false,
      simulatedChargesEnabled: false,
      simulatedPayoutsEnabled: false,
      detailsSubmitted: false,
      requirementsDueCount: 0,
    })

    await app.close()
  })

  it('says of every state what it does not mean', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    const { data } = (await readStatus(app, ids.organization.id, headers)).json()

    expect(data.stateDescription).toMatch(/no payment provider/iu)
    expect(data.stateDescription).toMatch(/no provider account exists/iu)

    await app.close()
  })

  it('refuses a manager, who runs the organisation but may not decide where its money goes', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await readStatus(app, ids.organization.id, headers)

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses another organisation and a nonexistent one identically', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OUTSIDER)

    const theirs = await readStatus(app, ids.organization.id, headers)
    const imaginary = await readStatus(app, cuid(), headers)

    // Same status and same code, so the refusal is not an existence oracle. The
    // message names the organisation the caller themselves supplied, which tells
    // them nothing they did not already know.
    expect(theirs.statusCode).toBe(403)
    expect(imaginary.statusCode).toBe(403)
    expect(theirs.json().error.code).toBe(imaginary.json().error.code)

    await app.close()
  })

  it('refuses a caller with no token', async () => {
    const { app, ids } = await createTestApp()

    expect((await readStatus(app, ids.organization.id, {})).statusCode).toBe(401)

    await app.close()
  })

  it('refuses a malformed organisation id', async () => {
    const { app } = await createTestApp()
    const headers = await authorized(app, OWNER)

    expect((await readStatus(app, 'not-a-cuid', headers)).statusCode).toBe(400)

    await app.close()
  })

  it('refuses a caller whose step-up has gone stale', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, OWNER))

    // An hour on. The read is gated at the FINANCE_VIEW tier — fifteen minutes,
    // the same window every other finance read uses.
    expireStepUp(prisma)

    const response = await readStatus(app, ids.organization.id, headers)

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')

    await app.close()
  })
})

describe('POST /v1/organizations/:id/connect/start', () => {
  it('starts a simulation and reports IN_PROGRESS', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    const response = await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      simulated: true,
      state: 'IN_PROGRESS',
      accountExists: true,
      simulatedChargesEnabled: false,
      simulatedPayoutsEnabled: false,
    })

    await app.close()
  })

  it('writes a row that says what it is, in its own columns', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    const [row] = prisma._store.connectedAccount

    // Every one of these is a claim the row makes about itself, and each is set
    // explicitly rather than left to a column default. `providerMode` especially:
    // the column defaults to "test", which reads as a real provider's test mode.
    expect(row.providerMode).toBe('mock')
    expect(row.provider).toBe('in-memory-payments')
    expect(row.providerAccountId).toMatch(/^mockacct_/u)
    expect(row.providerAccountId).not.toMatch(/^acct_/u)
    // Null, so the repaired currency trigger keeps taking its early return for
    // every real payout this organisation schedules.
    expect(row.defaultCurrency).toBeNull()

    await app.close()
  })

  it('is idempotent: a replay returns the row unchanged rather than restarting it', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)
    await act(app, ids.organization.id, headers, CONNECT_ACTIONS.SIMULATE_READY)

    const replay = await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    // The defect an upsert would have shipped: a retried START rewriting a
    // COMPLETE row back to IN_PROGRESS while leaving its flags true.
    expect(replay.statusCode).toBe(200)
    expect(replay.json().data.state).toBe('COMPLETE')
    expect(prisma._store.connectedAccount).toHaveLength(1)

    await app.close()
  })

  it('walks the whole lifecycle and derives the flags from the state', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)
    const org = ids.organization.id

    await act(app, org, headers, CONNECT_ACTIONS.START)

    const due = await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_REQUIREMENTS)

    expect(due.json().data).toMatchObject({
      state: 'REQUIREMENTS_DUE',
      requirementsDueCount: 1,
      simulatedPayoutsEnabled: false,
    })

    const ready = await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_READY)

    expect(ready.json().data).toMatchObject({
      state: 'COMPLETE',
      simulatedChargesEnabled: true,
      simulatedPayoutsEnabled: true,
      detailsSubmitted: true,
      requirementsDueCount: 0,
    })

    const disabled = await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_DISABLE)

    expect(disabled.json().data).toMatchObject({
      state: 'DISABLED',
      terminal: true,
      // Derived, so disabling takes both back down. A row that kept them true
      // here would be claiming a capability in a state that does not mean it.
      simulatedChargesEnabled: false,
      simulatedPayoutsEnabled: false,
    })

    await app.close()
  })

  it('treats DISABLED as terminal', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)
    const org = ids.organization.id

    await act(app, org, headers, CONNECT_ACTIONS.START)
    await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_DISABLE)

    for (const action of Object.values(CONNECT_ACTIONS)) {
      const response = await act(app, org, headers, action)

      // START included: it is a replay, and a replay returns the row unchanged.
      if (action === CONNECT_ACTIONS.START) {
        expect(response.json().data.state).toBe('DISABLED')
        continue
      }

      expect(response.statusCode, action).toBe(409)
    }

    await app.close()
  })

  it('refuses an action the account cannot take from the state it is in', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)
    const org = ids.organization.id

    await act(app, org, headers, CONNECT_ACTIONS.START)

    // IN_PROGRESS has no SIMULATE_READY... it does. REQUIREMENTS_DUE has no
    // SIMULATE_REQUIREMENTS, which is the pair that is genuinely absent.
    await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_REQUIREMENTS)

    const response = await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_REQUIREMENTS)

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('refuses a simulate action against an organisation that never started one', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    const response = await act(app, ids.organization.id, headers, CONNECT_ACTIONS.SIMULATE_READY)

    // Not silently started. A SIMULATE_READY that quietly created a COMPLETE
    // account would be a request body choosing a destination state after all.
    expect(response.statusCode).toBe(409)
    expect(app.testPrisma._store.connectedAccount).toHaveLength(0)

    await app.close()
  })

  it('refuses a state name supplied where an action belongs', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    for (const state of CONNECT_STATES) {
      const response = await act(app, ids.organization.id, headers, state)

      expect(response.statusCode, state).toBe(400)
    }

    await app.close()
  })

  it('refuses free text, an absent action and a nested object', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)
    const org = ids.organization.id

    expect((await act(app, org, headers, 'start')).statusCode).toBe(400)
    expect((await act(app, org, headers, undefined)).statusCode).toBe(400)
    expect((await act(app, org, headers, { action: 'START' })).statusCode).toBe(400)

    await app.close()
  })

  it('ignores an organizationId smuggled into the body', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/connect/start`,
      headers,
      payload: { action: CONNECT_ACTIONS.START, organizationId: ids.otherOrganization.id },
    })

    // The guard reads params.id and the writer reads the same value. A guard on
    // one and a writer on the other is a cross-tenant write, which is why the
    // body schema names one field and the smuggled one is stripped.
    expect(response.statusCode).toBe(200)
    expect(app.testPrisma._store.connectedAccount[0].organizationId).toBe(ids.organization.id)

    await app.close()
  })

  it('refuses a manager', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses a caller whose step-up has gone stale', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, OWNER))

    // The action is gated at PAYOUT — five minutes, the tier every other
    // finance *action* uses, and shorter than the read's on purpose.
    expireStepUp(prisma)

    const response = await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(app.testPrisma._store.connectedAccount).toHaveLength(0)

    await app.close()
  })

  it('refuses another organisation', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OUTSIDER)

    const response = await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    expect(response.statusCode).toBe(403)
    expect(app.testPrisma._store.connectedAccount).toHaveLength(0)

    await app.close()
  })
})

describe('the two step-up tiers', () => {
  it('lets a ten-minute-old step-up read but not act', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, OWNER))

    // Ten minutes: inside FINANCE_VIEW's fifteen, past PAYOUT's five. This is
    // the whole reason the two routes carry different policies, and without this
    // case the split would be a claim in a document rather than a behaviour.
    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 10 * 60 * 1000)
    }

    const read = await readStatus(app, ids.organization.id, headers)
    const write = await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    expect(read.statusCode).toBe(200)
    expect(write.statusCode).toBe(403)
    expect(write.json().error.code).toBe('STEP_UP_REQUIRED')

    await app.close()
  })
})

describe('the payment-mode guard', () => {
  it('refuses both routes when the deployment is not the in-memory mock', async () => {
    // The same `payments` override `webhooks.test.js` uses, and for the same
    // reason: it is how a suite reaches a sandbox-mode application without
    // handing the boot gate credential-shaped environment variables. No
    // credentials are supplied here because this route reads none.
    const { app, ids } = await createTestApp({
      payments: { mode: PAYMENT_MODES.STRIPE_TEST, demo: true, live: false, label: 'SANDBOX' },
    })
    const headers = await authorized(app, OWNER)

    const read = await readStatus(app, ids.organization.id, headers)
    const write = await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    expect(read.statusCode).toBe(403)
    expect(read.json().error.code).toBe('NOT_MOCK_MODE')
    expect(write.statusCode).toBe(403)
    expect(write.json().error.code).toBe('NOT_MOCK_MODE')
    expect(app.testPrisma._store.connectedAccount).toHaveLength(0)

    await app.close()
  })

  it('refuses when the provider registry is not the in-memory adapter', async () => {
    // The second lock, and the one that matters after a real adapter is wired
    // in: the gate could still say MOCK while the registry holds something else.
    const { app, ids } = await createTestApp({
      providers: {
        payments: { name: 'some-real-adapter' },
      },
    })
    const headers = await authorized(app, OWNER)

    expect((await readStatus(app, ids.organization.id, headers)).statusCode).toBe(403)
    expect(
      (await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)).statusCode,
    ).toBe(403)

    await app.close()
  })
})

describe('what the payload does not carry', () => {
  it('names no provider identifier, mode, currency, country or disabled reason', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    const { data } = (await readStatus(app, ids.organization.id, headers)).json()
    const keys = Object.keys(data)

    for (const forbidden of [
      'providerAccountId',
      'provider',
      'providerMode',
      'defaultCurrency',
      'country',
      'disabledReason',
      'requirementsDue',
      'id',
      'organizationId',
    ]) {
      expect(keys, `${forbidden} reached the wire`).not.toContain(forbidden)
    }

    // And nothing anywhere in the serialised body, in case a value arrived
    // under a different name.
    const body = JSON.stringify(data)

    expect(body).not.toMatch(/mockacct_/u)
    expect(body).not.toMatch(/in-memory-payments/u)

    await app.close()
  })

  it('carries no wording that implies a real provider, in any state', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)
    const org = ids.organization.id
    const bodies = []

    bodies.push((await readStatus(app, org, headers)).body)

    for (const action of [
      CONNECT_ACTIONS.START,
      CONNECT_ACTIONS.SIMULATE_REQUIREMENTS,
      CONNECT_ACTIONS.SIMULATE_READY,
      CONNECT_ACTIONS.SIMULATE_DISABLE,
    ]) {
      bodies.push((await act(app, org, headers, action)).body)
    }

    for (const body of bodies) {
      expect(forbiddenLifecyclePhrasesIn(body), body).toEqual([])
      expect(body).not.toMatch(/stripe/iu)
    }

    await app.close()
  })

  it('never reports simulated false', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)
    const org = ids.organization.id

    const before = (await readStatus(app, org, headers)).json().data
    const after = (await act(app, org, headers, CONNECT_ACTIONS.START)).json().data

    expect(before.simulated).toBe(true)
    expect(after.simulated).toBe(true)

    await app.close()
  })
})

describe('the audit evidence', () => {
  it('records a creation, an advance and a refusal, each from a closed vocabulary', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)
    const org = ids.organization.id

    await act(app, org, headers, CONNECT_ACTIONS.START)
    await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_READY)
    await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_REQUIREMENTS)

    const rows = prisma._store.auditLog.filter((row) => row.action.startsWith('connect.'))

    expect(rows.map((row) => row.action)).toEqual([
      'connect.mock_account_created',
      'connect.mock_state_advanced',
      'connect.mock_action_refused',
    ])

    await app.close()
  })

  it('puts the organisation in metadata, because AuditLog has no column for it', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)

    await act(app, ids.organization.id, headers, CONNECT_ACTIONS.START)

    const [row] = prisma._store.auditLog.filter((entry) => entry.action.startsWith('connect.'))

    expect(row.entityType).toBe('ConnectedAccount')
    expect(row.metadata.organizationId).toBe(ids.organization.id)
    expect(row.metadata).toMatchObject({ simulated: true, from: 'NOT_STARTED', to: 'IN_PROGRESS' })

    await app.close()
  })

  it('carries no request body, free text, figure or identity field', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)
    const org = ids.organization.id

    await act(app, org, headers, CONNECT_ACTIONS.START)
    await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_READY)

    const rows = prisma._store.auditLog.filter((row) => row.action.startsWith('connect.'))

    expect(rows.length).toBeGreaterThan(0)

    for (const row of rows) {
      // The whole metadata shape, by name. Anything not on this list is a field
      // somebody added without deciding it was safe to keep.
      expect(Object.keys(row.metadata).sort()).toEqual([
        'actionRequested',
        'at',
        'from',
        'organizationId',
        'reason',
        'requestId',
        'simulated',
        'to',
      ])

      const serialised = JSON.stringify(row.metadata)

      expect(serialised).not.toMatch(/mockacct_/u)
      expect(serialised).not.toMatch(/@/u)
      expect(serialised).not.toMatch(/amountCents|currency|email|name|address/iu)
    }

    await app.close()
  })

  it('records a refusal reason from the closed vocabulary and nothing else', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorized(app, OWNER)
    const org = ids.organization.id

    await act(app, org, headers, CONNECT_ACTIONS.START)
    await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_DISABLE)
    await act(app, org, headers, CONNECT_ACTIONS.SIMULATE_READY)

    const refusals = prisma._store.auditLog.filter(
      (row) => row.action === 'connect.mock_action_refused',
    )

    expect(refusals).toHaveLength(1)
    expect(refusals[0].metadata.reason).toBe('TERMINAL_STATE')
    expect(refusals[0].metadata.to).toBeNull()

    await app.close()
  })
})
