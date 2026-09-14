import { describe, it, expect, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal.jsx'
import { Button } from './Button.jsx'
import { Input } from './Input.jsx'

/** A page with something focusable behind the dialog, as a real page has. */
function ModalHarness({ initialFocus = false, ...modalProps }) {
  const [open, setOpen] = useState(false)
  const emailRef = useRef(null)

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open checkout
      </button>
      <button type="button">Behind the dialog</button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Checkout"
        description="Two tickets for Garba Night."
        initialFocusRef={initialFocus ? emailRef : undefined}
        footer={<Button>Pay</Button>}
        {...modalProps}
      >
        <Input ref={emailRef} aria-label="Email" />
        <button type="button">Apply promo code</button>
      </Modal>
    </div>
  )
}

/**
 * Open the harness dialog and return the dialog element.
 *
 * @param {object} user A user-event session.
 * @returns {Promise<HTMLElement>} The open dialog.
 */
async function openDialog(user) {
  await user.click(screen.getByRole('button', { name: 'Open checkout' }))
  return screen.getByRole('dialog')
}

describe('Modal', () => {
  it('is a named modal dialog described by its supporting text', async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)

    const dialog = await openDialog(user)

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Checkout')
    expect(dialog).toHaveAccessibleDescription('Two tickets for Garba Night.')
  })

  it('renders through a portal rather than inside the calling tree', async () => {
    const user = userEvent.setup()
    const { container } = render(<ModalHarness />)

    const dialog = await openDialog(user)

    expect(container).not.toContainElement(dialog)
    expect(document.body).toContainElement(dialog)
  })

  it('moves focus into the dialog on open and back to the trigger on close', async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)

    const trigger = screen.getByRole('button', { name: 'Open checkout' })
    const dialog = await openDialog(user)

    expect(dialog).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('honours initialFocusRef', async () => {
    const user = userEvent.setup()
    render(<ModalHarness initialFocus />)

    await openDialog(user)

    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveFocus()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)

    const trigger = screen.getByRole('button', { name: 'Open checkout' })
    await openDialog(user)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('ignores Escape when closeOnEscape is false', async () => {
    const user = userEvent.setup()
    render(<ModalHarness closeOnEscape={false} />)

    await openDialog(user)
    await user.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('traps Tab inside the dialog and cycles round', async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)

    await openDialog(user)

    const close = screen.getByRole('button', { name: 'Close dialog' })
    const email = screen.getByRole('textbox', { name: 'Email' })
    const promo = screen.getByRole('button', { name: 'Apply promo code' })
    const pay = screen.getByRole('button', { name: 'Pay' })

    await user.tab()
    expect(close).toHaveFocus()

    await user.tab()
    expect(email).toHaveFocus()

    await user.tab()
    expect(promo).toHaveFocus()

    await user.tab()
    expect(pay).toHaveFocus()

    // Past the last control, focus wraps back inside instead of escaping to
    // the page behind.
    await user.tab()
    expect(close).toHaveFocus()

    await user.tab({ shift: true })
    expect(pay).toHaveFocus()
  })

  it('never lets focus reach the page behind the dialog', async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)

    const dialog = await openDialog(user)
    const behind = screen.getByRole('button', { name: 'Behind the dialog' })

    for (let step = 0; step < 8; step += 1) {
      await user.tab()
      expect(behind).not.toHaveFocus()
      expect(dialog).toContainElement(document.activeElement)
    }
  })

  it('closes when the backdrop is clicked but not when the panel is', async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)

    const dialog = await openDialog(user)

    await user.click(dialog)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(dialog.parentElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the backdrop inert when closeOnOverlayClick is false', async () => {
    const user = userEvent.setup()
    render(<ModalHarness closeOnOverlayClick={false} />)

    const dialog = await openDialog(user)
    await user.click(dialog.parentElement)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('freezes page scrolling while open and restores it on close', async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)

    expect(document.body.style.overflow).toBe('')

    await openDialog(user)
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('')
  })

  it('restores page scrolling when unmounted while still open', () => {
    const { unmount } = render(
      <Modal open onClose={vi.fn()} title="Still open">
        Body
      </Modal>,
    )

    expect(document.body.style.overflow).toBe('hidden')

    unmount()

    expect(document.body.style.overflow).toBe('')
  })

  it('holds focus on the dialog when there is nothing tabbable inside it', async () => {
    const user = userEvent.setup()

    render(
      <Modal open onClose={vi.fn()} title="Notice" showCloseButton={false}>
        Nothing to interact with.
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveFocus()

    await user.tab()
    expect(dialog).toHaveFocus()

    await user.tab({ shift: true })
    expect(dialog).toHaveFocus()
  })

  it('renders nothing while closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Hidden">
        Body
      </Modal>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('accepts an explicit accessible name when there is no visible title', () => {
    render(
      <Modal open onClose={vi.fn()} ariaLabel="Seat map" showCloseButton={false}>
        Body
      </Modal>,
    )

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Seat map')
  })
})
