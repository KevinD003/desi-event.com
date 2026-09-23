import { expect, test, world } from './support/detail-fixtures.mjs'

/**
 * Handing a ticket on, in a real browser.
 *
 * This is the suite that can make claims nothing else can: that offering a
 * ticket writes a real pending transfer, that the recipient's address comes
 * back as its domain alone, with nothing of the local part anywhere in the
 * page's source, that the invitation code never reaches the address bar, that a
 * ticket already out on offer is not offerable again, and that withdrawing an
 * offer puts it back where it was.
 *
 * The pass is the thing this file watches hardest. It is derived once and
 * handed over once; it must not be in the HTML of any of these pages, because a
 * pass in a page is a pass in a screenshot and a screenshot of one is a ticket.
 *
 * Serial, because three of the cases are one story: offer, refuse a second
 * offer, withdraw. Running them in any other order would be testing a different
 * ticket.
 *
 * @module e2e/detail-transfers
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

test.describe.serial('the ticket and transfer screens', () => {
  test('lists the tickets this account holds', async ({ owner }) => {
    await owner.goto('/tickets')
    await expect(owner.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible()

    const rendered = await owner.locator('main').innerText()

    expect(rendered).toMatch(/DE-SWP-/u)
    expect(rendered).toMatch(/ready to use/i)
  })

  test('shows a ticket without its pass', async ({ owner }) => {
    await owner.goto(`/tickets/${ids().ticketIds[0]}`)
    await expect(owner.getByRole('heading', { level: 1 })).toBeVisible()

    const rendered = await owner.locator('main').innerText()
    const html = await owner.content()

    expect(rendered).toMatch(/admits/i)

    // Three names the credential goes by, none of which may be in the markup.
    for (const needle of ['credentialHash', 'credentialVersion', 'ticket-pass-v1']) {
      expect(html, `the page carries ${needle}`).not.toContain(needle)
    }
  })

  test('offers a ticket, and shows the recipient by domain alone afterwards', async ({ owner }) => {
    await owner.goto(`/tickets/${ids().ticketIds[0]}`)
    await owner.getByRole('button', { name: /offer this ticket/i }).click()
    await owner.getByLabel(/their email address/i).fill('harsha.offered+tickets@elsewhere.test')
    await owner.getByRole('button', { name: /send the offer/i }).click()

    await expect(owner.getByText(/offered\. the invitation is recorded/i)).toBeVisible()
    // Nothing was delivered, and the page must not say otherwise.
    await expect(owner.getByText(/have been sent/i)).toHaveCount(0)

    await owner.reload()

    const rendered = await owner.locator('main').innerText()
    const html = await owner.content()

    expect(rendered).toMatch(/offered, not yet answered/i)
    // The domain, so the sender can tell their offers apart, and nothing of the
    // local part: not its length, not its ends, not its suffix. Searched in the
    // page's whole source, serialised props included, so no stylesheet or
    // hidden element is doing the hiding.
    expect(rendered).toContain('••••@elsewhere.test')
    expect(html).not.toContain('harsha')
    expect(html).not.toContain('+tickets')
    expect(html).not.toMatch(/\*+@elsewhere/u)
  })

  test('will not offer a ticket that is already out on offer', async ({ owner }) => {
    await owner.goto(`/tickets/${ids().ticketIds[0]}`)

    await expect(owner.getByRole('button', { name: /offer this ticket/i })).toHaveCount(0)
    await expect(owner.getByRole('button', { name: /withdraw the offer/i })).toBeVisible()
  })

  test('withdrawing the offer puts the ticket back where it was', async ({ owner }) => {
    await owner.goto(`/tickets/${ids().ticketIds[0]}`)
    await owner.getByRole('button', { name: /withdraw the offer/i }).click()
    await owner.getByRole('button', { name: /^withdraw it$/i }).click()

    await expect(owner.getByText(/the invitation no longer works/i)).toBeVisible()

    await owner.reload()

    const rendered = await owner.locator('main').innerText()

    expect(rendered).toMatch(/withdrawn by the sender/i)
    await expect(owner.getByRole('button', { name: /offer this ticket/i })).toBeVisible()
  })

  test('takes an invitation code in a field and never in the address', async ({ owner }) => {
    await owner.goto('/tickets/accept')

    const field = owner.getByLabel(/invitation code/i)

    await expect(field).toHaveAttribute('type', 'password')

    await field.fill('not-a-real-invitation-code')
    await owner.getByRole('button', { name: /accept the ticket/i }).click()

    // Refused, and refused in words that say nothing about which of the several
    // reasons applies — expired, withdrawn, used, never existed.
    await expect(
      owner.getByText(/may have expired, been withdrawn, or been used already/i),
    ).toBeVisible()

    expect(new URL(owner.url()).search).toBe('')
    expect(owner.url()).not.toContain('not-a-real-invitation')

    // Still in the field, because this one was refused rather than spent —
    // somebody who mistyped a character should not have to find the message
    // again. Clearing happens on success, which is the case where a code left
    // in a form would be a spent secret in a browser's autofill store, and
    // `ticket-transfer-actions.test.jsx` asserts that half.
    await expect(field).toHaveValue('not-a-real-invitation-code')
  })

  test('refuses a ticket belonging to nobody this account knows', async ({ outsider }) => {
    // Read once the refusal is on screen, not at the load event: the area's
    // loading boundary streams, and React reveals the finished page after
    // `load`, so a read taken straight after `goto` can see the fallback.
    await outsider.goto(`/tickets/${ids().ticketIds[1]}`)
    await expect(outsider.getByRole('heading', { name: 'Not for you', level: 1 })).toBeVisible()

    const theirs = await outsider.locator('body').innerText()

    await outsider.goto('/tickets/cmnotarealidentifier0000')
    await expect(outsider.getByRole('heading', { name: 'Not for you', level: 1 })).toBeVisible()

    const imaginary = await outsider.locator('body').innerText()

    expect(theirs).toMatch(/not for you/i)
    expect(imaginary).toMatch(/not for you/i)
    expect(theirs).not.toMatch(/DE-SWP-|admits/u)
  })
})
