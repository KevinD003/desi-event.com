import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AuthFrame } from './auth-frame.jsx'

describe('AuthFrame', () => {
  it('puts the form first in the reading order, under the page’s one h1', () => {
    const { container } = render(
      <AuthFrame headingId="sign-in-heading" title="Sign in" lead="Your tickets live here.">
        <form aria-label="Sign in form" />
      </AuthFrame>,
    )

    const heading = screen.getByRole('heading', { level: 1, name: 'Sign in' })
    const form = screen.getByRole('form', { name: 'Sign in form' })
    const panel = screen.getByRole('complementary', { name: 'What an account is for' })

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // The form comes before the panel in the document, whatever the layout draws.
    expect(heading.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(form.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.textContent).toMatch(/Your tickets live here\./)
  })

  it('tells the truth about what an account is for, and about payment', () => {
    render(
      <AuthFrame headingId="register-heading" title="Create an account" lead="It takes a minute.">
        <p>form</p>
      </AuthFrame>,
    )

    const panel = screen.getByRole('complementary', { name: 'What an account is for' })

    expect(panel).toHaveTextContent('this site sends no email')
    expect(panel).toHaveTextContent(
      'Payments on this site are simulated — no card, no money moves.',
    )
  })
})
