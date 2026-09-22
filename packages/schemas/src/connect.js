/**
 * The mock connected-account lifecycle: the actions, the legal moves, and what
 * each state does *not* mean.
 *
 * Shared rather than API-local for the reason the retention vocabulary is
 * shared: the API decides whether a move is legal, and the organiser screen
 * describes the result. A copy in each would be two copies that drift, and the
 * first symptom of the drift would be a screen naming a state the server does
 * not have — or worse, naming it in language the server would never have used.
 *
 * Three things are deliberately absent.
 *
 * There is no Prisma here, no model name and no `where` clause. This module is
 * the vocabulary; the thing that knows how to write a row lives in the API. A
 * module holding both would be one bad edit away from being able to mutate an
 * account.
 *
 * There is no state vocabulary of its own. The states are the persisted
 * `ConnectOnboardingStatus` enum, unchanged, because a parallel `MOCK_*` set
 * would need a migration to store and would then have to be mapped back to the
 * real one anyway — two vocabularies for one column. What marks a row as a
 * simulation is `providerMode: 'mock'` on the row itself and a
 * server-authoritative `simulated` flag on the wire, not a second spelling of
 * the state.
 *
 * And there is no wording that could be read as a claim about a real provider.
 * {@link CONNECT_STATE_DISCLAIMERS} exists because the states have names a
 * reader already has expectations about: somebody who sees `COMPLETE` beside a
 * payout figure will assume an account was verified somewhere. Every state
 * therefore carries, in this module rather than in a template, the sentence
 * saying what it is not. {@link FORBIDDEN_LIFECYCLE_PHRASES} is the machine-
 * readable half of the same rule, so "no wording that implies verification" is
 * a test rather than a habit.
 *
 * @module @desi-event/schemas/connect
 */

import { z } from 'zod'

/**
 * What every state in this module means about a real payment provider.
 *
 * Attached to the vocabulary rather than stated once in a document, so the
 * qualifier travels with the value the way {@link RETENTION_APPROVAL} travels
 * with a duration. A state that reaches a screen without this beside it is a
 * state somebody will eventually read as provider truth.
 */
export const CONNECT_SIMULATION_NOTICE =
  'Simulated in this deployment. No payment provider was contacted and no provider account exists.'

/**
 * The persisted states, in lifecycle order.
 *
 * Mirrors `ConnectOnboardingStatus` in `packages/db/prisma/schema.prisma` and
 * `CONNECT_ONBOARDING_STATUSES` in `./enums.js`. Repeated here in lifecycle
 * order rather than imported in schema order, because the ordering is what the
 * screen renders a progression from and alphabetical order is not that.
 *
 * @type {ReadonlyArray<string>}
 */
export const CONNECT_STATES = Object.freeze([
  'NOT_STARTED',
  'IN_PROGRESS',
  'REQUIREMENTS_DUE',
  'COMPLETE',
  'DISABLED',
])

/**
 * The actions a caller may name.
 *
 * Closed, and closed is the point: the caller names an *action*, the server
 * looks up what that action does from the row it reads, and a state string in a
 * request body is never consulted. The vocabulary maps one-to-one onto
 * destination states, so this is not by itself a guarantee that a caller cannot
 * ask for `COMPLETE` — see {@link CONNECT_TRANSITIONS} for the part that is.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CONNECT_ACTIONS = Object.freeze({
  START: 'START',
  SIMULATE_REQUIREMENTS: 'SIMULATE_REQUIREMENTS',
  SIMULATE_READY: 'SIMULATE_READY',
  SIMULATE_DISABLE: 'SIMULATE_DISABLE',
})

/** {@link CONNECT_ACTIONS} as a list. @type {ReadonlyArray<string>} */
export const CONNECT_ACTION_VALUES = Object.freeze(Object.values(CONNECT_ACTIONS))

/** {@link CONNECT_ACTION_VALUES} as a Zod enum, for a request body. */
export const connectActionSchema = z.enum([...CONNECT_ACTION_VALUES])

/**
 * Every legal move, as `from → action → to`.
 *
 * A pair absent from this table is refused. Two absences are deliberate and
 * worth naming, because both look like omissions:
 *
 * `DISABLED` has no outbound row. Re-onboarding a disabled account is a
 * real-provider concern with real-provider rules, and a mock path for it would
 * be inventing the rules. It is terminal here, and terminal is a narrower claim
 * than "cannot be re-enabled ever".
 *
 * `START` appears once, from `NOT_STARTED`. A `START` against a row that
 * already exists is a replay, not a transition: it returns the row unchanged.
 * That is a different thing from a refusal, and the API distinguishes them.
 *
 * @type {ReadonlyArray<object>}
 */
export const CONNECT_TRANSITIONS = Object.freeze([
  Object.freeze({ from: 'NOT_STARTED', action: 'START', to: 'IN_PROGRESS' }),
  Object.freeze({ from: 'IN_PROGRESS', action: 'SIMULATE_REQUIREMENTS', to: 'REQUIREMENTS_DUE' }),
  Object.freeze({ from: 'IN_PROGRESS', action: 'SIMULATE_READY', to: 'COMPLETE' }),
  Object.freeze({ from: 'REQUIREMENTS_DUE', action: 'SIMULATE_READY', to: 'COMPLETE' }),
  Object.freeze({ from: 'IN_PROGRESS', action: 'SIMULATE_DISABLE', to: 'DISABLED' }),
  Object.freeze({ from: 'REQUIREMENTS_DUE', action: 'SIMULATE_DISABLE', to: 'DISABLED' }),
  Object.freeze({ from: 'COMPLETE', action: 'SIMULATE_DISABLE', to: 'DISABLED' }),
])

/**
 * The state a move lands on, or `null` when the pair is not in the table.
 *
 * @param {string} from The state the row is in.
 * @param {string} action One of {@link CONNECT_ACTIONS}.
 * @returns {(string|null)} The destination state, or `null` when the move is illegal.
 */
export function connectDestination(from, action) {
  const row = CONNECT_TRANSITIONS.find(
    (transition) => transition.from === from && transition.action === action,
  )

  return row ? row.to : null
}

/**
 * Whether a state has any legal move out of it.
 *
 * @param {string} state One of {@link CONNECT_STATES}.
 * @returns {boolean} True when no transition leaves this state.
 */
export function isTerminalConnectState(state) {
  return !CONNECT_TRANSITIONS.some((transition) => transition.from === state)
}

/**
 * The two capability flags, derived from the state and never stored independently.
 *
 * Derived rather than settable because the alternative is a row that can say
 * "payouts enabled" in a state that does not mean that, and a simulation
 * allowed to make that claim is the one outcome this whole surface exists to
 * prevent. `COMPLETE` implies both; every other state implies neither.
 *
 * The names are the column names, so the derivation is checkable against the
 * row. What they mean here is narrower than what they would mean against a real
 * provider: this is the simulation's own opinion of itself, which is why
 * `simulated` travels beside them on the wire and why nothing on the payout path
 * reads either one.
 *
 * @param {string} state One of {@link CONNECT_STATES}.
 * @returns {{chargesEnabled: boolean, payoutsEnabled: boolean}} The derived pair.
 */
export function connectCapabilityFlags(state) {
  const complete = state === 'COMPLETE'

  return { chargesEnabled: complete, payoutsEnabled: complete }
}

/**
 * What each state does **not** mean.
 *
 * One entry per state, and the wording is the product's, not a paraphrase of
 * it: these strings reach an organiser. They exist because `COMPLETE` and
 * `REQUIREMENTS_DUE` are borrowed words — a reader who has used a payment
 * dashboard arrives with expectations that are wrong here, and the correction
 * has to be in the same sentence as the state, not in a footnote.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CONNECT_STATE_DISCLAIMERS = Object.freeze({
  NOT_STARTED:
    'Nothing has been simulated yet. No payment provider has been contacted and no provider account exists.',
  IN_PROGRESS:
    'A simulated setup is under way in this deployment only. No payment provider has been contacted, no provider account exists, and nothing has been submitted anywhere.',
  REQUIREMENTS_DUE:
    'A simulated outstanding-requirement state. Nothing is genuinely outstanding with any payment provider, because no payment provider has been contacted and no provider account exists.',
  COMPLETE:
    'The simulation has reached its final step. Nothing has been verified by anybody: no payment provider has been contacted, no provider account exists, no identity or business checks have been carried out, and this deployment cannot accept payments or send payouts.',
  DISABLED:
    'A simulated disabled state, and the last one this deployment offers. No payment provider has been contacted, no provider account exists, and nothing was disabled anywhere outside this deployment.',
})

/**
 * The disclaimer for a state, falling back rather than returning undefined.
 *
 * A screen that renders `undefined` where the qualifier belongs is a screen
 * showing a bare state name, which is the failure this vocabulary exists to
 * prevent. The fallback is the general notice, which is true of every state.
 *
 * @param {string} state One of {@link CONNECT_STATES}.
 * @returns {string} The disclaimer, or {@link CONNECT_SIMULATION_NOTICE}.
 */
export function connectStateDisclaimer(state) {
  return CONNECT_STATE_DISCLAIMERS[state] ?? CONNECT_SIMULATION_NOTICE
}

/**
 * Audit actions, closed.
 *
 * Closed for the reason the retention failure codes are closed: an audit row
 * whose action is free text is an audit row nobody can query, and the first
 * person to need one will be reconstructing an incident.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CONNECT_AUDIT_ACTIONS = Object.freeze({
  MOCK_ACCOUNT_CREATED: 'connect.mock_account_created',
  MOCK_STATE_ADVANCED: 'connect.mock_state_advanced',
  MOCK_ACTION_REFUSED: 'connect.mock_action_refused',
  MOCK_START_REPLAYED: 'connect.mock_start_replayed',
})

/** {@link CONNECT_AUDIT_ACTIONS} as a list. @type {ReadonlyArray<string>} */
export const CONNECT_AUDIT_ACTION_VALUES = Object.freeze(Object.values(CONNECT_AUDIT_ACTIONS))

/**
 * Why an action was refused, closed.
 *
 * The browser never supplies one of these and never supplies free text beside
 * one. The server picks the code from what it found, which is what makes the
 * audit trail answer "why" without carrying anything a caller wrote.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CONNECT_REFUSAL_REASONS = Object.freeze({
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  TERMINAL_STATE: 'TERMINAL_STATE',
  CONCURRENT_CHANGE: 'CONCURRENT_CHANGE',
  NOT_MOCK_MODE: 'NOT_MOCK_MODE',
})

/** {@link CONNECT_REFUSAL_REASONS} as a list. @type {ReadonlyArray<string>} */
export const CONNECT_REFUSAL_REASON_VALUES = Object.freeze(Object.values(CONNECT_REFUSAL_REASONS))

/**
 * What each refusal means, for an operator reading evidence rather than a
 * caller reading an error.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CONNECT_REFUSAL_DESCRIPTIONS = Object.freeze({
  ILLEGAL_TRANSITION: 'The action is not one the account can take from the state it was in.',
  TERMINAL_STATE: 'The account is in a state this deployment does not move out of.',
  CONCURRENT_CHANGE:
    'Another request changed the account between the state this one read and the state it tried to write.',
  NOT_MOCK_MODE:
    'The deployment is not running the in-memory mock, and this surface only simulates.',
})

/**
 * A refusal's description, falling back rather than returning undefined.
 *
 * @param {string} reason One of {@link CONNECT_REFUSAL_REASONS}.
 * @returns {string} The description, or a generic one naming the unknown code.
 */
export function connectRefusalDescription(reason) {
  return (
    CONNECT_REFUSAL_DESCRIPTIONS[reason] ??
    'The action was refused for a reason this deployment does not have a description for.'
  )
}

/**
 * The prefix every simulated provider account identifier carries.
 *
 * `mockacct_` and not `acct_`, which is Stripe's shape. The rule is here rather
 * than at the one call site because it is also what a test asserts and what a
 * reviewer greps for: an identifier that could be mistaken for a real provider's
 * is an identifier somebody will eventually paste into a real dashboard.
 */
export const MOCK_CONNECT_ACCOUNT_PREFIX = 'mockacct_'

/**
 * The `providerMode` a simulated row carries, written explicitly and never left
 * to the column default.
 *
 * The column defaults to `"test"`, which reads as a real provider's *test mode*
 * — an account that exists somewhere, with a real dashboard behind it. A writer
 * that merely omits the field therefore produces exactly the row this surface
 * must never produce, which is why the value has a name here and an assertion
 * against it.
 */
export const MOCK_CONNECT_PROVIDER_MODE = 'mock'

/**
 * Wording that must never appear on this surface.
 *
 * Every phrase here is one a reader would take as a claim about a real payment
 * provider, a real verification, or a real ability to move money. Listed as
 * patterns rather than prose so that "we do not imply verification" is something
 * a test can check on every string this surface ships.
 *
 * @type {ReadonlyArray<RegExp>}
 */
export const FORBIDDEN_LIFECYCLE_PHRASES = Object.freeze([
  /stripe\s+verified/iu,
  /provider\s+verified/iu,
  /kyc\s+complete/iu,
  /payouts?\s+enabled/iu,
  /live\s+account/iu,
  /live\s+onboarding/iu,
  /real\s+onboarding\s+link/iu,
  /real\s+account\s+created/iu,
])

/**
 * The forbidden phrases a string contains.
 *
 * Returns the matches rather than a boolean so a failing test can say which
 * phrase it found, which is the difference between a useful failure and
 * "expected false to be true".
 *
 * @param {string} text Any string this surface would ship.
 * @returns {string[]} The matched phrases, empty when the text is clean.
 */
export function forbiddenLifecyclePhrasesIn(text) {
  const subject = typeof text === 'string' ? text : ''

  return FORBIDDEN_LIFECYCLE_PHRASES.filter((pattern) => pattern.test(subject)).map((pattern) =>
    String(pattern),
  )
}
