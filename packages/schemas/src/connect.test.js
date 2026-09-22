/**
 * The mock connected-account vocabulary, including the parts that are wording
 * rather than logic.
 *
 * Two kinds of test live here. The ordinary kind checks the transition table
 * and the derivations. The other kind checks the *strings*, because on this
 * surface the strings are a safety control: a state name borrowed from a
 * payment dashboard carries expectations that are wrong here, and the sentence
 * correcting them is as load-bearing as the enum it sits beside. A test that
 * only checked the enum would let "Payouts enabled" ship.
 */

import { describe, expect, it } from 'vitest'

import { CONNECT_ONBOARDING_STATUSES } from './enums.js'
import {
  CONNECT_ACTIONS,
  CONNECT_ACTION_VALUES,
  CONNECT_AUDIT_ACTIONS,
  CONNECT_AUDIT_ACTION_VALUES,
  CONNECT_REFUSAL_DESCRIPTIONS,
  CONNECT_REFUSAL_REASONS,
  CONNECT_REFUSAL_REASON_VALUES,
  CONNECT_SIMULATION_NOTICE,
  CONNECT_STATES,
  CONNECT_STATE_DISCLAIMERS,
  CONNECT_TRANSITIONS,
  FORBIDDEN_LIFECYCLE_PHRASES,
  MOCK_CONNECT_ACCOUNT_PREFIX,
  MOCK_CONNECT_PROVIDER_MODE,
  connectActionSchema,
  connectCapabilityFlags,
  connectDestination,
  connectRefusalDescription,
  connectStateDisclaimer,
  forbiddenLifecyclePhrasesIn,
  isTerminalConnectState,
} from './connect.js'

describe('CONNECT_STATES', () => {
  it('is exactly the persisted enum, reordered', () => {
    // The states are the database's, not a parallel set. Compared as sets so
    // the lifecycle ordering this module adds is allowed to differ, and as
    // lengths so a state cannot be quietly dropped or invented.
    expect([...CONNECT_STATES].sort()).toEqual([...CONNECT_ONBOARDING_STATUSES].sort())
  })

  it('names no MOCK_ state', () => {
    // A parallel MOCK_* vocabulary would need a migration to store and a
    // mapping back to this one to read. What marks a row as simulated is
    // providerMode and the wire's `simulated` flag, not a second spelling.
    expect(CONNECT_STATES.filter((state) => state.startsWith('MOCK'))).toEqual([])
  })
})

describe('CONNECT_TRANSITIONS', () => {
  it('names only states and actions that exist', () => {
    for (const transition of CONNECT_TRANSITIONS) {
      expect(CONNECT_STATES).toContain(transition.from)
      expect(CONNECT_STATES).toContain(transition.to)
      expect(CONNECT_ACTION_VALUES).toContain(transition.action)
    }
  })

  it('has no duplicate from/action pair', () => {
    // Two rows for one pair would make connectDestination's answer depend on
    // array order, which is not a state machine.
    const pairs = CONNECT_TRANSITIONS.map((t) => `${t.from}/${t.action}`)

    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('never moves a state to itself', () => {
    expect(CONNECT_TRANSITIONS.filter((t) => t.from === t.to)).toEqual([])
  })

  it('offers START only from NOT_STARTED', () => {
    const starts = CONNECT_TRANSITIONS.filter((t) => t.action === CONNECT_ACTIONS.START)

    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ from: 'NOT_STARTED', to: 'IN_PROGRESS' })
  })

  it('reaches every state except NOT_STARTED', () => {
    // NOT_STARTED is where a row that does not exist reads as being, so nothing
    // transitions *to* it. Every other state must be reachable, or it is a
    // state the screen can render and the server can never produce.
    const reachable = new Set(CONNECT_TRANSITIONS.map((t) => t.to))

    for (const state of CONNECT_STATES) {
      if (state === 'NOT_STARTED') {
        expect(reachable.has(state)).toBe(false)
        continue
      }

      expect(reachable.has(state)).toBe(true)
    }
  })
})

describe('connectDestination', () => {
  it('answers for every pair in the table', () => {
    for (const transition of CONNECT_TRANSITIONS) {
      expect(connectDestination(transition.from, transition.action)).toBe(transition.to)
    }
  })

  it('refuses every pair absent from the table', () => {
    // The whole grid, minus the legal rows. This is the assertion that makes
    // "every other pair is invalid" a fact rather than a sentence in a document.
    const legal = new Set(CONNECT_TRANSITIONS.map((t) => `${t.from}/${t.action}`))
    const refused = []

    for (const from of CONNECT_STATES) {
      for (const action of CONNECT_ACTION_VALUES) {
        if (legal.has(`${from}/${action}`)) continue

        refused.push(`${from}/${action}`)
        expect(connectDestination(from, action)).toBeNull()
      }
    }

    // 5 states x 4 actions = 20 pairs, 7 of them legal.
    expect(refused).toHaveLength(13)
  })

  it('refuses a state or action it has never heard of', () => {
    expect(connectDestination('MOCK_READY', 'START')).toBeNull()
    expect(connectDestination('NOT_STARTED', 'SIMULATE_ANYTHING')).toBeNull()
    expect(connectDestination(undefined, undefined)).toBeNull()
  })
})

describe('isTerminalConnectState', () => {
  it('calls DISABLED terminal', () => {
    expect(isTerminalConnectState('DISABLED')).toBe(true)
  })

  it('calls COMPLETE non-terminal, because it can still be disabled', () => {
    expect(isTerminalConnectState('COMPLETE')).toBe(false)
  })

  it('finds exactly one terminal state', () => {
    expect(CONNECT_STATES.filter(isTerminalConnectState)).toEqual(['DISABLED'])
  })
})

describe('connectCapabilityFlags', () => {
  it('derives both true only at COMPLETE', () => {
    for (const state of CONNECT_STATES) {
      const expected = state === 'COMPLETE'

      expect(connectCapabilityFlags(state)).toEqual({
        chargesEnabled: expected,
        payoutsEnabled: expected,
      })
    }
  })

  it('derives both false for a state it does not know', () => {
    // Fails closed. An unknown state is not a reason to claim a capability.
    expect(connectCapabilityFlags('WHATEVER')).toEqual({
      chargesEnabled: false,
      payoutsEnabled: false,
    })
  })

  it('never derives the two flags independently', () => {
    // If these ever diverge the derivation has become two decisions, and one of
    // them will eventually be wrong in the direction that claims a capability.
    for (const state of [...CONNECT_STATES, 'UNKNOWN']) {
      const { chargesEnabled, payoutsEnabled } = connectCapabilityFlags(state)

      expect(chargesEnabled).toBe(payoutsEnabled)
    }
  })
})

describe('connectActionSchema', () => {
  it('accepts every action', () => {
    for (const action of CONNECT_ACTION_VALUES) {
      expect(connectActionSchema.parse(action)).toBe(action)
    }
  })

  it('refuses a state name supplied where an action belongs', () => {
    // The shape of the mistake worth refusing: a caller sending 'COMPLETE'
    // because the vocabulary maps onto destination states.
    for (const state of CONNECT_STATES) {
      expect(connectActionSchema.safeParse(state).success).toBe(false)
    }
  })

  it('refuses free text and the wrong case', () => {
    expect(connectActionSchema.safeParse('start').success).toBe(false)
    expect(connectActionSchema.safeParse('').success).toBe(false)
    expect(connectActionSchema.safeParse(null).success).toBe(false)
  })
})

describe('CONNECT_STATE_DISCLAIMERS', () => {
  it('covers every state', () => {
    expect(Object.keys(CONNECT_STATE_DISCLAIMERS).sort()).toEqual([...CONNECT_STATES].sort())
  })

  it('says of every state that no provider was contacted', () => {
    for (const state of CONNECT_STATES) {
      expect(CONNECT_STATE_DISCLAIMERS[state]).toMatch(
        /no payment provider (has been|was) contacted/iu,
      )
      expect(CONNECT_STATE_DISCLAIMERS[state]).toMatch(/no provider account exists/iu)
    }
  })

  it('carries no wording that implies a real provider', () => {
    for (const [state, text] of Object.entries(CONNECT_STATE_DISCLAIMERS)) {
      expect(forbiddenLifecyclePhrasesIn(text), `${state}: ${text}`).toEqual([])
    }
  })

  it('names Stripe nowhere', () => {
    // The mock is not a Stripe anything, and a disclaimer that says "no Stripe
    // account" invites the reading that there could have been one.
    for (const text of Object.values(CONNECT_STATE_DISCLAIMERS)) {
      expect(text).not.toMatch(/stripe/iu)
    }
  })
})

describe('connectStateDisclaimer', () => {
  it('answers for every state', () => {
    for (const state of CONNECT_STATES) {
      expect(connectStateDisclaimer(state)).toBe(CONNECT_STATE_DISCLAIMERS[state])
    }
  })

  it('falls back to the general notice rather than undefined', () => {
    // A screen rendering `undefined` where the qualifier belongs is a screen
    // showing a bare state name, which is the failure the vocabulary prevents.
    expect(connectStateDisclaimer('NOT_A_STATE')).toBe(CONNECT_SIMULATION_NOTICE)
    expect(connectStateDisclaimer(undefined)).toBe(CONNECT_SIMULATION_NOTICE)
  })
})

describe('forbiddenLifecyclePhrasesIn', () => {
  it('catches each forbidden phrase', () => {
    const samples = [
      'the account is Stripe verified',
      'provider verified this business',
      'KYC complete',
      'payouts enabled',
      'payout enabled',
      'this is a live account',
      'begin live onboarding',
      'here is your real onboarding link',
      'a real account created for you',
    ]

    for (const sample of samples) {
      expect(forbiddenLifecyclePhrasesIn(sample), sample).not.toEqual([])
    }
  })

  it('reports which phrase it found, not merely that it found one', () => {
    const found = forbiddenLifecyclePhrasesIn('KYC complete and payouts enabled')

    expect(found).toHaveLength(2)
  })

  it('tolerates a non-string without throwing', () => {
    // It runs over presenter output and rendered copy, where an absent field is
    // ordinary. Throwing would turn a missing value into a suite-wide failure.
    expect(forbiddenLifecyclePhrasesIn(undefined)).toEqual([])
    expect(forbiddenLifecyclePhrasesIn(null)).toEqual([])
    expect(forbiddenLifecyclePhrasesIn(42)).toEqual([])
  })

  it('passes wording that denies the same things', () => {
    expect(
      forbiddenLifecyclePhrasesIn(
        'No provider account exists and this deployment cannot send payouts.',
      ),
    ).toEqual([])
  })

  it('has a pattern for every phrase the brief forbids', () => {
    expect(FORBIDDEN_LIFECYCLE_PHRASES).toHaveLength(8)
  })
})

describe('the audit and refusal vocabularies', () => {
  it('namespaces every audit action under connect.', () => {
    for (const action of CONNECT_AUDIT_ACTION_VALUES) {
      expect(action).toMatch(/^connect\.[a-z_]+$/u)
    }
  })

  it('has a distinct audit action per key', () => {
    expect(new Set(CONNECT_AUDIT_ACTION_VALUES).size).toBe(CONNECT_AUDIT_ACTION_VALUES.length)
    expect(CONNECT_AUDIT_ACTION_VALUES).toHaveLength(Object.keys(CONNECT_AUDIT_ACTIONS).length)
  })

  it('describes every refusal reason', () => {
    expect(Object.keys(CONNECT_REFUSAL_DESCRIPTIONS).sort()).toEqual(
      [...CONNECT_REFUSAL_REASON_VALUES].sort(),
    )
  })

  it('describes a refusal it does not know, rather than returning undefined', () => {
    expect(connectRefusalDescription('NOPE')).toMatch(/does not have a description for/iu)
  })

  it('answers for every known reason', () => {
    for (const reason of Object.values(CONNECT_REFUSAL_REASONS)) {
      expect(connectRefusalDescription(reason)).toBe(CONNECT_REFUSAL_DESCRIPTIONS[reason])
    }
  })

  it('never describes a refusal as something having been deleted or disabled elsewhere', () => {
    // The same rule the retention failure codes carry: a refusal is a refusal,
    // and wording that suggests an external effect is wording that claims one.
    for (const text of Object.values(CONNECT_REFUSAL_DESCRIPTIONS)) {
      expect(text).not.toMatch(/deleted|revoked|cancelled at|disabled at the provider/iu)
    }
  })
})

describe('the mock row markers', () => {
  it('mints a prefix that cannot be read as a provider account id', () => {
    expect(MOCK_CONNECT_ACCOUNT_PREFIX).toBe('mockacct_')
    expect(MOCK_CONNECT_ACCOUNT_PREFIX).not.toMatch(/^acct_/u)
    expect(`${MOCK_CONNECT_ACCOUNT_PREFIX}abc`).not.toMatch(/^acct_/u)
  })

  it('names a provider mode that is not the column default', () => {
    // ConnectedAccount.providerMode defaults to "test", which reads as a real
    // provider's test mode. A writer that omits the field produces exactly the
    // row this surface must never produce, so the value is named and asserted.
    expect(MOCK_CONNECT_PROVIDER_MODE).toBe('mock')
    expect(MOCK_CONNECT_PROVIDER_MODE).not.toBe('test')
    expect(MOCK_CONNECT_PROVIDER_MODE).not.toBe('live')
  })
})
