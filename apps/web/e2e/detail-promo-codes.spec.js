import { createPrismaClient } from '@desi-event/db'

import { expect, test, world } from './support/detail-fixtures.mjs'
import { confirmStepUp, stepUpPrompt, waitOutCredentialBudget } from './support/step-up.mjs'
import { CONNECTION } from './support/seed-refusals.mjs'

/**
 * An organiser's promo codes, in a real browser against the real API.
 *
 * ## What only this file can show
 *
 * - Making a code asks for a second factor when the last one has lapsed —
 *   the prompt is drawn in place, and the same request is sent again once it
 *   is answered — and the code is then listed, live, with what it takes off
 *   and what it applies to.
 * - A code can be paused, and an unused one deleted; one that has been used
 *   can be paused but never deleted, and the page says so rather than offering
 *   a button the API would refuse.
 * - A VIEWER is not offered the screen in the workspace's navigation, is shown
 *   "Not for you" at its address, and is refused by the API itself.
 *
 * What was made, paused and deleted is read from PostgreSQL, not the page.
 *
 * ## Isolation
 *
 * The codes are gamma's (`seed-feature-world.mjs`): the one this file makes
 * carries the run's tag and is gone again by the end, and the used-up code is
 * seeded with its one use spent, so nothing here depends on another spec
 * having paid with it. The second factor is made to lapse by moving the
 * session's confirmation back in the database — the saved session itself is
 * not rotated, so the windows that share it are unaffected.
 *
 * @module e2e/detail-promo-codes
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * The code this file makes: five dollars off gamma's general-admission nights.
 *
 * @returns {string} The code, upper-case, with the run's tag.
 */
const flatCode = () => `FLAT5${ids().tag.toUpperCase()}`

/**
 * Run a statement against the test database, and disconnect.
 *
 * @param {function(object): Promise<*>} work What to do.
 * @returns {Promise<*>} Its result.
 */
async function withDatabase(work) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await work(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Make gamma's owner's last second-factor confirmation older than any step-up
 * window, so the next privileged write asks again.
 *
 * Only the confirmation moves; the session stays live and keeps its secret.
 *
 * @returns {Promise<void>} Resolves once moved.
 */
function lapseStepUp() {
  return withDatabase((prisma) =>
    prisma.session.updateMany({
      where: { user: { email: ids().gammaOwnerEmail }, revokedAt: null },
      data: { mfaSatisfiedAt: new Date(Date.now() - 60 * 60 * 1_000) },
    }),
  )
}

/**
 * The promo codes screen for gamma, arrived.
 *
 * @param {object} page The owner's page.
 * @returns {Promise<void>} Resolves once the list is drawn.
 */
async function openCodes(page) {
  await page.goto(
    `/organizer/promo-codes?organizationId=${encodeURIComponent(ids().gammaOrganizationId)}`,
  )
  await expect(page.getByRole('heading', { level: 1, name: 'Promo codes' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: /^Codes \(\d+\)$/u })).toBeVisible()
}

/**
 * A code's row in the table.
 *
 * @param {object} page The page.
 * @param {string} code The code.
 * @returns {object} The row.
 */
function row(page, code) {
  return page
    .getByRole('table')
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: code, exact: true }) })
}

test.describe.serial('an organiser’s promo codes', () => {
  test('making a code asks for a second factor, then lists it live', async ({ gamma }) => {
    const { gammaGaEventId, gammaGaEventTitle, gammaOrganizationId } = ids()
    const code = flatCode()

    await openCodes(gamma)
    await expect(row(gamma, code)).toHaveCount(0)

    // The form is a client component: typed into only once it is listening.
    const form = gamma.getByRole('form', { name: 'Make a promo code' })

    await expect(form.getByRole('button', { name: 'Make the code' })).toBeEnabled()
    await form.getByLabel('Code', { exact: true }).fill(code.toLowerCase())
    await form.getByLabel('Applies to').selectOption(gammaGaEventId)
    await form.getByRole('radio', { name: 'Fixed amount off' }).check()
    // The event's own currency, taken from it when it was chosen.
    await form.getByLabel('Amount off (USD)').fill('5')

    // The window has lapsed, so the write is refused and the prompt drawn.
    await lapseStepUp()

    const created = gamma.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          `/api/v1/organizations/${gammaOrganizationId}/promo-codes` &&
        response.status() === 201,
    )

    await form.getByRole('button', { name: 'Make the code' }).click()
    await expect(stepUpPrompt(gamma)).toBeVisible()
    await expect(stepUpPrompt(gamma)).toContainText(/make a promo code/iu)

    await waitOutCredentialBudget(gamma, () => confirmStepUp(gamma), {
      refusedAt: /^\/api\/v1\/auth\/step-up$/u,
    })

    // Sent again by itself once the confirmation was accepted.
    await created
    await expect(gamma.getByText(`${code} made: live.`, { exact: true })).toBeVisible()

    const listed = row(gamma, code)

    await expect(listed).toHaveCount(1)
    await expect(listed).toContainText('$5.00 off')
    await expect(listed).toContainText(gammaGaEventTitle)
    await expect(listed).toContainText('0, no limit')
    await expect(listed).toContainText('Active')

    const stored = await withDatabase((prisma) =>
      prisma.promoCode.findFirst({
        where: { organizationId: gammaOrganizationId, code },
        select: { type: true, value: true, currency: true, eventId: true, active: true },
      }),
    )

    // Typed in lower case and stored as the code a buyer types, upper case.
    expect(stored).toEqual({
      type: 'FIXED_AMOUNT',
      value: 500,
      currency: 'USD',
      eventId: gammaGaEventId,
      active: true,
    })
  })

  test('an unused code is paused and then deleted', async ({ gamma }) => {
    const { gammaOrganizationId } = ids()
    const code = flatCode()

    await openCodes(gamma)

    const listed = row(gamma, code)

    await listed.getByRole('button', { name: `Pause ${code}`, exact: true }).click()
    await expect(
      gamma.getByText(`${code} is paused. Orders already placed keep their discount.`),
    ).toBeVisible()
    await expect(listed).toContainText('Paused')
    await expect(listed.getByRole('button', { name: `Resume ${code}` })).toBeVisible()

    // Nobody used it, so it can go — after a second press that says so.
    await listed.getByRole('button', { name: `Delete ${code}`, exact: true }).click()
    await expect(listed).toContainText(`Delete ${code}? Nobody has used it.`)
    await listed.getByRole('button', { name: `Delete ${code}`, exact: true }).click()

    await expect(row(gamma, code)).toHaveCount(0)

    const left = await withDatabase((prisma) =>
      prisma.promoCode.count({ where: { organizationId: gammaOrganizationId, code } }),
    )

    expect(left).toBe(0)
  })

  test('a used code can be paused but not deleted, and the page says why', async ({ gamma }) => {
    const { gammaUsedPromoCode, gammaOrganizationId } = ids()

    await openCodes(gamma)

    const listed = row(gamma, gammaUsedPromoCode)

    await expect(listed).toContainText('1 of 1')
    await expect(listed).toContainText('Used 1 time, so it can be paused but not deleted.')
    await expect(listed.getByRole('button', { name: /^Delete /u })).toHaveCount(0)

    // Sent anyway, the API refuses it too, and nothing is deleted.
    const csrf = (await gamma.context().cookies()).find(({ name }) => name.endsWith('desi_csrf'))
    const id = await withDatabase(async (prisma) => {
      const found = await prisma.promoCode.findFirstOrThrow({
        where: { organizationId: gammaOrganizationId, code: gammaUsedPromoCode },
        select: { id: true },
      })

      return found.id
    })
    const refused = await gamma.request.delete(
      `/api/v1/organizations/${gammaOrganizationId}/promo-codes/${id}`,
      {
        headers: {
          origin: new URL(gamma.url()).origin,
          'x-desi-csrf': decodeURIComponent(csrf.value),
        },
      },
    )

    expect(refused.status()).toBe(409)
    expect((await refused.json()).error.code).toBe('PROMO_IN_USE')
    expect(
      await withDatabase((prisma) => prisma.promoCode.count({ where: { id } })),
      'the used code was deleted',
    ).toBe(1)
  })

  test('a viewer is not offered the screen, and is refused it at its address and by the API', async ({
    viewer,
  }) => {
    const { alphaOrganizationId } = ids()

    await viewer.goto('/organizer')

    const nav = viewer.getByRole('navigation', { name: 'Workspace', exact: true })

    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Promo codes' })).toHaveCount(0)

    await viewer.goto(
      `/organizer/promo-codes?organizationId=${encodeURIComponent(alphaOrganizationId)}`,
    )
    await expect(viewer.getByRole('heading', { level: 1, name: 'Not for you' })).toBeVisible()
    await expect(viewer.getByRole('form', { name: 'Make a promo code' })).toHaveCount(0)

    const response = await viewer.request.get(
      `/api/v1/organizations/${alphaOrganizationId}/promo-codes`,
    )

    expect(response.status()).toBe(403)
  })
})
