import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { OrderSummary, totalsFromEstimate, totalsFromQuote } from './order-summary.jsx'

const QUOTE = {
  currency: 'USD',
  subtotalCents: 11_500,
  discountCents: 1_150,
  feesCents: 600,
  taxCents: 0,
  totalCents: 10_950,
  lines: [
    {
      ticketTypeId: 'ttfrontxxxxxx',
      name: 'Front stalls',
      sessionId: 'snnighttwoxxx',
      quantity: 2,
      unitPriceCents: 4_500,
      subtotalCents: 9_000,
      discountCents: 900,
    },
    {
      ticketTypeId: 'ttbackxxxxxxx',
      name: 'Back stalls',
      sessionId: null,
      quantity: 1,
      unitPriceCents: 2_500,
      subtotalCents: 2_500,
      discountCents: 250,
    },
  ],
  promo: { code: 'SAVE10', applied: true },
}

describe('the order summary', () => {
  it('reads the server’s quote, each line with its night, and the code that took', () => {
    const totals = totalsFromQuote(QUOTE, (sessionId) =>
      sessionId === 'snnighttwoxxx' ? 'Night 2 · Sun, Oct 4 · 7:30 PM' : null,
    )

    render(
      <OrderSummary totals={totals} place={{ country: 'US', region: 'NJ' }} promoCode="SAVE10" />,
    )

    expect(screen.getByText('Front stalls')).toBeInTheDocument()
    expect(screen.getByText('Night 2 · Sun, Oct 4 · 7:30 PM')).toBeInTheDocument()
    expect(screen.getByTestId('summary-subtotal')).toHaveTextContent('$115.00')
    expect(screen.getByText('Discount (SAVE10)')).toBeInTheDocument()
    expect(screen.getByTestId('summary-discount')).toHaveTextContent('−$11.50')
    expect(screen.getByTestId('summary-total')).toHaveTextContent('$109.50')
  })

  it('draws no discount row when nothing was taken off', () => {
    render(
      <OrderSummary
        totals={totalsFromQuote({ ...QUOTE, discountCents: 0, totalCents: 12_100, promo: null })}
      />,
    )

    expect(screen.queryByTestId('summary-discount')).toBeNull()
    expect(screen.getByTestId('summary-total')).toHaveTextContent('$121.00')
  })

  it('reads the browser’s estimate the same way, before anything is held', () => {
    const totals = totalsFromEstimate(
      {
        currency: 'USD',
        lineItems: [
          { ticketTypeId: 'ttgeneralxxxx', name: 'General', quantity: 3, subtotalCents: 6_000 },
        ],
        subtotalCents: 6_000,
        feesCents: 300,
        taxCents: 0,
        totalCents: 6_300,
      },
      () => 'Every night',
    )

    expect(totals).toMatchObject({
      discountCents: 0,
      totalCents: 6_300,
      lines: [{ key: 'ttgeneralxxxx', quantity: 3, night: 'Every night' }],
    })

    render(<OrderSummary totals={totals} salesTaxUncalculated place={{ country: 'US' }} />)

    expect(screen.getByText('US sales tax is not calculated in this demo')).toBeInTheDocument()
    expect(screen.getByTestId('summary-total')).toHaveTextContent('$63.00')
  })
})
