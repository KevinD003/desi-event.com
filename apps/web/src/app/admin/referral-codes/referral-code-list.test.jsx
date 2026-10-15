/**
 * One page of referral codes (SPEC3 §12.5, SPEC3-XI §12.5): its columns, the
 * uses placed and given back, "Find on this page" over the page in the browser
 * with its no-match sentence said once, and "Copy code" named without the code
 * and saying "Copied" politely.
 *
 * @module app/admin/referral-codes/referral-code-list.test
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COPIED, COPY_REFUSED, CopyCodeButton } from './copy-code-button.jsx'
import { ReferralCodeList, matchesFind } from './referral-code-list.jsx'

/**
 * A code as the list returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The code.
 */
function code(overrides = {}) {
  return {
    id: 'cref00000000000000000001',
    referralCode: 'PARTNER-2026',
    label: 'Rangoli partners',
    scope: 'ALL_EVENTS',
    events: [],
    eventCount: 0,
    expiresAt: '2026-12-31T23:00:00.000Z',
    maxUses: 100,
    useCount: 3,
    usesPlaced: 5,
    usesReturned: 2,
    waived: [{ currency: 'USD', cents: 993 }],
    status: 'ON',
    active: true,
    createdBy: { id: 'cuser000000000000000001', displayName: 'Anil Rao' },
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

let writeText

/**
 * A user-event session with the clipboard stubbed: set up after the session,
 * which puts a clipboard of its own on `navigator`.
 *
 * @returns {object} The session.
 */
function setup() {
  const user = userEvent.setup()

  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

  return user
}

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('ReferralCodeList', () => {
  it('stays stacked into cards below 768 px, so 200% zoom on a laptop (640 px) does not scroll sideways', () => {
    render(<ReferralCodeList codes={[code()]} caption="Referral codes" />)

    const table = screen.getByRole('table', { name: 'Referral codes' })

    // Nine columns do not fit 640 px beside the workspace's own margins: the
    // accessibility sweep measured 79 px of sideways scroll there with the
    // table drawn from 640 px. Cards until 768 px, a table from there.
    expect(table).toHaveClass('block', 'md:table')
    expect(table.className).not.toMatch(/(?:^|\s)sm:table(?:\s|$)/u)
    expect(table.closest('.overflow-x-auto')).toBeNull()

    for (const row of within(table).getAllByRole('row').slice(1)) {
      expect(row).toHaveClass('block', 'md:table-row')
    }
  })

  it('lets a long word in a text column wrap, so a long name or code does not widen the table past a 1024 px screen', () => {
    render(
      <ReferralCodeList
        codes={[
          code({
            referralCode: 'SUMMERFESTIVALPARTNERS2026',
            label: 'Venkataramanaswamy',
            scope: 'SELECTED_EVENTS',
            events: [{ id: 'cevent0000000000000000001', title: 'Navratrimahotsav' }],
            eventCount: 1,
            createdBy: { id: 'cuser000000000000000002', displayName: 'Nandini Venkataraman' },
          }),
        ]}
        caption="Referral codes"
      />,
    )

    const [row] = within(screen.getByRole('table', { name: 'Referral codes' }))
      .getAllByRole('row')
      .slice(1)

    // The nine columns sit side by side from 768 px. A table's columns are no
    // narrower than their longest word unless the word may break anywhere, and
    // the accessibility sweep measured 27 px of sideways scroll at 1024 px
    // with one eleven-letter word in "Made by". Each text column may break a
    // word; the figures, dates and status never need to.
    for (const text of [
      'SUMMERFESTIVALPARTNERS2026',
      'Venkataramanaswamy',
      'Navratrimahotsav',
      'Nandini Venkataraman',
    ]) {
      const node = within(row).getByText(text)

      expect(node.closest('.wrap-anywhere'), text).not.toBeNull()
      expect(row.contains(node.closest('.wrap-anywhere')), text).toBe(true)
    }
  })

  it('draws each code with the columns the specification names', () => {
    render(
      <ReferralCodeList
        codes={[
          code(),
          code({
            id: 'cref00000000000000000002',
            referralCode: 'GUEST-LIST1',
            label: null,
            scope: 'SELECTED_EVENTS',
            events: [{ id: 'e1', title: 'Diwali Mela', slug: 'd', status: 'ON_SALE' }],
            eventCount: 4,
            maxUses: null,
            useCount: 7,
            usesPlaced: 7,
            usesReturned: 0,
            waived: [],
            status: 'OFF',
            createdBy: null,
            expiresAt: null,
          }),
        ]}
        caption="Referral codes"
      />,
    )

    const table = screen.getByRole('table', { name: 'Referral codes' })

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Code',
      'Label',
      'Works for',
      'Uses',
      'Booking fees waived',
      'Expires',
      'Status',
      'Made by',
      'Open',
    ])

    const [first, second] = within(table).getAllByRole('row').slice(1)

    expect(first).toHaveTextContent('PARTNER-2026')
    expect(first).toHaveTextContent('All events')
    expect(first).toHaveTextContent('3 of 100')
    expect(first).toHaveTextContent('5 placed, 2 given back')
    expect(first).toHaveTextContent('$9.93')
    expect(first).toHaveTextContent('Anil Rao')
    expect(within(first).getByText('PARTNER-2026')).toHaveClass('font-mono')
    expect(within(first).getByRole('link', { name: /^Open/u })).toHaveAttribute(
      'href',
      '/admin/referral-codes/cref00000000000000000001',
    )

    expect(second).toHaveTextContent('4 events')
    expect(second).toHaveTextContent('7')
    expect(second).not.toHaveTextContent('given back')
    expect(second).toHaveTextContent('None')
    expect(second).toHaveTextContent('Never')
    expect(second).toHaveTextContent('Off')
    expect(second).toHaveTextContent('A former administrator')
  })

  it('writes each expiry with its time and its zone, UTC, never a bare date', () => {
    render(
      <ReferralCodeList
        codes={[code({ expiresAt: '2026-12-01T04:59:00.000Z' })]}
        caption="Referral codes"
      />,
    )

    const expiry = screen.getByText('Dec 1, 2026, 4:59 AM UTC')

    expect(expiry.tagName).toBe('TIME')
    expect(expiry).toHaveAttribute('dateTime', '2026-12-01T04:59:00.000Z')
  })

  it('finds a code on the page by its text or label, and says once when none matches', async () => {
    const user = setup()

    render(
      <ReferralCodeList
        codes={[code(), code({ id: 'cref2', referralCode: 'GUEST-LIST1', label: 'Press' })]}
        caption="Referral codes"
      />,
    )

    const find = screen.getByRole('searchbox', { name: 'Find on this page' })
    const status = screen.getByRole('status')

    await user.type(find, 'press')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByText('GUEST-LIST1')).toBeInTheDocument()
    expect(status).toHaveTextContent('')

    await user.clear(find)
    await user.type(find, 'nothing-like-it')
    expect(screen.queryByRole('table')).toBeNull()
    expect(status).toHaveTextContent('No code on this page matches.')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('copies a code under a name that is not the code, and says "Copied" in the page’s region', async () => {
    const user = setup()

    render(<ReferralCodeList codes={[code()]} caption="Referral codes" />)

    const button = screen.getByRole('button', { name: 'Copy code for Rangoli partners' })

    expect(button).toHaveTextContent('Copy code')
    await user.click(button)

    expect(writeText).toHaveBeenCalledWith('PARTNER-2026')
    expect(screen.getByRole('status')).toHaveTextContent(COPIED)
  })

  it('says "Copied" for every copy, and not again for nothing once the finder is cleared', async () => {
    const user = setup()

    render(
      <ReferralCodeList
        codes={[code(), code({ id: 'cref2', referralCode: 'GUEST-LIST1', label: 'Press' })]}
        caption="Referral codes"
      />,
    )

    const status = screen.getByRole('status')
    // What a screen reader is handed: each addition to the region.
    const said = []
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.textContent) said.push(node.textContent)
        }
        if (record.type === 'characterData' && record.target.textContent) {
          said.push(record.target.textContent)
        }
      }
    })

    watch.observe(status, { childList: true, characterData: true, subtree: true })

    await user.click(screen.getByRole('button', { name: 'Copy code for Rangoli partners' }))
    await user.click(screen.getByRole('button', { name: 'Copy code for Press' }))
    await user.click(screen.getByRole('button', { name: 'Copy code for Press' }))
    await Promise.resolve()
    expect(said).toEqual([COPIED, COPIED, COPIED])

    const find = screen.getByRole('searchbox', { name: 'Find on this page' })

    await user.type(find, 'nothing-like-it')
    await user.clear(find)
    await Promise.resolve()
    watch.disconnect()

    expect(said.slice(3)).toEqual(['No code on this page matches.'])
    expect(status).toHaveTextContent('')
  })

  it('matches by text and label, ignoring case, and everything when nothing is typed', () => {
    expect(matchesFind(code(), '')).toBe(true)
    expect(matchesFind(code(), 'partner-2')).toBe(true)
    expect(matchesFind(code(), 'RANGOLI')).toBe(true)
    expect(matchesFind(code(), 'press')).toBe(false)
  })
})

describe('CopyCodeButton', () => {
  it('reads "Copy referral code" for a code without a label, on screen and to a screen reader', async () => {
    const user = setup()

    render(<CopyCodeButton code={{ referralCode: 'GUEST-LIST1', label: null }} />)

    const button = screen.getByRole('button', { name: 'Copy referral code' })

    expect(button).not.toHaveAttribute('aria-label')
    await user.click(button)
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
  })

  it('says "Copied" again for a second copy, in its own region', async () => {
    const user = setup()

    render(<CopyCodeButton code={{ referralCode: 'GUEST-LIST1', label: null }} />)

    const status = screen.getByRole('status')
    const said = []
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.textContent) said.push(node.textContent)
        }
      }
    })

    watch.observe(status, { childList: true, subtree: true })
    await user.click(screen.getByRole('button', { name: 'Copy referral code' }))
    await user.click(screen.getByRole('button', { name: 'Copy referral code' }))
    await Promise.resolve()
    watch.disconnect()

    expect(said).toEqual(['Copied', 'Copied'])
  })

  it('says how to copy it by hand when the browser will not let the page', async () => {
    const user = setup()

    writeText.mockRejectedValueOnce(new Error('denied'))
    render(<CopyCodeButton code={{ referralCode: 'GUEST-LIST1', label: 'Press' }} />)

    await user.click(screen.getByRole('button', { name: 'Copy code for Press' }))
    expect(screen.getByRole('status')).toHaveTextContent(COPY_REFUSED)
  })
})
