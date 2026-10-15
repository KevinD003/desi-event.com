/**
 * Every Playwright config that starts `next dev` does so through the shared
 * helper and proves its routes before any test.
 *
 * `scripts/lib/dev-servers.mjs` holds the rule; `ci:check` applies it to the
 * loaded configs (driven for real in `spec-collection.test.js`). Here the rule
 * is driven with plain objects standing in for configs, so each refusal is
 * pinned on its own: an entry built by hand, the proof missing, the proof run
 * after a setup that needs the routes, a proof file that is not there, and a
 * development server reached through a package script. Each sits beside a
 * config that passes, so a rule that refused everything would fail too.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEV_ROUTES_SETUP,
  NEXT_DEV_SERVER,
  judgeDevServers,
  startsNextDev,
} from '../../../scripts/lib/dev-servers.mjs'

const DIR = '/repo/apps/web'

/**
 * A `next dev` entry as `nextDevServer` builds one: marked, the mark hidden.
 *
 * @param {object} [fields] Fields to change.
 * @returns {object} The entry.
 */
function helped(fields = {}) {
  const server = { command: 'npx next dev --port 3440', url: 'http://127.0.0.1:3440', ...fields }

  Object.defineProperty(server, NEXT_DEV_SERVER, { value: true })

  return server
}

/** The API's entry, which is no concern of this rule. */
const API = { command: 'node src/server.js', url: 'http://127.0.0.1:4440/health' }

/**
 * Judge one config.
 *
 * @param {object} config The config.
 * @param {object} [options] Options.
 * @param {boolean} [options.present] Whether the proof file exists.
 * @returns {{problems: Array<{where: string, what: string}>, devConfigs: string[]}} The verdict.
 */
function judge(config, { present = true } = {}) {
  return judgeDevServers({
    configs: [{ file: 'playwright.x.config.js', dir: DIR, config }],
    webDirectory: 'apps/web',
    exists: (file) => present && file === path.join(DIR, DEV_ROUTES_SETUP),
  })
}

describe('which commands start the development server', () => {
  it('knows next dev however it is reached, and nothing else', () => {
    for (const command of [
      'npx next dev --port 3210',
      'next dev',
      'pnpm dev',
      'pnpm run dev',
      'npm run dev -- --port 3000',
      'pnpm --filter @desi-event/web dev',
    ]) {
      expect(startsNextDev(command), command).toBe(true)
    }

    for (const command of [
      'npx next start --port 3220',
      'node src/server.js',
      'pnpm run test:e2e:dev-only',
      'pnpm run devtools',
      undefined,
    ]) {
      expect(startsNextDev(command), String(command)).toBe(false)
    }
  })
})

describe('judging the configs that start next dev', () => {
  it('passes a config built with the helper and proving its routes first', () => {
    const { problems, devConfigs } = judge({
      globalSetup: ['./e2e/support/dev-routes-setup.mjs', './e2e/support/detail-global-setup.mjs'],
      webServer: [API, helped()],
    })

    expect(problems).toEqual([])
    expect(devConfigs).toEqual(['playwright.x.config.js'])
  })

  it('passes a single-server config whose globalSetup is the proof alone', () => {
    expect(
      judge({ globalSetup: './e2e/support/dev-routes-setup.mjs', webServer: helped() }).problems,
    ).toEqual([])
  })

  it('leaves alone a config that starts no development server', () => {
    const { problems, devConfigs } = judge({
      webServer: { command: 'npx next start --port 3220', url: 'http://127.0.0.1:3220' },
    })

    expect(problems).toEqual([])
    expect(devConfigs).toEqual([])
  })

  it('refuses an entry written by hand, even with the proof listed', () => {
    const { problems } = judge({
      globalSetup: ['./e2e/support/dev-routes-setup.mjs'],
      webServer: [API, { command: 'npx next dev --port 3440', url: 'http://127.0.0.1:3440' }],
    })

    expect(problems).toEqual([
      {
        where: 'apps/web/playwright.x.config.js',
        what: expect.stringContaining('starts `npx next dev --port 3440` by hand'),
      },
    ])
  })

  it('refuses a development server reached through a package script', () => {
    const { problems } = judge({
      globalSetup: ['./e2e/support/dev-routes-setup.mjs'],
      webServer: { command: 'pnpm run dev', url: 'http://127.0.0.1:3000' },
    })

    expect(problems.map(({ what }) => what)).toEqual([
      expect.stringContaining('starts `pnpm run dev` by hand'),
    ])
  })

  it('refuses a helper-built entry whose config never proves the routes', () => {
    for (const globalSetup of [
      undefined,
      './e2e/support/detail-global-setup.mjs',
      ['./e2e/support/detail-global-setup.mjs'],
    ]) {
      const { problems } = judge({ globalSetup, webServer: [API, helped()] })

      expect(problems).toEqual([
        {
          where: 'apps/web/playwright.x.config.js',
          what: expect.stringContaining(
            'starts next dev without e2e/support/dev-routes-setup.mjs in its globalSetup',
          ),
        },
      ])
    }
  })

  it('refuses the proof run after a setup that already needs the routes', () => {
    const { problems } = judge({
      globalSetup: ['./e2e/support/detail-global-setup.mjs', './e2e/support/dev-routes-setup.mjs'],
      webServer: [API, helped()],
    })

    expect(problems.map(({ what }) => what)).toEqual([
      expect.stringContaining('after another global setup'),
    ])
  })

  it('reads the proof by where it resolves, not by how it is spelt', () => {
    expect(
      judge({
        globalSetup: [path.join(DIR, 'e2e', 'support', 'dev-routes-setup.mjs')],
        webServer: helped(),
      }).problems,
    ).toEqual([])
    expect(
      judge({ globalSetup: ['./e2e/support/../support/dev-routes-setup.mjs'], webServer: helped() })
        .problems,
    ).toEqual([])
    // Another file of the same name elsewhere is not the proof.
    expect(
      judge({ globalSetup: ['./elsewhere/dev-routes-setup.mjs'], webServer: helped() }).problems,
    ).toHaveLength(1)
  })

  it('refuses a proof the config names but that is not there', () => {
    const { problems } = judge(
      { globalSetup: ['./e2e/support/dev-routes-setup.mjs'], webServer: helped() },
      { present: false },
    )

    expect(problems.map(({ what }) => what)).toEqual([
      'names e2e/support/dev-routes-setup.mjs, which does not exist',
    ])
  })
})
