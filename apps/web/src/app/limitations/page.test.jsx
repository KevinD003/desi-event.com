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
  ['Refunding money paid at the venue', 'NOT IMPLEMENTED'],
  ['Sales tax on tickets paid at the venue', 'NOT IMPLEMENTED'],
  ['Cancelling your own unpaid booking', 'NOT IMPLEMENTED'],
  ['Putting refunded general-admission places back on sale', 'NOT IMPLEMENTED'],
  ['Changing the standard booking fee on a screen', 'NOT IMPLEMENTED'],
  ['Rewards for referral codes', 'NOT IMPLEMENTED'],
  ['Refunding a payment completed after its event was cancelled', 'NOT IMPLEMENTED'],
  ['Splitting payment for a group', 'NOT IMPLEMENTED'],
  ['Check-in without a connection', 'NOT IMPLEMENTED'],
  ['Ticket passes on real phones', 'EXTERNAL DEVICE VERIFICATION PENDING'],
  ['Door scanning in Safari and Firefox', 'EXTERNAL DEVICE VERIFICATION PENDING'],
  ['Real payments, Stripe and Connect payouts', 'EXTERNAL VERIFICATION PENDING'],
  ['Virus scanning of uploaded pictures', 'NOT IMPLEMENTED'],
  ['Asking to become an organiser', 'NOT IMPLEMENTED'],
  ['Reviewing changes to a published event', 'NOT IMPLEMENTED'],
  ['Refunding part of an every-night ticket', 'NOT IMPLEMENTED'],
  ['Refunding a large cancelled event in the background', 'NOT IMPLEMENTED'],
  ['Erasing a deleted event', 'NOT IMPLEMENTED'],
  ['Keeping imported events up to date', 'NOT IMPLEMENTED'],
  ['Checking the organiser’s website itself', 'NOT IMPLEMENTED'],
  ['Text messages', 'NOT IMPLEMENTED'],
  ['Email', 'EXTERNAL VERIFICATION PENDING'],
  ['Automatic deletion of personal records after a set time', 'DISABLED'],
  ['Counting the same visitor across days, and exact visitor numbers', 'NOT IMPLEMENTED'],
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

  it('says notices about a changed, cancelled or deleted event are recorded and shown, and does not claim they were sent', () => {
    render(<LimitationsPage />)

    const email = entryFor('Email')

    // SPEC2-XI §11 (O13): night cancellations and deletions record notices too.
    expect(email.textContent).toContain(
      'When an event’s date, place or terms change, a night is cancelled, or the event is postponed, cancelled or deleted, a notice is recorded against each order and shown on its order page; it is not emailed.',
    )
    expect(email.textContent).not.toMatch(
      /ticket holders (have been|were) told|notice (was|has been) sent/i,
    )
  })

  it('says only an organiser-invitation code comes with a ready-to-send message', () => {
    render(<LimitationsPage />)

    const email = entryFor('Email').textContent

    // Team-invitation and ticket-transfer panels show the code alone; the
    // sentence must not promise them a letter.
    expect(email).toMatch(/only an organiser-invitation code comes with a ready-to-send message/i)
    expect(email).not.toMatch(/each code is shown once[^.;]*with a message/i)
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
  })

  it('no longer lists adding pictures to a published event, which now waits for somebody else’s approval', () => {
    const { container } = render(<LimitationsPage />)

    // SPEC2-XI O12: the entry is removed, because posted events take pictures.
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Adding pictures to a published event' }),
    ).toBeNull()
    expect(container.textContent).not.toMatch(/cannot be added or swapped in/i)

    const live = entryFor('Reviewing changes to a published event').textContent

    expect(live).toMatch(
      /New pictures appear only after someone on the team at The Desi Events other than the person who uploaded them approves each one; the old cover stays until then\./,
    )
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
      /Every event is reviewed by the team at The Desi Events before it can be published/i,
    )
    expect(
      screen
        .getByRole('link', { name: 'invitation from the team at The Desi Events' })
        .getAttribute('href'),
    ).toBe('/account/organizations/new')
  })

  it('says the booking fee is worked out after a promo code’s discount', () => {
    const { container } = render(<LimitationsPage />)

    expect(container.textContent).toMatch(/booking fee is then worked out on what is left/i)
  })

  it('says invitations are the only way to become an organiser', () => {
    render(<LimitationsPage />)

    expect(entryFor('Asking to become an organiser').textContent).toContain(
      'There is no form on this site for asking to become an organiser. The Desi Events team invites organisers it has agreed to work with, and each invitation carries a code that works once.',
    )
  })

  it('says what a live event can change without another review, word for word (SPEC2-XI §11)', () => {
    render(<LimitationsPage />)

    const live = entryFor('Reviewing changes to a published event').textContent

    for (const sentence of [
      'On a published, on-sale, paused, sold-out or postponed event, the organiser — or the team at The Desi Events, in an editing session opened with a reason — can change everything without another review, and the change is public when it saves.',
      'The date, time, time zone, place, joining link, age limit and entry, refund and conduct terms change only with a reason, and every ticket holder is shown the change on their order page; it is not emailed.',
      'Ticket types can be added, edited, re-priced (people who already bought keep what they paid), closed, hidden, or removed if unused.',
      'Nights can be added, moved, given another seating map while nothing at them is sold, removed if unused, or cancelled with their tickets refunded.',
      'The venue cannot be changed while a night uses a seating map.',
      '(Pictures copied by an import are the exception: the administrator who reviews the import approves them with the event.)',
      'A finished or cancelled event keeps its words and pictures editable.',
      'The organisation’s venue records can be edited at any time, and every event there shows the new details without review.',
      'An event’s website address can be changed at any time; a new address is not linked until an administrator approves it.',
      'Promo codes are never reviewed.',
    ]) {
      expect(live).toContain(sentence)
    }
    // The first plan's list said pictures could not be added; that is gone.
    expect(live).not.toMatch(/cannot be added|New pictures cannot/i)
  })

  it('says how cancelling one night treats a ticket for every night', () => {
    render(<LimitationsPage />)

    expect(entryFor('Refunding part of an every-night ticket').textContent).toContain(
      'Cancelling one night refunds the tickets bought for that night. A ticket valid for every night is not refunded in part: its holder keeps it for the other nights and is shown a notice, and the organiser can refund those orders one at a time.',
    )
  })

  it('states the refund batch sizes and how the rest are finished', () => {
    render(<LimitationsPage />)

    const batch = entryFor('Refunding a large cancelled event in the background').textContent

    expect(batch).toContain(
      'up to 500 at a time with simulated payments and 25 at a time with a payment provider',
    )
    expect(batch).toContain('“Finish refunds” on the event')
    expect(batch).toMatch(/An order whose payment is disputed is left to the finance team/)
  })

  it('says a deleted event is kept, and that typed reasons are kept as written', () => {
    render(<LimitationsPage />)

    const kept = entryFor('Erasing a deleted event').textContent

    expect(kept).toMatch(/Nothing on this site erases a deleted event/)
    expect(kept).toMatch(/removing somebody’s personal data goes through the privacy process/)
    // SPEC3 §15.1 and SPEC3-XI §15: the booking-fee, pay-at-the-venue,
    // referral-code and unpaid-ticket reasons are kept the same way.
    expect(kept).toContain(
      'The reasons people type when deleting, restoring, cancelling a night, editing as the team at The Desi Events, changing a booking fee or the pay-at-the-venue setting, refunding a booking fee by hand, switching a referral code off or cancelling unpaid tickets, and referral codes’ labels, are kept as written, and the privacy process does not rewrite them.',
    )
    expect(kept).toMatch(/can stay there for up to a day/)
  })

  it('says imported events are copies from a date, sold on Sulekha, and not kept up to date', () => {
    render(<LimitationsPage />)

    const imported = entryFor('Keeping imported events up to date').textContent

    expect(imported).toMatch(/copied from their listings on Sulekha\.com on 29–30 September 2026/)
    expect(imported).toMatch(/They are not updated automatically/)
    expect(imported).toMatch(/Tickets for them are sold on Sulekha, not here/)
    expect(imported).toMatch(/Where Sulekha gave no end time, only the start is shown\./)
    expect(imported).toMatch(/shows a generated poster/)
    expect(imported).toMatch(/Only events in Texas were copied\./)
  })

  it('says the website link is switched by administrators and the site behind it is not checked', () => {
    render(<LimitationsPage />)

    const entry = entryFor('Checking the organiser’s website itself')

    expect(entry.textContent).toMatch(
      /appears only after an administrator at The Desi Events turns it on for the address the organiser gave/,
    )
    expect(entry.textContent).toMatch(
      /the link keeps going to the address the administrator approved until an administrator decides on the new one or turns the link off/,
    )
    expect(entry.textContent).toMatch(/it does not open, scan or keep watching the site behind it/)
    expect(entry.textContent).toMatch(
      /An organisation’s own website on its organiser page is not switched or counted either\./,
    )
    expect(
      within(entry)
        .getByRole('link', { name: 'changes after publication are not reviewed again' })
        .getAttribute('href'),
    ).toBe('#live-changes-not-reviewed')
  })

  it('names the one deletion on a timer, links it to how visits are counted, and keeps the retention job dry', () => {
    render(<LimitationsPage />)

    const retention = entryFor('Automatic deletion of personal records after a set time')

    expect(retention.textContent).toMatch(
      /Nothing about a person, an order or a ticket is deleted automatically\./,
    )
    expect(retention.textContent).toMatch(
      /The retention job counts what a policy would remove, and removes nothing\./,
    )
    expect(retention.textContent).toMatch(/deleted two days after the day it was made/)
    expect(
      within(retention)
        .getByRole('link', { name: 'the raw record of visits to event pages' })
        .getAttribute('href'),
    ).toBe('#visit-counts')
    // The old name claimed nothing at all is ever deleted.
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Automatic deletion after a set time' }),
    ).toBeNull()
  })

  it('says how visits are counted, with the day secret, the purge and no cadence promised', () => {
    render(<LimitationsPage />)

    const visits = entryFor(
      'Counting the same visitor across days, and exact visitor numbers',
    ).textContent

    expect(visits).toContain(
      'by a code made from their connection and browser with a secret that is deleted from the live database when the day ends. Backups taken during the day keep that secret for as long as the backups are kept.',
    )
    expect(visits).toContain(
      'The record of each visit is deleted two days after the day it happened, by the job that adds visits up, once it has been added up. Only the daily totals are kept.',
    )
    expect(visits).toMatch(/counted as page views only, never as visitors/)
    expect(visits).toMatch(/the figures are a guide, not an audit/)
    // The job's schedule is the deployment's to set; no sentence promises one.
    expect(visits).not.toMatch(/every (ten|\d+) minutes/i)
  })

  it('gives every entry an anchor, so a link to one lands on it', () => {
    const { container } = render(<LimitationsPage />)

    for (const id of ['live-changes-not-reviewed', 'visit-counts', 'email', 'imported-events']) {
      const target = container.querySelector(`#${id}`)

      expect(target?.tagName).toBe('LI')
    }
    for (const link of container.querySelectorAll('a[href^="#"]')) {
      expect(container.querySelector(link.getAttribute('href'))).not.toBeNull()
    }
  })

  it('does not call every event fictional, since imported events are real listings', () => {
    const { container } = render(<LimitationsPage />)

    expect(container.textContent).not.toMatch(
      /Every event, organiser and price on this site is fictional/,
    )
    expect(container.textContent).toMatch(
      /Events, organisers and prices on this site are fictional, except events copied from Sulekha\.com listings/,
    )
    expect(
      screen
        .getByRole('link', { name: 'What can change after publication without another review' })
        .getAttribute('href'),
    ).toBe('#live-changes-not-reviewed')
  })

  it('says money paid at the door is the organiser’s to return, and what happens to a ticket nobody pays for, word for word (SPEC3-XI §15)', () => {
    render(<LimitationsPage />)

    expect(entryFor('Refunding money paid at the venue').textContent).toBe(
      'Refunding money paid at the venueStatus: NOT IMPLEMENTEDWhen a ticket is paid for at the door, the organiser keeps that money. The Desi Events records the amount but does not hold it and cannot refund it: if the order is refunded, the event is cancelled or a night is called off, only the booking fee paid online is refunded (simulated; when the event is cancelled, once someone who may approve refunds approves it), and money paid at the door has to be returned by the organiser. A ticket that is not paid for stays booked until the organiser or the team at The Desi Events cancels it; its place is then freed and sells again whenever its sales are open, and The Desi Events keeps the booking fee paid online for it. Nothing is cancelled automatically, and a buyer who does not come gets no refund of the booking fee.',
    )
  })

  it('says the site adds no tax to tickets paid at the venue and that the organiser may still owe sales tax on them', () => {
    render(<LimitationsPage />)

    const tax = entryFor('Sales tax on tickets paid at the venue').textContent

    expect(tax).toContain(
      'No sales tax is added to tickets paid at the venue, or to the booking fee paid online for them, and this site does not work out or report sales tax on them. The organiser may still owe sales tax on those sales.',
    )
  })

  it('says buyers cannot cancel their own unpaid booking, what bounds a booking nobody pays for, and that a kept fee is never refunded', () => {
    render(<LimitationsPage />)

    const unpaid = entryFor('Cancelling your own unpaid booking').textContent

    expect(unpaid).toMatch(/A buyer cannot cancel a booking they have not paid for at the door/)
    expect(unpaid).toMatch(
      /only the organiser or the team at The Desi Events can cancel its unpaid tickets/,
    )
    // The owner's answer to question 1: no limit per buyer, only the event's.
    // An unpaid ticket of a night that is over keeps counting (decision J).
    expect(unpaid).toMatch(
      /An unpaid ticket whose night is over still counts against that limit and can no longer be cancelled/,
    )
    expect(unpaid).toMatch(
      /up to the most unpaid tickets the team at The Desi Events allows for that event/,
    )
    expect(unpaid).not.toMatch(/per (account|buyer)|10 unpaid/i)
    expect(unpaid).toMatch(/is not refunded afterwards, not even by the team at The Desi Events/)
  })

  it('says refunds free reserved seats but not general-admission places, which only cancelling unpaid tickets frees', () => {
    render(<LimitationsPage />)

    const places = entryFor('Putting refunded general-admission places back on sale').textContent

    expect(places).toMatch(/its reserved seats go back on sale/)
    expect(places).toMatch(/held back/)
    expect(places).toMatch(/its general-admission places do not/)
    expect(places).toMatch(/Cancelling unpaid tickets booked to pay at the door is the one action/)
  })

  it('says the standard booking fee’s percentage is a server setting and its $0.99 is fixed in the code, events can have their own, and orders keep the fee they were charged', () => {
    render(<LimitationsPage />)

    const fee = entryFor('Changing the standard booking fee on a screen').textContent

    expect(fee).toMatch(/The Desi Events’ charge, not the organiser’s/)
    expect(fee).toMatch(/5\.90% of the ticket price after any promo discount plus \$0\.99 a ticket/)
    // Only the percentage is a server setting: the $0.99 for US-dollar
    // orders comes from the currency table in code (packages/pricing).
    expect(fee).toMatch(
      /No screen changes it: the percentage is a setting on the server, and the \$0\.99 a ticket for orders in US dollars is fixed in the code\./,
    )
    expect(fee).not.toMatch(/a setting on the server that no screen changes/)
    expect(fee).toMatch(/orders already placed keep the fee they were charged/)
  })

  it('says referral codes record who made them and pay nobody', () => {
    render(<LimitationsPage />)

    expect(entryFor('Rewards for referral codes').textContent).toContain(
      'Each referral code records the administrator at The Desi Events who made it and every order that used it, but nobody is paid for referrals: there are no payouts to administrators.',
    )
  })

  it('says a payment completed after its event was cancelled is not refunded automatically, and who refunds it', () => {
    render(<LimitationsPage />)

    const late = entryFor('Refunding a payment completed after its event was cancelled').textContent

    expect(late).toMatch(/the order stays paid and is not refunded automatically/)
    expect(late).toMatch(/the organisation’s finance team can refund it/)
    expect(late).toMatch(/\(simulated here\)/)
  })

  it('names the booking fee paid online among simulated payments, and referral codes among lower prices', () => {
    render(<LimitationsPage />)

    expect(entryFor('Real payments, Stripe and Connect payouts').textContent).toContain(
      'The booking fee paid online for tickets paid at the venue is simulated too.',
    )
    expect(entryFor('Splitting payment for a group').textContent).toContain(
      'a lower price comes only from a promo code the organiser has made, or from a referral code from the team at The Desi Events, which removes the booking fee.',
    )
    expect(entryFor('Reviewing changes to a published event').textContent).toContain(
      'The Desi Events team can change an event’s booking fee, and whether it can be paid for at the venue, at any time; people who already booked keep what they paid.',
    )
  })

  it('says what a referral code takes off and gives back, and that tickets paid at the venue carry no sales tax', () => {
    const { container } = render(<LimitationsPage />)

    expect(container.textContent).toContain(
      'A referral code from the team at The Desi Events removes the whole booking fee from one order. It does not change the ticket price. When an order is refunded in full or cancelled, its use of the code is given back.',
    )
    expect(container.textContent).toContain(
      'US sales tax is not calculated: checkout shows it as $0.00 for an event in the United States. Tickets paid at the venue carry no sales tax, and neither does the booking fee paid online for them.',
    )
    // Words buyers never read for the door: the site records an amount, not cash.
    expect(container.textContent).not.toMatch(/\bcash\b/i)
  })

  it('makes no request of its own', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')

    render(<LimitationsPage />)

    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
})
