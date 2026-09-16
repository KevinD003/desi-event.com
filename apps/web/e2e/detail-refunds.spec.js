import { expect, test, world } from './support/detail-fixtures.mjs'

/**
 * The refund detail screen, against a real refund.
 *
 * The claims worth making in a browser rather than in a unit test: that the
 * amount is rendered and not editable, that no field anywhere on the page could
 * take a card, that only the step the refund's state allows is offered, and
 * that somebody else's refund answers the way an imaginary one does.
 *
 * @module e2e/detail-refunds
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

test.describe('the refund detail screen', () => {
  test('shows the amount, how it divides, and which lines it came from', async ({ owner }) => {
    await owner.goto(`/finance/refunds/${ids().refundId}`)
    await expect(owner.getByRole('heading', { name: /refund on/i, level: 1 })).toBeVisible()

    const rendered = await owner.locator('main').innerText()

    expect(rendered).toMatch(/1,000\.00|1000\.00/u)
    expect(rendered).toMatch(/face value/i)
    expect(rendered).toMatch(/refunded lines/i)
  })

  test('has nothing on it that could take a card', async ({ owner }) => {
    await owner.goto(`/finance/refunds/${ids().refundId}`)
    await owner.getByRole('button', { name: 'Approve' }).click()

    const rendered = (await owner.locator('body').innerText()).toLowerCase()

    for (const needle of ['card number', 'cvc', 'expiry', 'security code', 'last4']) {
      expect(rendered, `the refund screen mentions ${needle}`).not.toContain(needle)
    }

    // And no field that would accept one.
    for (const input of await owner.locator('main input').all()) {
      expect(['text', 'email', 'password', null]).toContain(await input.getAttribute('type'))
    }
  })

  test('offers only the step this refund’s state allows', async ({ owner }) => {
    await owner.goto(`/finance/refunds/${ids().refundId}`)

    // REQUESTED: approving and cancelling are the two moves. Sending it is not
    // one of them — approving and sending are separate commands on purpose, and
    // the state table says so.
    await expect(owner.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect(owner.getByRole('button', { name: 'Cancel it' })).toBeVisible()
    await expect(owner.getByRole('button', { name: /send it to the provider/i })).toHaveCount(0)
  })

  test('will not send a command without a reason the audit record can keep', async ({ owner }) => {
    await owner.goto(`/finance/refunds/${ids().refundId}`)
    await owner.getByRole('button', { name: 'Approve' }).click()

    await expect(owner.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  test('never lets the browser name an amount', async ({ owner }) => {
    await owner.goto(`/finance/refunds/${ids().refundId}`)

    // The amount was computed from the order's own lines when the refund was
    // requested. There is no control on this page that proposes a different
    // one, and the database would refuse it if there were.
    expect(await owner.locator('main input[type="number"]').count()).toBe(0)
    expect(await owner.content()).not.toMatch(/name="amountCents"|id="amountCents"/u)
  })

  test('answers for another organisation as it answers for nothing', async ({ outsider }) => {
    await outsider.goto(`/finance/refunds/${ids().refundId}`)

    const theirs = await outsider.locator('body').innerText()

    await outsider.goto('/finance/refunds/cmnotarealidentifier0000')

    const imaginary = await outsider.locator('body').innerText()

    expect(theirs).toMatch(/not for you/i)
    expect(imaginary).toMatch(/not for you/i)
    expect(theirs).not.toMatch(/1,000\.00|CUSTOMER_REQUEST/u)
  })
})
