import { describe, it, expect } from 'vitest'
import { EMAIL_TEMPLATES } from '@desi-event/schemas/jobs'
import { OUTBOX_TEMPLATES } from '@desi-event/notifications'

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
    for (const template of EMAIL_TEMPLATES) {
      expect(TEMPLATES, `no renderer for ${template}`).toHaveProperty(template)
    }
  })

  it('has a renderer for every template the outbox may name', () => {
    // The other half of the same guarantee. A template the domain writes but
    // the worker cannot render is a row that queues, fails permanently, and
    // surfaces as a dead letter hours after the event it was about.
    for (const template of OUTBOX_TEMPLATES) {
      expect(TEMPLATES, `no renderer for ${template}`).toHaveProperty(template)
    }
  })

  it('has no renderer that belongs to neither list', () => {
    // And the third direction, so a renderer cannot be added without being
    // declared somewhere a writer would find it.
    const declared = new Set([...EMAIL_TEMPLATES, ...OUTBOX_TEMPLATES])

    for (const template of Object.keys(TEMPLATES)) {
      expect(declared.has(template), `${template} is declared nowhere`).toBe(true)
    }
  })

  it.each([...OUTBOX_TEMPLATES])('renders %s with a subject and both bodies', (template) => {
    const rendered = renderEmail({ template, data: {} })

    expect(rendered.subject.length).toBeGreaterThan(0)
    expect(rendered.text.length).toBeGreaterThan(0)
    expect(rendered.html).toContain('<div')
    expect(rendered.text).not.toContain('undefined')
    expect(rendered.html).not.toContain('undefined')
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

    expect(rendered.subject).toBe('[DEMO] Your Desi-Event order DE-8F3K2Q')
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
      data: {
        eventTitle: 'Comedy Night',
        quantity: 2,
        claimUrl: 'https://desi-event.com/e/comedy',
      },
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

describe('marking what is not real', () => {
  /**
   * Desi-Event settles every order with an in-memory mock and issues passes
   * that admit nobody. A confirmation that reads like a receipt, or a ticket
   * email that reads like a ticket, is the point at which a demonstration
   * starts misleading somebody — so the marker goes in the subject line and in
   * the first line of the body, where it cannot be scrolled past.
   */
  it.each(['ORDER_CONFIRMATION', 'TICKETS_ISSUED', 'ORDER_CANCELLED'])(
    'marks %s in the subject and the body',
    (template) => {
      const rendered = renderEmail({ template, data: { buyerName: 'Priya Sharma' } })

      expect(rendered.subject.startsWith('[DEMO] ')).toBe(true)
      expect(rendered.text.split('\n')[0]).toContain('DEMO')
      expect(rendered.html).toContain('DEMO')
    },
  )

  it('says no money moved on anything shaped like a receipt', () => {
    const rendered = renderEmail({ template: 'ORDER_CONFIRMATION', data: {} })

    expect(rendered.text).toMatch(/no money moved/i)
    expect(rendered.text).toMatch(/not a valid receipt/i)
  })

  it('says the pass admits nobody on the ticket email', () => {
    const rendered = renderEmail({ template: 'TICKETS_ISSUED', data: {} })

    expect(rendered.text).toMatch(/admits nobody/i)
  })

  it('keeps the marker even when the caller supplies its own subject', () => {
    // Otherwise the one field an operator controls would be the one that
    // removes the warning.
    const rendered = renderEmail({
      template: 'ORDER_CONFIRMATION',
      data: {},
      subject: 'Anything at all',
    })

    expect(rendered.subject).toBe('[DEMO] Anything at all')
  })

  it('leaves messages that are not about money or admission alone', () => {
    const rendered = renderEmail({ template: 'EMAIL_VERIFICATION', data: {} })

    expect(rendered.subject.startsWith('[DEMO]')).toBe(false)
  })
})
