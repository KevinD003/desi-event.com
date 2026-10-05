/**
 * The public limitations page says the recorded status of everything this
 * build does not do, word for word, and promises nothing.
 *
 * The statuses are pinned as literals here rather than read back from the
 * list, so that a change of word in the list — "PENDING" softened to
 * "planned", say — fails a test instead of quietly disagreeing with the
 * report.
 *
 * @module app/limitations/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LimitationsPage from './page.jsx'

afterEach(cleanup)

/** Each recorded limitation, and the status it must carry, word for word. */
const RECORDED = [
  ['Splitting payment for a group', 'NOT IMPLEMENTED'],
  ['Check-in without a connection', 'NOT IMPLEMENTED'],
  ['Ticket passes on real phones', 'EXTERNAL DEVICE VERIFICATION PENDING'],
  ['Door scanning in Safari and Firefox', 'EXTERNAL DEVICE VERIFICATION PENDING'],
  ['Real payments, Stripe and Connect payouts', 'EXTERNAL VERIFICATION PENDING'],
  ['Virus scanning of uploaded pictures', 'NOT IMPLEMENTED'],
  ['Adding pictures to a published event', 'NOT IMPLEMENTED'],
  ['Text messages', 'NOT IMPLEMENTED'],
  ['Email', 'EXTERNAL VERIFICATION PENDING'],
  ['Automatic deletion after a set time', 'DISABLED'],
]

/**
 * The entry for one recorded limitation, found by its heading.
 *
 * @param {string} name The limitation's name.
 * @returns {HTMLElement} Its list item.
 */
function entryFor(name) {
  return screen.getByRole('heading', { level: 2, name }).closest('li')
}

describe('LimitationsPage', () => {
  it.each(RECORDED)('gives “%s” the status %s', (name, status) => {
    render(<LimitationsPage />)

    const entry = entryFor(name)

    expect(within(entry).getByText(status, { exact: true })).toBeTruthy()
  })

  it('lists nothing it does not record', () => {
    render(<LimitationsPage />)

    expect(screen.getAllByRole('listitem').filter((item) => item.querySelector('h2'))).toHaveLength(
      RECORDED.length,
    )
  })

  it('says payments are simulated, and claims no money moved', () => {
    const { container } = render(<LimitationsPage />)

    expect(container.textContent).toMatch(/payments on this site are simulated/i)
    expect(container.textContent).toMatch(/nothing is charged/i)
    expect(container.textContent).not.toMatch(/\b(paid out to|money was sent|charged your)\b/i)
  })

  it('promises nothing', () => {
    const { container } = render(<LimitationsPage />)

    expect(container.textContent).not.toMatch(/coming soon|\bsoon\b|\byet\b|in a future|planned/i)
  })

  it('no longer lists handing on a reserved-seat ticket, which now takes its seat with it', () => {
    const { container } = render(<LimitationsPage />)

    expect(screen.queryByRole('heading', { level: 2, name: /reserved-seat ticket/i })).toBeNull()
    expect(container.textContent).not.toMatch(/UNIQUE-SEAT TRANSFER DEFECT/)
  })

  it('says which codes can be emailed and only with a mail server, and that without one each is shown once', () => {
    render(<LimitationsPage />)

    const email = entryFor('Email')

    // True whichever way the site is configured: no blanket "sends no email".
    expect(email.textContent).not.toMatch(/sends no email|does not send email|delivers no email/i)
    expect(email.textContent).toMatch(
      /can email organiser-invitation, team-invitation and ticket-transfer codes, but only when its operator has configured an SMTP mail server/i,
    )
    expect(email.textContent).toMatch(/tested only against a local test mail server/i)
    expect(email.textContent).toMatch(/each code is shown once to whoever issues it/i)
    expect(email.textContent).toMatch(/passing it on is up to them/i)
    expect(email.textContent).toMatch(
      /Receipts, address confirmation and password resets are not emailed in any configuration/i,
    )
    // The old sentence said there were no invitations at all; there are.
    expect(email.textContent).not.toMatch(/no team invitations|no invitation codes/i)
  })

  it('says notices about a changed event are recorded, and does not claim they were sent', () => {
    render(<LimitationsPage />)

    const email = entryFor('Email')

    expect(email.textContent).toMatch(/a notice is recorded against each order and not sent/i)
    expect(email.textContent).not.toMatch(
      /ticket holders (have been|were) told|notice (was|has been) sent/i,
    )
  })

  it('names what group buyers can do, and what they still cannot', () => {
    render(<LimitationsPage />)

    const group = entryFor('Splitting payment for a group')

    expect(group.textContent).toMatch(/paid for by one person/i)
    expect(group.textContent).toMatch(/each guest’s name on their ticket/i)
    expect(group.textContent).toMatch(/one group pass/i)
    expect(group.textContent).toMatch(/only from a promo code/i)
    // Guest details can be collected now; the old sentence said they could not.
    expect(group.textContent).not.toMatch(/collect each guest’s details/i)
  })

  it('says uploaded pictures are rebuilt and reviewed, and that no antivirus engine runs', () => {
    render(<LimitationsPage />)

    const scanning = entryFor('Virus scanning of uploaded pictures')

    expect(scanning.textContent).toMatch(/not run through an antivirus engine/i)
    expect(scanning.textContent).toMatch(/a moderator reviews each one/i)

    const later = entryFor('Adding pictures to a published event')

    expect(later.textContent).toMatch(/cannot be added or swapped in/i)
  })

  it('names the group pass among what has not met a real phone, and claims no browser test for it', () => {
    render(<LimitationsPage />)

    const phones = entryFor('Ticket passes on real phones').textContent

    expect(phones).toMatch(
      /neither a ticket’s pass nor the group pass has been tried with a real phone held up to a real camera/i,
    )
    expect(phones).toMatch(/type the code printed on the ticket or on the group pass/i)
    // Only the ticket's own pass and the door scanner have a browser suite;
    // the sentence must not credit the group pass with one.
    expect(phones).not.toMatch(/group pass[^.]*tested in a simulated browser/i)
  })

  it('offers the group pass only for two to fifty tickets the buyer still holds', () => {
    render(<LimitationsPage />)

    expect(entryFor('Splitting payment for a group').textContent).toMatch(
      /while they hold between two and fifty tickets on an order that still admit, they can show one group pass/i,
    )
  })

  it('keeps no sentence the build has overtaken, and says how organisers join and are verified', () => {
    const { container } = render(<LimitationsPage />)

    expect(container.textContent).not.toMatch(/no seat picker/i)
    expect(container.textContent).not.toMatch(/no way to create an organisation/i)
    // Organisations are not made from an account any more.
    expect(container.textContent).not.toMatch(/create for yourself|starts unverified/i)
    expect(container.textContent).toMatch(/started from one is verified from the start/i)
    expect(container.textContent).toMatch(/can publish only after the platform has verified it/i)
    expect(container.textContent).toMatch(
      /Every event is reviewed by the Desi-Event team before it can be published/i,
    )
    expect(
      screen
        .getByRole('link', { name: 'invitation from the Desi-Event team' })
        .getAttribute('href'),
    ).toBe('/account/organizations/new')
  })

  it('says the booking fee is worked out after a promo code’s discount', () => {
    const { container } = render(<LimitationsPage />)

    expect(container.textContent).toMatch(/booking fee is then worked out on what is left/i)
  })

  it('makes no request of its own', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')

    render(<LimitationsPage />)

    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
})
