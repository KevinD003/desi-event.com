import { describe, expect, it } from 'vitest'

import { isBooked, notBookedNotice, orderHref } from './checkout-outcome.js'

describe('isBooked', () => {
  it.each([
    ['PAID', true],
    ['PENDING', false],
    ['CANCELLED', false],
    ['EXPIRED', false],
    ['REFUNDED', false],
  ])('reads an order that is %s as booked: %s', (status, booked) => {
    expect(isBooked({ reference: 'DE-7K2M9Q', status })).toBe(booked)
  })

  it('reads no order as no booking', () => {
    expect(isBooked(null)).toBe(false)
    expect(isBooked(undefined)).toBe(false)
  })
})

describe('notBookedNotice', () => {
  it('says a pending order is being checked, not to pay again, and names it', () => {
    const notice = notBookedNotice({ reference: 'DE-7K2M9Q', status: 'PENDING' })

    expect(notice).toMatchObject({
      state: 'payment-unsettled',
      title: 'Not booked',
      orderReference: 'DE-7K2M9Q',
      recoverable: false,
    })
    expect(notice.detail).toMatch(/Order DE-7K2M9Q was placed/)
    expect(notice.detail).toMatch(/Please do not pay again/)
    expect(notice.detail).not.toMatch(/booked\.|in your account/)
  })

  it('says any other unpaid order is not booked', () => {
    expect(notBookedNotice({ reference: 'DE-7K2M9Q', status: 'CANCELLED' }).detail).toBe(
      'Order DE-7K2M9Q is not booked: it is not paid. Its page shows what happened.',
    )
  })
})

describe('orderHref', () => {
  it('links to the order when there is a reference, and to the orders otherwise', () => {
    expect(orderHref('DE-7K2M9Q')).toBe('/account/orders/DE-7K2M9Q')
    expect(orderHref(null)).toBe('/account/orders')
  })
})
