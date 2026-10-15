/**
 * How `e2e/support/step-up.mjs` waits out the credential limiter.
 *
 * `waitOutCredentialBudget` wraps one browser step that spends the credential
 * budget — a registration, an enrolment, an acceptance — and does what the
 * limiter says when it refuses: wait the stated time, then try once more. Two
 * ways of getting that wrong are pinned here, because each fails a journey for
 * having obeyed the limiter:
 *
 *   - running a step again that had already succeeded, because some response
 *     on the page was a 429 while it ran. A second registration of one address
 *     is answered 409 and a second acceptance finds nothing to accept;
 *   - waiting a minute inside a test whose budget is ninety seconds, so the
 *     test times out for having waited as told.
 *
 * The helper is driven with a fake page and fake responses. Playwright and the
 * seed modules are replaced, so Vitest never loads a browser or a database.
 *
 * @module lib/e2e-step-up.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const playwright = vi.hoisted(() => ({ info: null }))

vi.mock('@playwright/test', () => ({
  expect: vi.fn(),
  test: {
    info: () => {
      if (playwright.info === null) throw new Error('test.info() outside a test')

      return playwright.info
    },
  },
}))
vi.mock('@desi-event/auth', () => ({ totp: vi.fn(() => '000000') }))
vi.mock('../../e2e/support/detail-world.mjs', () => ({
  RATE_LIMITED: /Too many requests\. Retry in (\d+) seconds?/u,
}))
vi.mock('../../e2e/support/seed-refusals.mjs', () => ({
  PASSWORD: 'fake-test-password',
  TOTP_SECRET: 'FAKETESTSECRET',
  currentCode: vi.fn(() => '000000'),
  forgetCodeUse: vi.fn(async () => {}),
}))

const { waitOutCredentialBudget } = await import('../../e2e/support/step-up.mjs')

/**
 * A page that records its listeners and its waits.
 *
 * @returns {object} The fake page.
 */
function fakePage() {
  const listeners = new Set()

  return {
    waits: [],
    on: (event, listener) => event === 'response' && listeners.add(listener),
    off: (event, listener) => listeners.delete(listener),
    respond(response) {
      for (const listener of listeners) listener(response)
    },
    async waitForTimeout(ms) {
      this.waits.push(ms)
    },
  }
}

/**
 * A response, as Playwright hands one to a `response` listener.
 *
 * @param {number} status The status.
 * @param {string} path The path it answered.
 * @param {object} [headers] Its headers.
 * @param {string} [body] Its body.
 * @returns {object} The fake response.
 */
function response(status, path, headers = {}, body = '') {
  return {
    status: () => status,
    url: () => `http://127.0.0.1:3100${path}`,
    headers: () => headers,
    text: async () => body,
  }
}

describe('waitOutCredentialBudget', () => {
  beforeEach(() => {
    playwright.info = { timeout: 90_000, setTimeout: vi.fn() }
  })

  it('returns what a step resolved with, and runs it once, when nothing was refused', async () => {
    const page = fakePage()
    const action = vi.fn(async () => 'registered')

    await expect(waitOutCredentialBudget(page, action)).resolves.toBe('registered')
    expect(action).toHaveBeenCalledTimes(1)
    expect(page.waits).toEqual([])
  })

  it('never runs a step again that succeeded, even if a 429 was answered while it ran', async () => {
    // Some other request on the page was limited; the registration itself
    // went through. Running it again would be answered 409.
    const page = fakePage()
    const action = vi.fn(async () => {
      page.respond(response(429, '/api/v1/auth/login', { 'retry-after': '30' }))

      return 'registered'
    })

    await expect(waitOutCredentialBudget(page, action)).resolves.toBe('registered')
    expect(action).toHaveBeenCalledTimes(1)
    expect(page.waits).toEqual([])
    expect(playwright.info.setTimeout).not.toHaveBeenCalled()
  })

  it('waits the stated time, after making room for it in the test budget, then tries once more', async () => {
    const page = fakePage()
    let calls = 0
    const action = vi.fn(async () => {
      calls += 1

      if (calls === 1) {
        page.respond(response(429, '/api/v1/auth/register', { 'retry-after': '42' }))
        throw new Error('the account page never arrived')
      }

      return 'registered'
    })

    await expect(waitOutCredentialBudget(page, action)).resolves.toBe('registered')
    expect(action).toHaveBeenCalledTimes(2)
    expect(page.waits).toEqual([43_000])
    expect(playwright.info.setTimeout).toHaveBeenCalledWith(90_000 + 43_000)
  })

  it("reads the wait out of the API's own message when there is no Retry-After", async () => {
    const page = fakePage()
    let calls = 0
    const action = async () => {
      calls += 1

      if (calls === 1) {
        page.respond(
          response(429, '/api/v1/auth/register', {}, 'Too many requests. Retry in 7 seconds.'),
        )
        throw new Error('refused')
      }

      return 'ok'
    }

    await expect(waitOutCredentialBudget(page, action)).resolves.toBe('ok')
    expect(page.waits).toEqual([8_000])
  })

  it('rethrows a failure no 429 explains, without waiting or trying again', async () => {
    const page = fakePage()
    const failure = new Error('the heading never appeared')
    const action = vi.fn(async () => {
      page.respond(response(500, '/api/v1/auth/register'))
      throw failure
    })

    await expect(waitOutCredentialBudget(page, action)).rejects.toBe(failure)
    expect(action).toHaveBeenCalledTimes(1)
    expect(page.waits).toEqual([])
  })

  it('counts only the paths a spec names, when it narrows them', async () => {
    const page = fakePage()
    const failure = new Error('refused for another reason')
    const action = vi.fn(async () => {
      page.respond(response(429, '/api/v1/events', { 'retry-after': '5' }))
      throw failure
    })

    await expect(
      waitOutCredentialBudget(page, action, { refusedAt: /^\/api\/v1\/auth\/register$/u }),
    ).rejects.toBe(failure)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('fails, with the refusal as its cause, when the step is refused again after waiting', async () => {
    const page = fakePage()
    const action = vi.fn(async () => {
      page.respond(response(429, '/api/v1/teams/accept', { 'retry-after': '1' }))
      throw new Error('refused')
    })

    const outcome = waitOutCredentialBudget(page, action)

    await expect(outcome).rejects.toThrow(/refused this step 2 times/u)
    await expect(outcome).rejects.toHaveProperty('cause.message', 'refused')
    expect(action).toHaveBeenCalledTimes(2)
    expect(page.waits).toEqual([2_000])
  })

  it('still waits outside a test, and leaves an unlimited budget alone', async () => {
    for (const info of [null, { timeout: 0, setTimeout: vi.fn() }]) {
      playwright.info = info

      const page = fakePage()
      let calls = 0
      const action = async () => {
        calls += 1

        if (calls === 1) {
          page.respond(response(429, '/api/v1/auth/register', { 'retry-after': '3' }))
          throw new Error('refused')
        }

        return 'ok'
      }

      await expect(waitOutCredentialBudget(page, action)).resolves.toBe('ok')
      expect(page.waits).toEqual([4_000])
      if (info !== null) expect(info.setTimeout).not.toHaveBeenCalled()
    }
  })
})
