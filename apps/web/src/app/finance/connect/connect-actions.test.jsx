/**
 * The simulated payout-setup actions.
 *
 * Three properties are worth a test and one of them is unusual. The first two
 * are ordinary: the buttons offered match the state, and the body sent carries
 * one field. The third is the wording — every string this component can render
 * is checked against the forbidden-phrase list, because on this surface a
 * sentence that reads as a claim about a real provider is a defect of the same
 * kind as a missing authorization check.
 *
 * Focus restoration gets its own case for the reason
 * `app/privacy/request-actions.test.jsx:295-307` has one: opening the panel
 * unmounts the triggers, so a component that held the node rather than
 * restoring by effect would silently drop focus to the document body, and a
 * keyboard user backing out of a consequential step would land at the top of
 * the page.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { ConnectActions } = await import('./connect-actions.jsx')
const { CONNECT_ACTION_BUTTONS, describeConnectRefusal } = await import(
  '../../../lib/connect-vocabulary.js'
)
const { forbiddenLifecyclePhrasesIn } = await import('@desi-event/schemas/connect')

/** The organisation these tests act in. */
const ORGANIZATION = 'org00000000000000000001'

/**
 * A response the mocked `apiFetch` will resolve with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * The body of the one call that was made, parsed.
 *
 * @returns {object} What the browser sent.
 */
function sentBody() {
  return JSON.parse(apiFetch.mock.calls[0][1].body)
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('which actions are offered', () => {
  it('offers only the start from NOT_STARTED', () => {
    render(<ConnectActions organizationId={ORGANIZATION} state="NOT_STARTED" />)

    expect(screen.getByRole('button', { name: /start the simulated setup/iu })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /switching the setup off/iu })).toBeNull()
  })

  it('offers three moves from IN_PROGRESS and never the start again', () => {
    render(<ConnectActions organizationId={ORGANIZATION} state="IN_PROGRESS" />)

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /start the simulated setup/iu })).toBeNull()
  })

  it('offers nothing at all from the last state, and says why', () => {
    render(<ConnectActions organizationId={ORGANIZATION} state="DISABLED" />)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText(/nothing moves it out of that/iu)).toBeInTheDocument()
  })
})

describe('the confirmation', () => {
  it('sends nothing until it is confirmed', async () => {
    const user = userEvent.setup()

    render(<ConnectActions organizationId={ORGANIZATION} state="NOT_STARTED" />)

    await user.click(screen.getByRole('button', { name: /start the simulated setup/iu }))

    expect(apiFetch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Record it' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
  })

  it('sends one field and nothing else', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { state: 'IN_PROGRESS' } }))

    render(<ConnectActions organizationId={ORGANIZATION} state="NOT_STARTED" />)

    await user.click(screen.getByRole('button', { name: /start the simulated setup/iu }))
    await user.click(screen.getByRole('button', { name: 'Record it' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    // No organisation id: that is in the path, where the capability guard reads
    // it. A second copy in the body is how a guard on one and a writer on the
    // other becomes a cross-tenant write.
    expect(Object.keys(sentBody())).toEqual(['action'])
    expect(sentBody().action).toBe('START')
    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/organizations/${ORGANIZATION}/connect/start`)
  })

  it('warns that the last step cannot be undone', async () => {
    const user = userEvent.setup()

    render(<ConnectActions organizationId={ORGANIZATION} state="COMPLETE" />)

    await user.click(screen.getByRole('button', { name: /switching the setup off/iu }))

    expect(screen.getByText(/cannot be restarted afterwards/iu)).toBeInTheDocument()
  })

  it('moves focus into the panel when it opens', async () => {
    const user = userEvent.setup()

    render(<ConnectActions organizationId={ORGANIZATION} state="NOT_STARTED" />)

    await user.click(screen.getByRole('button', { name: /start the simulated setup/iu }))

    await waitFor(() => expect(screen.getByRole('group')).toHaveFocus())
  })

  it('puts focus back on the trigger when the panel is dismissed', async () => {
    const user = userEvent.setup()

    render(<ConnectActions organizationId={ORGANIZATION} state="IN_PROGRESS" />)

    await user.click(screen.getByRole('button', { name: /simulate reaching the final step/iu }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    // The specific trigger, not merely "something has focus". Restoring to the
    // wrong button is as disorienting as restoring to nothing.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /simulate reaching the final step/iu })).toHaveFocus(),
    )
  })
})

describe('what it does with an answer', () => {
  it('announces success without claiming anything about a provider', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { state: 'IN_PROGRESS' } }))

    render(<ConnectActions organizationId={ORGANIZATION} state="NOT_STARTED" />)

    await user.click(screen.getByRole('button', { name: /start the simulated setup/iu }))
    await user.click(screen.getByRole('button', { name: 'Record it' }))

    const announcement = await screen.findByText(/no payment provider was contacted/iu)

    expect(announcement).toBeInTheDocument()
  })

  it('offers a step-up rather than an error when the window has lapsed', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(403, { error: { code: 'STEP_UP_REQUIRED' } }))

    render(<ConnectActions organizationId={ORGANIZATION} state="NOT_STARTED" />)

    await user.click(screen.getByRole('button', { name: /start the simulated setup/iu }))
    await user.click(screen.getByRole('button', { name: 'Record it' }))

    // The recovery, not a dead end: a lapsed window is the ordinary case on a
    // short-window action, and telling somebody "forbidden" would be wrong.
    expect(await screen.findByLabelText(/password/iu)).toBeInTheDocument()
  })

  it('reports a refused step as recoverable, in an alert', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(409, { error: { code: 'CONFLICT' } }))

    render(<ConnectActions organizationId={ORGANIZATION} state="IN_PROGRESS" />)

    await user.click(screen.getByRole('button', { name: /simulate reaching the final step/iu }))
    await user.click(screen.getByRole('button', { name: 'Record it' }))

    const alert = await screen.findByRole('alert')

    expect(alert).toHaveTextContent(/that step is not available/iu)
  })

  it('says nothing was recorded when the service does not answer', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new Error('offline'))

    render(<ConnectActions organizationId={ORGANIZATION} state="NOT_STARTED" />)

    await user.click(screen.getByRole('button', { name: /start the simulated setup/iu }))
    await user.click(screen.getByRole('button', { name: 'Record it' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing has been recorded/iu)
  })
})

describe('the wording', () => {
  it('carries no phrase that implies a real provider, anywhere it can render', () => {
    const strings = [
      ...CONNECT_ACTION_BUTTONS.flatMap((button) => [button.label, button.confirmation]),
      ...['STEP_UP_REQUIRED', 'NOT_MOCK_MODE', 'MFA_ENROLMENT_REQUIRED'].flatMap((code) => {
        const described = describeConnectRefusal({ status: 403, code })

        return [described.title, described.detail]
      }),
      ...[403, 409, 404, 500].flatMap((status) => {
        const described = describeConnectRefusal({ status })

        return [described.title, described.detail]
      }),
    ]

    for (const text of strings) {
      expect(forbiddenLifecyclePhrasesIn(text), text).toEqual([])
      expect(text, text).not.toMatch(/stripe/iu)
    }
  })

  it('says "simulated" in every button label', () => {
    for (const button of CONNECT_ACTION_BUTTONS) {
      expect(button.label, button.label).toMatch(/simulate/iu)
    }
  })

  it('denies a provider in every confirmation', () => {
    for (const button of CONNECT_ACTION_BUTTONS) {
      expect(button.confirmation, button.action).toMatch(
        /no payment provider|nothing outside this deployment|nothing is verified|deployment/iu,
      )
    }
  })
})
