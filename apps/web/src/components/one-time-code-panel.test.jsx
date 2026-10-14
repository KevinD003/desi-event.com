/**
 * The show-once code panel keeps the code where it was put and nowhere else.
 *
 * The properties worth pinning:
 *
 *   - the code is drawn in a read-only field with a visible label;
 *   - "Copy the code" writes exactly the code to the clipboard and says so
 *     politely; when the clipboard is refused the code is selected instead;
 *   - nothing is written to browser storage, and no link or address carries
 *     the code;
 *   - focus moves to the panel's heading when it appears;
 *   - "I have handed it over" hands control back to the parent, which drops it;
 *   - with a ready-to-send message, "Copy the message" writes exactly the whole
 *     message, the one status says which was copied, and the message goes when
 *     the code goes; without one, nothing about the panel changes.
 *
 * @module components/one-time-code-panel.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OneTimeCodePanel } from './one-time-code-panel.jsx'

const CODE = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

/**
 * A parent that holds the code in state and drops it when told, as the
 * invite form does.
 *
 * @returns {JSX.Element} The harness.
 */
function Holder({ letter = null }) {
  const [code, setCode] = useState(CODE)

  return code ? (
    <OneTimeCodePanel
      code={code}
      recipient="new.person@example.com"
      expiresAt="2026-10-12T15:00:00.000Z"
      acceptPath="/account/invitations"
      acceptPlace="Your account → Join an organisation"
      letter={letter}
      onDone={() => setCode(null)}
    />
  ) : (
    <p>Dropped</p>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the one-time code panel', () => {
  it('draws the code once, read-only, under a visible label, and moves focus to it', () => {
    render(<Holder />)

    const field = screen.getByLabelText('Invitation code')

    expect(field).toHaveValue(CODE)
    expect(field).toHaveAttribute('readonly')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByRole('heading', { name: 'Hand this code over' })).toHaveFocus()
    expect(
      screen.getByText(/only for someone signed in as new\.person@example\.com/u),
    ).toBeVisible()
    expect(
      screen.getByText(/Your account → Join an organisation \(\/account\/invitations\)/u),
    ).toBeVisible()
    expect(screen.getByText(/Treat it like a password until it is used/u)).toBeVisible()
  })

  it('copies exactly the code and says so politely', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<Holder />)
    await user.click(screen.getByRole('button', { name: 'Copy the code' }))

    expect(writeText).toHaveBeenCalledWith(CODE)

    const status = await screen.findByText('Copied the code to your clipboard.')

    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('selects the code and says how to copy it when the browser refuses', async () => {
    const user = userEvent.setup()

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })

    render(<Holder />)
    await user.click(screen.getByRole('button', { name: 'Copy the code' }))

    expect(await screen.findByText(/The code is selected/u)).toBeInTheDocument()

    const field = screen.getByLabelText('Invitation code')

    await waitFor(() => expect(field).toHaveFocus())
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(CODE.length)
  })

  it('writes the code to no storage and puts it in no link or address', async () => {
    const user = userEvent.setup()
    const local = vi.spyOn(Storage.prototype, 'setItem')

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    const { container } = render(<Holder />)

    await user.click(screen.getByRole('button', { name: 'Copy the code' }))

    expect(local).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(window.location.href).not.toContain(CODE)

    for (const element of container.querySelectorAll('[href], [src], [action]')) {
      for (const attribute of ['href', 'src', 'action']) {
        expect(element.getAttribute(attribute) ?? '').not.toContain(CODE)
      }
    }
  })

  it('hands control back when the code has been handed over, and the code is gone', async () => {
    const user = userEvent.setup()
    const { container } = render(<Holder />)

    await user.click(screen.getByRole('button', { name: 'I have handed it over' }))

    expect(screen.getByText('Dropped')).toBeInTheDocument()
    expect(container.innerHTML).not.toContain(CODE)
  })

  it('names nobody when the caller may not see the address', () => {
    render(
      <OneTimeCodePanel
        code={CODE}
        acceptPath="/account/invitations"
        acceptPlace="Your account → Join an organisation"
        onDone={() => {}}
      />,
    )

    expect(screen.getByText(/Send this code to the person it is for yourself/u)).toBeVisible()
  })

  it('draws no message and no second copy button when it is given none', () => {
    render(<Holder />)

    expect(screen.queryByLabelText('Message to send them')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy the message' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Subject:/u)).not.toBeInTheDocument()
  })
})

describe('the ready-to-send message', () => {
  const LETTER = Object.freeze({
    subject: 'Your organiser invitation from The Desi Events',
    text: `Hello,\n\nYour invitation code is:\n\n    ${CODE}\n\nTo accept it:\n1. Open https://thedesievents.example/account/organizations/new\n`,
  })

  it('draws the message read-only under its label, with its subject', () => {
    render(<Holder letter={LETTER} />)

    const field = screen.getByLabelText('Message to send them')

    expect(field.tagName).toBe('TEXTAREA')
    expect(field).toHaveValue(LETTER.text)
    expect(field).toHaveAttribute('readonly')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveAttribute('spellcheck', 'false')
    expect(screen.getByText(LETTER.subject)).toBeVisible()
  })

  it('copies exactly the whole message, and the one polite status says which was copied', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<Holder letter={LETTER} />)
    await user.click(screen.getByRole('button', { name: 'Copy the message' }))

    expect(writeText).toHaveBeenCalledWith(LETTER.text)

    const status = await screen.findByText('Copied the message to your clipboard.')

    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveAttribute('aria-live', 'polite')

    await user.click(screen.getByRole('button', { name: 'Copy the code' }))

    expect(writeText).toHaveBeenLastCalledWith(CODE)
    expect(await screen.findByText('Copied the code to your clipboard.')).toBe(status)
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('selects the message when the browser refuses to copy it', async () => {
    const user = userEvent.setup()

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })

    render(<Holder letter={LETTER} />)
    await user.click(screen.getByRole('button', { name: 'Copy the message' }))

    expect(await screen.findByText(/The message is selected/u)).toBeInTheDocument()

    const field = screen.getByLabelText('Message to send them')

    await waitFor(() => expect(field).toHaveFocus())
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(LETTER.text.length)
  })

  it('writes the message to no storage and puts the code in no link', async () => {
    const user = userEvent.setup()
    const local = vi.spyOn(Storage.prototype, 'setItem')

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    const { container } = render(<Holder letter={LETTER} />)

    await user.click(screen.getByRole('button', { name: 'Copy the message' }))

    expect(local).not.toHaveBeenCalled()
    expect(window.sessionStorage.length).toBe(0)

    for (const element of container.querySelectorAll('[href], [src], [action]')) {
      for (const attribute of ['href', 'src', 'action']) {
        expect(element.getAttribute(attribute) ?? '').not.toContain(CODE)
      }
    }
  })

  it('goes with the code when it has been handed over', async () => {
    const user = userEvent.setup()
    const { container } = render(<Holder letter={LETTER} />)

    await user.click(screen.getByRole('button', { name: 'I have handed it over' }))

    expect(screen.getByText('Dropped')).toBeInTheDocument()
    expect(container.innerHTML).not.toContain(CODE)
    expect(container.innerHTML).not.toContain(LETTER.subject)
  })
})
