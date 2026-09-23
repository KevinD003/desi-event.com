/**
 * The sign-in form's structural promise: its fields cannot reach a URL.
 *
 * The fields are named, and a form with no method submits with GET. Pressed
 * before the page's script arrives, that would put the address, the password
 * and any code into the URL. The server-rendered markup is what such a press
 * submits, so that is what is checked, as well as the hydrated form.
 *
 * @module components/sign-in-form.test
 */

import { render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SignInForm } from './sign-in-form.jsx'

describe('SignInForm', () => {
  it('is served as a form that posts, so a press before the script arrives keeps the credentials out of the URL', () => {
    const html = renderToStaticMarkup(<SignInForm />)

    expect(html).toMatch(/<form[^>]*\smethod="post"/u)
    expect(html).toMatch(/name="email"/u)
    expect(html).toMatch(/name="password"/u)
  })

  it('still posts once hydrated, with the named fields inside it', () => {
    const { container } = render(<SignInForm />)
    const form = container.querySelector('form')

    // `form.method` is what the browser will actually use.
    expect(form.method).toBe('post')

    const named = [...form.elements].map((element) => element.name).filter(Boolean)

    expect(named).toEqual(expect.arrayContaining(['email', 'password']))
  })
})
