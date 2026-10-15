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

  it('shows the gross booking fee and, under it, what a referral code waived', () => {
    render(
      <OrderSummary
        totals={totalsFromQuote({
          ...QUOTE,
          feesCents: 0,
          feeGrossCents: 600,
          feeWaivedCents: 600,
          totalCents: 10_350,
        })}
        place={{ country: 'US', region: 'NJ' }}
      />,
    )

    expect(screen.getByTestId('summary-fee')).toHaveTextContent('$6.00')
    expect(screen.getByText('Booking fee waived (referral code)')).toBeInTheDocument()
    expect(screen.getByTestId('summary-fee-waived')).toHaveTextContent('−$6.00')
    expect(screen.getByTestId('summary-total')).toHaveTextContent('$103.50')
  })

  it('ends a pay-at-the-venue booking in what is paid now and what is paid at the door', () => {
    render(
      <OrderSummary
        totals={totalsFromQuote({
          ...QUOTE,
          paymentMethod: 'AT_VENUE',
          totalCents: 600,
          venueDueCents: 10_350,
        })}
        place={{ country: 'US', region: 'NJ' }}
      />,
    )

    expect(screen.getByText('Pay now (simulated)')).toBeInTheDocument()
    expect(screen.getByTestId('summary-online')).toHaveTextContent('$6.00')
    expect(screen.getByText('Pay at the door')).toBeInTheDocument()
    expect(screen.getByTestId('summary-door')).toHaveTextContent('$103.50')
    expect(screen.queryByTestId('summary-total')).not.toBeInTheDocument()
    expect(
      screen.getByText('No sales tax is added to tickets paid at the venue.'),
    ).toBeInTheDocument()
  })

  it('says nothing is paid online when a referral code removed the whole fee', () => {
    render(
      <OrderSummary
        totals={totalsFromQuote({
          ...QUOTE,
          paymentMethod: 'AT_VENUE',
          feesCents: 0,
          feeGrossCents: 600,
          feeWaivedCents: 600,
          totalCents: 0,
          venueDueCents: 10_350,
        })}
      />,
    )

    expect(screen.getByTestId('summary-online')).toHaveTextContent('Nothing to pay online')
    expect(screen.getByTestId('summary-door')).toHaveTextContent('$103.50')
  })

  it('names a taxed booking fee by the place’s tax, and the tickets untaxed', () => {
    render(
      <OrderSummary
        totals={totalsFromQuote({
          ...QUOTE,
          currency: 'CAD',
          paymentMethod: 'AT_VENUE',
          taxCents: 78,
          totalCents: 678,
          venueDueCents: 10_350,
        })}
        place={{ country: 'CA', region: 'ON' }}
      />,
    )

    expect(screen.getByText('HST on the booking fee')).toBeInTheDocument()
    expect(screen.getByText('No HST is added to tickets paid at the venue.')).toBeInTheDocument()
  })

  it('carries the payment method from the estimate and from the quote', () => {
    expect(totalsFromQuote(QUOTE).paymentMethod).toBe('CARD')
    expect(
      totalsFromQuote({ ...QUOTE, paymentMethod: 'AT_VENUE', venueDueCents: 5 }),
    ).toMatchObject({
      paymentMethod: 'AT_VENUE',
      venueDueCents: 5,
      feeGrossCents: 600,
      feeWaivedCents: 0,
    })
  })
})
