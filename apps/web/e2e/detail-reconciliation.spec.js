import { expect, test, world } from './support/detail-fixtures.mjs'

/**
 * The reconciliation detail screen, against a real work item.
 *
 * Three claims a unit test cannot make: that both sides of the evidence reach
 * the page, that nothing resembling a provider payload does, and that the five
 * commands are not drawn for an account that may read the item but may not act
 * on it — while the API refuses them anyway if the command is issued.
 *
 * @module e2e/detail-reconciliation
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

test.describe('the reconciliation detail screen', () => {
  test('shows both sides of the evidence', async ({ owner }) => {
    await owner.goto(`/operations/reconciliation/${ids().reconciliationTaskId}`)
    await expect(owner.getByRole('heading', { name: /payment timeout/i, level: 1 })).toBeVisible()

    const rendered = await owner.locator('main').innerText()

    // The decision is made by comparing them, so a screen showing one would be
    // asking somebody to decide with half the evidence.
    expect(rendered).toMatch(/what this system believed/i)
    expect(rendered).toMatch(/what the provider said/i)
    expect(rendered).toMatch(/orderStatus/u)
    expect(rendered).toMatch(/succeeded/u)
  })

  test('shows how long it has been open, in words as well as hours', async ({ owner }) => {
    await owner.goto(`/operations/reconciliation/${ids().reconciliationTaskId}`)

    const rendered = await owner.locator('main').innerText()

    // Seeded 96 hours old, which is past the critical threshold.
    expect(rendered).toMatch(/overdue/i)
    expect(rendered).toMatch(/9[0-9] hours/u)
  })

  test('carries no provider payload, no card and no buyer', async ({ owner }) => {
    await owner.goto(`/operations/reconciliation/${ids().reconciliationTaskId}`)

    const html = await owner.content()

    for (const needle of ['receipt_email', 'payment_method', 'last4', '4242', '@attendee.test']) {
      expect(html.toLowerCase(), `the page carries ${needle}`).not.toContain(needle.toLowerCase())
    }
  })

  test('offers no command to an account that may read but not act', async ({ owner }) => {
    await owner.goto(`/operations/reconciliation/${ids().reconciliationTaskId}`)

    const rendered = await owner.locator('main').innerText()

    // This account holds `finance:view` in the organisation, which is why the
    // item is readable. Acting on it needs a platform capability no
    // organisation role carries, and the screen says so rather than drawing
    // five buttons the server would refuse.
    expect(rendered).toMatch(/platform work/i)

    for (const label of ['Claim it', 'Resolve it', 'Escalate it']) {
      await expect(owner.getByRole('button', { name: label })).toHaveCount(0)
    }
  })

  test('refuses the command even when it is issued directly', async ({ owner }) => {
    // Sent as the page itself would send it — this origin, and the CSRF token
    // echoed from its cookie — so the forgery guard lets it through and the
    // refusal can only be the capability check. Without both headers the 403
    // came from the guard, and the case would have passed even if claiming
    // admitted an organiser.
    await owner.goto('/operations')

    const csrf = (await owner.context().cookies()).find(({ name }) => name.endsWith('desi_csrf'))

    expect(csrf, 'the session carries no CSRF cookie to echo').toBeTruthy()

    const response = await owner.request.post(
      `/api/v1/operations/reconciliation/${ids().reconciliationTaskId}/claim`,
      {
        data: {},
        headers: {
          origin: new URL(owner.url()).origin,
          'x-desi-csrf': decodeURIComponent(csrf.value),
        },
      },
    )

    // The buttons are not the authorisation. Issuing the HTTP command anyway is
    // refused by the same check that decided not to draw them.
    expect(response.status()).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })

  test('answers a direct URL for another organisation as it answers for nothing', async ({
    outsider,
  }) => {
    await outsider.goto(`/operations/reconciliation/${ids().reconciliationTaskId}`)

    const theirs = await outsider.locator('body').innerText()

    await outsider.goto('/operations/reconciliation/cmnotarealidentifier0000')

    const imaginary = await outsider.locator('body').innerText()

    // Identical words. A refusal that distinguished the two would turn a list
    // of guessed identifiers into a list of real ones.
    expect(theirs).toMatch(/not for you/i)
    expect(imaginary).toMatch(/not for you/i)
    expect(theirs).not.toMatch(/payment timeout|succeeded|orderStatus/iu)
  })
})
