import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const usePathname = vi.fn()

vi.mock('next/navigation', () => ({ usePathname }))

const { RegisterSync, applyRegister } = await import('./register-sync.jsx')

afterEach(() => {
  delete document.body.dataset.register
  usePathname.mockReset()
})

describe('RegisterSync', () => {
  it('moves <body> into the courtyard on a soft navigation from a public page to the wallet', () => {
    usePathname.mockReturnValue('/')
    const { rerender } = render(<RegisterSync />)

    expect(document.body).not.toHaveAttribute('data-register')

    usePathname.mockReturnValue('/tickets')
    rerender(<RegisterSync />)

    expect(document.body).toHaveAttribute('data-register', 'courtyard')
  })

  it('moves <body> back out on a soft navigation from the account to the home page', () => {
    // As the root layout rendered it for a hard load of /account.
    document.body.dataset.register = 'courtyard'
    usePathname.mockReturnValue('/account')
    const { rerender } = render(<RegisterSync />)

    expect(document.body).toHaveAttribute('data-register', 'courtyard')

    usePathname.mockReturnValue('/')
    rerender(<RegisterSync />)

    expect(document.body).not.toHaveAttribute('data-register')
  })

  it('keeps the public organiser profile editorial, beside the workspace that shares its prefix', () => {
    usePathname.mockReturnValue('/organizer/events')
    const { rerender } = render(<RegisterSync />)

    expect(document.body).toHaveAttribute('data-register', 'courtyard')

    usePathname.mockReturnValue('/organizers/rangoli-collective')
    rerender(<RegisterSync />)

    expect(document.body).not.toHaveAttribute('data-register')
  })

  it('renders nothing of its own', () => {
    usePathname.mockReturnValue('/events')
    const { container } = render(<RegisterSync />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('applyRegister', () => {
  it('leaves an element alone when it is already in the right register', () => {
    const element = document.createElement('div')
    element.dataset.register = 'courtyard'
    const before = element.outerHTML

    applyRegister(element, '/finance')

    expect(element.outerHTML).toBe(before)
  })

  it('treats an unknown path as public', () => {
    const element = document.createElement('div')
    element.dataset.register = 'courtyard'

    applyRegister(element, null)

    expect(element).not.toHaveAttribute('data-register')
  })
})
