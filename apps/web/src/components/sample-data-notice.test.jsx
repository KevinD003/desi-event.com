import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { SampleDataNotice } from './sample-data-notice.jsx'

describe('SampleDataNotice', () => {
  it('says nothing at all when the live API answered', () => {
    const { container } = render(<SampleDataNotice show={false} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('tells the visitor the listings are examples, politely rather than as an alarm', () => {
    render(<SampleDataNotice show />)

    const notice = screen.getByRole('status')

    expect(notice).toHaveTextContent('Showing our sample programme')
    expect(notice).toHaveTextContent(/nothing here can be bought/i)
  })

  it('never leaks the underlying failure to the visitor', () => {
    render(<SampleDataNotice show />)

    expect(document.body.textContent).not.toMatch(/ECONNREFUSED|fetch failed|stack/i)
  })
})
