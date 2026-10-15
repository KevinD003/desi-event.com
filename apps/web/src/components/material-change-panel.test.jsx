import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { MaterialChangePanel, materialChangeLines, materialDiff, materialProblems } =
  await import('./material-change-panel.jsx')

/** The saved form values of a public event. */
const baseline = {
  timezone: 'America/New_York',
  startsAt: '2027-10-04T23:00:00.000Z',
  endsAt: '2027-10-05T03:00:00.000Z',
  venueId: 'vnhall',
  isOnline: false,
  onlineUrl: '',
  ageRestriction: '',
  policyEntry: 'Doors at seven.',
  policyRefund: 'Refundable until 48 hours before.',
  policyConduct: '',
  policyAgeNote: '',
}

const venues = [
  { id: 'vnhall', name: 'Lamplight Expo Hall', city: 'Edison' },
  { id: 'vnpark', name: 'Riverside Pavilion', city: 'Hoboken' },
]

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

beforeEach(() => {
  apiFetch.mockReset()
})

describe('what a material change sends', () => {
  it('names only the fields that changed, however an instant is written', () => {
    expect(materialDiff(baseline, { ...baseline, startsAt: '2027-10-04T23:00:00Z' })).toEqual({})
    expect(materialDiff(baseline, { ...baseline, venueId: 'vnpark' })).toEqual({
      venueId: 'vnpark',
    })
  })

  it('sends the whole policies object when one policy changes', () => {
    expect(materialDiff(baseline, { ...baseline, policyConduct: 'Be kind.' })).toEqual({
      policies: {
        entry: 'Doors at seven.',
        refund: 'Refundable until 48 hours before.',
        conduct: 'Be kind.',
        ageNote: null,
      },
    })
  })

  it('moving online changes the venue, the online flag and the link together', () => {
    expect(
      Object.keys(
        materialDiff(baseline, {
          ...baseline,
          isOnline: true,
          onlineUrl: 'https://meet.example/x',
        }),
      ),
    ).toEqual(['venueId', 'isOnline', 'onlineUrl'])
  })
})

describe('what a material change refuses before sending', () => {
  it('wants a reason, a tick, a link for an online event, and keeps the terms', () => {
    const problems = materialProblems(
      baseline,
      { ...baseline, isOnline: true, onlineUrl: '', policyEntry: '', policyRefund: '' },
      ' ',
      false,
    )

    expect(problems.map((problem) => problem.field)).toEqual([
      'onlineUrl',
      'policyRefund',
      'changeReason',
      'confirm',
    ])
  })
})

describe('the panel', () => {
  it('says there is nothing to save when nothing changed, and sends nothing', async () => {
    const user = userEvent.setup()

    render(
      <MaterialChangePanel
        event={{ id: 'evtlive' }}
        baseline={baseline}
        revision={4}
        venues={venues}
        onSaved={vi.fn()}
        onConflict={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Change date, place or terms' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Save the change' }))

    expect(screen.getByText('Nothing has changed.')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sends the venue change with the revision, confirmation and reason', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()

    apiFetch.mockResolvedValue(answer(200, { data: { id: 'evtlive', revision: 5 } }))
    render(
      <MaterialChangePanel
        event={{ id: 'evtlive' }}
        baseline={baseline}
        revision={4}
        venues={venues}
        onSaved={onSaved}
        onConflict={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await user.selectOptions(screen.getByLabelText(/^Venue/), 'vnpark')

    expect(screen.getByText('You are changing: the venue.')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/^Why this is changing/), 'The hall flooded.')
    await user.click(screen.getByRole('checkbox', { name: /I understand this changes/ }))
    await user.click(screen.getByRole('button', { name: 'Save the change' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'evtlive', revision: 5 }))

    const [path, init] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/events/evtlive')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({
      venueId: 'vnpark',
      revision: 4,
      confirmMaterialChange: true,
      changeReason: 'The hall flooded.',
    })
  })

  it('ties an unticked box to its error, and the summary link lands on the box itself', async () => {
    const user = userEvent.setup()

    render(
      <MaterialChangePanel
        event={{ id: 'evtlive' }}
        baseline={baseline}
        revision={4}
        venues={venues}
        onSaved={vi.fn()}
        onConflict={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const box = screen.getByRole('checkbox', { name: /I understand this changes/ })

    expect(box).not.toHaveAttribute('aria-invalid')

    await user.selectOptions(screen.getByLabelText(/^Venue/), 'vnpark')
    await user.type(screen.getByLabelText(/^Why this is changing/), 'The hall flooded.')
    await user.click(screen.getByRole('button', { name: 'Save the change' }))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription('Tick the box to confirm the change.')

    const link = screen.getByRole('link', { name: 'Tick the box to confirm the change.' })

    expect(link).toHaveAttribute('href', '#material-confirm')
    expect(document.getElementById('material-confirm')).toBe(box)
  })

  it('hands a stale revision back to the editor, and shows any other refusal', async () => {
    const user = userEvent.setup()
    const onConflict = vi.fn()

    apiFetch
      .mockResolvedValueOnce(
        answer(422, {
          error: {
            code: 'UNPROCESSABLE',
            message: 'That change was refused.',
            problems: ['A published online event needs its joining link.'],
          },
        }),
      )
      .mockResolvedValueOnce(
        answer(409, { error: { code: 'STALE_REVISION', message: 'Somebody saved first.' } }),
      )

    render(
      <MaterialChangePanel
        event={{ id: 'evtlive' }}
        baseline={baseline}
        revision={4}
        venues={venues}
        onSaved={vi.fn()}
        onConflict={onConflict}
        onCancel={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText(/^Minimum age/), '21')
    await user.type(screen.getByLabelText(/^Why this is changing/), 'Licence.')
    await user.click(screen.getByRole('checkbox', { name: /I understand this changes/ }))
    await user.click(screen.getByRole('button', { name: 'Save the change' }))

    expect(
      await screen.findByText('A published online event needs its joining link.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save the change' }))

    await waitFor(() => expect(onConflict).toHaveBeenCalledWith('Somebody saved first.'))
  })
})

describe('confirming a change made in the editor’s steps', () => {
  const proposed = {
    ...baseline,
    startsAt: '2027-10-11T23:00:00.000Z',
    endsAt: '2027-10-12T03:00:00.000Z',
    venueId: 'vnpark',
    policyConduct: 'Be kind.',
  }

  it('reads each change before and after, naming the venue and the policy, not quoting it', () => {
    const lines = materialChangeLines(baseline, proposed, venues)

    expect(lines.map((line) => line.field)).toEqual(['startsAt', 'endsAt', 'venueId', 'policies'])
    expect(lines[0].before).toMatch(/Oct 4, 2027, 7:00\s?PM/)
    expect(lines[0].after).toMatch(/Oct 11, 2027, 7:00\s?PM/)
    expect(lines[2]).toMatchObject({
      before: 'Lamplight Expo Hall, Edison',
      after: 'Riverside Pavilion, Hoboken',
    })
    expect(lines[3].after).toBe('new wording for house rules')
  })

  it('shows the changes, asks only for the reason and the tick, and sends what the steps hold', async () => {
    const onSaved = vi.fn()

    apiFetch.mockResolvedValueOnce(answer(200, { data: { id: 'ev1', revision: 5 } }))
    const user = userEvent.setup()

    render(
      <MaterialChangePanel
        event={{ id: 'ev1' }}
        baseline={baseline}
        proposed={proposed}
        revision={4}
        venues={venues}
        onSaved={onSaved}
        onConflict={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Confirm the change to the date, place or terms' }),
    ).toHaveFocus()
    expect(screen.getByText(/Riverside Pavilion, Hoboken/)).toBeVisible()
    // The boxes are the editor's, not the panel's.
    expect(screen.queryByLabelText(/^Starts/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Venue')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Why this is changing/), 'The hall double-booked us.')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Confirm and save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'ev1', revision: 5 }))

    const body = JSON.parse(apiFetch.mock.calls[0][1].body)

    expect(body).toMatchObject({
      startsAt: '2027-10-11T23:00:00.000Z',
      endsAt: '2027-10-12T03:00:00.000Z',
      venueId: 'vnpark',
      revision: 4,
      confirmMaterialChange: true,
      changeReason: 'The hall double-booked us.',
    })
    expect(body.policies.conduct).toBe('Be kind.')
  })

  it('asks for the second factor when the server does, and sends the same change again', async () => {
    const onSaved = vi.fn()

    apiFetch.mockImplementation(async (path) => {
      if (path === '/v1/auth/step-up') return answer(200, { data: {} })

      return apiFetch.mock.calls.filter(([called]) => called === '/v1/events/ev1').length === 1
        ? answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Again.' } })
        : answer(200, { data: { id: 'ev1', revision: 5 } })
    })
    const user = userEvent.setup()

    render(
      <MaterialChangePanel
        event={{ id: 'ev1' }}
        baseline={baseline}
        proposed={proposed}
        revision={4}
        venues={venues}
        onSaved={onSaved}
        onConflict={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText(/Why this is changing/), 'The hall double-booked us.')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Confirm and save' }))
    await user.type(await screen.findByLabelText(/Your password/), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})
