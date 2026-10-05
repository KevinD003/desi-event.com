import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const refresh = vi.fn()

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { CANNOT_DECIDE, CHECKED_LABEL, WebsiteRedirectPanel } =
  await import('./website-redirect-panel.jsx')

const here = path.dirname(fileURLToPath(import.meta.url))

const A = 'https://rangoli.example/'
const B = 'https://rangoli-nights.example/'

/** Never decided, an address waiting. */
const WAITING = Object.freeze({
  enabled: false,
  pending: true,
  decidedUrl: null,
  submittedAt: '2026-10-01T08:30:00.000Z',
  changedAt: null,
  reason: null,
  changedByName: null,
  websiteProblem: null,
})

/** On for A. */
const ON = Object.freeze({
  ...WAITING,
  enabled: true,
  pending: false,
  decidedUrl: A,
  submittedAt: null,
  changedAt: '2026-09-30T10:00:00.000Z',
  reason: 'Checked.',
  changedByName: 'Anil Administrator',
})

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The status.
 * @param {object} body The body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * Draw the panel.
 *
 * @param {object} [props] Props to change.
 * @returns {object} The render result.
 */
function panel(props = {}) {
  return render(
    <WebsiteRedirectPanel
      eventId="evtwebsitelink01"
      websiteUrl={A}
      state={WAITING}
      pagePublic
      canDecide
      {...props}
    />,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('the website link panel', () => {
  it('names the section, shows the state, and writes every address out with a new-tab warning', () => {
    panel({ websiteUrl: B, state: { ...ON, pending: true, submittedAt: WAITING.submittedAt } })

    expect(screen.getByRole('region', { name: 'Website link' })).toHaveAttribute(
      'id',
      'website-link',
    )
    expect(screen.getByText('On')).toBeInTheDocument()
    expect(screen.getAllByText('Waiting for a decision').length).toBeGreaterThan(0)

    const current = screen.getByRole('link', { name: `${B} (opens in a new tab)` })
    const decided = screen.getByRole('link', { name: `${A} (opens in a new tab)` })

    for (const link of [current, decided]) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    }

    expect(screen.getByText('Waiting since')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve the new address' })).toBeEnabled()
  })

  it('shows a reader who may not decide no controls at all', () => {
    panel({ canDecide: false })

    expect(screen.getByText(CANNOT_DECIDE)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByLabelText(/Reason/u)).toBeNull()
  })

  it('says when there is no address, and offers nothing to turn on', () => {
    panel({ websiteUrl: null, state: { ...WAITING, pending: false, submittedAt: null } })

    expect(
      screen.getByText(
        'The organiser has not given a website address, so there is nothing to link to.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn the link on' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Turn the link off' })).toBeDisabled()
  })

  it('warns about an address that fails the rules, and will not turn it on', () => {
    panel({
      websiteUrl: 'https://rangoli.example/?token=x',
      state: { ...WAITING, websiteProblem: 'Take “token” out of the address.' },
    })

    expect(screen.getByText('This address does not pass the address rules')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn the link on' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Turn the link off' })).toBeEnabled()
  })

  it('says the link shows only while the page is public', () => {
    panel({ pagePublic: false })

    expect(
      screen.getByText('The link shows on the public page only while the event’s page is public.'),
    ).toBeInTheDocument()
  })

  it('asks for the box and a reason before turning a link on, and sends nothing without them', async () => {
    const user = userEvent.setup()

    panel()

    await user.click(screen.getByRole('button', { name: 'Turn the link on' }))

    expect(
      screen.getByText('Tick the box to say you have looked at the address.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Give a reason of at least 3 characters.')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Reason/u)).toHaveAccessibleDescription(
      'Shown to the organiser with your name, and recorded in the audit log.',
    )
  })

  it('sends the decision with the address on the screen, and announces it politely', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: {
          eventId: 'evtwebsitelink01',
          websiteUrl: A,
          websiteLink: { host: 'rangoli.example' },
          redirect: { ...ON, changedByName: 'Anil Administrator' },
        },
      }),
    )

    panel()

    await user.click(screen.getByLabelText(CHECKED_LABEL))
    await user.type(screen.getByLabelText(/Reason/u), 'Checked: their own site.')
    await user.click(screen.getByRole('button', { name: 'Turn the link on' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    const [url, options] = apiFetch.mock.calls[0]

    expect(url).toBe('/v1/moderation/events/evtwebsitelink01/website-redirect')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      enabled: true,
      reason: 'Checked: their own site.',
      websiteUrl: A,
    })

    const status = await screen.findByText('The website link is on.')

    expect(status).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(refresh).toHaveBeenCalled()
  })

  it('turns a link off with a reason only, and sends null when the screen showed no address', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: {
          eventId: 'evtwebsitelink01',
          websiteUrl: null,
          websiteLink: null,
          redirect: { ...ON, enabled: false, decidedUrl: null },
        },
      }),
    )

    panel({ websiteUrl: null, state: { ...ON, pending: true } })

    expect(screen.queryByRole('checkbox')).toBeNull()

    await user.type(screen.getByLabelText(/Reason/u), 'The organiser removed it.')
    await user.click(screen.getByRole('button', { name: 'Turn the link off' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      enabled: false,
      reason: 'The organiser removed it.',
      websiteUrl: null,
    })
    expect(await screen.findByText('The website link is off.')).toBeInTheDocument()
  })

  it('asks for a second factor when the API wants one, and sends the decision again after it', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'x' } }))
      .mockResolvedValueOnce(answer(200, { data: {} }))
      .mockResolvedValueOnce(
        answer(200, {
          data: { eventId: 'evtwebsitelink01', websiteUrl: A, websiteLink: null, redirect: ON },
        }),
      )

    panel()

    await user.click(screen.getByLabelText(CHECKED_LABEL))
    await user.type(screen.getByLabelText(/Reason/u), 'Checked: their own site.')
    await user.click(screen.getByRole('button', { name: 'Turn the link on' }))

    expect(await screen.findByText('Confirm it is you')).toBeInTheDocument()
    expect(screen.getByText(/turn this website link on/u)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/u), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))
    expect(apiFetch.mock.calls[1][0]).toBe('/v1/auth/step-up')
    expect(apiFetch.mock.calls[2][0]).toBe(
      '/v1/moderation/events/evtwebsitelink01/website-redirect',
    )
    expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toMatchObject({ enabled: true })
    expect(await screen.findByText('The website link is on.')).toBeInTheDocument()
  })

  it('says the address changed, with a way to reload', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'WEBSITE_CHANGED',
          message:
            'The organiser changed the website address after you opened this page. Reload to see the address as it is now. Nothing was changed.',
        },
      }),
    )

    panel()

    await user.click(screen.getByLabelText(CHECKED_LABEL))
    await user.type(screen.getByLabelText(/Reason/u), 'Checked.')
    await user.click(screen.getByRole('button', { name: 'Turn the link on' }))

    expect(await screen.findByText('The address changed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reload' }))

    expect(refresh).toHaveBeenCalled()
  })

  it('shows the switch as the server reads it again after a refusal and "Reload"', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'WEBSITE_REDIRECT_UNCHANGED',
          message: 'The website link is already on for this address. Nothing was changed.',
          details: { enabled: true },
        },
      }),
    )

    const view = panel()

    expect(screen.getByText('Off. No administrator has decided on this address.')).toBeVisible()

    await user.click(screen.getByLabelText(CHECKED_LABEL))
    await user.type(screen.getByLabelText(/Reason/u), 'Checked.')
    await user.click(screen.getByRole('button', { name: 'Turn the link on' }))

    expect(await screen.findByText(/already on for this address/u)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reload' }))

    expect(refresh).toHaveBeenCalled()

    // What `router.refresh()` delivers: the same panel, new props from the
    // server. Another administrator turned the link on meanwhile.
    view.rerender(
      <WebsiteRedirectPanel
        eventId="evtwebsitelink01"
        websiteUrl={A}
        state={{ ...ON, changedByName: 'Other Admin' }}
        pagePublic
        canDecide
      />,
    )

    expect(screen.getByText(/Turned on by Other Admin\./u)).toBeVisible()
    expect(screen.queryByText('Off. No administrator has decided on this address.')).toBeNull()
    expect(screen.queryByText('Waiting for a decision')).toBeNull()
    expect(screen.queryByText('Waiting since')).toBeNull()
    expect(screen.getByText('The address last decided on')).toBeVisible()
    // On for this very address: nothing to turn on, and the refusal is gone.
    expect(screen.queryByLabelText(CHECKED_LABEL)).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve the new address' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Turn the link off' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(screen.queryByText(/already on for this address/u)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Read again. The website link is on.')
  })

  it('names the address the organiser changed to, and shows it once read again', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'WEBSITE_CHANGED',
          message: 'The organiser changed the website address after you opened this page.',
          details: { currentWebsiteUrl: B },
        },
      }),
    )

    const view = panel()

    await user.click(screen.getByLabelText(CHECKED_LABEL))
    await user.type(screen.getByLabelText(/Reason/u), 'Checked.')
    await user.click(screen.getByRole('button', { name: 'Turn the link on' }))

    expect(await screen.findByText(`The address now: ${B}`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reload' }))
    view.rerender(
      <WebsiteRedirectPanel
        eventId="evtwebsitelink01"
        websiteUrl={B}
        state={{ ...WAITING, submittedAt: '2026-10-02T09:00:00.000Z' }}
        pagePublic
        canDecide
      />,
    )

    expect(screen.queryByText('The address changed')).toBeNull()
    expect(screen.getByRole('link', { name: `${B} (opens in a new tab)` })).toHaveAttribute(
      'href',
      B,
    )
    expect(screen.getByRole('button', { name: 'Turn the link on' })).toBeEnabled()
  })

  it('says so when the organiser removed the address', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'WEBSITE_CHANGED',
          message: 'The organiser changed the website address after you opened this page.',
          details: { currentWebsiteUrl: null },
        },
      }),
    )

    panel({ state: ON })

    await user.type(screen.getByLabelText(/Reason/u), 'Stopping it.')
    await user.click(screen.getByRole('button', { name: 'Turn the link off' }))

    expect(await screen.findByText('The organiser removed the address.')).toBeInTheDocument()
  })

  it('keeps its announcement when the read after a decision arrives', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: { eventId: 'evtwebsitelink01', websiteUrl: A, websiteLink: null, redirect: ON },
      }),
    )

    const view = panel()

    await user.click(screen.getByLabelText(CHECKED_LABEL))
    await user.type(screen.getByLabelText(/Reason/u), 'Checked.')
    await user.click(screen.getByRole('button', { name: 'Turn the link on' }))

    expect(await screen.findByText('The website link is on.')).toBeInTheDocument()

    view.rerender(
      <WebsiteRedirectPanel
        eventId="evtwebsitelink01"
        websiteUrl={A}
        state={{ ...ON }}
        pagePublic
        canDecide
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('The website link is on.')
    expect(screen.getByText(/Turned on by Anil Administrator\./u)).toBeVisible()
  })

  it('shows a 422’s sentence and its problems', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(422, {
        error: {
          code: 'WEBSITE_NOT_ACCEPTABLE',
          message: 'The address does not pass the address rules.',
          problems: ['Use the site’s usual address, without a port number.'],
        },
      }),
    )

    panel()

    await user.click(screen.getByLabelText(CHECKED_LABEL))
    await user.type(screen.getByLabelText(/Reason/u), 'Checked.')
    await user.click(screen.getByRole('button', { name: 'Turn the link on' }))

    expect(
      await screen.findByText('The address does not pass the address rules.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Use the site’s usual address, without a port number.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  it('names no capability: the page decides who may use it', () => {
    const source = readFileSync(path.join(here, 'website-redirect-panel.jsx'), 'utf8')

    for (const literal of [
      'website_redirect:manage',
      'platform:admin',
      'organizer:invite',
      'analytics:view_all',
    ]) {
      expect(source).not.toContain(literal)
    }
    expect(source).not.toMatch(/@desi-event\/(schemas|permissions|auth)['/]/u)
  })
})
