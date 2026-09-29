import { expect, test, world } from './support/detail-fixtures.mjs'
import {
  LIVE_TIER,
  REJECTION_REASON,
  SPARE_TIER,
  authoringNames,
  cleanupAuthoring,
  seedAuthoring,
} from './support/seed-authoring.mjs'
import { BALCONY_ROWS } from './support/seed-feature-world.mjs'

/**
 * Event authoring where it depends on a state the lifecycle story never
 * reaches by itself: a seating plan to price, tickets already sold, a
 * moderator's rejection.
 *
 * `event-lifecycle.spec.js` walks one event from a blank list to a
 * cancellation and carries most of the authoring journeys on the way — tiers
 * edited and removed, sessions in other zones, the organiser's detail fields,
 * a live event's safe edits, a material change and a reschedule. What is left
 * needs rows a browser cannot make quickly or honestly, so it is seeded under
 * gamma (`support/seed-authoring.mjs`) and exercised here:
 *
 *   - **A reserved ticket type** picks its night and its price zone: only a
 *     night with a seating plan can carry one, the zone comes from that plan,
 *     there is no "how many" because the seats are the quantity, and preparing
 *     the night's inventory prices every seat in the zone.
 *   - **A live event with sales** keeps what was sold: the price is fixed, the
 *     quantity can rise but not fall below what is sold, a sold tier cannot be
 *     removed while an unsold draft can, a tier can be paused and put back on
 *     sale, and a new tier and a new night can be added.
 *   - **A rejected event** shows the moderator's reason and comes back as a
 *     draft that can be edited.
 *
 * Gamma's saved session is used throughout; nothing here changes anybody's
 * privileges.
 *
 * @module e2e/detail-event-authoring
 */

/** The seeded events. @type {{draftEventId: string, liveEventId: string, rejectedEventId: string}} */
let seeded

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * Open an event's editor on one step.
 *
 * @param {object} page The organiser's page.
 * @param {string} eventId Which event.
 * @param {RegExp} step The step button's name.
 * @returns {Promise<void>} Resolves once the step is open.
 */
async function openStep(page, eventId, step) {
  await page.goto(`/organizer/events/${eventId}`)
  // The step buttons answer only once the editor has hydrated.
  await expect(
    page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
  ).toBeAttached()

  const button = page.getByRole('navigation', { name: 'Editor steps' }).getByRole('button', {
    name: step,
  })

  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'step')
}

/**
 * A ticket type's card on the Tickets step, by its name.
 *
 * @param {object} page The organiser's page.
 * @param {string} name The tier's name, as the card starts.
 * @returns {object} The card's locator.
 */
function tierCard(page, name) {
  return page
    .getByRole('region', { name: 'Tickets', exact: true })
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^${name}`, 'u') })
}

/** The seat count of gamma's balcony plan. */
const SEATS = Object.values(BALCONY_ROWS).reduce((sum, count) => sum + count, 0)

/**
 * A wall-clock value for a datetime-local box, days from now.
 *
 * @param {number} days How far ahead.
 * @param {number} hour The hour of the day.
 * @returns {string} A `YYYY-MM-DDTHH:mm` value.
 */
function wallClock(days, hour) {
  const date = new Date(Date.now() + days * 24 * 3600 * 1000)

  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`
}

test.describe.serial('authoring an event whose state the lifecycle never reaches', () => {
  test.beforeAll(async () => {
    seeded = await seedAuthoring({
      tag: ids().tag,
      organizationId: ids().gammaOrganizationId,
      venueId: ids().gammaVenueId,
    })
  })

  test.afterAll(async () => {
    await cleanupAuthoring(ids().tag)
  })

  test('a reserved ticket type picks its night and its zone, and preparing prices the seats', async ({
    gamma,
  }) => {
    const planName = `Gamma plan ${ids().tag} v1 — ${SEATS} seats`

    // A second night, on the venue's published seating plan.
    await openStep(gamma, seeded.draftEventId, /^step 3\s*sessions$/iu)
    await gamma.getByLabel(/^Label/u).fill('Balcony night')
    await gamma.getByLabel(/^Starts/u).fill(wallClock(81, 19))
    await gamma.getByLabel(/^Ends/u).fill(wallClock(81, 23))
    await gamma.getByLabel(/^Seating map/u).selectOption({ label: planName })
    // A reserved night's capacity is its plan: the box takes nothing.
    await expect(gamma.getByLabel(/^Capacity/u)).toBeDisabled()
    await gamma.getByRole('button', { name: 'Add session', exact: true }).click()
    await expect(gamma.getByText('Session added.')).toBeVisible()
    await expect(
      gamma
        .getByRole('heading', { name: /^Balcony night/u })
        .getByText('Seating: Reserved seating'),
    ).toBeVisible()

    await openStep(gamma, seeded.draftEventId, /^step 4/iu)

    const add = gamma
      .locator('div')
      .filter({ has: gamma.getByRole('heading', { name: 'Add a ticket type', exact: true }) })
      .last()

    await add.getByLabel(/^Name/u).fill('Balcony seats')
    await add.getByLabel(/^Face value \(USD\)/u).fill('45.00')
    await add.getByLabel(/^Reserved seating/u).check()

    // Only a night with a plan can carry a reserved tier; it is chosen for
    // the organiser, and its zones are the only prices on offer.
    const night = add.getByLabel(/^Which session/u)

    await expect(night.locator('option', { hasText: /Floor night/u })).toBeDisabled()
    await expect(night.locator('option:checked')).toHaveText(/Balcony night/u)

    const zone = add.getByLabel(/^Price zone/u)

    await expect(zone.locator('option')).toHaveText(['Choose a zone', 'Balcony'])
    // No "how many": the zone's seats are the quantity.
    await expect(add.getByLabel(/^How many/u)).toHaveCount(0)

    await zone.selectOption({ label: 'Balcony' })
    await add.getByRole('button', { name: 'Add ticket type', exact: true }).click()
    await expect(gamma.getByText('Added "Balcony seats".')).toBeVisible()
    await expect(tierCard(gamma, 'Balcony seats')).toContainText(
      /Reserved — Balcony at .*Balcony night/u,
    )

    // Preparing the night makes a seat for every place on the plan, and every
    // one of them is priced by the tier that prices its zone.
    await openStep(gamma, seeded.draftEventId, /^step 3\s*sessions$/iu)

    const balcony = gamma
      .getByRole('listitem')
      .filter({ has: gamma.getByRole('heading', { name: /^Balcony night/u }) })

    await balcony.getByRole('button', { name: 'Prepare inventory', exact: true }).click()
    await expect(
      gamma.getByText(
        `Prepared ${SEATS} new seats; ${SEATS} of ${SEATS} now exist. ${SEATS} seats were matched to the reserved ticket type that prices their zone.`,
      ),
    ).toBeVisible()

    // Twice is not twice the work.
    await balcony.getByRole('button', { name: 'Prepare inventory', exact: true }).click()
    await expect(
      gamma.getByText(
        `Already prepared: ${SEATS} of ${SEATS} seats exist. Nothing new was created.`,
      ),
    ).toBeVisible()
  })

  test('a live event with sales keeps its price, and changes only what nobody bought', async ({
    gamma,
  }) => {
    await openStep(gamma, seeded.liveEventId, /^step 4/iu)

    // Open for editing: public, not locked.
    await expect(gamma.getByText('This event is public').first()).toBeVisible()
    await expect(gamma.getByText(/not open for editing/iu)).toHaveCount(0)

    const general = tierCard(gamma, LIVE_TIER.name)

    await expect(general).toContainText(
      `Face value $35.00 · ${LIVE_TIER.sold} of ${LIVE_TIER.total} sold`,
    )
    // Sold, so never removable — and it says what to do instead.
    await expect(general.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0)
    await expect(general).toContainText(
      'Cannot be removed: tickets of this type have been sold or ordered. Pause it or hide it instead.',
    )

    // More of it, and the price nobody may change once people paid it.
    await general.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(general.getByLabel(/^Face value/u)).toBeDisabled()
    await expect(general).toContainText(`The price stays as it is: ${LIVE_TIER.sold} sold at it.`)
    await general.getByLabel(/^How many/u).fill('12')
    await general.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(gamma.getByText(`Saved "${LIVE_TIER.name}".`)).toBeVisible()
    await expect(general).toContainText(`${LIVE_TIER.sold} of 12 sold`)

    // Fewer than were sold is refused, and says why.
    await general.getByRole('button', { name: 'Edit', exact: true }).click()
    await general.getByLabel(/^How many/u).fill('1')
    await general.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(general.getByText(/sold/u).first()).toBeVisible()
    await expect(general).toContainText(/at least 2/iu)
    await general.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(general).toContainText(`${LIVE_TIER.sold} of 12 sold`)

    // Paused, and back on sale.
    await general.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(general).toContainText('State: Paused')
    await general.getByRole('button', { name: 'Put on sale', exact: true }).click()
    await expect(general).toContainText('State: On sale')

    // The draft nobody bought goes.
    const spare = tierCard(gamma, SPARE_TIER)

    await spare.getByRole('button', { name: 'Remove', exact: true }).click()
    await gamma
      .getByRole('group', { name: `Remove ${SPARE_TIER}` })
      .getByRole('button', { name: 'Yes, remove it', exact: true })
      .click()
    await expect(gamma.getByText(`Removed "${SPARE_TIER}".`)).toBeVisible()
    await expect(spare).toHaveCount(0)

    // A new tier starts as a draft, even on a live event.
    const add = gamma
      .locator('div')
      .filter({ has: gamma.getByRole('heading', { name: 'Add a ticket type', exact: true }) })
      .last()

    await add.getByLabel(/^Name/u).fill('Late entry')
    await add.getByLabel(/^Face value \(USD\)/u).fill('20.00')
    await add.getByLabel(/^How many/u).fill('10')
    await add.getByRole('button', { name: 'Add ticket type', exact: true }).click()
    await expect(gamma.getByText('Added "Late entry".')).toBeVisible()
    await expect(tierCard(gamma, 'Late entry')).toContainText('State: Not on sale (draft)')

    // And a new night, in the future.
    await openStep(gamma, seeded.liveEventId, /^step 3\s*sessions$/iu)
    await expect(gamma.getByText(/You can add a night, move one/u)).toBeVisible()
    await gamma.getByLabel(/^Label/u).fill('Second night')
    await gamma.getByLabel(/^Starts/u).fill(wallClock(86, 19))
    await gamma.getByLabel(/^Ends/u).fill(wallClock(86, 23))
    await gamma.getByLabel(/^Capacity/u).fill('20')
    await gamma.getByRole('button', { name: 'Add session', exact: true }).click()
    await expect(gamma.getByText('Session added.')).toBeVisible()
    await expect(gamma.getByRole('heading', { name: /^Second night/u })).toBeVisible()
  })

  test('a rejected event shows why, and comes back as a draft to rework', async ({ gamma }) => {
    const { rejected } = authoringNames(ids().tag)

    await openStep(gamma, seeded.rejectedEventId, /review/iu)

    await expect(gamma.getByText('State: Rejected').first()).toBeVisible()

    // The moderator's reason, where the organiser decides what to do next.
    await expect(gamma.getByText('A moderator rejected this event')).toBeVisible()
    await expect(gamma.getByText(REJECTION_REASON).first()).toBeVisible()

    await gamma.getByRole('button', { name: 'Rework as a draft', exact: true }).click()
    await expect(gamma.getByText(/moves the event back to draft/u)).toBeVisible()
    await gamma.getByRole('button', { name: /yes, rework as a draft/iu }).click()

    await expect(gamma.getByText('State: Draft').first()).toBeVisible()

    // Editable again, without a reload: the fields unlock as the state moves.
    await gamma
      .getByRole('navigation', { name: 'Editor steps' })
      .getByRole('button', { name: /details/iu })
      .click()
    await expect(gamma.getByLabel(/^Title/u)).toBeEnabled()
    await expect(gamma.getByLabel(/^Title/u)).toHaveValue(rejected.title)

    // And the reason stays in the history.
    await openStep(gamma, seeded.rejectedEventId, /review/iu)
    await expect(gamma.getByText('Rejected → Draft')).toBeVisible()
  })
})
