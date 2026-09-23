import { expect, test } from '@playwright/test'

import {
  PASSWORD,
  cleanupEvents,
  currentCode,
  forgetCodeUse,
  seedEvents,
} from './support/seed-events.mjs'

/**
 * Twenty browser journeys through an event's life, against a real API, a real
 * browser and a disposable database.
 *
 * They are one story told in order, because that is what the feature is: a
 * blank list becomes a draft, a draft becomes a submission, a submission
 * becomes an approval, an approval becomes a public page, a public page goes on
 * sale, and then somebody cancels it. Testing each state from a seeded fixture
 * would test the seed; walking it proves the transitions exist and that each
 * one is reachable from a browser.
 *
 * Roughly half are refusals. That is the shape of a lifecycle: most of what
 * matters is what the system declines to do, and to whom.
 *
 * Nothing here is faked. Both accounts hold a real second factor because their
 * roles require one, both sign in through it, and every write goes through the
 * same API a deployment runs.
 */

/** The run suffix, so cleanup can find exactly this run's rows. */
const TAG = process.env.EVENTS_E2E_TAG ?? `e2e${Date.now().toString(36)}`

/** @type {object} */
let seeded
/** @type {object} */
let organiserContext
/** @type {object} */
let moderatorContext
/**
 * The organiser's window, kept open for the whole run.
 *
 * A saved `storageState` does not work here, and the reason is a feature:
 * sessions rotate, so the cookie captured at sign-in stops being the current
 * one. Rather than turn rotation off, the suite does what a person does — signs
 * in once and keeps the window open.
 *
 * @type {object}
 */
let organiser
/** The moderator's window, likewise. @type {object} */
let moderator

/** The event this run creates, filled in by the first journey. @type {string} */
let eventId
/** Its public slug. @type {string} */
let eventSlug
/** A title unique to this run, so the queue and the catalogue can be searched. */
const TITLE = `Qawwali Under the Banyan ${TAG}`

/**
 * Sign one seeded account in, through the second factor its role requires.
 *
 * @param {object} page The page to sign in on.
 * @param {string} email Which account.
 * @param {RegExp} landing The URL the sign-in should end on.
 * @returns {Promise<void>} Resolves once signed in.
 */
async function signIn(page, email, landing) {
  await forgetCodeUse()

  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // NF-12 working: a privileged account cannot reach a guarded route without a
  // confirmed second factor. The journey goes through it, not around it.
  const code = page.getByLabel(/^Six-digit code/)
  await expect(code).toBeVisible()
  await code.fill(currentCode())
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(landing)
}

/**
 * A local wall-clock value for a datetime-local box, days from now.
 *
 * @param {number} days How far ahead.
 * @param {number} hour The hour of the day.
 * @returns {string} A `YYYY-MM-DDTHH:mm` value.
 */
function wallClock(days, hour) {
  const date = new Date(Date.now() + days * 24 * 3600 * 1000)

  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`
}

/**
 * Open the editor on one step.
 *
 * @param {object} page The organiser's page.
 * @param {string|RegExp} step The step button's name.
 * @returns {Promise<void>} Resolves once the step is open.
 */
async function openStep(page, step) {
  await page.goto(`/organizer/events/${eventId}`)
  // The step buttons answer only once the editor has hydrated. A click before
  // then lands on a button with no handler and is lost, and the step this
  // journey needs never opens, so wait for the editor to say it is live.
  await expect(
    page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
  ).toBeAttached()
  // In the steps nav: once a step opens, its own buttons can share the name
  // ("Send for review" beside "Review").
  const button = page.getByRole('navigation', { name: 'Editor steps' }).getByRole('button', {
    name: step,
  })
  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'step')
}

/**
 * One story, told in order.
 *
 * `describe.serial` rather than twenty independent tests, because they are not
 * independent: journey 4 edits the event journey 1 created, and journey 20
 * cancels the one journey 16 published. Two things follow from saying so.
 *
 * Playwright restarts a worker after a failing test, which re-imports this
 * module and loses every `let` above — so without serial mode, one failure in
 * the middle does not report one failure, it reports sixteen, every one of them
 * "the event could not be opened". That is worse than useless: it buries the
 * defect under its own consequences.
 *
 * In a serial group the remaining journeys are *skipped* instead, and a skip is
 * an honest answer. It says this step was never reached, which is true, rather
 * than claiming it was tried and failed.
 */
test.describe.serial('an event, from a blank list to a cancellation', () => {
  test.beforeAll(async ({ browser }) => {
    seeded = await seedEvents(TAG)

    organiserContext = await browser.newContext()
    organiser = await organiserContext.newPage()
    await signIn(organiser, seeded.organiserEmail, /\/account$/)

    moderatorContext = await browser.newContext()
    moderator = await moderatorContext.newPage()
    await signIn(moderator, seeded.moderatorEmail, /\/account$/)
  })

  test.afterAll(async () => {
    await organiserContext?.close()
    await moderatorContext?.close()
    await cleanupEvents(TAG)
  })

  test('journey 1: an organiser creates a draft from an empty list', async () => {
    await organiser.goto('/organizer/events')

    await expect(organiser.getByRole('heading', { name: 'Your events', level: 1 })).toBeVisible()

    await organiser.getByRole('link', { name: 'Create an event' }).click()
    await expect(organiser).toHaveURL(/\/organizer\/events\/new/)

    await organiser.getByLabel(/^Title/).fill(TITLE)
    await organiser.getByLabel(/one-line summary/i).fill('An evening of qawwali under a banyan.')
    await organiser
      .getByLabel(/^Description/)
      .fill('Three hours of qawwali in a courtyard, with chai and a very old tree.')
    await organiser.getByLabel(/^Category/).selectOption('MUSIC_CONCERT')
    await organiser.getByLabel(/^Time zone/).selectOption('Asia/Kolkata')
    await organiser.getByLabel(/^Starts/).fill(wallClock(45, 19))
    await organiser.getByLabel(/^Ends/).fill(wallClock(45, 22))

    await organiser.getByRole('button', { name: /create the draft/i }).click()

    await expect(organiser).toHaveURL(/\/organizer\/events\/c[a-z0-9]{20,}$/)

    eventId = organiser.url().match(/events\/(c[a-z0-9]{20,})$/)[1]

    // A new event is a draft. There is no other kind — the API ignores any status
    // sent to it, which was finding NF-17.
    await expect(organiser.getByText('State: Draft')).toBeVisible()
    await expect(organiser.getByText(/nobody can see this but your team/i)).toBeVisible()
  })

  test('journey 2: the draft is invisible to a stranger', async ({ page }) => {
    // Read the slug the API gave it, from the preview link the review step shows.
    await openStep(organiser, /review/i)
    const href = await organiser
      .getByRole('link', { name: /preview the public page/i })
      .getAttribute('href')

    eventSlug = href.replace('/events/', '')

    // A fresh, unauthenticated context.
    await page.goto(`/events/${eventSlug}`)

    await expect(page.getByTestId('not-found-view')).toBeVisible()

    // And it says nothing about why.
    const body = await page.textContent('body')
    expect(body).not.toMatch(/draft|unpublished|moderat|private/i)
  })

  test('journey 3: an edit saves on its own and survives a reload', async () => {
    await openStep(organiser, /details/i)

    const summary = organiser.getByLabel(/one-line summary/i)
    await summary.fill('An evening of qawwali under a two-hundred-year-old banyan.')

    await expect(organiser.getByTestId('save-status')).toHaveText(/unsaved changes/i)
    // The editor tells the time the way the rest of the site does, in US
    // English: "Saved at 7:04 PM."
    await expect(organiser.getByTestId('save-status')).toHaveText(
      /saved at \d{1,2}:\d{2}\s?[AP]M/i,
      { timeout: 20_000 },
    )

    await organiser.reload()

    await expect(organiser.getByLabel(/one-line summary/i)).toHaveValue(
      'An evening of qawwali under a two-hundred-year-old banyan.',
    )
  })

  test('journey 4: an invalid form is summarised and linked to the field', async () => {
    await openStep(organiser, /details/i)

    await organiser.getByLabel(/^Title/).fill('')

    const summary = organiser.getByTestId('validation-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText(/one thing needs fixing/i)

    const link = organiser.getByRole('link', { name: /give the event a title/i })
    await expect(link).toHaveAttribute('href', '#event-title')

    // Pressing save with the form invalid moves focus to the summary rather than
    // sending anything.
    await organiser.getByRole('button', { name: /save now/i }).click()
    await expect(summary).toBeFocused()
    await expect(organiser.getByTestId('save-status')).toHaveText(/not saved/i)

    // Put it back. Nothing needs saving now — the boxes match what is stored —
    // and the editor has to say so rather than leaving up a complaint about a
    // change somebody has already undone.
    await organiser.getByLabel(/^Title/).fill(TITLE)

    await expect(organiser.getByTestId('validation-summary')).toHaveCount(0)
    await expect(organiser.getByTestId('save-status')).toHaveText(/no unsaved changes/i)
  })

  test('journey 5: a second writer is caught rather than overwritten', async () => {
    await openStep(organiser, /details/i)

    // A colleague saves from somewhere else. Done through the page so the request
    // carries the session cookie and the CSRF header a browser would send.
    const outcome = await organiser.evaluate(async (id) => {
      const token = document.cookie.match(/(?:^|;\s*)(?:__Host-)?desi_csrf=([^;]*)/)
      const response = await fetch(`/api/v1/events/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-desi-csrf': decodeURIComponent(token[1]) } : {}),
        },
        body: JSON.stringify({ description: 'A colleague rewrote this while you were reading.' }),
      })

      return { status: response.status }
    }, eventId)

    expect(outcome.status).toBe(200)

    // Now the open editor's revision is stale. Type, and let autosave try.
    await organiser.getByLabel(/one-line summary/i).fill('My afternoon of work.')

    await expect(
      organiser.getByText(/somebody else saved this event while you were editing/i),
    ).toBeVisible({ timeout: 20_000 })

    // Not merged, not retried, and the unsaved text is still on screen to copy.
    await expect(organiser.getByLabel(/one-line summary/i)).toHaveValue('My afternoon of work.')
    await expect(
      organiser.getByRole('button', { name: /load their version and lose mine/i }),
    ).toBeVisible()
    await expect(
      organiser.getByRole('button', { name: /keep mine open so i can copy it/i }),
    ).toBeVisible()
  })

  test('journey 6: taking their version replaces what is in the boxes', async () => {
    await organiser.getByRole('button', { name: /load their version and lose mine/i }).click()

    await expect(organiser.getByTestId('save-status')).toHaveText(/loaded the current version/i)
    await expect(organiser.getByLabel(/one-line summary/i)).toHaveValue(
      'An evening of qawwali under a two-hundred-year-old banyan.',
    )

    await organiser.getByRole('button', { name: /details/i }).click()
    await expect(organiser.getByLabel(/^Description/)).toHaveValue(
      'A colleague rewrote this while you were reading.',
    )
  })

  test("journey 7: a session is added and reads back in the venue's zone", async () => {
    // The venue first, because a session is no use without somewhere to be.
    await openStep(organiser, /when and where/i)
    await organiser.getByLabel(/^Venue/).selectOption({ label: `${seeded.venueName} — Mumbai` })
    await expect(organiser.getByTestId('save-status')).toHaveText(/saved at/i, { timeout: 20_000 })

    await organiser.getByRole('button', { name: /^step 3\s*sessions$/i }).click()

    await expect(organiser.getByText(/no sessions yet/i)).toBeVisible()

    await organiser.getByLabel(/^Starts/).fill(wallClock(45, 19))
    await organiser.getByLabel(/^Ends/).fill(wallClock(45, 22))
    await organiser.getByLabel(/^Capacity/).fill('200')
    await organiser.getByRole('button', { name: 'Add session' }).click()

    await expect(organiser.getByText('Session added.')).toBeVisible()
    await expect(organiser.getByText('Session 1')).toBeVisible()
    await expect(organiser.getByText(/\(Asia\/Kolkata GMT\+5:30\)/)).toBeVisible()
    await expect(organiser.getByText('General admission').first()).toBeVisible()
  })

  test('journey 8: a ticket type shows what a buyer is actually charged', async () => {
    await openStep(organiser, /^step 4/i)

    await expect(organiser.getByText(/no ticket types yet/i)).toBeVisible()

    await organiser.getByLabel(/^Name/).fill('General admission')
    // Face values are entered in the currency's minor units, and a new tier is
    // in US dollars unless the organiser picks another currency.
    await organiser.getByLabel(/face value, in cents/i).fill('3500')
    await organiser.getByLabel(/how many/i).fill('200')
    await organiser.getByLabel(/put this tier on sale straight away/i).check()
    await organiser.getByRole('button', { name: 'Add ticket type' }).click()

    await expect(organiser.getByText('General admission').first()).toBeVisible()

    // The face value the organiser typed, and the number the buyer pays. Both on
    // the screen where the price is set, which is the whole point.
    await expect(organiser.getByText(/Face value \$35\.00/)).toBeVisible()
    await expect(organiser.getByText(/all in/i)).toBeVisible()
    await expect(organiser.getByText(/fee/i).first()).toBeVisible()
  })

  test('journey 9: preparing inventory says what there actually is to prepare', async () => {
    await openStep(organiser, /^step 3\s*sessions$/i)

    await organiser.getByRole('button', { name: 'Prepare inventory' }).click()

    // This session is general admission: its capacity *is* its inventory, and
    // there are no seat rows to create. Saying "already prepared: 0 of 0" would
    // read as a failure, so it says what is true and what would change it.
    // Reserved-seat preparation, and its idempotence under two presses at the
    // same instant, is proved against the real database in the API integration
    // suite — a browser cannot press a button twice simultaneously.
    await expect(
      organiser.getByText(/general admission, so there are no seats to prepare/i),
    ).toBeVisible()
    await expect(organiser.getByText(/published seating map to sell reserved seats/i)).toBeVisible()

    // Pressing it again says the same thing rather than claiming work.
    await organiser.getByRole('button', { name: 'Prepare inventory' }).click()
    await expect(organiser.getByText(/its capacity is its inventory/i)).toBeVisible()
  })

  test('journey 10: the readiness checklist lists every blocker, not the first', async () => {
    await openStep(organiser, /review/i)

    await expect(organiser.getByRole('heading', { name: /before it can go public/i })).toBeVisible()

    // Policies are still empty, so the listing is not complete. The organisation
    // is verified, so that line is ready. Both are said in words.
    await expect(organiser.getByText('Not yet').first()).toBeVisible()
    await expect(organiser.getByText('Ready').first()).toBeVisible()
    await expect(organiser.getByText(/needs entry, refund and conduct policies/i)).toHaveCount(2)
  })

  test('journey 11: an organiser fills in the policies and sends it for review', async () => {
    await openStep(organiser, /policies and access/i)

    await organiser.getByLabel(/^Refunds/).fill('Refundable up to 48 hours before the show.')
    await organiser.getByLabel(/getting in/i).fill('Doors at seven. Bring the confirmation email.')
    await organiser.getByLabel(/house rules/i).fill('No recording during the performance.')

    await expect(organiser.getByTestId('save-status')).toHaveText(/saved at/i, { timeout: 20_000 })

    await organiser.getByRole('button', { name: /review/i }).click()
    await organiser.getByRole('button', { name: 'Send for review' }).click()
    await organiser.getByRole('button', { name: /yes, send for review/i }).click()

    await expect(organiser.getByText(/waiting for review\. a moderator has it/i)).toBeVisible()
  })

  test("journey 12: the submission is in the moderator's queue", async () => {
    await moderator.goto('/moderation/events')

    await expect(moderator.getByRole('heading', { name: 'Review queue', level: 1 })).toBeVisible()
    await expect(moderator.getByRole('link', { name: TITLE })).toBeVisible()

    await moderator.getByRole('link', { name: TITLE }).click()

    await expect(moderator).toHaveURL(new RegExp(`/moderation/events/${eventId}`))
    await expect(moderator.getByText('Verification: Verified')).toBeVisible()
    await expect(moderator.getByText(/refundable up to 48 hours/i)).toBeVisible()
  })

  test('journey 13: the moderator asks for a specific change, and the organiser sees it', async () => {
    await moderator.getByRole('button', { name: 'Request changes' }).click()

    await moderator
      .getByLabel(/what the organiser needs to know/i)
      .fill('The description does not say which language the show is in.')
    await moderator.getByLabel(/this note is about/i).selectOption('description')
    await moderator.getByRole('button', { name: /add this note/i }).click()
    await moderator.getByRole('button', { name: /yes, request changes/i }).click()

    await expect(moderator.getByText(/this event is now CHANGES_REQUIRED/i)).toBeVisible()

    await openStep(organiser, /review/i)

    await expect(organiser.getByText(/a moderator has asked for changes/i)).toBeVisible()
    await expect(
      organiser.getByText(/does not say which language the show is in/i).first(),
    ).toBeVisible()

    // And the fields are editable again.
    await organiser.getByRole('button', { name: /details/i }).click()
    await expect(organiser.getByLabel(/^Title/)).toBeEnabled()
  })

  test('journey 14: the organiser resubmits and the moderator approves', async () => {
    await openStep(organiser, /details/i)

    await organiser
      .getByLabel(/^Description/)
      .fill('Three hours of qawwali in Urdu and Punjabi, in a courtyard with a very old tree.')
    await expect(organiser.getByTestId('save-status')).toHaveText(/saved at/i, { timeout: 20_000 })

    await organiser.getByRole('button', { name: /review/i }).click()
    await organiser.getByRole('button', { name: 'Send for review' }).click()
    await organiser.getByRole('button', { name: /yes, send for review/i }).click()
    // The announcement, as journey 11 waits for, and not any "waiting for
    // review" on the page: the history already reads "Draft → Waiting for
    // review" from the first submission, so that text is on screen before
    // this one is even sent. The panel announces only once the server has
    // answered, so the moderator below reads an event that really is waiting.
    await expect(organiser.getByText(/waiting for review\. a moderator has it/i)).toBeVisible()

    await moderator.goto(`/moderation/events/${eventId}`)
    await moderator.getByRole('button', { name: 'Approve' }).click()

    // Approval is not publication, and the panel says so before it happens.
    await expect(moderator.getByText(/the organiser chooses when to publish/i)).toBeVisible()

    await moderator.getByRole('button', { name: /yes, approve/i }).click()
    await expect(moderator.getByText(/this event is now APPROVED/i)).toBeVisible()

    await openStep(organiser, /review/i)
    await expect(organiser.getByText(/approved, not yet public/i).first()).toBeVisible()
  })

  test('journey 15: an approved event is still not public', async ({ page }) => {
    // Approval is a moderator saying yes. Publication is the organiser's
    // decision and their timing, and nothing is public until they take it.
    await page.goto(`/events/${eventSlug}`)

    await expect(page.getByTestId('not-found-view')).toBeVisible()
  })

  test('journey 16: publishing makes the page resolve', async ({ page }) => {
    await openStep(organiser, /review/i)

    await organiser.getByRole('button', { name: 'Publish' }).click()
    await expect(organiser.getByText(/publishing makes this page public/i)).toBeVisible()
    await organiser.getByRole('button', { name: /yes, publish/i }).click()

    await expect(organiser.getByText(/the page is live/i).first()).toBeVisible()

    await page.goto(`/events/${eventSlug}`)

    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.getByText(/refundable up to 48 hours/i)).toBeVisible()
    await expect(page.getByText('Step-free entrance')).toBeVisible()

    // Structured data, and it agrees with the page.
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent()
    expect(JSON.parse(jsonLd).eventStatus).toBe('https://schema.org/EventScheduled')
  })

  test('journey 17: opening sales offers a way to buy', async ({ page }) => {
    await openStep(organiser, /review/i)

    await organiser.getByRole('button', { name: 'Open sales' }).click()
    await organiser.getByRole('button', { name: /yes, open sales/i }).click()

    await expect(organiser.getByText(/people can buy/i).first()).toBeVisible()

    await page.goto(`/events/${eventSlug}`)

    await expect(page.getByRole('link', { name: /choose tickets/i })).toBeVisible()
    await expect(page.getByText(/all in/i)).toBeVisible()

    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent()
    expect(JSON.parse(jsonLd).offers[0].availability).toBe('https://schema.org/InStock')
  })

  test('journey 18: pausing sales takes the button away, not the page', async ({ page }) => {
    await openStep(organiser, /review/i)

    await organiser.getByRole('button', { name: 'Pause sales' }).click()
    await organiser.getByRole('button', { name: /yes, pause sales/i }).click()

    await expect(organiser.getByText(/the page is still up/i).first()).toBeVisible()

    await page.goto(`/events/${eventSlug}`)

    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.getByText(/sales are paused/i).first()).toBeVisible()
    await expect(page.getByText(/still going ahead/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /choose tickets/i })).toHaveCount(0)
  })

  test('journey 19: a material change to a live event has to be meant', async () => {
    // The generic editor refuses to touch a published event at all, which is the
    // first line of defence. The confirmation is the second, and it is what the
    // API asks for — so this journey goes at it the way a client would.
    await organiser.goto(`/organizer/events/${eventId}`)

    await expect(organiser.getByText(/not open for editing/i)).toBeVisible()

    const refused = await organiser.evaluate(async (id) => {
      const token = document.cookie.match(/(?:^|;\s*)(?:__Host-)?desi_csrf=([^;]*)/)
      const headers = {
        'content-type': 'application/json',
        ...(token ? { 'x-desi-csrf': decodeURIComponent(token[1]) } : {}),
      }

      const first = await fetch(`/api/v1/events/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ ageRestriction: 21 }),
      })
      const firstBody = await first.json()

      const second = await fetch(`/api/v1/events/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          ageRestriction: 21,
          confirmMaterialChange: true,
          changeReason: 'The licence came back restricted to over-21s.',
        }),
      })
      const secondBody = await second.json()

      return {
        refusedStatus: first.status,
        problems: firstBody?.error?.problems ?? [],
        acceptedStatus: second.status,
        ageRestriction: secondBody?.data?.ageRestriction ?? null,
      }
    }, eventId)

    expect(refused.refusedStatus).toBe(422)
    expect(refused.problems).toContain(
      'Changing the age restriction after publication needs an explicit confirmation.',
    )
    expect(refused.acceptedStatus).toBe(200)
    expect(refused.ageRestriction).toBe(21)
  })

  test('journey 20: cancelling says so everywhere, and promises nothing it cannot keep', async ({
    page,
  }) => {
    await openStep(organiser, /review/i)

    await organiser.getByRole('button', { name: 'Cancel this event' }).click()

    await expect(organiser.getByText(/cannot be undone/i)).toBeVisible()
    // In the confirmation itself: the footer on every page also says no money
    // moves, and that sentence is not the one this journey is about.
    await expect(organiser.getByRole('main').getByText(/no money moves/i)).toBeVisible()

    await organiser.getByLabel(/^Reason/).selectOption('ARTIST_UNAVAILABLE')
    await organiser
      .getByLabel(/what to tell ticket holders/i)
      .fill('The lead qawwal has been taken ill and we cannot replace him.')
    await organiser.getByRole('button', { name: /yes, cancel this event/i }).click()

    await expect(organiser.getByText(/refunds have been requested/i).first()).toBeVisible()

    await page.goto(`/events/${eventSlug}`)

    await expect(page.getByText(/this event has been cancelled/i).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /choose tickets/i })).toHaveCount(0)

    const jsonLd = JSON.parse(
      await page.locator('script[type="application/ld+json"]').textContent(),
    )

    // The vocabulary exists for exactly this, and a page that omitted it would
    // keep telling a search engine the show is on.
    expect(jsonLd.eventStatus).toBe('https://schema.org/EventCancelled')
    expect(jsonLd.offers).toBeUndefined()
  })
})
