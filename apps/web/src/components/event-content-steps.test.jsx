import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { GuestInfoStep, ProgrammeStep, WEBSITE_FIELD_DESCRIPTION } from './event-content-steps.jsx'

/** The editor's values for an event with one slot in its running order. */
const values = {
  timezone: 'America/Chicago',
  performers: [],
  runningOrder: [{ time: '19:30', title: 'Doors', note: '' }],
}

describe('the running order step', () => {
  it('says whose clock the times are on, and nothing about a format the box may not show', () => {
    render(<ProgrammeStep values={values} setField={vi.fn()} editable />)

    // The box is the browser's own time control, which shows 12- or 24-hour
    // as the reader's locale has it; the zone is what the organiser needs.
    expect(
      screen.getByText(
        'Local time at the event (America/Chicago). A run of several nights shows the same order each night.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/24-hour/u)).toBeNull()
  })
})

describe('the guest information step’s website', () => {
  /** The editor's values for the guest step. */
  const guests = {
    faq: [],
    sponsors: [],
    socialLinks: {},
    publicEmail: '',
    publicPhone: '',
    websiteUrl: 'https://www.rangoli.example/',
  }

  /** The switch, on for the saved address. */
  const ON = {
    enabled: true,
    pending: false,
    decidedUrl: 'https://www.rangoli.example/',
    submittedAt: null,
    changedAt: '2026-09-30T10:00:00.000Z',
    reason: 'Checked: their own site.',
    changedByName: 'Anil Administrator',
    websiteProblem: null,
  }

  it('is a plain box with the SPEC2 description, and types into websiteUrl', async () => {
    const setField = vi.fn()

    render(<GuestInfoStep values={guests} setField={setField} editable />)

    const box = screen.getByRole('textbox', { name: /^Your website/u })

    expect(box).toHaveValue('https://www.rangoli.example/')
    expect(box).toHaveAttribute('id', 'event-websiteUrl')
    expect(box).toHaveAttribute('type', 'url')
    expect(box).not.toHaveAttribute('readonly')
    expect(box).toHaveAccessibleDescription(WEBSITE_FIELD_DESCRIPTION)
    expect(WEBSITE_FIELD_DESCRIPTION).toBe(
      'Your own site’s full address, starting https://, such as https://www.yourfestival.com/. It is not shown on your event page unless the team at The Desi Events turns the website link on.',
    )

    fireEvent.change(box, { target: { value: 'https://rangoli.example/nights' } })

    expect(setField).toHaveBeenCalledWith('websiteUrl', 'https://rangoli.example/nights')
  })

  it('shows the switch read-only, naming who decided, and says who can turn it on or off', () => {
    render(
      <GuestInfoStep
        values={guests}
        setField={vi.fn()}
        editable
        websiteRedirect={ON}
        savedWebsiteUrl="https://www.rangoli.example/"
      />,
    )

    const status = screen.getByRole('group', { name: 'Website link on your event page' })

    expect(status).toHaveTextContent('On')
    expect(status).toHaveTextContent(
      /Anil Administrator of the team at The Desi Events turned it on/u,
    )
    expect(status).toHaveTextContent(
      'Only the team at The Desi Events can turn this link on or off.',
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /turn/iu })).toBeNull()
  })

  it('says it is off with no decision, and the switch is still the team’s, when nothing came', () => {
    render(<GuestInfoStep values={{ ...guests, websiteUrl: '' }} setField={vi.fn()} editable />)

    const status = screen.getByRole('group', { name: 'Website link on your event page' })

    expect(status).toHaveTextContent(
      'Off. Add your website’s address above and the team at The Desi Events can link to it from your event page.',
    )
    expect(status).toHaveTextContent(
      'Only the team at The Desi Events can turn this link on or off.',
    )
  })

  it('has no Website among the networks, and sends the organiser’s site to its own box', () => {
    render(<GuestInfoStep values={guests} setField={vi.fn()} editable />)

    expect(screen.queryByRole('textbox', { name: /^Website/u })).toBeNull()
    expect(screen.queryByText('Any https address.')).toBeNull()
    expect(screen.getByText(/Your own website goes in “Your website” above\./u)).toBeInTheDocument()
  })

  it('disables the box with the rest of the step when the event is not open for editing', () => {
    render(<GuestInfoStep values={guests} setField={vi.fn()} editable={false} />)

    expect(screen.getByRole('textbox', { name: /^Your website/u })).toBeDisabled()
  })
})
