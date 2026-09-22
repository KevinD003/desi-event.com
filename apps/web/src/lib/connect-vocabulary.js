/**
 * How the payout-setup screen names things.
 *
 * The state names come from the database and are borrowed words: somebody who
 * has used a payment dashboard arrives at `COMPLETE` with expectations that are
 * wrong here. So this module renders none of them raw. Every label says
 * *simulated* in it, and every state carries the sentence from the shared
 * vocabulary saying what it does not mean.
 *
 * ## Why the import is a subpath
 *
 * `@desi-event/schemas/connect` and never `@desi-event/schemas`. The barrel
 * re-exports `entities.js`, `requests.js` and `responses.js`, so importing it
 * from anything a client component reaches ships every model's column names to
 * the browser — which is why `lib/browser-bundle.js` now forbids it. The
 * subpath resolves to one module that imports only zod.
 *
 * @module lib/connect-vocabulary
 */

import { CONNECT_ACTIONS, connectStateDisclaimer } from '@desi-event/schemas/connect'

/**
 * What to call each state on screen.
 *
 * Not the enum, and not a translation of it either. `COMPLETE` becomes "final
 * simulated step" rather than "complete", because "complete" is what an
 * organiser would read as "I am done and can be paid".
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CONNECT_STATE_LABELS = Object.freeze({
  NOT_STARTED: 'Not simulated yet',
  IN_PROGRESS: 'Simulated setup under way',
  REQUIREMENTS_DUE: 'Simulated outstanding requirement',
  COMPLETE: 'Final simulated step reached',
  DISABLED: 'Simulated setup switched off',
})

/**
 * A state's label, falling back to something honest rather than to the raw enum.
 *
 * @param {string} state One of the persisted states.
 * @returns {string} The label.
 */
export function connectStateLabel(state) {
  return CONNECT_STATE_LABELS[state] ?? 'Simulated state'
}

/** Re-exported so the screen has one import for its wording. */
export { connectStateDisclaimer }

/**
 * The buttons, in the order they make sense.
 *
 * `available` is a function of the state rather than a fixed list, because the
 * server is what decides legality and a button offered for an illegal move is a
 * button that produces a 409 a reader cannot have predicted. This mirrors the
 * transition table; the server still refuses independently.
 *
 * `destructive` drives nothing but the styling and the confirmation wording.
 *
 * @type {ReadonlyArray<object>}
 */
export const CONNECT_ACTION_BUTTONS = Object.freeze([
  Object.freeze({
    action: CONNECT_ACTIONS.START,
    label: 'Start the simulated setup',
    from: Object.freeze(['NOT_STARTED']),
    destructive: false,
    confirmation:
      'This records a simulated setup inside this deployment. It contacts no payment provider, creates no account anywhere, and produces no link to follow.',
  }),
  Object.freeze({
    action: CONNECT_ACTIONS.SIMULATE_REQUIREMENTS,
    label: 'Simulate an outstanding requirement',
    from: Object.freeze(['IN_PROGRESS']),
    destructive: false,
    confirmation:
      'This moves the simulation to a state that stands in for "something is outstanding". Nothing is genuinely outstanding with anybody, because no payment provider has been contacted.',
  }),
  Object.freeze({
    action: CONNECT_ACTIONS.SIMULATE_READY,
    label: 'Simulate reaching the final step',
    from: Object.freeze(['IN_PROGRESS', 'REQUIREMENTS_DUE']),
    destructive: false,
    confirmation:
      'This moves the simulation to its final step. Nothing is verified by reaching it: no payment provider has been contacted, no identity or business checks have been carried out, and this deployment still cannot accept payments or send money.',
  }),
  Object.freeze({
    action: CONNECT_ACTIONS.SIMULATE_DISABLE,
    label: 'Simulate switching the setup off',
    from: Object.freeze(['IN_PROGRESS', 'REQUIREMENTS_DUE', 'COMPLETE']),
    destructive: true,
    confirmation:
      'This is the last step the simulation offers. Nothing moves out of it in this deployment, so the simulation cannot be restarted afterwards. Nothing is switched off anywhere outside this deployment, because there is nothing outside it to switch off.',
  }),
])

/**
 * The buttons a given state should offer.
 *
 * @param {string} state One of the persisted states.
 * @returns {ReadonlyArray<object>} The available buttons.
 */
export function connectActionsFor(state) {
  return CONNECT_ACTION_BUTTONS.filter((button) => button.from.includes(state))
}

/**
 * What a refusal means, in the reader's words.
 *
 * Shaped like `privacy-vocabulary.js`'s `describeRefusal` and for the same
 * reason: over HTTP a 403 is a missing capability *or* a lapsed step-up, and a
 * 409 is an illegal move *or* a terminal state *or* somebody else having acted
 * first. A screen that collapsed them would tell the reader the wrong thing
 * three times out of four.
 *
 * @param {object|null} error An error carrying `status` and `code`.
 * @returns {{title: string, detail: string, recoverable: boolean}} What to render.
 */
export function describeConnectRefusal(error) {
  const status = error?.status ?? 0
  const code = error?.code ?? null

  if (code === 'STEP_UP_REQUIRED') {
    return {
      title: 'Confirm it is you',
      detail:
        'This needs a fresh step-up. The window is deliberately short, so it lapses quickly and has to be reopened.',
      recoverable: true,
    }
  }

  if (code === 'NOT_MOCK_MODE') {
    return {
      title: 'Not available in this deployment',
      detail:
        'This screen only ever simulates, so it is switched off wherever payments are wired to anything but the in-memory stand-in.',
      recoverable: false,
    }
  }

  if (code === 'MFA_ENROLMENT_REQUIRED') {
    return {
      title: 'A second factor is required',
      detail: 'This account has to enrol a second factor before it can reach payout settings.',
      recoverable: true,
    }
  }

  if (status === 403) {
    return {
      title: 'Not for this account',
      detail:
        'Managing payout setup is separate from running the organisation. Ask whoever handles its finances.',
      recoverable: false,
    }
  }

  if (status === 409) {
    return {
      title: 'That step is not available',
      detail:
        'The simulation is not in a state this step can be taken from — either it has moved on since this page was loaded, or it has reached the last step it offers.',
      recoverable: true,
    }
  }

  if (status === 404) {
    return {
      title: 'Nothing to show',
      detail: 'This organisation could not be read.',
      recoverable: false,
    }
  }

  return {
    title: 'The service could not answer',
    detail: 'Nothing was changed. The simulation is exactly as it was.',
    recoverable: true,
  }
}
