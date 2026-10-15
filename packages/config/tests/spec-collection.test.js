/**
 * Every browser spec runs in exactly one CI job, and every CI job is required.
 *
 * `scripts/lib/spec-collection.mjs` holds the rules and `ci:check` applies
 * them. Both halves are exercised here. The rules are driven with plain
 * objects standing in for loaded Playwright configs, so Vitest never imports
 * Playwright; the checker is run for real, as a child process, against a
 * repository-shaped copy whose workflow, configs, specs or ruleset a case has
 * changed — because a rule that is right and a checker that never calls it
 * pass the unit half together.
 *
 * Each refusal below is one the design names: a spec no CI job collects, the
 * documented double collection of a detail spec, a pattern no glob reading can
 * prove, a job narrowed to fewer specs than its config collects, a skipped or
 * focused case, a config no job runs, and a browser job the ruleset does not
 * require. Each is paired with the committed tree passing, so a checker that
 * refused everything would fail here too.
 */

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_TEST_MATCH,
  Unverifiable,
  approvedRulesetFrom,
  collectingConfigs,
  collects,
  contextsOf,
  forbiddenCalls,
  judgeRequiredContexts,
  judgeSpecCollection,
  matchesAny,
  matrixSuites,
  narrowingInWorkflow,
  requiredContextsFrom,
  resolveSuite,
  resolveSuites,
  suiteJobNameTemplate,
  testFileExtension,
} from '../../../scripts/lib/spec-collection.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const rootScripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts
const webManifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps', 'web', 'package.json'), 'utf8'),
)
const webScripts = webManifest.scripts
const workflowText = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
const rulesetText = readFileSync(path.join(repoRoot, 'docs', 'BRANCH_PROTECTION.md'), 'utf8')

/** A web package directory for fixtures. Never read: every config here is an object. */
const WEB = '/repo/apps/web'

/**
 * A fixture spec, at a path under the fixture web package.
 *
 * @param {string} name The spec's file name.
 * @param {string} [source] Its text.
 * @returns {{path: string, relative: string, source: string}} The spec.
 */
function spec(name, source = "test('works', async () => {})\n") {
  return { path: `${WEB}/e2e/${name}`, relative: `apps/web/e2e/${name}`, source }
}

/**
 * A fixture config entry, shaped like a loaded Playwright config.
 *
 * @param {string} file The config's file name.
 * @param {object} fields The config's fields.
 * @returns {{file: string, dir: string, config: object}} The entry.
 */
function config(file, fields) {
  return {
    file,
    dir: WEB,
    config: { testDir: './e2e', projects: [{ name: 'chromium' }], ...fields },
  }
}

/**
 * A resolved suite, as `resolveSuites` returns one.
 *
 * @param {string} name The matrix name.
 * @param {string} configFile The config it runs.
 * @param {string[]} [narrowedBy] Anything narrowing it.
 * @returns {object} The suite.
 */
function suite(name, configFile, narrowedBy = []) {
  return { name, script: `test:${name}`, configFile, narrowedBy, problem: null }
}

/** The public config as committed: every spec but the ones other configs own. */
const publicConfig = config('playwright.config.js', {
  testMatch: '**/*.spec.js',
  testIgnore: ['**/not-found.spec.js', '**/accessibility-sweep.spec.js', '**/detail-*.spec.js'],
})

/** The detail config as committed, with DETAIL_E2E_SPEC unset. */
const detailConfig = config('playwright.detail.config.js', { testMatch: '**/detail-*.spec.js' })

/** The sweep config: one file, by name. */
const sweepConfig = config('playwright.sweep.config.js', {
  testMatch: '**/accessibility-sweep.spec.js',
})

/** The production config: one file, by name. */
const productionConfig = config('playwright.production.config.js', {
  testMatch: '**/not-found.spec.js',
})

const allConfigs = [publicConfig, detailConfig, sweepConfig, productionConfig]
const allSuites = [
  suite('public catalogue', 'playwright.config.js'),
  suite('commerce and operations detail', 'playwright.detail.config.js'),
  suite('accessibility sweep', 'playwright.sweep.config.js'),
  suite('production build', 'playwright.production.config.js'),
]
const allFiles = allConfigs.map((entry) => entry.file)
const allSpecs = [
  spec('journey.spec.js'),
  spec('detail-checkout.spec.js'),
  spec('accessibility-sweep.spec.js'),
  spec('not-found.spec.js'),
]

/**
 * Judge a fixture world, with the committed shape as the default.
 *
 * @param {object} [changes] Fields to replace.
 * @returns {{problems: Array<{where: string, what: string}>, collectedBy: Map<string, string[]>}} The verdict.
 */
function judge(changes = {}) {
  return judgeSpecCollection({
    suites: allSuites,
    configFiles: allFiles,
    configs: allConfigs,
    specs: allSpecs,
    ...changes,
  })
}

describe('following a CI job to the config it runs', () => {
  it('maps test:e2e:detail to the detail config and test:e2e to the default one', () => {
    expect(resolveSuite('test:e2e:detail', rootScripts, webScripts)).toEqual({
      webScript: 'test:e2e:detail',
      configFile: 'playwright.detail.config.js',
      narrowedBy: [],
    })
    expect(resolveSuite('test:e2e', rootScripts, webScripts)).toEqual({
      webScript: 'test:e2e',
      configFile: 'playwright.config.js',
      narrowedBy: [],
    })
  })

  it('reads through a build step and a run tag without calling either a narrowing', () => {
    // `pnpm run build && playwright test …` and `ORGANIZER_E2E_TAG=e2e$(date +%s)
    // playwright test …`: the substitution holds a space, and a reader that split
    // on whitespace alone would have lost the config after it.
    expect(resolveSuite('test:e2e:prod', rootScripts, webScripts).configFile).toBe(
      'playwright.production.config.js',
    )
    expect(resolveSuite('test:e2e:organizer', rootScripts, webScripts)).toEqual({
      webScript: 'test:e2e:organizer',
      configFile: 'playwright.organizer.config.js',
      narrowedBy: [],
    })
  })

  it('names DETAIL_E2E_SPEC= as a narrowing, so a CI job running one surface is caught', () => {
    // A real root script: running it locally is the point of it, and running
    // it as a CI leg would run one spec and report the whole suite.
    expect(resolveSuite('test:e2e:analytics', rootScripts, webScripts)).toEqual({
      webScript: 'test:e2e:analytics',
      configFile: 'playwright.detail.config.js',
      narrowedBy: ['DETAIL_E2E_SPEC='],
    })
  })

  it('names a file filter or a grep passed to playwright test as a narrowing too', () => {
    const scripts = { 'test:x': 'pnpm --filter @desi-event/web run test:x' }

    expect(
      resolveSuite('test:x', scripts, {
        'test:x': 'playwright test --config playwright.x.config.js e2e/one.spec.js',
      }).narrowedBy,
    ).toEqual(['e2e/one.spec.js'])
    expect(
      resolveSuite('test:x', scripts, { 'test:x': 'playwright test --grep=door -c x.config.js' }),
    ).toEqual({ webScript: 'test:x', configFile: 'x.config.js', narrowedBy: ['--grep=door'] })
  })

  it.each([
    ['a script the root does not have', 'test:none', {}, {}],
    ['a root script that is not a pnpm filter', 'test:x', { 'test:x': 'playwright test' }, {}],
    [
      'a root script passing arguments through',
      'test:x',
      { 'test:x': 'pnpm --filter @desi-event/web test:x -- --grep door' },
      { 'test:x': 'playwright test' },
    ],
    [
      'another package',
      'test:x',
      { 'test:x': 'pnpm --filter @desi-event/api test:x' },
      { 'test:x': 'playwright test' },
    ],
    [
      'a web script the package does not have',
      'test:x',
      { 'test:x': 'pnpm --filter @desi-event/web test:x' },
      {},
    ],
    [
      'a web script that pipes Playwright',
      'test:x',
      { 'test:x': 'pnpm --filter @desi-event/web test:x' },
      { 'test:x': 'playwright test | tee out.txt' },
    ],
    [
      'a web script that never runs Playwright',
      'test:x',
      { 'test:x': 'pnpm --filter @desi-event/web test:x' },
      { 'test:x': 'vitest run' },
    ],
    [
      'a web script that runs Playwright twice',
      'test:x',
      { 'test:x': 'pnpm --filter @desi-event/web test:x' },
      { 'test:x': 'playwright test -c a.config.js && playwright test -c b.config.js' },
    ],
    [
      'unbalanced quoting',
      'test:x',
      { 'test:x': 'pnpm --filter @desi-event/web test:x' },
      { 'test:x': "playwright test --config 'x.config.js" },
    ],
  ])('refuses, rather than guesses at, %s', (_label, script, root, web) => {
    expect(() => resolveSuite(script, root, web)).toThrow(Unverifiable)
  })

  it('records an unfollowable suite as a problem rather than throwing', () => {
    const [resolved] = resolveSuites([{ name: 'x', script: 'test:none' }], rootScripts, webScripts)

    expect(resolved.configFile).toBeNull()
    expect(resolved.problem).toMatch(/no "test:none" script/u)
  })
})

describe('matching a spec the way Playwright does', () => {
  const detail = `${WEB}/e2e/detail-checkout.spec.js`

  it('prefixes a bare pattern with **/ and matches the absolute path', () => {
    expect(matchesAny(detail, '**/detail-*.spec.js')).toBe(true)
    expect(matchesAny(detail, 'detail-*.spec.js')).toBe(true)
    expect(matchesAny(detail, ['**/journey.spec.js', '**/detail-*.spec.js'])).toBe(true)
    expect(matchesAny(detail, '**/journey.spec.js')).toBe(false)
    expect(matchesAny(detail, [])).toBe(false)
    expect(matchesAny(detail, undefined)).toBe(false)
  })

  it('ignores case, as Playwright does', () => {
    expect(matchesAny(`${WEB}/e2e/Detail-Checkout.spec.js`, '**/detail-*.spec.js')).toBe(true)
  })

  it("applies Playwright's default testMatch when a config sets none", () => {
    expect(matchesAny(`${WEB}/e2e/a.spec.js`, DEFAULT_TEST_MATCH)).toBe(true)
    expect(matchesAny(`${WEB}/e2e/a.test.mjs`, DEFAULT_TEST_MATCH)).toBe(true)
    expect(matchesAny(`${WEB}/e2e/support/a.mjs`, DEFAULT_TEST_MATCH)).toBe(false)
  })

  it('refuses a regular expression or a function as unverifiable', () => {
    expect(() => matchesAny(detail, /detail-.*\.spec\.js$/u)).toThrow(Unverifiable)
    expect(() => matchesAny(detail, ['**/x.spec.js', () => true])).toThrow(Unverifiable)
  })

  it("refuses a path under a dot-directory, where Node's matcher and Playwright's differ", () => {
    expect(() => matchesAny(`${WEB}/e2e/.drafts/a.spec.js`, '**/*.spec.js')).toThrow(Unverifiable)
    // Given the testDir, a dot-directory below it is still refused.
    expect(() => matchesAny(`${WEB}/e2e/.drafts/a.spec.js`, '**/*.spec.js', `${WEB}/e2e`)).toThrow(
      Unverifiable,
    )
  })

  it('matches a spec in a checkout that sits under a dot-directory, as Playwright does', () => {
    // `~/.cache/…`, `.claude/worktrees/…`: where the checkout is says nothing
    // about which specs a config collects, and Playwright's `dot: true` agrees.
    const web = '/home/dev/.cache/checkout/apps/web'
    const spec = `${web}/e2e/detail-checkout.spec.js`

    expect(matchesAny(spec, '**/detail-*.spec.js', `${web}/e2e`)).toBe(true)
    expect(matchesAny(spec, '**/web/e2e/detail-*.spec.js', `${web}/e2e`)).toBe(true)
    expect(matchesAny(spec, '**/journey.spec.js', `${web}/e2e`)).toBe(false)
    expect(collects({ dir: web, config: detailConfig.config }, spec)).toBe(true)
    expect(collects({ dir: web, config: publicConfig.config }, spec)).toBe(false)
  })

  it('refuses a pattern that could name the dot-directory a checkout sits under', () => {
    const web = '/home/dev/.cache/checkout/apps/web'

    for (const pattern of ['**/.cache/**/*.spec.js', '**/{.cache,x}/**/*.spec.js', '.x/*.js']) {
      expect(() => matchesAny(`${web}/e2e/a.spec.js`, pattern, `${web}/e2e`), pattern).toThrow(
        Unverifiable,
      )
    }

    // With no dot above the testDir there is nothing to hide, so nothing to refuse.
    expect(matchesAny(`${WEB}/e2e/a.spec.js`, '**/.cache/**/*.spec.js', `${WEB}/e2e`)).toBe(false)
  })

  it("lets a project's own patterns and testDir win over the config's", () => {
    const entry = config('p.config.js', {
      testMatch: '**/*.spec.js',
      projects: [{ name: 'only', testMatch: '**/journey.spec.js' }],
    })

    expect(collects(entry, `${WEB}/e2e/journey.spec.js`)).toBe(true)
    expect(collects(entry, `${WEB}/e2e/filters.spec.js`)).toBe(false)
    expect(
      collects(
        config('q.config.js', { testMatch: '**/*.spec.js', projects: [{ testDir: './other' }] }),
        `${WEB}/e2e/journey.spec.js`,
      ),
    ).toBe(false)
  })

  it('does not collect a spec outside the testDir, whatever the pattern', () => {
    const entry = config('p.config.js', { testDir: './e2e/public', testMatch: '**/*.spec.js' })

    expect(collectingConfigs(`${WEB}/e2e/journey.spec.js`, [entry])).toEqual([])
    expect(collectingConfigs(`${WEB}/e2e/public/journey.spec.js`, [entry])).toEqual(['p.config.js'])
  })
})

describe('judging the specs against the configs CI runs', () => {
  it('passes the committed shape: each spec collected by exactly one job', () => {
    const { problems, collectedBy } = judge()

    expect(problems).toEqual([])
    expect(Object.fromEntries(collectedBy)).toEqual({
      'apps/web/e2e/journey.spec.js': ['public catalogue'],
      'apps/web/e2e/detail-checkout.spec.js': ['commerce and operations detail'],
      'apps/web/e2e/accessibility-sweep.spec.js': ['accessibility sweep'],
      'apps/web/e2e/not-found.spec.js': ['production build'],
    })
  })

  it('reports a spec that no CI-run config collects', () => {
    // The public config ignores it and nothing else names it: exactly the gap
    // the sweep's header warns a new file would fall into.
    const stray = spec('refusals.spec.js')
    const { problems } = judge({
      specs: [...allSpecs, stray],
      configs: allConfigs.map((entry) =>
        entry === publicConfig
          ? config('playwright.config.js', {
              testMatch: '**/*.spec.js',
              testIgnore: [...publicConfig.config.testIgnore, '**/refusals.spec.js'],
            })
          : entry,
      ),
    })

    expect(problems).toEqual([
      {
        where: 'apps/web/e2e/refusals.spec.js',
        what: expect.stringMatching(/^is collected by no Playwright config a CI browser job runs/u),
      },
    ])
  })

  it('reports the documented failure: a public config without the detail-* ignore collects a detail spec twice', () => {
    const { problems } = judge({
      configs: allConfigs.map((entry) =>
        entry === publicConfig
          ? config('playwright.config.js', {
              testMatch: '**/*.spec.js',
              testIgnore: ['**/not-found.spec.js', '**/accessibility-sweep.spec.js'],
            })
          : entry,
      ),
    })

    expect(problems).toEqual([
      {
        where: 'apps/web/e2e/detail-checkout.spec.js',
        what: expect.stringContaining(
          'is collected by 2 CI browser jobs (public catalogue, commerce and operations detail)',
        ),
      },
    ])
  })

  it('reports two matrix legs running one config, since each runs every spec it collects', () => {
    const { problems } = judge({
      suites: [...allSuites, suite('sweep again', 'playwright.sweep.config.js')],
    })

    expect(problems.map((problem) => problem.where)).toEqual([
      'apps/web/e2e/accessibility-sweep.spec.js',
    ])
  })

  it('reports a RegExp testMatch as unverifiable, and passes nothing it could not read', () => {
    const { problems } = judge({
      configs: allConfigs.map((entry) =>
        entry === detailConfig
          ? config('playwright.detail.config.js', { testMatch: /detail-.*\.spec\.js$/u })
          : entry,
      ),
    })

    expect(problems).toEqual([
      {
        where: 'apps/web/playwright.detail.config.js',
        what: expect.stringMatching(/regular expression.*write it as a glob string/u),
      },
    ])
  })

  it('reports a CI job whose script narrows its config with DETAIL_E2E_SPEC=', () => {
    const [narrowed] = resolveSuites(
      [{ name: 'commerce and operations detail', script: 'test:e2e:analytics' }],
      rootScripts,
      webScripts,
    )
    const { problems } = judge({ suites: allSuites.map((s, i) => (i === 1 ? narrowed : s)) })

    expect(problems).toEqual([
      {
        where: '.github/workflows/ci.yml',
        what: expect.stringContaining('narrowed by "DETAIL_E2E_SPEC="'),
      },
    ])
  })

  it('reports a Playwright config that no matrix script runs', () => {
    const { problems } = judge({ configFiles: [...allFiles, 'playwright.orphan.config.js'] })

    expect(problems).toEqual([
      {
        where: 'apps/web/playwright.orphan.config.js',
        what: expect.stringMatching(/^is run by no CI browser job/u),
      },
    ])
  })

  it('reports a job that cannot be followed, or that names a config that is not there', () => {
    const { problems } = judge({
      suites: [
        ...allSuites,
        { name: 'broken', script: 'test:none', configFile: null, narrowedBy: [], problem: 'why' },
        suite('missing', 'playwright.missing.config.js'),
      ],
    })

    expect(problems.map((problem) => problem.what)).toEqual([
      'the "broken" browser job cannot be followed to a Playwright config: why',
      expect.stringContaining('runs apps/web/playwright.missing.config.js, which is not'),
    ])
  })

  it('reports an empty matrix rather than passing it', () => {
    expect(judge({ suites: [] }).problems[0].what).toMatch(/no browser matrix entries/u)
  })

  it('reports a file named as a spec that no config collects, whatever its extension', () => {
    // `detail-new-feature.spec.mjs` is a spec by its name; no config's pattern
    // reaches `.mjs`, so it would never run.
    const { problems, collectedBy } = judge({
      specs: [
        ...allSpecs,
        spec('detail-new-feature.spec.mjs'),
        spec('support/detail-world.mjs', 'export const world = {}\n'),
      ],
    })

    expect(problems).toEqual([
      {
        where: 'apps/web/e2e/detail-new-feature.spec.mjs',
        what: expect.stringMatching(/^is collected by no Playwright config a CI browser job runs/u),
      },
    ])
    // A support module no config collects is not a spec, and is not counted.
    expect([...collectedBy.keys()]).toEqual([
      ...allSpecs.map((entry) => entry.relative),
      'apps/web/e2e/detail-new-feature.spec.mjs',
    ])
  })

  it('scans a support module for forbidden calls as well as the specs', () => {
    // A fixture that skips on a condition hides cases just as a spec would.
    const { problems } = judge({
      specs: [
        ...allSpecs,
        spec(
          'support/detail-fixtures.mjs',
          'export const guard = async ({}, use, info) => {\n  info.skip(true)\n}\n',
        ),
      ],
    })

    expect(problems).toEqual([
      {
        where: 'apps/web/e2e/support/detail-fixtures.mjs:2',
        what: expect.stringContaining('calls info.skip('),
      },
    ])
  })

  it.each([
    [{ grep: /door/u }, 'grep'],
    [{ grepInvert: /slow/u }, 'grepInvert'],
    [{ shard: { current: 1, total: 2 } }, 'shard'],
    [{ projects: [{ name: 'chromium', grep: /door/u }] }, 'projects[0].grep'],
  ])('reports a CI-run config that narrows itself with %o', (fields, field) => {
    const { problems } = judge({
      configs: allConfigs.map((entry) =>
        entry === detailConfig
          ? config('playwright.detail.config.js', { testMatch: '**/detail-*.spec.js', ...fields })
          : entry,
      ),
    })

    expect(problems).toEqual([
      {
        where: 'apps/web/playwright.detail.config.js',
        what: expect.stringContaining(`sets ${field}, so it runs fewer cases than it collects`),
      },
    ])
  })

  it('reports a CI-run config that collects from outside the directory the specs are listed from', () => {
    const specRoot = `${WEB}/e2e`

    expect(judge({ specRoot }).problems).toEqual([])
    expect(
      judge({
        specRoot,
        configs: allConfigs.map((entry) =>
          entry === sweepConfig
            ? config('playwright.sweep.config.js', { testDir: './src', testMatch: '**/*.test.js' })
            : entry,
        ),
      }).problems,
    ).toContainEqual({
      where: 'apps/web/playwright.sweep.config.js',
      what: expect.stringContaining(`collects from ${WEB}/src, outside ${specRoot}`),
    })
  })

  it('reports test.skip, test.fixme and .only with the line they are on', () => {
    const skipping = spec(
      'journey.spec.js',
      [
        "test('one', async () => {})",
        "test.skip('two', async () => {})",
        "test.fixme('three', async () => {})",
        "test.describe.only('four', () => {})",
      ].join('\n'),
    )
    const { problems } = judge({ specs: [skipping, ...allSpecs.slice(1)] })

    expect(problems).toEqual([
      { where: 'apps/web/e2e/journey.spec.js:2', what: expect.stringContaining('test.skip(') },
      { where: 'apps/web/e2e/journey.spec.js:3', what: expect.stringContaining('test.fixme(') },
      { where: 'apps/web/e2e/journey.spec.js:4', what: expect.stringContaining('.only(') },
    ])
  })
})

describe('the calls a spec may not make', () => {
  it.each([
    ['test.skip(', "  test.skip(isMobile, 'not on phones')"],
    ['test.skip(', "test.describe.skip('group', () => {})"],
    ['test.fixme(', "test.describe.serial.fixme('group', () => {})"],
    ['test.fail(', "test.fail('known broken', async () => {})"],
    ['.only(', "test.only('just this', async () => {})"],
    ['.only(', "test.describe.parallel.only('group', () => {})"],
    ['testInfo.skip(', '  testInfo.skip(true)'],
    ['testInfo.skip(', '  test.info().fixme()'],
    ['test.step.skip(', "  await test.step.skip('later', async () => {})"],
    ['info.skip(', "test.beforeEach(async ({}, info) => { info.skip(true, 'hidden') })"],
    ['ti.fixme(', "test('x', async ({}, ti) => { ti?.fixme() })"],
    ['t.fail(', "test('x', async ({ page }, t) => { t.fail() })"],
    ["['skip']", "test['skip']('x', async () => {})"],
    ['{ skip } =', 'const { skip } = test'],
    ["an annotation of type 'skip'", "test('x', { annotation: { type: 'skip' } }, async () => {})"],
    [
      "an annotation of type 'fixme'",
      'test.describe(\'g\', { annotation: [{ type: "fixme" }] }, f)',
    ],
    ['test.skip(', 'const later = test.skip'],
  ])('finds %s in %s', (call, line) => {
    expect(forbiddenCalls(line).map((found) => found.call)).toContain(call)
  })

  it('reports each place once, by its most specific name', () => {
    expect(forbiddenCalls("test.describe.skip('group', () => {})")).toEqual([
      { call: 'test.skip(', line: 1 },
    ])
    expect(forbiddenCalls('  test.info().fixme()')).toEqual([{ call: 'testInfo.skip(', line: 1 }])
  })

  it('passes over code that only resembles them', () => {
    const code = [
      "await expect(page.locator(':focus')).toHaveText(/skip to main content/i)",
      'const failed = result.failed; const onlyOne = list.onlyOne',
      "test.slow(); test.describe.configure({ mode: 'serial' })",
      "test('x', { annotation: { type: 'issue', description: 'skip nothing' } }, f)",
    ].join('\n')

    expect(forbiddenCalls(code)).toEqual([])
  })

  it('passes over prose that names them, in a JSDoc block or a line comment', () => {
    const prose = [
      '/**',
      ' * No case here calls test.skip( or test.only( — the invariant forbids both.',
      ' */',
      '// test.fixme() would hide a failure; this file never does it.',
      "test('real', async () => {})",
    ].join('\n')

    expect(forbiddenCalls(prose)).toEqual([])
  })

  it('still finds a call written after code on the same line', () => {
    expect(forbiddenCalls("const x = 1; test.only('a', () => {})")).toEqual([
      { call: '.only(', line: 1 },
    ])
  })

  it('passes every committed spec and support module', () => {
    const e2e = path.join(repoRoot, 'apps', 'web', 'e2e')
    const files = readdirSync(e2e, { recursive: true }).filter(
      (file) => testFileExtension(path.basename(file)) && !file.includes('node_modules'),
    )

    expect(files).toContain(path.join('support', 'step-up.mjs'))

    for (const name of files) {
      expect(forbiddenCalls(readFileSync(path.join(e2e, name), 'utf8')), name).toEqual([])
    }
  })
})

describe('the browser jobs and the checks main requires', () => {
  it('reads the seven committed suites, each with its script', () => {
    const suites = matrixSuites(workflowText)

    expect(suites).toHaveLength(7)
    expect(suites).toContainEqual({
      name: 'commerce and operations detail',
      script: 'test:e2e:detail',
    })
    expect(suites.every((entry) => entry.name && entry.script)).toBe(true)
  })

  it('finds the job-level name, not a step or an artefact that interpolates the same value', () => {
    expect(suiteJobNameTemplate(workflowText)).toBe('Browser — ${{ matrix.suite.name }}')
    expect(
      suiteJobNameTemplate(
        [
          'jobs:',
          '  browser:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - name: Run ${{ matrix.suite.name }}',
          '        run: pnpm run x',
        ].join('\n'),
      ),
    ).toBeNull()
  })

  it('reads the approved ruleset through the one parser apply-branch-protection uses', () => {
    const contexts = requiredContextsFrom(rulesetText)

    expect(contexts).toHaveLength(8)
    expect(contexts).toContain('Browser — commerce and operations detail')
    expect(contextsOf(approvedRulesetFrom(rulesetText))).toEqual(contexts)
    expect(() => approvedRulesetFrom('# nothing here', 'x.md')).toThrow(
      'No branch ruleset payload found in x.md',
    )
  })

  it('passes the committed workflow against the committed ruleset', () => {
    expect(
      judgeRequiredContexts({
        suites: matrixSuites(workflowText),
        template: suiteJobNameTemplate(workflowText),
        requiredContexts: requiredContextsFrom(rulesetText),
      }),
    ).toEqual([])
  })

  it('reports a matrix name with no required context', () => {
    const problems = judgeRequiredContexts({
      suites: [...matrixSuites(workflowText), { name: 'seat picker', script: 'test:e2e:seats' }],
      template: suiteJobNameTemplate(workflowText),
      requiredContexts: requiredContextsFrom(rulesetText),
    })

    expect(problems).toEqual([
      {
        where: 'docs/BRANCH_PROTECTION.md',
        what: expect.stringContaining('does not require "Browser — seat picker"'),
      },
    ])
  })

  it('reports a workflow whose browser job name cannot be found', () => {
    expect(
      judgeRequiredContexts({ suites: [{ name: 'x' }], template: null, requiredContexts: [] }),
    ).toHaveLength(1)
  })

  it('finds a narrowing variable anywhere in a workflow', () => {
    expect(narrowingInWorkflow(workflowText)).toEqual([])
    expect(
      narrowingInWorkflow('    env:\n      DETAIL_E2E_SPEC: "**/detail-analytics.spec.js"\n'),
    ).toEqual(['DETAIL_E2E_SPEC'])
  })
})

describe('ci:check, on which browser job runs which spec', () => {
  const checker = path.join(repoRoot, 'scripts', 'check-ci-invariants.mjs')
  const webRoot = path.join(repoRoot, 'apps', 'web')

  /** Fixture roots made by the current test. */
  let made = []

  afterEach(() => {
    for (const directory of made) rmSync(directory, { force: true, recursive: true })

    made = []
  })

  /**
   * Run the real checker against a copy of the repository's CI inputs.
   *
   * The workflow, both manifests, the ruleset document and the web package's
   * configs and specs are copied, so a case can change any of them; the web
   * package's `node_modules` is linked, so a copied config still resolves
   * `@playwright/test` to the real one.
   *
   * @param {object} [changes] What to change.
   * @param {function(string): string} [changes.workflow] Rewrites ci.yml.
   * @param {function(string): string} [changes.ruleset] Rewrites BRANCH_PROTECTION.md.
   * @param {Record<string, function(string): string>} [changes.web] Rewrites files under apps/web, by path.
   * @param {Record<string, string>} [changes.add] Adds files under apps/web, by path.
   * @param {Record<string, string>} [changes.env] Extra environment for the checker.
   * @param {string} [changes.under] A directory, inside the fixture, to put the copy under.
   * @returns {{code: number, output: string}} Exit code and combined output.
   */
  function check({
    workflow = (t) => t,
    ruleset = (t) => t,
    web = {},
    add = {},
    env = {},
    under = '',
  } = {}) {
    const fixture = mkdtempSync(path.join(tmpdir(), 'spec-collection-'))
    const root = path.join(fixture, under)
    const copyTo = (from, to, change = (text) => text) => {
      mkdirSync(path.dirname(to), { recursive: true })
      writeFileSync(to, change(readFileSync(from, 'utf8')), 'utf8')
    }

    made.push(fixture)

    copyTo(
      path.join(repoRoot, '.github', 'workflows', 'ci.yml'),
      path.join(root, '.github', 'workflows', 'ci.yml'),
      workflow,
    )
    copyFileSync(path.join(repoRoot, 'turbo.json'), path.join(root, 'turbo.json'))
    copyFileSync(path.join(repoRoot, 'package.json'), path.join(root, 'package.json'))
    copyTo(
      path.join(repoRoot, 'docs', 'BRANCH_PROTECTION.md'),
      path.join(root, 'docs', 'BRANCH_PROTECTION.md'),
      ruleset,
    )

    const webCopy = path.join(root, 'apps', 'web')
    const files = [
      'package.json',
      'e2e/support/chromium.js',
      'e2e/support/next-dev.mjs',
      'e2e/support/e2e-database.mjs',
      'e2e/support/dev-routes-setup.mjs',
      'e2e/support/dev-routes.mjs',
      ...readdirSync(webRoot).filter((name) => /^playwright(\..+)?\.config\.js$/u.test(name)),
      ...readdirSync(path.join(webRoot, 'e2e'))
        .filter((name) => name.endsWith('.spec.js'))
        .map((name) => `e2e/${name}`),
    ]

    for (const file of files) {
      copyTo(path.join(webRoot, file), path.join(webCopy, file), web[file])
    }

    for (const [file, text] of Object.entries(add)) {
      mkdirSync(path.dirname(path.join(webCopy, file)), { recursive: true })
      writeFileSync(path.join(webCopy, file), text, 'utf8')
    }

    symlinkSync(path.join(webRoot, 'node_modules'), path.join(webCopy, 'node_modules'))

    try {
      const output = execFileSync('node', [checker], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      return { code: 0, output }
    } catch (error) {
      return { code: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
  }

  const specsOnDisk = readdirSync(path.join(webRoot, 'e2e')).filter((name) =>
    name.endsWith('.spec.js'),
  ).length

  it('holds for the committed tree, and says how many specs it proved', () => {
    const { code, output } = check()

    expect(output).not.toMatch(/CI invariants failed/u)
    expect(code).toBe(0)
    expect(output).toContain(
      `${specsOnDisk} browser specs are each collected by exactly one of 7 CI browser jobs`,
    )
    expect(output).toContain(
      '6 configs start next dev, each through e2e/support/next-dev.mjs with its routes proved before any test.',
    )
  })

  it('collects a new detail-<feature>.spec.js in the detail job and nowhere else', () => {
    const { code, output } = check({
      add: { 'e2e/detail-new-feature.spec.js': "test('a', async () => {})\n" },
    })

    expect(code).toBe(0)
    expect(output).toContain(`${specsOnDisk + 1} browser specs are each collected`)
  })

  it('holds for a checkout that sits under a dot-directory, as ~/.cache or a worktree does', () => {
    const { code, output } = check({ under: path.join('.checkout', 'desi-event.com') })

    expect(output).not.toMatch(/CI invariants failed/u)
    expect(code).toBe(0)
    expect(output).toContain(`${specsOnDisk} browser specs are each collected`)
  })

  it('refuses a detail spec named *.spec.mjs, which no config collects', () => {
    const { code, output } = check({
      add: { 'e2e/detail-new-feature.spec.mjs': "test('a', async () => {})\n" },
    })

    expect(code).toBe(1)
    expect(output).toContain(
      'apps/web/e2e/detail-new-feature.spec.mjs: is collected by no Playwright config a CI browser job runs',
    )
  })

  it('refuses a skip made through test.step, a renamed test-info argument or a support module', () => {
    const { code, output } = check({
      add: {
        'e2e/detail-skipper.spec.js': [
          "test('a', async () => {",
          "  await test.step.skip('later', async () => {})",
          '})',
          "test.beforeEach(async ({}, info) => { info.skip(true, 'hidden') })",
          '',
        ].join('\n'),
        'e2e/support/skipping.mjs': 'export const guard = (t) => t.fixme()\n',
      },
    })

    expect(code).toBe(1)
    expect(output).toContain('apps/web/e2e/detail-skipper.spec.js:2: calls test.step.skip(')
    expect(output).toContain('apps/web/e2e/detail-skipper.spec.js:4: calls info.skip(')
    expect(output).toContain('apps/web/e2e/support/skipping.mjs:1: calls t.fixme(')
  })

  it('refuses a public config that loses its detail-* ignore, naming both jobs', () => {
    const { code, output } = check({
      web: {
        'playwright.config.js': (text) => text.replace("    '**/detail-*.spec.js',\n", ''),
      },
    })

    expect(code).toBe(1)
    expect(output).toContain(
      'apps/web/e2e/detail-account.spec.js: is collected by 2 CI browser jobs (public catalogue, commerce and operations detail)',
    )
  })

  it('refuses a matrix leg removed: its config runs nowhere and its spec never runs', () => {
    const leg = '          - name: refusals\n            script: test:e2e:refusals\n'
    const { code, output } = check({
      workflow: (text) => {
        expect(text).toContain(leg)

        return text.replace(leg, '')
      },
    })

    expect(code).toBe(1)
    expect(output).toContain('apps/web/playwright.refusals.config.js: is run by no CI browser job')
    expect(output).toContain(
      'apps/web/e2e/refusals.spec.js: is collected by no Playwright config a CI browser job runs',
    )
  })

  it('refuses a CI leg that runs one detail surface instead of the suite', () => {
    const { code, output } = check({
      workflow: (text) => text.replace('script: test:e2e:detail', 'script: test:e2e:analytics'),
    })

    expect(code).toBe(1)
    expect(output).toContain('narrowed by "DETAIL_E2E_SPEC="')
  })

  it('does not let a DETAIL_E2E_SPEC in the shell change the verdict', () => {
    // The config is loaded with the variable removed, so a developer who had
    // exported it for a local run gets the same answer CI does.
    const { code } = check({ env: { DETAIL_E2E_SPEC: '**/detail-analytics.spec.js' } })

    expect(code).toBe(0)
  })

  it('refuses a focused case in a committed spec, by file and line', () => {
    const { code, output } = check({
      web: {
        'e2e/journey.spec.js': (text) => `${text}\ntest.only('focus', async () => {})\n`,
      },
    })
    const line = readFileSync(path.join(webRoot, 'e2e', 'journey.spec.js'), 'utf8').split(
      '\n',
    ).length

    expect(code).toBe(1)
    expect(output).toContain(`apps/web/e2e/journey.spec.js:${line + 1}: calls .only(`)
  })

  it('refuses a browser job the ruleset does not require', () => {
    const { code, output } = check({
      ruleset: (text) => text.replace('          { "context": "Browser — refusals" },\n', ''),
    })

    expect(code).toBe(1)
    expect(output).toContain('the approved ruleset does not require "Browser — refusals"')
  })

  it('refuses a config that starts next dev by hand, without proving its routes', () => {
    const helper =
      '    nextDevServer({ port: webPort, env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}` } }),\n'
    const byHand = [
      '    {',
      '      command: `npx next dev --port ${webPort}`,',
      '      url: baseURL,',
      '      reuseExistingServer: false,',
      '      timeout: 180_000,',
      '      env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}` },',
      '    },',
      '',
    ].join('\n')
    const { code, output } = check({
      web: {
        'playwright.sweep.config.js': (text) => {
          expect(text).toContain(helper)
          expect(text).toContain('  globalSetup: withDevRoutes(),\n')

          return text.replace(helper, byHand).replace('  globalSetup: withDevRoutes(),\n', '')
        },
      },
    })

    expect(code).toBe(1)
    expect(output).toContain(
      'apps/web/playwright.sweep.config.js: starts `npx next dev --port 3430` by hand — build the entry with nextDevServer()',
    )
    expect(output).toContain(
      'apps/web/playwright.sweep.config.js: starts next dev without e2e/support/dev-routes-setup.mjs in its globalSetup',
    )
  })

  it('refuses a next dev config that proves its routes only after its own setup', () => {
    const { code, output } = check({
      web: {
        'playwright.detail.config.js': (text) =>
          text.replace(
            "globalSetup: withDevRoutes('./e2e/support/detail-global-setup.mjs'),",
            "globalSetup: ['./e2e/support/detail-global-setup.mjs', './e2e/support/dev-routes-setup.mjs'],",
          ),
      },
    })

    expect(code).toBe(1)
    expect(output).toContain(
      'apps/web/playwright.detail.config.js: runs e2e/support/dev-routes-setup.mjs after another global setup',
    )
  })

  it('refuses a testMatch it cannot read as a glob', () => {
    const { code, output } = check({
      web: {
        'playwright.sweep.config.js': (text) =>
          text.replace("testMatch: '**/accessibility-sweep.spec.js'", 'testMatch: /sweep/u'),
      },
    })

    expect(code).toBe(1)
    expect(output).toMatch(
      /apps\/web\/playwright\.sweep\.config\.js: cannot be proved to collect or ignore .*regular expression/u,
    )
  })
})
