import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { WebsiteRedirectStatus } from './website-redirect-status.jsx'

const A = 'https://rangoli.example/'

/** On for A, decided by Anil. */
const ON = Object.freeze({
  enabled: true,
  pending: false,
  decidedUrl: A,
  submittedAt: null,
  changedAt: '2026-09-30T10:00:00.000Z',
  reason: 'Checked: their own site.',
  changedByName: 'Anil Administrator',
  websiteProblem: null,
})

describe('the organiser’s view of the website link', () => {
  it('says the link is on, who turned it on and where it goes, read-only', () => {
    render(<WebsiteRedirectStatus state={ON} websiteUrl={A} />)

    const group = screen.getByRole('group', { name: 'Website link on your event page' })

    expect(group).toBeInTheDocument()
    expect(screen.getByText('On')).toBeInTheDocument()
    expect(screen.getByText(/Website link:/u)).toHaveClass('sr-only')
    expect(
      screen.getByText(
        /^On since Sep 30, 2026, 10:00 AM UTC\. Anil Administrator of the team at The Desi Events turned it on, with this note: “Checked: their own site\.”\./u,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Only the team at The Desi Events can turn this link on or off.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('marks an address waiting for a decision', () => {
    render(
      <WebsiteRedirectStatus
        state={{ ...ON, enabled: false, pending: true, changedAt: null, decidedUrl: null }}
        websiteUrl={A}
      />,
    )

    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(screen.getByText('Waiting for a decision')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Off. Your address is on the list of website links for the team at The Desi Events to look at. It is not shown on your event page until an administrator turns the link on.',
      ),
    ).toBeInTheDocument()
  })

  it('asks for an address when there is none', () => {
    render(<WebsiteRedirectStatus state={null} websiteUrl={null} />)

    expect(
      screen.getByText(
        'Off. Add your website’s address above and the team at The Desi Events can link to it from your event page.',
      ),
    ).toBeInTheDocument()
  })
})
