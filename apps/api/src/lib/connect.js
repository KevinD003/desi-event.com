/**
 * The simulated connected-account lifecycle.
 *
 * What this module is for is narrower than its name suggests. It does not talk
 * to a payment provider, it cannot, and there is nothing here that could be
 * pointed at one: no SDK, no URL, no credential read, no network call of any
 * kind. It moves a row through a small state machine and writes evidence that it
 * did. The row records, in its own columns, that it is a simulation.
 *
 * Three properties are load-bearing and each is here rather than in a route,
 * because a route is where somebody adds a second copy.
 *
 * **Starting is create-only.** The obvious shape is an upsert — one account per
 * organisation, keyed on `organizationId @unique` — and the obvious shape is
 * wrong. A Prisma upsert's update branch is unconditional, so a replayed
 * `START` against a `COMPLETE` row rewrites it to `IN_PROGRESS` while leaving
 * the derived capability flags true: an unlisted transition, a row whose flags
 * contradict its own state, and the end of `DISABLED`'s terminality, all from
 * one retried request. Putting the state in the upsert's `where` does not save
 * it either — Prisma leaves the native upsert path, attempts a create, and
 * raises `P2002`. So `START` creates, catches `P2002`, re-reads, and returns
 * what it found **unchanged**.
 *
 * **Advancing is compare-and-set.** A table of legal pairs is not a state
 * machine unless every write names the state it was read against. Without that,
 * two individually legal actions compose into a pair the table does not contain:
 * run `SIMULATE_DISABLE` and `SIMULATE_READY` concurrently against one
 * `IN_PROGRESS` row and they land on `COMPLETE`, having passed through
 * `DISABLED` and back out. `transition()` in `./payouts.js` already has the
 * right shape, so it takes a `column` parameter and this module uses it.
 *
 * **Capability flags are derived, never supplied.** `chargesEnabled` and
 * `payoutsEnabled` come from `connectCapabilityFlags()` on every write. A
 * simulation that could report a capability in a state that does not mean it is
 * the one outcome this surface exists to prevent.
 *
 * @module @desi-event/api/lib/connect
 */

import { createHash } from 'node:crypto'

import {
  CONNECT_ACTIONS,
  CONNECT_REFUSAL_REASONS,
  CONNECT_TRANSITIONS,
  MOCK_CONNECT_ACCOUNT_PREFIX,
  MOCK_CONNECT_PROVIDER_MODE,
  connectCapabilityFlags,
  connectDestination,
  connectStateDisclaimer,
  isTerminalConnectState,
} from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { conflict, forbidden, notFound } from './errors.js'
import { transition } from './payouts.js'

/** The state a row that does not exist reads as being in. */
export const CONNECT_INITIAL_STATE = 'NOT_STARTED'

/**
 * `CONNECT_TRANSITIONS` as the `from → [to]` shape `canTransition` wants.
 *
 * Derived rather than written twice. The action vocabulary is what a caller
 * names and is resolved before this table is consulted, so the table's only job
 * here is the compare-and-set's legality check — the same job it does for the
 * three payout machines.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const CONNECT_STATE_TABLE = Object.freeze(
  CONNECT_TRANSITIONS.reduce((table, row) => {
    const next = { ...table }

    next[row.from] = Object.freeze([...(table[row.from] ?? []), row.to])

    return Object.freeze(next)
  }, Object.freeze({})),
)

/**
 * The simulated provider account identifier for an organisation.
 *
 * Derived from the organisation rather than random, for two reasons that both
 * matter. A replayed create computes the same value, so a `P2002` is
 * unambiguously "this organisation already has one" rather than a collision
 * nobody can distinguish from it. And a derived value cannot accidentally be a
 * real provider's identifier, which a random string of the wrong shape could
 * eventually be.
 *
 * The prefix is `mockacct_`, never `acct_`. An identifier that could be mistaken
 * for a real provider's is an identifier somebody will eventually paste into a
 * real dashboard.
 *
 * @param {string} organizationId Whose account.
 * @returns {string} The identifier, stable for that organisation.
 */
export function mockConnectAccountId(organizationId) {
  const digest = createHash('sha256').update(`connect-mock\u0000${organizationId}`).digest('hex')

  return `${MOCK_CONNECT_ACCOUNT_PREFIX}${digest.slice(0, 24)}`
}

/**
 * Refuse unless this deployment is running the in-memory mock.
 *
 * Both halves are checked because the repository holds two independent notions
 * of payment mode that can disagree: the boot gate's resolution on
 * `app.payments`, and the provider-name sniff that `finance.js` and
 * `analytics.js` use and that reaches buyers through the money-figure wording.
 * The gate is authoritative; the provider name is the second lock, and it is
 * what stops this surface minting simulated rows after a real adapter is wired
 * in — which is the next step in the sequence this phase sits in.
 *
 * @param {object} params Inputs.
 * @param {{mode?: string}} [params.payments] The resolved payment mode.
 * @param {{payments?: {name?: string}}} [params.providers] The provider registry.
 * @returns {void} Nothing.
 * @throws {Error} 403 when either half says this is not the mock.
 */
export function assertMockConnectAvailable({ payments, providers }) {
  const mode = payments?.mode
  const name = providers?.payments?.name

  if (mode !== 'MOCK' || name !== 'in-memory-payments') {
    throw forbidden(
      'Simulated connected-account setup is only available where payments are the in-memory mock.',
      'NOT_MOCK_MODE',
    )
  }
}

/**
 * The organisation, or a 404 that does not distinguish absent from not-yours.
 *
 * The capability guard has already refused a caller without `connect:manage` in
 * this organisation, so reaching here means the caller holds it. What remains is
 * an organisation id that names nothing, and the answer to that is the same 404
 * an id naming somebody else's row would get.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} organizationId Which organisation.
 * @returns {Promise<{id: string}>} The organisation.
 * @throws {Error} 404 when there is no such organisation.
 */
export async function loadOrganizationForConnect(prisma, organizationId) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  })

  if (!organization) throw notFound('No such organisation.')

  return organization
}

/**
 * The simulated account for an organisation, or `null`.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {string} organizationId Which organisation.
 * @returns {Promise<(object|null)>} The row, or null when none exists.
 */
export function findConnectedAccount(prisma, organizationId) {
  return prisma.connectedAccount.findFirst({ where: { organizationId } })
}

/**
 * What the wire carries about a simulated account.
 *
 * An allow list written out by hand, and the absences are the point. There is no
 * `providerAccountId` — a provider-shaped identifier in a payload is a
 * provider-shaped identifier in a log, and a caller has no use for one that
 * names nothing. No `provider` or `providerMode`, which describe how this
 * deployment is wired rather than anything the organiser can act on. No
 * `defaultCurrency`, which a simulated row deliberately leaves null. No
 * `country` and no `disabledReason`, both of which would be fabricated.
 *
 * The two capability flags are renamed on the way out. They are real column
 * names, but a payload field called `payoutsEnabled` is one copy-and-paste from
 * a screen that says "Payouts enabled", which is a claim this surface must never
 * make. `simulated` is server-set and constant: a client cannot ask for it to be
 * false, and there is no branch here that could produce a payload without it.
 *
 * `requirementsDue` is reduced to a **count**. The column can hold a list, and a
 * list of outstanding requirements is a list of things a real provider would
 * want about a real person.
 *
 * @param {(object|null)} row A `ConnectedAccount`, or null when none exists.
 * @returns {object} The wire shape.
 */
export function toConnectStatus(row) {
  const state = row?.onboardingStatus ?? CONNECT_INITIAL_STATE
  const flags = connectCapabilityFlags(state)

  return {
    simulated: true,
    state,
    stateDescription: connectStateDisclaimer(state),
    terminal: isTerminalConnectState(state),
    accountExists: Boolean(row),
    simulatedChargesEnabled: flags.chargesEnabled,
    simulatedPayoutsEnabled: flags.payoutsEnabled,
    detailsSubmitted: Boolean(row?.detailsSubmitted),
    requirementsDueCount: Array.isArray(row?.requirementsDue) ? row.requirementsDue.length : 0,
    updatedAt: row?.updatedAt ?? null,
  }
}

/**
 * Write one piece of evidence about a simulated action.
 *
 * The organisation goes in `metadata` because `AuditLog` has no
 * `organizationId` column and the only migration this phase authorises is the
 * payout-trigger repair — which is also what `finance.js` already does. Nothing
 * here carries a request body, a free-text reason, a provider payload, a
 * monetary figure or an identity field: the action and the reason both come from
 * closed vocabularies, and the only identifiers are the organisation, the actor
 * and the request.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {string} params.action One of the `CONNECT_MOCK_*` members of `AUDIT_ACTIONS`.
 * @param {string} params.organizationId Whose account.
 * @param {string} params.accountId The account row, or the organisation when there is no row yet.
 * @param {(string|null)} params.actorId Who acted.
 * @param {string} params.requestId The request correlation id.
 * @param {string} params.at ISO-8601 instant.
 * @param {(string|null)} [params.from] The state read.
 * @param {(string|null)} [params.to] The state written.
 * @param {(string|null)} [params.actionRequested] The caller's action, from the closed vocabulary.
 * @param {(string|null)} [params.reason] One of `CONNECT_REFUSAL_REASONS`.
 * @returns {Promise<object>} The audit row.
 */
export function recordConnectAudit(tx, params) {
  const {
    action,
    organizationId,
    accountId,
    actorId,
    requestId,
    at,
    from = null,
    to = null,
    actionRequested = null,
    reason = null,
  } = params

  return recordAudit(tx, {
    action,
    entityType: 'ConnectedAccount',
    entityId: accountId,
    actorId,
    metadata: {
      requestId,
      at,
      organizationId,
      simulated: true,
      from,
      to,
      actionRequested,
      reason,
    },
  })
}

/**
 * Start a simulated setup, or hand back the one that already exists.
 *
 * Create-only. The `P2002` branch is the replay path and it reads the row back
 * rather than writing anything: the same answer a first call would have given,
 * so a retry is indistinguishable from a repeat, and a retry arriving at a
 * `COMPLETE` row cannot walk it backwards.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose account.
 * @param {{id: string}} params.actor Who acted.
 * @param {string} params.requestId The request correlation id.
 * @param {Date} params.now The instant to record.
 * @returns {Promise<{account: object, created: boolean, state: string}>} The row and whether this call made it.
 */
export async function startMockConnect(prisma, { organizationId, actor, requestId, now }) {
  const at = now.toISOString()
  const destination = connectDestination(CONNECT_INITIAL_STATE, CONNECT_ACTIONS.START)
  const flags = connectCapabilityFlags(destination)

  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.connectedAccount.create({
        data: {
          organizationId,
          provider: 'in-memory-payments',
          providerAccountId: mockConnectAccountId(organizationId),
          // Explicitly, never by column default. `providerMode` defaults to
          // "test", which reads as a real provider's test mode — an account that
          // exists somewhere with a dashboard behind it. Omitting the field
          // would produce exactly the row this surface must never produce.
          providerMode: MOCK_CONNECT_PROVIDER_MODE,
          // Null, and deliberately. `payouts.schedule` already stamps whatever
          // connected account it finds onto every payout it writes, and the
          // repaired `desi_payout_currency_matches` trigger compares that
          // account's currency against the payout's. A fabricated currency here
          // would refuse real payouts for any organisation whose currency
          // differed. Null is the trigger's documented "declares no currency,
          // so there is nothing to compare against" path.
          defaultCurrency: null,
          country: null,
          onboardingStatus: destination,
          chargesEnabled: flags.chargesEnabled,
          payoutsEnabled: flags.payoutsEnabled,
          detailsSubmitted: false,
          requirementsDue: [],
        },
      })

      await recordConnectAudit(tx, {
        action: AUDIT_ACTIONS.CONNECT_MOCK_ACCOUNT_CREATED,
        organizationId,
        accountId: account.id,
        actorId: actor.id,
        requestId,
        at,
        from: CONNECT_INITIAL_STATE,
        to: destination,
        actionRequested: CONNECT_ACTIONS.START,
      })

      return { account, created: true, state: account.onboardingStatus }
    })
  } catch (error) {
    if (error?.code !== 'P2002') throw error

    // The replay path. Read, do not write: this is the only place a `START`
    // could regress a later state, and it does not, because it has nothing to
    // write. The read happens outside the failed transaction, which has already
    // rolled back.
    const existing = await findConnectedAccount(prisma, organizationId)

    // Lost the race and then lost the row too — possible only if something
    // deleted it in between. Treated as a conflict rather than pretended past,
    // because the caller's request neither created nor found an account.
    if (!existing) {
      throw conflict('The simulated account could not be created or read back.', {
        reason: CONNECT_REFUSAL_REASONS.CONCURRENT_CHANGE,
      })
    }

    await prisma.$transaction((tx) =>
      recordConnectAudit(tx, {
        action: AUDIT_ACTIONS.CONNECT_MOCK_START_REPLAYED,
        organizationId,
        accountId: existing.id,
        actorId: actor.id,
        requestId,
        at,
        from: existing.onboardingStatus,
        to: existing.onboardingStatus,
        actionRequested: CONNECT_ACTIONS.START,
      }),
    )

    return { account: existing, created: false, state: existing.onboardingStatus }
  }
}

/**
 * Move a simulated account one step, conditionally on the state it was read in.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose account.
 * @param {string} params.action One of `CONNECT_ACTIONS`, not `START`.
 * @param {{id: string}} params.actor Who acted.
 * @param {string} params.requestId The request correlation id.
 * @param {Date} params.now The instant to record.
 * @returns {Promise<{account: object, created: false, state: string}>} The row as written.
 * @throws {Error} 404 with no account, 409 on an illegal or raced transition.
 */
export async function advanceMockConnect(
  prisma,
  { organizationId, action, actor, requestId, now },
) {
  const at = now.toISOString()
  const existing = await findConnectedAccount(prisma, organizationId)

  if (!existing) {
    // A simulate action against an organisation with no row. Refused rather than
    // silently starting one: the actions are not interchangeable, and a
    // `SIMULATE_READY` that quietly created a `COMPLETE` account would be a
    // request body choosing a destination state after all.
    throw conflict('There is no simulated setup to advance. Start one first.', {
      reason: CONNECT_REFUSAL_REASONS.ILLEGAL_TRANSITION,
      from: CONNECT_INITIAL_STATE,
      action,
    })
  }

  const from = existing.onboardingStatus
  const destination = connectDestination(from, action)

  if (!destination) {
    const reason = isTerminalConnectState(from)
      ? CONNECT_REFUSAL_REASONS.TERMINAL_STATE
      : CONNECT_REFUSAL_REASONS.ILLEGAL_TRANSITION

    await prisma.$transaction((tx) =>
      recordConnectAudit(tx, {
        action: AUDIT_ACTIONS.CONNECT_MOCK_ACTION_REFUSED,
        organizationId,
        accountId: existing.id,
        actorId: actor.id,
        requestId,
        at,
        from,
        to: null,
        actionRequested: action,
        reason,
      }),
    )

    throw conflict(
      isTerminalConnectState(from)
        ? 'The simulated account is in its final state and this deployment does not move out of it.'
        : 'That action is not one the simulated account can take from the state it is in.',
      { reason, from, action },
    )
  }

  const flags = connectCapabilityFlags(destination)

  const moved = await prisma.$transaction(async (tx) => {
    const applied = await transition(tx, {
      delegate: tx.connectedAccount,
      table: CONNECT_STATE_TABLE,
      row: existing,
      to: destination,
      column: 'onboardingStatus',
      label: 'simulated connected account',
      data: {
        chargesEnabled: flags.chargesEnabled,
        payoutsEnabled: flags.payoutsEnabled,
        // Set alongside the state rather than independently, so a row cannot
        // report a submission it never made. The simulation treats reaching
        // COMPLETE as the point details would have been submitted.
        detailsSubmitted: destination === 'COMPLETE',
        // A count's worth of nothing. The column can hold a list, and a list of
        // outstanding requirements is a list of things a real provider would
        // want about a real person, so the simulation records how many rather
        // than what: one placeholder at REQUIREMENTS_DUE, none anywhere else.
        requirementsDue: destination === 'REQUIREMENTS_DUE' ? ['simulated_requirement'] : [],
      },
    })

    if (!applied) return null

    await recordConnectAudit(tx, {
      action: AUDIT_ACTIONS.CONNECT_MOCK_STATE_ADVANCED,
      organizationId,
      accountId: existing.id,
      actorId: actor.id,
      requestId,
      at,
      from,
      to: destination,
      actionRequested: action,
    })

    return tx.connectedAccount.findUnique({ where: { id: existing.id } })
  })

  if (!moved) {
    // Somebody else moved the row between the read and the write. The evidence
    // is written in its own transaction, because the one above rolled back.
    await prisma.$transaction((tx) =>
      recordConnectAudit(tx, {
        action: AUDIT_ACTIONS.CONNECT_MOCK_ACTION_REFUSED,
        organizationId,
        accountId: existing.id,
        actorId: actor.id,
        requestId,
        at,
        from,
        to: null,
        actionRequested: action,
        reason: CONNECT_REFUSAL_REASONS.CONCURRENT_CHANGE,
      }),
    )

    throw conflict('The simulated account changed while this request was being handled.', {
      reason: CONNECT_REFUSAL_REASONS.CONCURRENT_CHANGE,
      from,
      action,
    })
  }

  return { account: moved, created: false, state: moved.onboardingStatus }
}
