import { describe, it, expect } from 'vitest'
import { EMAIL_TEMPLATES } from '@desi-event/schemas'

import { TEMPLATES, escapeHtml, field, formatCents, renderEmail } from './templates.js'

describe('escapeHtml', () => {
  it('neutralises every character that could break out of markup', () => {
    expect(escapeHtml('<script>alert("x") & \'y\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    )
  })

  it('renders absent values as an empty string, never as "undefined"', () => {
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(null)).toBe('')
  })
})

describe('field', () => {
  it('falls back when the value is absent or blank', () => {
    expect(field({}, 'buyerName', 'there')).toBe('there')
    expect(field({ buyerName: '   ' }, 'buyerName', 'there')).toBe('there')
    expect(field({ buyerName: null }, 'buyerName', 'there')).toBe('there')
    expect(field(undefined, 'buyerName', 'there')).toBe('there')
  })

  it('trims a present value', () => {
    expect(field({ buyerName: '  Priya  ' }, 'buyerName', 'there')).toBe('Priya')
  })
})

describe('formatCents', () => {
  it.each([
    [0, 'INR 0.00'],
    [5, 'INR 0.05'],
    [99, 'INR 0.99'],
    [100, 'INR 1.00'],
    [249_900, 'INR 2499.00'],
    [-150, 'INR -1.50'],
  ])('renders %i cents as %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected)
  })

  it('honours the currency', () => {
    expect(formatCents(1234, 'GBP')).toBe('GBP 12.34')
  })

  it('refuses anything that is not integer cents, rather than guessing', () => {
    expect(formatCents(12.5)).toBeNull()
    expect(formatCents('1200')).toBeNull()
    expect(formatCents(undefined)).toBeNull()
  })
})

describe('renderEmail', () => {
  it('has a renderer for every template the job schema allows', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([...EMAIL_TEMPLATES].sort())
  })

  it.each([...EMAIL_TEMPLATES])('renders %s with a subject and both bodies', (template) => {
    const rendered = renderEmail({ template, data: {} })

    expect(rendered.subject.length).toBeGreaterThan(0)
    expect(rendered.text.length).toBeGreaterThan(0)
    expect(rendered.html).toContain('<div')
    expect(rendered.text).not.toContain('undefined')
    expect(rendered.html).not.toContain('undefined')
  })

  it('names the order in a confirmation and shows the total', () => {
    const rendered = renderEmail({
      template: 'ORDER_CONFIRMATION',
      data: {
        buyerName: 'Priya Sharma',
        orderReference: 'DE-8F3K2Q',
        eventTitle: 'Navratri Garba Night',
        totalCents: 250_000,
        currency: 'INR',
      },
    })

    expect(rendered.subject).toBe('Your Desi-Event order DE-8F3K2Q')
    expect(rendered.text).toContain('Hi Priya Sharma,')
    expect(rendered.text).toContain('order DE-8F3K2Q')
    expect(rendered.text).toContain('Navratri Garba Night')
    expect(rendered.text).toContain('INR 2500.00')
  })

  it('degrades to a readable phrase when the order reference is missing', () => {
    const rendered = renderEmail({ template: 'ORDER_CONFIRMATION', data: {} })

    expect(rendered.text).toContain('We have received your order.')
    expect(rendered.text).not.toContain('order .')
  })

  it('omits the total line entirely rather than printing a broken amount', () => {
    const rendered = renderEmail({ template: 'ORDER_CONFIRMATION', data: { totalCents: 'lots' } })

    expect(rendered.text).not.toContain('Total paid')
  })

  it('escapes hostile input in the HTML body but leaves the text body alone', () => {
    const rendered = renderEmail({
      template: 'ORDER_CONFIRMATION',
      data: { buyerName: '<script>alert(1)</script>' },
    })

    expect(rendered.html).not.toContain('<script>')
    expect(rendered.html).toContain('&lt;script&gt;')
    expect(rendered.text).toContain('<script>alert(1)</script>')
  })

  it('carries the claim link into a waitlist notification', () => {
    const rendered = renderEmail({
      template: 'WAITLIST_AVAILABLE',
      data: { eventTitle: 'Comedy Night', quantity: 2, claimUrl: 'https://desi-event.com/e/comedy' },
    })

    expect(rendered.subject).toBe('Tickets are available for Comedy Night')
    expect(rendered.text).toContain('https://desi-event.com/e/comedy')
  })

  it('lets the caller override the subject', () => {
    const rendered = renderEmail({ template: 'EVENT_REMINDER', subject: 'Tomorrow!' })

    expect(rendered.subject).toBe('Tomorrow!')
  })

  it('signs off once, at the end of the text body', () => {
    const rendered = renderEmail({ template: 'PASSWORD_RESET', data: {} })

    expect(rendered.text.trimEnd().endsWith('— Desi-Event')).toBe(true)
  })

  it('refuses an unknown template instead of sending an empty email', () => {
    expect(() => renderEmail({ template: 'NOT_A_TEMPLATE' })).toThrow(/No renderer/)
  })
})
